import assert from "node:assert/strict";
import test from "node:test";
import { Box3, Group, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, Scene, Vector3 } from "three";
import { BoosterRecovery, FalconStageInput } from "../src/game/boosterRecovery.js";
import { createFalcon9, falconState, releaseBooster, updateBooster, resetFalcon9, disposeFalcon9,
  boosterSnapshot, parseBoosterSnapshot, syncBooster, releaseDragon, resetDragon } from "../src/game/falcon9.js";
import { disposeRocketExhaust } from "../src/game/rocketExhaust.js";

function model() {
  const document = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }) }) };
  try { return createFalcon9(); }
  finally { if (document === undefined) delete globalThis.document; else globalThis.document = document; }
}
function rig() {
  const scene = new Scene(), root = new Group(), drone = model();
  const box = new Box3().setFromObject(drone), size = box.getSize(new Vector3());
  drone.scale.setScalar(38 / Math.max(size.x, size.y, size.z));
  box.setFromObject(drone); drone.position.sub(box.getCenter(new Vector3()));
  root.add(drone); scene.add(root);
  const up = new Vector3(1, 0, 0), target = new Vector3(6378137, 20, -70);
  root.position.copy(target).addScaledVector(up, 500);
  root.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), up);
  const ground = new Mesh(new PlaneGeometry(2000, 2000), new MeshBasicMaterial());
  ground.position.copy(target); ground.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), up);
  scene.add(ground); scene.updateMatrixWorld(true);
  const shadows = new Set([root]);
  const shadowAPI = { addVehicle: object => shadows.add(object), removeVehicle: object => shadows.delete(object) };
  return { scene, root, drone, ground, up, target, shadows, shadowAPI,
    dispose() { disposeFalcon9(root); disposeRocketExhaust(root); ground.geometry.dispose(); ground.material.dispose(); } };
}

test("double Enter separates only the booster, single Enter releases Dragon after the double-press window", () => {
  let singles = 0, doubles = 0;
  const input = new FalconStageInput({ single: () => singles++, double: () => doubles++ });
  input.press(100); input.update(250); assert.equal(singles, 0);
  input.press(290); input.update(1000);
  assert.equal(doubles, 1); assert.equal(singles, 0);
  input.press(1100); input.update(1401); assert.equal(singles, 1);
  input.press(1500); input.reset(); input.update(2000); assert.equal(singles, 1, "pause or reset cancels a pending release");
  input.press(2100); input.press(2500); input.update(2801);
  assert.equal(singles, 3); assert.equal(doubles, 1, "slow presses stay separate single actions");
});

test("first-stage recovery lands softly with four legs deployed at multiple frame rates and launch velocities", () => {
  for (const fps of [30, 144]) for (const [height, vertical, horizontal] of [[200, 30, 5], [1500, 120, 20], [50000, 1000, 200]]) {
    const recovery = new BoosterRecovery({ position: new Vector3(6378137 + height, 0, 0),
      velocity: new Vector3(vertical, horizontal, 0), up: new Vector3(1, 0, 0), target: new Vector3(6378137, 0, 0), clearance: 20,
      orientation: new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(1, 0, 0)) });
    const phases = new Set();
    for (let i = 0; i < fps * 600 && !recovery.landed && recovery.phase !== "failed"; i++) {
      const before = recovery.position.clone(), speed = recovery.velocity.length();
      recovery.update(1 / fps); phases.add(recovery.phase);
      assert(recovery.position.distanceTo(before) < (speed + 2) / fps + .1, "return movement is continuous");
    }
    assert.equal(recovery.phase, "landed", JSON.stringify({ fps, height, speed: recovery.touchdownSpeed }));
    assert(recovery.touchdownSpeed < 2); assert.equal(recovery.legs, 1); assert.equal(recovery.throttle, 0);
    assert(phases.has("boostback") && phases.has("landing-burn"));
    if (height > 1000) assert(phases.has("entry"));
    assert(Math.abs(recovery.height) < 1e-7);
    const landed = recovery.position.clone(); recovery.update(20, 1000);
    assert(recovery.position.equals(landed), "a landed booster remains on the ground");
  }
});

