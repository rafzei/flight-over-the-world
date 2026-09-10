import { TRAFFIC, destination, distanceM, finite, wrapLongitude } from "../../shared/trafficState.js";
import { bearing, headingDelta, runwayCoordinates, runwayPoint } from "./trafficApproach.js";

const DEG = Math.PI / 180, STEP = 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const smooth = t => t * t * (3 - 2 * t);

export function estimateMotion(samples) {
  const latest = samples.at(-1), previous = samples.at(-2), older = samples.at(-3);
  const dt = previous ? latest.timePosition - previous.timePosition : 0;
  const usable = dt >= 1 && dt <= 120;
  const derivedSpeed = usable ? distanceM({ lat: previous.latitudeDeg, lon: previous.longitudeDeg }, { lat: latest.latitudeDeg, lon: latest.longitudeDeg }) / dt : 0;
  const heading = finite(latest.trueTrackDeg) ? latest.trueTrackDeg : usable && derivedSpeed > 1 ? bearing(previous, latest) : 0;
  const speed = finite(latest.trueTrackDeg) || (usable && derivedSpeed > 1) ? (finite(latest.velocityMps) ? latest.velocityMps : derivedSpeed) : 0;
  const vertical = finite(latest.verticalRateMps) ? latest.verticalRateMps : usable && latest.altitudeSource === previous.altitudeSource ? (latest.altitudeM - previous.altitudeM) / dt : 0;
  let previousHeading = previous?.trueTrackDeg;
  if (!finite(previousHeading) && older) previousHeading = bearing(older, previous);
  return { speed: clamp(speed, 0, 1500), heading: (heading + 360) % 360, vertical: clamp(vertical, -100, 100),
    turn: usable && finite(previousHeading) ? clamp(headingDelta(heading, previousHeading) / dt, -3, 3) : 0,
    acceleration: usable && finite(previous.velocityMps) ? clamp((speed - previous.velocityMps) / dt, -1.5, 1.5) : 0,
    inferred: !finite(latest.velocityMps) || !finite(latest.trueTrackDeg) || !finite(latest.verticalRateMps) };
}

