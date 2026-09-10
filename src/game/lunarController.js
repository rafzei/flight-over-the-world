import { MathUtils, Matrix4, Quaternion, Vector3 } from "three";
import { PlaneController } from "./plane.js";
import {
  SPACE_CONSTANTS as C, MOON_ORBIT_NORMAL, ecefToGeodetic, ecefToInertial,
  geodeticToECEF, gravityAcceleration, inertialToECEF, localBasis,
  moonPositionInertial, moonVelocityInertial, surfaceVelocityInertial,
} from "./spacePhysics.js";

const Z = new Vector3(0, 0, 1), X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0);
const WARP_LEVELS = Object.freeze([1, 10, 100, 1000]);
export { WARP_LEVELS };
// Matches actual centered models after the main loader's max-dimension scaling.
// Rocket's fin span is 12 m, but its body is only 10.6162132066 m long.
export const LUNAR_SURFACE_CLEARANCE = Object.freeze({ falcon9: 19, rocket: 5.308106603278619 });
const lunarOmega = 2 * Math.PI / C.MOON_ORBITAL_PERIOD;

function firstSphereContact(a, b, radius) {
  const d = b.clone().sub(a), aa = d.lengthSq(), bb = 2 * a.dot(d), cc = a.lengthSq() - radius * radius;
  if (cc <= 0) return 0;
  const discriminant = bb * bb - 4 * aa * cc;
  if (aa === 0 || discriminant < 0) return null;
  const fraction = (-bb - Math.sqrt(discriminant)) / (2 * aa);
  return fraction >= 0 && fraction <= 1 ? fraction : null;
}

// Continuous thrust with unlimited propellant is an explicitly assisted game
// spacecraft, not a simulation of Falcon 9 fuel use or real lunar capability.
// Gravity, inertia, body distances, rotation and elapsed time remain physical.
export class LunarController extends PlaneController {
  constructor(...args) {
    super(...args);
    const spec = args[4] ?? {};
    this.isLunar = true;
    this.vertical = !!spec.vertical;
    this.surfaceClearance = spec.surfaceClearance ?? LUNAR_SURFACE_CLEARANCE[this.vertical ? "falcon9" : "rocket"];
    this.maximumThrustAcceleration = 38;
    this.simulationTime = 0;
    this.timeWarp = this.effectiveTimeWarp = 1;
    this.spaceStatus = "flight";
    this.guidancePhase = "manual";
    this.guidanceActive = false;
    this.positionInertial = new Vector3();
    this.velocityInertial = new Vector3();
    this.velocity = new Vector3(); // compatibility: Earth-relative east/north/up
    this.thrustDirectionInertial = new Vector3();
    this.orientationInertial = new Quaternion();
    this.orientationECEF = new Quaternion();
    this.speed = 0;
    this.cruiseT = this.throttle = .6;
    this._lastPose = null;
    this._surfaceNormal = null;
    this._guidanceTarget = null;
    this.rebaseFromGeodetic();
  }

  rebaseFromGeodetic({ preserveVelocity = false } = {}) {
    if (this._lastPose && !preserveVelocity) {
      this.guidanceActive = false;
      this.guidancePhase = "manual";
      this.timeWarp = this.effectiveTimeWarp = 1;
    }
    ecefToInertial(geodeticToECEF(this.lat, this.lon, this.height), this.simulationTime, this.positionInertial);
    if (!preserveVelocity) {
      surfaceVelocityInertial(this.positionInertial, this.velocityInertial);
      const basis = localBasis(this.lat, this.lon);
      const forward = basis.north.multiplyScalar(Math.cos(this.heading)).addScaledVector(basis.east, Math.sin(this.heading));
      const right = basis.east.multiplyScalar(Math.cos(this.heading)).addScaledVector(localBasis(this.lat, this.lon).north, -Math.sin(this.heading));
      const up = basis.up;
      const matrix = new Matrix4().makeBasis(right, up, forward.negate());
      this.orientationInertial.setFromRotationMatrix(matrix).premultiply(new Quaternion().setFromAxisAngle(Z, this.simulationTime * C.EARTH_ANGULAR_SPEED));
      this.orientationInertial.multiply(new Quaternion().setFromAxisAngle(X, this.pitch));
      this.velocity.set(0, 0, 0);
      this.spaceStatus = "flight";
      this._surfaceNormal = null;
    }
    this._publishPose();
  }

