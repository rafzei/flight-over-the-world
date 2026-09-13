import test from "node:test";
import assert from "node:assert/strict";
import { Matrix4, Scene, Vector3 } from "three";
import { DodgeTraffic, DodgeTrafficVisuals, DODGE_AIRCRAFT_COUNT, DODGE_SECONDS, movingSphereContact } from "../src/game/dodgeTraffic.js";

const origin = new Vector3(6378137, 0, 0);
const frame = (seconds = 0, height = 0, speed = 48) => ({ position: origin.clone().add(new Vector3(height, 0, -seconds * speed)),
  forward: new Vector3(0, 0, -1), up: new Vector3(1, 0, 0), right: new Vector3(0, -1, 0), speed, radius: 4.5 });

test("50 visible aircraft start nearby on fixed crossing tracks with a clear initial player volume", () => {
  const traffic = new DodgeTraffic({ seed: 7 }), f = frame(); traffic.start(f);
  assert.equal(traffic.aircraft.length, DODGE_AIRCRAFT_COUNT);
  assert.equal(new Set(traffic.aircraft.map(a => a.id)).size, 50);
  for (const aircraft of traffic.aircraft) {
    const distance = aircraft.position.distanceTo(f.position);
    assert(distance > 130 && distance < 1200);
    assert(Math.abs(aircraft.quaternion.length() - 1) < 1e-10);
    const nose = new Vector3(0, 0, -1).applyQuaternion(aircraft.quaternion);
    assert(nose.dot(aircraft.velocity.clone().normalize()) > .9999);
    assert([aircraft.position.x, aircraft.position.y, aircraft.position.z].every(Number.isFinite));
  }
  assert.equal(traffic.update(1 / 60, frame(1 / 60)), null);
});

test("moving collision sweeps catch fast head-on crossings, initial contact and wing hits, while allowing near misses", () => {
  const v = (x, y = 0, z = 0) => new Vector3(x, y, z);
  assert(movingSphereContact(v(-100), v(100), v(100), v(-100), 4) !== null);
  assert.equal(movingSphereContact(v(-100, 5), v(100, 5), v(100), v(-100), 4), null);
  assert.equal(movingSphereContact(v(0), v(0), v(0), v(0), 4), 0);
  assert.equal(movingSphereContact(v(0), v(0), v(10), v(10), 4), null);
  const traffic = new DodgeTraffic({ seed: 1 }), f = frame(0, 0, 0); traffic.start(f);
  const aircraft = traffic.aircraft[0]; traffic.aircraft = [aircraft];
  aircraft.position.copy(f.position).add(new Vector3(-200, 0, 0)); aircraft.velocity.set(12000, 0, 0);
  aircraft.quaternion.identity(); aircraft.hull = [{ offset: new Vector3(0, 16, 0), radius: 2 }];
  f.hull = [{ offset: new Vector3(0, 12, 0), radius: 3 }];
  traffic.samples = [{ position: f.position.clone().add(f.hull[0].offset), radius: 3 }];
  const hit = traffic.update(1 / 30, f);
  assert(hit && hit.fraction > 0 && hit.fraction < 1); assert(traffic.failed && traffic.finished);
  assert(traffic.elapsed < 1 / 30);
});

test("flying straight results in an aircraft collision at consistent times across frame rates", () => {
  const times = [];
  for (const fps of [30, 60, 120]) {
    const traffic = new DodgeTraffic({ seed: 42 }); traffic.start(frame());
    for (let i = 1; i <= 12 * fps && !traffic.finished; i++) traffic.update(1 / fps, frame(i / fps));
    assert(traffic.failed); assert(traffic.elapsed > 2 && traffic.elapsed < 10);
    times.push(traffic.elapsed);
  }
  assert(Math.max(...times) - Math.min(...times) < .01);
});

test("changing altitude avoids an oncoming aircraft; its course does not follow the player's dodge", () => {
  const straight = new DodgeTraffic({ seed: 10 }), evade = new DodgeTraffic({ seed: 10 });
  for (const traffic of [straight, evade]) {
    traffic.start(frame()); traffic.aircraft = [traffic.aircraft[0]];
  }
  const heading = evade.aircraft[0].velocity.clone();
  for (let i = 1; i <= 8 * 60; i++) {
    straight.update(1 / 60, frame(i / 60));
    evade.update(1 / 60, frame(i / 60, Math.min(100, i / 60 * 20)));
  }
  assert(straight.failed); assert(!evade.failed); assert(evade.aircraft[0].velocity.equals(heading));
});

