import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import {
  SPACE_CONSTANTS as C, MOON_ORBIT_NORMAL, ecefToGeodetic, ecefToInertial,
  geodeticToECEF, gravityAcceleration, inertialToECEF, moonPositionECEF,
  moonPositionInertial, moonVelocityInertial, surfaceVelocityInertial,
} from "../src/game/spacePhysics.js";
import { LunarController } from "../src/game/lunarController.js";
import { createVehicleController } from "../src/game/vehicleControllers.js";

const near = (actual, expected, tolerance, label = "") => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected} ±${tolerance}`);
function inertialState(controller, position, velocity) {
  controller.positionInertial.copy(position);
  controller.velocityInertial.copy(velocity);
  controller._publishPose();
}

test("physical scales, sidereal rotation and WGS84 positions share one coordinate system", () => {
  near(C.EARTH_MEAN_RADIUS, 6371000, 0);
  near(C.MOON_RADIUS, 1737400, 0);
  near(C.MOON_DISTANCE, 384400000, 0);
  const surface = geodeticToECEF(0, 0, 0);
  near(surfaceVelocityInertial(surface).length(), 465.1, .01);
  const quarterTurn = ecefToInertial(surface, C.EARTH_SIDEREAL_PERIOD / 4);
  near(quarterTurn.x, 0, 1e-6);
  near(quarterTurn.y, C.EARTH_EQUATORIAL_RADIUS, 1e-6);
  assert.ok(inertialToECEF(quarterTurn, C.EARTH_SIDEREAL_PERIOD / 4).distanceTo(surface) < 1e-6);
  for (const [lat, lon, height] of [[0, 0, 0], [52.23, 21.01, 500], [-89.9, -170, 1000], [28, 44, 378000000], [90, 0, 123]]) {
    const pose = ecefToGeodetic(geodeticToECEF(lat * Math.PI / 180, lon * Math.PI / 180, height));
    near(pose.lat, lat * Math.PI / 180, 1e-10);
    near(pose.lon, lon * Math.PI / 180, 1e-10);
    near(pose.height, height, .00001);
  }
  const moon0 = moonPositionInertial(0), moonQuarter = moonPositionInertial(C.MOON_ORBITAL_PERIOD / 4);
  near(moon0.length(), C.MOON_DISTANCE, .001);
  near(moonQuarter.length(), C.MOON_DISTANCE, .001);
  near(moon0.dot(moonQuarter) / C.MOON_DISTANCE ** 2, 0, 1e-12);
  near(moonVelocityInertial(0).length(), 1023.1573, .001);
  assert.ok(moonPositionECEF(1234).distanceTo(inertialToECEF(moonPositionInertial(1234), 1234)) < 1e-6);
});

test("Earth and Moon gravity weaken with distance and lunar gravity dominates at the Moon", () => {
  const surface = new Vector3(0, C.EARTH_MEAN_RADIUS, 0);
  const lowGravity = gravityAcceleration(surface).length();
  const highGravity = gravityAcceleration(surface.clone().multiplyScalar(2)).length();
  near(lowGravity, 9.82025, .001);
  near(lowGravity / highGravity, 4, .001);
  const point = moonPositionInertial(0).add(new Vector3(0, C.MOON_RADIUS, 0));
  const lunarGravity = gravityAcceleration(point, 0);
  near(lunarGravity.y, -1.6242, .001);
  assert.ok(Math.abs(lunarGravity.x) < .01);
});

test("launch inherits surface rotation; vacuum coasting conserves inertia without the old speed cap", () => {
  const controller = createVehicleController(0, 0, 500, 0, { flightModel: "lunar", vertical: true, boost: 2222 });
  assert.ok(controller instanceof LunarController);
  near(controller.velocityInertial.y, C.EARTH_ANGULAR_SPEED * (C.EARTH_EQUATORIAL_RADIUS + 500), .0001);
  const point = new Vector3(0, -100000000, 0), velocity = new Vector3(15000, 3000, 2000);
  inertialState(controller, point, velocity);
  controller.throttle = 0;
  const gravity = gravityAcceleration(point, 0);
  controller.update(.1, { throttle: 0, pitch: 0, roll: 0 });
  const expectedVelocity = velocity.clone().addScaledVector(gravity, .1);
  assert.ok(controller.velocityInertial.distanceTo(expectedVelocity) < 1e-6);
  assert.ok(controller.speed > 15000, "speed is not clamped to the old 8000 km/h UI value");
  const orientation = controller.orientationInertial.clone();
  for (let i = 0; i < 20; i++) controller.update(.1, { throttle: 0 });
  assert.ok(controller.orientationInertial.angleTo(orientation) < 1e-7, "released controls preserve inertial attitude");
  const speedBefore = controller.speed;
  controller._pointThrust(controller.velocityInertial);
  for (let i = 0; i < 100; i++) controller.update(.1, { throttle: 1 });
  assert.ok(controller.speed > speedBefore + 350, "continued thrust keeps accelerating in vacuum");
});

test("accelerated integration preserves an unpowered Earth orbit", () => {
  const radius = C.EARTH_EQUATORIAL_RADIUS + 400000;
  const make = () => {
    const c = new LunarController(0, 0, 400000, 0, { vertical: true });
    inertialState(c, new Vector3(radius, 0, 0), new Vector3(0, Math.sqrt(C.EARTH_MU / radius), 0));
    c.throttle = 0;
    return c;
  };
  const realtime = make(), accelerated = make();
  accelerated.setTimeWarp(1000);
  for (let i = 0; i < 10000; i++) realtime.update(.1, { throttle: 0 });
  for (let i = 0; i < 10; i++) accelerated.update(.1, { throttle: 0 });
  near(realtime.simulationTime, accelerated.simulationTime, 1e-8);
  assert.ok(accelerated.positionInertial.distanceTo(realtime.positionInertial) < 300, "10 s integration steps retain orbital accuracy over 1000 s");
  const energy0 = -C.EARTH_MU / (2 * radius);
  const energy = accelerated.velocityInertial.lengthSq() / 2 - C.EARTH_MU / accelerated.positionInertial.length();
  assert.ok(Math.abs((energy - energy0) / energy0) < .00002);
});

test("lunar guidance supports both body orientations through actual integrated motion", () => {
  for (const vertical of [true, false]) {
    // Opposite-side launch requires a safe dogleg around Earth, not a straight
    // chord through the planet. Warsaw verifies the regular playable start.
    for (const [lat, lon] of [[52.23, 21.01], [0, 180]]) {
      const c = new LunarController(lat, lon, 500, 0, { vertical });
      assert.equal(c.startLunarGuidance(), true);
      c.setTimeWarp(1000);
      const phases = new Set();
      let peakSpeed = 0, travelled = 0, frames = 0;
      for (; frames < 3000 && c.spaceStatus === "flight"; frames++) {
        const before = c.positionInertial.clone();
        const beforeTime = c.simulationTime;
        c.update(.1, {});
        const distance = before.distanceTo(c.positionInertial);
        travelled += distance;
        phases.add(c.guidancePhase);
        peakSpeed = Math.max(peakSpeed, c.speed);
        assert.ok(c.height > 499, "the trajectory stays outside Earth");
        assert.ok(distance <= 13000 * (c.simulationTime - beforeTime) + 1, "no mission phase teleports the vehicle");
      }
      assert.equal(c.spaceStatus, "landed-moon", JSON.stringify(c.diagnostics()));
      assert.ok(phases.has("ascent") && phases.has("dogleg") && phases.has("transfer") && phases.has("lunar-descent"));
      assert.ok(c.simulationTime > 30000 && c.simulationTime < 50000);
      assert.ok(travelled > 370000000 && peakSpeed > 11000);
      assert.ok(c.touchdownSpeedMps < 2);
      near(c.diagnostics().moonAltitudeM, 0, .00001);
      const landedPosition = c.positionInertial.clone();
      c.setTimeWarp(1000);
      c.update(.1, {});
      assert.equal(c.spaceStatus, "landed-moon");
      near(c.diagnostics().moonAltitudeM, 0, .00001);
      near(c.diagnostics().relativeMoonSpeedMps, 0, 1e-8);
      assert.ok(c.positionInertial.distanceTo(landedPosition) > 100000, "landed craft follows the orbiting/rotating lunar surface");
    }
  }
});

test("manual lunar contact distinguishes gentle upright landing from impact and cannot tunnel", () => {
  for (const [speed, tilted, expected] of [[2, false, "landed-moon"], [100, false, "impact-moon"], [2, true, "impact-moon"]]) {
    const c = new LunarController(0, 0, 1000, 0, { vertical: true });
    const moon = moonPositionInertial(0), normal = new Vector3(-1, 0, 0);
    const offset = normal.clone().multiplyScalar(C.MOON_RADIUS + c.surfaceClearance + 1);
    const surfaceVelocity = moonVelocityInertial(0).add(new Vector3().crossVectors(MOON_ORBIT_NORMAL, offset).multiplyScalar(2 * Math.PI / C.MOON_ORBITAL_PERIOD));
    inertialState(c, moon.add(offset), surfaceVelocity.addScaledVector(normal, -speed));
    c.throttle = 0;
    c._pointThrust(tilted ? new Vector3(0, 1, 0) : normal);
    for (let i = 0; i < 50 && c.spaceStatus === "flight"; i++) c.update(.1, { throttle: 0 });
    assert.equal(c.spaceStatus, expected);
    near(c.diagnostics().moonAltitudeM, 0, .00001);
  }
  const c = new LunarController(0, 0, 1000, 0, { vertical: true });
  inertialState(c, new Vector3(C.EARTH_EQUATORIAL_RADIUS + 2000000, 0, 0), new Vector3(-10000000, 0, 0));
  c.throttle = 0; c.setTimeWarp(1000); c.update(.1, { throttle: 0 });
  assert.equal(c.spaceStatus, "impact-earth", "swept contact detects crossing the entire planet within a time-warp step");
});

test("spawn rebasing, guidance cancellation and near-surface warp limits preserve control", () => {
  const c = new LunarController(52, 21, 500, 0, { vertical: true });
  c.startLunarGuidance(); c.setTimeWarp(1000); c.update(.1, {});
  near(c.simulationTime, .1, 1e-8);
  assert.equal(c.effectiveTimeWarp, 1);
  c.stopLunarGuidance();
  assert.equal(c.guidancePhase, "manual");
  assert.equal(c.timeWarp, 1);
  c.lat = -.4; c.lon = 1.2; c.height = 250000;
  c.throttle = 0; c.update(.01, { throttle: 0 });
  near(c.lat, -.4, .000001);
  near(c.lon, 1.2, .000001);
  near(c.height, 250000, .01);
  assert.equal(c.spaceStatus, "flight");
  assert.equal(c.guidanceActive, false);
  const bodyAxis = new Vector3(0, 1, 0).applyQuaternion(c.orientationECEF);
  const inertialAxis = new Vector3(0, 1, 0).applyQuaternion(c.orientationInertial);
  assert.ok(ecefToInertial(bodyAxis, c.simulationTime).distanceTo(inertialAxis) < 1e-12);
  near(c.orientationInertial.length(), new Quaternion().length(), 1e-12);
});
