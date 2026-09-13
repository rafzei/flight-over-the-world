import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { parseAst } from "rollup/parseAst";
import { Matrix4, Scene, Vector3 } from "three";
import { FlightPoints, PointRecords, POINT_MODES, crossesPointGate, validPointScore } from "../src/game/flightPoints.js";
import { pointFlightFrame, pointMapMarkers } from "../src/game/pointFlightFrame.js";
import { PointVisuals } from "../src/game/pointVisuals.js";
import { createVehicleController } from "../src/game/vehicleControllers.js";
import { SAILPLANE_SPEC } from "../src/game/sailplane.js";
import { BALLOON_SPEC } from "../src/game/balloon.js";

const frame = (z = 0, extra = {}) => ({ position: new Vector3(6378137, 0, z), forward: new Vector3(0, 0, 1), up: new Vector3(1, 0, 0), right: new Vector3(0, 1, 0), speed: 40, size: 10, ...extra });

function activePoints() {
  const points = new FlightPoints(); points.reset({ mode: "home" }); return points;
}

const gate = (z, id = 1, extra = {}) => ({ position: frame(z).position, normal: new Vector3(0, 0, 1), radius: 10, id, value: 100, expires: 1000, ...extra });

test("swept ring crossings collect at high speed, but misses, hovering and repeated passes do not", () => {
  const g = gate(10);
  assert(crossesPointGate(frame(0).position, frame(100).position, g));
  assert(crossesPointGate(frame(100).position, frame(0).position, g));
  assert(!crossesPointGate(frame(0).position, frame(100).position.clone().add(new Vector3(0, 110, 0)), g));
  assert(!crossesPointGate(g.position, g.position, g));
  const points = activePoints(); points.start(frame()); points.gates = [g];
  points.update(.1, frame(100, { speed: 1000 })); assert.equal(points.score, 100);
  points.update(.1, frame(0, { speed: 1000 })); assert.equal(points.score, 100);
});

test("series multipliers, mint rings, ten-ring bonus and one-time mission bonuses use earned scores", () => {
  const points = activePoints(); points.start(frame());
  points.gates = Array.from({ length: 15 }, (_, i) => gate((i + 1) * 10, i + 1, { value: (i + 1) % 5 ? 100 : 200 }));
  const totals = [100, 200, 300, 500, 900, 1100, 1400, 1700, 2000, 3300, 3700, 4100, 4600, 5100, 6100];
  for (let i = 0; i < 15; i++) { points.update(.25, frame((i + 1) * 10 + .1)); assert.equal(points.score, totals[i]); }
  assert.equal(points.multiplier, 5); assert.equal(points.bestCombo, 15);
  assert(points.award("home", 2000, "Home")); assert(!points.award("home", 2000, "Home"));
  assert.equal(points.score, 8100);
  points.update(36, frame(150.1)); assert.equal(points.combo, 0);
});

test("pause, loading, teleports, expired gates and trail resets cannot grant free points", () => {
  const points = activePoints(); points.reset({ mode: "arcade" }); points.start(frame()); points.gates = [gate(10)];
  points.update(4, frame(20), { active: false }); assert.equal(points.score, 0); assert.equal(points.elapsed, 0);
  points.update(.1, frame(21)); assert.equal(points.score, 0);
  points.gates = [gate(100)]; points.update(.01, frame(10000)); assert.equal(points.score, 0);
  const original = points.gates.map(g => g.position.clone()); points.update(.1, frame(10001));
  assert(points.gates.every((g, i) => g.position.equals(original[i])), "gates stay fixed while the aircraft moves");
  points.gates = [gate(10002, 50, { expires: points.elapsed })]; points.update(.1, frame(10003)); assert.equal(points.score, 0);
  points.update(4, frame(10003)); points.update(4, frame(10003));
  assert(points.newTrail(frame(10003))); assert(!points.newTrail(frame(10003)));
  points.update(.1, frame(10003)); assert.equal(points.score, 0);
  points.award("example", 200, "Bonus"); points.reset({ mode: "arcade" });
  assert.equal(points.score, 0); assert.equal(points.best, 200); assert(!points.started && !points.gates.length);
});

