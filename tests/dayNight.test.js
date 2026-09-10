import test from 'node:test';
import assert from 'node:assert/strict';
import { FogExp2, Vector3 } from 'three';
import { solarPosition, localSolarState } from '../src/game/dayNight.js';
import { createSky } from '../src/game/sky.js';
import { createFlightClock, flightTimeZone } from '../src/game/flightClock.js';

const RAD = Math.PI / 180;
const at = date => solarPosition(Date.parse(date));
const local = (date, lat, lon, altitude = 0) => localSolarState(at(date), lat * RAD, lon * RAD, altitude);
const near = (value, expected, tolerance) => assert(Math.abs(value - expected) < tolerance, `${value} ≠ ${expected}`);

test('UTC solar coordinates agree with the NREL reference and seasonal declinations', () => {
  // NREL SPA example: 17 Oct 2003, 12:30:30 at UTC−7, Colorado.
  near(local('2003-10-17T19:30:30Z', 39.742476, -105.1786).elevation, 39.872, .06);
  near(at('2026-03-20T12:00:00Z').declination / RAD, 0, .1);
  near(at('2026-06-21T12:00:00Z').declination / RAD, 23.44, .03);
  near(at('2026-12-21T12:00:00Z').declination / RAD, -23.44, .03);
  near(at('2000-01-01T12:00:00Z').siderealAngle / RAD, 280.46061837, 1e-7);
});

test('Earth spins east at the sidereal rate while the daylight boundary moves west', () => {
  const a = at('2026-03-20T06:00:00Z'), b = at('2026-03-20T12:00:00Z');
  const positive = angle => (angle + Math.PI * 2) % (Math.PI * 2);
  near(positive(b.siderealAngle - a.siderealAngle) / RAD, 90.246412, .00001);
  near(positive(a.subsolarLongitude - b.subsolarLongitude) / RAD, 90, .1);
  near(a.sunECEF.length(), 1, 1e-12);
  assert(localSolarState(a, a.declination, a.subsolarLongitude).elevation > 89.999);
  assert(localSolarState(a, -a.declination, a.subsolarLongitude + Math.PI).elevation < -89.999);
  const reconstructed = a.sunECEF.clone().applyAxisAngle(new Vector3(0, 0, 1), a.siderealAngle);
  assert(reconstructed.distanceTo(a.sunInertial) < 1e-12);
});

test('day, night, both twilights and polar seasons follow position rather than browser time zone', () => {
  assert.equal(local('2026-03-20T12:00:00Z', 52.23, 21.01).phase, 'Day');
  assert.equal(local('2026-03-20T00:00:00Z', 52.23, 21.01).phase, 'Night');
  assert.equal(local('2026-03-20T05:30:00Z', 0, 0).phase, 'Dawn');
  assert.equal(local('2026-03-20T18:30:00Z', 0, 0).phase, 'Dusk');
  for (const lat of [90, -90]) {
    const summer = local('2026-06-21T00:00:00Z', lat, 0);
    const winter = local('2026-12-21T12:00:00Z', lat, 0);
    assert.equal(summer.phase, lat > 0 ? 'Day' : 'Night');
    assert.equal(winter.phase, lat > 0 ? 'Night' : 'Day');
    assert(Object.values(summer).filter(v => typeof v === 'number').every(Number.isFinite));
  }
  const ground = local('2026-03-20T05:55:00Z', 0, 0);
  const flight = local('2026-03-20T05:55:00Z', 0, 0, 12000);
  assert.equal(ground.sunlight, 0);
  assert(flight.sunlight > .7, 'the elevated horizon gives an earlier sunrise');
});

test('night darkens fog and clouds, reveals stars, and returns to day in both quality modes', () => {
  for (const simple of [true, false]) {
    const sky = createSky(0x9dd0ea, { simple }), fog = new FogExp2(0x9dd0ea, .00007);
    const day = local('2026-03-20T12:00:00Z', 0, 0), night = local('2026-03-20T00:00:00Z', 0, 0);
    sky.update(1000, 0, fog, day);
    const dayColor = fog.color.clone(), stars = sky.mesh.getObjectByName('space-stars');
    assert.equal(stars.visible, false);
    sky.update(1000, 1, fog, night);
    assert.equal(stars.visible, true);
    assert.equal(sky.uniforms.uDaylight.value, 0);
    assert.equal(sky.uniforms.uSunVisibility.value, 0);
    assert(fog.color.r < dayColor.r / 10);
    assert(night.environmentIntensity < day.environmentIntensity / 10);
    sky.update(30000, 2, fog, day);
    assert.equal(stars.visible, true);
    sky.update(1000, 3, fog, day);
    assert(fog.color.equals(dayColor));
    assert.equal(stars.visible, false);
    sky.dispose();
  }
});

function clockFixture() {
  const nodes = new Map();
  const root = { dataset: {}, querySelector: key => { if (!nodes.has(key)) nodes.set(key, {}); return nodes.get(key); } };
  const clock = createFlightClock(root);
  return { root, nodes, clock, update(date, latDeg = 52.23, lonDeg = 21.01, extra = {}) {
    clock.update({ utcMs: Date.parse(date), latDeg, lonDeg, phase: 'Day', ...extra });
    return clock.diagnostics();
  } };
}

test('geographic zones include DST, fractional offsets, and date-line rollover', () => {
  const { update } = clockFixture();
  assert.equal(update('2026-01-10T12:00:00Z').offset, 'UTC+01:00');
  assert.equal(update('2026-07-10T12:00:00Z').offset, 'UTC+02:00');
  assert.equal(update('2026-03-29T00:59:59Z').time, '01:59:59');
  assert.equal(update('2026-03-29T01:00:00Z').time, '03:00:00');
  assert.equal(update('2026-10-25T00:59:59Z').time, '02:59:59');
  assert.equal(update('2026-10-25T01:00:00Z').time, '02:00:00');
  assert.equal(update('2026-07-10T12:00:00Z', 27.7172, 85.324).offset, 'UTC+05:45');
  assert.equal(update('2026-07-10T12:00:01Z', 40.71, -74.01).zone, 'America/New_York');
  assert.equal(update('2026-07-10T12:00:02Z', -33.87, 151.21).offset, 'UTC+10:00');
  const { update: ocean, nodes } = clockFixture();
  assert.equal(ocean('2026-07-10T13:00:00Z', 0, 179).time, '01:00:00');
  assert.match(nodes.get('[data-clock-detail]').textContent, /11 Jul 2026/);
  assert.equal(ocean('2026-07-10T13:00:01Z', 0, -179).time, '01:00:01');
  assert.match(nodes.get('[data-clock-detail]').textContent, /10 Jul 2026/);
  assert.equal(flightTimeZone(52.23, 381.01), 'Europe/Warsaw');
});

test('clock resumes from wall time after a pause or restart and uses UTC in space', () => {
  const { update, root } = clockFixture();
  assert.equal(update('2026-07-10T12:00:00Z').time, '14:00:00');
  update('2026-07-10T12:00:01Z', 52, 21, { hidden: true });
  assert(root.hidden);
  assert.equal(update('2026-07-10T15:05:30Z').time, '17:05:30');
  assert(!root.hidden);
  assert.equal(update('2026-07-10T15:05:30Z', 52, 21, { inSpace: true }).time, '15:05:30');
  assert.equal(update('2026-07-10T15:05:30Z', 52, 21, { inSpace: false }).time, '17:05:30');
});
