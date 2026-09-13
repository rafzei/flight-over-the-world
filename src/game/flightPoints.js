import { Vector3 } from "three";

export const POINT_HUNT_SECONDS = 180;
export const POINT_MODES = Object.freeze(["arcade", "home", "guess"]);
const LIMIT = 999999999;
const finiteVector = v => v?.isVector3 && [v.x, v.y, v.z].every(Number.isFinite);
export const validPointScore = n => Number.isSafeInteger(n) && n >= 0 && n <= LIMIT ? n : 0;

// Intersect the swept flight segment with a gate's disk. A nearby stationary
// aircraft, a near miss, and crossing outside the opening earn nothing.
export function crossesPointGate(from, to, gate) {
  const a = from.clone().sub(gate.position), b = to.clone().sub(gate.position);
  const da = a.dot(gate.normal), db = b.dot(gate.normal);
  if (Math.abs(da - db) < 1e-8 || da * db > 0) return false;
  const t = da / (da - db);
  if (t <= 0 || t > 1) return false;
  const crossing = a.lerp(b, t);
  crossing.addScaledVector(gate.normal, -crossing.dot(gate.normal));
  return crossing.lengthSq() <= gate.radius ** 2;
}

export class PointRecords {
  constructor(storage) { this.storage = storage; this.memory = new Map(); }
  key(mode, vehicle) { return `foe.points.v1:${mode}:${vehicle}`; }
  read(mode, vehicle) {
    const key = this.key(mode, vehicle), cached = this.memory.get(key) ?? 0;
    try { return Math.max(cached, validPointScore(JSON.parse(this.storage?.getItem(key) ?? "0"))); }
    catch { return cached; }
  }
  save(mode, vehicle, score) {
    const best = Math.max(this.read(mode, vehicle), validPointScore(score));
    this.memory.set(this.key(mode, vehicle), best);
    try { this.storage?.setItem(this.key(mode, vehicle), String(best)); } catch { /* private mode / full storage */ }
    return best;
  }
}