test("pause, a map and zero time freeze the fleet and clock; restart removes old round state", () => {
  const traffic = new DodgeTraffic({ seed: 9 }); traffic.start(frame());
  traffic.update(.5, frame(.5));
  const positions = traffic.aircraft.map(a => a.position.clone()), elapsed = traffic.elapsed;
  traffic.update(30, frame(30), { active: false }); traffic.update(0, frame());
  assert.equal(traffic.elapsed, elapsed);
  assert(traffic.aircraft.every((a, i) => a.position.equals(positions[i])));
  traffic.finish(true); traffic.update(1, frame(1)); assert.equal(traffic.elapsed, elapsed);
  traffic.start(frame()); assert(!traffic.failed && !traffic.finished); assert.equal(traffic.elapsed, 0); assert.equal(traffic.aircraft.length, 50);
  traffic.reset(); assert(!traffic.started); assert.equal(traffic.aircraft.length, 0);
});

test("passed traffic is replenished safely without exceeding 50 aircraft or leaving an empty sky", () => {
  const traffic = new DodgeTraffic({ seed: 10 }), f = frame(0, 0, 0); traffic.start(f);
  for (const aircraft of traffic.aircraft) {
    aircraft.age = aircraft.crossingTime + 5; aircraft.position.copy(f.position).addScalar(1000);
  }
  traffic.update(1 / 60, f);
  assert.equal(traffic.aircraft.length, 50);
  assert(traffic.aircraft.every(a => a.age === 0 && a.position.distanceTo(f.position) >= 130));
});

test("surviving exactly 90 seconds wins, clips late collisions, saves a record and tolerates unavailable storage", () => {
  const data = new Map(), storage = { getItem: k => data.get(k), setItem: (k, v) => data.set(k, v) };
  const traffic = new DodgeTraffic({ seed: 1, storage }), f = frame(0, 0, 0); traffic.start(f, "sailplane");
  traffic.elapsed = DODGE_SECONDS - .5;
  for (const aircraft of traffic.aircraft) {
    aircraft.position.copy(f.position).add(new Vector3(800, 800, 800)); aircraft.velocity.set(0, 0, 0);
  }
  const aircraft = traffic.aircraft[0];
  aircraft.position.copy(f.position).add(new Vector3(0, 0, -80)); aircraft.velocity.set(0, 0, 100);
  aircraft.hull = [{ offset: new Vector3(), radius: 2 }];
  traffic.update(1, f);
  assert(traffic.finished && !traffic.failed); assert.equal(traffic.remaining, 0); assert.equal(traffic.elapsed, 90);
  traffic.update(20, f); assert.equal(traffic.elapsed, 90);
  const next = new DodgeTraffic({ storage }); next.start(f, "sailplane"); assert.equal(next.best, 90);
  next.start(f, "pa28"); assert.equal(next.best, 0);
  const unavailable = new DodgeTraffic({ storage: { getItem() { throw Error(); }, setItem() { throw Error(); } } });
  unavailable.start(f); unavailable.finish(true); assert(unavailable.finished);
});

test("50 full-size aircraft use twelve camera-relative instanced meshes and release their resources", () => {
  const scene = new Scene(), visuals = new DodgeTrafficVisuals(scene), traffic = new DodgeTraffic({ seed: 8 });
  traffic.start(frame()); visuals.update(traffic, origin, true);
  assert(visuals.root.visible); assert.equal(visuals.root.children.length, 12);
  const matrix = new Matrix4(); let disposed = 0;
  for (const mesh of visuals.root.children) {
    assert.equal(mesh.count, 25); mesh.getMatrixAt(0, matrix);
    assert(matrix.elements.every(Number.isFinite)); assert(Math.abs(matrix.elements[12]) < 1500);
    assert(Math.abs(new Vector3().setFromMatrixScale(matrix).x - 1) < 1e-6);
    mesh.geometry.addEventListener("dispose", () => disposed++);
  }
  visuals.update(traffic, origin, false); assert(!visuals.root.visible);
  visuals.dispose(); assert.equal(disposed, 12); assert.equal(scene.children.length, 0);
});
