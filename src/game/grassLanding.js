import { MathUtils } from "three";
import { Runway } from "./runway.js";

export function offsetFlight(p, forward, right = 0) {
  const north = Math.cos(p.heading) * forward - Math.sin(p.heading) * right;
  const east = Math.sin(p.heading) * forward + Math.cos(p.heading) * right;
  return { lat: p.lat + north / 6378137, lon: p.lon + east / (6378137 * Math.max(.01, Math.cos(p.lat))), height: p.height };
}

// The grass landing plane is fitted to actual streamed terrain. Polygon data
// grants surface eligibility, never height or permission to pass through trees.
export function sampleGrassSurface(plane, fields, probe) {
  const samples = [[0, 0], [18, 0], [-18, 0], [0, -10], [0, 10]].map(([forward, right]) => {
    const p = offsetFlight(plane, forward, right);
    if (!fields.at(p.lat, p.lon)) return null;
    const h = probe(p.lat, p.lon, Math.max(plane.height + 100, 2500));
    if (!Number.isFinite(h.surface) || !Number.isFinite(h.ground) || h.surface - h.ground > 1.5) return null;
    return h.surface;
  });
  if (samples.some(h => h === null)) return null;
  const [center, ahead, behind, left, right] = samples;
  const slope = (ahead - behind) / 36;
  if (Math.abs(slope) > .07 || Math.abs(right - left) > .6 || Math.abs((ahead + behind) / 2 - center) > .45 || Math.abs((left + right) / 2 - center) > .35) return null;
  return { height: center + .08, slope: Math.atan(slope) };
}

class GrassPatch extends Runway {
  constructor(plane, fields, sample) {
    super({ id: "grass-field", airportId: "GRASS", airportName: "Grass field", lat: plane.latDeg,
      lon: plane.lonDeg, elevation: sample.height, heading: plane.headingDeg, width: 4000, length: 4000,
      ends: [{ ident: "FIELD", threshold: 0 }, { ident: "FIELD", threshold: 0 }] });
    this.isGrass = true; this.fields = fields; this.slope = sample.slope; this.calibrated = true;
    this.definition.name = "Grass field"; this.rebuildFrame(); this.checkedAt = { lat: plane.lat, lon: plane.lon };
  }
  contains(point) {
    const p = this.pose(point.x, -point.z, point.y);
    return !!this.fields.at(p.lat, p.lon);
  }
  calibrate() { return false; }
}

export class GrassLanding {
  constructor(fields) { this.fields = fields; this.reason = ""; this.nextCheck = 0; }
  reset() { this.reason = ""; this.nextCheck = 0; }
  update(plane, system, probe, dt) {
    if (!plane.isSailplane || !system.gear) return false;
    const current = system.runway;
    if (current.isGrass && (system.grounded || system.bounceTime > 0 || (current.contains(current.coordinates(plane)) && current.coordinates(plane).y < 40))) {
      const distance = Math.hypot(plane.lat - current.checkedAt.lat, (plane.lon - current.checkedAt.lon) * Math.cos(plane.lat)) * 6378137;
      if (distance > 5) {
        const sample = sampleGrassSurface(plane, this.fields, probe);
        if (!sample) { this.reason = "Rough ground or edge of grass field"; return system.grounded; }
        const ground = current.pose(current.coordinates(plane).x, -current.coordinates(plane).z).height;
        current.elevation += MathUtils.clamp(sample.height - ground, -.4, .4);
        current.rebuildFrame(); current.checkedAt = { lat: plane.lat, lon: plane.lon };
        if (system.grounded) system.align(plane);
      }
      return true;
    }
    this.nextCheck -= dt;
    if (this.nextCheck > 0) return false;
    this.nextCheck = .2;
    if (!this.fields.at(plane.lat, plane.lon)) return false;
    const position = current.coordinates(plane);
    if (!current.isGrass && current.contains(position) && position.y < 40) return false;
    const sample = sampleGrassSurface(plane, this.fields, probe);
    if (!sample || plane.height - sample.height > 35) return false;
    system.reset(); system.runway = new GrassPatch(plane, this.fields, sample); this.reason = "";
    return true;
  }
}

export function checkTowPath(plane, runway, fields, probe) {
  const start = probe(plane.lat, plane.lon, Math.max(plane.height + 100, 2500));
  if (!Number.isFinite(start.surface)) return "Waiting for terrain ahead to load";
  let previous = start.surface;
  for (let forward = 0; forward <= 600; forward += 25) {
    for (const right of [-10, 0, 10]) {
      const p = offsetFlight(plane, forward, right), onGround = forward <= 250;
      if (onGround && runway.isGrass && !fields.at(p.lat, p.lon)) return "Need 250 m of clear grass ahead for tow takeoff";
      const h = probe(p.lat, p.lon, Math.max(plane.height + 150, 2500));
      if (!Number.isFinite(h.surface)) return "Waiting for terrain ahead to load";
      if (onGround && (Math.abs(h.surface - previous) > 1.75 || h.surface - h.ground > 1.5)) return "Tow path is too rough or obstructed";
      if (!onGround && h.surface > start.surface + (forward - 180) * .085 - 3) return "Obstacle in the tow climb path";
      if (right === 0) previous = h.surface;
    }
  }
  return null;
}