  setTimeWarp(value) {
    if (WARP_LEVELS.includes(Number(value))) this.timeWarp = Number(value);
    return this.timeWarp;
  }

  startLunarGuidance() {
    if (this._needsRebase()) this.rebaseFromGeodetic();
    if (this.spaceStatus !== "flight" || this.crashed) return false;
    this.guidanceActive = true;
    const altitude = this.positionInertial.length() - C.EARTH_EQUATORIAL_RADIUS;
    this.guidancePhase = altitude < 390000 ? "ascent" : "transfer";
    return true;
  }

  stopLunarGuidance() {
    this.guidanceActive = false;
    this.guidancePhase = "manual";
    this.timeWarp = 1;
  }

  _needsRebase() {
    return this._lastPose && (Math.abs(this.lat - this._lastPose.lat) > 1e-10 || Math.abs(this.lon - this._lastPose.lon) > 1e-10 || Math.abs(this.height - this._lastPose.height) > .001);
  }

  _publishPose() {
    const ecef = inertialToECEF(this.positionInertial, this.simulationTime);
    const pose = ecefToGeodetic(ecef);
    this.lat = pose.lat; this.lon = pose.lon; this.height = pose.height;
    const relative = this.velocityInertial.clone().sub(surfaceVelocityInertial(this.positionInertial));
    inertialToECEF(relative, this.simulationTime, relative);
    const basis = localBasis(this.lat, this.lon);
    this.velocity.set(relative.dot(basis.east), relative.dot(basis.north), relative.dot(basis.up));
    this.verticalSpeed = this.velocity.z;
    this.speed = this.velocityInertial.length();
    this.orientationECEF.copy(this.orientationInertial).premultiply(new Quaternion().setFromAxisAngle(Z, -this.simulationTime * C.EARTH_ANGULAR_SPEED));
    this.thrustDirectionInertial.copy(this.vertical ? Y : new Vector3(0, 0, -1)).applyQuaternion(this.orientationInertial).normalize();
    const forward = new Vector3(0, 0, -1).applyQuaternion(this.orientationECEF);
    this.heading = Math.atan2(forward.dot(basis.east), forward.dot(basis.north));
    this.pitch = Math.asin(MathUtils.clamp(forward.dot(basis.up), -1, 1));
    const right = X.clone().applyQuaternion(this.orientationECEF);
    this.roll = Math.atan2(right.dot(basis.up), new Vector3(0, 1, 0).applyQuaternion(this.orientationECEF).dot(basis.up));
    this._lastPose = { lat: this.lat, lon: this.lon, height: this.height };
  }

  _pointThrust(direction) {
    if (direction.lengthSq() < 1e-12) return;
    const thrust = direction.clone().normalize();
    const hint = this.positionInertial.clone().normalize();
    if (Math.abs(hint.dot(thrust)) > .98) hint.copy(MOON_ORBIT_NORMAL);
    const right = new Vector3(), up = new Vector3(), back = new Vector3();
    if (this.vertical) {
      up.copy(thrust); right.crossVectors(up, hint).normalize(); back.crossVectors(right, up);
    } else {
      back.copy(thrust).negate(); right.crossVectors(hint, back).normalize(); up.crossVectors(back, right);
    }
    this.orientationInertial.setFromRotationMatrix(new Matrix4().makeBasis(right, up, back));
    this.thrustDirectionInertial.copy(thrust);
  }

