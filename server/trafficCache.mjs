import { TRAFFIC, coverageFor, coverageContains, creditCost, normalizeStates } from "../shared/trafficState.js";
import { TrafficError } from "./trafficBudget.mjs";

export class TrafficService {
  constructor({ client, budget, now = Date.now, maxRegions = 32, maxActiveRegions = 8 } = {}) {
    Object.assign(this, { client, budget, now, maxRegions, maxActiveRegions });
    this.regions = new Map();
    this.metrics = { upstreamRequests: 0, cacheHits: 0, joinedRequests: 0 };
  }
  response(entry, { status, nextPollAfterMs } = {}) {
    const now = this.now(), data = entry?.data;
    const isStale = !data || now - data.fetchedAt > TRAFFIC.pollMs;
    const fresh = data?.aircraft.some(a => now / 1000 - a.timePosition <= TRAFFIC.freshSeconds);
    return {
      schemaVersion: 1, serverTime: now / 1000, snapshotTime: data?.snapshotTime ?? null,
      fetchedAt: data?.fetchedAt ?? null, isStale,
      status: status || (isStale || (!fresh && (data?.stats.stale > 0 || data?.aircraft.length > 0)) ? "delayed" : fresh ? "live" : "empty"),
      nextPollAfterMs: Math.max(1000, nextPollAfterMs ?? TRAFFIC.pollMs),
      coverageBboxes: entry?.coverage.boxes ?? [],
      coverage: entry ? { lat: entry.coverage.lat, lon: entry.coverage.lon, radiusM: entry.coverage.radiusM } : null,
      aircraft: data?.aircraft ?? [], removedIds: data?.removedIds ?? [], stats: data?.stats ?? { total: 0, ground: 0, stale: 0, invalid: 0 },
    };
  }
  async get(view) {
    if (!this.client.configured) return this.response(null, { status: "disabled", nextPollAfterMs: 300_000 });
    const now = this.now();
    for (const [key, entry] of this.regions) if (!entry.pending && now - entry.lastSeen > 300_000) this.regions.delete(key);
    let entry = [...this.regions.values()].find(item => coverageContains(item.coverage, view));
    if (!entry) {
      const coverage = coverageFor(view);
      entry = this.regions.get(coverage.key);
      if (!entry) {
        const active = [...this.regions.values()].filter(item => now - item.lastSeen < 60_000);
        if (active.length >= this.maxActiveRegions) return this.response(null, { status: "rate-limited", nextPollAfterMs: 60_000 });
        if (this.regions.size >= this.maxRegions) {
          const oldest = [...this.regions.values()].filter(item => !item.pending).sort((a, b) => a.lastSeen - b.lastSeen)[0];
          if (oldest) this.regions.delete(oldest.coverage.key);
        }
        entry = { coverage, lastSeen: now, data: null, pending: null, retryAt: 0 };
        this.regions.set(coverage.key, entry);
      }
    }
    entry.lastSeen = now;
    if (entry.pending) { this.metrics.joinedRequests++; return entry.pending; }
    const activeCost = [...this.regions.values()].filter(item => now - item.lastSeen < 60_000)
      .reduce((sum, item) => sum + item.coverage.boxes.reduce((total, box) => total + creditCost(box), 0), 0);
    const interval = Math.max(TRAFFIC.pollMs, activeCost * this.budget.spacingMs);
    const dueIn = Math.max(entry.retryAt - now, entry.data ? entry.data.fetchedAt + interval - now : 0);
    if (dueIn > 0) { this.metrics.cacheHits++; return this.response(entry, { status: entry.retryAt > now ? entry.retryStatus : undefined, nextPollAfterMs: dueIn }); }
    entry.pending = this.refresh(entry, interval);
    try { return await entry.pending; }
    finally { entry.pending = null; }
  }
  async refresh(entry, interval) {
    try {
      const chunks = [];
      for (const [index, box] of entry.coverage.boxes.entries()) {
        const payload = await this.client.states(box, {
          beforeRequest: async retry => {
            await this.budget.reserveCredit(creditCost(box), { retry: retry || index > 0 });
            this.metrics.upstreamRequests++;
          },
          onResponse: response => this.budget.observe(response),
        });
        chunks.push(normalizeStates(payload, this.now() / 1000));
      }
      const aircraft = new Map(), removed = new Set();
      const stats = { total: 0, ground: 0, stale: 0, invalid: 0 };
      for (const chunk of chunks) {
        for (const item of chunk.aircraft) if (!aircraft.has(item.icao24) || aircraft.get(item.icao24).timePosition < item.timePosition) aircraft.set(item.icao24, item);
        for (const id of chunk.removedIds) removed.add(id);
        for (const key of Object.keys(stats)) stats[key] += chunk.stats[key];
      }
      for (const id of removed) aircraft.delete(id);
      entry.data = { aircraft: [...aircraft.values()], removedIds: [...removed], stats, snapshotTime: Math.min(...chunks.map(x => x.snapshotTime)), fetchedAt: this.now() };
      entry.retryAt = 0;
      entry.retryStatus = null;
      return this.response(entry, { nextPollAfterMs: interval });
    } catch (error) {
      const failure = error instanceof TrafficError ? error : new TrafficError(503, "Traffic unavailable");
      const wait = failure.status === 429 ? Math.max(failure.retryMs, this.budget.waitMs()) : await this.budget.fail(failure.status);
      entry.retryAt = this.now() + wait;
      entry.retryStatus = failure.status === 429 ? "rate-limited" : "unavailable";
      return this.response(entry, { status: entry.retryStatus, nextPollAfterMs: wait });
    }
  }
}
