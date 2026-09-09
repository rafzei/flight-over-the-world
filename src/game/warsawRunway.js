import { BoxGeometry, CanvasTexture, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Matrix4, PlaneGeometry, Vector3 } from "three";
import { CAMERA_FRAME, WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// OurAirports EPWA 15/33: physical end 33, true heading 332°, displaced threshold 2170 ft.
// Published elevation is MSL. Use a local geoid estimate until actual Cesium terrain is sampled.
export const WARSAW_RUNWAY = Object.freeze({ name: "Warsaw Chopin · EPWA 33", lat: 52.149399, lon: 20.9814, heading: 332, length: 3690, width: 60, threshold: 661.4, elevation: 143.2 });
const DEG = Math.PI / 180;

export class WarsawRunway {
  constructor() {
    this.definition = WARSAW_RUNWAY; this.elevation = WARSAW_RUNWAY.elevation; this.calibrated = false;
    this.frame = new Matrix4(); this.inverse = new Matrix4(); this.local = new Vector3(); this.cartographic = {};
    this.rebuildFrame();
  }
  rebuildFrame() {
    const d = this.definition;
    WGS84_ELLIPSOID.getObjectFrame(d.lat*DEG,d.lon*DEG,this.elevation,d.heading*DEG,0,0,this.frame,CAMERA_FRAME);
    this.inverse.copy(this.frame).invert();
  }
  coordinates(pose, target = new Vector3()) {
    return WGS84_ELLIPSOID.getCartographicToPosition(pose.lat,pose.lon,pose.height,target).applyMatrix4(this.inverse);
  }
  pose(x, along, y = 0) {
    this.local.set(x,y,-along).applyMatrix4(this.frame);
    WGS84_ELLIPSOID.getPositionToCartographic(this.local,this.cartographic);
    return { lat:this.cartographic.lat,lon:this.cartographic.lon,height:this.cartographic.height };
  }
  contains(point, { landing = false, margin = 0 } = {}) {
    const d=this.definition, along=-point.z;
    return Math.abs(point.x)<=d.width/2-margin && along>=(landing?d.threshold:0)+margin && along<=d.length-margin;
  }
  calibrate(probe) {
    if(this.calibrated)return;
    const heights=[];
    for(const along of [this.definition.threshold+100,1800,3400]) {
      const p=this.pose(0,along), h=probe(p.lat,p.lon,3000);
      if(Number.isFinite(h)&&h>80&&h<210)heights.push(h-(p.height-this.elevation));
    }
    if(heights.length){this.elevation=Math.max(...heights)+.35;this.calibrated=true;this.rebuildFrame();}
  }
}

export function createRunwayVisual(scene, runway, mapRoot) {
  const root=new Group();root.name="EPWA-runway-33";root.matrixAutoUpdate=false;scene.add(root);
  const asphalt=new MeshStandardMaterial({color:0x3b4144,roughness:.96});
  const white=new MeshBasicMaterial({color:0xf5f0dc});
  const green=new MeshBasicMaterial({color:0x72ff9a}), red=new MeshBasicMaterial({color:0xff3b28});
  const light=new MeshBasicMaterial({color:0xffebae});
  function rectangle(x,along,width,length,material=white,y=.025){
    const mesh=new Mesh(new PlaneGeometry(width,length),material);mesh.rotation.x=-Math.PI/2;mesh.position.set(x,y,-along);root.add(mesh);return mesh;
  }
  const d=runway.definition;
  rectangle(0,d.length/2,d.width,d.length,asphalt,0);
  for(const side of [-1,1])rectangle(side*(d.width/2-1),d.length/2,.45,d.length);
  for(let along=d.threshold+220;along<d.length-150;along+=90)rectangle(0,along,.9,32);
  for(const side of [-1,1]) {
    for(let i=0;i<6;i++)rectangle(side*(4+i*3.5),d.threshold+22,1.8,40);
    rectangle(side*11,d.threshold+300,6,46);
    for(let along=0;along<=d.length;along+=60){const bulb=new Mesh(new BoxGeometry(.5,.22,.5),light);bulb.position.set(side*(d.width/2+.3),.15,-along);root.add(bulb);}
  }
  for(let x=-27;x<=27;x+=3){rectangle(x,d.threshold,1.1,1.1,green,.05);rectangle(x,d.length-2,1.1,1.1,red,.05);}
  const canvas=document.createElement("canvas");canvas.width=256;canvas.height=256;
  const ctx=canvas.getContext("2d");ctx.fillStyle="#f5f0dc";ctx.font="bold 180px monospace";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText("33",128,128);
  const texture=new CanvasTexture(canvas), numberMaterial=new MeshBasicMaterial({map:texture,transparent:true,depthWrite:false});
  rectangle(0,d.threshold+95,16,26,numberMaterial,.04);
  // One batch per material keeps runway markings/lights inexpensive on phones.
  root.updateMatrixWorld(true);
  for(const material of [asphalt,white,green,red,light,numberMaterial]){
    const parts=root.children.filter(o=>o.material===material),geometries=parts.map(o=>{const g=o.geometry.toNonIndexed();g.applyMatrix4(o.matrix);return g;});
    if(!geometries.length)continue;
    const mesh=new Mesh(mergeGeometries(geometries),material);root.add(mesh);
    for(const o of parts){o.removeFromParent();o.geometry.dispose();}for(const g of geometries)g.dispose();
  }
  root.traverse(o=>{if(o.isMesh){o.receiveShadow=true;o.userData.runway=true;}});
  return {root,update(){root.matrix.multiplyMatrices(mapRoot.matrixWorld,runway.frame);root.updateMatrixWorld(true);},dispose(){root.removeFromParent();const resources=new Set();root.traverse(o=>{if(o.geometry)resources.add(o.geometry);if(o.material)resources.add(o.material);});resources.add(texture);for(const r of resources)r.dispose();}};
}