  _guidanceAcceleration(time) {
    const position = this.positionInertial, radial = position.clone().normalize();
    const moon = moonPositionInertial(time), lunarDirection = moon.clone().normalize();
    const target = new Vector3(), targetVelocity = new Vector3();
    const earthAltitude = position.length() - C.EARTH_EQUATORIAL_RADIUS;
    const moonAltitude = position.distanceTo(moon) - C.MOON_RADIUS - this.surfaceClearance;
    let speedLimit = 12000, brakingAcceleration = 8;
    if (this.guidancePhase === "ascent" && earthAltitude >= 390000) this.guidancePhase = "dogleg";
    if (this.guidancePhase === "transfer" && radial.dot(lunarDirection) < .45 && earthAltitude < 2000000) this.guidancePhase = "dogleg";
    if (this.guidancePhase === "dogleg" && radial.dot(lunarDirection) >= .65) this.guidancePhase = "transfer";
    if (this.guidancePhase === "transfer" && moonAltitude < 200000) this.guidancePhase = "lunar-descent";
    if (this.guidancePhase === "ascent") {
      target.copy(radial).multiplyScalar(C.EARTH_EQUATORIAL_RADIUS + 410000);
      surfaceVelocityInertial(position, targetVelocity);
      speedLimit = 1600;
    } else if (this.guidancePhase === "dogleg") {
      const tangent = lunarDirection.clone().addScaledVector(radial, -radial.dot(lunarDirection));
      if (tangent.lengthSq() < 1e-8) tangent.crossVectors(radial, MOON_ORBIT_NORMAL);
      tangent.normalize();
      target.copy(radial).multiplyScalar(Math.cos(.12)).addScaledVector(tangent, Math.sin(.12)).multiplyScalar(C.EARTH_EQUATORIAL_RADIUS + 410000);
      speedLimit = 1400;
    } else {
      // Tidally locked near-side target follows the Moon's orbit and spin.
      const normal = lunarDirection.negate();
      const offset = normal.multiplyScalar(C.MOON_RADIUS + this.surfaceClearance - .05);
      target.copy(moon).add(offset);
      targetVelocity.copy(moonVelocityInertial(time)).add(new Vector3().crossVectors(MOON_ORBIT_NORMAL, offset).multiplyScalar(lunarOmega));
      if (this.guidancePhase === "lunar-descent") {
        brakingAcceleration = 3;
        speedLimit = moonAltitude < 100 ? 2 : moonAltitude < 2000 ? 35 : 1200;
      }
    }
    this._guidanceTarget = target.clone();
    const error = target.sub(position), distance = error.length();
    const approachSpeed = Math.min(speedLimit, Math.sqrt(Math.max(0, 2 * brakingAcceleration * distance)) * .72);
    const desiredVelocity = error.multiplyScalar(approachSpeed / Math.max(distance, 1e-9)).add(targetVelocity);
    const responseTime = this.guidancePhase === "lunar-descent" ? 1.8 : 6;
    const acceleration = desiredVelocity.sub(this.velocityInertial).multiplyScalar(1 / responseTime).sub(gravityAcceleration(position, time));
    if (acceleration.length() > this.maximumThrustAcceleration) acceleration.setLength(this.maximumThrustAcceleration);
    this.throttle = acceleration.length() / this.maximumThrustAcceleration;
    this._pointThrust(acceleration);
    return acceleration;
  }

  _acceleration(time, thrust) {
    const acceleration = gravityAcceleration(this.positionInertial, time).add(thrust);
    const altitude = ecefToGeodetic(this.positionInertial).height;
    if (altitude < 150000) {
      const airVelocity = this.velocityInertial.clone().sub(surfaceVelocityInertial(this.positionInertial));
      if (this.weather && altitude < 24000) {
        const { lat, lon } = ecefToGeodetic(this.positionInertial);
        const n=this.weather.north, e=this.weather.east, u=this.weather.up;
        airVelocity.sub(new Vector3(
          -Math.sin(lat)*Math.cos(lon)*n-Math.sin(lon)*e+Math.cos(lat)*Math.cos(lon)*u,
          -Math.sin(lat)*Math.sin(lon)*n+Math.cos(lon)*e+Math.cos(lat)*Math.sin(lon)*u,
          Math.cos(lat)*n+Math.sin(lat)*u,
        ));
      }
      const density = 1.225 * Math.exp(-Math.max(0, altitude) / 8500);
      acceleration.addScaledVector(airVelocity, -.5 * density * airVelocity.length() / 40000);
    }
    return acceleration;
  }

  _safeTimeWarp(realSeconds) {
    const altitude = ecefToGeodetic(this.positionInertial).height;
    const descent = -this.velocityInertial.dot(this.positionInertial.clone().normalize());
    // Enter the atmosphere in real time, including a crossing during this
    // frame. Re-evaluate after every substep, not once for a warped frame.
    const lookAhead = Math.max(0, descent) * Math.min(10, realSeconds * this.timeWarp);
    if (descent > 1 && altitude - lookAhead < 150000) return 1;
    const moonAltitude = this.positionInertial.distanceTo(moonPositionInertial(this.simulationTime)) - C.MOON_RADIUS - this.surfaceClearance;
    const nearest = Math.min(altitude, moonAltitude);
    return Math.min(this.timeWarp, nearest < 1000 ? 1 : nearest < 20000 ? 10 : nearest < 150000 ? 100 : 1000);
  }

