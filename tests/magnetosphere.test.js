import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  EARTH_SPACE_CONSTANTS as C, earthRadiiToDistance, magnetosphereParameters,
  boundaryRadiusAt, classifySpaceEnvironment, createMagnetosphereOverlay,
} from '../src/game/magnetosphere.js';

const RE = C.meanRadius;
const at = (x, y = 0, z = 0) => new THREE.Vector3(x * RE, y * RE, z * RE);

test('space distances distinguish geocentric radius from altitude and sidereal from solar day', () => {
  assert.deepEqual(earthRadiiToDistance(10), { centerMeters: 63_710_000, altitudeMeters: 57_339_000 });
  assert.equal(earthRadiiToDistance(1000).centerMeters, 6_371_000_000);
  assert.ok(Math.abs(C.angularVelocity * C.siderealPeriod - 2 * Math.PI) < 1e-6);
  assert.ok(Math.abs(C.angularVelocity * C.equatorialRadius - 465.1) < 0.1);
  assert.equal(C.obliquity, 23.44 * Math.PI / 180);
});

test('higher solar pressure compresses the dayside while preserving sheath ordering and long open tail', () => {
  const quiet = magnetosphereParameters(0.5), nominal = magnetosphereParameters(2), storm = magnetosphereParameters(16);
  assert.equal(nominal.magnetopauseRadii, 10);
  assert.equal(nominal.bowShockRadii, 14);
  assert.ok(quiet.magnetopauseRadii > nominal.magnetopauseRadii);
  assert.ok(storm.magnetopauseRadii < nominal.magnetopauseRadii);
  assert.ok(storm.bowShockRadii > storm.magnetopauseRadii);
  assert.equal(boundaryRadiusAt(11, nominal), 0);
  assert.ok(boundaryRadiusAt(-1000, nominal) > 24);
  assert.ok(boundaryRadiusAt(-1000, nominal, true) > boundaryRadiusAt(-1000, nominal));
  assert.equal(magnetosphereParameters(NaN).solarPressure, 2);
  assert.equal(magnetosphereParameters(-8).solarPressure, 0.1);
});

test('zone semantics include overlapping radiation/plasma regions and nightside beyond lunar orbit', () => {
  assert.equal(classifySpaceEnvironment(at(20)).region, 'solarWind');
  assert.equal(classifySpaceEnvironment(at(12)).region, 'magnetosheath');
  assert.ok(classifySpaceEnvironment(at(10)).zones.includes('magnetopause'));
  assert.ok(classifySpaceEnvironment(at(14)).zones.includes('bowShock'));
  assert.equal(classifySpaceEnvironment(at(-60)).region, 'magnetotail');
  assert.equal(classifySpaceEnvironment(at(60)).region, 'solarWind');
  assert.equal(classifySpaceEnvironment(at(-1100)).region, 'unmodeledTail');
  const inner = classifySpaceEnvironment(at(0, 2.5));
  assert.ok(inner.zones.includes('innerBelt'));
  assert.ok(inner.zones.includes('plasmasphere'));
  assert.ok(!classifySpaceEnvironment(at(0, 0, 3)).zones.includes('innerBelt'));
  assert.ok(classifySpaceEnvironment(at(0, 5)).zones.includes('outerBelt'));
  assert.ok(!classifySpaceEnvironment(at(0, 0, 5)).zones.includes('outerBelt'));
  assert.match(inner.note, /does not make the magnetic field zero/);
  assert.equal(classifySpaceEnvironment(at(0.5)).region, 'earth');
  assert.equal(classifySpaceEnvironment(at(1.005)).region, 'atmosphere');
});

test('Sun direction orients boundaries independently of rotating tilted dipole', () => {
  const sunDirection = new THREE.Vector3(0, 1, 0);
  assert.equal(classifySpaceEnvironment(at(0, 12), { sunDirection }).region, 'magnetosheath');
  assert.equal(classifySpaceEnvironment(at(0, -60), { sunDirection }).region, 'magnetotail');
  const p = at(2.5, 0, 0.8);
  const a = classifySpaceEnvironment(p, { siderealTime: 0 });
  const b = classifySpaceEnvironment(p, { siderealTime: Math.PI });
  assert.ok(Math.abs(a.magneticLatitude - b.magneticLatitude) > 0.2);
  assert.equal(a.region, b.region);
});

test('overlay has bounded geometry, inertial-to-render transform and safe flowing tracers', () => {
  const overlay = createMagnetosphereOverlay();
  assert.equal(overlay.root.visible, false);
  const origin = new THREE.Vector3(5, 10, 15);
  const orientation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  overlay.setVisible(true);
  overlay.update({ sunDirection: new THREE.Vector3(1, 0, 0), siderealTime: 1, time: 100, origin, orientation, metersToWorld: 1e-6 });
  assert.deepEqual(overlay.root.position.toArray(), origin.toArray());
  assert.ok(Math.abs(overlay.root.scale.x - 6.371) < 1e-12);
  assert.ok(overlay.root.quaternion.angleTo(orientation) < 1e-7);
  let vertices = 0;
  overlay.root.traverse(object => { vertices += object.geometry?.attributes.position?.count ?? 0; });
  assert.ok(vertices < 25_000);
  const positions = overlay.root.getObjectByName('animated-solar-wind-tracers').geometry.attributes.position;
  const oldPosition = positions.getX(0);
  for (let i = 0; i < positions.count; i += 2) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    assert.ok(Math.abs(x - positions.getX(i + 1)) < 0.71, 'wraparound must not draw a line across the entire scene');
    if (x < 14) assert.ok(Math.hypot(y, z) > boundaryRadiusAt(x, magnetosphereParameters(), true));
  }
  overlay.update({ time: 101, solarPressure: 8 });
  assert.notEqual(positions.getX(0), oldPosition);
  assert.ok(overlay.diagnostics().magnetopauseRadii < 10);
  assert.equal(overlay.classify(at(12)).region, 'solarWind');
  assert.equal(overlay.diagnostics().tailExtentIsDrawingLimit, true);
  overlay.dispose(); overlay.dispose();
});
