// Builds data/bike.json: Bogotá's streets and bike network, for routes by bicycle, e-bike, e-scooter, moped and
// electric motorcycle that only use what each vehicle may legally use.
//
//   node tools/build-bike.js                 download everything (2 to 5 minutes) and build
//   node tools/build-bike.js --cache <dir>   keep the downloads in <dir> and reuse them on the next run
//
// Sources:
//   - Streets and paths: OpenStreetMap through Overpass (ODbL).
//   - Official bike network: "Red Biciusuarios" of the IDU, IDECA reference map (CC BY 4.0), updated every 3 months.
//   - Sunday ciclovía: IDRD (CC BY 4.0). Bike parking at TransMilenio stations: IDECA (CC BY 4.0).
//   - Rules that do not come from a map (vehicle categories, places closed to some vehicles): data/bike-rules.json.
// Streets change slowly and the IDU publishes every three months, so this runs by hand, not every day.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const AREA = 3607426387; // "Bogotá ciudad", the same area as tools/build-grid.js
const HW = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|road|service|cycleway|footway|path|pedestrian|track|busway|steps|bridleway';
const QUERY = `[out:json][timeout:400][maxsize:1073741824];area(id:${AREA})->.a;(way["highway"~"^(${HW})$"](area.a););out body;>;out skel qt;`;
const IDU_RED = 'https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/Mapa_Referencia/Mapa_Referencia/MapServer/19';
const CICLOVIA = 'https://visorsrv.idrd.gov.co/srv/rest/services/RecreacionDeporte/Ciclovia/MapServer/0';
const PARKING = 'https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/movilidad/transportepublico/MapServer/0';
const UA = { 'User-Agent': 'SinVueltas-build/1.0 (https://mnovoata980-gif.github.io/sin-vueltas/)' };

// ---------- codes shared with js/bike.js ----------
// Road class: what kind of way it is.
const CLS = { motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4, residential: 5, living: 6, service: 7, cycleway: 8, path: 9, footway: 10, track: 11, steps: 12 };
// Bike infrastructure on (or right beside) the way.
//  1 ciclorruta: physically separated (on the sidewalk, the median, a park, a bike bridge or tunnel)
//  2 bicicarril: a lane on the road with marks or posts
//  3 carril bus-bici: shared with buses
//  4 shared with pedestrians (espacio compartido, ciclo-peatonal)
//  5 shared street with priority signs (vía compartida, ciclobarrio)
const INF = { none: 0, ciclorruta: 1, bicicarril: 2, busbici: 3, peatonal: 4, compartida: 5 };
// Flags (bits of the edge's flag number)
const F = {
  bike: 1 << 0,       // bicycles and light electric vehicles may ride here
  walk: 1 << 1,       // only on foot pushing the bike (sidewalk, pedestrian street, footbridge)
  moto: 1 << 2,       // motorcycles may ride here
  moped: 1 << 3,      // mopeds (ciclomotores) may ride here
  ow: 1 << 4,         // one way for motor vehicles, in the edge's direction
  owBike: 1 << 5,     // one way for bikes, in the edge's direction
  unpaved: 1 << 6,
  sidewalk: 1 << 7,   // the bike path is on the sidewalk or shared with pedestrians: e-scooters must walk
  bridge: 1 << 8,
  tunnel: 1 << 9,
  official: 1 << 10,  // the IDU's network confirms the bike infrastructure
  near: 1 << 11,      // the name was taken from the street beside it
  // bits 12..15: road class, 16..18: infrastructure, 19..22: speed limit / 10 km/h (0 unknown)
};
const CLS_SHIFT = 12, INF_SHIFT = 16, MAX_SHIFT = 19;

const LAT0 = 4.65, LON0 = -74.1, KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KY = 110540;
const X = lon => (lon - LON0) * KX, Y = lat => (lat - LAT0) * KY;