  _landedUpdate(dt) {
    this._surfaceNormal.applyAxisAngle(MOON_ORBIT_NORMAL, dt * lunarOmega);
    this.simulationTime += dt;
    const offset = this._surfaceNormal.clone().multiplyScalar(C.MOON_RADIUS + this.surfaceClearance);
    this.positionInertial.copy(moonPositionInertial(this.simulationTime)).add(offset);
    this.velocityInertial.copy(moonVelocityInertial(this.simulationTime)).add(new Vector3().crossVectors(MOON_ORBIT_NORMAL, offset).multiplyScalar(lunarOmega));
    this._pointThrust(this._surfaceNormal);
  }

  update(dt, ctrl = {}) {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    this.weather = ctrl.weather ?? null;
    // Tile snapping, Restart and the spawn menu set geodetic coordinates from
    // outside. Rebase once so the old inertial trajectory cannot pull us back.
    if (this._needsRebase()) this.rebaseFromGeodetic();
    if (this.crashed || this.spaceStatus.startsWith("impact")) return;
    if (Number.isFinite(ctrl.timeWarp)) this.setTimeWarp(ctrl.timeWarp);
    let remaining = dt;
    if (this.spaceStatus === "landed-moon") {
      this.effectiveTimeWarp = this.timeWarp;
      this._landedUpdate(dt * this.timeWarp); this._publishPose(); return;
    }
    if (!this.guidanceActive) {
      const lever = Number.isFinite(ctrl.throttle) ? MathUtils.clamp(ctrl.throttle, 0, 1) : this.cruiseT;
      this.throttle += (lever - this.throttle) * (1 - Math.exp(-5 * dt));
      // Attitude is inertial and persists in vacuum. Rotation controls stay in
      // real seconds under time warp, so a held key cannot spin 1000x faster.
      this.orientationInertial.multiply(new Quaternion().setFromAxisAngle(X, (ctrl.pitch ?? 0) * .4 * dt));
      this.orientationInertial.multiply(new Quaternion().setFromAxisAngle(this.vertical ? Z : Y, -(ctrl.roll ?? 0) * .5 * dt));
      this.thrustDirectionInertial.copy(this.vertical ? Y : new Vector3(0, 0, -1)).applyQuaternion(this.orientationInertial).normalize();
    }
    while (remaining > 1e-9 && this.spaceStatus === "flight") {
      this.effectiveTimeWarp = this._safeTimeWarp(remaining);
      const moonStart = moonPositionInertial(this.simulationTime);
      const lunarHeight = this.positionInertial.distanceTo(moonStart) - C.MOON_RADIUS - this.surfaceClearance;
      const earthHeight = ecefToGeodetic(this.positionInertial).height;
      const closest = Math.min(lunarHeight, earthHeight);
      const airSpeed = this.velocityInertial.clone().sub(surfaceVelocityInertial(this.positionInertial)).length();
      const dragRate = .5 * 1.225 * Math.exp(-Math.max(0, earthHeight) / 8500) * airSpeed / 40000;
      const step = Math.min(remaining * this.effectiveTimeWarp, .2 / Math.max(dragRate, 1e-9), closest < 2000 ? .05 : closest < 150000 ? .5 : this.guidanceActive ? 2 : 10);
      const realStep = step / this.effectiveTimeWarp;
      const before = this.positionInertial.clone(), oldVelocity = this.velocityInertial.clone();
      const thrust = this.guidanceActive ? this._guidanceAcceleration(this.simulationTime) : this.thrustDirectionInertial.clone().multiplyScalar(this.throttle * this.maximumThrustAcceleration);
      const a0 = this._acceleration(this.simulationTime, thrust);
      this.positionInertial.addScaledVector(this.velocityInertial, step).addScaledVector(a0, .5 * step * step);
      this.velocityInertial.addScaledVector(a0, .5 * step);
      this.simulationTime += step;
      this.velocityInertial.addScaledVector(this._acceleration(this.simulationTime, thrust), .5 * step);
      const moonEnd = moonPositionInertial(this.simulationTime);
      const relativeStart = before.clone().sub(moonStart), relativeEnd = this.positionInertial.clone().sub(moonEnd);
      const contact = firstSphereContact(relativeStart, relativeEnd, C.MOON_RADIUS + this.surfaceClearance);
      if (contact !== null) {
        this.simulationTime -= step * (1 - contact);
        const normal = relativeStart.lerp(relativeEnd, contact).normalize();
        this._surfaceNormal = normal;
        this.velocityInertial.lerpVectors(oldVelocity, this.velocityInertial, contact);
        const offset = normal.clone().multiplyScalar(C.MOON_RADIUS + this.surfaceClearance);
        const surfaceVelocity = moonVelocityInertial(this.simulationTime).add(new Vector3().crossVectors(MOON_ORBIT_NORMAL, offset).multiplyScalar(lunarOmega));
        const contactSpeed = this.velocityInertial.clone().sub(surfaceVelocity).length();
        const tilt = Math.acos(MathUtils.clamp(this.thrustDirectionInertial.dot(normal), -1, 1));
        this.touchdownSpeedMps = contactSpeed;
        this.spaceStatus = contactSpeed <= 4 && tilt <= Math.PI / 6 ? "landed-moon" : "impact-moon";
        this.crashed = this.spaceStatus === "impact-moon";
        this.guidanceActive = false;
        this.guidancePhase = this.crashed ? "impact" : "arrived";
        this.timeWarp = this.effectiveTimeWarp = 1;
        this.throttle = 0;
        this.positionInertial.copy(moonPositionInertial(this.simulationTime)).add(offset);
        if (!this.crashed) this._landedUpdate(0);
      } else {
        const pose = ecefToGeodetic(inertialToECEF(this.positionInertial, this.simulationTime));
        // Sweep the WGS84 ellipsoid, including a trajectory that would cross
        // through Earth and finish outside again during one accelerated step.
        const earthStart = before.clone().divide(new Vector3(C.EARTH_EQUATORIAL_RADIUS, C.EARTH_EQUATORIAL_RADIUS, C.EARTH_POLAR_RADIUS));
        const earthEnd = this.positionInertial.clone().divide(new Vector3(C.EARTH_EQUATORIAL_RADIUS, C.EARTH_EQUATORIAL_RADIUS, C.EARTH_POLAR_RADIUS));
        const earthContact = firstSphereContact(earthStart, earthEnd, 1);
        if (pose.height < 0 || earthContact !== null) {
          if (earthContact !== null) {
            this.positionInertial.lerpVectors(before, this.positionInertial, earthContact);
            this.simulationTime -= step * (1 - earthContact);
          }
          this.spaceStatus = "impact-earth"; this.crashed = true;
          this.guidanceActive = false; this.guidancePhase = "impact";
          this.timeWarp = this.effectiveTimeWarp = 1;
        }
      }
      remaining -= realStep;
    }
    this._publishPose();
  }

