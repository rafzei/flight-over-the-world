import { destination, distanceM, finite, wrapLongitude } from "../../shared/trafficState.js";

const DEG = Math.PI / 180;
export const headingDelta = (a, b) => wrapLongitude(a - b);
export function bearing(a, b) {
  const p = a.latitudeDeg * DEG, q = b.latitudeDeg * DEG, dl = wrapLongitude(b.longitudeDeg - a.longitudeDeg) * DEG;
  return (Math.atan2(Math.sin(dl) * Math.cos(q), Math.cos(p) * Math.sin(q) - Math.sin(p) * Math.cos(q) * Math.cos(dl)) / DEG + 360) % 360;
}

export class TrafficRunways {
  constructor() { this.cells = new Map(); this.count = 0; }
  load(data) {
    if (data?.version !== 1 || !Array.isArray(data.runways) || data.runways.length > 100000) return false;
    this.cells.clear(); this.count = 0;
    for (const row of data.runways) {
      if (!Array.isArray(row) || row.length !== 9 || !row.slice(3).every(finite)) continue;
      const [id, airport, ident, lat, lon, heading, length, width, elevation] = row;
      if (typeof id !== "string" || typeof airport !== "string" || typeof ident !== "string" || Math.abs(lat) > 90 || Math.abs(lon) > 180 || heading < 0 || heading >= 360 || length < 500 || width <= 0 || elevation < -500 || elevation > 6000) continue;
      const key = `${Math.floor(lat)}:${Math.floor(lon)}`;
      if (!this.cells.has(key)) this.cells.set(key, []);
      this.cells.get(key).push({ id, airport, ident, lat, lon, heading, length, width, elevation }); this.count++;
    }
    return true;
  }
  nearby(lat, lon) {
    const result = [], latitude = Math.floor(lat), longitude = Math.floor(lon);
    const span = Math.min(180, Math.ceil(.4 / Math.max(.003, Math.cos(lat * DEG))));
    for (let y = Math.max(-90, latitude - 1); y <= Math.min(89, latitude + 1); y++) {
      for (let x = longitude - span; x <= longitude + span; x++) {
        result.push(...(this.cells.get(`${y}:${Math.floor(wrapLongitude(x))}`) || []));
      }
    }
    return result;
  }
}

export function runwayCoordinates(sample, runway) {
  const distance = distanceM(runway, { lat: sample.latitudeDeg, lon: sample.longitudeDeg });
  const angle = (bearing({ latitudeDeg: runway.lat, longitudeDeg: runway.lon }, sample) - runway.heading) * DEG;
  return { along: distance * Math.cos(angle), cross: distance * Math.sin(angle), height: sample.altitudeM - runway.elevation };
}

// An approach is a hypothesis based on alignment, descent, speed and runway
// geometry. No inferred touchdown is promoted to a provider-reported landing.
export function classifyApproach(sample, motion, runways, previous = null) {
  const speed = motion.speed, vertical = motion.vertical;
  if (previous?.runway && vertical > 1.5 && sample.altitudeM - previous.runway.elevation < 2000 &&
      distanceM(previous.runway, { lat: sample.latitudeDeg, lon: sample.longitudeDeg }) < 15000) return { phase: "go-around", runway: previous.runway, confidence: .8 };
  if (vertical >= -.35 || speed < 25 || speed > 155) return { phase: vertical > 1.5 ? "climbing" : vertical < -1 ? "descending" : "cruise" };
  let best = null, bestScore = Infinity;
  for (const runway of runways.nearby(sample.latitudeDeg, sample.longitudeDeg)) {
    if (speed > 100 && runway.length < 1600) continue;
    const p = runwayCoordinates(sample, runway), distance = -p.along;
    const yaw = Math.abs(headingDelta(motion.heading, runway.heading));
    if (distance < -300 || distance > 25000 || p.height < 6 || p.height > 1700 || yaw > 22 ||
        Math.abs(p.cross) > Math.max(runway.width * 2, Math.min(650, Math.max(150, distance * .09)))) continue;
    const glide = Math.atan2(Math.max(0, p.height - 15), Math.max(300, distance)) / DEG;
    if (glide > 8 || (distance > 4000 && glide < .8)) continue;
    const score = yaw / 22 + Math.abs(p.cross) / 600 + Math.abs(glide - 3) / 6 - (previous?.runway?.id === runway.id ? .3 : 0);
    if (score < bestScore) {
      bestScore = score;
      const matches = previous?.runway?.id === runway.id && ["approach", "final"].includes(previous.phase);
      const repeated = matches && previous.observedAt < sample.timePosition && sample.timePosition - previous.observedAt <= 120;
      best = { phase: distance < 6000 ? "final" : "approach", runway, distanceM: Math.max(0, distance),
        confidence: matches && previous.observedAt === sample.timePosition ? previous.confidence : repeated ? .9 : .65,
        observedAt: sample.timePosition,
        touchdownInSeconds: Math.max(0, distance) / Math.max(1, speed) };
    }
  }
  return best || { phase: "descending" };
}

export function runwayPoint(runway, along, cross = 0) {
  const point = destination(runway.lat, runway.lon, runway.heading, along);
  return destination(point.lat, point.lon, runway.heading + 90, cross);
}
