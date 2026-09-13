import { CylinderGeometry, DynamicDrawUsage, InstancedMesh, Matrix4, MeshBasicMaterial, MeshLambertMaterial, SphereGeometry, Vector3 } from "three";
import { WGS84_ELLIPSOID, CAMERA_FRAME } from "3d-tiles-renderer";
import { moveGeo, thermalCenter } from "./weather.js";

export class WeatherVisuals {
  constructor(scene) {
    this.clouds = new InstancedMesh(new SphereGeometry(1,16,10), new MeshLambertMaterial({ color:0xe6edf3, transparent:true, opacity:.9, depthWrite:false }), 320);
    this.columns = new InstancedMesh(new CylinderGeometry(1,1,1,20,1,true), new MeshBasicMaterial({ color:0x6ef2c4, transparent:true, opacity:.10, depthWrite:false, wireframe:true }), 64);
    this.clouds.name = "weather-cumulus"; this.columns.name = "thermal-guides";
    for(const mesh of [this.clouds,this.columns]) {
      mesh.instanceMatrix.setUsage(DynamicDrawUsage); mesh.frustumCulled=false; mesh.raycast=()=>{}; mesh.count=0; scene.add(mesh);
    }
    this.matrix = new Matrix4(); this.position = new Vector3(); this.scale = new Vector3();
    this.counts = { clouds:0, thermalMarkers:0 };
  }
  update(weather, plane, camera, mapMatrix, { hidden=false, markers=false }={}) {
    let clouds=0, columns=0;
    for(const mesh of [this.clouds,this.columns]) mesh.position.copy(camera.position);
    const instance = (mesh,index,lat,lon,height,x,y,z) => {
      WGS84_ELLIPSOID.getObjectFrame(lat,lon,height,0,0,0,this.matrix,CAMERA_FRAME);
      this.matrix.premultiply(mapMatrix);
      this.position.setFromMatrixPosition(this.matrix).sub(camera.position);
      this.matrix.setPosition(this.position).scale(this.scale.set(x,y,z));
      mesh.setMatrixAt(index,this.matrix);
    };
    if(!hidden && weather) for(const cell of weather.thermals) {
      if(cell.cloud && cell.distance<10500) {
        const top=cell.ground+cell.cloudBase, center=thermalCenter(cell,top,weather.utcMs);
        // Five overlapping lobes form a flat-ish cloud base at the plume top.
        // Positions stay geographic as the camera moves or circles underneath.
        for(let i=0;i<5;i++) {
          const angle=i*2.4, size=cell.radius*(i===0?1.05:.62+.08*(i%3))*cell.cloudAmount;
          const p=moveGeo(center.lat,center.lon,Math.cos(angle)*cell.radius*(i===0?0:.72),Math.sin(angle)*cell.radius*(i===0?0:.72));
          instance(this.clouds,clouds++,p.lat,p.lon,top+size*(i===0?.68:.34),size,size*(i===0?.85:.64),size*.85);
        }
      }
      if(markers && cell.strength>.5 && cell.distance<6500 && plane.height<cell.ground+cell.cloudBase) {
        const altitude=Math.max(cell.ground+150,Math.min(plane.height,cell.ground+cell.cloudBase-150));
        const center=thermalCenter(cell,altitude,weather.utcMs);
        instance(this.columns,columns++,center.lat,center.lon,altitude,cell.radius,300,cell.radius);
      }
    }
    this.clouds.count=clouds; this.columns.count=columns;
    for(const mesh of [this.clouds,this.columns]) { mesh.instanceMatrix.needsUpdate=true; mesh.updateMatrixWorld(); }
    this.counts={clouds:clouds/5,thermalMarkers:columns};
  }
  diagnostics() { return this.counts; }
  dispose() { for(const mesh of [this.clouds,this.columns]) { mesh.removeFromParent();mesh.geometry.dispose();mesh.material.dispose();mesh.dispose(); } }
}

const signed = n => `${n>=0?"+":""}${n.toFixed(1)}`;
export function createWeatherHud(element) {
  const wind=element.querySelector('[data-wind]'), vario=element.querySelector('[data-vario]');
  const details=element.querySelector('[data-weather-details]'), toggle=element.querySelector('input');
  try { toggle.checked=localStorage.getItem('foe-thermal-guides')==='on'; } catch { /* Storage can be unavailable. */ }
  toggle.addEventListener('change',()=>{try {localStorage.setItem('foe-thermal-guides',toggle.checked?'on':'off');}catch{/* Optional preference. */}});
  let next=0;
  return {
    get markers() { return toggle.checked; },
    update(weather,plane,{hidden=false,grounded=false,towing=false}={}) {
      element.hidden=hidden;
      if(hidden || !weather || performance.now()<next) return;
      next=performance.now()+200;
      wind.textContent=`Wind ${Math.round(weather.from).toString().padStart(3,'0')}° · ${Math.round(weather.speed*3.6)} km/h`;
      const climb=grounded?0:plane.verticalSpeed;
      vario.textContent=`Vario ${signed(climb)} m/s`;
      vario.dataset.lift=climb>.1?'up':climb<-.1?'down':'level';
      const nearest=weather.nearest;
      details.textContent=`Simulated weather\nAir ${signed(weather.up)} m/s · gust ${weather.gust.toFixed(1)} m/s\nGround ${Math.round((grounded?plane.speed:plane.groundSpeed??plane.speed)*3.6)} km/h\nCloud base ${Math.round(weather.cloudBase)} m AMSL\n${towing?'Tow assistance compensates for wind':nearest?`Thermal ${Math.round(nearest.bearing)}° · ${(nearest.distance/1000).toFixed(1)} km`:'No active thermals nearby'}${plane.isBalloon?'\nChange altitude to find another wind direction.':''}`;
    },
  };
}