test("staging preserves the visible pose, detaches engines, deploys feet onto real terrain and cleans up", () => {
  const r = rig(), state = falconState(r.root), originalPosition = r.drone.position.clone();
  const dragonPosition = state.dragon.getWorldPosition(new Vector3());
  const engine = state.booster.children[0].children[0];
  const enginePosition = engine.getWorldPosition(new Vector3());
  assert.equal(state.legs.length, 4); assert.equal(state.fins.length, 4);
  assert(releaseBooster(r.root, r.scene, r.up.clone().multiplyScalar(70), r.up, { target: r.target, shadows: r.shadowAPI }));
  assert.equal(state.booster.parent, r.scene); assert.equal(state.dragon.parent, r.drone);
  assert(state.dragon.getWorldPosition(new Vector3()).distanceTo(dragonPosition) < 1e-7);
  assert(engine.getWorldPosition(new Vector3()).distanceTo(enginePosition) < 1e-7);
  assert(state.upperClearance > 4 && state.upperClearance < 8);
  assert(!releaseBooster(r.root, r.scene, new Vector3(), r.up, { target: r.target }));
  const frozen = state.recovery.position.clone();
  updateBooster(r.root, 5, r.ground, { active: false, visible: false });
  assert(state.recovery.position.equals(frozen)); assert(!state.booster.visible);
  for (let i = 0; i < 120 * 60 && !state.recovery.landed; i++) updateBooster(r.root, 1 / 60, r.ground);
  assert.equal(state.recovery.phase, "landed");
  assert(state.booster.visible); assert(!state.booster.getObjectByName("rocket-exhaust").visible);
  for (const { foot, pivot } of state.legs) {
    assert(Math.abs(pivot.rotation.x - 2.05) < 1e-9);
    const sole = foot.localToWorld(new Vector3(0, -.06, 0));
    assert(Math.abs(sole.sub(r.target).dot(r.up)) < 1e-6, "all four foot soles contact the terrain");
  }
  assert(state.fins.every(fin => Math.abs(fin.rotation.x + Math.PI / 2) < 1e-9));
  assert(r.shadows.has(state.booster));
  resetFalcon9(r.root);
  assert(!state.boosterReleased && !state.recovery); assert.equal(state.booster.parent, r.drone);
  assert(state.booster.scale.equals(new Vector3(1, 1, 1))); assert(r.drone.position.equals(originalPosition));
  assert(state.legs.every(leg => leg.pivot.rotation.x === 0)); assert(!r.shadows.has(state.booster));
  assert(releaseBooster(r.root, r.scene, new Vector3(), r.up, { target: r.target, shadows: r.shadowAPI }));
  r.dispose();
  assert(!r.scene.getObjectByName("falcon-booster") || state.booster.parent !== r.scene);
  assert(!r.shadows.has(state.booster)); assert(!r.root.userData.rocketExhaust);
});

test("multiplayer booster poses use Earth coordinates and Dragon reset does not reattach the stage", () => {
  const local = rig(), remote = rig(), state = falconState(local.root);
  releaseBooster(local.root, local.scene, new Vector3(), local.up, { target: local.target });
  updateBooster(local.root, .2, local.ground);
  const map = new Matrix4().makeRotationX(-.6); map.setPosition(120, 340, -50);
  const snapshot = boosterSnapshot(local.root, map);
  assert(parseBoosterSnapshot(snapshot));
  for (const invalid of [{ ...snapshot, position: [NaN, 1, 2] }, { ...snapshot, orientation: [0, 0, 0, 0] }, { ...snapshot, legs: 2 }]) assert.equal(parseBoosterSnapshot(invalid), null);
  syncBooster(remote.root, remote.scene, snapshot, map, remote.shadowAPI);
  updateBooster(remote.root, .1, remote.ground);
  const remoteState = falconState(remote.root);
  assert(remoteState.booster.position.distanceTo(state.booster.position) < 1e-7);
  assert(remoteState.booster.quaternion.angleTo(state.booster.quaternion) < 1e-7);
  releaseDragon(remote.root, remote.scene, new Vector3(), remote.up);
  resetDragon(remote.root); assert(remoteState.boosterReleased); assert.equal(remoteState.booster.parent, remote.scene);
  local.dispose(); remote.dispose();
});