test("Point hunt ends at exactly 180 active seconds, clips the final crossing and ignores later movement", () => {
  const points = activePoints(); points.reset({ mode: "arcade" }); points.start(frame());
  points.elapsed = 179.5; points.gates = [gate(4), gate(8, 2)];
  points.update(1, frame(10)); assert.equal(points.score, 100); assert.equal(points.remaining, 0); assert(points.finished);
  points.update(50, frame(100)); assert.equal(points.score, 100); assert.equal(points.elapsed, 180);
  points.reset({ mode: "home" }); points.start(frame()); points.update(181, frame()); assert(!points.finished);
});

test("records survive reload, remain separate per vehicle and mode, and tolerate unavailable/corrupt storage", () => {
  const data = new Map(), storage = { getItem: k => data.get(k), setItem: (k, v) => data.set(k, v) };
  const records = new PointRecords(storage); records.save("arcade", "pa28", 500); records.save("arcade", "pa28", 200);
  assert.equal(new PointRecords(storage).read("arcade", "pa28"), 500);
  assert.equal(records.read("free", "pa28"), 0); assert.equal(records.read("arcade", "balloon"), 0);
  for (const bad of ['{"score":999}', 'NaN', '-1', '1e99', '2.5']) {
    data.set(records.key("free", "pa28"), bad); assert.equal(records.read("free", "pa28"), 0);
  }
  const unavailable = new PointRecords({ getItem() { throw Error(); }, setItem() { throw Error(); } });
  unavailable.save("guess", "pa28", 700); assert.equal(unavailable.read("guess", "pa28"), 700);
  for (const bad of [NaN, Infinity, -1, 1.5, "100", 1e12]) assert.equal(validPointScore(bad), 0);
});

const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
const ast = parseAst(source);
const catalogue = ast.body.flatMap(node => node.declarations ?? []).find(node => node.id.name === "PLANES").init;
const specs = vm.runInNewContext(`(${source.slice(catalogue.start, catalogue.end)})`, {
  BALLOON_SPEC, SAILPLANE_SPEC, asset: p => p, createF35() {}, prepareJet() {}, prepareRocket() {}, createCombatDrone() {}, createFalcon9() {}, createFalconHeavy() {},
});

test("every actual menu vehicle can collect rings with its own flight physics in every unrestricted mode", () => {
  const matrix = new Matrix4().makeRotationX(-.9); matrix.setPosition(17, 23, -80);
  assert.equal(Object.keys(specs).length, 14);
  for (const mode of POINT_MODES) for (const [vehicle, spec] of Object.entries(specs)) {
    const plane = createVehicleController(52, 21, 1000, 0, spec);
    const points = activePoints(); points.reset({ mode, vehicle });
    const current = () => pointFlightFrame({ plane, spec, mapMatrix: matrix, mode });
    points.start(current());
    for (let i = 0; i < 20 * 60 && !points.collected; i++) {
      plane.update(1 / 60, { pitch: 0, roll: 0, throttle: plane.cruiseT, airbrake: 0 });
      points.update(1 / 60, current());
    }
    assert(points.collected > 0, `${vehicle} in ${mode} must reach the first ring through actual flight`);
    const map = pointMapMarkers(points.gates, matrix);
    assert(map.every(g => [g.lat, g.lon, g.height].every(Number.isFinite)));
    assert(points.gates.every(g => g.radius > 0 && g.normal.length() > .99));
  }
});

