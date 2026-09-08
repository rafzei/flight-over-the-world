import {
  AdditiveBlending, BufferGeometry, CylinderGeometry, DataTexture,
  DoubleSide, EdgesGeometry, Float32BufferAttribute, Group, LineBasicMaterial,
  LineSegments, Mesh, MeshBasicMaterial, MeshStandardMaterial, Quaternion, Raycaster,
  SphereGeometry, Sprite, SpriteMaterial, TorusGeometry, Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// All dimensions use the original jet.glb coordinates (nose +Z, port +X).
// Keep these details on the model so menu, player and multiplayer share them.
export function prepareFighterDetails(model, bodyMeshes, resources) {
  const details = new Group();
  details.name = "fighter-details";
  model.add(details);
  const owned = new Set();
  const own = (resource) => { owned.add(resource); return resource; };
  function paint(name, color, roughness = 0.48, metalness = 0.25) {
    const material = own(new MeshStandardMaterial({ color, roughness, metalness }));
    material.name = name;
    material.userData.vehicleFinish = true;
    return material;
  }
  const airframe = paint("fighter-airframe", 0x708491);
  const finPaint = paint("fighter-tail", 0x95a5b0);
  const dark = paint("fighter-trim", 0x263844, 0.52);
  const metal = paint("fighter-nozzle-metal", 0x8f9b9f, 0.3, 0.72);
  const hotMetal = paint("fighter-nozzle-inner", 0x3f3934, 0.62, 0.5);
  const glass = paint("fighter-canopy-glass", 0x244b63, 0.16, 0.38);
  glass.emissive.setHex(0x122835);
  glass.emissiveIntensity = 0.16;
  const seamMaterial = own(new LineBasicMaterial({ color: 0x243642, transparent: true, opacity: 0.55 }));
  const trimSegments = [];
  function tube(a, b, radius = 0.014) {
    const from = new Vector3(...a), to = new Vector3(...b);
    const direction = to.clone().sub(from);
    if (direction.lengthSq() < 0.000001) return;
    const geometry = new CylinderGeometry(radius, radius, direction.length(), 5);
    geometry.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize()));
    geometry.translate(...from.add(to).multiplyScalar(0.5).toArray());
    trimSegments.push(geometry);
  }
  function add(geometry, material, position, parent = details) {
    own(geometry);
    const mesh = new Mesh(geometry, material);
    if (position) mesh.position.set(...position);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  function polygon(points, material) {
    const positions = [];
    for (let i = 1; i + 1 < points.length; i++) positions.push(...points[0], ...points[i], ...points[i + 1]);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    return add(geometry, material);
  }

  for (const body of bodyMeshes) {
    // The original fins belong to the body mesh. Extract their triangles first;
    // stretching only those triangles leaves the fuselage and elevons intact.
    const source = body.geometry;
    const position = source.attributes.position;
    const fixed = [], fins = [];
    for (let i = 0; i < (source.index?.count ?? position.count); i += 3) {
      const vertices = [0, 1, 2].map((j) => {
        const index = source.index ? source.index.getX(i + j) : i + j;
        return [position.getX(index), position.getY(index), position.getZ(index)];
      });
      const isFin = vertices.every(([, , z]) => z < -2.7) && vertices.some(([, y]) => y > 1);
      for (const [x, y, z] of vertices) {
        (isFin ? fins : fixed).push(x, isFin ? 0.35 + (y - 0.35) * 1.55 : y, z);
      }
    }
    function geometry(positions) {
      const result = own(new BufferGeometry());
      result.setAttribute("position", new Float32BufferAttribute(positions, 3));
      result.computeVertexNormals();
      return result;
    }
    body.geometry = geometry(fixed);
    body.material = airframe;
    const tail = add(geometry(fins), finPaint, null, body);
    tail.name = "fighter-twin-stabilizers";
    const outline = new LineSegments(own(new EdgesGeometry(tail.geometry, 24)), seamMaterial);
    tail.add(outline);

    // Project fixed wing panel seams onto the actual skin, avoiding floating
    // lines and the moving elevons that have already been cut out of this mesh.
    const probe = new Mesh(body.geometry, airframe);
    const ray = new Raycaster(new Vector3(), new Vector3(0, -1, 0));
    function surface(x, z) {
      ray.ray.origin.set(x, 4, z);
      const hit = ray.intersectObject(probe, false)[0];
      return hit ? [x, hit.point.y + 0.012, z] : null;
    }
    for (const side of [-1, 1]) {
      for (const path of [
        [[2.08, 0.62], [3.25, -0.74], [4.68, -2.3]],
        [[2.12, -0.06], [2.12, -2.13], [2.5, -2.38]],
        [[2.85, -0.65], [2.85, -2.35]],
        [[3.9, -1.75], [3.9, -2.9]],
      ]) {
        for (let i = 0; i < path.length - 1; i++) {
          const a = surface(side * path[i][0], path[i][1]);
          const b = surface(side * path[i + 1][0], path[i + 1][1]);
          if (a && b) tube(a, b, 0.011);
        }
      }
    }
  }

  // Painted fin caps and inset rudder seams on both outer faces.
  const capPaint = paint("fighter-tail-cap", 0x344b5b);
  capPaint.side = DoubleSide;
  for (const side of [-1, 1]) {
    const outer = (t, z) => [side * (1.417 + (1.556 - 1.417) * t + 0.012), 0.347 + 2.114 * t, z];
    polygon([
      outer(0.88, -3.77), outer(1, -3.907), outer(1, -4.866), outer(0.88, -4.826),
    ], capPaint);
    tube(outer(0.12, -4.26), outer(0.86, -4.57), 0.015);
    tube(outer(0.12, -4.26), outer(0.12, -4.55), 0.015);
    // Small pale formation strips read from the chase camera without text decals.
    const strip = own(new MeshBasicMaterial({ color: 0xc0dca5, toneMapped: false }));
    polygon([
      outer(0.47, -3.7), outer(0.51, -3.745), outer(0.51, -4.31), outer(0.47, -4.295),
    ], strip);
  }

  const canopy = [];
  model.traverse((mesh) => {
    if (mesh.isMesh && mesh.material?.name === "80DEEA") canopy.push(mesh);
    if (mesh.isMesh && mesh.material?.name === "fighter-control-panel") {
      mesh.material.color.setHex(0x566c7b);
      mesh.material.roughness = 0.5;
      mesh.material.userData.vehicleFinish = true;
    }
  });
  for (const mesh of canopy) {
    mesh.material = glass;
    const edges = own(new EdgesGeometry(mesh.geometry, 28));
    const p = edges.attributes.position;
    for (let i = 0; i < p.count; i += 2) {
      tube([p.getX(i), p.getY(i) + 0.014, p.getZ(i)], [p.getX(i + 1), p.getY(i + 1) + 0.014, p.getZ(i + 1)], 0.022);
    }
  }
  // The windshield bow follows the existing faceted canopy profile.
  for (const side of [-1, 1]) {
    tube([0, 0.807, 4.158], [side * 0.539, 0.621, 4.158], 0.026);
    tube([side * 0.539, 0.621, 4.158], [side * 0.64, 0.34, 4.158], 0.026);
  }

  // Concentric nozzle lips and radial petals catch light from behind.
  for (const side of [-1, 1]) {
    const center = [side * 0.709, 0.085, -4.96];
    add(new TorusGeometry(0.395, 0.038, 5, 20), metal, center);
    add(new TorusGeometry(0.307, 0.035, 5, 20), hotMetal, [center[0], center[1], -4.976]);
    for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI / 6;
      tube([center[0] + Math.cos(angle) * 0.32, center[1] + Math.sin(angle) * 0.32, -4.989],
        [center[0] + Math.cos(angle) * 0.43, center[1] + Math.sin(angle) * 0.43, -4.85], 0.017);
    }
  }
  if (trimSegments.length) {
    add(mergeGeometries(trimSegments), dark);
    for (const geometry of trimSegments) geometry.dispose();
  }

  // Small emissive lenses with a soft, depth-tested halo; no scene point lights.
  const pixels = new Uint8Array(32 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const radius = Math.hypot((x - 15.5) / 15.5, (y - 15.5) / 15.5);
    const i = (y * 32 + x) * 4;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
    pixels[i + 3] = Math.round(Math.max(0, 1 - radius) ** 3 * 255);
  }
  const glow = own(new DataTexture(pixels, 32, 32));
  glow.needsUpdate = true;
  const lensGeometry = own(new SphereGeometry(1, 10, 6));
  function light(name, point, color, size = 0.065) {
    const group = new Group();
    group.name = name;
    group.position.set(...point);
    details.add(group);
    const housing = add(lensGeometry, dark, null, group);
    housing.scale.set(size * 1.55, size * 0.75, size * 2.25);
    const luminous = new Group();
    luminous.position.y = size * 0.48;
    group.add(luminous);
    const material = own(new MeshBasicMaterial({ color, toneMapped: false }));
    const lens = add(lensGeometry, material, null, luminous);
    lens.scale.set(size, size * 0.8, size * 1.6);
    const halo = new Sprite(own(new SpriteMaterial({
      map: glow, color, transparent: true, opacity: 0.8,
      blending: AdditiveBlending, depthWrite: false, toneMapped: false,
    })));
    halo.scale.setScalar(size * 8);
    luminous.add(halo);
    return luminous;
  }
  light("fighter-port-red", [4.97, 0.19, -2.3], 0xff2638, 0.09);
  light("fighter-starboard-green", [-4.97, 0.19, -2.3], 0x23ff83, 0.09);
  light("fighter-tail-white", [0, 0.37, -4.56], 0xf1f5ff, 0.045);
  const strobes = [-1, 1].map((side) => light("fighter-wing-strobe", [side * 4.96, 0.19, -3.85], 0xffffff, 0.055));
  const beacon = light("fighter-beacon", [0, 0.72, -1.3], 0xff3025, 0.06);
  model.userData.fighterLights = { time: 0, strobes, beacon };
  updateFighterLights(model.userData.fighterLights, 0);
  resources.push(...owned);
}

export function updateFighterLights(lights, dt) {
  lights.time = (lights.time + Math.max(0, dt)) % 30;
  const strobePhase = lights.time % 1.25;
  // Double white flash, with a slower red anti-collision beacon.
  for (const strobe of lights.strobes) strobe.visible = strobePhase < 0.055 || (strobePhase > 0.15 && strobePhase < 0.205);
  lights.beacon.visible = lights.time % 1.5 < 0.16;
}
