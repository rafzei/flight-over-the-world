import { Vector3 } from 'three';
import { SPACE_CONSTANTS as C, moonPositionInertial, moonVelocityInertial } from './spacePhysics.js';

export const AU = 149597870700;
const DAY = 86400, TAU = Math.PI * 2;
// Mean circular orbits in the same Earth-centred equatorial frame as the Moon.
// Phases are illustrative, not a date-specific ephemeris. Radii/distances are SI.
export const SOLAR_BODIES = Object.freeze([
  { id: 'sun', name: 'Sun', radius: 695700000, mu: 1.3271244e20, color: 0xffce68 },
  { id: 'mercury', name: 'Mercury', radius: 2439700, mu: 2.2032e13, au: .3871, days: 87.969, phase: 35, tilt: .03, color: 0xa69b8f },
  { id: 'venus', name: 'Venus', radius: 6051800, mu: 3.24859e14, au: .7233, days: 224.701, phase: 160, tilt: 177.4, color: 0xe5c18b },
  { id: 'earth', name: 'Earth', radius: C.EARTH_EQUATORIAL_RADIUS, mu: C.EARTH_MU, au: 1, days: 365.256363004, phase: 290, tilt: 23.44, color: 0x568ed4 },
  { id: 'mars', name: 'Mars', radius: 3389500, mu: 4.282837e13, au: 1.5237, days: 686.98, phase: 240, tilt: 25.2, color: 0xc56a43 },
  { id: 'jupiter', name: 'Jupiter', radius: 69911000, mu: 1.26686534e17, au: 5.2028, days: 4332.59, phase: 15, tilt: 3.1, color: 0xd7bb99, gas: true },
  { id: 'saturn', name: 'Saturn', radius: 58232000, mu: 3.7931187e16, au: 9.5388, days: 10759.22, phase: 115, tilt: 26.7, color: 0xd8c495, gas: true, rings: [1.25, 2.32] },
  { id: 'uranus', name: 'Uranus', radius: 25362000, mu: 5.793939e15, au: 19.1914, days: 30688.5, phase: 215, tilt: 97.8, color: 0x8ed2d8, gas: true, rings: [1.7, 2] },
  { id: 'neptune', name: 'Neptune', radius: 24622000, mu: 6.836529e15, au: 30.0611, days: 60182, phase: 310, tilt: 28.3, color: 0x386bbb, gas: true },
  { id: 'moon', name: 'Moon', radius: C.MOON_RADIUS, mu: C.MOON_MU, color: 0xb8b8b8 },
].map(Object.freeze));
export const SOLAR_BODY_BY_ID = Object.freeze(Object.fromEntries(SOLAR_BODIES.map(b => [b.id, b])));
export const FLIGHT_DESTINATIONS = Object.freeze(['moon', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'sun']);

export function heliocentricPosition(body, time = 0, out = new Vector3()) {
  if (!body.au) return out.set(0, 0, 0);
  const a = body.phase * Math.PI / 180 + time * TAU / (body.days * DAY);
  return out.set(Math.cos(a), Math.sin(a) * Math.cos(C.EARTH_AXIAL_TILT), Math.sin(a) * Math.sin(C.EARTH_AXIAL_TILT)).multiplyScalar(body.au * AU);
}
export function bodyPositionInertial(id, time = 0, out = new Vector3()) {
  if (id === 'moon') return moonPositionInertial(time, out);
  if (id === 'earth') return out.set(0, 0, 0);
  const body = SOLAR_BODY_BY_ID[id];
  if (!body) throw new RangeError(`Unknown destination: ${id}`);
  return heliocentricPosition(body, time, out).sub(heliocentricPosition(SOLAR_BODY_BY_ID.earth, time));
}
export function bodyVelocityInertial(id, time = 0, out = new Vector3()) {
  if (id === 'moon') return moonVelocityInertial(time, out);
  if (id === 'earth') return out.set(0, 0, 0);
  return out.copy(bodyPositionInertial(id, time + .5)).sub(bodyPositionInertial(id, time - .5));
}

export function solarGravityAcceleration(position, time = 0, out = new Vector3()) {
  out.set(0, 0, 0);
  for (const body of SOLAR_BODIES) {
    if (body.id === 'earth' || body.id === 'moon') continue;
    const center = bodyPositionInertial(body.id, time), delta = center.clone().sub(position);
    out.addScaledVector(delta, body.mu / Math.max(delta.length(), body.radius) ** 3);
    // Acceleration of the Earth-centred origin must be subtracted, too.
    out.addScaledVector(center, -body.mu / Math.max(center.length(), 1) ** 3);
  }
  return out;
}
