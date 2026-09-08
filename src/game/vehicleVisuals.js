import {
  BufferGeometry,
  Color,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Mesh,
  Vector3,
} from "three";
import { prepareFighterDetails, updateFighterLights } from "./fighterDetails.js";
import { disposeCombatDrone } from "./combatDrone.js";
import { disposeFalcon9 } from "./falcon9.js";
import { markContrailEmitters } from "./contrails.js";

export function finishVehicleMaterials(model) {
  const finished = new Set();
  model.traverse((mesh) => {
    if (!mesh.isMesh) return;
    mesh.castShadow = !mesh.userData.noVehicleShadow;
    mesh.receiveShadow = true;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material?.isMeshStandardMaterial || material.userData.vehicleFinish || finished.has(material)) continue;
      finished.add(material);
      const name = (material.name || "").toLowerCase();
      const glass = /glass|window|transparent/.test(name) || name === "80deea";
      const metal = /chrome|metal/.test(name);
      const gear = /gear|rubber/.test(name) || name === "1a1a1a";
      material.metalness = glass ? 0.25 : metal ? 0.8 : gear ? 0.05 : 0.22;
      material.roughness = glass ? 0.12 : metal ? 0.22 : gear ? 0.8 : 0.42;
      material.envMapIntensity = glass ? 1.4 : 0.9;
      if (name === "80deea") material.color.setHex(0x547e96);
    }
  });
}

// Split triangles along the hinge and span boundaries, preserving UVs/normals.
// This removes the fixed panel underneath instead of overlaying a second wing.
function splitPolygon(polygon, distance) {
  const inside = [], outside = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const da = distance(a.position), db = distance(b.position);
    (da >= 0 ? inside : outside).push(a);
    if ((da >= 0) === (db >= 0)) continue;
    const t = da / (da - db);
    const vertex = {};
    for (const name of Object.keys(a)) vertex[name] = a[name].map((v, j) => v + (b[name][j] - v) * t);
    inside.push(vertex);
    outside.push(vertex);
  }
  return { inside, outside };
}

function appendPolygon(output, polygon) {
  for (let i = 1; i + 1 < polygon.length; i++) {
    for (const vertex of [polygon[0], polygon[i], polygon[i + 1]]) {
      for (const name of Object.keys(output)) output[name].push(...vertex[name]);
    }
  }
}

function extractPanel(mesh, side) {
  const source = mesh.geometry;
  const attributes = Object.entries(source.attributes);
  const fixed = Object.fromEntries(attributes.map(([name]) => [name, []]));
  const moving = Object.fromEntries(attributes.map(([name]) => [name, []]));
  const planes = [
    ([x]) => side * x - 2.65,
    ([x]) => 4.72 - side * x,
    ([x, y, z]) => -z - 1.35 - 0.48 * side * x,
    ([x, y]) => y + 0.012,
    ([x, y]) => 0.6 - y,
  ];
  const count = source.index?.count ?? source.attributes.position.count;
  for (let i = 0; i < count; i += 3) {
    let polygon = [];
    for (let j = 0; j < 3; j++) {
      const index = source.index ? source.index.getX(i + j) : i + j;
      const vertex = {};
      for (const [name, attribute] of attributes) {
        vertex[name] = Array.from({ length: attribute.itemSize }, (_, k) => attribute.getComponent(index, k));
      }
      polygon.push(vertex);
    }
    for (const plane of planes) {
      const split = splitPolygon(polygon, plane);
      appendPolygon(fixed, split.outside);
      polygon = split.inside;
      if (polygon.length < 3) break;
    }
    appendPolygon(moving, polygon);
  }
  if (!moving.position.length) return null;
  function geometry(data) {
    const result = new BufferGeometry();
    for (const [name, attribute] of attributes) result.setAttribute(name, new Float32BufferAttribute(data[name], attribute.itemSize));
    result.normalizeNormals();
    return result;
  }
  mesh.geometry = geometry(fixed);
  source.dispose();
  return geometry(moving);
}

// Coordinates refer to the source jet.glb, before its +Z nose is rotated to -Z.
export function prepareFighterSurfaces(model) {
  if (model.userData.fighterSurfaces) return;
  const surfaces = [];
  const resources = [];
  const bodyMeshes = [];
  model.traverse((mesh) => {
    if (mesh.isMesh && mesh.material?.name === "455A64") bodyMeshes.push(mesh);
  });
  markContrailEmitters(model, bodyMeshes);
  for (const mesh of bodyMeshes) {
    for (const side of [-1, 1]) {
      const geometry = extractPanel(mesh, side);
      if (!geometry) continue;
      const hinge = new Group();
      hinge.name = side > 0 ? "fighter-left-elevon" : "fighter-right-elevon";
      hinge.position.set(side * 3.685, 0.1, -1.35 - 0.48 * 3.685);
      geometry.translate(-hinge.position.x, -hinge.position.y, -hinge.position.z);
      const material = mesh.material.clone();
      material.name = "fighter-control-panel";
      material.color.lerp(new Color(0x718591), 0.3);
      const panel = new Mesh(geometry, material);
      panel.castShadow = panel.receiveShadow = true;
      hinge.add(panel);
      const edges = new LineSegments(new EdgesGeometry(geometry, 25), new LineBasicMaterial({
        color: 0x172630, transparent: true, opacity: 0.8,
      }));
      hinge.add(edges);
      mesh.add(hinge);
      resources.push(geometry, material, edges.geometry, edges.material);
      surfaces.push({ hinge, side, axis: new Vector3(1, 0, -0.48 * side).normalize(), angle: 0 });
    }
    resources.push(mesh.geometry);
  }
  model.userData.fighterSurfaces = surfaces;
  prepareFighterDetails(model, bodyMeshes, resources);
  model.userData.fighterResources = resources;
}

export function updateFighterSurfaces(root, dt, roll, pitch) {
  if (!root) return;
  if (!root.userData.flightSurfaces) {
    const surfaces = [];
    const lights = [];
    root.traverse((node) => {
      if (node.userData.fighterSurfaces) surfaces.push(...node.userData.fighterSurfaces);
      if (node.userData.fighterLights) lights.push(node.userData.fighterLights);
    });
    root.userData.flightSurfaces = surfaces;
    root.userData.flightLights = lights;
  }
  for (const lights of root.userData.flightLights ?? []) updateFighterLights(lights, dt);
  const blend = 1 - Math.exp(-12 * dt);
  for (const surface of root.userData.flightSurfaces) {
    const target = MathUtils.clamp(pitch * 0.48 - surface.side * roll * 0.5, -0.7, 0.7);
    surface.angle += (target - surface.angle) * blend;
    surface.hinge.quaternion.setFromAxisAngle(surface.axis, surface.angle);
  }
}

export function disposeVehicleVisuals(root) {
  disposeFalcon9(root);
  disposeCombatDrone(root);
  root?.traverse((node) => {
    for (const resource of node.userData.fighterResources ?? []) resource.dispose();
    delete node.userData.fighterResources;
    delete node.userData.fighterSurfaces;
    delete node.userData.flightSurfaces;
    delete node.userData.fighterLights;
    delete node.userData.flightLights;
  });
}
