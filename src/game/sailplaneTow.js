import { BufferGeometry, Float32BufferAttribute, Line, LineBasicMaterial, MathUtils, Vector3 } from "three";
import { createPlaneMesh, PlaneController } from "./plane.js";
import { disposeModelResources } from "./vehicleModels.js";
import { offsetFlight } from "./grassLanding.js";

const LEAD = 45, RELEASE_HEIGHT = 350;
const clamp = MathUtils.clamp;
const angle = value => Math.atan2(Math.sin(value), Math.cos(value));
const input = value => Number.isFinite(value) ? clamp(value, -1, 1) : 0;
const TOW_SPEC = { cruise: 32, boost: 33, brake: 21 };

export function parseTowSnapshot(value) {
  if (!value || !["arriving", "hooking", "rolling", "climbing", "departing"].includes(value.phase)) return null;
  if (!["lat", "lon", "height", "heading", "pitch"].every(key => Number.isFinite(value[key])) || Math.abs(value.lat) > Math.PI / 2 || Math.abs(value.lon) > Math.PI * 2 || Math.abs(value.height) > 100000) return null;
  if ((value.roll !== undefined && !Number.isFinite(value.roll)) || (value.throttle !== undefined && !Number.isFinite(value.throttle))) return null;
  return { lat: value.lat, lon: value.lon, height: value.height, heading: value.heading,
    pitch: clamp(value.pitch, -.5, .5), roll: clamp(value.roll ?? 0, -.9, .9), throttle: clamp(value.throttle ?? 1, 0, 1), phase: value.phase,
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
    const m = frameAt(state.lat, state.lon, state.height, state.heading, state.pitch || 0, -(state.roll || 0));
    m.decompose(this.aircraft.position, this.aircraft.quaternion, this.aircraft.scale);
    this.aircraft.userData.prop.rotation.z += dt * (12 + 53 * (state.throttle ?? 1));
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

// Controls fly the Cessna; the unpowered glider follows on a fixed-length tow.
// Neutral stick retains an assisted climb, while the pilot can bank and pitch.
export class SailplaneTow {
  constructor() { this.visuals = new TowVisuals(); this.reset(); }
  reset() {
    this.visuals?.dispose(); this.phase = "idle"; this.elapsed = 0; this.pose = null;
    this.origin = null; this.pilot = null; this.departure = null; this.reason = ""; this.releaseAltitude = null;
  }
  get attached() { return this.phase === "rolling" || this.phase === "climbing"; }
  get busy() { return this.phase !== "idle" && this.phase !== "departing"; }
  get throttle() { return this.pilot?.throttle ?? 1; }
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
      this.pilot = new PlaneController(plane.latDeg, plane.lonDeg, plane.height, plane.headingDeg, TOW_SPEC);
      this.pilot.throttle = 1;
      this.placeAhead(plane, .1);
      this.reason = "Pilot Cessna · A/D or stick to steer · THR controls tow power · L to release";
    } else if (this.phase === "departing") {
      if (this.elapsed > 10 || !this.departure) { this.phase = "idle"; this.pose = null; this.visuals.dispose(); return; }
      this.pose = { ...offsetFlight(this.departure, this.elapsed * 42, -(this.elapsed ** 2) * .8), height: this.departure.height + this.elapsed * 6, heading: this.departure.heading - this.elapsed * .025, pitch: .12, roll: (this.departure.roll || 0) * Math.exp(-this.elapsed), throttle: 1 };
    }
  }
  placeAhead(plane, rise) {
    Object.assign(this.pilot, offsetFlight(plane, Math.sqrt(LEAD ** 2 - rise ** 2)), {
      height: plane.height + rise, heading: plane.heading, speed: plane.speed,
    });
    this.pose = this.pilot;
  }
  step(dt, plane, landing, ctrl = {}) {
    if (!this.attached) return null;
    if (!(dt > 1e-8)) return { handled: true };
    if (landing.grounded && ctrl.wheelBrake) { this.release(plane, landing); return { handled: true }; }
    plane.throttle = 0; plane.airbrake = 0;
    const throttle = Number.isFinite(ctrl.throttle) ? clamp(ctrl.throttle, 0, 1) : 1;
    if (this.phase === "rolling") {
      this.pilot.throttle += (throttle - this.pilot.throttle) * (1 - Math.exp(-3.4 * dt));
      const result = landing.roll(plane, dt, { throttle: 0, airbrake: 0, roll: input(ctrl.roll), pitch: 0, wheelBrake: false, towAcceleration: this.pilot.throttle * (plane.speed < 29 ? 2.8 : .5) });
      if (result.crash) return result;
      this.placeAhead(plane, .1);
      if (plane.speed >= 27) {
        this.phase = "climbing"; landing.grounded = false; landing.status = "airborne";
        plane.pitch = .1; plane.verticalSpeed = 2.7; landing.align(plane); landing.bounceTime = .7;
        this.pilot.pitch = .095;
        this.placeAhead(plane, 4.2);
        this.reason = "Pilot Cessna · W/S pitch, A/D bank or use stick · THR power · L to release · auto release at 350 m";
      }
      return result;
    }
    this.pilot.update(dt, { roll: input(ctrl.roll) * .5, pitch: .095 / .4 + input(ctrl.pitch) * .5, throttle });
    // Project the glider onto the cable behind the moving tug. It follows the
    // cable direction through a turn instead of moving sideways with the tug.
    const north = (this.pilot.lat - plane.lat) * 6378137;
    const east = angle(this.pilot.lon - plane.lon) * 6378137 * Math.max(.01, Math.cos(plane.lat));
    const rise = this.pilot.height - plane.height;
    const distance = Math.hypot(north, east, rise);
    const heading = plane.heading + angle(Math.atan2(east, north) - plane.heading);
    const pitch = Math.atan2(rise, Math.hypot(north, east));
    const next = offsetFlight({ ...this.pilot, heading }, -LEAD * Math.cos(pitch));
    next.height = this.pilot.height - LEAD * Math.sin(pitch);
    const turnRate = angle(heading - plane.heading) / dt;
    plane.speed = Math.max(0, (distance - LEAD) / dt);
    plane.verticalSpeed = (next.height - plane.height) / dt;
    plane.groundSpeed = plane.speed * Math.cos(pitch);
    plane.trackHeading = heading;
    plane.pitch += (pitch + .01 - plane.pitch) * (1 - Math.exp(-3 * dt));
    const bank = clamp(-Math.atan2(turnRate * plane.speed, 9.81), -.65, .65);
    plane.roll += (bank - plane.roll) * (1 - Math.exp(-4 * dt));
    Object.assign(plane, next, { heading });
    if (plane.height - this.groundHeight >= RELEASE_HEIGHT) {
      this.releaseAltitude = plane.height - this.groundHeight;
      this.release(plane, landing, "350 m · tow released · free gliding");
    }
    return { handled: true };
  }
  snapshot() {
    if (!this.pose) return null;
    const { lat, lon, height, heading, pitch, roll = 0, throttle = 1 } = this.pose;
    return { lat, lon, height, heading, pitch, roll, throttle, phase: this.phase, connected: this.attached || this.phase === "hooking" };
  }
  render(scene, frameAt, glider, dt, visible = true) { this.visuals.update(scene, frameAt, glider, visible ? this.snapshot() : null, dt); }
}
