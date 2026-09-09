import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, SphereGeometry, CylinderGeometry, TorusGeometry, ShapeUtils, Vector2, Vector3 } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { AIRLINERS } from "../../shared/aircraftTypes.js";

// Meter-scale originals: +Y up, nose along -Z, matching the flight/traffic camera frame.
export function createAirliner(key = "b738") {
  const spec = AIRLINERS[key];
  if (!spec) throw new Error("Unsupported airliner");
  const airbus = key === "a320", root = new Group(); root.name = spec.name;
  root.userData.airliner = key;
  const materials = {
    body: new MeshStandardMaterial({ color: 0xf3f5f7, roughness: .43, metalness: .15 }),
    paint: new MeshStandardMaterial({ color: airbus ? 0x007f9b : 0x164c9d, roughness: .4 }),
    glass: new MeshStandardMaterial({ color: 0x11242f, roughness: .18, metalness: .3 }),
    metal: new MeshStandardMaterial({ color: 0x9ba7b0, roughness: .3, metalness: .65 }),
    intake: new MeshStandardMaterial({ color: 0x172029, roughness: .85 }),
  };
  for (const [name, material] of Object.entries(materials)) material.name = `airliner-${name}`;
  const parts = new Group(), half = spec.length / 2, radius = spec.diameter / 2;
  function add(geometry, material, x = 0, y = 0, z = 0) {
    const mesh = new Mesh(geometry, materials[material]); mesh.position.set(x, y, z); parts.add(mesh); return mesh;
  }
  // Closed, smooth body with visibly different nose profiles.
  const rings = airbus
    ? [[-1,.03],[-.985,.28],[-.945,.67],[-.87,.96],[-.75,1],[.59,1],[.78,.8],[.92,.36],[1,.015]]
    : [[-1,.02],[-.975,.18],[-.91,.58],[-.83,.94],[-.73,1],[.57,1],[.78,.76],[.93,.28],[1,.015]];
  const positions = [], indices = [], segments = 24;
  rings.forEach(([z, r]) => {
    for (let i = 0; i <= segments; i++) {
      const a = i / segments * Math.PI * 2;
      positions.push(Math.cos(a) * radius * r, Math.sin(a) * radius * r + (z > .57 ? (z - .57) * .9 : 0), z * half);
    }
  });
  for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < segments; i++) {
    const a = j * (segments + 1) + i, b = a + segments + 1;
    indices.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const body = new BufferGeometry(); body.setAttribute("position", new Float32BufferAttribute(positions, 3)); body.setIndex(indices); body.computeVertexNormals(); add(body, "body");
  function slab(outline, thickness, vertical = false) {
    if (ShapeUtils.isClockWise(outline.map(([x,z]) => new Vector2(x,z)))) outline = [...outline].reverse();
    const p = [], ids = [], count = outline.length;
    const point = ([x, z], offset) => vertical ? [offset, x, z] : [x, -.4 + Math.abs(x) * .045 + offset, z];
    for (const offset of [-thickness / 2, thickness / 2]) for (const v of outline) p.push(...point(v, offset));
    const triangles = ShapeUtils.triangulateShape(outline.map(([x,z]) => new Vector2(x,z)), []);
    for (const [a,b,c] of triangles) ids.push(c,b,a,a+count,b+count,c+count);
    for (let i=0;i<count;i++) { const j=(i+1)%count; ids.push(i,j,j+count,i,j+count,i+count); }
    if (!vertical) for (let i=0;i<ids.length;i+=3) [ids[i],ids[i+2]]=[ids[i+2],ids[i]];
    const g=new BufferGeometry(); g.setAttribute("position",new Float32BufferAttribute(p,3));g.setIndex(ids);g.computeVertexNormals();return g;
  }
  for (const side of [-1, 1]) {
    add(slab([[side*1.3,-4],[side*5,-3],[side*spec.span/2,4.7],[side*spec.span/2,6.0],[side*7,3.4],[side*1.3,5.2]], .22), "body");
    add(slab([[side*.8,half-8],[side*6.8,half-3],[side*7.1,half-1.8],[side*.8,half-3.1]], .15), "body");
    const tip=add(slab([[.4,4.7],[airbus?1.25:2.6,5.9],[airbus?1.3:2.5,6.6],[.4,6]], .10, true), "paint", side*spec.span/2,0,0);
    tip.rotation.z = side * (airbus ? -.15 : -.12);
    // Nacelle + dark inset intake + metallic rim. 737 nacelles have a flatter underside.
    const engineX=side*5.5, engineZ=airbus?-2.3:-2.9, engineRadius=airbus?1.13:1.02;
    const engine=add(new CylinderGeometry(engineRadius,engineRadius*.86,3.6,20),"body",engineX,-1.55,engineZ);
    engine.rotation.x=Math.PI/2; if(!airbus)engine.scale.z=.88;
    const inlet=add(new CylinderGeometry(engineRadius*.82,engineRadius*.82,.09,20),"intake",engineX,-1.55,engineZ-1.81);inlet.rotation.x=Math.PI/2;
    add(new TorusGeometry(engineRadius*.91,.10,6,24),"metal",engineX,-1.55,engineZ-1.83);
    const spinner=add(new SphereGeometry(.26,10,6),"metal",engineX,-1.55,engineZ-1.89);spinner.scale.z=1.5;
    add(slab([[-.9,engineZ-1],[-.9,engineZ+1.7],[-.12,engineZ+2],[-.12,engineZ-.3]],.25,true),"metal",engineX,0,0);
    // Cabin windows are merged below, so the whole row costs no extra draw calls.
    for(let z=-half+6.5;z<half-6;z+=.61){
      const w=add(new SphereGeometry(1,8,6),"glass",side*radius*.967,.48,z);w.scale.set(.055,.23,.16);
    }
    for(const z of [-half+4.9,half-5.2]) {
      const door=add(new SphereGeometry(1,8,6),"metal",side*radius*.93,.25,z);door.scale.set(.035,.9,.38);
    }
    // Slanted flight-deck glazing, with a sharper 737 windshield.
    const cockpit=add(new SphereGeometry(1,12,6),"glass",side*radius*.50,.66,-half+(airbus?2.0:3.1));cockpit.scale.set(.82,.43,airbus?.70:.87);cockpit.rotation.y=side*.28;
  }
  add(slab([[.5,half-8],[airbus?8.8:9.5,half-4.6],[airbus?9:9.6,half-2.9],[.6,half-.9]],.25,true),"paint");
  // Bake/merge all parts by material: six-ish draw calls rather than hundreds per model.
  parts.updateMatrixWorld(true);
  for (const material of Object.values(materials)) {
    const geometries=[];
    parts.traverse(node=>{if(node.isMesh&&node.material===material){const g=node.geometry.index?node.geometry.toNonIndexed():node.geometry.clone();g.deleteAttribute("uv");g.applyMatrix4(node.matrixWorld);geometries.push(g);}});
    if(geometries.length){const merged=mergeGeometries(geometries);const mesh=new Mesh(merged,material);mesh.name=material.name;root.add(mesh);for(const g of geometries)g.dispose();}
  }
  parts.traverse(node=>node.geometry?.dispose());
  root.userData.dimensions={...spec};
  return root;
}
