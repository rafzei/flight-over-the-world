import { TRAFFIC, distanceM, finite } from "../../shared/trafficState.js";

// Timers own HTTP polling; animation frames only update the view and consume samples.
export class TrafficFeed {
  // Browser host functions must retain Window as their receiver when stored on this instance.
  constructor({ baseUrl = "", fetchImpl = (...args) => globalThis.fetch(...args), now = () => performance.now(), wallNow = Date.now, onSnapshot = () => {}, onReset = () => {}, setTimer = (...args) => globalThis.setTimeout(...args), clearTimer = (...args) => globalThis.clearTimeout(...args) } = {}) {
    Object.assign(this, { baseUrl, fetchImpl, now, wallNow, onSnapshot, onReset, setTimer, clearTimer });
    this.active = false; this.generation = 0; this.timer = null; this.controller = null;
    this.view = null; this.requestView = null; this.lastStarted = -Infinity; this.status = "disabled";
    this.serverBase = wallNow() / 1000; this.monotonicBase = now(); this.snapshot = null;
    this.clockDrift = 0; this.synchronized = false;
  }
  serverTime() {
    const elapsed = Math.max(0, (this.now() - this.monotonicBase) / 1000);
    return this.serverBase + elapsed + Math.sign(this.clockDrift) * Math.min(Math.abs(this.clockDrift), elapsed * .1);
  }
  setView(view) {
    this.view = view;
    if (this.active && this.requestView && distanceM(view, this.requestView) > 40_000) {
      this.reset();
      this.schedule(Math.max(0, this.lastStarted + 5000 - this.now()));
    }
  }
  setActive(active) {
    if (active === this.active) return;
    this.active = active;
    this.reset();
    this.status = active ? "loading" : "disabled";
    if (active) this.schedule(0);
  }
  reset() {
    this.generation++;
    this.clearTimer(this.timer); this.timer = null;
    this.controller?.abort(); this.controller = null;
    this.requestView = null; this.snapshot = null; this.onReset();
    this.synchronized = false;
    this.status = this.active ? "loading" : "disabled";
  }
  schedule(ms) {
    this.clearTimer(this.timer);
    if (this.active) this.timer = this.setTimer(() => { this.timer = null; void this.poll(); }, ms);
  }
  async poll() {
    if (!this.active || !this.view || this.controller) return;
    const generation = this.generation, controller = new AbortController();
    this.controller = controller; this.requestView = { ...this.view }; this.lastStarted = this.now();
    const timeout = this.setTimer(() => controller.abort(), 25_000);
    let wait = TRAFFIC.pollMs;
    try {
      const query = new URLSearchParams({ lat: this.view.lat.toFixed(5), lon: this.view.lon.toFixed(5), radiusKm: this.view.radiusKm.toFixed(1) });
      const response = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/api/traffic?${query}`, { signal: controller.signal, headers: { Accept: "application/json" }, cache: "no-store" });
      const data = await response.json();
      if (generation !== this.generation || !this.active) return;
      if (finite(data.nextPollAfterMs)) wait = Math.max(1000, Math.min(86_400_000, data.nextPollAfterMs));
      if (!response.ok) { this.status = response.status === 429 ? "rate-limited" : "unavailable"; return; }
      if (data.schemaVersion !== 1 || !finite(data.serverTime) || !Array.isArray(data.aircraft) || data.aircraft.length > 10_000) throw new Error("Invalid traffic data");
      const observedTime = data.serverTime + Math.min(2, (this.now() - this.lastStarted) / 2000);
      const currentTime = this.serverTime();
      this.serverBase = this.synchronized ? currentTime : observedTime;
      this.clockDrift = this.synchronized ? observedTime - currentTime : 0;
      this.monotonicBase = this.now();
      this.synchronized = true;
      this.snapshot = data; this.status = data.status;
      this.onSnapshot(data, this.serverTime());
    } catch {
      if (generation === this.generation) { this.status = "unavailable"; wait = 60_000; }
    } finally {
      this.clearTimer(timeout);
      if (generation === this.generation) { this.controller = null; this.schedule(wait); }
    }
  }
  dispose() { this.setActive(false); this.reset(); }
}
