import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { parseAst } from "rollup/parseAst";
import { BALLOON_SPEC } from "../src/game/balloon.js";

const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
const ast = parseAst(source);
const functions = ["snapAgl", "spawnHoldAlt", "isTerrainSnap", "buildGoPayload", "applyGo"];
const tick = ast.body.find(node => node.type === "FunctionDeclaration" && node.id.name === "tickFrame");
const timeout = tick.body.body.find(node => node.type === "IfStatement" && source.slice(node.test.start, node.test.end).startsWith("awaitingSnap && performance.now() - awaitingSnapSince"));

function flight(mode = "free", surface = 100) {
  const events = [];
  const context = vm.createContext({
    PLANES: { balloon: BALLOON_SPEC, pa28: {} }, selectedPlane: "balloon", mode, guessScope: "world",
    guessHoldAlt: () => 10000, plane: { isBalloon: true, height: 6000 }, groundAlt: 120,
    snapBestGh: surface, snapLastGh: surface, pendingSnap: false, awaitingSnap: true, awaitingSnapSince: 0,
    performance: { now: () => 21000 }, ctrl: {}, camInit: true, menuOpen: true,
    mp: { snapInfo: new Map(), active: false, inRound: true, host: false, goSent: false, waitingGo: false, lastGo: null },
    armCrashGrace() {}, showMpWait() {}, hideMpWait() {}, seedAllMates() {},
    reportSnapped() { events.push("snapped"); },
    finishSnapStart() { events.push("start"); },
    retryFailedTiles() { events.push("retry"); }, el: { menuError: { textContent: "" } },
  });
  for (const name of functions) {
    const fn = ast.body.find(node => node.type === "FunctionDeclaration" && node.id.name === name);
    vm.runInContext(source.slice(fn.start, fn.end), context);
  }
  return { context, events, timeout() { vm.runInContext(source.slice(timeout.start, timeout.end), context); } };
}

test("balloon spawn clearance is 300 m in every supported mode without changing aircraft heights", () => {
  for (const mode of ["free", "home", "guess", "arcade"]) {
    const { context } = flight(mode);
    assert.equal(context.snapAgl(), 300);
    assert.equal(context.snapAgl("pa28"), mode === "guess" ? 350 : 320);
  }
});

test("a terrain timeout waits for a balloon measurement, then starts 300 m above low or mountainous terrain", () => {
  const f = flight("free", null);
  f.context.pendingSnap = true;
  f.timeout();
  assert(f.context.awaitingSnap && f.context.pendingSnap);
  assert.deepEqual(f.events, ["retry"]);
  assert.match(f.context.el.menuError.textContent, /300 m/);
  for (const surface of [-40, 120, 2400, 5700]) {
    f.context.snapBestGh = f.context.snapLastGh = surface;
    f.context.awaitingSnap = f.context.pendingSnap = true; f.context.awaitingSnapSince = 0;
    f.timeout();
    assert.equal(f.context.plane.height, surface + 300);
    assert.equal(f.context.groundAlt, surface);
    assert(!f.context.awaitingSnap && !f.context.pendingSnap);
    assert.equal(f.events.at(-1), "start");
  }
});

test("multiplayer balloons wait for local terrain and use their own clearance regardless of the host aircraft", () => {
  const { context, events } = flight("guess", null);
  context.applyGo({ h: 4850, gh: 4500, heading: 1 });
  assert(context.awaitingSnap && context.pendingSnap); assert.deepEqual(events, []);
  // A first tile is insufficient while the local terrain is still settling.
  context.snapBestGh = context.snapLastGh = 1900;
  context.applyGo({ h: 4850, gh: 4500, heading: 1 });
  assert.deepEqual(events, []);
  context.pendingSnap = false;
  context.applyGo({ h: 4850, gh: 4500, heading: 1 });
  assert.equal(context.plane.height, 2200); assert.equal(context.groundAlt, 1900);
  assert.equal(context.plane.heading, 1); assert.deepEqual(events, ["start"]);
  assert(!context.awaitingSnap && !context.pendingSnap);
});

test("a balloon host keeps shared aircraft altitude, and measured mountain spawns are valid near loading altitude", () => {
  const { context } = flight("free", 5700);
  const measured = { h: 6000, gh: 5700, probed: true };
  assert(context.isTerrainSnap(measured));
  assert(!context.isTerrainSnap({ ...measured, probed: false }));
  context.mp.snapInfo.set("host", measured);
  const payload = context.buildGoPayload();
  assert.equal(payload.h, 6020); assert.equal(payload.gh, 5700);
  context.plane.isBalloon = false; context.selectedPlane = "pa28";
  context.applyGo(payload);
  assert.equal(context.plane.height, 6020);
});
