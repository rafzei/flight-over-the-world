import {
  Box3, BoxGeometry, BufferGeometry, CanvasTexture, CylinderGeometry, DoubleSide,
  Euler, Float32BufferAttribute, Group, LatheGeometry, MathUtils, Mesh,
  MeshStandardMaterial, PlaneGeometry, Quaternion, Raycaster, Shape,
  ExtrudeGeometry, SphereGeometry, SRGBColorSpace, TorusGeometry, Vector2, Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { disposeModelResources } from "./vehicleModels.js";
import { BoosterRecovery } from "./boosterRecovery.js";
import { attachRocketExhaust, disposeRocketExhaust, updateRocketExhaust } from "./rocketExhaust.js";
import { raycastTerrain } from "./vehicleCollision.js";

export function mergeStatic(root) {
  root.updateWorldMatrix(true, true);
  const inverse = root.matrixWorld.clone().invert();
  const batches = new Map(), originals = new Set();
  root.traverse(mesh => {
    if (!mesh.isMesh) return;
    let geometry = mesh.geometry.clone().applyMatrix4(inverse.clone().multiply(mesh.matrixWorld));
    if (geometry.index) { const indexed = geometry; geometry = indexed.toNonIndexed(); indexed.dispose(); }
    if (!batches.has(mesh.material)) batches.set(mesh.material, []);
    batches.get(mesh.material).push(geometry);
    originals.add(mesh.geometry);
  });
  root.clear();
  for (const geometry of originals) geometry.dispose();
  for (const [material, geometries] of batches) {
    const mesh = new Mesh(mergeGeometries(geometries), material);
    for (const geometry of geometries) geometry.dispose();
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  }
}

export function markingsTexture(designation = "9") {
  const canvas = document.createElement("canvas");
  canvas.width = 512; canvas.height = 2048;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 512, 2048);
  ctx.textAlign = "center";
  ctx.fillStyle = "#c82647";
  ctx.beginPath(); ctx.moveTo(110, 78); ctx.lineTo(305, 153); ctx.lineTo(395, 177);
  ctx.lineTo(318, 126); ctx.lineTo(224, 128); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#17212b"; ctx.font = "48px sans-serif"; ctx.fillText("F A L C O N", 256, 236);
  ctx.font = designation === "9" ? "italic 104px serif" : "bold 58px sans-serif"; ctx.fillText(designation, 256, 338);
  const flagX = 139, flagY = 436, flagW = 234, flagH = 126;
  ctx.fillStyle = "#fff"; ctx.fillRect(flagX, flagY, flagW, flagH);
  ctx.fillStyle = "#bf2445";
  for (let i = 0; i < 13; i += 2) ctx.fillRect(flagX, flagY + i * flagH / 13, flagW, flagH / 13);
  ctx.fillStyle = "#174877"; ctx.fillRect(flagX, flagY, flagW * .42, flagH * 7 / 13);
  ctx.fillStyle = "#fff";
  for (let row = 0; row < 9; row++) for (let col = 0; col < (row % 2 ? 5 : 6); col++) {
    ctx.beginPath(); ctx.arc(flagX + 8 + col * 16 + (row % 2 ? 8 : 0), flagY + 5 + row * 7, 1.8, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = "#075b83"; ctx.font = "bold 104px sans-serif";
  for (const [i, letter] of [..."SPACEX"].entries()) ctx.fillText(letter, 256, 850 + i * 157);
  ctx.strokeStyle = "#075b83"; ctx.lineWidth = 9;
  ctx.beginPath(); ctx.moveTo(145, 1678); ctx.quadraticCurveTo(290, 1540, 413, 1547); ctx.stroke();
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function dragonBadge() {
  const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#202832"; ctx.textAlign = "center"; ctx.font = "32px sans-serif";
  ctx.fillText("D R A G O N", 256, 190);
  ctx.beginPath(); ctx.moveTo(150, 58); ctx.lineTo(294, 102); ctx.lineTo(345, 123);
  ctx.lineTo(270, 111); ctx.lineTo(211, 82); ctx.closePath(); ctx.fill();
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; return texture;
}

// Upright +Y model, with a separate Dragon nose. Dimensions are scaled for gameplay.
export function createFalcon9() {
  const root = new Group(); root.name = "spacex-falcon-9";
  const body = new Group(); body.name = "falcon-upper-stage"; root.add(body);
  const booster = new Group(); booster.name = "falcon-booster"; root.add(booster);
  const boosterBody = new Group(); booster.add(boosterBody);
  function material(name, color, metalness = .2, roughness = .4, extra = {}) {
    const m = new MeshStandardMaterial({ name, color, metalness, roughness, ...extra });
    m.userData.vehicleFinish = true; return m;
  }
  const white = material("falcon-white", 0xe9edf0, .25, .35);
  const seam = material("falcon-seams", 0x9ca5ac, .5, .36);
  const dark = material("falcon-carbon", 0x171c22, .35, .42);
  const steel = material("falcon-engine-metal", 0x77868d, .8, .25);
  const black = material("falcon-engine-interior", 0x121a20, .35, .7, { side: DoubleSide });
  const glass = material("dragon-windows", 0x18252e, .5, .12);
  const part = (geo, mat, x, y, z, parent = boosterBody) => {
    const mesh = new Mesh(geo, mat); mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  const cylinder = (top, bottom, height, mat, y, parent = boosterBody) => part(new CylinderGeometry(top, bottom, height, 48), mat, 0, y, 0, parent);
  const ring = (radius, y, mat = seam, parent = boosterBody) => {
    const mesh = part(new TorusGeometry(radius, .024, 6, 48), mat, 0, y, 0, parent); mesh.rotation.x = Math.PI / 2; return mesh;
  };
  cylinder(.97, .97, 22, white, -6);
  cylinder(.98, .98, 4, dark, 7);
  cylinder(.97, .97, 5, white, 11.5, body);
  cylinder(1.04, .98, .8, white, 14.4, body);
  cylinder(1.13, 1.04, 1.7, white, 15.65, body);
  cylinder(1.005, 1.005, .68, dark, -17.05);
  for (const y of [-16.6, -13, -6, 1.8, 4.96, 9.03, 13.98, 14.85, 16.48]) ring(y > 14 ? 1.12 : .979, y, seam, y >= 9 ? body : boosterBody);
  for (const a of [0, Math.PI]) {
    const cover = part(new BoxGeometry(.085, 25.4, .1), dark, Math.sin(a) * .98, -3.8, Math.cos(a) * .98);
    cover.rotation.y = a;
  }

  const markings = material("falcon-markings", 0xffffff, .1, .5, { map: markingsTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const a of [0, Math.PI]) {
    const label = part(new CylinderGeometry(.974, .974, 16.8, 24, 1, true, -.55, 1.1), markings, 0, -4.1, 0);
    label.rotation.y = a; label.castShadow = false; label.userData.noVehicleShadow = true;
  }

  // Four folded landing legs, their hinges and deployment struts.
  const legShape = new Shape();
  legShape.moveTo(-.26, -16.95); legShape.lineTo(.28, -16.95);
  legShape.lineTo(.18, -11.6); legShape.quadraticCurveTo(0, -10.5, -.17, -11.7); legShape.closePath();
  const legGeo = new ExtrudeGeometry(legShape, { depth: .12, bevelEnabled: true, bevelSize: .05, bevelThickness: .04, bevelSegments: 1, steps: 1 });
  legGeo.translate(0, 16.95, 0);
  const legs = [], fins = [];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2;
    const leg = new Group(); leg.rotation.y = a; booster.add(leg);
    const pivot = new Group(); pivot.name = "falcon-landing-leg"; pivot.position.set(0, -16.92, 1.04); leg.add(pivot);
    part(legGeo, dark, 0, 0, 0, pivot);
    const foot = part(new BoxGeometry(.65, .12, .55), dark, 0, 6.2, .06, pivot); foot.name = "falcon-landing-foot";
    const rod = part(new CylinderGeometry(.045, .045, 1, 10), steel, 0, 0, 0, leg);
    const hinge = part(new CylinderGeometry(.17, .17, .5, 16), steel, 0, -16.92, 1.04, leg); hinge.rotation.z = Math.PI / 2;
    legs.push({ pivot, foot, rod });
  }
  // Folded lattice grid fins around the black interstage.
  for (let i = 0; i < 4; i++) {
    const holder = new Group(); holder.rotation.y = Math.PI / 4 + i * Math.PI / 2; booster.add(holder);
    const fin = new Group(); fin.name = "falcon-grid-fin"; fin.position.set(0, 6.2, 1.03); holder.add(fin);
    for (const x of [-.32, .32]) part(new BoxGeometry(.055, 1.05, .07), steel, x, -.65, .05, fin);
    for (const y of [-1.18, -.12]) part(new BoxGeometry(.69, .055, .07), steel, 0, y, .05, fin);
    for (let j = -3; j <= 3; j++) {
      part(new BoxGeometry(.026, 1.03, .05), dark, j * .085, -.65, .05, fin);
      part(new BoxGeometry(.64, .026, .05), dark, 0, -.65 + j * .14, .05, fin);
    }
    const hinge = part(new CylinderGeometry(.12, .12, .7, 12), dark, 0, 0, 0, fin); hinge.rotation.z = Math.PI / 2;
    mergeStatic(fin); fins.push(fin);
  }
  // The second-stage vacuum engine is revealed when the interstage departs.
  const vacuumProfile = [[.22, .7], [.24, .45], [.4, -.05], [.7, -.8]].map(([r, y]) => new Vector2(r, y));
  part(new LatheGeometry(vacuumProfile, 32), black, 0, 8.35, 0, body);
  cylinder(.96, .96, .08, steel, 9.02, body);
  // Octaweb: eight outer Merlin bells and one central engine, with hollow mouths.
  const bellProfile = [[.16, .34], [.17, .12], [.22, -.2], [.3, -.6], [.31, -.65]].map(([r, y]) => new Vector2(r, y));
  const bellGeo = new LatheGeometry(bellProfile, 24);
  for (let i = 0; i < 9; i++) {
    const angle = i * Math.PI / 4, radius = i === 8 ? 0 : .64;
    const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
    part(bellGeo, black, x, -17.7, z);
    const rim = part(new TorusGeometry(.302, .028, 8, 24), steel, x, -18.34, z); rim.rotation.x = Math.PI / 2;
    part(new CylinderGeometry(.17, .17, .3, 16), steel, x, -17.3, z);
    const throat = part(new SphereGeometry(.15, 12, 8), dark, x, -17.62, z); throat.scale.y = .3;
  }
  // Trunk fins remain on the rocket when the crew capsule separates.
  for (let i = 0; i < 4; i++) {
    const fin = part(new BoxGeometry(.07, 1.65, .48), white, 0, 15.56, 1.2, body);
    const holder = new Group(); holder.rotation.y = i * Math.PI / 2; body.add(holder); holder.add(fin);
  }
  mergeStatic(body);
  mergeStatic(boosterBody);

  const dragon = new Group(); dragon.name = "dragon-capsule"; dragon.position.y = 16.5; root.add(dragon);
  const profile = [[1.12, 0], [1.13, .18], [1.08, .76], [.94, 1.32], [.7, 1.98], [.44, 2.48], [.23, 2.74], [0, 2.83]].map(([r, y]) => new Vector2(r, y));
  part(new LatheGeometry(profile, 48), white, 0, 0, 0, dragon);
  cylinder(1.1, 1.02, .12, dark, -.03, dragon);
  ring(.6, 2.2, seam, dragon);
  for (const s of [-1, 1]) {
    const window = part(new SphereGeometry(1, 20, 12), glass, s * .45, 1.48, .74, dragon);
    window.scale.set(.15, .22, .04); window.rotation.y = s * .35;
    const pod = part(new SphereGeometry(1, 20, 12), white, s * .83, .46, .66, dragon);
    pod.scale.set(.13, .46, .15); pod.rotation.z = s * .25;
    for (let i = 0; i < 3; i++) {
      const port = part(new SphereGeometry(1, 12, 8), dark, s * (.76 + i * .038), .95 - i * .18, .79, dragon);
      port.scale.set(.07, .095, .024); port.rotation.z = s * -.5;
    }
  }
  const hatch = part(new BoxGeometry(.47, .64, .04), dark, 0, 1.36, .884, dragon);
  hatch.rotation.x = -.35;
  const inner = part(new BoxGeometry(.42, .59, .045), white, 0, 1.363, .912, dragon); inner.rotation.x = -.35;
  const badge = material("dragon-badge", 0xffffff, .1, .5, { map: dragonBadge(), transparent: true, depthWrite: false });
  part(new PlaneGeometry(.62, .31), badge, 0, .37, 1.084, dragon);
  mergeStatic(dragon);
  root.userData.falcon9 = { dragon, parent: root, position: dragon.position.clone(), released: false, flight: null,
    booster, legs, fins, boosterReleased: false, recovery: null };
  setBoosterDeployment(root.userData.falcon9, 0, 0);
  return root;
}

function parachute() {
  const group = new Group(); group.name = "dragon-parachute";
  const positions = [], colors = [];
  const point = (a, b) => {
    const r = Math.sin(b) * 5.4 * (1 + .025 * Math.cos(a * 24));
    return [Math.cos(a) * r, 7.5 + Math.cos(b) * 3.5, Math.sin(a) * r];
  };
  for (let x = 0; x < 24; x++) for (let y = 0; y < 8; y++) {
    const a = x / 24 * Math.PI * 2, b = (x + 1) / 24 * Math.PI * 2;
    const p = y / 8 * 1.42, q = (y + 1) / 8 * 1.42;
    const color = (Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? [.72, .015, .06] : [.95, .95, .91];
    for (const v of [point(a, p), point(a, q), point(b, p), point(a, q), point(b, q), point(b, p)]) {
      positions.push(...v); colors.push(...color);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3)); geometry.computeVertexNormals();
  const canopy = new Mesh(geometry, new MeshStandardMaterial({ vertexColors: true, side: DoubleSide, roughness: .8 }));
  canopy.castShadow = true; group.add(canopy);
  const cordMaterial = new MeshStandardMaterial({ color: 0xd4d0bf, roughness: .9 });
  for (let i = 0; i < 16; i++) {
    const angle = i / 16 * Math.PI * 2;
    const start = new Vector3(Math.cos(angle) * .7, .4, Math.sin(angle) * .7);
    const end = new Vector3(...point(angle, 1.42));
    const cord = new Mesh(new CylinderGeometry(.015, .015, start.distanceTo(end), 4), cordMaterial);
    cord.position.copy(start).add(end).multiplyScalar(.5);
    cord.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), end.sub(start).normalize());
    group.add(cord);
  }
  return group;
}

export function falconState(root) {
  if (!root) return null;
  if (root.userData.falconParts !== undefined) return root.userData.falconParts;
  let state = null;
  root.traverse(node => { if (node.userData.falcon9) state = node.userData.falcon9; });
  root.userData.falconParts = state;
  return state;
}

export function isFalconVehicle(key) { return key === "falcon9" || key === "falconHeavy"; }

export function falconBoosters(state) { return state ? [...(state.sideBoosters ?? []), state] : []; }

export function setBoosterDeployment(state, legExtension, finExtension) {
  if (state.setDeployment) return state.setDeployment(legExtension, finExtension);
  for (const { pivot, foot, rod } of state.legs) {
    pivot.rotation.x = legExtension * 2.05;
    foot.rotation.x = -pivot.rotation.x;
    const start = new Vector3(0, -12.7, 1.1);
    const end = new Vector3(0, 5.5, .06).applyAxisAngle(new Vector3(1, 0, 0), pivot.rotation.x).add(pivot.position);
    rod.position.copy(start).add(end).multiplyScalar(.5);
    rod.scale.y = start.distanceTo(end);
    rod.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), end.sub(start).normalize());
  }
  for (const fin of state.fins) fin.rotation.x = -finExtension * Math.PI / 2;
}

function localBounds(root) {
  root.updateWorldMatrix(true, true);
  const inverse = root.matrixWorld.clone().invert(), box = new Box3();
  root.traverse(mesh => {
    if (!mesh.isMesh) return;
    mesh.geometry.computeBoundingBox();
    box.union(mesh.geometry.boundingBox.clone().applyMatrix4(inverse.clone().multiply(mesh.matrixWorld)));
  });
  return box;
}

export function releaseBooster(root, scene, velocity, up, { target, shadows, remote = false } = {}) {
  const state = falconState(root);
  if (!state || state.boosterReleased || !target) return false;
  root.updateWorldMatrix(true, true);
  state.modelPosition ??= state.parent.position.clone();
  state.shadows = shadows;
  disposeRocketExhaust(root);
  const releasingSides = state.sideBoosters && !state.sideBoostersReleased;
  const stages = releasingSides ? state.sideBoosters : [state];
  const lateral = new Vector3(1, 0, 0).applyQuaternion(state.parent.getWorldQuaternion(new Quaternion()));
  // Landing targets are separated on the local ground plane, even if the
  // vehicle is banked at separation. Never give both boosters the same pad.
  const groundLateral = lateral.clone().addScaledVector(up, -lateral.dot(up));
  if (groundLateral.lengthSq() < .01) groundLateral.crossVectors(up, new Vector3(0, 0, 1));
  if (groundLateral.lengthSq() < .01) groundLateral.crossVectors(up, new Vector3(1, 0, 0));
  groundLateral.normalize();
  for (const stage of stages) {
    scene.attach(stage.booster);
    const scale = stage.booster.getWorldScale(new Vector3()).y;
    const clearance = (stage.clearance ?? (16.92 - 6.2 * Math.cos(2.05) + .06 * Math.sin(2.05) + .06)) * scale;
    const sign = releasingSides ? Math.sign(stage.homePosition.x) : 0;
    stage.recovery = new BoosterRecovery({ position: stage.booster.position,
      velocity: velocity.clone().addScaledVector(up, -3).addScaledVector(lateral, sign * 9),
      orientation: stage.booster.quaternion, up, target: target.clone().addScaledVector(groundLateral, sign * 65), clearance });
    stage.remote = remote; stage.boosterReleased = true;
    attachRocketExhaust(stage.booster, { axis: "y", ignitionKmh: 0 });
    shadows?.addVehicle(stage.booster);
  }
  if (releasingSides) state.sideBoostersReleased = true;
  else if (state.upperEngine) state.upperEngine.userData.engineEnabled = true;
  const bounds = localBounds(root), center = bounds.getCenter(new Vector3());
  if (!releasingSides) {
    const worldCenter = root.localToWorld(center.clone());
    state.parent.position.sub(center);
    if (!remote) root.position.copy(root.parent.worldToLocal(worldCenter));
  }
  state.upperClearance = (bounds.max.y - bounds.min.y) / 2;
  attachRocketExhaust(root, { axis: "y", ignitionKmh: 0 });
  shadows?.removeVehicle(root); shadows?.addVehicle(root);
  return true;
}

export function updateBooster(root, dt, terrain, { active = true, visible = true, timeWarp = 1 } = {}) {
  for (const state of falconBoosters(falconState(root))) {
    const recovery = state.recovery;
    if (!recovery) continue;
    state.booster.visible = visible;
    if (active && !state.remote) {
      // Refresh the touchdown surface as detailed terrain arrives. The ray
      // ignores shadow receivers, and samples the actual return target.
      if (!recovery.landed && Math.floor(recovery.age * 4) !== state.groundProbeAt) {
        state.groundProbeAt = Math.floor(recovery.age * 4);
        const ray = new Raycaster(recovery.target.clone().addScaledVector(recovery.up, 3000), recovery.up.clone().negate(), 0, 6000);
        const hit = terrain && raycastTerrain(ray, terrain)[0];
        if (hit) recovery.target.copy(hit.point);
      }
      recovery.update(dt, timeWarp);
    }
    state.booster.position.copy(recovery.position); state.booster.quaternion.copy(recovery.orientation);
    setBoosterDeployment(state, recovery.legs, recovery.fins);
    updateRocketExhaust(state.booster, active ? dt : 0, recovery.throttle * 15000, visible && recovery.throttle > .02 && !recovery.landed);
  }
}

export function boosterSnapshot(root, mapMatrix) {
  const state = falconState(root);
  if (state?.sideBoosters) {
    if (!state.sideBoostersReleased) return null;
    return { variant: "heavy", sides: state.sideBoosters.map(stage => stageSnapshot(stage, mapMatrix)), center: stageSnapshot(state, mapMatrix) };
  }
  return stageSnapshot(state, mapMatrix);
}

function stageSnapshot(state, mapMatrix) {
  const recovery = state?.recovery;
  if (!recovery) return null;
  const inverse = mapMatrix.clone().invert();
  return { position: recovery.position.clone().applyMatrix4(inverse).toArray(),
    orientation: new Quaternion().setFromRotationMatrix(inverse).multiply(recovery.orientation).toArray(),
    legs: recovery.legs, fins: recovery.fins, throttle: recovery.throttle, phase: recovery.phase };
}

export function parseBoosterSnapshot(value) {
  if (value?.variant === "heavy") {
    if (!Array.isArray(value.sides) || value.sides.length !== 2) return null;
    const sides = value.sides.map(parseStageSnapshot), center = value.center === null ? null : parseStageSnapshot(value.center);
    if (sides.some(stage => !stage) || (value.center !== null && !center)) return null;
    return { variant: "heavy", sides, center };
  }
  return parseStageSnapshot(value);
}

function parseStageSnapshot(value) {
  if (!value || !Array.isArray(value.position) || value.position.length !== 3 || !value.position.every(n => Number.isFinite(n) && Math.abs(n) < 1e9) ||
      !Array.isArray(value.orientation) || value.orientation.length !== 4 || !value.orientation.every(Number.isFinite) ||
      ![value.legs, value.fins, value.throttle].every(n => Number.isFinite(n) && n >= 0 && n <= 1) ||
      !["separation", "boostback", "entry", "landing-burn", "landed", "failed"].includes(value.phase)) return null;
  const length = Math.hypot(...value.orientation);
  if (length < .9 || length > 1.1) return null;
  return { position: [...value.position], orientation: [...value.orientation], legs: value.legs, fins: value.fins, throttle: value.throttle, phase: value.phase };
}

export function syncBooster(root, scene, snapshot, mapMatrix, shadows) {
  const state = falconState(root);
  if (!state || !snapshot) return;
  if (state.sideBoosters) {
    if (snapshot.variant !== "heavy") return;
    if (state.boosterReleased && !snapshot.center) resetFalcon9(root);
    if (!state.sideBoostersReleased) releaseBooster(root, scene, new Vector3(), new Vector3(0, 1, 0), { target: new Vector3(), shadows, remote: true });
    if (snapshot.center && !state.boosterReleased) releaseBooster(root, scene, new Vector3(), new Vector3(0, 1, 0), { target: new Vector3(), shadows, remote: true });
    state.sideBoosters.forEach((stage, i) => syncStage(stage, snapshot.sides[i], mapMatrix));
    if (snapshot.center) syncStage(state, snapshot.center, mapMatrix);
    return;
  }
  if (snapshot.variant === "heavy") return;
  if (!state.boosterReleased) releaseBooster(root, scene, new Vector3(), new Vector3(0, 1, 0), { target: new Vector3(), shadows, remote: true });
  syncStage(state, snapshot, mapMatrix);
}

function syncStage(state, snapshot, mapMatrix) {
  const position = new Vector3().fromArray(snapshot.position).applyMatrix4(mapMatrix);
  const orientation = new Quaternion().setFromRotationMatrix(mapMatrix).multiply(new Quaternion().fromArray(snapshot.orientation).normalize());
  const recovery = state.recovery;
  recovery.position.copy(position); recovery.orientation.copy(orientation);
  recovery.legs = snapshot.legs; recovery.fins = snapshot.fins; recovery.throttle = snapshot.throttle;
  recovery.phase = snapshot.phase; recovery.landed = snapshot.phase === "landed";
}

export function releaseDragon(root, scene, velocity, up, shadows) {
  const state = falconState(root);
  if (!state || state.released) return false;
  root.updateWorldMatrix(true, true);
  const axis = new Vector3(0, 1, 0).applyQuaternion(state.dragon.getWorldQuaternion(new Quaternion()));
  for (const fairing of state.fairings ?? []) {
    const lateral = new Vector3(fairing.sign, 0, 0).applyQuaternion(fairing.object.getWorldQuaternion(new Quaternion()));
    scene.attach(fairing.object);
    fairing.velocity = velocity.clone().addScaledVector(lateral, 12).addScaledVector(axis, 4);
    fairing.age = 0;
  }
  scene.attach(state.dragon);
  const chute = parachute(); chute.scale.setScalar(.001); state.dragon.add(chute);
  state.flight = {
    chute, age: 0, velocity: velocity.clone().addScaledVector(axis, 18), up: up.clone().normalize(),
    initialRotation: state.dragon.quaternion.clone(),
    upright: new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), up.clone().normalize()),
    landed: false, ray: new Raycaster(), shadows,
  };
  state.released = true;
  shadows?.addVehicle(state.dragon);
  return true;
}

