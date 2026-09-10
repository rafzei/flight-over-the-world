import { TRAFFIC, distanceM, finite, wrapLongitude } from "../../shared/trafficState.js";
import { TrafficRunways, classifyApproach, headingDelta } from "./trafficApproach.js";
import { applyCorrection, buildTrajectory, estimateMotion, trajectoryPosition } from "./trafficTrajectory.js";

export function predictPosition(sample, time, prediction = true) {
  return prediction ? trajectoryPosition(buildTrajectory(sample, estimateMotion([sample])), time) : { ...sample };
}

export class TrafficTracks {
  constructor({ limit = 2000, runways = new TrafficRunways() } = {}) { this.tracks = new Map(); this.limit = limit; this.runways = runways; }
  clear() { this.tracks.clear(); }
  loadRunways(data, now = this.lastTime) {
    if (!this.runways.load(data)) return false;
    for (const track of this.tracks.values()) {
      const displayed = this.current(track, now);
      this.forecast(track);
      this.correct(track, displayed, now);
    }
    return true;
  }
  forecast(track) {
    const sample = track.samples.at(-1), motion = estimateMotion(track.samples);
    track.approach = classifyApproach(sample, motion, this.runways, track.approach);
    track.trajectory = buildTrajectory(sample, motion, track.approach);
  }
  current(track, now) { return applyCorrection(trajectoryPosition(track.trajectory, now), track.correction, now); }
  correct(track, displayed, now) {
    const target = trajectoryPosition(track.trajectory, now);
    const error = distanceM({ lat: displayed.latitudeDeg, lon: displayed.longitudeDeg }, { lat: target.latitudeDeg, lon: target.longitudeDeg });
    track.correction = { at: now, duration: Math.max(3, Math.min(20, error / Math.max(20, target.velocityMps * .3))),
      lat: displayed.latitudeDeg - target.latitudeDeg, lon: wrapLongitude(displayed.longitudeDeg - target.longitudeDeg),
      altitude: displayed.altitudeM - target.altitudeM, heading: headingDelta(displayed.trueTrackDeg, target.trueTrackDeg),
      bank: displayed.bankDeg - target.bankDeg };
  }
  ingest(snapshot, now) {
    this.lastTime = now;
    // Ground reports are authoritative; a missing row is not a landing.
    for (const id of snapshot.removedIds || []) this.tracks.delete(id);
    for (const sample of (snapshot.aircraft || []).slice(0, this.limit)) {
      if (!sample || !/^[a-f0-9]{6}$/.test(sample.icao24 || "") || sample.onGround !== false
        || !finite(sample.latitudeDeg) || Math.abs(sample.latitudeDeg) > 90 || !finite(sample.longitudeDeg) || Math.abs(sample.longitudeDeg) > 180
        || !finite(sample.altitudeM) || !finite(sample.timePosition) || now - sample.timePosition > TRAFFIC.initialAgeSeconds || now - sample.timePosition < -5) continue;
      let track = this.tracks.get(sample.icao24);
      if (!track) {
        if (this.tracks.size >= this.limit) continue;
        track = { samples: [], correction: null }; this.tracks.set(sample.icao24, track);
      }
      const previous = track.samples.at(-1);
      if (previous && sample.timePosition <= previous.timePosition) {
        if (sample.timePosition === previous.timePosition && sample.aircraft) {
          previous.aircraft = sample.aircraft; track.trajectory.sample.aircraft = sample.aircraft;
        }
        continue;
      }
      let displayed = previous ? this.current(track, now) : null;
      if (previous) {
        const jump = distanceM({ lat: previous.latitudeDeg, lon: previous.longitudeDeg }, { lat: sample.latitudeDeg, lon: sample.longitudeDeg });
        if (jump > Math.max(5000, (sample.timePosition - previous.timePosition) * 500 + 2000)) {
          track.samples = []; track.correction = null; track.approach = null; displayed = null;
        }
      }
      track.samples.push({ ...sample });
      if (track.samples.length > 8) track.samples.shift();
      this.forecast(track);
      if (displayed) this.correct(track, displayed, now);
    }
    this.prune(now);
  }
  prune(now) {
    for (const [id, track] of this.tracks) if (now - track.samples.at(-1).timePosition > TRAFFIC.removeSeconds) this.tracks.delete(id);
  }
  positions(now, { prediction = true } = {}) {
    this.lastTime = now;
    this.prune(now);
    const result = [];
    for (const track of this.tracks.values()) {
      const latest = track.samples.at(-1), age = Math.max(0, now - latest.timePosition);
      if (age >= TRAFFIC.hideSeconds) continue;
      const position = prediction ? this.current(track, now) : { ...latest, phase: track.approach.phase, approach: track.approach };
      const fade = Math.max(0, (age - TRAFFIC.fadeSeconds) / (TRAFFIC.hideSeconds - TRAFFIC.fadeSeconds));
      result.push({ ...position, ageSeconds: age, freshness: 1 - fade * fade * (3 - 2 * fade),
        estimated: prediction && (age > TRAFFIC.freshSeconds || position.phase === "landing-estimate"), motionInferred: track.trajectory.motion.inferred,
        uncertaintyM: prediction ? Math.round(25 + age * 5 + age * age * .04) : 0 });
    }
    return result;
  }
}
