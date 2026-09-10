import {
  BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, SphereGeometry, CylinderGeometry, ShapeUtils, Vector2, Vector3, Color,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { AIRLINERS } from "../../shared/aircraftTypes.js";

// Original, unbranded aircraft in metres: +Y up, nose -Z. All detail is baked
// into six meshes so live traffic can instance exactly the same model.
export function createAirliner(key = "b738") {
  const spec = AIRLINERS[key];
  if (!spec) throw new Error("Unsupported airliner");
  const airbus = key === "a320" || key === "a321", embraer = key === "e195", root = new Group();
  const wingScale = embraer ? spec.span / 35.8 : 1;
  root.name = spec.name;
  root.userData.airliner = key;
  const materials = {
    body: new MeshStandardMaterial({ color: 0xf0f3f5, roughness: .36, metalness: .16 }),
    paint: new MeshStandardMaterial({ color: embraer ? 0xb94037 : key === "a321" ? 0x3155a5 : airbus ? 0x007f9b : 0x164c9d, roughness: .36, metalness: .12 }),
    glass: new MeshStandardMaterial({ color: 0x142e3e, roughness: .12, metalness: .35 }),
    metal: new MeshStandardMaterial({ color: 0x89969e, roughness: .28, metalness: .7 }),
    intake: new MeshStandardMaterial({ color: 0x1d2931, roughness: .76, metalness: .12 }),
    lights: new MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
  };
  for (const [name, material] of Object.entries(materials)) {
    material.name = `airliner-${name}`;
    material.userData.vehicleFinish = true;
  }
  const parts = new Group(), half = spec.length / 2, radius = spec.diameter / 2;
  const features = { cabinWindows: 0, doors: 0, cockpitPanes: 0, fanBlades: 0, flapFairings: 0, lights: [] };
  function add(geometry, material, x = 0, y = 0, z = 0) {
    const mesh = new Mesh(geometry, materials[material]);
    mesh.position.set(x, y, z); parts.add(mesh); return mesh;
  }
  function ellipsoid(material, center, scale, segments = 12) {
    const mesh = add(new SphereGeometry(1, segments, 8), material, ...center);
    mesh.scale.set(...scale); return mesh;
  }
  function rod(a, b, width = .014, material = "metal") {
    const start = new Vector3(...a), end = new Vector3(...b), delta = end.clone().sub(start);
    const mesh = add(new CylinderGeometry(width, width, delta.length(), 5), material);
    mesh.position.copy(start.add(end).multiplyScalar(.5));
    mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), delta.normalize());
    return mesh;
  }
  function patch(points, material = "metal", flip = false) {
    const p = [], indices = [];
    for (const point of points) p.push(...point);
    for (let i = 1; i < points.length - 1; i++) indices.push(...(flip ? [0,i+1,i] : [0,i,i+1]));
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(p, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    return add(geometry, material);
  }

  // The 737 has the longer pointed radome; the Airbus has a fuller, rounder nose.
  let rings = airbus
    ? [[-1,.025],[-.989,.20],[-.967,.41],[-.935,.66],[-.89,.88],[-.83,.985],[-.75,1],[.59,1],[.72,.90],[.83,.67],[.93,.31],[1,.015]]
    : [[-1,.015],[-.985,.105],[-.955,.27],[-.92,.46],[-.875,.70],[-.83,.90],[-.77,.99],[-.73,1],[.57,1],[.72,.89],[.83,.60],[.93,.26],[1,.015]];
  if (embraer) rings = [[-1,.045],[-.99,.19],[-.965,.43],[-.925,.68],[-.875,.9],[-.82,1],[-.74,1],[.6,1],[.74,.86],[.85,.56],[.95,.22],[1,.015]];
  if (key === "a321") rings = rings.map(([z, r]) => [z < -.5 ? -1 + (z + 1) * 37.57 / spec.length : z > .5 ? 1 - (1 - z) * 37.57 / spec.length : z, r]);
  function bodyAt(z) {
    const t = z / half;
    const index = Math.max(1, rings.findIndex(r => r[0] >= t));
    const a = rings[index - 1], b = rings[index], f = Math.max(0, Math.min(1, (t-a[0])/(b[0]-a[0])));
    return { r: radius * (a[1] + (b[1]-a[1])*f), y: Math.max(0,t-.57)*.9 };
  }
  const positions = [], indices = [], segments = 40;
  rings.forEach(([z, r]) => {
    for (let i = 0; i <= segments; i++) {
      const a = i / segments * Math.PI * 2;
      positions.push(Math.cos(a)*radius*r, Math.sin(a)*radius*r + Math.max(0,z-.57)*.9, z*half);
    }
  });
  for (let j=0;j<rings.length-1;j++) for (let i=0;i<segments;i++) {
    const a=j*(segments+1)+i,b=a+segments+1;
    indices.push(a,a+1,b,b,a+1,b+1);
  }
  const body=new BufferGeometry();
  body.setAttribute("position",new Float32BufferAttribute(positions,3)); body.setIndex(indices); body.computeVertexNormals(); add(body,"body");

  // Surface coordinates on the actual tapered fuselage, not floating spheres.
  function skin(side, y, z, offset=.026) {
    const section=bodyAt(z), dy=y-section.y;
    return [side*(Math.sqrt(Math.max(.001,section.r**2-dy**2))+offset),y,z];
  }
  function roundedOutline(cy,cz,height,width,corner=.08) {
    const points=[];
    for(const [sy,sz,start] of [[1,1,0],[1,-1,Math.PI/2],[-1,-1,Math.PI],[-1,1,Math.PI*1.5]]) {
      for(let i=0;i<=3;i++) {
        const a=start+i/3*Math.PI/2;
        points.push([cy+sy*(height/2-corner)+Math.sin(a)*corner,cz+sz*(width/2-corner)+Math.cos(a)*corner]);
      }
    }
    return points;
  }
  function skinPanel(side,outline,material="glass") {
    // Subdivide and project onto the skin: a single flat cockpit polygon would
    // sink through the curved radome even if its corners sat on the surface.
    const points=outline.map(p=>new Vector2(...p));
    if(ShapeUtils.isClockWise(points))points.reverse();
    const positions=[];
    function triangle(a,b,c,depth=0) {
      if(depth<3&&Math.max(a.distanceTo(b),b.distanceTo(c),c.distanceTo(a))>.20) {
        const ab=a.clone().add(b).multiplyScalar(.5),bc=b.clone().add(c).multiplyScalar(.5),ca=c.clone().add(a).multiplyScalar(.5);
        triangle(a,ab,ca,depth+1);triangle(ab,b,bc,depth+1);triangle(ca,bc,c,depth+1);triangle(ab,bc,ca,depth+1);
      } else for(const p of (side>0?[a,b,c]:[a,c,b]))positions.push(...skin(side,p.x,p.y));
    }
    for(const [a,b,c] of ShapeUtils.triangulateShape(points,[]))triangle(points[a],points[b],points[c]);
    const geometry=new BufferGeometry();geometry.setAttribute("position",new Float32BufferAttribute(positions,3));geometry.computeVertexNormals();return add(geometry,material);
  }
  function seam(side,outline,width=.013,material="metal",closed=true) {
    for(let i=0;i<outline.length-(closed?0:1);i++) rod(skin(side,...outline[i],.032),skin(side,...outline[(i+1)%outline.length],.032),width,material);
  }
  function windshield(side, start) {
    // Each front windshield reaches the centre mullion. Work in angular skin
    // coordinates so the forward glazing wraps from the nose crown to its side.
    const corners=[[.035,start],[.035,start+.72],[.94,start+1.10],[1.30,start+1.02]];
    function surface(theta,z,offset=.035){const section=bodyAt(z);return[side*(section.r+offset)*Math.sin(theta),section.y+(section.r+offset)*Math.cos(theta),z];}
    function point(u,v){
      const left=corners[0].map((x,i)=>x+(corners[1][i]-x)*v),right=corners[3].map((x,i)=>x+(corners[2][i]-x)*v);
      return surface(left[0]+(right[0]-left[0])*u,left[1]+(right[1]-left[1])*u);
    }
    for(let u=0;u<8;u++)for(let v=0;v<6;v++)patch([point(u/8,v/6),point((u+1)/8,v/6),point((u+1)/8,(v+1)/6),point(u/8,(v+1)/6)],"glass",side>0);
    for(let i=0;i<4;i++)for(let step=0;step<8;step++){
      const a=corners[i],b=corners[(i+1)%4],at=t=>surface(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,.042);
      rod(at(step/8),at((step+1)/8),.012,"body");
    }
  }
  function slab(outline, thickness, vertical = false, yOffset=0) {
    if (!vertical && embraer) outline = outline.map(([x,z]) => [x * wingScale, z]);
    if(ShapeUtils.isClockWise(outline.map(([x,z])=>new Vector2(x,z)))) outline=[...outline].reverse();
    const p=[],ids=[],count=outline.length;
    const point=([x,z],offset)=>vertical?[offset,x,z]:[x,-.4+Math.abs(x)*.045+offset+yOffset,z];
    for(const offset of [-thickness/2,thickness/2])for(const v of outline)p.push(...point(v,offset));
    for(const [a,b,c] of ShapeUtils.triangulateShape(outline.map(([x,z])=>new Vector2(x,z)),[])) ids.push(c,b,a,a+count,b+count,c+count);
    for(let i=0;i<count;i++){const j=(i+1)%count;ids.push(i,j,j+count,i,j+count,i+count);}
    if(!vertical)for(let i=0;i<ids.length;i+=3)[ids[i],ids[i+2]]=[ids[i+2],ids[i]];
    const g=new BufferGeometry();g.setAttribute("position",new Float32BufferAttribute(p,3));g.setIndex(ids);g.computeVertexNormals();return g;
  }
  function wingPoint(side,x,z,offset=.13){return [side*x*wingScale,-.4+x*wingScale*.045+offset,z];}
  function light(position,color,label,size=.09) {
    const geometry=new SphereGeometry(size,8,5), rgb=new Color(color), colors=[];
    for(let i=0;i<geometry.attributes.position.count;i++) colors.push(rgb.r,rgb.g,rgb.b);
    geometry.setAttribute("color",new Float32BufferAttribute(colors,3)); add(geometry,"lights",...position);
    features.lights.push({label,position,color});
  }
  // Wing/body fairing, gently blended into the belly, never lower than nacelles.
  ellipsoid("body",[0,-.85,.7],[radius*1.22,embraer?.65:.92,embraer?4.8:6]);
  const wingTip=35.8/2-(airbus?.453:.361);
  for(const side of [-1,1]) {
    add(slab([[side*1.3,-4],[side*5,-3],[side*wingTip,4.7],[side*wingTip,6],[side*7,3.4],[side*1.3,5.2]],.22),"body");
    add(slab([[side*.8,half-8],[side*6.8,half-3],[side*7.1,half-1.8],[side*.8,half-3.1]],.15),"body");
    const tip=add(slab([[.4,4.7],[embraer?2.15:airbus?2.65:2.6,5.9],[embraer?2.2:airbus?2.7:2.5,6.6],[.4,6]],.10,true),"paint",side*wingTip*wingScale);
    tip.rotation.z=side*(airbus?-.15:-.12);
    // Polished leading edges, aileron/flap divisions and upper-wing spoilers.
    for(const [a,b] of [[[1.8,-3.85],[5,-2.95]],[[5,-2.95],[17.5,4.5]]]) rod(wingPoint(side,...a),wingPoint(side,...b),.045);
    for(const [a,b] of [[[2.1,3.65],[7,2.65]],[[7,2.65],[13,4.05]],[[13,4.05],[17.5,5.3]],[[7,2.65],[7,3.4]],[[13,4.05],[13,4.85]]]) rod(wingPoint(side,...a),wingPoint(side,...b),.013);
    for(let x=4;x<11;x+=1.8) {
      const z=1+(x-4)*.29, outline=[[x,z],[x+1.45,z+.44],[x+1.45,z+1.12],[x,z+.68]];
      for(let i=0;i<4;i++)rod(wingPoint(side,...outline[i]),wingPoint(side,...outline[(i+1)%4]),.011);
    }
    for(const [x,z] of [[4.2,3.7],[7.8,3.75],[11.2,4.5]]) {
      ellipsoid("body",[side*x*wingScale,-.48+x*wingScale*.045,z],[.18,.23,1.05]); features.flapFairings++;
    }
    rod(wingPoint(side,1,half-3.65,.10),wingPoint(side,6.7,half-2.25,.10),.013);

    const engineX=side*(embraer?4.4:5.5), engineZ=embraer?-1.8:airbus?-2.3:-2.9, engineY=embraer?-1.25:-1.55, engineRadius=embraer?.79:airbus?1.13:1.02;
    const engineShape=(r,a)=>[Math.cos(a)*r,(airbus||embraer)?Math.sin(a)*r:Math.max(-.80*r,Math.sin(a)*r)];
    function nacelle(profile,material) {
      const p=[],ids=[],n=32;
      for(const [z,r] of profile)for(let i=0;i<=n;i++){const [x,y]=engineShape(r,i/n*Math.PI*2);p.push(engineX+x,engineY+y,engineZ+z);}
      for(let j=0;j<profile.length-1;j++)for(let i=0;i<n;i++){const a=j*(n+1)+i,b=a+n+1;ids.push(a,a+1,b,b,a+1,b+1);}
      const g=new BufferGeometry();g.setAttribute("position",new Float32BufferAttribute(p,3));g.setIndex(ids);g.computeVertexNormals();add(g,material);
    }
    nacelle([[-1.80,engineRadius*.92],[-1.62,engineRadius],[-.4,engineRadius*1.015],[.8,engineRadius*.90],[1.8,engineRadius*.72]],"body");
    // Rolled metal lip with an inward-facing throat and recessed visible fan.
    nacelle([[-1.56,engineRadius],[-1.8,engineRadius*.94],[-1.85,engineRadius*.87],[-1.79,engineRadius*.80],[-1.38,engineRadius*.77]],"metal");
    nacelle([[-1.38,engineRadius*.77],[-1.79,engineRadius*.80]],"intake");
    const fanZ=engineZ-1.40, fanRadius=engineRadius*.76;
    const disk=add(new CylinderGeometry(fanRadius,fanRadius,.025,32),"intake",engineX,engineY,fanZ+.035);disk.rotation.x=Math.PI/2;
    for(let blade=0;blade<24;blade++) {
      const a=blade/24*Math.PI*2;
      const bladePoint=(r,angle,z)=>[engineX+Math.cos(angle)*r,engineY+Math.sin(angle)*r,fanZ+z];
      patch([bladePoint(.23,a,0),bladePoint(fanRadius*.98,a+.10,0),bladePoint(fanRadius*.99,a+.23,.025),bladePoint(.23,a+.21,.035)],"metal",true);
      features.fanBlades++;
    }
    ellipsoid("metal",[engineX,engineY,fanZ-.07],[.24,.24,.30]);
    nacelle([[1.55,engineRadius*.75],[1.82,engineRadius*.72],[1.85,engineRadius*.63],[1.65,engineRadius*.61]],"metal");
    const exhaust=add(new CylinderGeometry(engineRadius*.61,engineRadius*.61,.03,24),"intake",engineX,engineY,engineZ+1.69);exhaust.rotation.x=Math.PI/2;
    ellipsoid("metal",[engineX,engineY,engineZ+1.69],[.32,.32,.48]);
    add(slab([[-.9,engineZ-1],[-.9,engineZ+1.7],[-.12,engineZ+2],[-.12,engineZ-.3]],.25,true),"body",engineX);
    const join=[];for(let i=0;i<=32;i++){const [x,y]=engineShape(engineRadius*1.019,i/32*Math.PI*2);join.push([engineX+x,engineY+y,engineZ-.4]);}
    for(let i=0;i<join.length-1;i++)rod(join[i],join[i+1],.012);

    const doorZ=key === "a321" ? [-half+5.1,-7.3,7.5,half-5.25] : [-half+5.1,half-5.25];
    const exitZ=key === "a321" ? [] : embraer ? [.1] : airbus?[-.2,1.0]:[-.65,.6];
    for(let z=-half+6.35;z<half-6;z+=embraer?.80:airbus?.78:.61) {
      if(exitZ.some(e=>Math.abs(z-e)<.42) || doorZ.some(e=>Math.abs(z-e)<.64))continue;
      skinPanel(side,roundedOutline(.48,z,.45,.29,.085));features.cabinWindows++;
    }
    for(const z of doorZ) {
      const outline=roundedOutline(.05,z,1.83,.83,.18);seam(side,outline);features.doors++;
      skinPanel(side,roundedOutline(.55,z,.32,.22,.06));
      seam(side,[[.05,z-.18],[.05,z+.05]],.024,"metal",false);
      seam(side,[[-.58,z-.26],[-.58,z+.26]],.018,"paint",false);
    }
    for(const z of exitZ) {
      seam(side,roundedOutline(.18,z,1.10,.58,.10)); features.doors++;
      skinPanel(side,roundedOutline(.46,z,.37,.25,.06));
    }
    if(side===1)for(const z of [-7.6,8.1])seam(side,roundedOutline(-.86,z,1.12,2.1,.14),.012);
    // Six flight-deck panes conform to each type's radome and have pale frames.
    const cockpitStart=-half+(airbus?2.4:3.2);
    const panes=airbus
      ? [[[.43,.89],[1.06,1.02],[1.07,1.76],[.43,1.82]],[[.43,1.91],[1.07,1.86],[.92,2.38],[.43,2.41]]]
      : [[[.46,.81],[1.10,.93],[1.11,1.56],[.47,1.66]],[[.47,1.75],[1.1,1.66],[.90,2.23],[.47,2.28]]];
    windshield(side,cockpitStart-.22);features.cockpitPanes++;
    for(const pane of (embraer ? panes.slice(0,1) : panes)){const outline=pane.map(([y,z])=>[y,cockpitStart+z]);skinPanel(side,outline);seam(side,outline,.023,"body");features.cockpitPanes++;}
    seam(side,[[.42,cockpitStart+.2],[.60,cockpitStart+.62]],.017,"intake",false);
    const probe=skin(side,.04,cockpitStart+1.4,.065);rod(probe,[probe[0]+side*.16,probe[1],probe[2]-.48],.018);
    // Subtle unbranded stripe follows the curved lower fuselage.
    const stripe=[];for(let z=-half+5.6;z<=half-5.6;z+=.3)stripe.push(z);
    for(let i=0;i<stripe.length-1;i++)skinPanel(side,[[-.32,stripe[i]],[-.22,stripe[i]],[-.22,stripe[i+1]],[-.32,stripe[i+1]]],"paint");
    light([side*(wingTip-.06)*wingScale,.47,5.32],side<0?0xff3535:0x48ff9a,side<0?"port-red":"starboard-green");
    light([side*2.25,-.22,-3.74],0xfff4de,"landing-light",.105);
  }
  add(slab([[.5,half-8],[embraer?7.25:airbus?8.8:9.5,half-4.6],[embraer?7.5:airbus?9:9.6,half-2.9],[.6,half-.9]],.25,true),"paint");
  for(const side of [-1,1]) {
    rod([side*.139,1.15,half-1.6],[side*.139,embraer?7.0:airbus?8.45:9.0,half-3.2],.018,"intake");
    patch([[side*.143,4.6,half-5.05],[side*.143,6.1,half-4.47],[side*.143,6.1,half-3.48],[side*.143,4.6,half-3.06]],"body",side<0);
  }
  for(const z of [-7,5])add(slab([[radius-.03,z-.3],[radius+.46,z-.07],[radius+.36,z+.28],[radius-.03,z+.36]],.055,true),"body");
  light([0,radius+.08,1.5],0xff3932,"upper-beacon",.10);
  light([0,-radius-.04,1.5],0xff3932,"lower-beacon",.08);
  light([0,.5,half-.13],0xf6f6ff,"tail-white",.065);
  const apu=add(new CylinderGeometry(.105,.105,.08,12),"intake",0,.385,half-.08);apu.rotation.x=Math.PI/2;

  parts.updateMatrixWorld(true);
  for(const material of Object.values(materials)) {
    const geometries=[];
    parts.traverse(node=>{
      if(!node.isMesh||node.material!==material)return;
      const g=node.geometry.index?node.geometry.toNonIndexed():node.geometry.clone();
      g.deleteAttribute("uv");g.applyMatrix4(node.matrixWorld);geometries.push(g);
    });
    if(geometries.length){
      const merged=mergeGeometries(geometries), mesh=new Mesh(merged,material);
      mesh.name=material.name;mesh.castShadow=material!==materials.lights;mesh.receiveShadow=true;
      if(material===materials.lights)mesh.userData.noVehicleShadow=true;
      root.add(mesh);for(const g of geometries)g.dispose();
    }
  }
  parts.traverse(node=>node.geometry?.dispose());
  root.userData.dimensions={...spec};
  root.userData.aircraftDetails=features;
  return root;
}
