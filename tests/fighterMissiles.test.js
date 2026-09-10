import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { parseAst } from "rollup/parseAst";
import { Box3, Group, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Scene, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createFighterMissiles } from "../src/game/fighterMissiles.js";
import { createExplosion } from "../src/game/explosion.js";
import { prepareFighterSurfaces } from "../src/game/vehicleVisuals.js";
import { attachContrails, updateContrails } from "../src/game/contrails.js";

async function setup(onImpact) {
  const bytes = await readFile(new URL("../public/models/jet.glb", import.meta.url));
  const model = (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "")).scene;
  model.rotation.y = Math.PI;
  prepareFighterSurfaces(model);
  const box = new Box3().setFromObject(model), size = box.getSize(new Vector3());
  model.scale.setScalar(10 / Math.max(size.x, size.y, size.z));
  box.setFromObject(model); model.position.sub(box.getCenter(new Vector3()));
  const root = new Group(); root.add(model);
  const scene = new Scene(); scene.add(root);
  const mounts = [];
  root.traverse(node => { if (node.userData.fighterMissile) mounts.push(node); });
  return { root, scene, mounts, missiles: createFighterMissiles(scene, { onImpact }) };
}

test("missiles alternate wings, empty their stations, pause and reload without damaging the model", async () => {
  const { root, scene, mounts, missiles } = await setup();
  assert.equal(mounts.length, 4);
  let sourceDisposed = 0;
  mounts[0].children[0].geometry.addEventListener("dispose", () => sourceDisposed++);
  assert.equal(missiles.fire(root, { speed: 400 }).station, 0);
  assert.equal(mounts[0].visible, false);
  assert.equal(missiles.fire(root), null, "rapid presses must respect cooldown");
  for (const expected of [2, 1, 3]) {
    missiles.update(.31);
    assert.equal(missiles.fire(root).station, expected);
  }
  assert.equal(missiles.status(root).available, 0);
  assert(mounts.every(m => !m.visible));
  const projectile = scene.getObjectByName("launched-fighter-missile");
  const position = projectile.position.clone();
  missiles.update(10, { active: false });
  assert.equal(projectile.position.distanceTo(position), 0);
  assert.equal(missiles.status(root).available, 0);
  for (let i = 0; i < 250; i++) missiles.update(1 / 60);
  assert.equal(missiles.status(root).available, 4);
  assert(mounts.every(m => m.visible));
  missiles.reset();
  assert.equal(scene.children.length, 1, "reset removes all projectile effects");
  assert.equal(sourceDisposed, 0, "projectiles share, but never dispose, the rack geometry");
});

test("a fast missile hits a thin terrain surface between frames, once, at Earth coordinates", async () => {
  const impacts = [];
  const { root, scene, missiles } = await setup((position, up) => impacts.push({ position, up }));
  const surface = 6378137;
  root.position.set(surface + 8, 0, 0);
  root.rotation.y = Math.PI / 2; // The aircraft nose (-Z) now points down local -X.
  const ground = new Mesh(new PlaneGeometry(500, 500), new MeshBasicMaterial());
  ground.position.x = surface; ground.rotation.y = Math.PI / 2;
  scene.add(ground); scene.updateMatrixWorld(true);
  const up = new Vector3(1, 0, 0);
  assert(missiles.fire(root, { speed: 1000, up }));
  missiles.update(.05, { terrain: ground });
  assert.equal(impacts.length, 1);
  assert(Math.abs(impacts[0].position.x - surface) < 1e-6);
  assert.equal(impacts[0].up.distanceTo(up), 0);
  assert.equal(scene.getObjectByName("launched-fighter-missile"), undefined);
  missiles.update(.05, { terrain: ground }); assert.equal(impacts.length, 1);
});

test("remote launch uses the firing pose and selected station without moving the visible peer", async () => {
  const { root, scene, mounts, missiles } = await setup();
  root.position.set(100, 200, 300); root.updateMatrixWorld(true);
  const mount = mounts.find(m => m.userData.station === 2);
  const poseMatrix = new Matrix4().makeTranslation(120, 220, 320);
  const expected = mount.getWorldPosition(new Vector3()).sub(root.position).add(new Vector3(120, 219.8, 320));
  assert.equal(missiles.fire(root, { station: 2, poseMatrix }).station, 2);
  const projectile = scene.getObjectByName("launched-fighter-missile");
  assert(projectile.position.distanceTo(expected) < 1e-8);
  assert.deepEqual(root.position.toArray(), [100, 200, 300]);
  missiles.removeVehicle(root);
  assert.equal(scene.children.length, 1);
  assert(mounts.every(m => m.visible));
});