export function updateDragon(root, dt, terrain, active, visible = true) {
  const state = falconState(root), flight = state?.flight;
  if (!flight) return;
  const dragon = state.dragon;
  dragon.visible = visible;
  for (const fairing of state.fairings ?? []) {
    fairing.object.visible = visible && fairing.age < 20;
    if (!active || fairing.age >= 20) continue;
    fairing.age += dt;
    fairing.velocity.addScaledVector(flight.up, -9.81 * dt);
    fairing.object.position.addScaledVector(fairing.velocity, dt);
    fairing.object.rotateZ(-fairing.sign * dt * .28);
  }
  if (!active || flight.landed) return;
  flight.age += dt;
  const open = MathUtils.smoothstep(flight.age, 1.3, 3.8);
  flight.chute.scale.setScalar(Math.max(.001, open));
  flight.velocity.addScaledVector(flight.up, -9.81 * dt);
  const vUp = flight.velocity.dot(flight.up);
  const horizontal = flight.velocity.clone().addScaledVector(flight.up, -vUp).multiplyScalar(Math.exp(-open * 1.3 * dt));
  const descent = vUp + (-7 - vUp) * (1 - Math.exp(-open * 1.4 * dt));
  flight.velocity.copy(horizontal).addScaledVector(flight.up, descent);
  const movement = flight.velocity.clone().multiplyScalar(dt);
  if (terrain && movement.lengthSq() > 0) {
    flight.ray.set(dragon.position, movement.clone().normalize());
    flight.ray.far = movement.length() + 1;
    const hit = flight.ray.intersectObject(terrain, true)[0];
    if (hit) {
      dragon.position.copy(hit.point).addScaledVector(flight.up, .2);
      flight.velocity.set(0, 0, 0); flight.landed = true;
      flight.chute.visible = false;
      return;
    }
  }
  dragon.position.add(movement);
  dragon.quaternion.copy(flight.initialRotation).slerp(flight.upright, open);
  const sway = new Quaternion().setFromEuler(new Euler(Math.sin(flight.age * 1.6) * .035 * open, 0, Math.sin(flight.age) * .045 * open));
  dragon.quaternion.multiply(sway);
}

