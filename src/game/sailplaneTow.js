import { BufferGeometry, Float32BufferAttribute, Line, LineBasicMaterial, MathUtils, Vector3 } from "three";
import { createPlaneMesh } from "./plane.js";
import { disposeModelResources } from "./vehicleModels.js";
import { offsetFlight } from "./grassLanding.js";

const LEAD = 45, RELEASE_HEIGHT = 350;
const clamp = MathUtils.clamp;

export function parseTowSnapshot(value) {
  if (!value || !["arriving", "hooking", "rolling", "climbing", "departing"].includes(value.phase)) return null;
  if (!["lat", "lon", "height", "heading", "pitch"].every(key => Number.isFinite(value[key])) || Math.abs(value.lat) > Math.PI / 2 || Math.abs(value.lon) > Math.PI * 2 || Math.abs(value.height) > 100000) return null;
  return { lat: value.lat, lon: value.lon, height: value.height, heading: value.heading,
    pitch: clamp(value.pitch, -.5, .5), phase: value.phase,
    connected: value.connected === true && ["hooking", "rolling", "climbing"].includes(value.phase) };
}

export class TowVisuals {
  constructor() { this.aircraft = null; this.rope = null; }
  update(scene, frameAt, glider, state, dt) {
    if (!state) { this.dispose(); return; }
    if (!this.aircraft) {
      this.aircraft = createPlaneMesh(); this.aircraft.name = "Cessna 172 tow plane";
      this.aircraft.traverse(node => { if (node.isMesh) node.castShadow = true; });
      const geometry = new BufferGeometry(); geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(25 * 3), 3));
      this.rope = new Line(geometry, new LineBasicMaterial({ color: 0xffc55c }));
      this.rope.name = "sailplane-tow-rope"; this.rope.frustumCulled = false;
      scene.add(this.aircraft, this.rope);
    }
    const m = frameAt(state.lat, state.lon, state.height, state.heading, state.pitch || 0, 0);
    m.decompose(this.aircraft.position, this.aircraft.quaternion, this.aircraft.scale);
    this.aircraft.userData.prop.rotation.z += dt * 65;
    this.aircraft.visible = true;
    this.aircraft.updateMatrixWorld(true); glider.updateMatrixWorld(true);
    this.rope.visible = state.connected;
    if (!state.connected) return;
    const origin = glider.position;
    const sailplane = glider.getObjectByName("sailplane") || glider;
    const from = new Vector3(0, 0, -4.08).applyMatrix4(sailplane.matrixWorld).sub(origin);
    const to = new Vector3(0, -.06, 2.8).applyMatrix4(this.aircraft.matrixWorld).sub(origin);
    const up = new Vector3().setFromMatrixColumn(glider.matrixWorld, 1).normalize();
    this.rope.position.copy(origin);
    const positions = this.rope.geometry.attributes.position, point = new Vector3();
    for (let i = 0; i < positions.count; i++) {
      const t = i / (positions.count - 1);
      point.lerpVectors(from, to, t).addScaledVector(up, -Math.sin(t * Math.PI) * (state.phase === "climbing" ? .55 : .08));
      positions.setXYZ(i, point.x, point.y, point.z);
    }
    positions.needsUpdate = true;
  }
  dispose() {
    for (const root of [this.aircraft, this.rope]) if (root) { root.removeFromParent(); disposeModelResources(root); }
    this.aircraft = this.rope = null;
  }
}

