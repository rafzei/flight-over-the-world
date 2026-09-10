import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Group, Vector3 } from "three";
import { SAILPLANE_SPEC, createSailplane, updateSailplane } from "../src/game/sailplane.js";
import { createVehicleController } from "../src/game/vehicleControllers.js";
import { attachLandingGear } from "../src/game/landingGear.js";
import { LandingSystem, flightPose } from "../src/game/landingDynamics.js";
import { WarsawRunway } from "../src/game/warsawRunway.js";
import { disposeModelResources } from "../src/game/vehicleModels.js";

const flight = () => createVehicleController(52, 21, 1000, 0, SAILPLANE_SPEC);
const energy = p => 9.81 * p.height + .5 * p.speed ** 2;
function fly(p, seconds, input = {}, dt = 1 / 60) {
  const ctrl = { pitch: 0, roll: 0, throttle: 0, airbrake: 0, ...input };
  for (let i = 0; i < Math.round(seconds / dt); i++) p.update(dt, ctrl);
}

test("sailplane glides at trim and cannot gain engine thrust from throttle or approach mode", () => {
  const idle = flight(), full = flight();
  fly(idle, 60); fly(full, 60, { throttle: 1, approach: true, approachSpeed: 28 });
  assert(idle.height < 960 && idle.height > 950);
  assert(Math.abs(idle.speed - 28) < .1);
  assert(idle.lat > 52 * Math.PI / 180);
  assert.equal(full.throttle, 0); assert.equal(full.speed, idle.speed); assert.equal(full.height, idle.height);
});

test("diving gains speed, zooming spends speed, sustained pull-up stalls without creating energy", () => {
  const p = flight(); let before = energy(p);
  fly(p, 8, { pitch: -1 });
  assert(p.speed > 43); assert(p.height < 920); assert(energy(p) < before);
  const fast = p.speed, low = p.height; before = energy(p);
  fly(p, 6, { pitch: 1 });
  assert(p.speed < fast); assert(p.height > low); assert(energy(p) < before);
  fly(p, 30, { pitch: 1, throttle: 1 });
  assert(p.verticalSpeed < 0, "holding the nose up cannot sustain a climb");
  assert(p.speed < p.brake); assert(Number.isFinite(p.height));
  fly(p, 5, { pitch: -1 }); assert(p.speed > p.brake, "lowering the nose recovers airspeed");
});

test("airbrakes steepen descent; banking turns and all controls dissipate total energy", () => {
  const clean = flight(), braked = flight(); fly(clean, 20); fly(braked, 20, { airbrake: 1 });
  assert(braked.height < clean.height - 25); assert(braked.speed < clean.speed);
  const p = flight(); const start = p.heading;
  for (let i = 0; i < 2400; i++) {
    const before = energy(p);
    p.update(1 / 60, { pitch: Math.sin(i / 150), roll: .7, airbrake: (i % 600) / 600, throttle: 1 });
    assert(energy(p) <= before + 1e-7, "controls cannot create energy");
  }
  assert(p.heading > start + 1);
});

test("gliding and stall recovery are consistent across frame rates and freeze at dt=0", () => {
  const states = [1 / 30, 1 / 60, 1 / 120].map(dt => {
    const p = flight(); fly(p, 10, { pitch: 1, roll: .4 }, dt); fly(p, 10, { pitch: -1, airbrake: .6 }, dt);
    const before = [p.height, p.speed, p.pitch, p.roll, p.airbrake];
    p.update(0, { pitch: 0, roll: 0, throttle: 1, airbrake: 1 });
    assert.deepEqual([p.height, p.speed, p.pitch, p.roll, p.airbrake], before);
    return p;
  });
  assert(Math.max(...states.map(p => p.height)) - Math.min(...states.map(p => p.height)) < .01);
});

test("sailplane has a wide, finite mesh, visible airbrakes and fixed wheels that land and stop without taxi thrust", () => {
  const model = createSailplane(), wrapper = new Group();
  const bounds = new Box3().setFromObject(model), size = bounds.getSize(new Vector3());
  assert(Math.abs(size.x - 18) < .01); assert(size.x > size.z * 2);
  model.traverse(node => {
    assert(!/propeller|engine|helice|propdisc/i.test(node.name));
    if (node.geometry) assert([...node.geometry.attributes.position.array].every(Number.isFinite));
  });
  updateSailplane(model, 1); assert(model.userData.sailplane.spoilers.every(s => s.visible));
  updateSailplane(model, 0); assert(model.userData.sailplane.spoilers.every(s => !s.visible));
  model.position.sub(bounds.getCenter(new Vector3())); wrapper.add(model);
  const gear = attachLandingGear(wrapper, model, "sailplane");
  const runway = new WarsawRunway(), system = new LandingSystem(runway), p = flight(); system.gear = gear;
  try {
    assert(gear.fixed); assert.deepEqual(gear.wheels.map(w => w.name), ["main", "tail"]);
    gear.toggle(false); assert.equal(gear.target, 1);
    p.pitch = 3 * Math.PI / 180; p.heading = runway.definition.heading * Math.PI / 180;
    Object.assign(p, runway.pose(0, runway.definition.threshold + 250, 8));
    for (let i = 0; i < 600 && !system.grounded; i++) {
      const before = flightPose(p), pos = runway.coordinates(p);
      Object.assign(p, runway.pose(0, -pos.z + p.speed / 60, pos.y - 1.2 / 60));
      assert(!system.resolve(p, before, 1 / 60).crash);
    }
    assert(system.grounded);
    for (let i = 0; i < 900; i++) assert(!system.roll(p, 1 / 60, { throttle: 1, pitch: 1, roll: 0, wheelBrake: true }).crash);
    assert.equal(p.speed, 0); assert.equal(p.throttle, 0); assert(system.grounded);
    assert(system.feet(p).every(w => Math.abs(w.point.y) < .02));
    for (let i = 0; i < 300; i++) system.roll(p, 1 / 60, { throttle: 1, pitch: 1, roll: 0, wheelBrake: false });
    assert.equal(p.speed, 0); assert(system.grounded, "no engine means no powered takeoff");
  } finally { gear.dispose(); disposeModelResources(model); }
});
