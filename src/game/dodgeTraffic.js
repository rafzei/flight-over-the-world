import { DynamicDrawUsage, Group, InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";
import { createAirliner } from "./airliner.js";

export const DODGE_AIRCRAFT_COUNT = 50;
export const DODGE_SECONDS = 90;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const MODELS = ["b738", "a320"];

// Sweep both moving bodies, including contacts between rendered frames.
export function movingSphereContact(from, to, otherFrom, otherTo, radius) {
  const x = from.x - otherFrom.x, y = from.y - otherFrom.y, z = from.z - otherFrom.z;
  const dx = to.x - otherTo.x - x, dy = to.y - otherTo.y - y, dz = to.z - otherTo.z - z;
  const c = x * x + y * y + z * z - radius * radius;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy + dz * dz;
  if (a < 1e-16) return null;
  const b = x * dx + y * dy + z * dz, discriminant = b * b - a * c;
  if (b >= 0 || discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / a;
  return t >= 0 && t <= 1 ? t : null;
}

// Small volumes follow the fuselage, swept wings, tail and engines rather
// than filling the empty air around an aircraft with one large sphere.
const HULL = [];
for (let z = -17; z <= 17; z += 4) HULL.push({ offset: new Vector3(0, 0, z), radius: 2.4 });
for (const side of [-1, 1]) {
  for (const x of [5, 9, 13, 17]) HULL.push({ offset: new Vector3(side * x, .1, x * .4 - 2), radius: 2.1 });
  HULL.push({ offset: new Vector3(side * 6, .3, 16), radius: 1.8 });
  HULL.push({ offset: new Vector3(side * 5.5, -1.5, -2.5), radius: 1.6 });
}
HULL.push({ offset: new Vector3(0, 4, 16), radius: 2.1 }, { offset: new Vector3(0, 7, 17), radius: 1.5 });

function playerSamples(frame) {
  return (frame.hull ?? [{ offset: new Vector3(), radius: frame.radius ?? 4.5 }])
    .map(part => ({ position: frame.position.clone().add(part.offset), radius: part.radius }));
}

export class DodgeTraffic {
  constructor({ seed = Math.floor(Math.random() * 0xffffffff), storage } = {}) {
    this.seed = seed >>> 0; this.storage = storage; this.reset();
  }
  random() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 0x100000000; }
  reset() {
    this.aircraft = []; this.elapsed = 0; this.started = false; this.finished = false; this.failed = false;
    this.previous = null; this.samples = []; this.nearest = Infinity; this.best = 0; this.encounters = 0;
  }
  get remaining() { return Math.max(0, DODGE_SECONDS - this.elapsed); }
  start(frame, vehicle = "pa28") {
    this.reset(); this.vehicle = vehicle;
    try { this.best = clamp(Number(this.storage?.getItem(`foe.dodge.v1:${vehicle}`)) || 0, 0, DODGE_SECONDS); } catch { /* optional records */ }
    this.started = true; this.previous = frame.position.clone(); this.samples = playerSamples(frame);
    for (let i = 0; i < DODGE_AIRCRAFT_COUNT; i++) {
      const aircraft = { id: i, model: MODELS[i % MODELS.length] };
      this.spawn(aircraft, frame); this.aircraft.push(aircraft);
    }
    this.measure(frame);
  }
  spawn(aircraft, frame) {
    const forward = frame.forward.clone().normalize(), up = frame.up.clone().normalize();
    const right = new Vector3().crossVectors(forward, up);
    if (right.lengthSq() < .01) right.copy(frame.right ?? new Vector3(1, 0, 0));
    right.normalize();
    const lift = new Vector3().crossVectors(right, forward).normalize();
    const speed = clamp(frame.speed * .6 + 35, 35, 260);
    const time = (frame.balloon ? 12 : 3.5) + this.random() * (frame.balloon ? 14 : 6);
    const laneWidth = clamp(frame.speed * 2, 110, 400);
    const threatening = aircraft.id % 7 === 0;
    const target = frame.position.clone().addScaledVector(forward, frame.speed * time)
      .addScaledVector(right, threatening ? 0 : (this.random() - .5) * laneWidth * 2)
      .addScaledVector(lift, threatening ? 0 : (this.random() - .5) * 150);
    // Fixed head-on and crossing tracks. Aircraft do not home onto a dodge.
    const direction = aircraft.id % 4 === 0 ? forward.clone().negate()
      : right.clone().multiplyScalar(aircraft.id % 2 ? 1 : -1).addScaledVector(forward, -.25).normalize();
    aircraft.velocity = direction.multiplyScalar(speed);
    aircraft.position = target.addScaledVector(aircraft.velocity, -time);
    const minimum = Math.max(130, (frame.radius ?? 4.5) + 80);
    if (aircraft.position.distanceTo(frame.position) < minimum) aircraft.position.addScaledVector(forward, minimum);
    const matrix = new Matrix4().lookAt(new Vector3(), aircraft.velocity, up);
    aircraft.quaternion = new Quaternion().setFromRotationMatrix(matrix);
    aircraft.hull = HULL.map(part => ({ offset: part.offset.clone().applyQuaternion(aircraft.quaternion), radius: part.radius }));
    aircraft.age = 0; aircraft.crossingTime = time;
    aircraft.near = false;
  }
  measure(frame) {
    this.nearest = this.aircraft.reduce((nearest, aircraft) => Math.min(nearest, aircraft.position.distanceTo(frame.position)), Infinity);
  }
  finish(failed = false) {
    if (!this.started || this.finished) return;
    this.finished = true; this.failed = failed;
    this.best = Math.max(this.best, this.elapsed);
    try { this.storage?.setItem(`foe.dodge.v1:${this.vehicle}`, String(this.best)); } catch { /* private mode */ }
  }
  update(dt, frame, { active = true } = {}) {
    if (!active || !this.started || this.finished || !(dt > 0) || !Number.isFinite(dt)) return null;
    // A map relocation or an assisted space transfer is not a swept collision.
    const delta = frame.position.clone().sub(this.previous);
    if (delta.length() > Math.max(250, frame.speed * dt * 4 + 100)) {
      for (const aircraft of this.aircraft) aircraft.position.add(delta);
      this.previous.copy(frame.position); this.samples = playerSamples(frame);
    }
    const step = Math.min(dt, this.remaining), proportion = step / dt;
    const end = this.previous.clone().lerp(frame.position, proportion);
    const samples = playerSamples(frame);
    for (let i = 0; i < samples.length; i++) samples[i].position.lerpVectors(this.samples[i]?.position ?? this.previous, samples[i].position, proportion);
    const playerRadius = Math.max(...samples.map(part => part.position.distanceTo(end) + part.radius));
    const otherFrom = new Vector3(), otherTo = new Vector3();
    let hit = null;
    for (const aircraft of this.aircraft) {
      const next = aircraft.position.clone().addScaledVector(aircraft.velocity, step);
      if (movingSphereContact(this.previous, end, aircraft.position, next, playerRadius + 28) !== null) {
        for (const part of aircraft.hull) {
          otherFrom.copy(aircraft.position).add(part.offset); otherTo.copy(next).add(part.offset);
          for (let i = 0; i < samples.length; i++) {
            const t = movingSphereContact(this.samples[i]?.position ?? this.previous, samples[i].position, otherFrom, otherTo, part.radius + samples[i].radius);
            if (t !== null && (!hit || t < hit.fraction)) hit = { fraction: t, aircraft: aircraft.id };
          }
        }
      }
    }
    const advance = step * (hit?.fraction ?? 1);
    for (const aircraft of this.aircraft) {
      aircraft.position.addScaledVector(aircraft.velocity, advance); aircraft.age += advance;
      if (aircraft.position.distanceTo(end) < 120) aircraft.near = true;
    }
    this.elapsed += advance;
    if (hit) {
      hit.position = this.previous.clone().lerp(end, hit.fraction); hit.point = hit.position.clone();
      this.previous.copy(hit.position); this.finish(true); this.measure({ position: hit.position });
      return hit;
    }
    this.previous.copy(end); this.samples = samples;
    if (this.remaining === 0) this.finish();
    else for (const aircraft of this.aircraft) {
      if (aircraft.age > aircraft.crossingTime + 4 || aircraft.position.distanceTo(frame.position) > Math.max(1600, frame.speed * 22)) {
        if (aircraft.near) this.encounters++;
        this.spawn(aircraft, frame);
      }
    }
    this.measure(frame);
    return null;
  }
  summary() { return `${this.elapsed.toFixed(1)} s survived · best ${this.best.toFixed(1)} s`; }
  diagnostics() { return { started: this.started, count: this.aircraft.length, elapsed: this.elapsed, remaining: this.remaining, nearest: Number.isFinite(this.nearest) ? this.nearest : null, finished: this.finished, failed: this.failed, best: this.best, encounters: this.encounters }; }
}

export class DodgeTrafficVisuals {
  constructor(scene) {
    this.root = new Group(); this.root.name = "dodge-aircraft"; scene.add(this.root);
    this.models = new Map();
    for (const key of MODELS) {
      const template = createAirliner(key), parts = [];
      for (const part of template.children) {
        const mesh = new InstancedMesh(part.geometry, part.material, Math.ceil(DODGE_AIRCRAFT_COUNT / MODELS.length));
        mesh.name = `dodge-${key}-${part.name}`; mesh.instanceMatrix.setUsage(DynamicDrawUsage);
        mesh.frustumCulled = false; mesh.raycast = () => {}; mesh.count = 0;
        this.root.add(mesh); parts.push(mesh);
      }
      this.models.set(key, parts);
    }
    this.matrix = new Matrix4(); this.position = new Vector3(); this.scale = new Vector3(1, 1, 1);
    this.root.visible = false;
  }
  update(traffic, position, visible) {
    this.root.visible = visible && traffic.started;
    if (!this.root.visible) return;
    this.root.position.copy(position);
    const counts = Object.fromEntries(MODELS.map(key => [key, 0]));
    for (const aircraft of traffic.aircraft) {
      this.position.subVectors(aircraft.position, position);
      this.matrix.compose(this.position, aircraft.quaternion, this.scale);
      const index = counts[aircraft.model]++;
      for (const mesh of this.models.get(aircraft.model)) mesh.setMatrixAt(index, this.matrix);
    }
    for (const [key, parts] of this.models) for (const mesh of parts) { mesh.count = counts[key]; mesh.instanceMatrix.needsUpdate = true; }
  }
  dispose() {
    this.root.removeFromParent();
    for (const parts of this.models.values()) for (const mesh of parts) { mesh.geometry.dispose(); mesh.material.dispose(); mesh.dispose(); }
    this.models.clear();
  }
}
