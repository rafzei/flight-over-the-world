import { WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { Matrix4, Vector3 } from "three";
import { TrafficFeed } from "./trafficFeed.js";
import { TrafficTracks } from "./trafficTracks.js";
import { TrafficSpheres } from "./trafficSpheres.js";
import { trafficRange } from "./trafficVisibility.js";
import { replaySnapshot } from "./trafficReplay.js";

export function createLiveTraffic({ scene, camera, mapRoot, mobile = false, baseUrl = "" }) {
  const tracks = new TrafficTracks();
  const spheres = new TrafficSpheres(scene, { limit: mobile ? 200 : 500 });
  const feed = new TrafficFeed({ baseUrl, onSnapshot: (snapshot, now) => tracks.ingest(snapshot, now), onReset: () => { tracks.clear(); spheres.hide(); } });
  const panel = document.getElementById("traffic-panel"), toggle = document.getElementById("traffic-toggle");
  const status = document.getElementById("traffic-status"), details = document.getElementById("traffic-details");
  const modeInput = document.getElementById("traffic-source"), predictionInput = document.getElementById("traffic-prediction");
  const inverse = new Matrix4(), local = new Vector3(), cartographic = {};
  let enabled = true, mode = "live", prediction = true, shown = false, replayCenter = null, replayStart = 0, nextReplay = 0, nextUi = 0;
  let debug = { status: "disabled", visible: 0, tracked: 0 };
  try { enabled = localStorage.getItem("foe-live-traffic") !== "off"; } catch { /* optional preference */ }
  const reset = () => { feed.setActive(false); tracks.clear(); spheres.hide(); replayCenter = null; nextReplay = 0; nextUi = 0; };
  const toggleTraffic = () => {
    enabled = !enabled; reset();
    try { localStorage.setItem("foe-live-traffic", enabled ? "on" : "off"); } catch { /* optional preference */ }
  };
  const changeMode = () => { mode = modeInput.value === "replay" ? "replay" : "live"; reset(); };
  const changePrediction = () => { prediction = predictionInput.checked; };
  const visibility = () => { if (document.hidden) { reset(); if (panel) panel.hidden = true; } };
  toggle?.addEventListener("click", toggleTraffic);
  modeInput?.addEventListener("change", changeMode);
  predictionInput?.addEventListener("change", changePrediction);
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", reset);

  return {
    reset,
    debug: () => ({ ...debug }),
    update({ active, speedMps = 0, viewportHeight = innerHeight }) {
      shown = active && !document.hidden;
      if (panel) panel.hidden = !shown;
      const running = shown && enabled;
      if (!running) {
        feed.setActive(false); spheres.hide(); replayCenter = null;
        debug = { status: enabled ? "paused" : "disabled", visible: 0, tracked: 0 };
      } else {
        inverse.copy(mapRoot.matrixWorld).invert();
        local.copy(camera.position).applyMatrix4(inverse);
        WGS84_ELLIPSOID.getPositionToCartographic(local, cartographic);
        const radiusKm = Math.min(75, Math.max(35, trafficRange(scene.fog) / 1000 + 10 + Math.max(0, speedMps - 400) * .03));
        const view = { lat: cartographic.lat * 180 / Math.PI, lon: cartographic.lon * 180 / Math.PI, radiusKm };
        let now;
        if (mode === "live") {
          feed.setView(view); feed.setActive(true); now = feed.serverTime();
        } else {
          feed.setActive(false); now = Date.now() / 1000;
          if (!replayCenter) { replayCenter = view; replayStart = now; nextReplay = 0; tracks.clear(); }
          if (now >= nextReplay) { tracks.ingest(replaySnapshot(replayCenter, now, now - replayStart), now); nextReplay = now + 5; }
        }
        const positions = tracks.positions(now, { prediction });
        spheres.update(positions, camera, mapRoot.matrixWorld, scene.fog, viewportHeight);
        const ages = positions.map(p => p.ageSeconds);
        let state = mode === "replay" ? "replay" : feed.status;
        if (state === "live" && (!ages.length || Math.min(...ages) > 30)) state = "delayed";
        debug = { status: state, visible: spheres.visible.length, tracked: tracks.tracks.size,
          fresh: ages.filter(age => age <= 30).length, newestAgeSeconds: ages.length ? Math.round(Math.min(...ages)) : null,
          rangeKm: Number((trafficRange(scene.fog) / 1000).toFixed(1)), view, prediction,
          snapshotTime: mode === "live" ? feed.snapshot?.snapshotTime ?? null : now,
          stats: mode === "live" ? feed.snapshot?.stats ?? null : { total: 4, stale: 1 },
          contacts: spheres.visible.slice(0, 8).map(({ sample, distance, visual }) => ({ icao24: sample.icao24, callsign: sample.callsign, distanceM: Math.round(distance), ageSeconds: Math.round(sample.ageSeconds), altitudeSource: sample.altitudeSource, typeCode: sample.aircraft?.typeCode ?? null, modelName: sample.aircraft?.modelName ?? null, registration: sample.aircraft?.registration ?? null, model: visual?.model ?? null })),
        };
      }
      if (performance.now() >= nextUi) {
        nextUi = performance.now() + 500;
        if (toggle) { toggle.setAttribute("aria-pressed", String(enabled)); toggle.textContent = enabled ? "Live traffic · On" : "Live traffic · Off"; }
        const labels = {
          loading: "Loading nearby aircraft…", disabled: "Traffic off", paused: "Traffic paused",
          empty: "No fresh aircraft nearby", "rate-limited": "Traffic quota cooling down",
          unavailable: "Live traffic temporarily unavailable", delayed: "Traffic positions delayed",
          replay: `REPLAY · ${debug.visible} synthetic contacts`, live: `${debug.visible} visible · ${debug.fresh} fresh nearby`,
        };
        if (status) status.textContent = labels[debug.status] || "Live traffic not configured";
        if (enabled && running && mode === "live" && feed.status === "disabled" && status) status.textContent = "Live traffic not configured";
        if (details) {
          const age = debug.newestAgeSeconds === null || debug.newestAgeSeconds === undefined ? "—" : `${debug.newestAgeSeconds}s`;
          details.textContent = `View ${debug.rangeKm ?? 25} km · newest position ${age}\nReceived ${debug.stats?.total ?? 0} · stale rejected ${debug.stats?.stale ?? 0}\n${(debug.contacts || []).map(item => `${item.callsign || item.icao24} · ${item.typeCode || "unknown type"} · ${(item.distanceM / 1000).toFixed(1)} km · ${item.ageSeconds}s`).join("\n")}`;
        }
        if (panel) panel.dataset.source = mode;
      }
    },
    dispose() {
      reset(); feed.dispose(); spheres.dispose();
      toggle?.removeEventListener("click", toggleTraffic); modeInput?.removeEventListener("change", changeMode);
      predictionInput?.removeEventListener("change", changePrediction);
      document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", reset);
    },
  };
}
