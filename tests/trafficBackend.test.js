import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenSkyClient } from "../server/openskyClient.mjs";
import { TrafficBudget } from "../server/trafficBudget.mjs";
import { TrafficService } from "../server/trafficCache.mjs";
import { createTrafficServer } from "../server/trafficServer.mjs";

const box = { lamin: 51.8, lamax: 52.7, lomin: 20.4, lomax: 21.8 };
const view = { lat: 52.2, lon: 21, radiusKm: 35 };
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });
const tokenResponse = token => json({ access_token: token, token_type: "Bearer", expires_in: 1800 });
const row = (now, id = "abc123") => [id, " LOT123 ", "Poland", now, now, 21, 52.2, 1000, false, 200, 90, 0, null, 1100, null, false, 0, 4];

test("OAuth uses form credentials, shares one refresh and renews before expiry", async () => {
  let now = 100_000, calls = 0;
  const client = new OpenSkyClient({ clientId: "test-id", clientSecret: "test-secret", now: () => now,
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(new URL(url).host, "auth.opensky-network.org");
      assert.equal(options.method, "POST");
      assert.equal(options.body.get("grant_type"), "client_credentials");
      assert.equal(options.body.get("client_secret"), "test-secret");
      return tokenResponse(`token-${calls}`);
    } });
  assert.deepEqual(await Promise.all([client.getToken(), client.getToken(), client.getToken()]), ["token-1", "token-1", "token-1"]);
  now += 1_739_000;
  assert.equal(await client.getToken(), "token-1");
  now += 1000;
  assert.equal(await client.getToken(), "token-2");
  assert.equal(calls, 2);
});

test("401 retries once with a new token, reserves both requests, and never retries 429", async () => {
  let tokens = 0, reads = 0; const attempts = [], observed = [];
  const client = new OpenSkyClient({ clientId: "id", clientSecret: "secret", fetchImpl: async (url, options) => {
    if (String(url).includes("openid-connect")) return tokenResponse(`t${++tokens}`);
    reads++;
    assert.equal(new URL(url).searchParams.get("extended"), "1");
    assert.equal(options.headers.Authorization, `Bearer t${tokens}`);
    return reads === 1 ? json({}, 401) : json({ time: 100, states: null });
  } });
  await client.states(box, { beforeRequest: async retry => attempts.push(retry), onResponse: async r => observed.push(r.status) });
  assert.deepEqual(attempts, [false, true]); assert.deepEqual(observed, [401, 200]); assert.equal(tokens, 2);
  client.fetchImpl = async () => { reads++; return json({}, 429); };
  await assert.rejects(client.states(box), error => error.status === 429);
  assert.equal(reads, 3);
  client.fetchImpl = async url => String(url).includes("openid-connect") ? tokenResponse("bad") : json({}, 401);
  await assert.rejects(client.states(box), error => error.status === 401);
});

