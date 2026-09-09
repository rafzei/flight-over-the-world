import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class TrafficError extends Error {
  constructor(status, message, retryMs = 30_000) { super(message); this.status = status; this.retryMs = retryMs; }
}
export function numericHeader(headers, key) {
  const raw = headers.get(key);
  return raw !== null && raw.trim() !== "" && Number.isFinite(Number(raw)) ? Number(raw) : null;
}

// One process per account. A rolling local ledger survives restarts and never presumes a daily refill.
export class TrafficBudget {
  constructor({ file = null, now = Date.now, allowance = 4000, reserve = 250, spacingMs = 30_000 } = {}) {
    Object.assign(this, { file, now, allowance, reserve, spacingMs });
    this.state = { version: 1, remaining: null, observedAt: 0, blockedUntil: 0, nextRequestAt: 0, failures: 0, spending: [] };
    this.writes = Promise.resolve();
  }
  async load() {
    if (!this.file) return;
    try {
      const data = JSON.parse(await readFile(this.file, "utf8"));
      if (data.version !== 1 || !Array.isArray(data.spending)) throw new Error("Invalid budget state");
      for (const key of ["observedAt", "blockedUntil", "nextRequestAt", "failures"]) {
        if (!Number.isFinite(data[key]) || data[key] < 0) throw new Error("Invalid budget state");
      }
      if (data.remaining !== null && (!Number.isFinite(data.remaining) || data.remaining < 0)) throw new Error("Invalid budget state");
      if (!data.spending.every(x => Number.isFinite(x.at) && Number.isInteger(x.cost) && x.cost > 0 && x.cost <= 4)) throw new Error("Invalid budget state");
      this.state = data;
    } catch (error) {
      if (error.code !== "ENOENT") throw new Error("Cannot read traffic budget; refusing to reset quota protection");
    }
  }
  async save() {
    if (!this.file) return;
    const body = `${JSON.stringify(this.state)}\n`;
    this.writes = this.writes.catch(() => {}).then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(`${this.file}.tmp`, body, { mode: 0o600 });
      await rename(`${this.file}.tmp`, this.file);
    });
    try { await this.writes; }
    catch { throw new TrafficError(503, "Traffic quota storage unavailable", 60_000); }
  }
  waitMs() { return Math.max(0, this.state.blockedUntil - this.now(), this.state.nextRequestAt - this.now()); }
  async reserveCredit(cost, { retry = false } = {}) {
    const now = this.now(), state = this.state;
    if (state.blockedUntil > now) throw new TrafficError(429, "Traffic quota cooling down", state.blockedUntil - now);
    if (!retry && state.nextRequestAt > now) throw new TrafficError(429, "Traffic update scheduled", state.nextRequestAt - now);
    state.spending = state.spending.filter(x => x.at > now - 86_400_000);
    const used = state.spending.reduce((sum, x) => sum + x.cost, 0);
    if (used + cost > this.allowance - this.reserve) {
      throw new TrafficError(429, "Traffic daily safety budget reached", state.spending[0].at + 86_400_000 - now);
    }
    // Low balances get at most one refill probe per hour, unless OpenSky gave a longer cooldown.
    if (state.remaining !== null && state.remaining < this.reserve + cost && now - state.observedAt < 3_600_000) {
      throw new TrafficError(429, "Traffic quota reserve reached", 3_600_000 - (now - state.observedAt));
    }
    state.spending.push({ at: now, cost });
    state.nextRequestAt = (retry ? Math.max(now, state.nextRequestAt) : now) + this.spacingMs * cost;
    if (state.remaining !== null) state.remaining = Math.max(0, state.remaining - cost);
    await this.save(); // Reserve durably BEFORE making the upstream call.
  }
  async observe(response) {
    const now = this.now(), state = this.state;
    const remaining = numericHeader(response.headers, "x-rate-limit-remaining");
    state.remaining = remaining === null ? null : Math.max(0, remaining);
    state.observedAt = now;
    if (response.status === 429) {
      let seconds = numericHeader(response.headers, "x-rate-limit-retry-after-seconds");
      if (seconds === null) {
        const value = response.headers.get("retry-after");
        if (value !== null) seconds = Number.isFinite(Number(value)) ? Number(value) : (Date.parse(value) - now) / 1000;
      }
      state.failures++;
      const fallback = Math.min(3_600_000, 60_000 * 2 ** Math.min(6, state.failures - 1));
      state.blockedUntil = Math.max(state.blockedUntil, now + (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : fallback));
    } else if (response.ok) state.failures = 0;
    await this.save();
  }
  async fail(status = 503) {
    this.state.failures++;
    const wait = status === 401 || status === 403 ? 300_000 : Math.min(300_000, 30_000 * 2 ** Math.min(4, this.state.failures - 1));
    this.state.blockedUntil = Math.max(this.state.blockedUntil, this.now() + wait);
    await this.save();
    return wait;
  }
}