// Build forecasts on receipt of observations; frames interpolate two knots.
export function buildTrajectory(sample, motion, approach = { phase: "cruise" }) {
  const knots = [];
  const runway = approach.runway, p = runway ? runwayCoordinates(sample, runway) : null;
  const landing = approach.phase === "final" && approach.confidence >= .85 && p.along < 0 && p.height > 6 &&
    Math.abs(p.cross) < 250 && Math.abs(headingDelta(motion.heading, runway.heading)) < 12;
  const touchdownAlong = runway ? Math.min(250, runway.length * .15) : 0;
  const touchdownTime = landing ? (touchdownAlong - p.along) / Math.max(1, motion.speed) : Infinity;
  let lat = sample.latitudeDeg, lon = sample.longitudeDeg;
  for (let seconds = 0; seconds <= TRAFFIC.hideSeconds; seconds += STEP) {
    const speed = clamp(motion.speed + motion.acceleration * 15 * (1 - Math.exp(-seconds / 15)), Math.min(25, motion.speed), 1500);
    const heading = (motion.heading + motion.turn * 20 * (1 - Math.exp(-seconds / 20)) + 360) % 360;
    const turn = motion.turn * Math.exp(-seconds / 20);
    let altitude = sample.altitudeM + motion.vertical * seconds, vertical = motion.vertical;
    let actualSpeed = speed, actualHeading = heading, phase = approach.phase;
    if (landing) {
      const after = Math.max(0, seconds - touchdownTime), brake = Math.max(1.8, motion.speed ** 2 / (2 * Math.max(100, runway.length - touchdownAlong - 100)));
      const rolling = Math.min(after, motion.speed / brake);
      const along = seconds <= touchdownTime ? p.along + motion.speed * seconds : touchdownAlong + motion.speed * rolling - .5 * brake * rolling * rolling;
      const point = runwayPoint(runway, along, p.cross * Math.exp(-seconds / 10));
      lat = point.lat; lon = point.lon;
      actualHeading = (motion.heading + headingDelta(runway.heading, motion.heading) * (1 - Math.exp(-seconds / 6)) + 360) % 360;
      actualSpeed = Math.max(0, motion.speed - brake * after);
      const u = clamp(seconds / touchdownTime, 0, 1), h = sample.altitudeM - runway.elevation - 6;
      // Hermite flare starts at the observed sink and ends level above the
      // runway. An inferred touchdown always remains a landing estimate.
      const tangent = clamp(motion.vertical * touchdownTime, -3 * h, 0);
      altitude = runway.elevation + 6 + (2 * u ** 3 - 3 * u ** 2 + 1) * h + (u ** 3 - 2 * u ** 2 + u) * tangent;
      vertical = seconds >= touchdownTime ? 0 : ((6 * u ** 2 - 6 * u) * h + (3 * u ** 2 - 4 * u + 1) * tangent) / touchdownTime;
      if (seconds >= touchdownTime) phase = "landing-estimate";
    } else if (seconds > 0) {
      const mid = seconds - STEP / 2;
      const midHeading = motion.heading + motion.turn * 20 * (1 - Math.exp(-mid / 20));
      const midSpeed = clamp(motion.speed + motion.acceleration * 15 * (1 - Math.exp(-mid / 15)), Math.min(25, motion.speed), 1500);
      const point = destination(lat, lon, midHeading, midSpeed * STEP); lat = point.lat; lon = point.lon;
    }
    const floor = runway && ["approach", "final", "landing-estimate"].includes(phase) ? runway.elevation + 6 : Math.min(-430, sample.altitudeM);
    if (altitude < floor) { altitude = floor; vertical = 0; }
    knots.push({ latitudeDeg: lat, longitudeDeg: lon, altitudeM: altitude, velocityMps: actualSpeed,
      trueTrackDeg: actualHeading, verticalRateMps: vertical, bankDeg: landing ? 0 : clamp(Math.atan(speed * turn * DEG / 9.81) / DEG, -25, 25), phase });
  }
  return { sample, motion, approach, knots };
}

export function trajectoryPosition(trajectory, time) {
  const seconds = clamp(time - trajectory.sample.timePosition, 0, TRAFFIC.hideSeconds);
  const index = Math.min(trajectory.knots.length - 1, Math.floor(seconds / STEP));
  const a = trajectory.knots[index], b = trajectory.knots[Math.min(index + 1, trajectory.knots.length - 1)], t = (seconds % STEP) / STEP;
  const result = { ...trajectory.sample, ...a,
    latitudeDeg: a.latitudeDeg + (b.latitudeDeg - a.latitudeDeg) * t,
    longitudeDeg: wrapLongitude(a.longitudeDeg + wrapLongitude(b.longitudeDeg - a.longitudeDeg) * t),
    trueTrackDeg: (a.trueTrackDeg + headingDelta(b.trueTrackDeg, a.trueTrackDeg) * t + 360) % 360 };
  for (const key of ["altitudeM", "velocityMps", "verticalRateMps", "bankDeg"]) result[key] = a[key] + (b[key] - a[key]) * t;
  if (trajectory.approach.runway) result.approach = { ...trajectory.approach, distanceM: Math.max(0, -runwayCoordinates(result, trajectory.approach.runway).along) };
  return result;
}

export function applyCorrection(position, correction, now) {
  if (!correction) return position;
  const t = clamp((now - correction.at) / correction.duration, 0, 1), remaining = 1 - smooth(t);
  return { ...position,
    latitudeDeg: clamp(position.latitudeDeg + correction.lat * remaining, -90, 90),
    longitudeDeg: wrapLongitude(position.longitudeDeg + correction.lon * remaining),
    altitudeM: position.altitudeM + correction.altitude * remaining,
    trueTrackDeg: (position.trueTrackDeg + correction.heading * remaining + 360) % 360,
    bankDeg: position.bankDeg + correction.bank * remaining };
}
