#!/usr/bin/env node
// Read-only, bounded OpenSky probe. Credentials and bearer tokens never enter the report.
import { loadEnvFile } from "node:process";
import { writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const STATES_URL = "https://opensky-network.org/api/states/all";
const args = new Map(process.argv.slice(2).map(arg => {
  const [key, ...value] = arg.split("=");
  return [key, value.join("=") || true];
}));
const allowed = new Set(["--anonymous", "--bbox", "--samples", "--interval", "--output"]);
if ([...args.keys()].some(key => !allowed.has(key))) throw new Error("Unknown argument");
const bbox = String(args.get("--bbox") || "51.8,20.4,52.7,21.8").split(",").map(Number);
const [lamin, lomin, lamax, lomax] = bbox;
const area = (lamax - lamin) * (lomax - lomin);
if (bbox.length !== 4 || !bbox.every(Number.isFinite)
  || lamin < -90 || lamax > 90 || lomin < -180 || lomax > 180
  || lamin >= lamax || lomin >= lomax || area > 25) {
  throw new Error("Use --bbox=lamin,lomin,lamax,lomax with a valid area <= 25 square degrees");
}
const samples = Number(args.get("--samples") || 2);
const interval = Number(args.get("--interval") || 15);
if (![1, 2].includes(samples) || !Number.isFinite(interval) || interval < 10 || interval > 45) {
  throw new Error("Use --samples=1 or 2, and --interval=10..45 seconds");
}

const finite = value => typeof value === "number" && Number.isFinite(value);
function headerNumber(headers, name) {
  const value = headers.get(name);
  return value !== null && value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
}
function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}
function normalize(row) {
  if (!Array.isArray(row) || row.length < 17) return null;
  const altitude = finite(row[13]) ? row[13] : finite(row[7]) ? row[7] : null;
  return {
    icao24: typeof row[0] === "string" ? row[0].trim().toLowerCase() : null,
    callsign: typeof row[1] === "string" ? row[1].trim() : null,
    timePosition: row[3] ?? null, lastContact: row[4] ?? null,
    longitude: row[5] ?? null, latitude: row[6] ?? null,
    altitudeMeters: altitude, altitudeSource: finite(row[13]) ? "geo" : finite(row[7]) ? "baro" : null,
    onGround: row[8] ?? null, velocityMps: row[9] ?? null,
    trueTrackDeg: row[10] ?? null, verticalRateMps: row[11] ?? null,
    positionSource: row[16] ?? null, category: row[17] ?? null,
  };
}
function renderable(state) {
  return state && /^[0-9a-f]{6}$/.test(state.icao24 || "") && state.onGround === false
    && finite(state.longitude) && Math.abs(state.longitude) <= 180
    && finite(state.latitude) && Math.abs(state.latitude) <= 90
    && finite(state.altitudeMeters) && finite(state.timePosition);
}
function distanceMeters(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

const report = {
  startedAt: new Date().toISOString(),
  mode: args.has("--anonymous") ? "anonymous" : "oauth-client-credentials",
  bbox: { lamin, lomin, lamax, lomax, areaSquareDegrees: Number(area.toFixed(6)) },
  plannedStateRequests: samples,
  expectedStateCreditCost: samples,
  dailyAllowance: args.has("--anonymous") ? 400 : 4000,
  auth: null, snapshots: [], motion: null, error: null,
};
const statesBySnapshot = [];
try {
  let token = null;
  if (!args.has("--anonymous")) {
    try { loadEnvFile(new URL("../.env", import.meta.url)); }
    catch (error) { if (error.code !== "ENOENT") throw new Error("Cannot read .env"); }
    const clientId = process.env.OPEN_SKY_CLIENT_ID;
    const clientSecret = process.env.OPEN_SKY_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("Missing OPEN_SKY_CLIENT_ID or OPEN_SKY_CLIENT_SECRET");
    const started = performance.now();
    const response = await fetch(TOKEN_URL, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
    });
    report.auth = { httpStatus: response.status, durationMs: Math.round(performance.now() - started) };
    if (!response.ok) throw new Error(`OAuth HTTP ${response.status}; no state requests made`);
    const data = await response.json();
    if (typeof data.access_token !== "string" || !data.access_token
      || String(data.token_type).toLowerCase() !== "bearer" || !finite(data.expires_in) || data.expires_in <= 0) {
      throw new Error("Unexpected OAuth response shape");
    }
    token = data.access_token;
    report.auth.tokenType = "Bearer";
    report.auth.expiresInSeconds = data.expires_in;
    if (data.expires_in < samples * (interval + 15) + 30) throw new Error("Token lifetime too short for this probe");
    console.log(JSON.stringify({ stage: "authentication", ...report.auth }));
  }

  const url = new URL(STATES_URL);
  for (const [name, value] of Object.entries({ lamin, lomin, lamax, lomax, extended: 1 })) url.searchParams.set(name, value);
  for (let index = 0; index < samples; index++) {
    if (index) await delay(interval * 1000);
    const started = performance.now();
    const response = await fetch(url, {
      redirect: "error", signal: AbortSignal.timeout(15000),
      headers: token ? { Authorization: `Bearer ${token}`, Accept: "application/json" } : { Accept: "application/json" },
    });
    const snapshot = {
      receivedAt: new Date().toISOString(), httpStatus: response.status,
      durationMs: Math.round(performance.now() - started), serverDate: response.headers.get("date"),
      remainingCredits: headerNumber(response.headers, "x-rate-limit-remaining"),
      retryAfterSeconds: headerNumber(response.headers, "x-rate-limit-retry-after-seconds"),
      retryAfter: response.headers.get("retry-after"),
    };
    report.snapshots.push(snapshot);
    if (!response.ok) {
      console.log(JSON.stringify({ stage: "states", ...snapshot }));
      throw new Error(`States HTTP ${response.status}; probe stops without retry or anonymous fallback`);
    }
    const body = await response.text();
    snapshot.payloadBytes = Buffer.byteLength(body);
    const data = JSON.parse(body);
    if (!finite(data.time) || !(data.states === null || Array.isArray(data.states))) throw new Error("Unexpected state response shape");
    const rows = data.states || [];
    const normalized = rows.map(normalize).filter(Boolean);
    const eligible = normalized.filter(renderable);
    const ages = eligible.map(state => data.time - state.timePosition);
    Object.assign(snapshot, {
      apiTime: data.time, apiTimeIso: new Date(data.time * 1000).toISOString(),
      localClockMinusApiSeconds: Number((Date.now() / 1000 - data.time).toFixed(1)),
      totalStates: rows.length, malformedRows: rows.length - normalized.length,
      airborneStates: normalized.filter(state => state.onGround === false).length,
      onGroundStates: normalized.filter(state => state.onGround === true).length,
      renderableAirborneStates: eligible.length,
      freshAirborneStatesWithin30s: eligible.filter(state => data.time - state.timePosition >= -5 && data.time - state.timePosition <= 30).length,
      missingPositionOrAltitudeAirborne: normalized.filter(state => state.onGround === false && !renderable(state)).length,
      usingGeoAltitude: eligible.filter(state => state.altitudeSource === "geo").length,
      usingBaroFallback: eligible.filter(state => state.altitudeSource === "baro").length,
      positionAgeSeconds: { median: percentile(ages, .5), p95: percentile(ages, .95), max: ages.length ? Math.max(...ages) : null },
      categoryCounts: Object.fromEntries([...new Set(eligible.map(state => state.category))].map(category => [String(category), eligible.filter(state => state.category === category).length])),
      examples: eligible.slice(0, 5),
    });
    statesBySnapshot.push(eligible);
    console.log(JSON.stringify({ stage: "states", ...snapshot }));
    if (snapshot.remainingCredits !== null && snapshot.remainingCredits <= 0) break;
  }
  if (statesBySnapshot.length === 2) {
    const previous = new Map(statesBySnapshot[0].map(state => [state.icao24, state]));
    const matched = statesBySnapshot[1].filter(state => previous.has(state.icao24));
    const movements = matched.map(state => ({
      icao24: state.icao24, callsign: state.callsign,
      positionTimeDeltaSeconds: state.timePosition - previous.get(state.icao24).timePosition,
      horizontalDisplacementMeters: Math.round(distanceMeters(previous.get(state.icao24), state)),
    }));
    const a = report.snapshots[0].remainingCredits, b = report.snapshots[1].remainingCredits;
    report.motion = {
      matchedAircraft: matched.length,
      aircraftWithNewPositionTime: movements.filter(item => item.positionTimeDeltaSeconds > 0).length,
      aircraftMovedOver10m: movements.filter(item => item.horizontalDisplacementMeters > 10).length,
      observedRemainingCreditDelta: a !== null && b !== null ? a - b : null,
      examples: movements.slice(0, 5),
    };
  }
} catch (error) {
  // Never dump response bodies, request headers, the environment or fetch options.
  report.error = error instanceof SyntaxError ? "Response was not valid JSON" : String(error.message).slice(0, 250);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  if (args.has("--output")) await writeFile(String(args.get("--output")), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ stage: "summary", ...report, snapshots: report.snapshots.map(({ examples, ...rest }) => rest) }, null, 2));
}
