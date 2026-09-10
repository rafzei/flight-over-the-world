import { beginAirMotion, advanceAirMotion } from "./weather.js";
import { Euler, MathUtils, Vector3 } from "three";
import { PlaneController, HIGH_SPEED_CONTROL_PENALTY } from "./plane.js";
import { LunarController } from "./lunarController.js";
import { SailplaneController } from "./sailplane.js";
import { BalloonController } from "./balloon.js";

const EARTH_RADIUS = 6378137;
const blend = (rate, dt) => 1 - Math.exp(-rate * dt);

function integrate(controller, dt, north, east, vertical) {
  controller.lat = MathUtils.clamp(controller.lat + north * dt / EARTH_RADIUS, -Math.PI / 2 + 1e-6, Math.PI / 2 - 1e-6);
  controller.lon += east * dt / (EARTH_RADIUS * Math.max(1e-6, Math.cos(controller.lat)));
  controller.height += vertical * dt;
}

// Assisted quadrotor: powered rotors control lift independently of forward
// speed. Cutting throttle removes lift, so the drone sinks under gravity.
export class DroneController extends PlaneController {
  constructor(...args) {
    super(...args);
    this.northSpeed = Math.cos(this.heading) * this.speed;
    this.eastSpeed = Math.sin(this.heading) * this.speed;
    this.verticalSpeed = 0;
    this.yawRate = 0;
  }

  update(dt, ctrl) {
    if (!(dt > 0)) return;
    beginAirMotion(this);
    const lever = Number.isFinite(ctrl.throttle) ? MathUtils.clamp(ctrl.throttle, 0, 1) : this.cruiseT;
    this.throttle += (lever - this.throttle) * blend(5, dt);
    const yawAuthority = 1.2 - .45 * this.speed / this.boost * HIGH_SPEED_CONTROL_PENALTY;
    this.yawRate += (ctrl.roll * yawAuthority - this.yawRate) * blend(7, dt);
    this.heading += this.yawRate * dt;
    const targetSpeed = this.throttle * this.boost;
    const dN = Math.cos(this.heading) * targetSpeed - this.northSpeed;
    const dE = Math.sin(this.heading) * targetSpeed - this.eastSpeed;
    const delta = Math.hypot(dN, dE);
    const acceleration = targetSpeed < this.speed ? 32 : 20;
    const response = Math.min(blend(2.8, dt), acceleration * dt / Math.max(delta, 1e-9));
    this.northSpeed += dN * response;
    this.eastSpeed += dE * response;
    if (lever === 0 && Math.hypot(this.northSpeed, this.eastSpeed) < .02) this.northSpeed = this.eastSpeed = 0;
    const lift = MathUtils.smoothstep(this.throttle, 0, .12);
    const verticalTarget = ctrl.pitch * 16 * lift - (1 - lift) * 28;
    // With the motors off, gravity accelerates the descent towards a terminal
    // speed; restoring throttle smoothly restores altitude control.
    this.verticalSpeed += (verticalTarget - this.verticalSpeed) * blend(.35 + 3.65 * lift, dt);
    if (Math.abs(verticalTarget) < .001 && Math.abs(this.verticalSpeed) < .01) this.verticalSpeed = 0;
    this.speed = Math.hypot(this.northSpeed, this.eastSpeed);
    this.roll += (-ctrl.roll * .32 - this.roll) * blend(7, dt);
    this.pitch += (-this.speed / this.boost * .22 + ctrl.pitch * .12 - this.pitch) * blend(5, dt);
    advanceAirMotion(this, dt, this.northSpeed, this.eastSpeed, this.verticalSpeed, ctrl.weather);
  }
}

// Upright rocket: thrust accelerates along its +Y body axis; velocity carries
// through turns and gravity keeps acting after the engines are throttled down.
export class FalconController extends PlaneController {
  constructor(...args) {
    super(...args);
    this.speed = 0;
    this.cruiseT = this.throttle = .6;
    this.velocity = new Vector3(); // east, north, up
    this.thrustDirection = new Vector3();
    this.attitude = new Euler(0, 0, 0, "ZXY");
    this.yawRate = 0;
  }

  update(dt, ctrl) {
    const lever = Number.isFinite(ctrl.throttle) ? MathUtils.clamp(ctrl.throttle, 0, 1) : this.cruiseT;
    this.throttle += (lever - this.throttle) * blend(2, dt);
    const authority = MathUtils.lerp(1, 1 / Math.sqrt(1 + this.speed / 250), HIGH_SPEED_CONTROL_PENALTY);
    // Pitch persists after releasing the key: a rocket steers by changing its attitude.
    this.pitch = MathUtils.clamp(this.pitch + ctrl.pitch * .38 * authority * dt, -1.35, 1.35);
    this.yawRate += (ctrl.roll * .65 * authority - this.yawRate) * blend(3, dt);
    this.heading += this.yawRate * dt;
    this.roll += (-ctrl.roll * .16 * authority - this.roll) * blend(3, dt);
    this.attitude.set(this.pitch, -this.roll, -this.heading, "ZXY");
    this.thrustDirection.set(0, 0, 1).applyEuler(this.attitude);
    this.velocity.addScaledVector(this.thrustDirection, this.throttle * 38 * dt);
    this.velocity.z -= 9.81 * dt;
    const drag = .001 + this.velocity.length() * .000005;
    this.velocity.multiplyScalar(Math.exp(-drag * dt));
    if (this.velocity.length() > this.boost) this.velocity.setLength(this.boost);
    this.speed = this.velocity.length();
    integrate(this, dt, this.velocity.y, this.velocity.x, this.velocity.z);
  }
}

export function createVehicleController(lat, lon, height, heading, spec) {
  const Controller = spec.flightModel === "lunar" ? LunarController
    : spec.flightModel === "balloon" ? BalloonController
    : spec.flightModel === "sailplane" ? SailplaneController
    : spec.flightModel === "drone" ? DroneController
    : spec.flightModel === "falcon" ? FalconController : PlaneController;
  return new Controller(lat, lon, height, heading, spec);
}
