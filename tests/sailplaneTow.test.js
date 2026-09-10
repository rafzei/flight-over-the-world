import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Group, Matrix4, Scene, Vector3 } from "three";
import { WGS84_ELLIPSOID, CAMERA_FRAME } from "3d-tiles-renderer";
import { GrassFields, parseGrassFields } from "../src/game/grassFields.js";
import { GrassLanding, checkTowPath, sampleGrassSurface, offsetFlight } from "../src/game/grassLanding.js";
import { SailplaneTow, TowVisuals, parseTowSnapshot } from "../src/game/sailplaneTow.js";
import { SAILPLANE_SPEC, createSailplane } from "../src/game/sailplane.js";
import { createVehicleController } from "../src/game/vehicleControllers.js";
import { attachLandingGear } from "../src/game/landingGear.js";
import { LandingSystem, flightPose } from "../src/game/landingDynamics.js";
import { WarsawRunway } from "../src/game/warsawRunway.js";
import { disposeModelResources } from "../src/game/vehicleModels.js";

const DEG = Math.PI / 180;
const ring = (south, west, north, east) => [{ lat: south, lon: west }, { lat: north, lon: west }, { lat: north, lon: east }, { lat: south, lon: east }, { lat: south, lon: west }];
const meadow = { type: "way", id: 1, tags: { landuse: "meadow" }, geometry: ring(51.97, 20.97, 52.03, 21.03) };
const flat = () => ({ surface: 100, ground: 100 });
function grass() { const fields = new GrassFields(); fields.cache.push({ lat: 52, lon: 21, ...parseGrassFields({ elements: [meadow] }) }); return fields; }
function rig(dt = 1 / 60) {
  const p = createVehicleController(52, 21, 110, 0, SAILPLANE_SPEC), model = createSailplane(), wrapper = new Group();
  model.position.sub(new Box3().setFromObject(model).getCenter(new Vector3())); wrapper.add(model);
  const landing = new LandingSystem(new WarsawRunway()); landing.gear = attachLandingGear(wrapper, model, "sailplane");
  const fields = grass(), ground = new GrassLanding(fields), tow = new SailplaneTow();
  assert(ground.update(p, landing, flat, dt));
  for (let i = 0; i < Math.ceil(30 / dt) && !landing.grounded; i++) {
    ground.update(p, landing, flat, dt);
    const before = flightPose(p); p.update(dt, { pitch: 0, roll: 0, airbrake: .1 });
    assert(!landing.resolve(p, before, dt).crash);
  }
  assert(landing.grounded);
  for (let i = 0; i < Math.ceil(10 / dt); i++) {
    ground.update(p, landing, flat, dt);
    assert(!landing.roll(p, dt, { throttle: 1, roll: 0, pitch: 0, wheelBrake: true }).crash);
  }
  assert.equal(p.speed, 0);
  return { p, model, wrapper, landing, fields, ground, tow, dispose() { tow.reset(); landing.gear.dispose(); disposeModelResources(model); } };
}

test("only mapped grass qualifies; buildings, water and relation holes stay excluded", () => {
  const fields = grass(); assert(fields.at(52 * DEG, 21 * DEG)); assert(!fields.at(53 * DEG, 21 * DEG));
  fields.cache.unshift(parseGrassFields({ elements: [{ type: "way", id: 2, tags: { building: "yes" }, geometry: ring(51.999, 20.999, 52.001, 21.001) }] }));
  assert(!fields.at(52 * DEG, 21 * DEG));
  const polygon = { type: "relation", id: 3, tags: { natural: "grassland" }, members: [
    { role: "outer", geometry: meadow.geometry.slice(0, 3) },
    { role: "outer", geometry: meadow.geometry.slice(2) },
    { role: "inner", geometry: ring(51.999, 20.999, 52.001, 21.001) },
  ] };
  fields.cache = [parseGrassFields({ elements: [polygon] })];
  assert(!fields.at(52 * DEG, 21 * DEG)); assert(fields.at(52.01 * DEG, 21 * DEG));
});

test("grass queries coalesce, cache their area and back off after an outage", async () => {
  let calls = 0, fail = false, now = 0;
  const fields = new GrassFields({ now: () => now, fetchImpl: async () => { calls++; if (fail) throw new Error("offline"); return { ok: true, json: async () => ({ elements: [meadow] }) }; } });
  const p = { lat: 52 * DEG, lon: 21 * DEG };
  await Promise.all([fields.update(p), fields.update(p)]); assert.equal(calls, 1);
  await fields.update(p); assert.equal(calls, 1);
  fail = true; await fields.update({ lat: 53 * DEG, lon: 21 * DEG }); assert.equal(fields.status, "unavailable");
  await fields.update({ lat: 53 * DEG, lon: 21 * DEG }); assert.equal(calls, 2);
  now = 31000; await fields.update({ lat: 53 * DEG, lon: 21 * DEG }); assert.equal(calls, 3);
});

test("grass landing uses terrain heights and rejects roofs, missing tiles, slopes and rough ground", () => {
  const fields = grass(), p = createVehicleController(52, 21, 120, 0, SAILPLANE_SPEC);
  assert(sampleGrassSurface(p, fields, flat));
  assert.equal(sampleGrassSurface(p, fields, () => ({ surface: null, ground: null })), null);
  assert.equal(sampleGrassSurface(p, fields, () => ({ surface: 110, ground: 100 })), null);
  assert.equal(sampleGrassSurface(p, fields, lat => ({ surface: 100 + (lat - p.lat) * 6378137 * .2, ground: 100 + (lat - p.lat) * 6378137 * .2 })), null);
  assert.equal(sampleGrassSurface(p, fields, lat => ({ surface: Math.abs(lat - p.lat) < 1e-7 ? 100 : 102, ground: Math.abs(lat - p.lat) < 1e-7 ? 100 : 102 })), null);
  const r = rig(); assert(r.landing.runway.isGrass); assert(r.landing.feet(r.p).every(w => Math.abs(w.point.y) < .02)); r.dispose();
});