// Assisted aerotow: external pull belongs to the Cessna, never to the glider.
// The tow keeps both aircraft on one heading with a bounded cable separation.
export class SailplaneTow {
  constructor() { this.visuals = new TowVisuals(); this.reset(); }
  reset() {
    this.visuals?.dispose(); this.phase = "idle"; this.elapsed = 0; this.pose = null;
    this.origin = null; this.reason = ""; this.releaseAltitude = null;
  }
  get attached() { return this.phase === "rolling" || this.phase === "climbing"; }
  get busy() { return this.phase !== "idle" && this.phase !== "departing"; }
  call(plane, landing, checkPath) {
    if (!plane.isSailplane || !landing.grounded || plane.speed >= .5 || this.busy) return false;
    const problem = checkPath();
    if (problem) { this.reason = problem; return false; }
    this.reset(); this.phase = "arriving"; this.origin = { lat: plane.lat, lon: plane.lon, height: plane.height, heading: plane.heading };
    this.groundHeight = landing.runway.pose(landing.runway.coordinates(plane).x, -landing.runway.coordinates(plane).z).height;
    this.heading = plane.heading; this.elapsed = 0;
    this.reason = "Cessna arriving · remain stopped";
    this.update(0, plane, landing); return true;
  }
  release(plane, landing, reason = "Tow released · free gliding") {
    if (this.phase === "idle" || this.phase === "departing") return false;
    const wasGrounded = landing.grounded;
    this.phase = "departing"; this.elapsed = 0; this.reason = wasGrounded ? "Tow cancelled · stop to call again" : reason;
    if (this.pose) this.departure = { ...this.pose };
    if (plane.isSailplane) plane.throttle = 0;
    return true;
  }
  update(dt, plane, landing) {
    if (this.phase === "idle") return;
    this.elapsed += dt;
    if (this.phase === "arriving") {
      const t = clamp(this.elapsed / 12, 0, 1), eased = 1 - (1 - t) ** 2;
      const p = offsetFlight(this.origin, LEAD - (1 - eased) * 420);
      this.pose = { ...p, height: this.groundHeight + 1.05 + (1 - t) ** 2 * 65, heading: this.heading, pitch: -.08 * (1 - t) };
      if (t === 1) { this.phase = "hooking"; this.elapsed = 0; this.reason = "Attaching tow rope"; }
    } else if (this.phase === "hooking" && this.elapsed >= 2) {
      if (!landing.grounded || plane.speed >= .5) { this.release(plane, landing); return; }
      this.phase = "rolling"; this.elapsed = 0; plane.airbrake = 0;
      this.reason = "On tow · automatic takeoff · L to release";
    } else if (this.attached) {
      this.pose = { ...offsetFlight(plane, LEAD), height: plane.height + (this.phase === "climbing" ? 4.2 : .1), heading: this.heading, pitch: this.phase === "climbing" ? .09 : 0 };
    } else if (this.phase === "departing") {
      if (this.elapsed > 10 || !this.departure) { this.phase = "idle"; this.pose = null; this.visuals.dispose(); return; }
      this.pose = { ...offsetFlight(this.departure, this.elapsed * 42, -(this.elapsed ** 2) * .8), height: this.departure.height + this.elapsed * 6, heading: this.departure.heading - this.elapsed * .025, pitch: .12 };
    }
  }
  step(dt, plane, landing) {
    if (!this.attached) return null;
    plane.throttle = 0; plane.airbrake = 0;
    plane.heading = this.heading;
    if (this.phase === "rolling") {
      const result = landing.roll(plane, dt, { throttle: 0, airbrake: 0, roll: 0, pitch: 0, wheelBrake: false, towAcceleration: plane.speed < 29 ? 2.8 : .5 });
      if (result.crash) return result;
      if (plane.speed >= 27) {
        this.phase = "climbing"; landing.grounded = false; landing.status = "airborne";
        plane.pitch = .1; plane.verticalSpeed = 2.7; landing.align(plane); landing.bounceTime = .7;
        this.reason = "Climbing on tow · L to release · auto release at 350 m";
      }
      return result;
    }
    const beforeSpeed = plane.speed;
    plane.speed += (32 - plane.speed) * (1 - Math.exp(-.45 * dt));
    const speed = (beforeSpeed + plane.speed) / 2;
    plane.pitch += (.105 - plane.pitch) * (1 - Math.exp(-3 * dt));
    plane.roll *= Math.exp(-4 * dt);
    plane.verticalSpeed = speed * Math.sin(.095);
    Object.assign(plane, offsetFlight(plane, speed * Math.cos(.095) * dt));
    plane.height += plane.verticalSpeed * dt;
    if (plane.height - this.groundHeight >= RELEASE_HEIGHT) {
      this.releaseAltitude = plane.height - this.groundHeight;
      this.release(plane, landing, "350 m · tow released · free gliding");
    }
    return { handled: true };
  }
  snapshot() { return this.pose ? { ...this.pose, phase: this.phase, connected: this.attached || this.phase === "hooking" } : null; }
  render(scene, frameAt, glider, dt, visible = true) { this.visuals.update(scene, frameAt, glider, visible ? this.snapshot() : null, dt); }
}
