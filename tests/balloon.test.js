import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Group, Quaternion, Vector3 } from 'three';
import { BALLOON_SPEC, BalloonController, balloonWind, createBalloon, updateBalloon } from '../src/game/balloon.js';
import { createVehicleController } from '../src/game/vehicleControllers.js';
import { finishVehicleMaterials } from '../src/game/vehicleVisuals.js';
import { disposeModelResources } from '../src/game/vehicleModels.js';
import { FlightCamera } from '../src/game/flightCamera.js';

function fly(balloon, seconds, controls = {}, fps = 60) {
  for (let i = 0; i < Math.round(seconds * fps); i++) balloon.update(1 / fps, { throttle: .5, pitch: 0, roll: 0, ...controls });
}

test('balloon starts drifting at neutral heat; warming climbs and cooling descends with thermal inertia', () => {
  const balloon = createVehicleController(52.23, 21.01, 500, 0, BALLOON_SPEC);
  assert(balloon instanceof BalloonController);
  fly(balloon, 20);
  assert(Math.abs(balloon.height - 500) < 1e-7);
  assert(balloon.latDeg > 52.23 && balloon.lonDeg > 21.01);
  fly(balloon, .1, { throttle: 1 });
  assert(balloon.verticalSpeed < .01, 'burner does not instantaneously change lift');
  fly(balloon, 30, { throttle: 1 });
  assert(balloon.height > 570 && balloon.verticalSpeed > 4);
  const start = balloon.height;
  fly(balloon, 1, { throttle: 0 });
  assert(balloon.height > start, 'hot air keeps lifting after the burner is cut');
  fly(balloon, 45, { throttle: 0 });
  assert(balloon.verticalSpeed < -4 && balloon.height < start);
  assert(balloon.speed < 10, 'burner cannot accelerate the balloon like an airplane');
});

test('basket rotation does not steer the wind; height changes the wind layer', () => {
  const a = new BalloonController(52, 21, 500, 0), b = new BalloonController(52, 21, 500, 0);
  fly(a, 20); fly(b, 20, { roll: 1 });
  assert.notEqual(a.heading, b.heading);
  assert.equal(a.lat, b.lat); assert.equal(a.lon, b.lon);
  assert(Math.abs(b.pitch) < .02 && Math.abs(b.roll) < .02, 'envelope remains upright');
  assert.notDeepEqual(balloonWind(a.lat, a.lon, 500), balloonWind(a.lat, a.lon, 1500));
  fly(a, 30, { pitch: 1, throttle: 0 });
  assert(a.verticalSpeed > 4, 'pulling the stick heats even when the slider is low');
  fly(a, 40, { pitch: -1, throttle: 1 });
  assert(a.verticalSpeed < -4, 'pushing the stick cools even when the slider is high');
});

test('thermal flight is stable at different frame rates, bounded aloft, and paused without drift', () => {
  const flights = [30, 60, 144].map(fps => {
    const balloon = new BalloonController(52, 179.9999, 500, 0);
    fly(balloon, 40, { throttle: 1 }, fps); fly(balloon, 40, { throttle: 0 }, fps);
    assert(balloon.lonDeg >= -180 && balloon.lonDeg < 180);
    const before = JSON.stringify(balloon);
    balloon.update(0, { throttle: 1, roll: 1, pitch: 1 });
    assert.equal(JSON.stringify(balloon), before);
    return balloon;
  });
  assert(Math.abs(flights[0].height - flights[2].height) < .02);
  const high = new BalloonController(89.99999, 0, 15000, 0);
  fly(high, 30, { throttle: 1 });
  assert(high.verticalSpeed < 0, 'the balloon cannot climb into space');
  assert([high.lat, high.lon, high.height, high.speed].every(Number.isFinite));
});

test('red envelope, open basket and suspension use finite metre-scale geometry with a modest draw budget', () => {
  const model = createBalloon(), bounds = new Box3().setFromObject(model), size = bounds.getSize(new Vector3());
  assert(size.y > 24 && size.y < 24.1); assert(size.x > 16 && size.x < 18);
  let meshes = 0;
  model.traverse(node => {
    if (!node.isMesh) return;
    meshes++;
    for (const attribute of Object.values(node.geometry.attributes)) assert([...attribute.array].every(Number.isFinite));
  });
  assert(meshes <= 20);
  const envelope = model.getObjectByName('red-gored-envelope');
  const colors = envelope.geometry.attributes.color;
  for (let i = 0; i < colors.count; i++) assert(colors.getX(i) > colors.getY(i) * 4 && colors.getX(i) > colors.getZ(i) * 4);
  assert(model.getObjectByName('open-wicker-basket'));
  assert(model.getObjectByName('basket-suspension-cables'));
  finishVehicleMaterials(model);
  assert.equal(envelope.material.metalness, 0); assert(envelope.material.roughness > .8);
  disposeModelResources(model);
});

test('burner animation works in wrappers and freezes on pause; basket camera keeps a level view', () => {
  const model = createBalloon(), wrapper = new Group(); wrapper.add(model);
  const bounds = new Box3().setFromObject(model);
  model.scale.setScalar(BALLOON_SPEC.wingspan / bounds.getSize(new Vector3()).y);
  model.position.sub(new Box3().setFromObject(model).getCenter(new Vector3()));
  updateBalloon(wrapper, .1, 0);
  const { flames, cloth } = model.userData.balloon;
  assert(!flames.visible);
  const dim = cloth.emissiveIntensity;
  updateBalloon(wrapper, .1, 1); assert(flames.visible && cloth.emissiveIntensity > dim);
  const scale = flames.scale.clone();
  updateBalloon(wrapper, 0, 1); assert(flames.scale.equals(scale));
  const camera = new FlightCamera(); camera.setModel(model, { basket: true }); camera.mode = 3;
  camera.update(BALLOON_SPEC.cam, new Vector3(), new Quaternion(), new Quaternion());
  const bottom = new Box3().setFromObject(model).min.y;
  assert(Math.abs(camera.position.y - bottom - 1.65) < 1e-6);
  assert.equal(camera.up.y, 1); assert.equal(camera.target.y, camera.position.y);
  disposeModelResources(model);
});
