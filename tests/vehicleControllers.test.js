import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { parseAst } from "rollup/parseAst";
import { PlaneController } from "../src/game/plane.js";
import { LunarController } from "../src/game/lunarController.js";
import { createVehicleController } from "../src/game/vehicleControllers.js";

// Exercise the actual menu specifications without booting the browser UI.
const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
const catalogue = parseAst(source).body.flatMap(node => node.declarations ?? []).find(node => node.id.name === "PLANES").init;
function vehicle(key) {
  const value = catalogue.properties.find(node => node.key.name === key).value;
  const spec = vm.runInNewContext(`(${source.slice(value.start, value.end)})`, {
    asset: path => path, prepareRocket() {}, createFalcon9() {}, createFalconHeavy() {},
  });
  return createVehicleController(52, 21, 6000, 0, spec);
}
function fly(plane, seconds, input = {}, fps = 60) {
  const controls = { pitch: 0, roll: 0, throttle: plane.cruiseT, ...input };
  for (let i = 0; i < Math.round(seconds * fps); i++) plane.update(1 / fps, controls);
}

test("Rocket uses aircraft flight: forward cruise, banked turns and leveling after releasing controls", () => {
  const plane = vehicle("rocket");
  assert.equal(plane.constructor, PlaneController);
  assert(!plane.isLunar);
  assert.equal(typeof plane.startLunarGuidance, "undefined");
  assert.equal(plane.speed, plane.cruise);
  const latitude = plane.lat;
  fly(plane, 10);
  assert(plane.lat > latitude, "cruise moves the aircraft forward");
  assert(Math.abs(plane.height - 6000) < 1e-8, "neutral controls maintain level cruise");
  fly(plane, 2, { pitch: .5, roll: .7 });
  assert(plane.height > 6000 && plane.pitch > 0, "pulling back climbs");
  assert(plane.heading > 0 && plane.roll < 0, "banking turns the aircraft");
  fly(plane, 4);
  assert(Math.abs(plane.pitch) < 1e-5 && Math.abs(plane.roll) < 1e-5, "released controls level the aircraft");
});

test("Rocket throttle settles at aircraft speed limits at different frame rates", () => {
  for (const fps of [30, 144]) {
    const plane = vehicle("rocket");
    fly(plane, 15, { throttle: 1 }, fps);
    assert(Math.abs(plane.speed - plane.boost) < .1, "full throttle approaches the configured maximum speed");
    fly(plane, 15, { throttle: 0 }, fps);
    assert(Math.abs(plane.speed - plane.brake) < .1, "idle slows the aircraft to its configured minimum speed");
    assert(plane.verticalSpeed < 0, "insufficient airspeed causes a stall descent");
  }
});

test("SpaceX Falcon 9 retains lunar physics and assisted Moon flight", () => {
  const falcon = vehicle("falcon9");
  assert(falcon instanceof LunarController);
  assert(falcon.isLunar && falcon.vertical);
  assert.equal(falcon.startLunarGuidance(), true);
  assert.equal(falcon.guidanceActive, true);
});

test("Falcon Heavy is selectable as a vertical lunar vehicle with clearance for its 70 m model", () => {
  const falcon = vehicle("falconHeavy");
  assert(falcon instanceof LunarController);
  assert(falcon.vertical);
  assert.equal(falcon.surfaceClearance, 35);
  assert.equal(falcon.startLunarGuidance(), true);
  const order = parseAst(source).body.flatMap(node => node.declarations ?? []).find(node => node.id.name === "PLANE_ORDER").init;
  assert(order.elements.some(node => node.value === "falconHeavy"));
});