test("missile expiry cleans up without a false impact and firing preserves wing contrails", async () => {
  let impacts = 0;
  const { root, scene, missiles } = await setup(() => impacts++);
  attachContrails(root, scene);
  missiles.fire(root);
  const camera = new PerspectiveCamera();
  for (let i = 0; i < 120; i++) {
    root.position.z -= 7;
    camera.position.copy(root.position).add(new Vector3(0, 6, 19)); camera.updateMatrixWorld();
    updateContrails(root, 1 / 60, 1510, true, camera);
    missiles.update(1 / 60);
  }
  const trails = scene.getObjectByName("wing-contrails");
  assert(trails.visible); assert.equal(trails.children.length, 2);
  assert(trails.children.every(mesh => mesh.geometry.drawRange.count > 0));
  missiles.update(20);
  assert.equal(impacts, 0);
  assert.equal(scene.getObjectByName("launched-fighter-missile"), undefined);
});

test("impact fire and smoke use local surface up and release all resources", () => {
  const scene = new Scene(), position = new Vector3(6378137, 12, 34), up = new Vector3(1, 0, 0);
  const explosion = createExplosion(scene, position, { up });
  const burst = scene.children[0];
  assert.equal(burst.position.distanceTo(position), 0);
  assert(new Vector3(0, 1, 0).applyQuaternion(burst.quaternion).distanceTo(up) < 1e-8);
  assert(burst.children.filter(n => n.isPoints).every(n => n.geometry.attributes.position.array.every(x => x === 0)));
  explosion.update(.1);
  assert(burst.children.filter(n => n.isPoints).every(n => [...n.geometry.attributes.position.array].every(x => Number.isFinite(x) && Math.abs(x) < 20)));
  assert.equal(explosion.update(3), false); assert.equal(scene.children.length, 0);
  explosion.dispose(); assert.equal(explosion.update(.1), false);
});

test("Enter routes Fighter missiles, Drone cannons and Falcon Dragon, with input guards", async () => {
  const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const ast = parseAst(source);
  const listener = ast.body.find(node => node.type === "ExpressionStatement" &&
    node.expression.type === "CallExpression" && node.expression.callee.object?.name === "window" &&
    node.expression.callee.property?.name === "addEventListener" &&
    node.expression.arguments[0]?.value === "keydown" && node.expression.arguments[1]?.type === "ArrowFunctionExpression").expression.arguments[1];
  const fire = ast.body.find(node => node.type === "FunctionDeclaration" && node.id.name === "fireFighterMissile");
  const droneFire = ast.body.find(node => node.type === "FunctionDeclaration" && node.id.name === "fireDroneCannons");
  let shots = 0, releases = 0, bursts = 0;
  const context = vm.createContext({
    selectedPlane: "jet", mp: { active: false }, menuOpen: false, paused: false, guessOpen: false, leaveOpen: false,
    crashed: false, finished: false, pendingSnap: false, awaitingSnap: false, freeMap: { open: false },
    keys: new Set(), Vector3, frameAt: () => new Matrix4(), plane: { lat: 0, lon: 0, height: 100, speed: 400 }, planeMesh: {},
    fighterMissiles: { fire: () => { shots++; return { station: 0 }; } },
    falconStageInput: { press: () => releases++ }, performance: { now: () => 1000 },
    droneCannons: { fire: () => { bursts++; return true; } },
  });
  vm.runInContext(source.slice(fire.start, fire.end), context);
  vm.runInContext(source.slice(droneFire.start, droneFire.end), context);
  const keydown = vm.runInContext(`(${source.slice(listener.start, listener.end)})`, context);
  const enter = (extra = {}) => keydown({ key: "Enter", repeat: false, preventDefault() {}, ...extra });
  enter(); assert.equal(shots, 1); assert.equal(releases, 0);
  enter({ repeat: true }); enter({ target: { tagName: "INPUT" } });
  assert.equal(shots, 1);
  for (const guard of ["menuOpen", "paused", "guessOpen", "leaveOpen", "crashed", "finished", "pendingSnap", "awaitingSnap"]) {
    context[guard] = true; enter(); context[guard] = false; assert.equal(shots, 1, guard);
  }
  context.freeMap.open = true; enter(); context.freeMap.open = false; assert.equal(shots, 1);
  context.selectedPlane = "falcon9"; enter(); assert.equal(releases, 1); assert.equal(shots, 1);
  context.selectedPlane = "drone"; enter(); assert.equal(bursts, 1); assert.equal(releases, 1); assert.equal(shots, 1);
  enter({ repeat: true }); enter({ target: { tagName: "INPUT" } }); enter({ target: { isContentEditable: true } });
  enter({ ctrlKey: true }); enter({ metaKey: true }); enter({ altKey: true });
  assert.equal(bursts, 1);
  for (const guard of ["menuOpen", "paused", "guessOpen", "leaveOpen", "crashed", "finished", "pendingSnap", "awaitingSnap"]) {
    context[guard] = true; enter(); context[guard] = false; assert.equal(bursts, 1, guard);
  }
  context.freeMap.open = true; enter(); context.freeMap.open = false; assert.equal(bursts, 1);
  // The touch button calls the same guarded function.
  vm.runInContext("fireDroneCannons()", context); assert.equal(bursts, 2);
  context.selectedPlane = "rocket"; enter(); assert.equal(bursts, 2); assert.equal(shots, 1);
});
