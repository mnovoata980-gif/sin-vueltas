// Builds data/grid.json: every corner where a numbered calle (or diagonal) meets a numbered carrera (or transversal)
// in Bogotá, from OpenStreetMap. The app uses it to place "Calle 72 # 10-20" by the city's own address logic,
// which works even where the map has no house numbers, and without internet.
//
//   node tools/build-grid.js            download the streets (about a minute) and build
//   node tools/build-grid.js ways.json  build from a file saved before
//   --save <file>                       keep the download
//
// Streets change slowly, so this runs by hand now and then, not every day.
const fs = require('fs'), path = require('path');
const Geo = require('../js/geo.js');

const OVERPASS = 'https://overpass-api.de/api/interpreter';
// "Bogotá ciudad": the urban area with its 20 localidades. Soacha has its own numbering and stays out.
const AREA = 3607426387;
const QUERY = `[out:json][timeout:300];area(id:${AREA})->.a;
way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|pedestrian|footway|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|track|road)$"]["name"](area.a);
convert w ::id=id(),name=t["name"],alt=t["alt_name"],off=t["official_name"],old=t["old_name"],::geom=geom();out geom;`;

async function download() {
  const r = await fetch(OVERPASS, { method: 'POST', headers: { 'User-Agent': 'SinVueltas-build/1.0', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(QUERY) });
  if (!r.ok) throw new Error('Overpass ' + r.status);
  return r.text();
}

function build(json) {
  const ways = JSON.parse(json).elements || [];
  // Every point of a numbered street, keyed by its exact coordinates: two streets meet where they share a point.
  const at = new Map();
  let named = 0;
  for (const w of ways) {
    const t = w.tags || {};
    const s = [t.name, t.off, t.alt].filter(Boolean).flatMap(n => n.split(';')).map(Geo.parseStreet).find(Boolean);
    if (!s || !w.geometry || !w.geometry.coordinates) continue;
    named++;
    for (const [lon, lat] of w.geometry.coordinates) {
      const k = lon.toFixed(7) + ',' + lat.toFixed(7);
      let e = at.get(k);
      if (!e) at.set(k, e = { lat, lon, cl: new Set(), kr: new Set() });
      e[s.axis].add(+s.value.toFixed(2));
    }
  }
  // One corner per calle and carrera pair. Divided roads meet several times a few meters apart: those are averaged.
  // The same pair far apart (a street that bends back) stays as separate corners.
  const pairs = new Map();
  for (const e of at.values()) {
    if (!e.cl.size || !e.kr.size) continue;
    for (const cl of e.cl) for (const kr of e.kr) {
      const k = cl + '|' + kr;
      if (!pairs.has(k)) pairs.set(k, []);
      const groups = pairs.get(k);
      const g = groups.find(g => Math.hypot((g.lat / g.n - e.lat) * 110574, (g.lon / g.n - e.lon) * 110950) < 120);
      if (g) { g.lat += e.lat; g.lon += e.lon; g.n++; } else groups.push({ cl, kr, lat: e.lat, lon: e.lon, n: 1 });
    }
  }
  let list = [...pairs.values()].flat().map(g => ({ cl: g.cl, kr: g.kr, lat: g.lat / g.n, lon: g.lon / g.n }));
  const before = list.length;
  list = dropMislabeled(list);
  const out = { cl: [], kr: [], lat: [], lon: [] };
  list.sort((a, b) => a.cl - b.cl || a.kr - b.kr);
  for (const g of list) { out.cl.push(g.cl); out.kr.push(g.kr); out.lat.push(+g.lat.toFixed(5)); out.lon.push(+g.lon.toFixed(5)); }
  return { out, named, ways: ways.length, dropped: before - list.length };
}

// Some streets in the map lack their "Sur" or carry another street's number, which puts a corner of the south
// in the middle of the north. A real corner sits where its neighbors in the grid say it should; one that
// disagrees with most of them is dropped. Repeated until nothing changes, since a bad corner also misleads others.
function dropMislabeled(list) {
  const dist = (a, b) => Math.hypot((a.lat - b.lat) * 110574, (a.lon - b.lon) * 110950);
  for (let round = 0; round < 6; round++) {
    const buckets = new Map();
    list.forEach((g, i) => { const k = Math.floor(g.cl); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(i); });
    const bad = new Set();
    list.forEach((g, i) => {
      let agree = 0, total = 0;
      for (let k = Math.floor(g.cl) - 2; k <= Math.floor(g.cl) + 2; k++) for (const j of buckets.get(k) || []) {
        if (j === i) continue;
        const o = list[j], gd = Math.hypot(o.cl - g.cl, o.kr - g.kr);
        if (gd > 2 || gd < 0.01) continue;
        total++;
        // A block is rarely over 250 m; leave room for the long ones.
        if (dist(g, o) < 150 + gd * 300) agree++;
      }
      if (total >= 3 && agree / total < 0.4) bad.add(i);
    });
    if (!bad.size) break;
    list = list.filter((g, i) => !bad.has(i));
  }
  return list;
}

(async () => {
  const args = process.argv.slice(2), save = args.indexOf('--save');
  const file = args.find((a, i) => !a.startsWith('--') && i !== save + 1);
  const t0 = Date.now();
  const json = file ? fs.readFileSync(file, 'utf8') : await download();
  if (save >= 0) fs.writeFileSync(args[save + 1], json);
  const { out, named, ways, dropped } = build(json);
  // A bad download must not replace a good table.
  if (out.cl.length < 20000) { console.error(`Solo ${out.cl.length} esquinas: algo salió mal con la descarga. No se cambia data/grid.json.`); process.exit(1); }
  const doc = { meta: { source: 'OpenStreetMap (ODbL)', built: new Date().toISOString().slice(0, 10), corners: out.cl.length }, ...out };
  const dest = path.join(__dirname, '..', 'data', 'grid.json');
  fs.writeFileSync(dest, JSON.stringify(doc));
  console.log(`${ways} calles bajadas, ${named} con nomenclatura, ${out.cl.length} esquinas (${dropped} descartadas por no cuadrar con sus vecinas), ${(fs.statSync(dest).size / 1024).toFixed(0)} KB, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
})().catch(e => { console.error(e.message); process.exit(1); });
