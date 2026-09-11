import assert from "node:assert/strict";
import test from "node:test";
import { Box3, Group, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Scene, Vector3 } from "three";
import { createFalconHeavy } from "../src/game/falconHeavy.js";
import { falconState, falconBoosters, releaseBooster, updateBooster, resetFalcon9, disposeFalcon9,
  boosterSnapshot, parseBoosterSnapshot, syncBooster, releaseDragon, resetDragon, updateDragon } from "../src/game/falcon9.js";
import { attachRocketExhaust, updateRocketExhaust, disposeRocketExhaust } from "../src/game/rocketExhaust.js";

function rig() {
  const original = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }) }) };
  let model;
  try { model = createFalconHeavy(); }
  finally { if (original === undefined) delete globalThis.document; else globalThis.document = original; }
  const box = new Box3().setFromObject(model), size = box.getSize(new Vector3());
  model.scale.setScalar(70 / Math.max(size.x, size.y, size.z));
  box.setFromObject(model); model.position.sub(box.getCenter(new Vector3()));
  const root = new Group(), scene = new Scene(); root.add(model); scene.add(root);
  const target = new Vector3(6378137, 0, 0), up = new Vector3(1, 0, 0);
  root.position.copy(target).addScaledVector(up, 500);
  root.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), up);
  const ground = new Mesh(new PlaneGeometry(3000, 3000), new MeshBasicMaterial());
  ground.position.copy(target); ground.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), up); scene.add(ground);
  scene.updateMatrixWorld(true);
  const shadows = new Set(), shadowAPI = { addVehicle: v => shadows.add(v), removeVehicle: v => shadows.delete(v) };
  const state = falconState(root);
  return { root, model, scene, state, target, up, ground, shadows, shadowAPI,
    stage() { return releaseBooster(root, scene, up.clone().multiplyScalar(45), up, { target, shadows: shadowAPI }); },
    dispose() { disposeFalcon9(root); disposeRocketExhaust(root); ground.geometry.dispose(); ground.material.dispose(); } };
}

test("Heavy proportions, 27 engines, twelve hinged legs and twelve grid fins match its architecture", () => {
  const r = rig(), stages = falconBoosters(r.state);
  const box = new Box3().setFromObject(r.model), size = box.getSize(new Vector3());
  assert(Math.abs(size.x - 70) < 1e-6, "upright axis is rotated onto world X in this test");
  assert.equal(stages.length, 3);
  assert.equal(stages.reduce((n, s) => n + s.booster.userData.engineCount, 0), 27);
  assert(stages.every(s => s.legs.length === 4 && s.fins.length === 4));
  assert.equal(r.state.fairings.length, 2);
  assert.equal(r.state.variant, "heavy");
  assert.equal(r.state.dragon.parent, r.model);
  assert(Math.abs(box.min.x - r.root.position.x + 35) < 1e-6, "scaled engine base matches the lunar contact clearance");
  r.dispose();
});

test("side boosters separate simultaneously without shifting the stack, then center stages with inherited pose", () => {
  const r = rig(), state = r.state, rootPosition = r.root.position.clone();
  attachRocketExhaust(r.root, { axis: "y", ignitionKmh: 0 });
  updateRocketExhaust(r.root, .1, 15000);
  const lit = () => { let n = 0; r.root.traverse(node => { if (node.name === "rocket-exhaust" && node.visible) n++; }); return n; };
  assert.equal(lit(), 3, "three first-stage plumes, upper engine disabled");
  const cabinBefore = state.dragon.getWorldPosition(new Vector3());
  const sideBefore = state.sideBoosters.map(s => s.booster.getWorldPosition(new Vector3()));
  assert(r.stage()); assert(state.sideBoostersReleased); assert(!state.boosterReleased);
  assert(r.root.position.equals(rootPosition)); assert.equal(state.booster.parent, r.model);
  state.sideBoosters.forEach((s, i) => {
    assert.equal(s.booster.parent, r.scene);
    assert(s.booster.getWorldPosition(new Vector3()).distanceTo(sideBefore[i]) < 1e-7);
    assert(r.shadows.has(s.booster));
  });
  const [left, right] = state.sideBoosters;
  assert(left.recovery.target.distanceTo(right.recovery.target) >= 129.9);
  assert(left.recovery.velocity.distanceTo(right.recovery.velocity) > 17.9);
  updateRocketExhaust(r.root, .1, 15000); assert.equal(lit(), 1);
  assert(r.stage()); assert(state.boosterReleased); assert.equal(state.booster.parent, r.scene);
  assert(state.dragon.getWorldPosition(new Vector3()).distanceTo(cabinBefore) < 1e-7);
  assert(state.upperClearance > 14 && state.upperClearance < 16);
  assert(state.upperEngine.userData.engineEnabled);
  updateRocketExhaust(r.root, .1, 15000); assert.equal(lit(), 1, "only the vacuum engine remains");
  assert(!r.stage(), "no repeated separation");
  r.dispose();
});