// ---------- downloads ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function overpass() {
  for (let round = 0; round < 3; round++) {
    for (const url of OVERPASS) {
      try {
        process.stdout.write(`Overpass ${url} … `);
        const r = await fetch(url, { method: 'POST', headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(QUERY), signal: AbortSignal.timeout(600000) });
        const text = await r.text();
        if (r.ok && text.startsWith('{')) { console.log((text.length / 1048576).toFixed(1) + ' MB'); return text; }
        console.log('HTTP ' + r.status);
      } catch (e) { console.log(e.message); }
    }
    await sleep(30000 * (round + 1));
  }
  throw new Error('Ningún servidor de Overpass respondió');
}
async function arcgis(layer) {
  const all = [];
  for (let off = 0; ; off += 1000) {
    const u = `${layer}/query?where=1%3D1&outFields=*&outSR=4326&f=geojson&resultOffset=${off}&resultRecordCount=1000&orderByFields=OBJECTID`;
    let j = null;
    for (let t = 0; t < 4 && !j; t++) {
      try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(120000) }); if (r.ok) j = await r.json(); } catch (e) { /* retried */ }
      if (!j) await sleep(3000);
    }
    if (!j) throw new Error('No respondió ' + layer);
    all.push(...(j.features || []));
    if ((j.features || []).length < 1000 && !j.exceededTransferLimit) break;
  }
  return { type: 'FeatureCollection', features: all };
}
async function source(cacheDir, name, get) {
  const file = cacheDir && path.join(cacheDir, name);
  if (file && fs.existsSync(file)) { console.log('Usando ' + file); return fs.readFileSync(file, 'utf8'); }
  const text = await get();
  if (file) { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(file, text); }
  return text;
}

// ---------- reading OpenStreetMap tags ----------
const NO = /^(no|private|agricultural|forestry|emergency|military|use_sidepath|discouraged)$/;
const YES = /^(yes|designated|permissive|destination|official)$/;
const UNPAVED = /^(unpaved|gravel|fine_gravel|dirt|ground|earth|grass|sand|mud|compacted|pebblestone|rock|wood|woodchips|grass_paver)$/;
const first = (t, keys) => { for (const k of keys) if (t[k] !== undefined) return t[k]; return undefined; };
function speedOf(v) {
  if (!v) return 0;
  const m = String(v).match(/^(\d+)/);
  if (!m) return 0;
  return /mph/.test(v) ? Math.round(+m[1] * 1.609) : +m[1];
}
function classify(t) {
  let hw = t.highway;
  if (!hw || t.area === 'yes') return null;
  if (/_link$/.test(hw)) hw = hw.replace('_link', '');
  if (hw === 'busway') return null; // TransMilenio and bus-only lanes
  const cls = { motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4, unclassified: 5, residential: 5, road: 5, living_street: 6, service: 7, cycleway: 8, path: 9, bridleway: 9, footway: 10, pedestrian: 10, track: 11, steps: 12 }[hw];
  if (cls === undefined) return null;
  if (t.service === 'emergency_access') return null;
  const motorRoad = cls <= CLS.service || cls === CLS.track;
  const bikeTag = first(t, ['bicycle', 'vehicle', 'access']);
  const motoTag = first(t, ['motorcycle', 'motor_vehicle', 'vehicle', 'access']);
  const mopedTag = first(t, ['moped', 'motor_vehicle', 'vehicle', 'access']);
  // Bus-only lanes mapped as ordinary roads closed to everyone else.
  const busOnly = (t.bus === 'designated' || t.psv === 'designated') && (NO.test(t.access || '') || NO.test(t.motor_vehicle || '') || NO.test(t.vehicle || ''));
  let flags = 0;
  // Bicycles and light electric vehicles
  if (cls === CLS.motorway) { if (YES.test(t.bicycle || '')) flags |= F.bike; }
  else if (cls === CLS.cycleway) { if (!NO.test(t.bicycle || '')) flags |= F.bike; }
  else if (cls === CLS.footway || cls === CLS.path) {
    if (YES.test(t.bicycle || '')) flags |= F.bike | (t.segregated === 'yes' ? 0 : F.sidewalk);
    else if (!NO.test(t.access || '') || t.bicycle === 'dismount') flags |= F.walk | F.sidewalk;
  } else if (cls === CLS.steps) {
    if (/^(yes|designated)$/.test(t['ramp:bicycle'] || t['ramp:stroller'] || '')) flags |= F.walk | F.sidewalk;
  } else if (t.bicycle === 'dismount') flags |= F.walk;
  else if (busOnly ? YES.test(t.bicycle || '') : !NO.test(bikeTag || '')) flags |= F.bike;
  // Motor vehicles
  if (motorRoad && !busOnly) {
    if (!NO.test(motoTag || '')) flags |= F.moto;
    // A moped is not built for motorways.
    if (cls !== CLS.motorway && !NO.test(mopedTag || '')) flags |= F.moped;
  }
  if (!(flags & (F.bike | F.walk | F.moto | F.moped))) return null;
  // One way
  const ow = t.oneway;
  let car = ow === 'yes' || ow === '1' || ow === 'true' ? 1 : ow === '-1' || ow === 'reverse' ? -1 : ow === 'no' ? 0
    : (t.junction === 'roundabout' || t.junction === 'circular' || hw === 'motorway') ? 1 : 0;
  let bike = car;
  const cws = [t.cycleway, t['cycleway:both'], t['cycleway:right'], t['cycleway:left']].filter(Boolean);
  if (t['oneway:bicycle'] === 'no' || cws.some(v => /^opposite/.test(v)) || (t['cycleway:left'] && t['cycleway:left:oneway'] === '-1')) bike = 0;
  if (t['oneway:bicycle'] === 'yes') bike = 1; else if (t['oneway:bicycle'] === '-1') bike = -1;
  // Bike infrastructure tagged on the road itself
  let inf = INF.none;
  if (cls === CLS.cycleway) inf = INF.ciclorruta;
  else if ((cls === CLS.footway || cls === CLS.path) && (flags & F.bike)) inf = t.segregated === 'yes' ? INF.ciclorruta : INF.peatonal;
  else if (cws.some(v => v === 'track' || v === 'opposite_track')) inf = INF.ciclorruta;
  else if (cws.some(v => v === 'lane' || v === 'opposite_lane')) inf = INF.bicicarril;
  else if (cws.some(v => /share_busway/.test(v))) inf = INF.busbici;
  else if (cws.some(v => v === 'shared_lane')) inf = INF.compartida;
  if (UNPAVED.test(t.surface || '') || (cls === CLS.track && !t.surface)) flags |= F.unpaved;
  if (t.bridge && t.bridge !== 'no') flags |= F.bridge;
  if (t.tunnel && t.tunnel !== 'no') flags |= F.tunnel;
  const name = (t.name || t.ref || '').trim();
  return { cls, inf, flags, car, bike, max: speedOf(t.maxspeed), name, ped: hw === 'pedestrian', side: /^(sidewalk|crossing|traffic_island)$/.test(t.footway || ''), aisle: t.service === 'parking_aisle' || t.service === 'drive-through' };
}

