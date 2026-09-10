import { Vector3 } from "three";

// SI units. Mean radii describe physical scales; Earth contact/rendering uses
// WGS84. The circular lunar orbit is a mean educational model, not an ephemeris.
export const SPACE_CONSTANTS = Object.freeze({
  EARTH_MEAN_RADIUS: 6371000,
  EARTH_EQUATORIAL_RADIUS: 6378137,
  EARTH_POLAR_RADIUS: 6356752.314245,
  EARTH_MU: 3.986004418e14,
  EARTH_SIDEREAL_PERIOD: 86164.09053,
  EARTH_ANGULAR_SPEED: 2 * Math.PI / 86164.09053,
  EARTH_AXIAL_TILT: 23.44 * Math.PI / 180,
  MOON_RADIUS: 1737400,
  MOON_DISTANCE: 384400000,
  MOON_MU: 4.9048695e12,
  MOON_ORBITAL_PERIOD: 27.321661 * 86400,
  MOON_ECLIPTIC_INCLINATION: 5.145 * Math.PI / 180,
});

const C = SPACE_CONSTANTS;
const lunarInclination = C.EARTH_AXIAL_TILT + C.MOON_ECLIPTIC_INCLINATION;
export const MOON_ORBIT_NORMAL = new Vector3(0, -Math.sin(lunarInclination), Math.cos(lunarInclination));
const spinAxis = new Vector3(0, 0, 1);
const moon = new Vector3(), displacement = new Vector3();

export function earthRotationAngle(time = 0) { return time * C.EARTH_ANGULAR_SPEED; }
export function ecefToInertial(vector, time = 0, out = new Vector3()) {
  return out.copy(vector).applyAxisAngle(spinAxis, earthRotationAngle(time));
}
export function inertialToECEF(vector, time = 0, out = new Vector3()) {
  return out.copy(vector).applyAxisAngle(spinAxis, -earthRotationAngle(time));
}
export function surfaceVelocityInertial(position, out = new Vector3()) {
  return out.set(-position.y * C.EARTH_ANGULAR_SPEED, position.x * C.EARTH_ANGULAR_SPEED, 0);
}

export function moonPositionInertial(time = 0, out = new Vector3()) {
  const angle = time * 2 * Math.PI / C.MOON_ORBITAL_PERIOD;
  return out.set(Math.cos(angle), Math.sin(angle) * Math.cos(lunarInclination), Math.sin(angle) * Math.sin(lunarInclination)).multiplyScalar(C.MOON_DISTANCE);
}
export function moonVelocityInertial(time = 0, out = new Vector3()) {
  const angle = time * 2 * Math.PI / C.MOON_ORBITAL_PERIOD;
  return out.set(-Math.sin(angle), Math.cos(angle) * Math.cos(lunarInclination), Math.cos(angle) * Math.sin(lunarInclination)).multiplyScalar(C.MOON_DISTANCE * 2 * Math.PI / C.MOON_ORBITAL_PERIOD);
}
export function moonPositionECEF(time = 0, out = new Vector3()) {
  return inertialToECEF(moonPositionInertial(time, out), time, out);
}
export function sunDirectionInertial(time = 0, out = new Vector3()) {
  // Illustrative starting season/phase: the near-side landing area is sunlit.
  // This clock is mission-relative, not a prediction for the current UTC date.
  const annualAngle = 110 * Math.PI / 180 + time * 2 * Math.PI / (365.256363004 * 86400);
  return out.set(Math.cos(annualAngle), Math.sin(annualAngle) * Math.cos(C.EARTH_AXIAL_TILT), Math.sin(annualAngle) * Math.sin(C.EARTH_AXIAL_TILT));
}

export function geodeticToECEF(lat, lon, height, out = new Vector3()) {
  const e2 = 1 - (C.EARTH_POLAR_RADIUS / C.EARTH_EQUATORIAL_RADIUS) ** 2;
  const n = C.EARTH_EQUATORIAL_RADIUS / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  return out.set((n + height) * Math.cos(lat) * Math.cos(lon), (n + height) * Math.cos(lat) * Math.sin(lon), (n * (1 - e2) + height) * Math.sin(lat));
}
export function ecefToGeodetic(position) {
  const { x, y, z } = position;
  const p = Math.hypot(x, y), a = C.EARTH_EQUATORIAL_RADIUS, b = C.EARTH_POLAR_RADIUS;
  const e2 = 1 - b * b / (a * a);
  if (p < 1e-6) return { lat: Math.sign(z) * Math.PI / 2, lon: 0, height: Math.abs(z) - b };
  let lat = Math.atan2(z, p * (1 - e2));
  for (let i = 0; i < 8; i++) {
    const n = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
    lat = Math.atan2(z + e2 * n * Math.sin(lat), p);
  }
  const n = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  const height = p * Math.cos(lat) + z * Math.sin(lat) - n * (1 - e2 * Math.sin(lat) ** 2);
  return { lat, lon: Math.atan2(y, x), height };
}

// Earth-centred inertial approximation. The indirect Moon term subtracts the
// acceleration of Earth's origin, avoiding a spurious translational force.
export function gravityAcceleration(position, time = 0, out = new Vector3()) {
  const radius = Math.max(position.length(), 1);
  out.copy(position).multiplyScalar(-C.EARTH_MU / radius ** 3);
  moonPositionInertial(time, moon);
  displacement.copy(moon).sub(position);
  out.addScaledVector(displacement, C.MOON_MU / Math.max(displacement.length(), 1) ** 3);
  return out.addScaledVector(moon, -C.MOON_MU / C.MOON_DISTANCE ** 3);
}

export function localBasis(lat, lon) {
  return {
    east: new Vector3(-Math.sin(lon), Math.cos(lon), 0),
    north: new Vector3(-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)),
    up: new Vector3(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)),
  };
}