test("all three Heavy cores pause, land on twelve soles, and reset without orphaned effects", () => {
  for (const fps of [30, 144]) {
    const r = rig(), original = r.model.position.clone(); r.stage(); r.stage();
    const stages = falconBoosters(r.state), positions = stages.map(s => s.recovery.position.clone());
    updateBooster(r.root, 10, r.ground, { active: false, visible: false });
    stages.forEach((s, i) => { assert(s.recovery.position.equals(positions[i])); assert(!s.booster.visible); });
    for (let i = 0; i < fps * 160 && !stages.every(s => s.recovery.landed); i++) updateBooster(r.root, 1 / fps, r.ground);
    for (const s of stages) {
      assert.equal(s.recovery.phase, "landed", `${fps} fps ${s.id}`);
      assert(s.recovery.touchdownSpeed < 2);
      for (const { foot } of s.legs) {
        const sole = foot.localToWorld(new Vector3(0, -.08, 0));
        assert(Math.abs(sole.sub(s.recovery.target).dot(r.up)) < 1e-6, "foot contacts actual ground");
      }
    }
    resetFalcon9(r.root); assert(r.model.position.equals(original));
    assert(!r.state.sideBoostersReleased && !r.state.boosterReleased);
    for (const s of stages) {
      assert.equal(s.booster.parent, r.model); assert(s.booster.position.equals(s.homePosition));
      assert(!r.shadows.has(s.booster)); assert(!s.recovery);
    }
    r.stage(); r.dispose();
    assert(stages.every(s => s.booster.parent !== r.scene));
    assert(!r.root.userData.rocketExhaust);
  }
});

test("cabin ejects through two released fairings, deploys a chute, and resets before or after staging", () => {
  for (const separation of [0, 1, 2]) {
    const r = rig(); for (let i = 0; i < separation; i++) r.stage();
    assert(releaseDragon(r.root, r.scene, new Vector3(), r.up, r.shadowAPI));
    assert(!releaseDragon(r.root, r.scene, new Vector3(), r.up));
    assert.equal(r.state.dragon.parent, r.scene);
    assert(r.state.fairings.every(f => f.object.parent === r.scene));
    const before = r.state.dragon.position.clone();
    updateDragon(r.root, 1, r.ground, false); assert(r.state.dragon.position.equals(before));
    for (let i = 0; i < 240; i++) updateDragon(r.root, 1 / 60, r.ground, true);
    assert.equal(r.state.flight.chute.scale.x, 1);
    assert(r.state.fairings[0].object.position.distanceTo(r.state.fairings[1].object.position) > 50);
    resetDragon(r.root);
    assert.equal(r.state.boosterReleased, separation === 2);
    assert.equal(r.state.sideBoostersReleased, separation > 0);
    assert(r.state.fairings.every(f => f.object.parent === r.model && f.object.position.equals(f.homePosition)));
    r.dispose();
  }
});

test("multiplayer transmits all three cores, validates nested packets and supports late join/reset", () => {
  const local = rig(), remote = rig(), map = new Matrix4().makeRotationZ(.45); map.setPosition(20, -70, 120);
  assert.equal(boosterSnapshot(local.root, map), null);
  local.stage();
  const sidesOnly = boosterSnapshot(local.root, map); assert(parseBoosterSnapshot(sidesOnly));
  assert.equal(sidesOnly.center, null);
  for (const bad of [
    { ...sidesOnly, sides: [] }, { ...sidesOnly, sides: [null, null] },
    { ...sidesOnly, sides: [{ ...sidesOnly.sides[0], throttle: Infinity }, sidesOnly.sides[1]] },
    { ...sidesOnly, center: { ...sidesOnly.sides[0], orientation: [0, 0, 0, 0] } },
    { ...sidesOnly, center: sidesOnly },
  ]) assert.equal(parseBoosterSnapshot(bad), null);
  local.stage(); updateBooster(local.root, .2, local.ground);
  const packet = boosterSnapshot(local.root, map); assert(parseBoosterSnapshot(packet));
  syncBooster(remote.root, remote.scene, packet, map, remote.shadowAPI);
  updateBooster(remote.root, 5, remote.ground);
  falconBoosters(remote.state).forEach((s, i) => {
    assert(s.booster.position.distanceTo(falconBoosters(local.state)[i].booster.position) < 1e-7);
    assert(s.remote);
  });
  syncBooster(remote.root, remote.scene, sidesOnly, map, remote.shadowAPI);
  assert(remote.state.sideBoostersReleased && !remote.state.boosterReleased);
  local.dispose(); remote.dispose();
});