test("tow requires a stopped glider and a clear ground run and climb corridor", () => {
  const r = rig();
  try {
    assert.equal(checkTowPath(r.p, r.landing.runway, r.fields, flat), null);
    const obstacle = offsetFlight(r.p, 125);
    const blocked = lat => Math.abs(lat - obstacle.lat) < 10 / 6378137 ? { surface: 112, ground: 100 } : flat();
    assert.match(checkTowPath(r.p, r.landing.runway, r.fields, blocked), /rough|obstructed/);
    assert(!r.tow.call(r.p, r.landing, () => "Obstacle ahead")); assert.equal(r.tow.phase, "idle");
    r.p.speed = 5; assert(!r.tow.call(r.p, r.landing, () => null)); r.p.speed = 0;
    assert(r.tow.call(r.p, r.landing, () => null)); assert(!r.tow.call(r.p, r.landing, () => null));
    assert.equal(r.tow.phase, "arriving"); r.tow.update(12, r.p, r.landing); assert.equal(r.tow.phase, "hooking");
    assert(r.tow.release(r.p, r.landing)); assert(!r.tow.attached); assert(r.landing.grounded); assert.equal(r.p.speed, 0);
  } finally { r.dispose(); }
});

test("Cessna tows a stopped glider off grass, climbs and releases at 350 m at multiple frame rates", () => {
  for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
    const r = rig(dt);
    try {
      assert(r.tow.call(r.p, r.landing, () => checkTowPath(r.p, r.landing.runway, r.fields, flat)));
      const initial = r.p.height; let tookOff = false;
      for (let i = 0; i < 170 / dt && r.tow.phase !== "departing"; i++) {
        r.tow.update(dt, r.p, r.landing);
        if (r.tow.attached) {
          const before = flightPose(r.p), result = r.tow.step(dt, r.p, r.landing);
          assert(!result?.crash); assert.equal(r.p.throttle, 0);
          if (!r.landing.grounded) {
            tookOff = true;
            if (r.p.height < initial + 30) assert(!r.landing.resolve(r.p, before, dt).crash);
          }
        }
      }
      assert(tookOff); assert.equal(r.tow.phase, "departing"); assert(!r.tow.attached);
      assert(r.tow.releaseAltitude >= 350 && r.tow.releaseAltitude < 350.2);
      assert(r.p.height > initial + 340); assert(!r.landing.grounded);
      const energy = 9.81 * r.p.height + .5 * r.p.speed ** 2;
      for (let i = 0; i < 15 / dt; i++) r.p.update(dt, { pitch: 0, roll: 0, throttle: 1 });
      assert(r.p.verticalSpeed < 0); assert(9.81 * r.p.height + .5 * r.p.speed ** 2 < energy);
      r.tow.update(11, r.p, r.landing); assert.equal(r.tow.phase, "idle"); assert.equal(r.tow.snapshot(), null);
    } finally { r.dispose(); }
  }
});

test("tow cancellation, pause, remote state and visible cable retain bounded finite geometry", () => {
  const r = rig(), scene = new Scene(), remote = new TowVisuals(); scene.add(r.wrapper);
  const frame = (lat, lon, h, heading, pitch, roll) => WGS84_ELLIPSOID.getObjectFrame(lat, lon, h, heading, pitch, roll, new Matrix4(), CAMERA_FRAME);
  try {
    r.tow.call(r.p, r.landing, () => null); r.tow.update(12, r.p, r.landing); r.tow.update(2, r.p, r.landing);
    for (let i = 0; i < 900; i++) { r.tow.update(1 / 60, r.p, r.landing); r.tow.step(1 / 60, r.p, r.landing); }
    assert.equal(r.tow.phase, "climbing");
    const before = r.tow.snapshot(), height = r.p.height, elapsed = r.tow.elapsed; r.tow.update(0, r.p, r.landing); r.tow.step(0, r.p, r.landing);
    assert.equal(r.p.height, height); assert.equal(r.tow.elapsed, elapsed);
    frame(r.p.lat, r.p.lon, r.p.height, r.p.heading, r.p.pitch, 0).decompose(r.wrapper.position, r.wrapper.quaternion, r.wrapper.scale);
    remote.update(scene, frame, r.wrapper, parseTowSnapshot(r.tow.snapshot()), 0);
    assert(remote.aircraft.visible); assert(remote.rope.visible);
    const positions = remote.rope.geometry.attributes.position; assert([...positions.array].every(Number.isFinite));
    const length = new Vector3().fromBufferAttribute(positions, 0).distanceTo(new Vector3().fromBufferAttribute(positions, positions.count - 1));
    assert(length > 30 && length < 50);
    assert.equal(parseTowSnapshot({ ...before, lat: Infinity }), null);
    assert(r.tow.release(r.p, r.landing)); assert.equal(r.p.throttle, 0); assert(!r.tow.attached);
    r.tow.render(scene, frame, r.wrapper, 0); assert(!r.tow.visuals.rope.visible);
    r.tow.reset(); assert.equal(r.tow.phase, "idle"); assert.equal(r.tow.visuals.aircraft, null);
  } finally { remote.dispose(); r.dispose(); }
});
