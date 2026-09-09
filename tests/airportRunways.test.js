import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Box3, Vector3 } from 'three';
import { AirportRunways, POLISH_RUNWAYS, DEFAULT_APPROACH } from '../src/game/airportRunways.js';
import { Runway } from '../src/game/runway.js';
import { LandingSystem, flightPose } from '../src/game/landingDynamics.js';
import { PlaneController, createPlaneMesh } from '../src/game/plane.js';
import { attachLandingGear } from '../src/game/landingGear.js';
import { disposeModelResources } from '../src/game/vehicleModels.js';

const DEG = Math.PI / 180;

test('Polish catalogue has unique paved runways, excludes closed fields and includes regional airfields', () => {
  const ids = new Set();
  for (const r of POLISH_RUNWAYS) {
    assert(!ids.has(r.id)); ids.add(r.id);
    assert(r.lat > 49 && r.lat < 55 && r.lon > 14 && r.lon < 24.2);
    assert(r.length >= 250 && r.width >= 8 && Number.isFinite(r.elevation));
    assert(!/grass|grs|unk/i.test(r.surface));
    assert(r.ends.length === 2 && r.ends.every(e => e.threshold >= 0));
    assert(r.ends.reduce((sum, e) => sum + e.threshold, 0) < r.length);
    assert(r.sources.length >= 2);
  }
  for (const id of ['EPWA', 'EPKK', 'EPGD', 'EPWR', 'EPMO', 'EPBK', 'EPGL', 'EPCD', 'EPPG', 'EPSU', 'EPGY']) {
    assert(POLISH_RUNWAYS.some(r => r.airportId === id), id);
  }
  for (const id of ['PL-0264', 'PL-0265', 'PL-0272', 'PL-0273', 'EPSW']) assert(!POLISH_RUNWAYS.some(r => r.airportId === id));
  assert(!ids.has('EPTO-02-20'));
});

test('both directions of every runway use exactly the same physical plane', () => {
  for (const data of POLISH_RUNWAYS) {
    const runway = new Runway(data);
    for (const along of [0, data.length / 2, data.length]) {
      const pose = runway.pose(3, along, 2), reverse = runway.opposite.coordinates(pose);
      assert(Math.abs(reverse.x + 3) < .00001);
      assert(Math.abs(reverse.y - 2) < .00001);
      assert(Math.abs(reverse.z + data.length - along) < .00001);
    }
  }
});

test('automatic selection finds each pavement in both directions and locks during ground roll', () => {
  const network = new AirportRunways();
  const warsaw = network.get(DEFAULT_APPROACH);
  for (const approach of network.approaches) {
    const d = approach.definition;
    const plane = { ...approach.pose(0, d.threshold + (d.length - d.threshold) * .2, 10), heading: d.heading * DEG };
    assert.equal(network.choose(plane, { current: warsaw }).definition.id, d.id, d.id);
    assert.equal(network.choose(plane, { current: warsaw, locked: true }), warsaw);
  }
  assert.equal(network.nearby({ lat: 0, lon: 0 }).length, 0);
});

test('calibration follows high, low and sloped terrain, shares it with reverse approach, and ignores missing tiles', () => {
  for (const elevation of [40, 480]) {
    const runway = new Runway({ ...POLISH_RUNWAYS[0], elevation });
    const probe = (lat, lon) => {
      const p = runway.coordinates({ lat, lon, height: elevation });
      return elevation + 2 + (-p.z) * .008;
    };
    assert(runway.calibrate(probe)); assert(runway.slope > 0);
    for (const end of runway.directions) {
      const pose = end.pose(0, end.definition.length / 2, 0);
      assert(Math.abs(runway.coordinates(pose).y) < 1e-6);
    }
    assert(!runway.calibrate(() => 1000));
  }
  const missing = new Runway(POLISH_RUNWAYS[0]);
  assert(!missing.calibrate(() => null)); assert(!missing.calibrated);
  assert(!missing.calibrate(() => -100));
});

test('a light aircraft touches down, rolls and brakes on every runway in either direction', () => {
  const model = createPlaneMesh(), wrapper = new Group();
  model.position.sub(new Box3().setFromObject(model).getCenter(new Vector3())); wrapper.add(model);
  const gear = attachLandingGear(wrapper, model, 'pa28');
  const surfaces = POLISH_RUNWAYS.map(data => new Runway(data));
  const sloped = new Runway(POLISH_RUNWAYS.find(r => r.airportId === 'EPKK'));
  sloped.slope = .018; sloped.rebuildFrame(); surfaces.push(sloped);
  for (const physical of surfaces) for (const runway of physical.directions) {
    const system = new LandingSystem(runway); system.gear = gear; gear.reset();
    const d = runway.definition;
    const p = runway.pose(0, d.threshold + 40, 10);
    const plane = new PlaneController(p.lat / DEG, p.lon / DEG, p.height, d.heading);
    plane.pitch = runway.groundPitch + 3 * DEG; plane.speed = gear.speed; plane.verticalSpeed = -1.5; plane.throttle = 0;
    system.align(plane); plane.height += .08;
    for (let i = 0; i < 20 && !system.grounded; i++) {
      const before = flightPose(plane), at = runway.coordinates(plane);
      Object.assign(plane, runway.pose(at.x, -at.z + plane.speed / 60, at.y - 1.5 / 60));
      const result = system.resolve(plane, before, 1/60); assert(!result.crash, `${d.id}: ${result.crash}`);
    }
    assert(system.grounded, d.id);
    for (let i = 0; i < 1200 && plane.speed > 0; i++) {
      gear.update(1/60, plane.speed, true);
      const result = system.roll(plane, 1/60, { throttle: 0, roll: 0, pitch: 0, wheelBrake: true });
      assert(!result.crash, `${d.id}: ${result.crash}`);
    }
    assert.equal(plane.speed, 0, d.id);
    assert(system.feet(plane).every(w => Math.abs(w.point.y) < .02), d.id);
  }
  gear.dispose(); disposeModelResources(model);
});
