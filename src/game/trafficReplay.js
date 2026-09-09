import { destination } from "../../shared/trafficState.js";

// Explicit, synthetic replay. Never used as a fallback for unavailable live data.
export function replaySnapshot(center, now, elapsed) {
  const definitions = [
    ["f00001", "REPLAY INBOUND", 35_000 - (elapsed * 400 % 30_000), 0, 180, 1200, 400],
    ["f00002", "REPLAY CROSS", 5000, 45 + elapsed * .3, 135, 1500, 150],
    ["f00003", "REPLAY CROSS", 7500, -30 - elapsed * .3, 240, 2200, 150],
    ["f00004", "REPLAY STALE", 3500, 80, 0, 800, 0],
  ];
  const aircraft = definitions.map(([icao24, callsign, distance, bearing, track, height, speed]) => {
    const position = destination(center.lat, center.lon, bearing, distance);
    return { icao24, callsign, latitudeDeg: position.lat, longitudeDeg: position.lon, altitudeM: height, altitudeSource: "geo", onGround: false,
      timePosition: icao24 === "f00004" ? now - 240 : now, lastContact: now, velocityMps: speed, trueTrackDeg: track, verticalRateMps: 0, category: 0 };
  });
  return { schemaVersion: 1, status: "replay", serverTime: now, snapshotTime: now, aircraft, removedIds: [], stats: { total: 4, stale: 1 } };
}
