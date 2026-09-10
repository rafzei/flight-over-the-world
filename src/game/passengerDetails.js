import {
  Color, EdgesGeometry, Float32BufferAttribute, Group,
  LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshBasicMaterial, SphereGeometry,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const CIVIL_TYPES = new Set(["pa28", "q400", "citation"]);
const Q400_PANELS = new Set([0,1,2,3,4,5,6,7,10,11,25,26]);

// Keep the authored UVs, geometry, named propellers and PA-28 wheel positions.
// The imported models already contain doors, flaps and glazing: bringing those
// surfaces out is more faithful than covering them with generic replacements.
export function preparePassengerDetails(model, key) {
  if (!CIVIL_TYPES.has(key) || model.userData.passengerDetails) return model;
  const root = new Group(); root.name = "passenger-details";
  const finishes = new Map(), edges = [], lights = [], replacedMaterials = new Set();
  const meshes = [];
  model.updateMatrixWorld(true);
  const inverse = new Matrix4().copy(model.matrixWorld).invert();
  model.traverse(node => { if (node.isMesh) meshes.push(node); });
  let panels = 0, glazing = 0;

  function finish(source, role) {
    const id = `${source.uuid}:${role}`;
    if (finishes.has(id)) return finishes.get(id);
    const material = source.clone();
    replacedMaterials.add(source);
    material.name = `passenger-${role}-${source.name}`;
    material.userData.vehicleFinish = true;
    material.envMapIntensity = role === "glass" ? 1.35 : .9;
    material.metalness = role === "metal" ? .78 : role === "glass" ? .3 : role === "rubber" ? .02 : .12;
    material.roughness = role === "glass" ? .13 : role === "metal" ? .24 : role === "rubber" ? .83 : .38;
    if (role === "glass") {
      material.color.setHex(0x284958);
      // Preserve any authored alpha/UV texture and interior geometry.
      material.opacity = Math.max(.84, material.opacity);
    }
    if (role === "red" || role === "green" || role === "lamp") {
      const color = role === "red" ? 0xff342c : role === "green" ? 0x25f593 : 0xfff0d1;
      material.color.setHex(color); material.emissive.setHex(color); material.emissiveIntensity = .85;
      material.roughness = .2; material.toneMapped = false;
    }
    finishes.set(id, material); return material;
  }
  for (const mesh of meshes) {
    const name = mesh.name.toLowerCase();
    const materialList = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const prepared = materialList.map(material => {
      if (!material?.isMeshStandardMaterial) return material;
      const materialName = material.name.toLowerCase();
      let role = "paint";
      if (/glass|vitre/.test(name) || /windows/.test(materialName)) { role = "glass"; glazing++; }
      else if (/lampered|beacon/.test(name)) role = "red";
      else if (/lampegreen/.test(name)) role = "green";
      else if (name === "projo") role = "lamp";
      else if (/roue|prop|helice/.test(name)) role = "rubber";
      else if (/heater|nozzle|fan|handle|pitot|antenne|axe|articule/.test(name) || /chrome/.test(materialName)) role = "metal";
      return finish(material, role);
    });
    mesh.material = Array.isArray(mesh.material) ? prepared : prepared[0];
    const q400Part = name === "rootnode_mesh" ? 0 : Number(name.match(/^rootnode_mesh_(\d+)$/)?.[1]);
    const panel = key === "q400" ? Q400_PANELS.has(q400Part)
      : key === "pa28" ? /^(aileron[gd]|volet[gd]|porteg|direction)$/.test(name)
        : /^(cabin_door|aft_baggagedoor|front_baggagedoor_[lr]h|[lr]haileron|[lr]helevator|[lr]hflap|rudder)$/.test(name);
    if (panel) {
      const edge = new EdgesGeometry(mesh.geometry, 24);
      edge.applyMatrix4(new Matrix4().multiplyMatrices(inverse, mesh.matrixWorld));
      edges.push(edge); panels++;
    }
  }
  // A single line draw call for authored access-panel and control-surface edges.
  if (edges.length) {
    const geometry = mergeGeometries(edges);
    const lines = new LineSegments(geometry, new LineBasicMaterial({ color: 0x263948, transparent: true, opacity: .40 }));
    lines.name = "passenger-panel-seams"; root.add(lines);
    for (const edge of edges) edge.dispose();
  }
  function lamp(position, color, label, size=.05) {
    const geometry = new SphereGeometry(size, 8, 5), tint = new Color(color), colors = [];
    geometry.translate(...position);
    for(let i=0;i<geometry.attributes.position.count;i++)colors.push(tint.r,tint.g,tint.b);
    geometry.setAttribute("color", new Float32BufferAttribute(colors,3));
    lights.push({ geometry, label, position, color });
  }
  // Positions are in each GLB's Y-up model frame and remain inside its original
  // extent, so normalisation and landing collision clearances do not change.
  if (key === "q400") {
    lamp([-14.08,4.13,1.65],0xff3535,"port-red");
    lamp([14.17,4.13,1.65],0x48ff9a,"starboard-green");
    lamp([.046,8.04,17.89],0xfff4de,"tail-white");
    lamp([.046,3.80,1.1],0xff3535,"upper-beacon",.045);
  }
  if (key === "citation") {
    lamp([-7.715,.91,.80],0xff3535,"port-red",.035);
    lamp([7.768,.91,.80],0x48ff9a,"starboard-green",.035);
  }
  if (lights.length) {
    const geometry = mergeGeometries(lights.map(light=>light.geometry));
    const mesh = new Mesh(geometry, new MeshBasicMaterial({ vertexColors:true, toneMapped:false }));
    mesh.name = "passenger-navigation-lights"; mesh.userData.noVehicleShadow = true; root.add(mesh);
    for (const light of lights) light.geometry.dispose();
  }
  model.add(root);
  // Textures stay shared with the replacements and are disposed by the ordinary
  // model resource walk; unused source material instances need no GPU lifetime.
  for (const material of replacedMaterials) material.dispose();
  model.userData.passengerDetails = { key, panels, glazing, lights: lights.map(({geometry,...light})=>light) };
  return model;
}

export function passengerType(spec) {
  const match = String(spec.file ?? "").match(/(?:^|\/)(pa28|q400|citation)\.glb(?:[?#]|$)/);
  return match?.[1] ?? null;
}
