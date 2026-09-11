import { Vector3 } from 'three';
import { SOLAR_BODIES, SOLAR_BODY_BY_ID, bodyPositionInertial, bodyVelocityInertial } from './solarSystem.js';
import { SPACE_CONSTANTS as C } from './spacePhysics.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const mix = t => t * t * (3 - 2 * t);
export function destinationApproach(id, time) {
  const body = SOLAR_BODY_BY_ID[id], center = bodyPositionInertial(id, time);
  const normal = id === 'moon' ? center.clone().normalize().negate()
    : id === 'sun' ? new Vector3(0, -1, .4).normalize()
    : bodyPositionInertial('sun', time).sub(center).normalize();
  const radius = id === 'moon' ? body.radius + 30000 : body.radius * (id === 'sun' ? 5 : 3.4);
  return { center, normal, radius, position: center.clone().addScaledVector(normal, radius) };
}
function clearance(body) { return body.radius * (body.rings ? 2.6 : body.id === 'sun' ? 2 : 1.35); }

// This is a visible, accelerated game cruise drive, not a fuel/relativity model.
// Positions traverse every segment continuously; sphere avoidance prevents the
// shortcut through Earth, the Sun or another planet that a direct lerp permits.
export function planSolarTransfer(start, id, time = 0) {
  if (!SOLAR_BODY_BY_ID[id]) return null;
  const duration = 55;
  const approach = destinationApproach(id, time + duration);
  const obstacles = SOLAR_BODIES.map(body => ({ body, center: bodyPositionInertial(body.id, time + duration / 2), radius: clearance(body) }));
  const points = [start.clone()];
  const departure = obstacles.filter(o => start.distanceTo(o.center) < o.radius * 2.5)
    .sort((a, b) => start.distanceTo(a.center) / a.body.radius - start.distanceTo(b.center) / b.body.radius)[0];
  if (departure) {
    // Exit the local body's gravity neighbourhood radially before turning.
    const center = bodyPositionInertial(departure.body.id, time);
    const up = start.clone().sub(center).normalize();
    points.push(center.addScaledVector(up, Math.max(start.distanceTo(center), departure.radius * 3)));
  }
  points.push(approach.position);
  // Insert off-axis detours, with ample margin for the small orbital movement
  // over this real-time cruise. The first radial departure segment is exempt.
  for (let pass = 0; pass < 24; pass++) {
    let found = false;
    for (let i = departure ? 1 : 0; i < points.length - 1 && !found; i++) {
      const a = points[i], b = points[i + 1], direction = b.clone().sub(a), lengthSq = direction.lengthSq();
      for (const obstacle of obstacles) {
        const t = clamp(obstacle.center.clone().sub(a).dot(direction) / Math.max(1, lengthSq), 0, 1);
        const closest = a.clone().addScaledVector(direction, t);
        if (closest.distanceTo(obstacle.center) >= obstacle.radius || t <= .0000001 || t >= .9999999) continue;
        let away = closest.sub(obstacle.center);
        if (away.length() < obstacle.radius * .01) {
          away.crossVectors(direction, new Vector3(0, 0, 1));
          if (away.lengthSq() < 1) away.crossVectors(direction, new Vector3(0, 1, 0));
        }
        points.splice(i + 1, 0, obstacle.center.clone().add(away.setLength(obstacle.radius * 3)));
        found = true; break;
      }
    }
    if (!found) break;
  }
  const weights = points.slice(1).map((p, i) => Math.max(1, Math.sqrt(p.distanceTo(points[i]) / 1e8)));
  const total = weights.reduce((a, b) => a + b, 0);
  // Keep the launch leg readable even when the final destination is Neptune.
  const minimum = 5, free = duration - minimum * weights.length;
  const segmentSeconds = weights.map(w => minimum + Math.max(0, free) * w / total);
  return { id, startTime: time, elapsed: 0, duration: segmentSeconds.reduce((a, b) => a + b, 0), points, segmentSeconds };
}
export function advanceSolarTransfer(transfer, dt) {
  transfer.elapsed = Math.min(transfer.duration, transfer.elapsed + dt);
  let local = transfer.elapsed, i = 0;
  while (i < transfer.segmentSeconds.length - 1 && local > transfer.segmentSeconds[i]) local -= transfer.segmentSeconds[i++];
  const seconds = transfer.segmentSeconds[i], t = clamp(local / seconds, 0, 1);
  const position = transfer.points[i].clone().lerp(transfer.points[i + 1], mix(t));
  const velocity = transfer.points[i + 1].clone().sub(transfer.points[i]).multiplyScalar(6 * t * (1 - t) / seconds);
  return { position, velocity, finished: transfer.elapsed >= transfer.duration };
}
export function orbitState(id, startTime, time) {
  const approach = destinationApproach(id, startTime), body = SOLAR_BODY_BY_ID[id];
  const normal = new Vector3(0, -Math.sin(C.EARTH_AXIAL_TILT), Math.cos(C.EARTH_AXIAL_TILT));
  if (Math.abs(normal.dot(approach.normal)) > .95) normal.set(1, 0, 0);
  const tangent = normal.clone().cross(approach.normal).normalize();
  const omega = Math.sqrt(body.mu / approach.radius ** 3), angle = (time - startTime) * omega;
  const offset = approach.normal.clone().multiplyScalar(Math.cos(angle)).addScaledVector(tangent, Math.sin(angle)).multiplyScalar(approach.radius);
  const velocity = approach.normal.clone().multiplyScalar(-Math.sin(angle)).addScaledVector(tangent, Math.cos(angle)).multiplyScalar(approach.radius * omega).add(bodyVelocityInertial(id, time));
  return { position: bodyPositionInertial(id, time).add(offset), velocity, normal: offset.normalize() };
}
