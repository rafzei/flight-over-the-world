import assert from "node:assert/strict";
import test from "node:test";
import { coverageFor, coverageContains, creditCost, destination, distanceM, normalizeStates } from "../shared/trafficState.js";
import { TrafficTracks, predictPosition } from "../src/game/trafficTracks.js";
import { TrafficFeed } from "../src/game/trafficFeed.js";

const row = overrides => Object.assign(["abc123", " SAME ", "", 1000, 1000, 0, 0, 0, false, 0, 0, 0, null, 0, null, false, 0, 0], overrides);
const sample = overrides => ({ icao24: "abc123", callsign: "SAME", latitudeDeg: 0, longitudeDeg: 0, altitudeM: 1000, timePosition: 1000, onGround: false, velocityMps: 200, trueTrackDeg: 90, verticalRateMps: 2, ...overrides });

test("default browser adapters preserve the global receiver for timers and fetch", async t => {
  let starts = 0, clears = 0, reads = 0;
  t.mock.method(globalThis, "setTimeout", function () { assert.equal(this, globalThis); starts++; return 1; });
  t.mock.method(globalThis, "clearTimeout", function () { assert.equal(this, globalThis); clears++; });
  t.mock.method(globalThis, "fetch", async function () {
    assert.equal(this, globalThis); reads++;
    return new Response(JSON.stringify({ schemaVersion: 1, serverTime: 1000, status: "empty", aircraft: [] }));
  });
  const feed = new TrafficFeed();
  feed.setView({ lat: 0, lon: 0, radiusKm: 35 }); feed.setActive(true);
  await feed.poll(); feed.dispose();
  assert(starts >= 2); assert(clears >= 2); assert.equal(reads, 1); assert.equal(feed.status, "disabled");
});

test("normalization preserves zeros, distinct ICAO identities and baro fallback; rejects stale/ground/null", () => {
  const result = normalizeStates({ time: 1000, states: [row(), row({ 0: "abc124", 13: null }), row({ 0: "abc125", 3: 750 }), row({ 0: "abc126", 8: true }), row({ 0: "abc127", 5: null }), row({ 0: "abc128", 17: 18 }), row({ 0: "abc129", 3: 1006 }), row({ 3: 999 })] }, 1000);
  assert.equal(result.aircraft.length, 2);
  assert.equal(result.aircraft[0].altitudeM, 0); assert.equal(result.aircraft[0].longitudeDeg, 0);
  assert.equal(result.aircraft[0].callsign, "SAME"); assert.equal(result.aircraft[1].altitudeSource, "baro");
  assert.equal(result.aircraft[0].timePosition, 1000);
  assert.deepEqual(result.removedIds, ["abc126", "abc128"]);
  assert.deepEqual(result.stats, { total: 8, ground: 2, stale: 2, invalid: 1 });
  assert.deepEqual(normalizeStates({ time: 1000, states: null }, 1000).aircraft, []);
  assert.throws(() => normalizeStates({ states: [] }, 1000));
});

test("coverage encloses requested circles at equator, poles and date line with correct costs", () => {
  for (const view of [{ lat: 52.23, lon: 21.01, radiusKm: 35 }, { lat: 0, lon: 0, radiusKm: 75 }, { lat: 89.99, lon: 25, radiusKm: 75 }, { lat: -89.99, lon: -50, radiusKm: 75 }, { lat: 2, lon: 179.99, radiusKm: 75 }]) {
    const c = coverageFor(view); assert(coverageContains(c, view));
    for (let bearing = 0; bearing < 360; bearing += 5) {
      const p = destination(view.lat, view.lon, bearing, view.radiusKm * 1000);
      assert(c.boxes.some(b => p.lat >= b.lamin && p.lat <= b.lamax && p.lon >= b.lomin && p.lon <= b.lomax));
    }
    assert(c.boxes.every(b => b.lamin >= -90 && b.lamax <= 90 && b.lomin >= -180 && b.lomax <= 180 && b.lomin < b.lomax));
  }
  assert.equal(coverageFor({ lat: 2, lon: 179.99, radiusKm: 35 }).boxes.length, 2);
  assert.deepEqual([25, 26, 100, 101, 400, 401].map(area => creditCost({ lamin: 0, lamax: 1, lomin: 0, lomax: area })), [1, 2, 2, 3, 3, 4]);
});