test("free flight and landing disable rings, scoring and trails, including after a scored flight", () => {
  const points = activePoints(); points.start(frame()); points.award("home", 2000, "Home");
  for (const mode of ["free", "landing", "dodge", "unknown"]) {
    points.reset({ mode });
    assert(!points.enabled); assert(!points.started); assert.equal(points.score, 0);
    points.start(frame()); points.makeTrail(frame());
    points.update(10, frame(100)); points.add(500, "Ring");
    assert(!points.award("touchdown", 1200, "Landing bonus"));
    assert(!points.award("stopped", 250, "Safe stop"));
    assert(!points.newTrail(frame()));
    assert(!points.started); assert.equal(points.gates.length, 0); assert.equal(points.score, 0);
    assert.equal(pointMapMarkers(points.gates, new Matrix4()).length, 0);
  }
  points.reset({ mode: "arcade" }); points.start(frame());
  assert(points.enabled && points.started); assert(points.gates.length > 0);
});

test("wind-aware trails are reachable with aircraft, drones and unsteerable balloons in strong crosswinds", () => {
  for (const vehicle of ["pa28", "sailplane", "drone", "balloon"]) for (const east of [-20, 20]) {
    const spec = specs[vehicle], weather = { north: 3, east, up: .5 };
    const plane = createVehicleController(52, 21, 6000, 0, spec), points = activePoints();
    const current = () => pointFlightFrame({ plane, spec, weather, mapMatrix: new Matrix4(), mode: "home" });
    points.start(current());
    for (let i = 0; i < 25 * 60 && !points.collected; i++) {
      plane.update(1 / 60, { pitch: 0, roll: 0, throttle: plane.cruiseT, airbrake: 0, weather });
      points.update(1 / 60, current());
    }
    assert(points.collected > 0, `${vehicle} in ${east} m/s crosswind reaches the trail`);
  }
});

test("terrain samples lift generated gates above obstacles without moving them later", () => {
  const plane = createVehicleController(52, 21, 400, 0, specs.pa28), matrix = new Matrix4();
  const points = activePoints(); const context = pointFlightFrame({ plane, spec: specs.pa28, mapMatrix: matrix, ground: () => 900 });
  points.start(context);
  assert(pointMapMarkers(points.gates, matrix).every(g => g.height > 930));
});

test("points use the actual gameplay guards and ignore pause/menu/map/crash/loading states", () => {
  const fn = ast.body.find(node => node.type === "FunctionDeclaration" && node.id.name === "canCollectPoints");
  const flags = ["menuOpen", "paused", "leaveOpen", "guessOpen", "crashed", "finished", "pendingSnap", "awaitingSnap"];
  const context = vm.createContext({ ...Object.fromEntries(flags.map(k => [k, false])), freeMap: { open: false }, spaceScene: { overview: false }, flightPoints: { enabled: true } });
  const active = vm.runInContext(`(${source.slice(fn.start, fn.end)})`, context);
  assert(active());
  context.flightPoints.enabled = false; assert(!active()); context.flightPoints.enabled = true;
  for (const flag of flags) { context[flag] = true; assert(!active(), flag); context[flag] = false; }
  context.freeMap.open = true; assert(!active()); context.freeMap.open = false;
  context.spaceScene.overview = true; assert(!active());
});

test("gate rendering stays camera-relative, bounded and non-collidable, and disposes its resources", () => {
  const scene = new Scene(), visuals = new PointVisuals(scene), points = activePoints(); points.start(frame());
  for (let i = 0; i < 50; i++) visuals.collect(gate(i));
  visuals.update(points, frame().position, .1, true, true);
  assert.equal(visuals.mesh.count, 23); assert.equal(visuals.root.position.x, 6378137);
  const matrix = new Matrix4(); visuals.mesh.getMatrixAt(0, matrix); assert(Math.abs(matrix.elements[12]) < 100);
  const hits = []; visuals.mesh.raycast({}, hits); assert.equal(hits.length, 0);
  visuals.update(points, frame().position, 10, true, false); assert.equal(visuals.mesh.count, 23);
  visuals.update(points, frame().position, 1, true, true); assert.equal(visuals.mesh.count, 7);
  let disposed = 0; visuals.geometry.addEventListener("dispose", () => disposed++); visuals.material.addEventListener("dispose", () => disposed++);
  visuals.dispose(); assert.equal(disposed, 2); assert.equal(scene.children.length, 0);
});
