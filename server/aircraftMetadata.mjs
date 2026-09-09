import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const DAY = 86_400_000;
const clean = (value, max = 100) => typeof value === "string" ? value.trim().slice(0, max) : null;
export function parseAircraftMetadata(payload, icao24) {
  const data = payload?.response?.aircraft;
  if (!data || typeof data.mode_s !== "string" || data.mode_s.toLowerCase() !== icao24) return null;
  const typeCode = clean(data.icao_type, 8)?.toUpperCase();
  if (!/^[A-Z0-9]{2,4}$/.test(typeCode || "")) return null;
  return { typeCode, manufacturer: clean(data.manufacturer), modelName: clean(data.type), registration: clean(data.registration, 16), source: "adsbdb" };
}

// OpenSky /states/all has no aircraft model. Enrich its ICAO24 via adsbdb, never via callsign.
export class AircraftMetadata {
  constructor({ file = null, fetchImpl = fetch, now = Date.now, maxEntries = 20_000, maxPerMinute = 30 } = {}) {
    Object.assign(this, { file, fetchImpl, now, maxEntries, maxPerMinute });
    this.cache = new Map(); this.pending = new Map(); this.requests = []; this.blockedUntil = 0; this.writes = Promise.resolve();
  }
  async load() {
    if (!this.file) return;
    try {
      const data = JSON.parse(await readFile(this.file, "utf8"));
      if (data.version !== 1 || !Array.isArray(data.entries)) return;
      for (const [id, value] of data.entries.slice(-this.maxEntries)) {
        if (/^[a-f0-9]{6}$/.test(id) && value && Number.isFinite(value.expiresAt) && value.expiresAt > this.now()
          && (value.aircraft === null || (value.aircraft.source === "adsbdb" && /^[A-Z0-9]{2,4}$/.test(value.aircraft.typeCode)))) this.cache.set(id, value);
      }
    } catch { /* An unavailable metadata cache must not stop live positions. */ }
  }
  async save() {
    if (!this.file) return;
    const body = JSON.stringify({ version: 1, entries: [...this.cache] });
    this.writes = this.writes.catch(() => {}).then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(`${this.file}.tmp`, body, { mode: 0o600 }); await rename(`${this.file}.tmp`, this.file);
    });
    await this.writes.catch(() => {});
  }
  async get(id) {
    if (!/^[a-f0-9]{6}$/.test(id || "")) return null;
    const cached = this.cache.get(id);
    if (cached?.expiresAt > this.now()) return cached.aircraft;
    if (this.pending.has(id)) return this.pending.get(id);
    this.requests = this.requests.filter(at => at > this.now() - 60_000);
    if (this.blockedUntil > this.now() || this.requests.length >= this.maxPerMinute) return null;
    this.requests.push(this.now());
    const pending = this.fetch(id);
    this.pending.set(id, pending);
    try { return await pending; } finally { this.pending.delete(id); }
  }
  async fetch(id) {
    let aircraft = null, ttl = 60_000;
    try {
      const response = await this.fetchImpl(`https://api.adsbdb.com/v0/aircraft/${id}`, { redirect: "error", signal: AbortSignal.timeout(3500), headers: { Accept: "application/json" } });
      if (response.status === 429) {
        const raw = response.headers.get("retry-after");
        const wait = raw && Number.isFinite(Number(raw)) ? Number(raw) * 1000 : raw ? Date.parse(raw) - this.now() : 60_000;
        this.blockedUntil = this.now() + Math.max(60_000, Number.isFinite(wait) ? wait : 60_000);
      } else if (response.ok) {
        aircraft = parseAircraftMetadata(await response.json(), id); ttl = aircraft ? 7 * DAY : DAY;
      } else if (response.status === 404) ttl = DAY;
    } catch { /* Positions remain usable during metadata outages. */ }
    this.cache.delete(id);
    this.cache.set(id, { aircraft, expiresAt: this.now() + ttl });
    while (this.cache.size > this.maxEntries) this.cache.delete(this.cache.keys().next().value);
    await this.save(); return aircraft;
  }
  async enrich(aircraft) {
    // At most six cold lookups per snapshot: metadata never adds a chain of network waits.
    const output = aircraft.map(item => ({ ...item, aircraft: this.cache.get(item.icao24)?.expiresAt > this.now() ? this.cache.get(item.icao24).aircraft : null }));
    const missing = output.filter(item => !(this.cache.get(item.icao24)?.expiresAt > this.now())).slice(0, 6);
    await Promise.all(missing.map(async item => { item.aircraft = await this.get(item.icao24); }));
    return output;
  }
}
