import {
  BoxGeometry, CatmullRomCurve3, CircleGeometry, CylinderGeometry, DoubleSide,
  ExtrudeGeometry, Group, MathUtils, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  RingGeometry, Shape, SphereGeometry, TubeGeometry, Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

function armourGeometry(width, height, depth, cut = 0.15) {
  const w = width / 2, d = depth / 2, r = Math.min(cut, w * 0.6, d * 0.6);
  const shape = new Shape();
  shape.moveTo(-w + r, -d);
  shape.lineTo(w - r, -d); shape.lineTo(w, -d + r);
  shape.lineTo(w, d - r); shape.lineTo(w - r, d);
  shape.lineTo(-w + r, d); shape.lineTo(-w, d - r);
  shape.lineTo(-w, -d + r); shape.closePath();
  const geometry = new ExtrudeGeometry(shape, {
    depth: height, bevelEnabled: true, bevelSegments: 1, steps: 1,
    bevelSize: 0.035, bevelThickness: 0.035,
  });
  geometry.translate(0, 0, -height / 2);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function mergeBody(body) {
  body.updateMatrixWorld(true);
  const batches = new Map(), original = new Set();
  body.traverse(mesh => {
    if (!mesh.isMesh) return;
    let geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    if (geometry.index) {
      const indexed = geometry;
      geometry = indexed.toNonIndexed(); indexed.dispose();
    }
    if (!batches.has(mesh.material)) batches.set(mesh.material, []);
    batches.get(mesh.material).push(geometry);
    original.add(mesh.geometry);
  });
  body.clear();
  for (const geometry of original) geometry.dispose();
  for (const [material, geometries] of batches) {
    const merged = mergeGeometries(geometries);
    for (const geometry of geometries) geometry.dispose();
    const mesh = new Mesh(merged, material);
    mesh.castShadow = mesh.receiveShadow = true;
    body.add(mesh);
  }
}

// Original procedural quadrotor, built from the supplied visual references.
// Front is -Z, matching the simulator's flight convention.
export function createCombatDrone() {
  const drone = new Group(); drone.name = "combat-drone";
  const body = new Group(); drone.add(body);
  let buildParent = body;
  const mat = (name, color, metalness = 0.35, roughness = 0.4, extra = {}) =>
    new MeshStandardMaterial({ name, color, metalness, roughness, ...extra });
  const frame = mat("drone-frame", 0x454d4d);
  const panel = mat("drone-armour", 0x687174);
  const dark = mat("rubber-drone", 0x252e30, 0.1, 0.7);
  const steel = mat("metal-drone", 0x969fa2, 0.75, 0.25);
  const gunMetal = mat("metal-drone-guns", 0x555f61, 0.65, 0.32);
  const brass = mat("metal-ammunition", 0xb48b43, 0.6, 0.36);
  const black = mat("rubber-muzzle", 0x080c0e, 0.1, 0.85);
  const glass = mat("glass-drone-camera", 0x183d50, 0.4, 0.12);
  const red = mat("drone-red-lamps", 0xff5353, 0.1, 0.25, { emissive: 0xff1218, emissiveIntensity: 2 });
  const cable = mat("rubber-cables", 0x14191d, 0.05, 0.8);

  function part(geometry, material, x, y, z, parent = buildParent) {
    const mesh = new Mesh(geometry, material); mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  const block = (w,h,d,material,x,y,z,cut) => part(armourGeometry(w,h,d,cut),material,x,y,z);
  const cylinder = (r1,r2,h,material,x,y,z) => part(new CylinderGeometry(r1,r2,h,24),material,x,y,z);
  function beam(a, b, width, height, material) {
    const start = new Vector3(...a), end = new Vector3(...b), mid = start.clone().add(end).multiplyScalar(.5);
    const mesh = block(width,height,start.distanceTo(end),material,mid.x,mid.y,mid.z,.1);
    mesh.quaternion.setFromUnitVectors(new Vector3(0,0,1),end.sub(start).normalize());
    return mesh;
  }
  function wire(points) {
    part(new TubeGeometry(new CatmullRomCurve3(points.map(p=>new Vector3(...p))),16,.022,6,false),cable,0,0,0);
  }

  block(2.05,.5,2.15,frame,0,0,0,.48);
  block(1.82,.12,1.96,panel,0,.33,0,.4);
  cylinder(.72,.78,.07,dark,0,.44,0);
  cylinder(.61,.65,.09,panel,0,.5,0);
  cylinder(.41,.43,.035,frame,0,.565,0);
  block(1.45,.32,1.35,dark,0,-.41,.1,.3);
  block(.92,.3,.5,frame,0,-.54,-.62,.13);
  block(.68,.23,.06,panel,0,.04,-1.12,.1);
  block(.48,.12,.025,dark,0,.04,-1.18,.05);
  block(.55,.48,.53,frame,0,-.81,-.7,.07);
  block(.32,.25,.035,black,0,-.84,-1.01,.02);
  const lens = cylinder(.105,.105,.045,glass,0,-.84,-1.047); lens.rotation.x=Math.PI/2;
  for(const s of [-1,1]) {
    for(let i=0;i<5;i++) block(.055,.025,.58,dark,s*(.58+i*.07),.417,.13,.01);
    for(const z of [-.75,.75]) cylinder(.04,.04,.025,steel,s*.67,.428,z);
  }

  const rotors = [];
  const bladeShape = new Shape();
  bladeShape.moveTo(.17,-.07); bladeShape.bezierCurveTo(.5,-.1,1.2,-.12,1.53,.05);
  bladeShape.quadraticCurveTo(1.59,.12,1.43,.18);
  bladeShape.bezierCurveTo(1.1,.22,.55,.18,.17,.065); bladeShape.closePath();
  const bladeGeometry = new ExtrudeGeometry(bladeShape,{depth:.028,bevelEnabled:false,steps:1});
  bladeGeometry.rotateX(-Math.PI/2);
  const bladeMaterial = mat("metal-drone-blades",0x748087,.55,.35);
  const blurMaterial = new MeshBasicMaterial({color:0xaab9bf,transparent:true,opacity:.08,side:DoubleSide,depthWrite:false});
  for(const [index,[sx,sz]] of [[-1,-1],[1,-1],[-1,1],[1,1]].entries()) {
    const x=sx*2.43,z=sz*2.18;
    beam([sx*.68,.1,sz*.68],[x,.5,z],.48,.26,frame);
    beam([sx*.8,.29,sz*.8],[x,.69,z],.31,.04,panel);
    beam([sx*1.04,.14,sz*1.01],[x*.94,.51,z*.94],.055,.035,dark);
    block(.65,.28,.69,frame,x,.52,z,.16);
    cylinder(.25,.29,.18,dark,x,.79,z);
    cylinder(.38,.39,.25,steel,x,1.0,z);
    cylinder(.31,.36,.09,panel,x,1.18,z);
    cylinder(.22,.25,.035,steel,x,1.245,z);
    cylinder(.105,.105,.045,dark,x,1.282,z);
    const rotor=new Group();rotor.name="drone-propeller-pair";rotor.position.set(x,1.11,z);drone.add(rotor);
    for(const angle of [0,Math.PI]) {
      const blade=part(bladeGeometry,bladeMaterial,0,0,0,rotor);blade.rotation.y=angle;
    }
    const blur=new Mesh(new CircleGeometry(1.53,48),blurMaterial);
    blur.userData.noVehicleShadow=true;
    blur.rotation.x=-Math.PI/2;blur.position.y=.015;blur.visible=false;rotor.add(blur);
    rotor.rotation.y=index*.71;
    rotors.push({rotor,blur,direction:sx*sz});
    block(.25,.38,.28,dark,x*.83,-.05,z*.84,.045);
  }

  const cannons = [];
  for(const s of [-1,1]) {
    const x=s*1.35;
    block(.25,.53,.45,steel,s*.98,-.51,.2,.05);
    const mount=cylinder(.24,.24,.27,frame,x,-.71,.13);mount.rotation.z=Math.PI/2;
    // Keep each gun housing fixed below its mount; only the barrel group spins.
    const pod = new Group(); drone.add(pod); buildParent = pod;
    block(.96,.7,1.35,frame,x,-1.03,.12,.16);
    block(1.08,.28,.8,panel,x,-.78,.37,.15);
    block(.77,.34,.74,panel,x,-1.12,.86,.12);
    block(.7,.18,.56,dark,x,-.67,.34,.08);
    block(.55,.035,.25,steel,x,-.57,.42,.03);
    const feed=block(.31,.56,.61,brass,x-s*.49,-.94,-.25,.055);feed.rotation.z=s*.23;
    for(let i=0;i<4;i++) block(.055,.32,.64,frame,x-s*.49+i*s*.062,-.93,-.25,.012);
    const jacket=cylinder(.39,.42,.75,gunMetal,x,-1.04,-.81);jacket.rotation.x=Math.PI/2;
    const rearCollar=cylinder(.43,.43,.15,steel,x,-1.04,-1.13);rearCollar.rotation.x=Math.PI/2;
    const turret = new Group(); turret.name = "drone-cannon-turret";
    const guns=new Group();guns.name="drone-rotary-barrels";guns.position.set(0,0,-1.31);turret.add(guns);
    const muzzles = [];
    for(let i=0;i<6;i++) {
      const a=i*Math.PI/3,bx=Math.cos(a)*.265,by=Math.sin(a)*.265;
      const tube=part(new CylinderGeometry(.073,.073,1.6,12,1,true),gunMetal,bx,by,-.79,guns);tube.rotation.x=Math.PI/2;
      const bore=part(new CircleGeometry(.058,12),black,bx,by,-1.596,guns);bore.rotation.y=Math.PI;
      const rim=part(new RingGeometry(.057,.08,16),steel,bx,by,-1.606,guns);rim.rotation.y=Math.PI;
      const muzzle = new Group(); muzzle.name = "drone-cannon-muzzle";
      muzzle.position.set(bx,by,-1.61); guns.add(muzzle); muzzles.push(muzzle);
    }
    for(const z of [-.22,-1.04,-1.51]) {
      const collar=part(new CylinderGeometry(.36,.36,.075,20,1,true),steel,0,0,z,guns);collar.rotation.x=Math.PI/2;
      for(let i=0;i<3;i++){const a=i*Math.PI*2/3;part(new BoxGeometry(.07,.08,.065),dark,Math.cos(a)*.36,Math.sin(a)*.36,z,guns);}
    }
    block(.55,.15,.5,panel,x,-.65,-.94,.08);
    part(new SphereGeometry(.063,12,8),red,x+s*.18,-.66,-1.22);
    mergeBody(pod);
    pod.position.set(-x,1.04,-.13); turret.add(pod);
    turret.position.set(x,-1.04,.13); drone.add(turret);
    cannons.push({ turret, barrels: guns, muzzles });
    buildParent = body;
    for(let i=0;i<3;i++) wire([[s*.75,-.3,-.3],[s*(.92+i*.075),-.65,-.48],[x-s*.15,-.78,-.67]]);
    wire([[s*.88,-.2,.47],[s*1.02,-.69,.67],[x,-.73,.6]]);
  }
  mergeBody(body);
  drone.userData.combatDrone = {rotors, bladeMaterial, cannons};
  return drone;
}

export function updateCombatDrone(root, dt, throttle = 0, flying = false) {
  if (!root) return;
  if (!root.userData.droneParts) {
    const parts=[];
    root.traverse(node=>{if(node.userData.combatDrone)parts.push(node.userData.combatDrone);});
    root.userData.droneParts=parts;
  }
  for(const drone of root.userData.droneParts) {
    for(const {rotor,blur,direction} of drone.rotors) {
      rotor.rotation.y += direction * dt * (flying ? 80 + MathUtils.clamp(throttle,0,1)*140 : .7);
      blur.visible=flying;
    }
  }
}

export function disposeCombatDrone(root) {
  const models=[];
  root?.traverse(node=>{if(node.userData.combatDrone)models.push(node);});
  for(const model of models) {
    const resources=new Set();
    model.traverse(node=>{if(node.isMesh){resources.add(node.geometry);resources.add(node.material);}});
    for(const resource of resources)resource.dispose();
    delete model.userData.combatDrone;
  }
  if(root)delete root.userData.droneParts;
}
