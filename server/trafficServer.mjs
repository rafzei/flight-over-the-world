import { createServer } from "node:http";
import { loadEnvFile } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { TRAFFIC, validView } from "../shared/trafficState.js";
import { OpenSkyClient } from "./openskyClient.mjs";
import { TrafficBudget } from "./trafficBudget.mjs";
import { TrafficService } from "./trafficCache.mjs";

export function createTrafficServer({ service, allowedOrigins = [], now = Date.now } = {}) {
  const clients = new Map();
  return createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    const send = (status, data) => {
      response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(data));
    };
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) return send(403, { error: "Origin not allowed" });
    if (origin) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
      response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    }
    if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
    if (request.method !== "GET") return send(405, { error: "GET required" });
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/api/traffic/health") return send(200, { ok: true, configured: service.client.configured });
    if (url.pathname !== "/api/traffic") return send(404, { error: "Not found" });
    // Remote address is deliberately not taken from untrusted forwarding headers.
    const ip = request.socket.remoteAddress || "unknown", time = now();
    if (clients.size > 2048) for (const [key, value] of clients) if (time - value.since > 60_000) clients.delete(key);
    let bucket = clients.get(ip);
    if (!bucket || time - bucket.since >= 60_000) {
      if (!bucket && clients.size >= 4096) return send(429, { error: "Traffic server busy" });
      bucket = { since: time, count: 0 }; clients.set(ip, bucket);
    }
    if (++bucket.count > 120) {
      response.setHeader("Retry-After", "60");
      return send(429, { error: "Too many traffic requests", nextPollAfterMs: 60_000 });
    }
    const keys = [...url.searchParams.keys()];
    if (keys.some(key => !["lat", "lon", "radiusKm"].includes(key)) || new Set(keys).size !== keys.length
      || !url.searchParams.has("lat") || !url.searchParams.has("lon")
      || keys.some(key => !url.searchParams.get(key).trim())) return send(400, { error: "Expected lat, lon and optional radiusKm" });
    const view = { lat: Number(url.searchParams.get("lat")), lon: Number(url.searchParams.get("lon")), radiusKm: Number(url.searchParams.get("radiusKm") ?? TRAFFIC.radiusKm) };
    if (!validView(view)) return send(400, { error: "Invalid traffic coordinates or radius (1–75 km)" });
    try { send(200, await service.get(view)); }
    catch { send(503, { status: "unavailable", error: "Traffic unavailable", nextPollAfterMs: 60_000 }); }
  });
}

export async function startTrafficServer(options = {}) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  try { loadEnvFile(resolve(root, ".env")); } catch (error) { if (error.code !== "ENOENT") throw new Error("Cannot load traffic configuration"); }
  const port = options.port ?? Number(process.env.TRAFFIC_PORT || 3001);
  const host = options.host ?? process.env.TRAFFIC_HOST ?? "127.0.0.1";
  const budget = new TrafficBudget({ file: process.env.TRAFFIC_BUDGET_FILE || resolve(root, ".data/opensky-budget.json") });
  await budget.load();
  const client = new OpenSkyClient({ clientId: process.env.OPEN_SKY_CLIENT_ID, clientSecret: process.env.OPEN_SKY_CLIENT_SECRET });
  const service = new TrafficService({ client, budget });
  const allowedOrigins = options.allowedOrigins ?? (process.env.TRAFFIC_ALLOWED_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173").split(",").map(x => x.trim()).filter(Boolean);
  const server = createTrafficServer({ service, allowedOrigins });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5000;
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, resolve); });
  console.log(`Traffic API: http://${host}:${server.address().port} (${client.configured ? "OpenSky configured" : "credentials missing; live traffic disabled"})`);
  return { server, service, budget };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  startTrafficServer().then(({ server }) => {
    const stop = () => { server.close(); server.closeIdleConnections(); };
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
  }).catch(() => { console.error("Traffic API could not start; check configuration, port and budget storage."); process.exitCode = 1; });
}