test("quota balance starts unknown; reservations, retry cooldown and safety cap survive restart", async t => {
  const dir = await mkdtemp(join(tmpdir(), "traffic-budget-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "budget.json"); let now = 1_000_000;
  const budget = new TrafficBudget({ file, now: () => now, allowance: 4, reserve: 1 });
  await budget.load(); assert.equal(budget.state.remaining, null);
  await budget.reserveCredit(1);
  assert.equal(budget.state.remaining, null);
  await assert.rejects(budget.reserveCredit(1), error => error.status === 429);
  await budget.observe(json({}, 200, { "X-Rate-Limit-Remaining": "3998" }));
  assert.equal(budget.state.remaining, 3998);
  await budget.observe(json({}, 429, { "X-Rate-Limit-Remaining": "0", "X-Rate-Limit-Retry-After-Seconds": "7200" }));
  const restarted = new TrafficBudget({ file, now: () => now, allowance: 4, reserve: 1 }); await restarted.load();
  assert.equal(restarted.state.remaining, 0); assert.equal(restarted.waitMs(), 7_200_000);
  now += 7_200_001;
  await restarted.reserveCredit(2);
  now += 60_000;
  await assert.rejects(restarted.reserveCredit(1), error => error.message.includes("daily safety"));
  assert.equal(restarted.state.spending.reduce((sum, x) => sum + x.cost, 0), 3);
});

test("missing quota header stays unknown, Retry-After date works, corrupt disk fails closed", async t => {
  let now = Date.UTC(2026, 8, 9); const budget = new TrafficBudget({ now: () => now });
  await budget.observe(json({}, 200, { "X-Rate-Limit-Remaining": "" }));
  assert.equal(budget.state.remaining, null);
  await budget.observe(json({}, 429, { "Retry-After": new Date(now + 90_000).toUTCString() }));
  assert.equal(budget.waitMs(), 90_000);
  const dir = await mkdtemp(join(tmpdir(), "traffic-corrupt-")); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "budget.json"); await writeFile(file, "{}");
  await assert.rejects(new TrafficBudget({ file }).load(), /refusing to reset/);
});

function rig() {
  let time = 1_000_000;
  const now = () => time;
  const budget = new TrafficBudget({ now });
  const client = { configured: true, async states(_box, hooks) {
    await hooks.beforeRequest(false); await hooks.onResponse(json({}, 200, { "X-Rate-Limit-Remaining": "3900" }));
    return { time: time / 1000, states: [row(time / 1000)] };
  } };
  return { budget, client, service: new TrafficService({ client, budget, now }), advance: ms => { time += ms; } };
}

test("same and nearby clients share one upstream read; other regions share the global budget", async () => {
  const r = rig();
  const responses = await Promise.all([r.service.get(view), r.service.get(view), r.service.get({ ...view, lat: 52.21 })]);
  assert(responses.every(x => x.status === "live" && x.aircraft.length === 1));
  assert.equal(r.service.metrics.upstreamRequests, 1);
  assert.equal(r.service.metrics.joinedRequests, 2);
  const distant = { ...view, lat: 48, lon: 2 };
  assert.equal((await r.service.get(distant)).status, "rate-limited");
  assert.equal(r.service.metrics.upstreamRequests, 1);
  assert.equal((await r.service.get(distant)).status, "rate-limited");
  r.advance(30_001);
  const next = await r.service.get(distant);
  assert.equal(next.status, "live"); assert.equal(next.nextPollAfterMs, 60_000);
  assert.equal(r.service.metrics.upstreamRequests, 2);
  assert.equal((await r.service.get(view)).status, "delayed");
});

test("date-line requests count both boxes; unavailable provider backs off and keeps cache", async () => {
  const r = rig();
  const result = await r.service.get({ ...view, lon: 179.99 });
  assert.equal(result.coverageBboxes.length, 2); assert.equal(result.aircraft.length, 1);
  assert.equal(r.budget.state.spending.length, 2); assert.equal(result.nextPollAfterMs, 60_000);
  r.advance(60_001); r.client.states = async () => { throw new Error("private provider detail"); };
  const failure = await r.service.get({ ...view, lon: 179.99 });
  assert.equal(failure.status, "unavailable"); assert.equal(failure.aircraft.length, 1);
  assert(!JSON.stringify(failure).includes("private provider detail"));
  assert.equal((await r.service.get({ ...view, lon: 179.99 })).status, "unavailable");
});

test("HTTP validates view and CORS before fetching and handles absent credentials", async t => {
  let calls = 0;
  const server = createTrafficServer({ allowedOrigins: ["https://flight.example"], service: {
    client: { configured: false }, get: async view => { calls++; return { status: "disabled", view }; },
  } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const query of ["lat=&lon=0", "lat=91&lon=0", "lat=0&lon=0&radiusKm=76", "lat=0&lon=0&token=secret", "lat=0&lat=1&lon=0"]) {
    assert.equal((await fetch(`${base}/api/traffic?${query}`)).status, 400);
  }
  assert.equal((await fetch(`${base}/api/traffic?lat=0&lon=0`, { headers: { Origin: "https://evil.example" } })).status, 403);
  assert.equal(calls, 0);
  const good = await fetch(`${base}/api/traffic?lat=0&lon=0`, { headers: { Origin: "https://flight.example" } });
  assert.equal(good.headers.get("access-control-allow-origin"), "https://flight.example");
  assert.equal((await good.json()).view.lat, 0); assert.equal(calls, 1);
  assert.deepEqual(await (await fetch(`${base}/api/traffic/health`)).json(), { ok: true, configured: false });
});