export function resetDragon(root) {
  const state = falconState(root);
  if (!state?.released) return;
  state.flight?.shadows?.removeVehicle(state.dragon);
  if (state.flight?.chute) {
    state.flight.chute.removeFromParent(); disposeModelResources(state.flight.chute);
  }
  state.parent.add(state.dragon);
  state.dragon.position.copy(state.position); state.dragon.quaternion.identity(); state.dragon.scale.setScalar(1);
  state.dragon.visible = true; state.flight = null; state.released = false;
  for (const fairing of state.fairings ?? []) {
    state.parent.add(fairing.object); fairing.object.position.copy(fairing.homePosition);
    fairing.object.quaternion.identity(); fairing.object.scale.setScalar(1); fairing.object.visible = true;
    fairing.velocity = null; fairing.age = 0;
  }
}

export function resetFalcon9(root, { restoreEffects = true } = {}) {
  resetDragon(root);
  const state = falconState(root);
  if (!state || !falconBoosters(state).some(stage => stage.boosterReleased)) return;
  disposeRocketExhaust(root);
  for (const stage of falconBoosters(state)) {
    state.shadows?.removeVehicle(stage.booster);
    disposeRocketExhaust(stage.booster);
    state.parent.add(stage.booster);
    stage.booster.position.copy(stage.homePosition ?? new Vector3()); stage.booster.quaternion.identity(); stage.booster.scale.setScalar(1);
    stage.booster.visible = true;
    stage.boosterReleased = false; stage.recovery = null; stage.groundProbeAt = undefined; stage.remote = false;
    setBoosterDeployment(stage, 0, 0);
  }
  state.parent.position.copy(state.modelPosition); state.modelPosition = null;
  if (state.sideBoosters) state.sideBoostersReleased = false;
  if (state.upperEngine) state.upperEngine.userData.engineEnabled = false;
  if (restoreEffects) {
    attachRocketExhaust(root, { axis: "y", ignitionKmh: 0 });
    state.shadows?.removeVehicle(root); state.shadows?.addVehicle(root);
  }
}

export function disposeFalcon9(root) {
  const state = falconState(root);
  if (!state) return;
  resetFalcon9(root, { restoreEffects: false });
  disposeModelResources(state.parent);
  delete state.parent.userData.falcon9;
  delete root.userData.falconParts;
}
