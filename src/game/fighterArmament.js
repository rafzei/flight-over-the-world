import {
  BoxGeometry, BufferGeometry, ConeGeometry, CylinderGeometry, DoubleSide,
  Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, TorusGeometry,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Visual loadout in jet.glb coordinates: nose +Z. Geometry is batched by
// material, keeping the menu and multiplayer versions inexpensive to draw.
export function attachFighterArmament(model, resources) {
  // Replace the GLB's four plain underwing stores, including their end caps,
  // while preserving the radome, fuselage and wing skin in those same meshes.
  const stockMeshes = [];
  model.traverse((mesh) => {
    if (mesh.isMesh && ["fighter-airframe", "78909C", "1A1A1A"].includes(mesh.material?.name)) stockMeshes.push(mesh);
  });
  for (const mesh of stockMeshes) {
    const source = mesh.geometry;
    const position = source.attributes.position;
    const kept = [];
    let removed = false;
    for (let i = 0; i < (source.index?.count ?? position.count); i += 3) {
      const triangle = [0, 1, 2].map((j) => source.index ? source.index.getX(i + j) : i + j);
      const store = triangle.every((index) => {
        const x = Math.abs(position.getX(index));
        return x > 1.75 && x < 3.3 && position.getY(index) < 0.06;
      });
      if (store) removed = true;
      else kept.push(...triangle);
    }
    if (!removed) continue;
    const geometry = new BufferGeometry();
    for (const [name, attribute] of Object.entries(source.attributes)) {
      const values = [];
      for (const index of kept) for (let k = 0; k < attribute.itemSize; k++) values.push(attribute.getComponent(index, k));
      geometry.setAttribute(name, new Float32BufferAttribute(values, attribute.itemSize));
    }
    mesh.geometry = geometry;
    const index = resources.indexOf(source);
    if (index >= 0) resources.splice(index, 1);
    source.dispose();
    resources.push(geometry);
  }
  const group = new Group();
  group.name = "fighter-armament";
  const batches = new Map();
  let targetBatches = batches;
  function flush(parts, parent, origin = [0, 0, 0]) {
    for (const [mat, geometries] of parts) {
      if (!geometries.length) continue;
      const geometry = mergeGeometries(geometries);
      geometry.translate(-origin[0], -origin[1], -origin[2]);
      for (const source of geometries) source.dispose();
      const mesh = new Mesh(geometry, mat);
      mesh.name = mat.name;
      mesh.castShadow = mesh.receiveShadow = true;
      parent.add(mesh);
      resources.push(geometry);
    }
  }
  function material(name, color, metalness = 0.3, roughness = 0.45) {
    const mat = new MeshStandardMaterial({ color, metalness, roughness, side: DoubleSide });
    mat.name = name;
    mat.userData.vehicleFinish = true;
    batches.set(mat, []);
    resources.push(mat);
    return mat;
  }
  const shell = material("fighter-missile-shell", 0xc4c9c7);
  const fins = material("fighter-missile-fins", 0x687884);
  const trim = material("fighter-weapon-mount", 0x344653, 0.45);
  const steel = material("fighter-cannon-metal", 0x7c858b, 0.7, 0.3);
  const dark = material("fighter-weapon-recess", 0x131b22, 0.1, 0.8);
  const band = material("fighter-missile-marking", 0xd1ac58, 0.2);
  function add(geometry, mat, x, y, z) {
    const source = geometry.index ? geometry.toNonIndexed() : geometry;
    if (source !== geometry) geometry.dispose();
    // Match attributes for primitives and the custom flat fin shapes.
    source.deleteAttribute("uv");
    source.translate(x, y, z);
    if (!targetBatches.has(mat)) targetBatches.set(mat, []);
    targetBatches.get(mat).push(source);
  }
  function cylinder(radius, length, mat, x, y, z, openEnded = false) {
    const geometry = new CylinderGeometry(radius, radius, length, 12, 1, openEnded);
    geometry.rotateX(Math.PI / 2);
    add(geometry, mat, x, y, z);
  }
  function fin(mat, x, y, z, angle, radius, chord) {
    const points = [0.065, 0, chord * 0.5, radius, 0, -chord * 0.3, 0.065, 0, -chord * 0.5];
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(points, 3));
    geometry.computeVertexNormals();
    geometry.rotateZ(angle);
    add(geometry, mat, x, y, z);
  }
  let station = 0;
  for (const side of [-1, 1]) {
    for (const [x, z, length] of [[2.18, -0.9, 2.7], [2.99, -1.2, 2.25]]) {
      const px = side * x, py = -0.47;
      // Mount, rail, clamps and a complete missile below the fixed wing skin.
      add(new BoxGeometry(0.1, 0.38, 0.62), trim, px, -0.025, z);
      add(new BoxGeometry(0.14, 0.065, 1.12), steel, px, -0.25, z);
      for (const dz of [-0.36, 0.36]) add(new BoxGeometry(0.18, 0.14, 0.1), trim, px, -0.34, z + dz);
      // Keep each missile separate from its rail so a launch can empty this station.
      const missile = new Group();
      missile.name = `fighter-missile-${station}`;
      missile.position.set(px, py, z);
      missile.userData.fighterMissile = true;
      missile.userData.station = station++;
      missile.userData.length = length;
      group.add(missile);
      targetBatches = new Map();
      cylinder(0.13, length, shell, px, py, z);
      const nose = new ConeGeometry(0.13, 0.4, 12);
      nose.rotateX(Math.PI / 2);
      add(nose, fins, px, py, z + length * 0.5 + 0.2);
      for (const dz of [-length * 0.25, length * 0.31]) cylinder(0.132, 0.045, band, px, py, z + dz);
      add(new TorusGeometry(0.112, 0.017, 5, 12), steel, px, py, z - length * 0.5 - 0.008);
      cylinder(0.09, 0.012, dark, px, py, z - length * 0.5 - 0.014);
      for (let i = 0; i < 4; i++) {
        fin(fins, px, py, z - length * 0.35, i * Math.PI / 2, 0.28, 0.45);
        fin(fins, px, py, z + length * 0.22, i * Math.PI / 2, 0.17, 0.3);
      }
      flush(targetBatches, missile, [px, py, z]);
      targetBatches = batches;
    }
  }
  // Compact ventral cannon pod, recessed twin muzzles and cooling slots.
  add(new BoxGeometry(0.2, 0.23, 0.68), trim, 0, -0.64, 1.7);
  cylinder(0.17, 1.3, trim, 0, -0.83, 1.8);
  for (const x of [-0.075, 0.075]) {
    cylinder(0.044, 0.52, steel, x, -0.83, 2.63, true);
    cylinder(0.029, 0.012, dark, x, -0.83, 2.88);
    add(new TorusGeometry(0.038, 0.01, 5, 10), steel, x, -0.83, 2.89);
  }
  for (const side of [-1, 1]) for (let i = 0; i < 5; i++) {
    add(new BoxGeometry(0.012, 0.07, 0.08), dark, side * 0.164, -0.83, 1.44 + i * 0.14);
  }
  flush(batches, group);
  model.add(group);
}
