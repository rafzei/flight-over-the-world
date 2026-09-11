import { Matrix4, Quaternion, Vector3 } from 'three';
import { SPACE_CONSTANTS as C, MOON_ORBIT_NORMAL, moonPositionInertial } from './spacePhysics.js';
const R = C.MOON_RADIUS;
export const LUNAR_MAX_RELIEF = 1600;
const craterCache = new Map(), neighbourhoodCache = new Map();
const fract = x => x - Math.floor(x);
const hash = (x, y, z, seed = 0) => fract(Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 43.3) * 43758.5453123);
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function moonBodyOrientation(time = 0, out = new Quaternion()) {
  const x = moonPositionInertial(time).normalize().negate(), z = MOON_ORBIT_NORMAL.clone();
  const y = z.clone().cross(x).normalize(); z.crossVectors(x, y).normalize();
  return out.setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}
function cellCrater(ix, iy, iz, scale) {
  const key = `${scale}:${ix}:${iy}:${iz}`;
  if (craterCache.has(key)) return craterCache.get(key);
  const x = (ix + .2 + .6 * hash(ix, iy, iz)) * scale;
  const y = (iy + .2 + .6 * hash(ix, iy, iz, 1)) * scale;
  const z = (iz + .2 + .6 * hash(ix, iy, iz, 2)) * scale;
  const length = Math.hypot(x, y, z);
  const crater = Math.abs(length - R) < scale * .45 ? { x: x * R / length, y: y * R / length, z: z * R / length, radius: scale * (.18 + .25 * hash(ix, iy, iz, 3)) } : null;
  if (craterCache.size > 50000) craterCache.clear();
  craterCache.set(key, crater);
  return crater;
}
function nearbyCraters(ix, iy, iz, scale) {
  const key = `${scale}:${ix}:${iy}:${iz}`;
  if (neighbourhoodCache.has(key)) return neighbourhoodCache.get(key);
  const result = [];
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
    const crater = cellCrater(ix + a, iy + b, iz + c, scale);
    if (crater) result.push(crater);
  }
  if (neighbourhoodCache.size > 12000) neighbourhoodCache.clear();
  neighbourhoodCache.set(key, result);
  return result;
}
// A deterministic geometric surface shared by rendering, altimetry and contact.
// NASA imagery supplies the maria; relief is procedural, not a surveyed DEM.
export function lunarTerrainHeight(direction) {
  const s = R / Math.hypot(direction.x, direction.y, direction.z);
  const x = direction.x * s, y = direction.y * s, z = direction.z * s;
  let height = 95 * Math.sin(x / 17000 + Math.sin(z / 23000)) * Math.sin(y / 21000)
    + 22 * Math.sin((x + z) / 1900) * Math.sin(y / 2600);
  for (const scale of [6000, 1200, 180]) {
    const ix = Math.floor(x / scale), iy = Math.floor(y / scale), iz = Math.floor(z / scale);
    for (const crater of nearbyCraters(ix, iy, iz, scale)) {
      const q = Math.hypot(x - crater.x, y - crater.y, z - crater.z) / crater.radius;
      if (q > 1.5) continue;
      const bowl = q < 1 ? -.21 * (1 - q * q) ** 2 : 0;
      const rim = .07 * Math.exp(-(((q - 1) / .16) ** 2)) * (1 - smooth(1.25, 1.5, q));
      height += crater.radius * (bowl + rim);
    }
  }
  // A few nearby impact bowls make the landing site's terrain readable from
  // the external camera as well as from altitude.
  if (x > R - 1000 && Math.abs(y) < 1800 && Math.abs(z) < 1800) {
    for (const [cy, cz, radius] of [[180, 230, 85], [-260, -140, 125], [480, -380, 220], [-650, 700, 320]]) {
      const q = Math.hypot(y - cy, z - cz) / radius;
      if (q < 1.5) height += radius * ((q < 1 ? -.24 * (1 - q * q) ** 2 : 0) + .08 * Math.exp(-(((q - 1) / .17) ** 2)) * (1 - smooth(1.25, 1.5, q)));
    }
  }
  // A small, naturally flat mare at the guided landing site; surrounding relief
  // starts 100 m away. Manual flights may land anywhere on the sampled terrain.
  return height * smooth(100, 420, Math.hypot(x - R, y, z));
}
export function lunarSurfaceHeight(relativeInertial, time = 0) {
  return lunarTerrainHeight(relativeInertial.clone().applyQuaternion(moonBodyOrientation(time).invert()));
}
export function lunarAltitude(relativeInertial, time = 0, clearance = 0) {
  return relativeInertial.length() - R - lunarSurfaceHeight(relativeInertial, time) - clearance;
}
export function lunarSurfaceNormal(relativeInertial, time = 0) {
  const up = relativeInertial.clone().normalize();
  const right = new Vector3(0, 0, 1).cross(up);
  if (right.lengthSq() < .01) right.set(0, 1, 0).cross(up);
  right.normalize(); const back = up.clone().cross(right);
  const p = up.clone().multiplyScalar(R), h = lunarSurfaceHeight(p, time), delta = 2;
  const dx = (lunarSurfaceHeight(p.clone().addScaledVector(right, delta), time) - h) / delta;
  const dz = (lunarSurfaceHeight(p.clone().addScaledVector(back, delta), time) - h) / delta;
  return up.addScaledVector(right, -dx).addScaledVector(back, -dz).normalize();
}
