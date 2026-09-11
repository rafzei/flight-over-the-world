import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { SOLAR_BODIES, SOLAR_BODY_BY_ID, FLIGHT_DESTINATIONS, bodyPositionInertial, heliocentricPosition, AU } from '../src/game/solarSystem.js';
import { planSolarTransfer, advanceSolarTransfer } from '../src/game/solarTransfer.js';
import { LunarController } from '../src/game/lunarController.js';
import { SPACE_CONSTANTS as C, MOON_ORBIT_NORMAL, moonPositionInertial, moonVelocityInertial } from '../src/game/spacePhysics.js';
import { lunarSurfaceHeight, lunarAltitude, lunarSurfaceNormal, lunarTerrainHeight, moonBodyOrientation, LUNAR_MAX_RELIEF } from '../src/game/lunarTerrain.js';
import { createStarfield, starBrightness } from '../src/game/starfield.js';

test('the Sun and all eight planets have finite, consistently scaled moving orbits', () => {
  assert.equal(SOLAR_BODIES.filter(b => b.au).length, 8);
  for (const time of [0, 1000000, 365 * 86400]) for (const b of SOLAR_BODIES) {
    assert(bodyPositionInertial(b.id, time).toArray().every(Number.isFinite));
    if (b.au) assert(Math.abs(heliocentricPosition(b, time).length() / AU - b.au) < 1e-12);
  }
  assert.equal(bodyPositionInertial('earth', 300).length(), 0);
  assert(bodyPositionInertial('neptune', 0).distanceTo(bodyPositionInertial('neptune', 86400)) > 1e8);
});

test('all destinations are reachable from Earth and in a planet-to-planet tour without entering another body', () => {
  const launch = new Vector3(C.EARTH_EQUATORIAL_RADIUS + 1000, 0, 0);
  for (const initial of [launch, launch.clone().negate()]) {
    let start = initial.clone(), time = 0;
    for (const id of FLIGHT_DESTINATIONS.filter(id => id !== 'moon')) {
      const transfer = planSolarTransfer(start, id, time);
      let last = start.clone(), distance = 0;
      for (let i = 0; i < 650 && transfer.elapsed < transfer.duration; i++) {
        const state = advanceSolarTransfer(transfer, .1);
        distance += state.position.distanceTo(last); last = state.position;
        const now = transfer.startTime + transfer.elapsed;
        for (const body of SOLAR_BODIES) {
          assert(state.position.distanceTo(bodyPositionInertial(body.id, now)) > body.radius, `${id} path entered ${body.id}`);
        }
      }
      assert.equal(transfer.elapsed, transfer.duration);
      const target = SOLAR_BODY_BY_ID[id];
      assert(Math.abs(last.distanceTo(bodyPositionInertial(id, time + transfer.duration)) / target.radius - (id === 'sun' ? 5 : 3.4)) < 1e-6);
      assert(distance > 1e6);
      start = last; time += transfer.duration;
    }
  }
});

test('the actual controller arrives, holds an orbit, changes planets, returns to the Moon and takes off', () => {
  const c = new LunarController(52, 21, 1000, 0, { vertical: true });
  for (const id of FLIGHT_DESTINATIONS.filter(id => id !== 'moon')) {
    assert(c.startDestinationGuidance(id));
    for (let n = 0; n < 700 && c.solarTransfer; n++) c.update(.1);
    assert.equal(c.spaceStatus, `orbit-${id}`, JSON.stringify(c.diagnostics()));
    assert.equal(c.guidanceActive, false); assert.equal(c.crashed, false);
    const altitude = c.diagnostics().targetAltitudeM;
    c.setTimeWarp(1000); c.update(1);
    assert(Math.abs(c.diagnostics().targetAltitudeM - altitude) < .01);
  }
  assert(c.startDestinationGuidance('moon'));
  for (let n = 0; n < 700 && c.solarTransfer; n++) c.update(.1);
  assert.equal(c.guidancePhase, 'lunar-descent');
  c.setTimeWarp(1000);
  for (let n = 0; n < 3000 && c.spaceStatus === 'flight'; n++) c.update(.1);
  assert.equal(c.spaceStatus, 'landed-moon', JSON.stringify(c.diagnostics()));
  assert(c.launchFromMoon()); c.update(1, { throttle: .2 });
  assert.equal(c.spaceStatus, 'flight'); assert(c.diagnostics().moonAltitudeM > 2);
  c.startDestinationGuidance('mars'); c.update(2); c.stopLunarGuidance();
  assert.equal(c.solarTransfer, null); assert.equal(c.guidanceActive, false);
  assert(c.speed < 100000, 'cruise can be cancelled without retaining its fictional transit speed');
});

test('manual contact follows off-site lunar relief, with a stable body-fixed landed position', () => {
  const time = 32000, bodyDirection = new Vector3(1, .003, .005).normalize();
  const normal = bodyDirection.clone().applyQuaternion(moonBodyOrientation(time));
  const height = lunarSurfaceHeight(normal, time);
  assert(Math.abs(height) > 1, 'off-site terrain differs from the mean sphere');
  const c = new LunarController(0, 0, 1000, 0, { vertical: true });
  c.simulationTime = time;
  const offset = normal.clone().multiplyScalar(C.MOON_RADIUS + height + c.surfaceClearance + .5);
  c.positionInertial.copy(moonPositionInertial(time)).add(offset);
  c.velocityInertial.copy(moonVelocityInertial(time)).add(new Vector3().crossVectors(MOON_ORBIT_NORMAL, offset).multiplyScalar(2 * Math.PI / C.MOON_ORBITAL_PERIOD)).addScaledVector(normal, -.5);
  c._pointThrust(lunarSurfaceNormal(normal, time)); c.throttle = 0; c._publishPose();
  for (let n = 0; n < 50 && c.spaceStatus === 'flight'; n++) c.update(.05, { throttle: 0 });
  assert.equal(c.spaceStatus, 'landed-moon');
  c.setTimeWarp(1000); c.update(1);
  assert(Math.abs(c.diagnostics().moonAltitudeM) < .0001);
  const currentDirection = c.positionInertial.clone().sub(moonPositionInertial(c.simulationTime)).normalize().applyQuaternion(moonBodyOrientation(c.simulationTime).invert());
  assert(currentDirection.distanceTo(bodyDirection) < .00001);
  for (let i = 0; i < 200; i++) {
    const d = new Vector3(Math.cos(i * 7.1), Math.sin(i * 3.3), Math.cos(i * 2.3));
    assert(Math.abs(lunarTerrainHeight(d)) < LUNAR_MAX_RELIEF);
  }
});

test('stars have independent animated brightness, stay fixed in direction, and fade with daylight', () => {
  const stars = createStarfield({ count: 50 });
  const positions = stars.geometry.attributes.position.array.slice();
  const phases = stars.geometry.attributes.phase.array, rates = stars.geometry.attributes.rate.array;
  assert(new Set(phases).size === 50);
  assert(phases.some((phase, i) => Math.abs(starBrightness(0, phase, rates[i]) - starBrightness(1, phase, rates[i])) > .3));
  stars.userData.update(12, 0); assert.equal(stars.visible, false);
  stars.userData.update(13, 1); assert.equal(stars.visible, true);
  assert.equal(stars.material.uniforms.time.value, 13);
  assert.deepEqual(stars.geometry.attributes.position.array, positions);
  stars.geometry.dispose(); stars.material.dispose();
});
