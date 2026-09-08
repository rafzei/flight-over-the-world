import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { parseAst } from "rollup/parseAst";
import { Box3, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Scene, Vector3 } from "three";
import { createCombatDrone, disposeCombatDrone } from "../src/game/combatDrone.js";
import { createDroneCannons } from "../src/game/droneCannons.js";

function setup(options = {}) {
  const model = createCombatDrone();
  const box = new Box3().setFromObject(model), size = box.getSize(new Vector3());
  model.scale.setScalar(8 / Math.max(size.x, size.y, size.z));
  box.setFromObject(model); model.position.sub(box.getCenter(new Vector3()));
  const root = new Group(); root.add(model);
  const scene = new Scene(); scene.add(root);
  const cannons = createDroneCannons(scene, options);
  return { model, root, scene, cannons, mounts: model.userData.combatDrone.cannons };
}

test("both real cannon muzzles sweep all 360 degrees with rotating barrels, independent of frame rate", () => {
  for (const fps of [30, 144]) {
    const shots = [], bearings = [new Set(), new Set()];
    const rig = setup({ onShot(shot) {
      assert(shot.position.distanceTo(shot.muzzle.getWorldPosition(new Vector3())) < 1e-8);
      assert(shot.direction.distanceTo(new Vector3(0, 0, -1).transformDirection(shot.muzzle.matrixWorld)) < 1e-8);
      const local = shot.direction.clone().applyQuaternion(rig.root.quaternion.clone().invert());
      const angle = Math.atan2(local.x, -local.z);
      bearings[shot.cannon].add(Math.round(angle * 24 / Math.PI));
      shots.push(shot);
    } });
    rig.root.position.set(6378137, 14, 39); rig.root.rotation.set(.2, .6, -.1);
    assert.equal(rig.cannons.fire(rig.root), true);
    assert.equal(rig.cannons.fire(rig.root), false, "repeat presses cannot stack bursts");
    assert(shots[0].position.distanceTo(shots[1].position) > 2, "bullets start at separate side guns");
    const firstMuzzles = shots.map(shot => shot.position.clone());
    rig.root.position.x += 5;
    for (let i = 0; i < Math.ceil(fps * 2.01); i++) rig.cannons.update(1 / fps);
    assert.equal(shots.length, 96);
    assert(bearings.every(set => set.size === 48), "each cannon covers the full circle");
    assert(shots[12].position.distanceTo(firstMuzzles[0]) > 1, "firing follows the moving vehicle");
    assert(rig.mounts.every(mount => mount.turret.rotation.y === 0 && mount.barrels.rotation.z === 0));
    assert.equal(rig.cannons.status(rig.root).firing, false);
    assert.equal(rig.cannons.status(rig.root).canFire, false);
    rig.cannons.update(.36); assert.equal(rig.cannons.status(rig.root).canFire, true);
    rig.cannons.dispose(); disposeCombatDrone(rig.root);
  }
});

test("pause freezes an active burst and tracers; cancellation stops new bullets", () => {
  let shots = 0;
  const { root, scene, cannons, mounts } = setup({ onShot: () => shots++ });
  cannons.fire(root); cannons.update(.1);
  const count = shots, yaw = mounts[0].turret.rotation.y;
  const effects = scene.getObjectByName("drone-cannon-effects");
  const positions = [...effects.children[0].geometry.attributes.position.array];
  cannons.update(10, { active: false, visible: false });
  assert.equal(shots, count); assert.equal(mounts[0].turret.rotation.y, yaw);
  assert.equal(effects.visible, false);
  assert.deepEqual([...effects.children[0].geometry.attributes.position.array], positions);
  cannons.update(.1); assert(shots > count); assert(effects.visible);
  cannons.cancelBurst(root); const stopped = shots;
  cannons.update(.5); assert.equal(shots, stopped);
  assert(mounts.every(mount => mount.turret.rotation.y === 0));
  cannons.dispose(); disposeCombatDrone(root);
});

test("fast bullets hit thin terrain between frames at Earth coordinates and produce short-lived sparks", () => {
  const hits = [];
  const { root, scene, cannons } = setup({ onImpact: position => hits.push(position) });
  root.position.set(6378137 + 15, 0, 0); root.rotation.y = Math.PI / 2;
  const ground = new Mesh(new PlaneGeometry(1000, 1000), new MeshBasicMaterial());
  ground.position.x = 6378137; ground.rotation.y = Math.PI / 2;
  scene.add(ground); scene.updateMatrixWorld(true);
  cannons.fire(root, { up: new Vector3(1, 0, 0) }); cannons.cancelBurst(root);
  cannons.update(.05, { terrain: ground });
  assert.equal(hits.length, 2); assert(hits.every(point => Math.abs(point.x - 6378137) < 1e-6));
  const sparks = scene.getObjectByName("drone-impact-sparks");
  assert(sparks.geometry.drawRange.count > 0);
  assert([...sparks.geometry.attributes.position.array].every(n => Number.isFinite(n) && Math.abs(n) < 10));
  cannons.update(.1, { terrain: ground }); assert.equal(hits.length, 2, "a hit removes its bullet");
  cannons.update(.4); assert.equal(scene.getObjectByName("drone-cannon-effects"), undefined);
  cannons.dispose(); disposeCombatDrone(root); ground.geometry.dispose(); ground.material.dispose();
});

