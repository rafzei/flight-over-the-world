import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { destination, distanceM, normalizeStates } from "../shared/trafficState.js";
import { TrafficTracks } from "../src/game/trafficTracks.js";
import { TrafficFeed } from "../src/game/trafficFeed.js";
import { TrafficRunways, classifyApproach, headingDelta, runwayCoordinates, runwayPoint } from "../src/game/trafficApproach.js";
import { buildTrajectory, estimateMotion, trajectoryPosition } from "../src/game/trafficTrajectory.js";

const sample = overrides => ({ icao24: "abc123", callsign: "TEST123", latitudeDeg: 0, longitudeDeg: 0, altitudeM: 1000,
  altitudeSource: "geo", timePosition: 1000, onGround: false, velocityMps: 200, trueTrackDeg: 90, verticalRateMps: 0, ...overrides });
const separation = (a, b) => distanceM({ lat: a.latitudeDeg, lon: a.longitudeDeg }, { lat: b.latitudeDeg, lon: b.longitudeDeg });
const close = (a, b, epsilon = 1e-5) => assert(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const runway = { id: "test:le", airport: "TEST", ident: "36", lat: 52, lon: 21, heading: 0, length: 3000, width: 45, elevation: 100 };
const catalogue = (...runways) => ({ version: 1, runways: runways.map(r => [r.id, r.airport, r.ident, r.lat, r.lon, r.heading, r.length, r.width, r.elevation]) });
const inbound = (along, time = 1000, overrides = {}) => {
  const p = runwayPoint(runway, along, overrides.cross || 0);
  return sample({ latitudeDeg: p.lat, longitudeDeg: p.lon, altitudeM: runway.elevation + 15 - along * Math.tan(Math.PI / 60),
    trueTrackDeg: 0, velocityMps: 70, verticalRateMps: -3.67, timePosition: time, ...overrides });
};

test("cached and missing observations keep moving without renewing their age", () => {
  const tracks = new TrafficTracks(), report = sample();
  tracks.ingest({ aircraft: [report] }, 1000);
  let previous = report;
  for (const age of [30, 60, 90, 120, 150, 179]) {
    tracks.ingest({ aircraft: age % 60 === 0 ? [] : [report] }, 1000 + age);
    const p = tracks.positions(1000 + age)[0];
    assert(separation(previous, p) > 5000); close(separation(report, p), age * 200, .01);
    assert.equal(p.ageSeconds, age); assert.equal(p.estimated, age > 30);
    assert(p.freshness > 0); previous = p;
  }
  assert.equal(tracks.positions(1180).length, 0);
  assert.equal(tracks.tracks.size, 1);
  tracks.positions(1241); assert.equal(tracks.tracks.size, 0);
});

test("delayed initial reports are accepted for prediction but ancient reports are rejected", () => {
  const row = ["abc123", "TEST", "", 955, 1000, 0, 0, 1000, false, 200, 90, 0, null, 1000, null, false, 0];
  const data = normalizeStates({ time: 1000, states: [row, ["abc124", ...row.slice(1, 3), 909, ...row.slice(4)]] }, 1000);
  assert.equal(data.aircraft.length, 1); assert.equal(data.stats.stale, 1);
  const tracks = new TrafficTracks(); tracks.ingest(data, 1000);
  assert(tracks.positions(1000)[0].estimated); close(separation(data.aircraft[0], tracks.positions(1000)[0]), 9000, .01);
});

test("new reports blend from the displayed position and heading, including mid-correction updates", () => {
  const tracks = new TrafficTracks(); tracks.ingest({ aircraft: [sample()] }, 1000);
  for (const [time, heading, north] of [[1060, 100, 400], [1062, 103, 450]]) {
    const before = tracks.positions(time)[0], east = destination(0, 0, 90, (time - 1000) * 200 - 800);
    const point = destination(east.lat, east.lon, 0, north);
    tracks.ingest({ aircraft: [sample({ timePosition: time, latitudeDeg: point.lat, longitudeDeg: point.lon, trueTrackDeg: heading, altitudeM: 1200 })] }, time);
    const after = tracks.positions(time)[0];
    close(separation(before, after), 0, 1e-4); close(before.altitudeM, after.altitudeM);
    close(headingDelta(before.trueTrackDeg, after.trueTrackDeg), 0); close(before.bankDeg, after.bankDeg);
    const next = tracks.positions(time + 1 / 60)[0]; assert(separation(after, next) > 1 && separation(after, next) < 6);
  }
  const track = tracks.tracks.get("abc123"), end = 1062 + track.correction.duration;
  const target = trajectoryPosition(track.trajectory, end), actual = tracks.positions(end)[0];
  close(separation(target, actual), 0, 1e-4); close(headingDelta(target.trueTrackDeg, actual.trueTrackDeg), 0);
});

test("missing speed, heading and vertical rate are inferred from positional history", () => {
  const point = destination(0, 0, 90, 3000), first = sample({ velocityMps: null, trueTrackDeg: null, verticalRateMps: null });
  const latest = sample({ ...first, timePosition: 1030, latitudeDeg: point.lat, longitudeDeg: point.lon, altitudeM: 910 });
  const motion = estimateMotion([first, latest]);
  close(motion.speed, 100); close(motion.heading, 90); close(motion.vertical, -3); assert(motion.inferred);
  const p = trajectoryPosition(buildTrajectory(latest, motion), 1090);
  close(separation(latest, p), 6000, .01); close(p.altitudeM, 730);
  assert.equal(estimateMotion([first]).speed, 0);
  assert.equal(estimateMotion([first, { ...latest, altitudeSource: "baro" }]).vertical, 0);
});

test("turn forecasts use the short heading arc, bank into the turn and decay instead of circling", () => {
  const first = sample({ trueTrackDeg: 359, velocityMps: 100 });
  const latest = sample({ trueTrackDeg: 1, velocityMps: 105, timePosition: 1010 });
  const motion = estimateMotion([first, latest]); close(motion.turn, .2);
  const trajectory = buildTrajectory(latest, motion), start = trajectoryPosition(trajectory, 1010), end = trajectoryPosition(trajectory, 1130);
  assert(start.bankDeg > 0); assert(end.bankDeg < start.bankDeg / 100);
  assert(end.trueTrackDeg > 4 && end.trueTrackDeg < 5.1); assert(end.velocityMps > 105 && end.velocityMps < 113);
  assert(trajectory.knots.every(p => Math.abs(p.bankDeg) <= 25));
  for (const latitudeDeg of [0, 89.9, -89.9]) {
    const path = buildTrajectory(sample({ latitudeDeg, longitudeDeg: 179.99 }), estimateMotion([sample()]));
    let previous = trajectoryPosition(path, 1000);
    for (let t = 1000.5; t < 1180; t += .5) {
      const p = trajectoryPosition(path, t);
      assert(Number.isFinite(p.latitudeDeg) && Math.abs(p.latitudeDeg) <= 90 && Math.abs(p.longitudeDeg) <= 180);
      assert(separation(previous, p) < 110); previous = p;
    }
  }
});

test("aligned descent is a likely approach; flyovers, cross tracks and impossible heights are not", () => {
  const runways = new TrafficRunways(); runways.load(catalogue(runway));
  const first = inbound(-7000), initial = classifyApproach(first, estimateMotion([first]), runways);
  assert.equal(initial.phase, "approach"); assert.equal(initial.confidence, .65);
  const final = inbound(-4900, 1030), confirmed = classifyApproach(final, estimateMotion([first, final]), runways, initial);
  assert.equal(confirmed.phase, "final"); assert.equal(confirmed.confidence, .9);
  const repeated = classifyApproach(first, estimateMotion([first]), runways, initial); assert.equal(repeated.confidence, .65);
  for (const change of [{ altitudeM: 5000 }, { trueTrackDeg: 80 }, { cross: 1000 }, { verticalRateMps: 0 }, { altitudeM: 50 }, { velocityMps: 200 }]) {
    const report = inbound(-4900, 1030, change);
    assert(!["approach", "final"].includes(classifyApproach(report, estimateMotion([report]), runways).phase), JSON.stringify(change));
  }
  const parallel = { ...runway, ...runwayPoint(runway, 0, 600), id: "parallel" };
  runways.load(catalogue(parallel, runway));
  assert.equal(classifyApproach(final, estimateMotion([final]), runways).runway.id, runway.id);
});

test("repeated final descent predicts a flare and bounded rollout, never a confirmed landing", () => {
  const tracks = new TrafficTracks(); tracks.loadRunways(catalogue(runway));
  tracks.ingest({ aircraft: [inbound(-4900)] }, 1000);
  assert.equal(tracks.tracks.get("abc123").approach.confidence, .65);
  tracks.ingest({ aircraft: [inbound(-2800, 1030)] }, 1030);
  const track = tracks.tracks.get("abc123"); assert.equal(track.approach.confidence, .9);
  tracks.loadRunways(catalogue(runway), 1030); assert.equal(track.approach.confidence, .9);
  let lastAltitude = Infinity;
  for (let t = 1030; t < 1210; t += .5) {
    const p = trajectoryPosition(track.trajectory, t), geometry = runwayCoordinates(p, runway);
    assert(p.altitudeM <= lastAltitude + 1e-7); assert(geometry.height >= 6 - 1e-7);
    assert(geometry.along < runway.length); lastAltitude = p.altitudeM;
  }
  const rollout = tracks.positions(1140)[0]; assert.equal(rollout.phase, "landing-estimate"); assert(rollout.estimated); close(rollout.velocityMps, 0);
  tracks.ingest({ aircraft: [], removedIds: ["abc123"] }, 1141); assert.equal(tracks.positions(1141).length, 0);
});

test("go-arounds cancel touchdown prediction and pressure altitude alone never predicts rollout", () => {
  const tracks = new TrafficTracks(); tracks.loadRunways(catalogue(runway));
  tracks.ingest({ aircraft: [inbound(-4900)] }, 1000);
  tracks.ingest({ aircraft: [inbound(-2800, 1030)] }, 1030);
  tracks.ingest({ aircraft: [inbound(-2100, 1040, { verticalRateMps: 5 })] }, 1040);
  const path = tracks.tracks.get("abc123").trajectory;
  assert.equal(path.approach.phase, "go-around"); assert(path.knots.at(-1).altitudeM > path.knots[0].altitudeM);
  assert(path.knots.every(p => p.phase !== "landing-estimate"));
  const report = inbound(-1000, 1000, { altitudeSource: "baro" });
  const baro = buildTrajectory(report, estimateMotion([report]), { phase: "final", runway, confidence: .9 });
  assert(baro.knots.every(p => p.phase !== "landing-estimate")); close(baro.knots[0].altitudeM, report.altitudeM);
});

test("catalogue arriving during a gap does not move the displayed aircraft or double-confirm a report", () => {
  const tracks = new TrafficTracks(); tracks.ingest({ aircraft: [inbound(-4900)] }, 1000);
  const before = tracks.positions(1030)[0]; tracks.loadRunways(catalogue(runway));
  const after = tracks.positions(1030)[0]; close(separation(before, after), 0, 1e-4); close(before.altitudeM, after.altitudeM);
  tracks.loadRunways(catalogue(runway)); assert.equal(tracks.tracks.get("abc123").approach.confidence, .65);
});

test("runway index covers six continents and searches across the date line and polar cells", () => {
  const data = JSON.parse(readFileSync(new URL("../public/data/traffic-runways.json", import.meta.url))), index = new TrafficRunways();
  assert(index.load(data)); assert(index.count > 23000); assert.equal(data.license, "Public domain");
  for (const airport of ["EPWA", "KJFK", "YSSY", "FAOR", "RJTT", "SCEL"]) {
    const row = data.runways.find(r => r[1] === airport); assert(row, airport);
    assert(index.nearby(row[3], row[4]).some(r => r.airport === airport));
  }
  const polar = { ...runway, lat: 89.9, lon: 75, id: "polar" }, dateLine = { ...runway, lat: 0, lon: -179.99, id: "date" };
  index.load(catalogue(polar, dateLine));
  assert(index.nearby(89.9, 0).some(r => r.id === "polar")); assert(index.nearby(0, 179.99).some(r => r.id === "date"));
  assert.equal(index.load({ version: 4, runways: [] }), false); assert.equal(index.count, 2);
});

test("feed clock slews through server corrections while preserving motion and poll cadence", async () => {
  let now = 0, server = 1000; const waits = [];
  const feed = new TrafficFeed({ now: () => now, wallNow: () => 0, setTimer: (_fn, ms) => { waits.push(ms); return 1; }, clearTimer: () => {},
    fetchImpl: async () => new Response(JSON.stringify({ schemaVersion: 1, serverTime: server, aircraft: [], status: "live", nextPollAfterMs: 90000 })) });
  feed.setView({ lat: 0, lon: 0, radiusKm: 35 }); feed.setActive(true); await feed.poll(); close(feed.serverTime(), 1000);
  for (const drift of [-4, 3, -2]) {
    now += 90000; const before = feed.serverTime(); server = before + drift;
    await feed.poll(); close(feed.serverTime(), before);
    now += 1000; const step = feed.serverTime() - before; assert(step >= .9 - 1e-8 && step <= 1.1 + 1e-8);
    assert.equal(waits.at(-1), 90000);
  }
  feed.dispose();
});