// The flight frame comes from the actual vehicle, so a balloon follows wind,
// a glider gets descending gates, and a rocket gets gates along its ascent.
// Positions remain fixed in world space until collected, missed or expired.
export class FlightPoints {
  constructor({ records = new PointRecords(), onCollect = () => {} } = {}) {
    this.records = records; this.onCollect = onCollect;
    this.reset();
  }
  reset({ mode = "free", vehicle = "pa28" } = {}) {
    this.mode = mode; this.vehicle = vehicle;
    this.score = 0; this.collected = 0; this.combo = 0; this.bestCombo = 0;
    this.elapsed = 0; this.lastCollect = -Infinity; this.nextId = 1;
    this.best = this.records.read(this.mode, vehicle); this.startBest = this.best;
    this.gates = []; this.previous = null; this.finished = false; this.started = false;
    this.awards = new Set(); this.message = "Fly through the gold rings"; this.messageUntil = 5;
    this.trailAt = -Infinity; this.version = (this.version ?? 0) + 1;
  }
  get enabled() { return POINT_MODES.includes(this.mode); }
  get remaining() { return Math.max(0, POINT_HUNT_SECONDS - this.elapsed); }
  get multiplier() { return Math.min(5, 1 + Math.floor(Math.max(0, this.combo - 1) / 3)); }
  get nextGate() { return this.gates[0] ?? null; }
  start(frame) {
    if (!this.enabled || !finiteVector(frame?.position)) return;
    this.started = true; this.previous = frame.position.clone(); this.makeTrail(frame);
  }
  add(points, label) {
    if (!this.enabled || !this.started) return;
    this.score = Math.min(LIMIT, this.score + points);
    this.best = this.records.save(this.mode, this.vehicle, this.score);
    this.message = `${label} +${points}`; this.messageUntil = this.elapsed + 2.5;
  }
  award(id, points, label) {
    if (!this.started || this.awards.has(id) || !validPointScore(points)) return false;
    this.awards.add(id); this.add(points, label); return true;
  }
  makeTrail(frame) {
    if (!this.enabled || !finiteVector(frame?.position) || !finiteVector(frame.forward) || !finiteVector(frame.up)) return;
    const forward = frame.forward.clone().normalize(), up = frame.up.clone().normalize();
    if (forward.lengthSq() < .5 || up.lengthSq() < .5) return;
    let right = new Vector3().crossVectors(forward, up);
    if (right.lengthSq() < .01) right = frame.right?.clone() ?? new Vector3(1, 0, 0);
    right.normalize();
    const lift = new Vector3().crossVectors(right, forward).normalize();
    const speed = Math.max(1, Number.isFinite(frame.speed) ? frame.speed : 1);
    const size = Math.max(1, frame.size || 10);
    const spacing = Math.max(frame.balloon ? 30 : 90, Math.min(50000, speed * (frame.balloon ? 6 : 4)));
    const radius = Math.max(frame.balloon ? 14 : 18, Math.min(4000, speed * .4 + size * .6));
    const initial = Math.max(radius * 2.5, spacing * .75);
    const duration = Math.max(25, Math.min(100, spacing * 10 / speed));
    this.comboWindow = Math.max(12, Math.min(35, spacing * 2.5 / speed));
    this.gates = [];
    for (let i = 0; i < 7; i++) {
      const distance = initial + i * spacing;
      const routed = frame.route?.(distance, i);
      if (frame.route && !routed) break;
      const position = routed?.position?.clone() ?? frame.position.clone().addScaledVector(forward, distance);
      if (!routed && !frame.balloon && !frame.vertical) {
        position.addScaledVector(right, Math.sin(i * .65) * spacing * .2);
        position.addScaledVector(lift, frame.glider ? 0 : Math.sin(i * .8) * radius * .45);
      }
      if (!routed && frame.balloon) position.addScaledVector(up, Math.sin(i * .65) * 5);
      // Raising a gate above newly sampled terrain is done at generation,
      // never after the player has started approaching that fixed gate.
      frame.clearTerrain?.(position, radius);
      const normal = routed?.normal?.clone().normalize() ?? forward.clone();
      const id = this.nextId++;
      this.gates.push({ id, position, normal, radius: routed?.radius ?? radius,
        value: id % 5 === 0 ? 200 : 100, expires: this.elapsed + duration });
    }
    this.trailAt = this.elapsed; this.version++;
  }
  newTrail(frame) {
    if (!finiteVector(frame?.position) || !this.started || this.finished || this.elapsed - this.trailAt < 3) return false;
    this.combo = 0; this.previous = frame.position.clone(); this.makeTrail(frame); return true;
  }
  update(dt, frame, { active = true, discontinuity = false } = {}) {
    if (!finiteVector(frame?.position)) return;
    if (!active || this.finished || !this.started || !(dt > 0) || !Number.isFinite(dt)) {
      // Rebase on pause/menu/map and after resets; never sweep a hidden flight.
      this.previous = frame.position.clone(); return;
    }
    const step = this.mode === "arcade" ? Math.min(dt, this.remaining) : dt;
    const from = this.previous ?? frame.position;
    const distance = from.distanceTo(frame.position);
    const maxTravel = Math.max(250, Math.max(1, frame.speed || 0) * dt * 4 + 100);
    const teleported = discontinuity || distance > maxTravel;
    const endpoint = step < dt ? from.clone().lerp(frame.position, step / dt) : frame.position;
    this.elapsed += step;
    if (this.elapsed - this.lastCollect > (this.comboWindow ?? 12)) this.combo = 0;
    if (teleported) { this.combo = 0; this.makeTrail(frame); }
    else {
      this.gates = this.gates.filter(gate => {
        if (this.elapsed >= gate.expires) { this.combo = 0; this.version++; return false; }
        if (crossesPointGate(from, endpoint, gate)) {
          this.combo++; this.bestCombo = Math.max(this.bestCombo, this.combo); this.collected++;
          this.lastCollect = this.elapsed;
          const points = gate.value * this.multiplier;
          this.add(points, this.multiplier > 1 ? `Ring ×${this.multiplier}` : "Ring");
          if (this.collected % 10 === 0) this.add(500, "10-ring bonus");
          this.onCollect(gate, points); this.version++;
          return false;
        }
        const behind = endpoint.clone().sub(gate.position).dot(gate.normal);
        if (behind > gate.radius * 3) { this.combo = 0; this.version++; return false; }
        return true;
      });
      if (!this.gates.length && this.elapsed - this.trailAt > 2) this.makeTrail(frame);
    }
    this.previous = frame.position.clone();
    if (this.mode === "arcade" && this.remaining === 0) this.finished = true;
  }
  summary() { return `${this.score.toLocaleString("en-US")} pts · ${this.collected} rings · best series ${this.bestCombo} · record ${this.best.toLocaleString("en-US")}`; }
}