test("gravity curves bullets towards local ground, with finite local tracer coordinates", () => {
  const { root, scene, cannons } = setup();
  root.position.set(6378137, 20, 30);
  cannons.fire(root, { up: new Vector3(1, 0, 0) }); cannons.cancelBurst(root);
  const effects = scene.getObjectByName("drone-cannon-effects");
  const start = effects.position.clone();
  cannons.update(.5);
  assert(Math.abs(effects.position.x - start.x + 4.905 * .25) < 1e-6);
  assert(Math.abs(effects.position.z - start.z + 425) < 1e-6);
  const tracers = scene.getObjectByName("drone-bullet-tracers");
  assert.equal(tracers.geometry.drawRange.count, 4);
  assert([...tracers.geometry.attributes.position.array].every(n => Number.isFinite(n) && Math.abs(n) < 20));
  cannons.update(4); assert.equal(scene.getObjectByName("drone-cannon-effects"), undefined);
  cannons.dispose(); disposeCombatDrone(root);
});

test("many simultaneous bursts stay bounded and cleanup preserves model-owned resources", () => {
  const scene = new Scene();
  const cannons = createDroneCannons(scene), roots = [];
  let sourceDisposed = 0;
  for (let i = 0; i < 4; i++) {
    const root = createCombatDrone(); roots.push(root); scene.add(root);
    root.getObjectByName("drone-rotary-barrels").children[0].geometry.addEventListener("dispose", () => sourceDisposed++);
    cannons.fire(root);
  }
  for (let i = 0; i < 120; i++) cannons.update(1 / 60);
  const tracers = scene.getObjectByName("drone-bullet-tracers");
  assert.equal(tracers.geometry.drawRange.count, 256 * 2);
  assert.equal(tracers.geometry.attributes.position.count, 256 * 2);
  cannons.removeVehicle(roots[0]);
  assert.equal(roots[0].getObjectByName("drone-muzzle-flash"), undefined);
  cannons.reset(); assert.equal(scene.children.length, 4);
  assert.equal(sourceDisposed, 0);
  assert(roots.every(root => !root.getObjectByName("drone-muzzle-flash")));
  assert(cannons.fire(roots[1]), "reset allows another flight");
  cannons.dispose(); cannons.dispose();
  assert.equal(scene.children.length, 4); assert.equal(sourceDisposed, 0);
  assert.equal(cannons.fire(roots[1]), false);
  for (const root of roots) disposeCombatDrone(root);
  assert.equal(sourceDisposed, 4);
});

test("multiplayer receives a burst once, only for a drone peer", async () => {
  const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const receiver = parseAst(source).body.find(node => node.type === "FunctionDeclaration" && node.id.name === "receiveDroneBurst");
  let bursts = 0;
  const peer = { key: "drone", kmh: 120, mesh: { position: new Vector3(6378137, 0, 0) } };
  const context = vm.createContext({
    mp: { active: true, myId: "local", mates: new Map([["peer", peer]]) }, menuOpen: false, guessOpen: false,
    lastDroneBurstSeq: new Map(), droneCannons: { fire(root, { up, speed }) {
      assert.equal(root, peer.mesh); assert(Math.abs(up.x - 1) < 1e-12); assert.equal(speed, 120 / 3.6); bursts++;
    } },
  });
  vm.runInContext(source.slice(receiver.start, receiver.end), context);
  const receive = data => { context.data = data; vm.runInContext("receiveDroneBurst(data)", context); };
  receive({ from: "peer", seq: 1 }); assert.equal(bursts, 1);
  for (const seq of [1, 0, -1, NaN, Infinity, 1.5]) receive({ from: "peer", seq });
  receive({ from: "local", seq: 2 }); receive({ from: "unknown", seq: 2 }); assert.equal(bursts, 1);
  peer.key = "jet"; receive({ from: "peer", seq: 2 }); assert.equal(bursts, 1);
  peer.key = "drone"; receive({ from: "peer", seq: 2 }); assert.equal(bursts, 2);
});
