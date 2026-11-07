// Packs the raw GTFS into data/network.json (routes) and data/shapes.json (street geometry) for the phone app.
// usage: node --max-old-space-size=6000 build-data.js <gtfs-dir> <feed-date YYYY-MM-DD> [--out <dir>] [--force]
//   --out    writes somewhere else, for trying a feed without touching the app's data
//   --force  accepts a feed the safety check rejects, when the drop is known to be real
// Full timetables do not fit on a phone, so each stop pattern keeps: a median travel-time profile,
// buses per hour by day type, a run-time factor by hour, and the first and last departure.
const fs = require('fs'), path = require('path');
const { ingest, table, hms } = require('./ingest');
const { dist, loadShapes, walkAlong, simplifyIndex, feedProblems, B62 } = require('./shape-tools');
const HOURS = 27, MIN_TRIPS = 2, SAMPLE = 60, SHAPE_TOLERANCE_M = 15, LOOP_M = 400;
const median = a => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
const clean = s => s.replace(/\s+/g, ' ').trim();
const words = s => clean(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
const args = process.argv.slice(2);

(async () => {
  const [dir, feedDate] = args;
  const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(__dirname, '..', 'data');
  const d = await ingest(dir);
  const routeOf = new Map(d.routes.map(r => [r.route_id, r]));
  // Day types come from calendar.txt: 0 weekday, 1 saturday, 2 sunday or holiday. A service may run on several.
  const calendar = table(dir, 'calendar.txt'), daysOf = new Map(), sundayOnly = new Set();
  for (const c of calendar) {
    const days = [];
    if (['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].some(k => c[k] === '1')) days.push(0);
    if (c.saturday === '1') days.push(1);
    if (c.sunday === '1') days.push(2);
    daysOf.set(c.service_id, days);
    if (days.length === 1 && days[0] === 2) sundayOnly.add(c.service_id);
  }
  const freqByTrip = new Map();
  for (const f of d.freqs) (freqByTrip.get(f.trip_id) || freqByTrip.set(f.trip_id, []).get(f.trip_id)).push(f);

  const pats = new Map();
  d.eachTrip((t, raw) => {
    const tr = d.trips[t], days = daysOf.get(tr.service_id);
    if (!days || !days.length) return;
    const idx = raw.filter((v, i) => !i || d.S[v] !== d.S[raw[i - 1]]);
    if (idx.length < 2) return;
    const key = tr.route_id + '|' + idx.map(i => d.S[i]).join(',');
    let p = pats.get(key);
    if (!p) {
      p = { route: tr.route_id, stops: idx.map(i => d.S[i]), segs: [], signSeqs: new Map(), shapeIds: new Map(), n: 0,
        cnt: [0, 1, 2].map(() => new Array(HOURS).fill(0)), durs: [0, 1, 2].map(() => Array.from({ length: HOURS }, () => [])), first: [1e9, 1e9, 1e9], last: [-1, -1, -1] };
      pats.set(key, p);
    }
    p.n++;
    const seq = idx.map(i => d.H[i]).join(',');
    p.signSeqs.set(seq, (p.signSeqs.get(seq) || 0) + 1);
    p.shapeIds.set(tr.shape_id, (p.shapeIds.get(tr.shape_id) || 0) + 1);
    if (p.segs.length < SAMPLE) p.segs.push(idx.slice(1).map((v, i) => d.A[v] - d.A[idx[i]]));
    const fq = freqByTrip.get(tr.trip_id);
    const a0 = d.A[idx[0]], dur = d.A[idx[idx.length - 1]] - a0;
    for (const day of days) {
      if (fq) {
        // Frequency-based trips (TransMiCable): expand the service window into hourly counts.
        for (const f of fq) {
          const s = hms(f.start_time), e = hms(f.end_time), perH = Math.round(3600 / +f.headway_secs);
          for (let h = Math.floor(s / 3600); h < HOURS && h * 3600 < e; h++) { p.cnt[day][h] = Math.min(61, Math.max(p.cnt[day][h], perH)); p.durs[day][h].push(dur); }
          p.first[day] = Math.min(p.first[day], s); p.last[day] = Math.max(p.last[day], e);
        }
      } else {
        const h = Math.min(HOURS - 1, Math.floor(a0 / 3600));
        p.cnt[day][h]++; p.durs[day][h].push(dur);
        p.first[day] = Math.min(p.first[day], a0); p.last[day] = Math.max(p.last[day], a0);
      }
    }
  });

  // A variant with a single trip adds noise, unless it is all the route has: then it stays, so no route goes missing.
  const regular = new Set(); for (const p of pats.values()) if (p.n >= MIN_TRIPS) regular.add(p.route);
  const kept = [...pats.values()].filter(p => p.n >= MIN_TRIPS || !regular.has(p.route));
  const used = new Set(); kept.forEach(p => p.stops.forEach(s => used.add(s)));
  const idOf = new Map(d.stops.map((s, i) => [s.stop_id, i]));
  d.stops.forEach((s, i) => { if (s.location_type === '1') used.add(i); });
  [...used].forEach(i => { const par = d.stops[i].parent_station; if (par && idOf.has(par)) used.add(idOf.get(par)); });
  const list = [...used].sort((a, b) => a - b), remap = new Map(list.map((v, i) => [v, i]));

  const stops = { n: [], a: [], o: [], p: [], k: [] };
  for (const i of list) {
    const s = d.stops[i], par = s.parent_station && idOf.has(s.parent_station) ? remap.get(idOf.get(s.parent_station)) : -1;
    stops.n.push(clean(s.stop_name));
    stops.a.push(Math.round(+s.stop_lat * 1e5)); stops.o.push(Math.round(+s.stop_lon * 1e5));
    stops.p.push(par); stops.k.push(s.location_type === '1' ? 1 : 0);
  }

  const routesUsed = [...new Set(kept.map(p => p.route))], rIdx = new Map(routesUsed.map((r, i) => [r, i]));
  const routes = routesUsed.map(id => { const r = routeOf.get(id); return [clean(r.route_short_name), clean(r.route_long_name), r.route_color, r.route_text_color, +r.agency_id]; });

  const coord = i => [+d.stops[i].stop_lat, +d.stops[i].stop_lon];
  const stationName = i => { const par = d.stops[i].parent_station; return clean(par && idOf.has(par) ? d.stops[idOf.get(par)].stop_name : d.stops[i].stop_name); };

  // What the rider reads on the bus. On a round trip one file trip covers both ways and the sign changes halfway
  // (A153 Centro, then C153 Suba), so each stretch of the pattern gets its own code and destination.
  function signsOf(p) {
    const route = routeOf.get(p.route), long = clean(route.route_long_name), parts = long.split('||').map(clean);
    const seq = [...p.signSeqs.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(x => d.signs[+x]);
    const runs = [];
    seq.forEach((code, pos) => { if (!runs.length || runs[runs.length - 1].code !== code) runs.push({ from: pos, code }); });
    const named = code => parts.filter(x => x.toLowerCase().startsWith(code.toLowerCase() + ' ')).map(x => clean(x.slice(code.length)));
    const fits = (name, stop) => { const w = new Set(words(stationName(stop))); return words(name).some(x => w.has(x)); };
    const dest = (code, start, end) => {
      const options = named(code);
      if (options.length === 1) return options[0];
      if (options.length > 1) {
        // The same code both ways, "H632 Villa Gloria || H632 General Santander": the name that fits where this bus ends.
        const tail = p.stops.slice(Math.max(start, end - 2), end + 1), hit = options.find(n => tail.some(s => fits(n, s)));
        if (hit) return hit;
        const notStart = options.filter(n => !fits(n, p.stops[start]));
        return notStart.length === 1 ? notStart[0] : stationName(p.stops[end]);
      }
      return parts.length === 1 && long ? long : stationName(p.stops[end]);
    };
    const signs = runs.map((r, i) => { const end = i + 1 < runs.length ? runs[i + 1].from - 1 : p.stops.length - 1; return { from: r.from, code: clean(r.code || route.route_short_name), dest: dest(r.code, r.from, end) }; });
    // One code and a round trip, like a feeder named "Kennedy Central || Banderas": out to one place, back to the other.
    const [a, b] = [coord(p.stops[0]), coord(p.stops[p.stops.length - 1])], code0 = signs[0].code;
    const bare = x => x.replace(/^[A-Z]{0,2}\d+[-A-Z0-9]*\s+/, '');
    const two = parts.length === 2 ? parts.map(bare) : null;
    if (signs.length === 1 && two && dist(a[0], a[1], b[0], b[1]) < LOOP_M) {
      let far = 0, farM = -1;
      p.stops.forEach((s, i) => { const c = coord(s), m = dist(a[0], a[1], c[0], c[1]); if (m > farM) { farM = m; far = i; } });
      const lastStop = p.stops[p.stops.length - 1], turn = p.stops.slice(Math.max(0, far - 2), far + 3);
      let back = two.findIndex(n => fits(n, lastStop));
      if (back < 0) { const out = two.findIndex(n => turn.some(s => fits(n, s))); if (out >= 0) back = 1 - out; }
      if (back < 0) signs[0].dest = two.join(' – ');
      else {
        signs[0].dest = two[1 - back];
        if (far > 0 && far < p.stops.length - 1) signs.push({ from: far, code: code0, dest: two[back] });
      }
    }
    return signs;
  }

  const patterns = kept.map(p => {
    const nSeg = p.stops.length - 1, seg = new Array(nSeg);
    for (let i = 0; i < nSeg; i++) seg[i] = median(p.segs.map(a => a[i]));
    const base = seg.reduce((x, y) => x + y, 0) || 1;
    const signs = signsOf(p);
    const counts = p.cnt.map(a => a.map(c => B62[Math.min(61, c)]).join(''));
    // Run-time factor per hour: code / 40 × base duration, so 40 means "same as the median profile".
    const factors = p.durs.map(a => a.map(l => l.length ? B62[Math.max(1, Math.min(61, Math.round(median(l) / base * 40)))] : '0').join(''));
    const out = {
      r: rIdx.get(p.route), c: signs[0].code, d: signs[0].dest, s: p.stops.map(s => remap.get(s)),
      t: seg.map(x => Math.round(x / 10)), h: counts, m: factors,
      f: p.first.map(v => v === 1e9 ? -1 : Math.round(v / 60)), l: p.last.map(v => v < 0 ? -1 : Math.round(v / 60)),
    };
    if (signs.length > 1) out.x = signs.slice(1).map(s => [s.from, s.code, s.dest]);
    return out;
  });

  const holidays = [...new Set(table(dir, 'calendar_dates.txt').filter(c => sundayOnly.has(c.service_id) && c.exception_type === '1').map(c => c.date))];
  const info = table(dir, 'feed_info.txt')[0] || {}, endRaw = info.feed_end_date || '';
  const end = endRaw.length === 8 ? `${endRaw.slice(0, 4)}-${endRaw.slice(4, 6)}-${endRaw.slice(6)}` : null;
  // A feed this small means something broke upstream: stop here rather than publish it.
  if (kept.length < 800 || stops.n.length < 5000) throw new Error(`Feed looks incomplete: ${kept.length} patterns, ${stops.n.length} stops`);
  // The official file states the fare, so a price change arrives with the daily update.
  const fares = table(dir, 'fare_attributes.txt').map(f => Math.round(+f.price)).filter(Boolean);
  const fare = fares.length ? Math.max(...fares) : null;
  // What makes an update worth downloading at once: a route code that appears or goes, or a station that gains or loses
  // service. Day to day the file mostly changes timetables, which can wait a few days on a prepaid phone.
  const servedStations = [...new Set(kept.flatMap(p => p.stops.map(s => d.stops[s].parent_station).filter(Boolean)))].sort();
  const sig = require('crypto').createHash('sha1').update(JSON.stringify([[...new Set(routes.map(r => r[0]))].sort(), servedStations])).digest('hex').slice(0, 12);
  const net = { meta: { feed: feedDate, end, fare, trips: kept.reduce((s, p) => s + p.n, 0), sig }, stops, routes, patterns, holidays };

  // The safety check compares against what riders have now, and nothing is written if the new file falls short.
  const currentFile = path.join(__dirname, '..', 'data', 'network.json');
  const current = fs.existsSync(currentFile) ? JSON.parse(fs.readFileSync(currentFile, 'utf8')) : null;
  const problems = feedProblems(net, current);
  if (problems.length) {
    console.error(`El archivo del ${feedDate} no pasa la revisión:\n - ${problems.join('\n - ')}`);
    if (!args.includes('--force')) { console.error('Se conservan las rutas actuales.'); process.exit(2); }
    console.error('Se acepta igual por --force.');
  }

  // Street geometry, one line per shape, with each stop's place on its line. The app loads this only when a map opens.
  const shapes = loadShapes(table, dir), lines = [], lineOf = new Map();
  const pats2 = kept.map(p => {
    const id = [...p.shapeIds.entries()].sort((a, b) => b[1] - a[1])[0][0], shape = shapes.get(id);
    if (!shape || shape.pts.length < 2) return null;
    let line = lineOf.get(id);
    if (!line) {
      const keep = simplifyIndex(shape.pts, SHAPE_TOLERANCE_M), flat = [];
      let pa = 0, po = 0;
      for (const i of keep) { const a = Math.round(shape.pts[i][0] * 1e5), o = Math.round(shape.pts[i][1] * 1e5); flat.push(a - pa, o - po); pa = a; po = o; }
      line = { index: lines.length, keep };
      lines.push(flat); lineOf.set(id, line);
    }
    // For each stop, the last kept point before it. Delta coded, since it only moves forward.
    const along = walkAlong(shape, p.stops.map(coord)), at = [];
    let k = 0, prev = 0;
    for (const x of along) { while (k + 1 < line.keep.length && line.keep[k + 1] <= x.seg) k++; at.push(k - prev); prev = k; }
    return [line.index, at];
  });

  fs.mkdirSync(outDir, { recursive: true });
  const json = JSON.stringify(net), shapeJson = JSON.stringify({ feed: feedDate, lines, pats: pats2 });
  fs.writeFileSync(path.join(outDir, 'network.json'), json);
  fs.writeFileSync(path.join(outDir, 'shapes.json'), shapeJson);
  const gz = s => +(require('zlib').gzipSync(s).length / 1048576).toFixed(2);
  console.log({ patterns: patterns.length, stops: stops.n.length, routes: routes.length, holidays: holidays.length, trips: net.meta.trips, MB: +(json.length / 1048576).toFixed(2), gzipMB: gz(json), signChanges: patterns.filter(p => p.x).length, shapeLines: lines.length, shapesMB: +(shapeJson.length / 1048576).toFixed(2), shapesGzipMB: gz(shapeJson) });
  console.log('code samples', patterns.filter((_, i) => i % 160 === 0).map(p => `${p.c} -> ${p.d} [${routes[p.r][0]}] ${p.s.length} stops`));
})().catch(e => { console.error(e); process.exit(1); });