// ---------- geometry helpers ----------
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = ax + t * dx - px, y = ay + t * dy - py;
  return Math.sqrt(x * x + y * y);
}
// A grid of line pieces, to find what lies near a point quickly.
function segIndex(cell) {
  const grid = new Map(), segs = [];
  const key = (i, j) => i * 100000 + j;
  return {
    segs,
    add(ax, ay, bx, by, data) {
      const id = segs.push({ ax, ay, bx, by, data }) - 1;
      const i0 = Math.floor(Math.min(ax, bx) / cell), i1 = Math.floor(Math.max(ax, bx) / cell);
      const j0 = Math.floor(Math.min(ay, by) / cell), j1 = Math.floor(Math.max(ay, by) / cell);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = key(i, j); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(id); }
    },
    near(x, y, r) {
      const out = new Set();
      for (let i = Math.floor((x - r) / cell); i <= Math.floor((x + r) / cell); i++) for (let j = Math.floor((y - r) / cell); j <= Math.floor((y + r) / cell); j++) { const a = grid.get(key(i, j)); if (a) for (const id of a) out.add(id); }
      return [...out].map(id => segs[id]);
    },
  };
}
const parallel = (s, dx, dy) => { const ex = s.bx - s.ax, ey = s.by - s.ay, l = Math.hypot(ex, ey) * Math.hypot(dx, dy); return l ? Math.abs((ex * dx + ey * dy) / l) : 0; };
// Douglas-Peucker on [x, y, index] points.
function simplify(pts, tol) {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let far = -1, fd = tol;
    for (let i = a + 1; i < b; i++) { const d = segDist(pts[i][0], pts[i][1], pts[a][0], pts[a][1], pts[b][0], pts[b][1]); if (d > fd) { fd = d; far = i; } }
    if (far >= 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((p, i) => keep[i]);
}

// ---------- build ----------
function build(osmText, redText, cicloviaText, parkingText, rules) {
  const t0 = Date.now();
  const osm = JSON.parse(osmText).elements;
  const nodeAt = new Map();
  const nLat = [], nLon = [];
  for (const e of osm) if (e.type === 'node') { nodeAt.set(e.id, nLat.length); nLat.push(e.lat); nLon.push(e.lon); }
  const ways = [];
  for (const e of osm) {
    if (e.type !== 'way' || !e.nodes || e.nodes.length < 2) continue;
    const c = classify(e.tags || {});
    if (!c) continue;
    const nodes = e.nodes.map(id => nodeAt.get(id)).filter(i => i !== undefined);
    if (nodes.length < 2) continue;
    ways.push({ id: e.id, ...c, nodes });
  }
  console.log(`OSM: ${nodeAt.size} puntos, ${ways.length} vías útiles (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  const nx = Float64Array.from(nLon, X), ny = Float64Array.from(nLat, Y);

  // --- the IDU's official bike network on top of OpenStreetMap ---
  const IDU_INF = { 1: INF.peatonal, 2: INF.ciclorruta, 3: INF.bicicarril, 4: -1, 5: INF.busbici, 6: INF.ciclorruta, 7: -1, 8: INF.ciclorruta, 9: INF.peatonal, 10: -2, 11: INF.compartida, 12: INF.compartida, 13: INF.compartida };
  const red = JSON.parse(redText).features;
  const idu = segIndex(60);
  let iduLen = 0;
  for (const f of red) {
    const p = f.properties || {}, g = f.geometry;
    if (!g) continue;
    const parts = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    const inf = IDU_INF[p.RBICLASE];
    if (inf === undefined) continue;
    // On the road: lanes, shared streets, crossings. Off the road: sidewalk, median, park, bridge, tunnel.
    const onRoad = p.RBILOCALIZ === 3;
    for (const c of parts) for (let i = 1; i < c.length; i++) {
      const ax = X(c[i - 1][0]), ay = Y(c[i - 1][1]), bx = X(c[i][0]), by = Y(c[i][1]);
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 0.5) continue;
      iduLen += len;
      idu.add(ax, ay, bx, by, { inf, cls: p.RBICLASE, onRoad, sidewalk: p.RBILOCALIZ === 2 && p.RBICLASE === 1, hit: 0, len });
    }
  }
  console.log(`IDU: ${(iduLen / 1000).toFixed(0)} km de red de biciusuarios`);
  const offRoad = w => w.cls >= CLS.cycleway;
  // Which official piece lies along this OSM piece, if any. Off-road pieces only match off-road ways first.
  const matchIdu = (ax, ay, bx, by, wantOffRoad, r) => {
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy), n = Math.max(1, Math.round(len / 12));
    let hits = 0, best = null;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, px = ax + dx * t, py = ay + dy * t;
      let bd = r, bs = null;
      for (const s of idu.near(px, py, r)) {
        if (wantOffRoad !== null && s.data.onRoad === wantOffRoad) continue;
        if (parallel(s, dx, dy) < 0.85) continue;
        const d = segDist(px, py, s.ax, s.ay, s.bx, s.by);
        if (d < bd) { bd = d; bs = s; }
      }
      if (bs) { hits++; best = bs; }
    }
    return hits * 2 >= n ? best : null;
  };
  // Pass 1: off-road OSM paths against off-road official pieces; roads against lanes and shared streets.
  const segInf = new Map(); // "way:index" -> official piece
  for (const w of ways) {
    for (let i = 1; i < w.nodes.length; i++) {
      const a = w.nodes[i - 1], b = w.nodes[i];
      const s = matchIdu(nx[a], ny[a], nx[b], ny[b], offRoad(w) ? false : true, offRoad(w) ? 9 : 8);
      if (s) { segInf.set(w.id + ':' + i, s); s.data.hit = 1; }
    }
  }
  // Mark official pieces that an OSM path already covers (also when the match went the other way round).
  const cover = segIndex(60);
  for (const w of ways) if (offRoad(w) || w.inf) for (let i = 1; i < w.nodes.length; i++) { const a = w.nodes[i - 1], b = w.nodes[i]; cover.add(nx[a], ny[a], nx[b], ny[b], w); }
  let covered = 0;
  for (const s of idu.segs) {
    if (s.data.hit) { covered += s.data.len; continue; }
    const mx = (s.ax + s.bx) / 2, my = (s.ay + s.by) / 2, dx = s.bx - s.ax, dy = s.by - s.ay;
    if (cover.near(mx, my, 9).some(c => parallel(c, dx, dy) >= 0.85 && segDist(mx, my, c.ax, c.ay, c.bx, c.by) < 9)) { s.data.hit = 2; covered += s.data.len; }
  }
  // Pass 2: official bike paths that OpenStreetMap lacks run beside a road. The road then counts as having that path.
  let sideLen = 0;
  for (const w of ways) {
    if (offRoad(w)) continue;
    for (let i = 1; i < w.nodes.length; i++) {
      const k = w.id + ':' + i;
      if (segInf.has(k)) continue;
      const a = w.nodes[i - 1], b = w.nodes[i];
      const dx = nx[b] - nx[a], dy = ny[b] - ny[a], len = Math.hypot(dx, dy), n = Math.max(1, Math.round(len / 12));
      let hits = 0, best = null;
      for (let q = 0; q < n; q++) {
        const t = (q + 0.5) / n, px = nx[a] + dx * t, py = ny[a] + dy * t;
        let bd = 24, bs = null;
        for (const s of idu.near(px, py, 24)) {
          if (s.data.onRoad || s.data.hit || s.data.inf !== INF.ciclorruta || parallel(s, dx, dy) < 0.9) continue;
          const d = segDist(px, py, s.ax, s.ay, s.bx, s.by);
          if (d < bd) { bd = d; bs = s; }
        }
        if (bs) { hits++; best = bs; }
      }
      if (best && hits * 2 >= n) { segInf.set(k, best); sideLen += len; }
    }
  }
  console.log(`IDU cubierta por OSM: ${(100 * covered / iduLen).toFixed(1)} % · ${(sideLen / 1000).toFixed(1)} km de ciclorruta oficial asignada a la vía de al lado`);

  // --- graph: a vertex where ways meet or end ---
  const uses = new Uint16Array(nLat.length);
  for (const w of ways) { w.nodes.forEach(n => { if (uses[n] < 60000) uses[n]++; }); uses[w.nodes[0]] += 2; uses[w.nodes[w.nodes.length - 1]] += 2; }
  const vOf = new Int32Array(nLat.length).fill(-1);
  const vNode = [];
  const vertex = n => { if (vOf[n] < 0) { vOf[n] = vNode.length; vNode.push(n); } return vOf[n]; };
  const edges = [];
  for (const w of ways) {
    let start = 0;
    for (let i = 1; i < w.nodes.length; i++) {
      if (i < w.nodes.length - 1 && uses[w.nodes[i]] < 2) continue;
      const nodes = w.nodes.slice(start, i + 1);
      // Official infrastructure along this stretch, by length.
      const byInf = {};
      let len = 0, offLen = 0, sidewalk = 0;
      for (let k = start + 1; k <= i; k++) {
        const a = w.nodes[k - 1], b = w.nodes[k], l = Math.hypot(nx[b] - nx[a], ny[b] - ny[a]);
        len += l;
        const s = segInf.get(w.id + ':' + k);
        if (s) { offLen += l; const inf = s.data.inf; byInf[inf] = (byInf[inf] || 0) + l; if (s.data.sidewalk) sidewalk += l; }
      }
      if (len > 0.3) edges.push({ w, nodes, len, byInf, offLen, sidewalk });
      start = i;
    }
  }
  // Each edge's own codes.
  for (const e of edges) {
    const w = e.w;
    let inf = w.inf, flags = w.flags;
    if (e.offLen >= e.len * 0.5) {
      let best = null, bl = 0;
      for (const [k, l] of Object.entries(e.byInf)) if (l > bl) { bl = l; best = +k; }
      flags |= F.official;
      if (best === -2) { // footbridge: on foot
        if (flags & F.bike) { flags = (flags & ~F.bike) | F.walk | F.sidewalk; }
        inf = INF.none;
      } else if (best === -1) { // a crossing within the network: bikes cross with the path they were on
        if (!inf) inf = offRoad(w) ? INF.ciclorruta : INF.compartida;
      } else if (best > 0 && (!inf || offRoad(w) || best === INF.ciclorruta)) inf = best;
      // An official bike path the map drew as a footpath: bikes may ride it.
      if (offRoad(w) && (flags & F.walk) && best !== -2) flags = (flags & ~F.walk) | F.bike;
      if (e.sidewalk >= e.len * 0.5) flags |= F.sidewalk;
    }
    if (inf === INF.peatonal) flags |= F.sidewalk;
    e.inf = inf; e.flags = flags;
  }

  // Sidewalks drawn apart from their street add nothing a bike needs (pushing the bike along the street is the same),
  // and parking aisles lead nowhere. Footbridges, tunnels and pedestrian streets stay: they cross what the road cannot.
  // A footpath counts as a sidewalk when it is tagged so, or when most of it runs beside a street.
  const roadIdx = segIndex(60);
  for (const e of edges) if (e.w.cls <= CLS.service) for (let k = 1; k < e.nodes.length; k++) { const a = e.nodes[k - 1], b = e.nodes[k]; roadIdx.add(nx[a], ny[a], nx[b], ny[b], 1); }
  const besideRoad = e => {
    let n = 0, hit = 0;
    for (let k = 1; k < e.nodes.length; k++) {
      const a = e.nodes[k - 1], b = e.nodes[k], dx = nx[b] - nx[a], dy = ny[b] - ny[a], l = Math.hypot(dx, dy), steps = Math.max(1, Math.round(l / 15));
      for (let q = 0; q < steps; q++) {
        const t = (q + 0.5) / steps, px = nx[a] + dx * t, py = ny[a] + dy * t;
        n++;
        if (roadIdx.near(px, py, 16).some(r => parallel(r, dx, dy) >= 0.8 && segDist(px, py, r.ax, r.ay, r.bx, r.by) < 16)) hit++;
      }
    }
    return hit >= n * 0.4;
  };
  const useful = edges.filter(e => {
    if (e.w.aisle && !(e.flags & F.bike && e.inf)) return false;
    const walkOnly = (e.flags & F.walk) && !(e.flags & (F.bike | F.moto | F.moped));
    if (!walkOnly || e.w.ped || (e.flags & (F.bridge | F.tunnel | F.official))) return true;
    // Paths through parks, plazas and campuses stay: they are how people get in and out of those places.
    return !e.w.side && e.len >= 15 && !besideRoad(e);
  });
  console.log(`Sin andenes sueltos ni parqueaderos: ${useful.length} de ${edges.length} tramos`);
  edges.length = 0; for (const e of useful) edges.push(e);
  // --- keep the network people can actually reach: drop islands ---
  for (const e of edges) { e.a = vertex(e.nodes[0]); e.b = vertex(e.nodes[e.nodes.length - 1]); }
  const par2 = Int32Array.from({ length: vNode.length }, (_, i) => i);
  const find2 = i => { while (par2[i] !== i) { par2[i] = par2[par2[i]]; i = par2[i]; } return i; };
  for (const e of edges) { const x = find2(e.a), y = find2(e.b); if (x !== y) par2[x] = y; }
  const size = new Map();
  for (let i = 0; i < vNode.length; i++) { const r = find2(i); size.set(r, (size.get(r) || 0) + 1); }
  const kept = edges.filter(e => size.get(find2(e.a)) >= 80);
  console.log(`Grafo: ${edges.length} tramos, ${kept.length} conectados a la red principal`);

  // --- names for bike paths without one: the street beside them ---
  const named = segIndex(80);
  for (const e of kept) if (e.w.name && !offRoad(e.w)) for (let k = 1; k < e.nodes.length; k++) { const a = e.nodes[k - 1], b = e.nodes[k]; named.add(nx[a], ny[a], nx[b], ny[b], e.w.name); }
  for (const e of kept) {
    e.name = e.w.name;
    if (e.name || !offRoad(e.w) || !(e.flags & (F.bike | F.walk))) continue;
    const a = e.nodes[0], b = e.nodes[e.nodes.length - 1], mxp = (nx[a] + nx[b]) / 2, myp = (ny[a] + ny[b]) / 2, dx = nx[b] - nx[a], dy = ny[b] - ny[a];
    let bd = 35, bn = '';
    for (const s of named.near(mxp, myp, 35)) { if (parallel(s, dx, dy) < 0.8) continue; const d = segDist(mxp, myp, s.ax, s.ay, s.bx, s.by); if (d < bd) { bd = d; bn = s.data; } }
    if (bn) { e.name = bn; e.flags |= F.near; }
  }

  // --- Sunday ciclovía: roads closed to cars and open to bikes ---
  const cv = JSON.parse(cicloviaText).features, cvIdx = segIndex(60), tramos = [];
  cv.forEach((f, ti) => {
    const p = f.properties || {}, g = f.geometry;
    if (!g) return;
    const hours = String(p.HORARIO || '7:00 a 14:00').match(/(\d+):(\d+)\D+(\d+):(\d+)/);
    tramos.push({ id: p.ID_TRAMO || 'T' + ti, where: String(p.DIRECCION || '').trim(), from: hours ? +hours[1] * 60 + +hours[2] : 420, to: hours ? +hours[3] * 60 + +hours[4] : 840 });
    const parts = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
    for (const c of parts) for (let i = 1; i < c.length; i++) cvIdx.add(X(c[i - 1][0]), Y(c[i - 1][1]), X(c[i][0]), Y(c[i][1]), tramos.length - 1);
  });
  for (const e of kept) {
    if (offRoad(e.w)) continue;
    let hit = 0, n = 0, tramo = -1;
    for (let k = 1; k < e.nodes.length; k++) {
      const a = e.nodes[k - 1], b = e.nodes[k], dx = nx[b] - nx[a], dy = ny[b] - ny[a], l = Math.hypot(dx, dy);
      const steps = Math.max(1, Math.round(l / 15));
      for (let q = 0; q < steps; q++) {
        const t = (q + 0.5) / steps, px = nx[a] + dx * t, py = ny[a] + dy * t;
        n++;
        const s = cvIdx.near(px, py, 22).find(s => parallel(s, dx, dy) >= 0.85 && segDist(px, py, s.ax, s.ay, s.bx, s.by) < 22);
        if (s) { hit++; tramo = s.data; }
      }
    }
    e.cv = hit * 2 >= n && n ? tramo : -1;
  }

  // --- places closed to some vehicles (data/bike-rules.json) ---
  const closedIdx = segIndex(60);
  (rules.closed || []).forEach((c, ci) => {
    for (let i = 1; i < c.line.length; i++) closedIdx.add(X(c.line[i - 1][1]), Y(c.line[i - 1][0]), X(c.line[i][1]), Y(c.line[i][0]), ci);
  });
  for (const e of kept) {
    e.closed = -1;
    if (!(rules.closed || []).length) continue;
    const a = e.nodes[0], b = e.nodes[e.nodes.length - 1], mxp = (nx[a] + nx[b]) / 2, myp = (ny[a] + ny[b]) / 2, dx = nx[b] - nx[a], dy = ny[b] - ny[a];
    const s = closedIdx.near(mxp, myp, 15).find(s => parallel(s, dx, dy) >= 0.85 && segDist(mxp, myp, s.ax, s.ay, s.bx, s.by) < 15);
    if (s) e.closed = s.data;
  }

  // --- each edge in its legal direction, then chains without a crossing joined into one edge ---
  for (const e of kept) {
    let flags = e.flags;
    if (e.w.car) flags |= F.ow;
    if (e.w.bike) flags |= F.owBike;
    // Bike one-way may disagree with the car one: a contraflow lane (car one way, bike both) or the opposite.
    if (e.w.car !== 0 && e.w.bike === 0) flags &= ~F.owBike;
    if (e.w.car === 0 && e.w.bike !== 0) flags &= ~F.ow;
    flags |= (e.w.cls << CLS_SHIFT) | (e.inf << INF_SHIFT) | (Math.min(15, Math.round(e.w.max / 10)) << MAX_SHIFT);
    e.f = flags;
    // "-1": the way runs against its drawing.
    if (e.w.car === -1 || (e.w.car === 0 && e.w.bike === -1)) { [e.a, e.b] = [e.b, e.a]; e.nodes = e.nodes.slice().reverse(); }
  }
  const inc = new Map();
  const touch = (v, i) => { let x = inc.get(v); if (!x) inc.set(v, x = new Set()); x.add(i); };
  kept.forEach((e, i) => { touch(e.a, i); touch(e.b, i); });
  const keyOf = e => [e.f, e.name, e.cv, e.closed].join('|');
  const flip = e => { [e.a, e.b] = [e.b, e.a]; e.nodes = e.nodes.slice().reverse(); };
  let merged = 0;
  for (const [v, set] of inc) {
    if (set.size !== 2) continue;
    let [i, j] = [...set];
    let P = kept[i], Q = kept[j];
    if (P === Q || P.dead || Q.dead || keyOf(P) !== keyOf(Q)) continue;
    const oneway = P.f & (F.ow | F.owBike);
    if (P.b !== v) { if (Q.b === v && P.a === v) { [P, Q] = [Q, P]; [i, j] = [j, i]; } else if (!oneway) flip(P); else continue; }
    if (Q.a !== v) { if (oneway) continue; flip(Q); }
    if (P.b !== v || Q.a !== v || P.a === Q.b) continue;
    P.nodes = P.nodes.concat(Q.nodes.slice(1)); P.len += Q.len; P.b = Q.b; Q.dead = true; merged++;
    inc.get(v).clear();
    const far = inc.get(Q.b); far.delete(j); far.add(i);
  }
  const live = kept.filter(e => !e.dead);
  console.log(`Tramos unidos donde no hay cruce: ${merged}; quedan ${live.length}`);
  kept.length = 0; for (const e of live) kept.push(e);

  // --- pack ---
  // Vertices in a spatial order, so neighbors have small differences and the file compresses well.
  const used = new Set(); for (const e of kept) { used.add(e.a); used.add(e.b); }
  const order = [...used].sort((p, q) => {
    const cp = Math.floor(ny[vNode[p]] / 400) * 1000 + Math.floor(nx[vNode[p]] / 400), cq = Math.floor(ny[vNode[q]] / 400) * 1000 + Math.floor(nx[vNode[q]] / 400);
    return cp - cq || nx[vNode[p]] - nx[vNode[q]];
  });
  const newId = new Map(order.map((v, i) => [v, i]));
  const E5 = v => Math.round(v * 1e5);
  const v = [];
  let pl = 0, po = 0;
  for (const old of order) { const n = vNode[old], la = E5(nLat[n]), lo = E5(nLon[n]); v.push(la - pl, lo - po); pl = la; po = lo; }
  kept.forEach(e => { e.A = newId.get(e.a); e.B = newId.get(e.b); });
  kept.sort((p, q) => p.A - q.A || p.B - q.B);
  const names = [], nameId = new Map();
  const nameOf = s => { if (!s) return 0; if (!nameId.has(s)) { nameId.set(s, names.length + 1); names.push(s); } return nameId.get(s); };
  const ed = [], geo = [], cvList = [], closedList = [];
  let lastA = 0;
  kept.forEach((e, idx) => {
    // Shape without the two ends, simplified to 2.5 m.
    const shape = simplify(e.nodes.map(n => [nx[n], ny[n], n]), 2.5).slice(1, -1);
    const A = e.A, B = e.B;
    // A grows slowly (edges are sorted by it) and B is near A: both as differences.
    ed.push(A - lastA, B - A, Math.max(1, Math.round(e.len * 10)), e.f, nameOf(e.name), shape.length);
    lastA = A;
    let la = E5(nLat[vNode[order[A]]]), lo = E5(nLon[vNode[order[A]]]);
    for (const p of shape) { const pla = E5(nLat[p[2]]), plo = E5(nLon[p[2]]); geo.push(pla - la, plo - lo); la = pla; lo = plo; }
    if (e.cv >= 0) cvList.push(idx, e.cv);
    if (e.closed >= 0) closedList.push(idx, e.closed);
  });
  const parking = JSON.parse(parkingText).features.filter(f => f.geometry).map(f => ({ name: String(f.properties.CEXNOMBRE || '').trim(), cap: f.properties.CEXCAPACID || 0, hours: String(f.properties.CEXHORARIO || '').trim(), lat: +f.geometry.coordinates[1].toFixed(6), lon: +f.geometry.coordinates[0].toFixed(6) }));

  // --- numbers to check the result ---
  const km = (pred) => kept.reduce((s, e) => s + (pred(e) ? e.len : 0), 0) / 1000;
  const stats = {
    vertices: order.length, edges: kept.length,
    kmBike: +km(e => e.flags & F.bike).toFixed(0),
    kmInfra: +km(e => e.inf && (e.flags & F.bike)).toFixed(0),
    kmCiclorruta: +km(e => e.inf === INF.ciclorruta).toFixed(0),
    kmOfficial: +km(e => e.flags & F.official).toFixed(0),
    kmMoto: +km(e => e.flags & F.moto).toFixed(0),
    kmCiclovia: +km(e => e.cv >= 0).toFixed(0),
    iduKm: +(iduLen / 1000).toFixed(0), iduCoveredPct: +(100 * covered / iduLen).toFixed(1), sideKm: +(sideLen / 1000).toFixed(1),
  };
  console.log(stats);
  const today = new Date().toISOString().slice(0, 10);
  return {
    meta: { built: today, sources: { osm: today, idu: 'Red Biciusuarios IDU (IDECA)', ciclovia: 'IDRD', parking: 'IDECA' }, stats, version: 1 },
    rules,
    codes: { F, CLS, INF, CLS_SHIFT, INF_SHIFT, MAX_SHIFT },
    v, e: ed, g: geo, names, cv: cvList, tramos, closed: closedList, parking,
  };
}

if (require.main === module) (async () => {
  const args = process.argv.slice(2);
  const ci = args.indexOf('--cache'), cacheDir = ci >= 0 ? path.resolve(args[ci + 1]) : null;
  const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'bike-rules.json'), 'utf8'));
  const [osm, red, ciclovia, parking] = [
    await source(cacheDir, 'osm.json', overpass),
    await source(cacheDir, 'red.geojson', () => arcgis(IDU_RED).then(JSON.stringify)),
    await source(cacheDir, 'ciclovia.geojson', () => arcgis(CICLOVIA).then(JSON.stringify)),
    await source(cacheDir, 'parking.geojson', () => arcgis(PARKING).then(JSON.stringify)),
  ];
  const out = build(osm, red, ciclovia, parking, rules);
  // Sanity: a map that lost most of the bike network must not replace the good one.
  if (out.meta.stats.kmInfra < 400 || out.meta.stats.edges < 100000) throw new Error('La red quedó demasiado pequeña: ' + JSON.stringify(out.meta.stats));
  const text = JSON.stringify(out);
  fs.writeFileSync(path.join(ROOT, 'data', 'bike.json'), text);
  console.log(`data/bike.json ${(text.length / 1048576).toFixed(2)} MB`);
})().catch(e => { console.error(e.message); process.exit(1); });

module.exports = { classify, build, CLS, INF, F };
