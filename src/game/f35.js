import {
  AdditiveBlending, BoxGeometry, BufferGeometry, Color, CylinderGeometry, DoubleSide,
  Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, MeshPhysicalMaterial,
  MeshStandardMaterial, ShapeUtils, SphereGeometry, Vector2, Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// F-35A, metres; +Z nose, +X port, +Y up, matching the existing fighter weapons.
// Photo/three-view references and deliberate gameplay simplifications: docs/f35.md.
export const F35_DIMENSIONS = Object.freeze({ length:15.67, span:10.7, finCantDeg:25 });
const CANT=Math.tan(25*Math.PI/180);
const profiles = [ // z, half-width, crown, belly. Nose -> engine casing.
  [7.835,.012,-.03,-.055],[7.5,.18,.065,-.19],[6.9,.4,.28,-.36],
  [6.15,.62,.49,-.50],[5.55,.72,.58,-.55],[4.8,.78,.63,-.59],
  [4.1,.81,.67,-.62],[3.45,.88,.72,-.66],[2.7,1.25,.80,-.69],
  [2.4,1.46,.84,-.72],[1.3,1.55,.93,-.79],[0,1.60,.99,-.84],
  [-1.4,1.53,1.02,-.84],[-2.8,1.4,.94,-.76],[-3.6,1.23,.81,-.62],
  [-4.4,.98,.67,-.53],[-5.15,.68,.54,-.56],
];
function section(z) {
  let i=profiles.findIndex(p=>p[0]<=z);if(i<1)i=i<0?profiles.length-1:1;
  const a=profiles[i-1],b=profiles[i],t=Math.max(0,Math.min(1,(z-a[0])/(b[0]-a[0])));
  return a.map((n,j)=>j?n+(b[j]-n)*t:z);
}
function ring([z,w,top,bottom]) {
  return [[0,top,z],[w*.4,top*.96,z],[w*.75,top*.68,z],[w,.03,z],
    [w*.9,bottom*.75,z],[w*.5,bottom,z],[0,bottom,z],[-w*.5,bottom,z],
    [-w*.9,bottom*.75,z],[-w,.03,z],[-w*.75,top*.68,z],[-w*.4,top*.96,z]];
}
function skin(x,z,upper=true,offset=.013) {
  const [,w,top,bottom]=section(z),r=Math.min(1,Math.abs(x)/w);
  const y=upper ? r<.4?top*(1-r*.1):r<.75?top*(.96-(r-.4)*.8):top*.68+(r-.75)/.25*(.03-top*.68)
    :r<.5?bottom:r<.9?bottom+(r-.5)/.4*(-.25*bottom):bottom*.75+(r-.9)/.1*(.03-bottom*.75);
  return [x,y+(upper?offset:-offset),z];
}

export function createF35() {
  const root=new Group();root.name='F-35A Lightning II';
  const materials={
    body:new MeshStandardMaterial({color:0x656c74,roughness:.52,metalness:.28}),
    panel:new MeshStandardMaterial({color:0x747c85,roughness:.58,metalness:.22}),
    ram:new MeshStandardMaterial({color:0x92999d,roughness:.64,metalness:.14}),
    dark:new MeshStandardMaterial({color:0x172029,roughness:.72,metalness:.15}),
    metal:new MeshStandardMaterial({color:0x666771,roughness:.32,metalness:.78}),
    nozzle:new MeshStandardMaterial({color:0x302b2a,roughness:.52,metalness:.65}),
    glass:new MeshPhysicalMaterial({color:0xb6a070,roughness:.12,metalness:.25,transparent:true,opacity:.57,clearcoat:1,clearcoatRoughness:.08,side:DoubleSide,depthWrite:false}),
    sensor:new MeshPhysicalMaterial({color:0x294a50,roughness:.09,metalness:.5,clearcoat:1}),
    cockpit:new MeshStandardMaterial({color:0x20292b,roughness:.88}),
    seat:new MeshStandardMaterial({color:0x4e5144,roughness:.95}),
    screen:new MeshBasicMaterial({color:0x386d7a,toneMapped:false}),
    formation:new MeshBasicMaterial({color:0x80977d,toneMapped:false}),
    white:new MeshStandardMaterial({color:0xacb5b5,roughness:.62,metalness:.15}),
  };
  for(const [key,m]of Object.entries(materials)){m.name=`f35-${key}`;m.userData.vehicleFinish=true;}
  const batches=new Map(),surfaces=[],doors=[],bayTimers=[0,0];
  const features={intakes:2,nozzles:1,nozzlePetals:18,sensors:6,weaponBays:2,canopy:'single-piece',finCantDeg:25};
  function add(g,key,parent=root,name='') {
    const mesh=new Mesh(g,materials[key]);mesh.name=name||`f35-${key}`;mesh.castShadow=key!=='glass'&&key!=='formation';mesh.receiveShadow=true;
    parent.add(mesh);return mesh;
  }
  function bake(g,key) {
    const geom=g.index?g.toNonIndexed():g;
    if(geom!==g)g.dispose();geom.deleteAttribute('uv');
    if(!batches.has(key))batches.set(key,[]);batches.get(key).push(geom);
  }
  function poly(points,key='body',parent=null,flip=false,name='') {
    const p=[];for(let i=1;i<points.length-1;i++)for(const j of flip?[0,i+1,i]:[0,i,i+1])p.push(...points[j]);
    const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(p,3));g.computeVertexNormals();
    if(parent)return add(g,key,parent,name);bake(g,key);return g;
  }
  function tube(a,b,r=.009,key='ram',parent=null) {
    const v=new Vector3(...b).sub(new Vector3(...a)),g=new CylinderGeometry(r,r,v.length(),6);
    g.applyQuaternion(new Group().quaternion.setFromUnitVectors(new Vector3(0,1,0),v.normalize()));
    g.translate(...new Vector3(...a).add(new Vector3(...b)).multiplyScalar(.5).toArray());
    if(parent)return add(g,key,parent);bake(g,key);
  }
  function path(points,key='ram',width=.009,closed=true,parent=null) {
    for(let i=0;i<points.length-(closed?0:1);i++)tube(points[i],points[(i+1)%points.length],width,key,parent);
  }
  function panel(points,upper=true,width=.008,key='ram') {path(points.map(([x,z])=>skin(x,z,upper)),key,width);}
  function ellipsoid(center,scale,key,parent=null,name='') {
    const g=new SphereGeometry(1,24,14);g.scale(...scale);g.translate(...center);
    if(parent)return add(g,key,parent,name);bake(g,key);
  }
  function box(center,scale,key,parent=null) {
    const g=new BoxGeometry(...scale);g.translate(...center);if(parent)return add(g,key,parent);bake(g,key);
  }
  // One continuous faceted/chined fuselage. The cockpit and belly bays are actual openings.
  const vertices=[],ids=[],N=12;
  for(const p of profiles)for(const point of ring(p))vertices.push(...point);
  for(let j=0;j<profiles.length-1;j++)for(let i=0;i<N;i++) {
    const z=(profiles[j][0]+profiles[j+1][0])/2;
    if(z>2.7&&z<5.55&&(i===0||i===11))continue;
    if(z<=2.4&&z>=-2.8&&i>=4&&i<=7)continue;
    const a=j*N+i,b=j*N+(i+1)%N,c=(j+1)*N+i,d=(j+1)*N+(i+1)%N;
    ids.push(a,b,c,b,d,c);
  }
  const fuselage=new BufferGeometry();fuselage.setAttribute('position',new Float32BufferAttribute(vertices,3));fuselage.setIndex(ids);fuselage.computeVertexNormals();
  add(fuselage,'body',root,'f35-fuselage');
  // Belly keel and strips outside the two open weapon compartments.
  for(let j=9;j<13;j++) {
    const a=profiles[j],b=profiles[j+1];
    for(const side of [-1,1])poly([skin(side*1.1,a[0],false,0),skin(side*a[1]*.9,a[0],false,0),skin(side*b[1]*.9,b[0],false,0),skin(side*1.1,b[0],false,0)],'body',null,side<0);
    poly([skin(-.25,a[0],false,0),skin(.25,a[0],false,0),skin(.25,b[0],false,0),skin(-.25,b[0],false,0)],'body');
  }
  // Diverterless supersonic inlets: swept trapezoid lips, recessed ducts and inner bumps.
  for(const side of [-1,1]) {
    const mouth=[[.90,.43,3.7],[1.48,.24,3.45],[1.53,-.49,3.36],[.96,-.61,3.65]].map(([x,y,z])=>[x*side,y,z]);
    const center=new Vector3(...mouth[0]).add(new Vector3(...mouth[1])).add(new Vector3(...mouth[2])).add(new Vector3(...mouth[3])).multiplyScalar(.25);
    const inner=mouth.map(p=>new Vector3(...p).sub(center).multiplyScalar(.88).add(center).add(new Vector3(0,0,-.075)).toArray());
    const back=inner.map(([x,y])=>[side*1.1+(x-side*1.1)*.68,y*.65,2.45]);
    for(let i=0;i<4;i++) {
      const n=(i+1)%4;
      poly([mouth[i],mouth[n],inner[n],inner[i]],'panel',null,side<0);
      poly([inner[i],inner[n],back[n],back[i]],'dark',null,side<0);
    }
    poly(back,'dark',null,side>0);
    const aft=[[1.18,.61,2.3],[1.56,.27,2.3],[1.53,-.51,2.3],[1.08,-.65,2.3]].map(([x,y,z])=>[side*x,y,z]);
    for(const i of [0,1,2])poly([mouth[i],aft[i],aft[i+1],mouth[i+1]],'body',null,side<0);
    ellipsoid([side*.86,-.03,3.65],[.19,.39,.6],'body');
    path(mouth,'ram',.016);
  }
  // Single uninterrupted gold-tinted canopy; no extra windshield bow.
  const canopyProfiles=[[5.65,.08,.56,.04],[5.35,.32,.61,.42],[4.75,.48,.66,.75],[4.0,.52,.71,.84],[3.35,.47,.75,.68],[2.85,.31,.79,.32],[2.65,.04,.79,.035]];
  const cp=[],ci=[],CN=32;
  for(const [z,w,base,h]of canopyProfiles)for(let i=0;i<=CN;i++){const a=i/CN*Math.PI;cp.push(Math.cos(a)*w,base+Math.sin(a)*h,z);}
  for(let j=0;j<canopyProfiles.length-1;j++)for(let i=0;i<CN;i++){const a=j*(CN+1)+i,b=a+CN+1;ci.push(a,a+1,b,b,a+1,b+1);}
  const canopy=new BufferGeometry();canopy.setAttribute('position',new Float32BufferAttribute(cp,3));canopy.setIndex(ci);canopy.computeVertexNormals();
  add(canopy,'glass',root,'f35-gold-canopy');
  for(const side of [-1,1])path(canopyProfiles.map(([z,w,base])=>[side*w,base,z]),'ram',.025,false);
  box([0,.66,4.03],[.92,.12,2.45],'cockpit');
  // Visible cockpit: ejection seat, headrest, belts, side consoles, wide display and helmet.
  box([0,.90,3.65],[.48,.54,.30],'seat');box([0,1.21,3.62],[.28,.23,.22],'cockpit');
  box([0,.80,4.02],[.46,.17,.6],'seat');
  for(const side of [-1,1]) {
    box([side*.34,.84,4.1],[.16,.20,1.05],'cockpit');
    tube([side*.15,1.12,3.88],[side*.12,.83,4.19],.027,'ram');
    box([side*.10,.79,4.35],[.18,.20,.65],'seat');
  }
  ellipsoid([0,1.08,4.0],[.23,.29,.2],'seat');ellipsoid([0,1.33,4.08],[.17,.18,.18],'white');
  ellipsoid([0,1.35,4.205],[.16,.082,.09],'sensor');
  box([0,.93,4.72],[.73,.34,.13],'cockpit');
  poly([[-.32,.83,4.792],[.32,.83,4.792],[.32,1.07,4.792],[-.32,1.07,4.792]],'screen');
  for(let i=0;i<8;i++)box([-.28+i*.08,.84,4.807],[.04,.012,.007],'white');
  // Aircraft-planform solids; upper/lower skin meet at a thin bevelled edge.
  function slab(outline,point,thickness=.085) {
    const coords=outline.map(p=>new Vector2(...p)),tri=ShapeUtils.triangulateShape(coords,[]),p=[],idx=[],count=outline.length;
    for(const offset of [-thickness/2,thickness/2])for(const c of outline)p.push(...point(c,offset));
    for(const [a,b,c]of tri)idx.push(c,b,a,a+count,b+count,c+count);
    for(let i=0;i<count;i++){const n=(i+1)%count;idx.push(i,n,n+count,i,n+count,i+count);}
    const o=new Vector3(...point([0,0],0));
    const normal=new Vector3(...point([1,0],0)).sub(o).cross(new Vector3(...point([0,1],0)).sub(o));
    if(normal.dot(new Vector3(...point([0,0],1)).sub(o))<0)for(let i=0;i<idx.length;i+=3)[idx[i],idx[i+2]]=[idx[i+2],idx[i]];
    const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(p,3));g.setIndex(idx);g.computeVertexNormals();return g;
  }
  function moving(outline,point,origin,axis,side,role,weights) {
    const hinge=new Group();hinge.name=`f35-${side>0?'port':'starboard'}-${role}`;hinge.position.set(...origin);root.add(hinge);
    const g=slab(outline,point);g.translate(-origin[0],-origin[1],-origin[2]);add(g,'body',hinge);
    path(outline.map(p=>{const v=point(p,.052);return v.map((x,i)=>x-origin[i]);}),'ram',.008,true,hinge);
    surfaces.push({hinge,axis:new Vector3(...axis).normalize(),side,angle:0,...weights});
    return hinge;
  }
  for(const side of [-1,1]) {
    const wing=([x,z],offset=0)=>[side*x,.02-.018*(x-1.3)+offset,z];
    const fixed=[[1.18,.70],[5.35,-2.17],[5.35,-3.13],[1.42,-3.58]];
    bake(slab(fixed,wing,.11),'body');
    path([[1.4,.49],[5.2,-2.25],[5.2,-2.52],[1.4,.20]].map(p=>wing(p,.064)),'ram',.012);
    moving([[1.43,-3.60],[5.35,-3.15],[5.35,-3.73],[1.3,-4.53]],wing,[side*3.4,-.04,-3.38],[1,0,side*.117],side,'flaperon',{pitchWeight:.16,rollWeight:.32});
    const tail=([x,z],offset=0)=>[side*x,.17+(x-1.1)*.025+offset,z];
    moving([[1.08,-4.45],[3.68,-6.22],[3.68,-7.22],[.99,-7.835]],tail,[side*1.35,.2,-5.5],[1,0,0],side,'stabilator',{pitchWeight:.42,rollWeight:.22});
    const fin=([h,z],offset=0)=>[side*(1.04+h*CANT)+offset,.4+h,z];
    const finFixed=[[0,-3.75],[2.16,-5.20],[2.16,-5.88],[0,-6.32]];
    const finGroup=new Group();finGroup.name=`f35-${side>0?'port':'starboard'}-canted-fin`;root.add(finGroup);
    add(slab(finFixed,fin,.075),'body',finGroup);
    path(finFixed.map(p=>fin(p,side*.047)),'ram',.007,true,finGroup);
    moving([[0,-6.35],[2.16,-5.90],[2.16,-6.32],[0,-6.94]],fin,fin([0,-6.35]),[side*CANT,1,.20],side,'rudder',{pitchWeight:0,rollWeight:.12});
    // Low-visibility fin cap and formation strip, following the canted surface.
    poly([[1.89,-5.4],[2.13,-5.23],[2.13,-5.75],[1.89,-5.8]].map(p=>fin(p,side*.044)),'panel',null,side<0);
    poly([[1.05,-5.24],[1.12,-5.30],[1.12,-5.74],[1.05,-5.73]].map(p=>fin(p,side*.050)),'formation',null,side<0);
    const marker=new Group();marker.name=`wing-contrail-emitter-${side}`;marker.userData.contrailEmitter=true;marker.position.copy(new Vector3(...wing([5.32,-3.69])));root.add(marker);
    // Wing access covers and thin lightning/static discharge wicks.
    for(const x of [2.2,3.45,4.6]) {
      const z=-1.85-(x-2.2)*.44;
      path([[x,z],[x+.38,z-.15],[x+.38,z-.43],[x,z-.28]].map(p=>wing(p,.064)),'panel',.008);
    }
    for(const [x,z]of [[4.2,-4.0],[4.8,-3.88],[5.22,-3.77]])tube(wing([x,z]),wing([x,z-.15]),.006,'dark');
  }
  // Open single F135 nozzle, 18 overlapping faceted petals and a recessed hot liner.
  function nozzlePoint(r,a,z){return [r*Math.cos(a),-.025+r*Math.sin(a),z];}
  for(let i=0;i<18;i++) {
    const a=i/18*Math.PI*2,b=(i+1)/18*Math.PI*2;
    poly([nozzlePoint(.69,a,-5.06),nozzlePoint(.69,b,-5.06),nozzlePoint(.57,b,-6.23),nozzlePoint(.57,a,-6.23)],'metal');
    poly([nozzlePoint(.55,a,-6.225),nozzlePoint(.55,b,-6.225),nozzlePoint(.48,b,-5.12),nozzlePoint(.48,a,-5.12)],'nozzle');
    tube(nozzlePoint(.69,a,-5.12),nozzlePoint(.576,a,-6.22),.009,'nozzle');
    const mid=(a+b)/2;
    poly([nozzlePoint(.69,a,-5.065),nozzlePoint(.70,mid,-4.96),nozzlePoint(.69,b,-5.065)],'panel');
  }
  const backDisk=new CylinderGeometry(.485,.485,.025,36);backDisk.rotateX(Math.PI/2);backDisk.translate(0,-.025,-5.03);bake(backDisk,'dark');
  for(let i=0;i<16;i++) {const a=i/16*Math.PI*2;tube(nozzlePoint(.12,a,-5.045),nozzlePoint(.45,a+.12,-5.045),.018,'metal');}
  const glowMaterial=new MeshBasicMaterial({color:0xfc9853,transparent:true,opacity:0,blending:AdditiveBlending,depthWrite:false,toneMapped:false,side:DoubleSide});
  const glowGeometry=new CylinderGeometry(.44,.44,.01,32);glowGeometry.rotateX(Math.PI/2);glowGeometry.translate(0,-.025,-5.08);
  const glow=new Mesh(glowGeometry,glowMaterial);glow.name='f35-engine-glow';root.add(glow);
  // Faceted electro-optical sensor underneath the nose, not a spherical turret.
  const eotsTop=[[-.28,-.50,5.93],[.28,-.50,5.93],[.30,-.57,4.99],[-.30,-.57,4.99]];
  const eotsBottom=[[-.17,-.80,5.68],[.17,-.80,5.68],[.21,-.91,5.12],[-.21,-.91,5.12]];
  for(let i=0;i<4;i++){const n=(i+1)%4;poly([eotsTop[i],eotsBottom[i],eotsBottom[n],eotsTop[n]],'sensor');tube(eotsTop[i],eotsBottom[i],.014,'panel');}
  poly(eotsBottom,'sensor',null,true);path(eotsTop,'panel',.018);path(eotsBottom,'panel',.012);
  // Six dark distributed-aperture windows, flush to upper/lower chine surfaces.
  for(const [x,z,upper]of [[0,5.93,true],[.57,5.2,false],[-.57,5.2,false],[0,-3.75,true],[.52,-4.35,false],[-.52,-4.35,false]]) {
    poly([[x-.07,z],[x,z+.12],[x+.07,z],[x,z-.12]].map(([px,pz])=>skin(px,pz,upper,.028)),'sensor',null,!upper);
    panel([[x-.09,z],[x,z+.15],[x+.09,z],[x,z-.15]],upper,.008,'panel');
  }
  // Radome boundary, lightning diverters, dorsal refuelling receptacle and service panels.
  path(ring(section(6.13)).map(([x,y,z],i)=>[x*1.013,y+.006,z+(i%2?.065:0)]),'ram',.010);
  for(const side of [-1,1]) {
    panel([[side*.10,7.4],[side*.33,6.8],[side*.54,6.35]],true,.006,'panel');
    for(const [z,w]of [[2.05,.35],[.75,.4],[-.65,.48],[-2.12,.4]]) {
      panel([[side*.52,z+.32],[side*(.52+w),z+.20],[side*(.62+w),z-.08],[side*(.52+w),z-.28],[side*.52,z-.42],[side*.40,z-.10]],true,.013);
    }
    panel([[side*1.0,2.1],[side*1.22,1.72],[side*1.36,.62],[side*1.15,.29],[side*.95,.63]],true,.011);
    panel([[side*.5,5.2],[side*.68,4.9],[side*.71,4.5],[side*.60,4.4]],false,.012);
    // Flush formation lights near the cockpit and wing root.
    poly([[side*.69,4.55],[side*.73,4.55],[side*.75,4.03],[side*.71,4.03]].map(([x,z])=>skin(x,z,true,.024)),'formation',null,side<0);
    // Louvered cooling grilles on the upper shoulders.
    for(let i=0;i<8;i++)path([[side*1.06,1.1-i*.075],[side*1.29,1.05-i*.075]].map(([x,z])=>skin(x,z,true,.020)),'dark',.012,false);
  }
  panel([[-.20,1.72],[.20,1.72],[.30,1.47],[.30,.90],[.12,.74],[-.12,.74],[-.30,.90],[-.30,1.47]],true,.015);
  poly([[-.07,1.33],[.07,1.33],[.07,1.17],[-.07,1.17]].map(([x,z])=>skin(x,z,true,.024)),'dark');
  // F-35A internal cannon fairing on the port shoulder; no ventral gun pod or lift fan.
  ellipsoid([.93,.64,2.03],[.21,.19,.72],'body');
  poly([[.77,.69,2.40],[1.06,.69,2.35],[1.08,.65,2.13],[.78,.65,2.18]],'dark');
  for(const z of [-.05,-3.1]) {
    const y=skin(0,z)[1];poly([[-.018,y,z+.18],[0,y+.17,z+.05],[.018,y+.12,z-.12],[.018,y,z-.24]],'body');
  }
  // Serrated bay doors, recessed light-coloured interiors, rails and visible game stores.
  const armament=new Group();armament.name='fighter-armament';root.add(armament);
  for(const side of [-1,1]) {
    const bay=side<0?0:1;
    const border=[[.25,2.38],[.46,2.20],[.62,2.38],[.82,2.20],[1.10,2.38],[1.10,-2.8],[.82,-2.64],[.63,-2.8],[.46,-2.64],[.25,-2.8]];
    poly([[side*.25,-.35,2.4],[side*1.1,-.35,2.4],[side*1.1,-.35,-2.8],[side*.25,-.35,-2.8]],'dark',null,side>0);
    for(const x of [.27,1.08])poly([[side*x,-.36,2.4],[side*x,-.76,2.4],[side*x,-.76,-2.8],[side*x,-.36,-2.8]],'white',null,side<0);
    const points=border.map(([x,z])=>skin(side*x,z,false,.017));
    const hinge=new Group();hinge.name=`f35-bay-door-${bay}`;hinge.position.set(side*1.1,-.72,0);root.add(hinge);
    const local=points.map(p=>p.map((v,i)=>v-hinge.position.getComponent(i)));
    poly(local,'body',hinge,side>0);poly(local.map(([x,y,z])=>[x,y+.018,z]),'white',hinge,side<0);
    path(local,'ram',.012,true,hinge);doors.push({hinge,side,bay});
    for(const z of [-2,-.5,1])tube([side*.92,-.42,z],[side*.92,-.67,z],.025,'metal');
    for(let j=0;j<2;j++) {
      const station=bay*2+j,length=2.65;
      const missile=new Group();missile.name=`fighter-missile-${station}`;missile.position.set(side*(.47+j*.38),-.55,-.18);
      missile.userData={fighterMissile:true,station,length,weaponBay:bay,ejectDrop:.75};armament.add(missile);
      const shell=new CylinderGeometry(.075,.075,length,12);shell.rotateX(Math.PI/2);add(shell,'white',missile);
      ellipsoid([0,0,length/2+.14],[.075,.075,.28],'sensor',missile);
      for(let n=0;n<4;n++) {
        const a=n*Math.PI/2;
        poly([[.07*Math.cos(a),.07*Math.sin(a),-.7],[.21*Math.cos(a),.21*Math.sin(a),-1.10],[.07*Math.cos(a),.07*Math.sin(a),-1.28]],'panel',missile);
      }
    }
  }
  // Navigation lenses and formation lighting remain legible at night.
  function light(name,position,color,radius=.038) {
    const m=new MeshBasicMaterial({color,toneMapped:false});m.name=name;
    const lens=new Mesh(new SphereGeometry(radius,10,6),m);lens.position.set(...position);lens.name=name;lens.userData.noVehicleShadow=true;root.add(lens);return lens;
  }
  light('f35-port-red',[5.32,-.035,-2.6],0xff2525);light('f35-starboard-green',[-5.32,-.035,-2.6],0x24f78c);
  light('f35-tail-white',[0,.47,-5.0],0xe4f3ff,.024);
  const strobes=[light('f35-port-strobe',[5.3,.012,-3.08],0xffffff,.025),light('f35-starboard-strobe',[-5.3,.012,-3.08],0xffffff,.025)];
  const beacon=light('f35-beacon',[0,1.04,-.5],0xff4239,.032);
  for(const [key,geometries]of batches){add(mergeGeometries(geometries),key);for(const g of geometries)g.dispose();}
  // Batch each moving part independently, preserving its hinge and missile identity.
  root.traverse(parent=>{
    if(parent===root||!parent.isGroup)return;
    const groups=new Map();
    for(const child of parent.children)if(child.isMesh){if(!groups.has(child.material))groups.set(child.material,[]);groups.get(child.material).push(child);}
    for(const [material,meshes]of groups)if(meshes.length>1){
      const gs=meshes.map(mesh=>{mesh.updateMatrix();const g=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone();g.deleteAttribute('uv');return g.applyMatrix4(mesh.matrix);});
      const joined=new Mesh(mergeGeometries(gs),material);joined.name=material.name;joined.castShadow=joined.receiveShadow=true;parent.add(joined);
      for(const mesh of meshes){mesh.removeFromParent();mesh.geometry.dispose();}for(const g of gs)g.dispose();
    }
  });
  const resources=new Set();root.traverse(node=>{if(node.geometry)resources.add(node.geometry);if(node.material)resources.add(node.material);});
  root.userData.fighterResources=[...resources];
  root.userData.fighterSurfaces=surfaces;
  root.userData.fighterLights={time:0,strobes,beacon};
  root.userData.f35={doors,bayTimers,glow,features};root.userData.dimensions=F35_DIMENSIONS;
  root.userData.landingBodyPoints=[[0,-.90,5.2],[0,-.85,0],[0,-.60,-5.7],[5.30,-.05,-2.6],[-5.30,-.05,-2.6]].map(p=>new Vector3(...p));
  return root;
}

export function openF35WeaponBay(root,bay) {
  root?.traverse(node=>{
    const state=node.userData.f35;if(!state)return;
    state.bayTimers[bay]=1.2;
    // The door is already clear when the projectile is ejected, then closes smoothly.
    for(const door of state.doors)if(door.bay===bay)door.hinge.rotation.z=door.side*1.42;
  });
}
export function updateF35(root,dt,throttle=.4) {
  root?.traverse(node=>{
    const state=node.userData.f35;if(!state)return;
    for(let i=0;i<2;i++)state.bayTimers[i]=Math.max(0,state.bayTimers[i]-dt);
    for(const door of state.doors){const target=state.bayTimers[door.bay]>0?door.side*1.42:0;door.hinge.rotation.z+=(target-door.hinge.rotation.z)*(1-Math.exp(-8*dt));}
    state.glow.material.opacity=Math.max(0,Math.min(.75,(throttle-.55)*1.8));
  });
}
