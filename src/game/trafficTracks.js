import { TRAFFIC, destination, distanceM, finite, wrapLongitude } from "../../shared/trafficState.js";

function interpolate(a, b, t) {
  // Interpolate the short great-circle arc, including across the date line.
  const rad = Math.PI / 180, p1 = a.latitudeDeg * rad, p2 = b.latitudeDeg * rad;
  const dl = wrapLongitude(b.longitudeDeg - a.longitudeDeg) * rad;
  const bearing = Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) / rad;
  const point = destination(a.latitudeDeg, a.longitudeDeg, bearing, distanceM({ lat: a.latitudeDeg, lon: a.longitudeDeg }, { lat: b.latitudeDeg, lon: b.longitudeDeg }) * t);
  return { ...b, latitudeDeg: point.lat, longitudeDeg: point.lon, altitudeM: a.altitudeM + (b.altitudeM - a.altitudeM) * t };
}
export function predictPosition(sample, time, prediction = true) {
  const seconds = prediction ? Math.min(TRAFFIC.freshSeconds, Math.max(0, time - sample.timePosition)) : 0;
  let lat = sample.latitudeDeg, lon = sample.longitudeDeg;
  if (finite(sample.velocityMps) && finite(sample.trueTrackDeg)) {
    const point = destination(lat, lon, sample.trueTrackDeg, sample.velocityMps * seconds);
    lat = point.lat; lon = point.lon;
  }
  return { ...sample, latitudeDeg: lat, longitudeDeg: lon, altitudeM: sample.altitudeM + (finite(sample.verticalRateMps) ? sample.verticalRateMps * seconds : 0) };
}

export class TrafficTracks {
  constructor({ limit = 2000 } = {}) { this.tracks = new Map(); this.limit = limit; }
  clear() { this.tracks.clear(); }
  ingest(snapshot, now) {
    for (const id of snapshot.removedIds || []) this.tracks.delete(id);
    for (const sample of (snapshot.aircraft || []).slice(0, this.limit)) {
      if (!sample || !/^[a-f0-9]{6}$/.test(sample.icao24 || "") || sample.onGround !== false
        || !finite(sample.latitudeDeg) || Math.abs(sample.latitudeDeg) > 90 || !finite(sample.longitudeDeg) || Math.abs(sample.longitudeDeg) > 180
        || !finite(sample.altitudeM) || !finite(sample.timePosition) || now - sample.timePosition > TRAFFIC.freshSeconds || now - sample.timePosition < -5) continue;
      let track = this.tracks.get(sample.icao24);
      if (!track) {
        if (this.tracks.size >= this.limit) continue;
        track = { samples: [], correction: null }; this.tracks.set(sample.icao24, track);
      }
      const previous = track.samples.at(-1);
      if (previous && sample.timePosition <= previous.timePosition) {
        if (sample.timePosition === previous.timePosition && sample.aircraft) previous.aircraft = sample.aircraft;
        continue;
      }
      if (previous) {
        const jump = distanceM({ lat: previous.latitudeDeg, lon: previous.longitudeDeg }, { lat: sample.latitudeDeg, lon: sample.longitudeDeg });
        if (jump > Math.max(5000, (sample.timePosition - previous.timePosition) * 500 + 2000)) { track.samples = []; track.correction = null; }
        else track.correction = { previous, at: now };
      }
      track.samples.push(sample);
      if (track.samples.length > 4) track.samples.shift();
    }
    this.prune(now);
  }
  prune(now) {
    for (const [id, track] of this.tracks) if (now - track.samples.at(-1).timePosition > TRAFFIC.removeSeconds) this.tracks.delete(id);
  }
  positions(now, { prediction = true } = {}) {
    this.prune(now);
    const result = [];
    for (const track of this.tracks.values()) {
      const latest = track.samples.at(-1), age = Math.max(0, now - latest.timePosition);
      if (age >= TRAFFIC.hideSeconds) continue;
      let position = predictPosition(latest, now, prediction);
      if (prediction) {
        for (let i = 1; i < track.samples.length; i++) {
          const a = track.samples[i - 1], b = track.samples[i];
          if (now >= a.timePosition && now < b.timePosition) { position = interpolate(a, b, (now - a.timePosition) / (b.timePosition - a.timePosition)); break; }
        }
        if (track.correction && now - track.correction.at < 2) {
          const t = Math.max(0, (now - track.correction.at) / 2);
          position = interpolate(predictPosition(track.correction.previous, now), position, t * t * (3 - 2 * t));
        }
      }
      result.push({ ...position, ageSeconds: age, freshness: age <= 30 ? 1 : (60 - age) / 30 });
    }
    return result;
  }
}
