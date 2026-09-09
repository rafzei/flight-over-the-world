import { TrafficError } from "./trafficBudget.mjs";

const TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const STATES_URL = "https://opensky-network.org/api/states/all";

export class OpenSkyClient {
  constructor({ clientId, clientSecret, fetchImpl = fetch, now = Date.now, timeoutMs = 12_000 } = {}) {
    Object.assign(this, { clientId, clientSecret, fetchImpl, now, timeoutMs });
    this.token = null; this.expiresAt = 0; this.pendingToken = null;
  }
  get configured() { return Boolean(this.clientId && this.clientSecret); }
  async getToken() {
    if (!this.configured) throw new TrafficError(503, "Live traffic is not configured", 300_000);
    if (this.token && this.now() < this.expiresAt) return this.token;
    if (this.pendingToken) return this.pendingToken;
    this.pendingToken = (async () => {
      const started = this.now();
      const response = await this.fetchImpl(TOKEN_URL, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(this.timeoutMs),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "client_credentials", client_id: this.clientId, client_secret: this.clientSecret }),
      });
      if (!response.ok) throw new TrafficError(response.status === 401 || response.status === 403 ? 403 : 503, "Traffic authentication unavailable", 300_000);
      const data = await response.json();
      if (typeof data.access_token !== "string" || !data.access_token || String(data.token_type).toLowerCase() !== "bearer"
        || !Number.isFinite(data.expires_in) || data.expires_in <= 60) throw new TrafficError(503, "Invalid traffic authentication response");
      this.token = data.access_token;
      this.expiresAt = started + (data.expires_in - 60) * 1000;
      return this.token;
    })();
    try { return await this.pendingToken; }
    catch (error) { throw error instanceof TrafficError ? error : new TrafficError(503, "Traffic authentication unavailable"); }
    finally { this.pendingToken = null; }
  }
  async states(box, { beforeRequest = async () => {}, onResponse = async () => {} } = {}) {
    const url = new URL(STATES_URL);
    for (const [key, value] of Object.entries({ ...box, extended: 1 })) url.searchParams.set(key, value);
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.getToken();
      await beforeRequest(attempt > 0);
      let response;
      try {
        response = await this.fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(this.timeoutMs), headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
      } catch { throw new TrafficError(503, "Traffic provider did not respond"); }
      await onResponse(response);
      if (response.status === 401 && attempt === 0) {
        // Do not invalidate a newer token acquired by another request.
        if (this.token === token) { this.token = null; this.expiresAt = 0; }
        continue;
      }
      if (!response.ok) throw new TrafficError(response.status, response.status === 429 ? "Traffic provider quota reached" : "Traffic provider unavailable");
      try { return await response.json(); }
      catch { throw new TrafficError(503, "Invalid traffic provider response"); }
    }
  }
}
