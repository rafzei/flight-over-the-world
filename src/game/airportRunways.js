import catalogue from '../data/polishRunways.json' with { type: 'json' };
import { Runway, createRunwayVisual } from './runway.js';

export const POLISH_RUNWAYS = catalogue.runways;
export const DEFAULT_APPROACH = 'EPWA-15-33:33';
const DEG = Math.PI / 180;
const angle = a => Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));

export class AirportRunways {
  constructor(definitions = POLISH_RUNWAYS) {
    this.runways = definitions.map(d => new Runway(d));
    this.approaches = this.runways.flatMap(r => r.directions);
    this.byId = new Map(this.approaches.map(r => [r.definition.id, r]));
    this.visuals = new Map();
    this.scene = null;
    this.mapRoot = null;
  }
  get(id) { return this.byId.get(id); }
  attach(scene, mapRoot) { this.scene = scene; this.mapRoot = mapRoot; }
  nearby(plane, radius = 35000) {
    // Cheap geographic broad phase avoids transforms for every Polish airfield.
    const lat = plane.lat / DEG, lon = plane.lon / DEG;
    return this.runways.filter(r => Math.hypot((r.data.lat - lat) * 111200, (r.data.lon - lon) * 111200 * Math.cos(plane.lat)) < radius + r.data.length);
  }
  choose(plane, { current, locked = false, preferred } = {}) {
    if (locked && current) return current;
    let best = current || this.approaches[0], bestScore = Infinity;
    for (const runway of this.nearby(plane)) for (const approach of runway.directions) {
      const d = approach.definition, p = approach.coordinates(plane), along = -p.z;
      const yaw = angle(plane.heading - d.heading * DEG);
      if (yaw > Math.PI / 2) continue;
      const distance = Math.hypot(Math.max(0, Math.abs(p.x) - d.width / 2), Math.max(0, -along, along - d.length));
      // Inside an actual pavement wins over a neighbouring parallel runway.
      let score = distance + Math.abs(p.x) * .5 + yaw * 2500;
      if (approach.contains(p)) score -= 100000;
      if (approach === current) score -= 60;
      if (d.id === preferred) score -= 100;
      if (score < bestScore) { bestScore = score; best = approach; }
    }
    return best;
  }
  updateVisuals(plane) {
    if (!this.scene) return;
    const visible = new Set(this.nearby(plane));
    for (const runway of visible) {
      let visual = this.visuals.get(runway);
      if (!visual) {
        visual = createRunwayVisual(this.scene, runway, this.mapRoot);
        this.visuals.set(runway, visual);
      }
      visual.update();
    }
    for (const [runway, visual] of this.visuals) if (!visible.has(runway)) {
      visual.dispose(); this.visuals.delete(runway);
    }
  }
  dispose() { for (const visual of this.visuals.values()) visual.dispose(); this.visuals.clear(); }
}
