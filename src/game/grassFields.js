const DEG = Math.PI / 180;
const GRASS = /^(grass|meadow|village_green)$/;

function inRing(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.lat > lat) !== (b.lat > lat) && lon < (b.lon - a.lon) * (lat - a.lat) / (b.lat - a.lat) + a.lon) inside = !inside;
  }
  return inside;
}

function joinRings(segments) {
  const remaining = segments.filter(s => s.length > 1).map(s => [...s]), rings = [];
  const same = (a, b) => Math.abs(a.lat - b.lat) < 1e-8 && Math.abs(a.lon - b.lon) < 1e-8;
  while (remaining.length) {
    const ring = remaining.pop();
    while (!same(ring[0], ring.at(-1))) {
      const i = remaining.findIndex(s => same(ring.at(-1), s[0]) || same(ring.at(-1), s.at(-1)));
      if (i < 0) break;
      const next = remaining.splice(i, 1)[0];
      if (!same(ring.at(-1), next[0])) next.reverse();
      ring.push(...next.slice(1));
    }
    if (ring.length >= 4 && same(ring[0], ring.at(-1))) rings.push(ring);
  }
  return rings;
}

export function parseGrassFields(payload) {
  const fields = [], obstacles = [];
  for (const item of payload?.elements ?? []) {
    const tags = item.tags ?? {};
    const grass = GRASS.test(tags.landuse) || tags.natural === "grassland" || tags.surface === "grass";
    const blocked = !!tags.building || !!tags.water || /^(water|wood|wetland)$/.test(tags.natural) || tags.landuse === "forest";
    if (!grass && !blocked) continue;
    const outer = item.type === "relation"
      ? joinRings((item.members ?? []).filter(m => m.role !== "inner").map(m => m.geometry ?? []))
      : joinRings([item.geometry ?? []]);
    const inner = item.type === "relation" ? joinRings((item.members ?? []).filter(m => m.role === "inner").map(m => m.geometry ?? [])) : [];
    if (!outer.length) continue;
    (blocked ? obstacles : fields).push({ id: `${item.type}/${item.id}`, name: tags.name || "Grass field", outer, inner });
  }
  return { fields, obstacles };
}

function inside(polygon, lat, lon) {
  return polygon.outer.some(r => inRing(lat, lon, r)) && !polygon.inner.some(r => inRing(lat, lon, r));
}

// Only mapped grass qualifies. Water, buildings and holes in multipolygons
// remain solid hazards; a flat rooftop is never treated as a grass airfield.
export class GrassFields {
  constructor({ fetchImpl = (...args) => fetch(...args), now = () => Date.now() } = {}) {
    this.fetchImpl = fetchImpl; this.now = now; this.cache = []; this.pending = null;
    this.retryAt = 0; this.status = "idle";
  }
  at(lat, lon) {
    const latDeg = lat / DEG, lonDeg = lon / DEG;
    for (const entry of this.cache) {
      if (entry.obstacles.some(p => inside(p, latDeg, lonDeg))) return null;
    }
    for (const entry of this.cache) {
      const field = entry.fields.find(p => inside(p, latDeg, lonDeg));
      if (field) return field;
    }
    return null;
  }
  async update(plane) {
    const lat = plane.lat / DEG, lon = plane.lon / DEG;
    if (this.pending || this.now() < this.retryAt || this.cache.some(c => Math.hypot((lat - c.lat) * 111320, (lon - c.lon) * 111320 * Math.cos(plane.lat)) < 1600)) return this.pending;
    this.status = "loading";
    const dLat = 3000 / 111320, dLon = dLat / Math.max(.1, Math.cos(plane.lat));
    const bbox = `${lat - dLat},${lon - dLon},${lat + dLat},${lon + dLon}`;
    const query = `[out:json][timeout:12];(nwr[landuse~"^(grass|meadow|village_green|forest)$"](${bbox});nwr[natural~"^(grassland|water|wood|wetland)$"](${bbox});nwr[surface=grass](${bbox});way[building](${bbox}););out geom;`;
    this.pending = (async () => {
      try {
        const response = await this.fetchImpl("https://overpass-api.de/api/interpreter", {
          method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(query)}`, signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error("Grass map unavailable");
        this.cache.unshift({ lat, lon, ...parseGrassFields(await response.json()) });
        this.cache.length = Math.min(8, this.cache.length); this.status = "ready";
      } catch { this.status = "unavailable"; this.retryAt = this.now() + 30000; }
      finally { this.pending = null; }
    })();
    return this.pending;
  }
}
