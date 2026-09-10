export const TRAFFIC = Object.freeze({ pollMs: 30_000, freshSeconds: 30, hideSeconds: 60, removeSeconds: 90, radiusKm: 35, maxRadiusKm: 75 });
export const finite = value => typeof value === "number" && Number.isFinite(value);
const DEG = Math.PI / 180;
const EARTH_M = 6_371_008.8;
export const wrapLongitude = lon => ((lon + 180) % 360 + 360) % 360 - 180;

export function distanceM(a, b) {
  const dlat = (b.lat - a.lat) * DEG, dlon = (b.lon - a.lon) * DEG;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dlon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

export function destination(lat, lon, bearingDeg, meters) {
  const p = lat * DEG, l = lon * DEG, b = bearingDeg * DEG, d = meters / EARTH_M;
  const p2 = Math.asin(Math.max(-1, Math.min(1, Math.sin(p) * Math.cos(d) + Math.cos(p) * Math.sin(d) * Math.cos(b))));
  const l2 = l + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p), Math.cos(d) - Math.sin(p) * Math.sin(p2));
  return { lat: p2 / DEG, lon: wrapLongitude(l2 / DEG) };
}

export function validView({ lat, lon, radiusKm }) {
  return finite(lat) && Math.abs(lat) <= 90 && finite(lon) && Math.abs(lon) <= 180
    && finite(radiusKm) && radiusKm >= 1 && radiusKm <= TRAFFIC.maxRadiusKm;
}

export function coverageFor(view) {
  if (!validView(view)) throw new Error("Invalid traffic area");
  // Stable cells share cache across nearby clients. Extra radius covers the rounding offset.
  const lat = Math.round(view.lat * 10) / 10, lon = wrapLongitude(Math.round(view.lon * 10) / 10);
  const radiusM = Math.ceil((view.radiusKm * 1000 + 8000) / 5000) * 5000;
  const angular = radiusM / EARTH_M, latitude = lat * DEG;
  const south = Math.max(-90, lat - angular / DEG), north = Math.min(90, lat + angular / DEG);
  let boxes;
  if (south <= -90 || north >= 90) boxes = [{ lamin: south, lamax: north, lomin: -180, lomax: 180 }];
  else {
    const width = Math.asin(Math.min(1, Math.sin(angular) / Math.cos(latitude))) / DEG;
    const west = lon - width, east = lon + width;
    boxes = west < -180
      ? [{ lamin: south, lamax: north, lomin: west + 360, lomax: 180 }, { lamin: south, lamax: north, lomin: -180, lomax: east }]
      : east > 180
        ? [{ lamin: south, lamax: north, lomin: west, lomax: 180 }, { lamin: south, lamax: north, lomin: -180, lomax: east - 360 }]
        : [{ lamin: south, lamax: north, lomin: west, lomax: east }];
  }
  return { key: `${lat}:${lon}:${radiusM}`, lat, lon, radiusM, boxes };
}
export function coverageContains(coverage, view) {
  return distanceM(coverage, view) + view.radiusKm * 1000 <= coverage.radiusM;
}
export function creditCost(box) {
  const area = (box.lamax - box.lamin) * (box.lomax - box.lomin);
  return area <= 25 ? 1 : area <= 100 ? 2 : area <= 400 ? 3 : 4;
}

export function normalizeStates(payload, nowSeconds) {
  if (!payload || !finite(payload.time) || payload.time > nowSeconds + 10
    || !(payload.states === null || Array.isArray(payload.states))) throw new Error("Invalid OpenSky response");
  const aircraft = new Map(), removedIds = new Set();
  const stats = { total: 0, ground: 0, stale: 0, invalid: 0 };
  for (const row of payload.states || []) {
    stats.total++;
    if (!Array.isArray(row) || row.length < 17 || !/^[0-9a-f]{6}$/i.test(row[0] || "")) { stats.invalid++; continue; }
    const id = row[0].toLowerCase();
    if (row[8] === true || (Number.isInteger(row[17]) && row[17] >= 16 && row[17] <= 20)) {
      removedIds.add(id); stats.ground++; continue;
    }
    const altitudeM = finite(row[13]) ? row[13] : finite(row[7]) ? row[7] : null;
    if (row[8] !== false || !finite(row[5]) || Math.abs(row[5]) > 180 || !finite(row[6]) || Math.abs(row[6]) > 90
      || !finite(row[3]) || !finite(altitudeM) || altitudeM < -1000 || altitudeM > 100_000) { stats.invalid++; continue; }
    const age = nowSeconds - row[3];
    if (age < -5 || age > TRAFFIC.freshSeconds) { stats.stale++; continue; }
    const item = {
      icao24: id, callsign: typeof row[1] === "string" ? row[1].trim().slice(0, 16) : null,
      latitudeDeg: row[6], longitudeDeg: row[5], altitudeM,
      geoAltitudeM: finite(row[13]) ? row[13] : null, baroAltitudeM: finite(row[7]) ? row[7] : null,
      altitudeSource: finite(row[13]) ? "geo" : "baro", timePosition: row[3],
      lastContact: finite(row[4]) ? row[4] : null, onGround: false,
      velocityMps: finite(row[9]) && row[9] >= 0 && row[9] <= 1500 ? row[9] : null,
      trueTrackDeg: finite(row[10]) && row[10] >= 0 && row[10] <= 360 ? row[10] % 360 : null,
      verticalRateMps: finite(row[11]) && Math.abs(row[11]) <= 200 ? row[11] : null,
      positionSource: Number.isInteger(row[16]) ? row[16] : null,
      category: Number.isInteger(row[17]) ? row[17] : null,
    };
    if (!aircraft.has(id) || aircraft.get(id).timePosition < item.timePosition) aircraft.set(id, item);
  }
  for (const id of removedIds) aircraft.delete(id);
  return { snapshotTime: payload.time, aircraft: [...aircraft.values()], removedIds: [...removedIds], stats };
}
