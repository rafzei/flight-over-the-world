import { MathUtils, Quaternion, Vector3 } from "three";

const BODY_UP = new Vector3(0, 1, 0);

// Assisted first-stage return in the local Earth-fixed frame. Position is
// integrated from velocity; the landing target never teleports the booster.
export class BoosterRecovery {
  constructor({ position, velocity, orientation, up, target, clearance }) {
    this.position = position.clone(); this.velocity = velocity.clone();
    this.orientation = orientation.clone(); this.up = up.clone().normalize();
    this.target = target.clone(); this.clearance = clearance;
    this.age = 0; this.phase = "separation"; this.throttle = 0;
    this.legs = 0; this.fins = 0; this.landed = false;
    this.touchdownSpeed = null;
  }

  get height() { return this.position.clone().sub(this.target).dot(this.up) - this.clearance; }

  update(dt, timeWarp = 1) {
    if (!(dt > 0) || !Number.isFinite(dt) || this.landed || this.phase === "failed") return;
    let remaining = dt;
    while (remaining > 1e-9 && !this.landed && this.phase !== "failed") {
      const height = this.height, vertical = this.velocity.dot(this.up);
      const warp = height < 1000 || (vertical < 0 && height < 150000) ? 1 : Math.min(100, Math.max(1, timeWarp));
      const step = Math.min(remaining * warp, height < 500 ? 1 / 60 : .05);
      remaining -= step / warp; this.age += step;
      this.fins = Math.min(1, Math.max(0, (this.age - 1) / 1.5));
      if (height < Math.max(250, -vertical * 5)) this.legs = Math.min(1, this.legs + step / 2.5);
      const offset = this.position.clone().sub(this.target);
      offset.addScaledVector(this.up, -offset.dot(this.up));
      const horizontal = this.velocity.clone().addScaledVector(this.up, -vertical);
      const distance = offset.length();
      const desiredHorizontal = offset.multiplyScalar(-Math.min(120, Math.sqrt(8 * distance)) / Math.max(distance, 1e-9));
      const thrust = desiredHorizontal.sub(horizontal).multiplyScalar(.8);
      if (vertical > 5) {
        this.phase = "boostback";
        thrust.addScaledVector(this.up, -Math.min(14, vertical / 4));
      } else {
        const descent = -Math.min(180, .8 + Math.max(0, height) * .35, Math.max(.8, Math.sqrt(2 * 8 * Math.max(0, height)) * .65));
        thrust.addScaledVector(this.up, Math.max(0, 9.81 + (descent - vertical) * 1.5));
        this.phase = height < 600 ? "landing-burn" : "entry";
      }
      if (this.age < 1.5) { thrust.set(0, 0, 0); this.phase = "separation"; }
      if (thrust.length() > 55) thrust.setLength(55);
      const wanted = thrust.lengthSq() > 1 ? thrust.clone().normalize() : this.up;
      const orientation = new Quaternion().setFromUnitVectors(BODY_UP, wanted);
      this.orientation.rotateTowards(orientation, step * 1.8);
      const axis = BODY_UP.clone().applyQuaternion(this.orientation);
      // Do not ignite into the wrong direction while flipping after staging.
      this.throttle = thrust.length() / 55 * Math.max(0, axis.dot(wanted));
      const acceleration = axis.clone().multiplyScalar(this.throttle * 55).addScaledVector(this.up, -9.81);
      const drag = this.velocity.clone().multiplyScalar(-.00015 * this.fins * this.velocity.length());
      acceleration.add(drag);
      const before = this.position.clone();
      this.position.addScaledVector(this.velocity, step).addScaledVector(acceleration, .5 * step * step);
      this.velocity.addScaledVector(acceleration, step);
      if (this.height <= 0) {
        const fraction = MathUtils.clamp(height / Math.max(1e-9, height - this.height), 0, 1);
        this.position.lerpVectors(before, this.position, fraction);
        this.position.addScaledVector(this.up, -this.height);
        this.touchdownSpeed = this.velocity.length();
        this.landed = this.legs >= .999 && this.touchdownSpeed <= 4 && axis.dot(this.up) > Math.cos(Math.PI / 12);
        this.phase = this.landed ? "landed" : "failed";
        this.velocity.set(0, 0, 0); this.throttle = 0;
        if (this.landed) this.orientation.copy(new Quaternion().setFromUnitVectors(BODY_UP, this.up));
      }
    }
  }
}

// A single Enter retains Dragon release; a second press consumes that pending
// action and stages instead. Advancing in the game loop respects pause/reset.
export class FalconStageInput {
  constructor({ single, double, delay = 300 }) { this.single = single; this.double = double; this.delay = delay; this.pendingAt = null; }
  press(now) {
    if (this.pendingAt !== null && now - this.pendingAt <= this.delay) {
      this.pendingAt = null; this.double(); return;
    }
    this.update(now);
    this.pendingAt = now;
  }
  update(now) {
    if (this.pendingAt !== null && now - this.pendingAt > this.delay) {
      this.pendingAt = null; this.single();
    }
  }
  reset() { this.pendingAt = null; }
}