test("tracks cap prediction, handle missing motion, stale disappearance and out-of-order updates", () => {
  const tracks = new TrafficTracks();
  tracks.ingest({ aircraft: [sample(), sample({ icao24: "abc124", timePosition: 750 })] }, 1000);
  assert.equal(tracks.tracks.size, 1);
  tracks.ingest({ aircraft: [sample({ timePosition: 999, altitudeM: 50 })] }, 1001);
  assert.equal(tracks.positions(1010)[0].altitudeM, 1020);
  const capped = tracks.positions(1045)[0];
  assert.equal(capped.altitudeM, 1060); assert.equal(capped.freshness, .5);
  assert(Math.abs(distanceM({ lat: 0, lon: 0 }, { lat: capped.latitudeDeg, lon: capped.longitudeDeg }) - 6000) < .01);
  assert.equal(tracks.positions(1045, { prediction: false })[0].longitudeDeg, 0);
  assert.equal(tracks.positions(1060).length, 0);
  tracks.positions(1091); assert.equal(tracks.tracks.size, 0);
  const still = predictPosition(sample({ velocityMps: null, trueTrackDeg: null, verticalRateMps: null }), 1030);
  assert.equal(still.longitudeDeg, 0); assert.equal(still.altitudeM, 1000);
});

test("tracks cross the date line smoothly, remove grounded contacts and reset implausible jumps", () => {
  const tracks = new TrafficTracks();
  tracks.ingest({ aircraft: [sample({ longitudeDeg: 179.99 })] }, 1000);
  tracks.ingest({ aircraft: [sample({ longitudeDeg: -179.99, timePosition: 1010 })] }, 1010);
  assert(Math.abs(tracks.positions(1011)[0].longitudeDeg) > 179.9);
  tracks.ingest({ aircraft: [sample({ longitudeDeg: 50, timePosition: 1015 })] }, 1015);
  assert.equal(tracks.tracks.get("abc123").samples.length, 1);
  tracks.ingest({ removedIds: ["abc123"], aircraft: [] }, 1016);
  assert.equal(tracks.tracks.size, 0);
});

test("feed aborts pause/teleport races, uses server clock and honors server retry delay", async () => {
  let now = 0, resets = 0, requests = [], snapshots = [];
  const timers = new Map(); let timerId = 0;
  const feed = new TrafficFeed({ now: () => now, wallNow: () => 0, onReset: () => resets++, onSnapshot: data => snapshots.push(data),
    setTimer: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimer: id => timers.delete(id),
    fetchImpl: (_url, options) => new Promise(resolve => requests.push({ resolve, signal: options.signal })) });
  const data = { schemaVersion: 1, serverTime: 1000, status: "live", aircraft: [sample()], nextPollAfterMs: 90_000 };
  feed.setView({ lat: 0, lon: 0, radiusKm: 35 }); feed.setActive(true);
  const first = feed.poll(); feed.setActive(false);
  assert(requests[0].signal.aborted);
  requests[0].resolve(new Response(JSON.stringify(data))); await first;
  assert.equal(snapshots.length, 0); assert.equal(timers.size, 0);
  feed.setActive(true); const second = feed.poll(); now = 1000;
  requests[1].resolve(new Response(JSON.stringify(data))); await second;
  assert.equal(feed.serverTime(), 1000.5); assert.equal(snapshots.length, 1);
  assert([...timers.values()].some(t => t.ms === 90_000));
  feed.setView({ lat: 50, lon: 20, radiusKm: 35 });
  assert.equal(feed.status, "loading"); assert.equal(feed.snapshot, null);
  assert([...timers.values()].some(t => t.ms === 4000));
  assert(resets >= 4); feed.dispose(); assert.equal(timers.size, 0);
});