  diagnostics() {
    const moon = moonPositionInertial(this.simulationTime);
    const moonDistanceM = this.positionInertial.distanceTo(moon);
    const normal = this.positionInertial.clone().sub(moon).normalize();
    const surfaceVelocity = moonVelocityInertial(this.simulationTime).add(new Vector3().crossVectors(MOON_ORBIT_NORMAL, normal).multiplyScalar(lunarOmega * (C.MOON_RADIUS + this.surfaceClearance)));
    return {
      simulationTime: this.simulationTime,
      status: this.spaceStatus, guidanceActive: this.guidanceActive,
      guidancePhase: this.guidancePhase, timeWarp: this.timeWarp,
      effectiveTimeWarp: this.effectiveTimeWarp,
      moonDistanceM, moonAltitudeM: moonDistanceM - C.MOON_RADIUS - this.surfaceClearance,
      remainingDistanceM: Math.max(0, moonDistanceM - C.MOON_RADIUS - this.surfaceClearance),
      relativeMoonSpeedMps: this.velocityInertial.clone().sub(surfaceVelocity).length(),
      speedMps: this.velocityInertial.length(), earthAltitudeM: this.height,
      surfaceClearance: this.surfaceClearance, touchdownSpeedMps: this.touchdownSpeedMps ?? null,
      propulsionModel: "assisted-unlimited-propellant",
    };
  }
}
