// Audits data/network.json against the raw GTFS it was built from: every route, every stop, every shape.
// usage: node --max-old-space-size=6000 tools/audit-routes.js <gtfs-dir> [--out report.json] [--map map.json] [--engine] [--strict]
//   --engine  rides every pattern through the routing engine (several minutes)
//   --strict  exits non-zero on a critical finding, so a bad feed does not reach the riders
// Critical means the app would mislead someone: a route lost, data that differs from the file, or a stop placed outside the city.
// Everything else is a warning, because the official file itself has many rough edges that are not ours to fix.
const fs = require('fs'), path = require('path');
const { ingest, table } = require('./ingest');
const { dist, segDist, loadShapes, walkAlong, simplifyIndex, tripsByDay } = require('./shape-tools');

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const has = n => args.includes(n);
const dir = args[0];
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
// All of Bogotá's jurisdiction, with rural Sumapaz far to the south, plus Soacha, Funza, Mosquera, Cota, Chía and La Calera.
const BOX = { latMin: 3.70, latMax: 4.95, lonMin: -74.60, lonMax: -73.85 };
const inBox = (a, o) => a >= BOX.latMin && a <= BOX.latMax && o >= BOX.lonMin && o <= BOX.lonMax;
const MIN_TRIPS = 2; // same rule as build-data.js

(async () => {
  const t0 = Date.now();
  const d = await ingest(dir);
  const net = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'network.json'), 'utf8'));
  const routeOf = new Map(d.routes.map(r => [r.route_id, r]));
  const stopAt = i => d.stops[i], idOf = new Map(d.stops.map((s, i) => [s.stop_id, i]));
  const calendar = table(dir, 'calendar.txt'), calDates = table(dir, 'calendar_dates.txt'), info = table(dir, 'feed_info.txt')[0] || {};
  const daysOf = new Map();
  for (const c of calendar) {
    const days = [];
    if (['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].some(k => c[k] === '1')) days.push(0);
    if (c.saturday === '1') days.push(1);
    if (c.sunday === '1') days.push(2);
    daysOf.set(c.service_id, days);
  }
  const critical = [], warnings = [], note = (list, code, text, items) => list.push({ code, text, count: items ? items.length : undefined, items: items ? items.slice(0, 200) : undefined });

  // ---------- shapes ----------
  const shapes = loadShapes(table, dir);

  // ---------- rebuild the patterns exactly as build-data.js does ----------
  const pats = new Map();
  let tripsSeen = 0, tripsNoDays = 0, negativeTrips = 0, zeroLegs = 0, totalLegs = 0;
  const tripsWithRows = new Set();
  d.eachTrip((t, raw) => {
    tripsWithRows.add(t);
    const tr = d.trips[t], days = daysOf.get(tr.service_id);
    if (!days || !days.length) { tripsNoDays++; return; }
    const idx = raw.filter((v, i) => !i || d.S[v] !== d.S[raw[i - 1]]);
    if (idx.length < 2) return;
    tripsSeen++;
    const key = tr.route_id + '|' + idx.map(i => d.S[i]).join(',');
    let p = pats.get(key);
    if (!p) { p = { key, route: tr.route_id, stops: idx.map(i => d.S[i]), n: 0, shapes: {}, signs: new Set(), firstSigns: {}, days: new Set(), first: 1e9, last: -1, dur: [], backwards: 0 }; pats.set(key, p); }
    p.n++;
    p.shapes[tr.shape_id] = (p.shapes[tr.shape_id] || 0) + 1;
    idx.forEach(i => p.signs.add(d.signs[d.H[i]]));
    const fs0 = d.signs[d.H[idx[0]]]; p.firstSigns[fs0] = (p.firstSigns[fs0] || 0) + 1;
    days.forEach(x => p.days.add(x));
    p.first = Math.min(p.first, d.A[idx[0]]); p.last = Math.max(p.last, d.A[idx[0]]);
    if (!p.seq) p.seq = idx.map(i => clean(d.signs[d.H[i]]));
    if (p.dur.length < 40) p.dur.push(d.A[idx[idx.length - 1]] - d.A[idx[0]]);
    let back = false;
    for (let i = 1; i < idx.length; i++) { const g = d.A[idx[i]] - d.A[idx[i - 1]]; totalLegs++; if (g < 0) back = true; if (g === 0) zeroLegs++; }
    if (back) { p.backwards++; negativeTrips++; }
  });
  const all = [...pats.values()], regular = new Set(all.filter(p => p.n >= MIN_TRIPS).map(p => p.route));
  const isKept = p => p.n >= MIN_TRIPS || !regular.has(p.route), kept = all.filter(isKept), dropped = all.filter(p => !isKept(p));

  // ---------- 1. is every route in the app? ----------
  const netRoutes = new Set(), keptByRoute = new Map(), allByRoute = new Map();
  kept.forEach(p => { netRoutes.add(p.route); (keptByRoute.get(p.route) || keptByRoute.set(p.route, []).get(p.route)).push(p); });
  all.forEach(p => (allByRoute.get(p.route) || allByRoute.set(p.route, []).get(p.route)).push(p));
  const tripsPerRoute = new Map(); d.trips.forEach(t => tripsPerRoute.set(t.route_id, (tripsPerRoute.get(t.route_id) || 0) + 1));
  const lost = d.routes.filter(r => !netRoutes.has(r.route_id)).map(r => ({ id: r.route_id, code: clean(r.route_short_name), name: clean(r.route_long_name), agency: r.agency_id, trips: tripsPerRoute.get(r.route_id) || 0, patterns: (allByRoute.get(r.route_id) || []).length, why: !tripsPerRoute.get(r.route_id) ? 'sin viajes en el archivo' : (allByRoute.get(r.route_id) || []).length ? 'solo patrones con un viaje' : 'sin día de servicio o sin paradas' }));
  const lostWithTrips = lost.filter(x => x.trips > 0);
  if (lostWithTrips.length) note(critical, 'rutas-fuera', 'Rutas del archivo con viajes que la app no incluye', lostWithTrips);
  if (lost.length - lostWithTrips.length) note(warnings, 'rutas-sin-viajes', 'Rutas listadas en el archivo que no tienen ningún viaje', lost.filter(x => !x.trips));

  // Rare patterns are left out on purpose. What matters is whether they serve a stop the route otherwise never touches.
  const uncovered = [];
  for (const p of dropped) {
    const mine = keptByRoute.get(p.route) || [];
    if (!mine.length) continue;
    const known = new Set(mine.flatMap(x => x.stops)), missing = p.stops.filter(s => !known.has(s));
    if (missing.length) uncovered.push({ route: clean(routeOf.get(p.route).route_short_name), trips: p.n, missing: missing.length, sample: missing.slice(0, 3).map(s => clean(stopAt(s).stop_name)) });
  }
  if (uncovered.length) note(warnings, 'variantes-raras', 'Variantes de un solo viaje con paradas que el resto de la ruta no toca', uncovered);

  // ---------- 2. does the packed file match the raw one, stop by stop? ----------
  const mismatches = [];
  if (net.patterns.length !== kept.length) mismatches.push({ what: 'cantidad de patrones', app: net.patterns.length, archivo: kept.length });
  const netStop = i => ({ name: net.stops.n[i], a: net.stops.a[i], o: net.stops.o[i] });
  kept.forEach((p, i) => {
    const q = net.patterns[i];
    if (!q) return;
    const label = clean(routeOf.get(p.route).route_short_name);
    if (net.routes[q.r][0] !== label) mismatches.push({ pattern: i, what: 'ruta distinta', app: net.routes[q.r][0], archivo: label });
    if (q.s.length !== p.stops.length) { mismatches.push({ pattern: i, route: label, what: 'cantidad de paradas', app: q.s.length, archivo: p.stops.length }); return; }
    p.stops.forEach((s, j) => {
      const raw = stopAt(s), got = netStop(q.s[j]);
      if (got.name !== clean(raw.stop_name) || got.a !== Math.round(+raw.stop_lat * 1e5) || got.o !== Math.round(+raw.stop_lon * 1e5)) mismatches.push({ pattern: i, route: label, what: `parada ${j + 1}`, app: got.name, archivo: clean(raw.stop_name) });
    });
  });
  if (mismatches.length) note(critical, 'datos-distintos', 'La app no coincide con el archivo oficial', mismatches);

  // ---------- 3. where are the stops? ----------
  const usedStops = new Set(kept.flatMap(p => p.stops));
  const badPlace = [], noName = [], farFromParent = [];
  for (const i of usedStops) {
    const s = stopAt(i), a = +s.stop_lat, o = +s.stop_lon;
    if (!inBox(a, o)) badPlace.push({ stop: clean(s.stop_name), id: s.stop_id, lat: a, lon: o, routes: [...new Set(kept.filter(p => p.stops.includes(i)).map(p => clean(routeOf.get(p.route).route_short_name)))].slice(0, 6) });
    if (!clean(s.stop_name)) noName.push({ id: s.stop_id });
    const par = s.parent_station && idOf.has(s.parent_station) ? stopAt(idOf.get(s.parent_station)) : null;
    if (s.parent_station && !par) farFromParent.push({ stop: clean(s.stop_name), id: s.stop_id, parent: s.parent_station, meters: null });
    if (par) { const m = dist(a, o, +par.stop_lat, +par.stop_lon); if (m > 400) farFromParent.push({ stop: clean(s.stop_name), id: s.stop_id, parent: clean(par.stop_name), meters: Math.round(m) }); }
  }
  if (badPlace.length) note(critical, 'parada-fuera', 'Paradas en uso fuera de Bogotá y sus alrededores', badPlace);
  if (noName.length) note(critical, 'parada-sin-nombre', 'Paradas en uso sin nombre', noName);
  if (farFromParent.length) note(warnings, 'plataforma-lejos', 'Plataformas a más de 400 m de su estación', farFromParent);

  // ---------- 4. does each route run along its own shape, in order? ----------
  const offShape = [], outOfOrder = [], noShape = [], gaps = [], speeds = [], jumps = [];
  let shortTurns = 0;
  const geo = kept.map(p => {
    const label = clean(routeOf.get(p.route).route_short_name);
    const shapeId = Object.entries(p.shapes).sort((a, b) => b[1] - a[1])[0][0], shape = shapes.get(shapeId);
    if (!shape || shape.pts.length < 2) { noShape.push({ route: label, shape: shapeId }); return null; }
    const along = walkAlong(shape, p.stops.map(s => [+stopAt(s).stop_lat, +stopAt(s).stop_lon])), first = stopAt(p.stops[0]), lastS = stopAt(p.stops[p.stops.length - 1]);
    along.forEach((x, j) => {
      if (x.d <= 120) return;
      // Far ahead of where it should be but close to an earlier part of the shape means the order is wrong, not the place.
      const s = stopAt(p.stops[j]), a = +s.stop_lat, o = +s.stop_lon;
      let anywhere = 1e9;
      for (let i = 0; i < shape.pts.length - 1; i++) anywhere = Math.min(anywhere, segDist(a, o, shape.pts[i][0], shape.pts[i][1], shape.pts[i + 1][0], shape.pts[i + 1][1]).d);
      (anywhere <= 120 ? outOfOrder : offShape).push({ route: label, stop: clean(s.stop_name), pos: j + 1, of: p.stops.length, meters: Math.round(anywhere <= 120 ? x.d : anywhere) });
    });
    // A cable car is a straight line between towers, so a long gap there is expected.
    if (routeOf.get(p.route).agency_id !== '7') for (let i = 1; i < shape.pts.length; i++) { const g = shape.cum[i] - shape.cum[i - 1]; if (g > 1500) gaps.push({ route: label, shape: shapeId, meters: Math.round(g) }); }
    // A short-turn variant shares the shape of the full route, so only the stretch it really runs counts.
    const km = (along[along.length - 1].at - along[0].at) / 1000;
    if (km < shape.length / 1000 - 0.5) shortTurns++;
    const durs = p.dur.slice().sort((a, b) => a - b), dur = durs[durs.length >> 1], kmh = dur > 0 ? km / (dur / 3600) : null;
    if (kmh !== null && km > 2 && (kmh > 70 || kmh < 4)) speeds.push({ route: label, km: +km.toFixed(1), min: Math.round(dur / 60), kmh: Math.round(kmh) });
    for (let j = 1; j < p.stops.length; j++) {
      const a = stopAt(p.stops[j - 1]), b = stopAt(p.stops[j]), m = dist(+a.stop_lat, +a.stop_lon, +b.stop_lat, +b.stop_lon);
      if (m > 6000) jumps.push({ route: label, from: clean(a.stop_name), to: clean(b.stop_name), km: +(m / 1000).toFixed(1) });
    }
    return { p, shape, shapeId, along, km, dur };
  });
  // Real bus speed in Bogotá stays well under these, so the check catches wrong times or a wrong shape.
  speeds.sort((a, b) => b.kmh - a.kmh);
  if (noShape.length) note(warnings, 'sin-trazado', 'Patrones sin trazado en el archivo', noShape);
  if (offShape.length) note(warnings, 'parada-lejos-del-trazado', 'Paradas a más de 120 m del trazado de su ruta', offShape);
  if (outOfOrder.length) note(warnings, 'parada-fuera-de-orden', 'Paradas cerca del trazado pero en un orden distinto', outOfOrder);
  if (gaps.length) note(warnings, 'trazado-con-salto', 'Trazados con un salto de más de 1,5 km', gaps);
  if (speeds.length) note(warnings, 'velocidad-rara', 'Rutas con velocidad media improbable', speeds);
  if (jumps.length) note(warnings, 'salto-entre-paradas', 'Paradas seguidas a más de 6 km en línea recta', jumps);

  // ---------- 5. what the rider reads: codes, destinations, times ----------
  const signsMissed = [], signWrong = [], destOff = [], noBack = [];
  let signPatterns = 0, signStops = 0;
  const words = s => clean(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !['portal', 'estacion', 'barrio', 'calle', 'carrera', 'sur', 'norte', 'las', 'los', 'del', 'san', 'avenida'].includes(w));
  kept.forEach((p, i) => {
    const q = net.patterns[i]; if (!q) return;
    if (q.x) signPatterns++;
    // Every code the bus shows in the file must be one the app can show too.
    const shown = new Set([q.c, ...(q.x || []).map(x => x[1])]), label = clean(routeOf.get(p.route).route_short_name);
    if ([...p.signs].some(s => s && !shown.has(clean(s)))) signsMissed.push({ route: label, file: [...p.signs], app: [...shown] });
    // Stop by stop, the code the app gives must be the one the file gives.
    p.seq.forEach((code, pos) => { let mine = q.c; for (const [from, c] of q.x || []) if (pos >= from) mine = c; signStops++; if (code && code !== mine) signWrong.push({ route: label, stop: clean(stopAt(p.stops[pos]).stop_name), pos, file: code, app: mine }); });
    // Compares the destination the app shows at the end of the trip with where the bus really ends.
    const last = stopAt(p.stops[p.stops.length - 1]), par = last.parent_station && idOf.has(last.parent_station) ? stopAt(idOf.get(last.parent_station)) : null;
    const lastDest = q.x ? q.x[q.x.length - 1][2] : q.d, terminal = clean(par ? par.stop_name : last.stop_name), a = words(lastDest), b = new Set(words(terminal));
    if (a.length && b.size && !a.some(w => b.has(w))) destOff.push({ code: q.x ? q.x[q.x.length - 1][1] : q.c, app: lastDest, terminal, stops: p.stops.length, name: clean(routeOf.get(p.route).route_long_name) });
  });
  if (signsMissed.length) note(critical, 'codigo-sin-mostrar', 'Códigos del archivo que la app no sabe mostrar', signsMissed);
  // A few trips of a pattern may differ from the most common one, so a small share is not a fault of the app.
  if (signWrong.length > signStops * 0.01) note(critical, 'codigo-equivocado', 'Paradas donde la app daría otro código', signWrong);
  else if (signWrong.length) note(warnings, 'codigo-minoritario', 'Paradas con un código distinto en algunos viajes', signWrong);
  if (destOff.length) note(warnings, 'destino-distinto', 'El nombre oficial de la ruta no se parece a su última parada', destOff);
  if (negativeTrips) note(warnings, 'tiempo-hacia-atras', `${negativeTrips} viajes con horas que retroceden`);

  // A one-way route is suspicious unless it is a loop or has a partner running the other way.
  const near = (i, j, m) => dist(+stopAt(i).stop_lat, +stopAt(i).stop_lon, +stopAt(j).stop_lat, +stopAt(j).stop_lon) < m;
  const family = code => (String(code).match(/\d+.*/) || [code])[0];
  const famIndex = new Map();
  kept.forEach((p, i) => { const k = family(net.patterns[i] ? net.patterns[i].c : ''); (famIndex.get(k) || famIndex.set(k, []).get(k)).push(p); });
  kept.forEach((p, i) => {
    const a = p.stops[0], b = p.stops[p.stops.length - 1];
    if (near(a, b, 800)) return; // loop
    const mates = famIndex.get(family(net.patterns[i] ? net.patterns[i].c : '')) || [];
    if (!mates.some(x => near(x.stops[0], b, 1500) && near(x.stops[x.stops.length - 1], a, 1500))) noBack.push({ code: net.patterns[i] ? net.patterns[i].c : '', from: clean(stopAt(a).stop_name), to: clean(stopAt(b).stop_name), trips: p.n });
  });
  if (noBack.length) note(warnings, 'sin-regreso', 'Recorridos sin otro que haga el camino inverso', noBack);

  // ---------- 6. validity dates ----------
  const today = process.env.AUDIT_TODAY || new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const ended = calendar.filter(c => c.end_date && c.end_date < today), future = calendar.filter(c => c.start_date && c.start_date > today);
  if (info.feed_end_date && info.feed_end_date < today) note(critical, 'archivo-vencido', `El archivo dejó de valer el ${info.feed_end_date}`);
  if (ended.length) note(warnings, 'servicio-vencido', 'Calendarios ya vencidos', ended.map(c => ({ id: c.service_id, end: c.end_date })));
  if (future.length) note(warnings, 'servicio-futuro', 'Calendarios que aún no empiezan', future.map(c => ({ id: c.service_id, start: c.start_date })));

  // ---------- 7. the city, north to south and west to east ----------
  const boxOf = p => { let a0 = 90, a1 = -90, o0 = 180, o1 = -180; p.stops.forEach(s => { const a = +stopAt(s).stop_lat, o = +stopAt(s).stop_lon; a0 = Math.min(a0, a); a1 = Math.max(a1, a); o0 = Math.min(o0, o); o1 = Math.max(o1, o); }); return { a0, a1, o0, o1 }; };
  const extent = kept.map((p, i) => { const b = boxOf(p), g = geo[i]; return { code: net.patterns[i] ? net.patterns[i].c : '', dest: net.patterns[i] ? net.patterns[i].d : '', ns: dist(b.a0, b.o0, b.a1, b.o0) / 1000, ew: dist(b.a0, b.o0, b.a0, b.o1) / 1000, km: g ? g.km : 0, stops: p.stops.length, min: g ? Math.round(g.dur / 60) : 0 }; });
  const extremes = { north: null, south: null, west: null, east: null };
  for (const i of usedStops) {
    const s = stopAt(i), a = +s.stop_lat, o = +s.stop_lon, e = { name: clean(s.stop_name), lat: a, lon: o };
    if (!extremes.north || a > extremes.north.lat) extremes.north = e;
    if (!extremes.south || a < extremes.south.lat) extremes.south = e;
    if (!extremes.west || o < extremes.west.lon) extremes.west = e;
    if (!extremes.east || o > extremes.east.lon) extremes.east = e;
  }
  const byAgency = {};
  kept.forEach(p => { const a = routeOf.get(p.route).agency_id; byAgency[a] = byAgency[a] || { patterns: 0, routes: new Set(), trips: 0 }; byAgency[a].patterns++; byAgency[a].routes.add(p.route); byAgency[a].trips += p.n; });
  const ag = new Map(table(dir, 'agency.txt').map(x => [x.agency_id, clean(x.agency_name)]));

  const summary = {
    feed: net.meta.feed, feedInfo: { start: info.feed_start_date, end: info.feed_end_date, version: info.feed_version },
    departures: tripsByDay(net), signPatterns, signStops, signWrong: signWrong.length, shortTurns, offShape: offShape.length, outOfOrder: outOfOrder.length,
    file: { routes: d.routes.length, trips: d.trips.length, stops: d.stops.length, shapes: shapes.size },
    trips: { withStops: tripsWithRows.size, withoutStops: d.trips.length - tripsWithRows.size, noDays: tripsNoDays, inPatterns: tripsSeen, keptInApp: kept.reduce((s, p) => s + p.n, 0) },
    patterns: { all: all.length, kept: kept.length, singleTrip: dropped.length },
    app: { routes: net.routes.length, patterns: net.patterns.length, stops: net.stops.n.length, stopsUsed: usedStops.size },
    legs: { total: totalLegs, zeroTime: zeroLegs },
    byAgency: Object.fromEntries(Object.entries(byAgency).map(([k, v]) => [ag.get(k) || k, { routes: v.routes.size, patterns: v.patterns, trips: v.trips }])),
    extremes,
    longestNS: extent.slice().sort((a, b) => b.ns - a.ns).slice(0, 8), longestEW: extent.slice().sort((a, b) => b.ew - a.ew).slice(0, 8), longestKm: extent.slice().sort((a, b) => b.km - a.km).slice(0, 8),
    medianKm: extent.map(x => x.km).sort((a, b) => a - b)[extent.length >> 1],
    critical: critical.length, warnings: warnings.length, seconds: Math.round((Date.now() - t0) / 1000),
  };

  // ---------- 8. every pattern, through the real engine ----------
  let engine = null;
  if (has('--engine')) {
    const { create } = require('../js/engine.js');
    const E = create(net), fails = [], slow = [], crossFails = [], tE = Date.now();
    let checked = 0, found = 0, ownCode = 0;
    const place = i => ({ stop: i, station: -1, name: net.stops.n[i], lat: E.lat[i], lon: E.lon[i] });
    // The busiest hour of a day this pattern runs, so a failure means a data problem and not a quiet hour.
    const B62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const peak = q => { let best = null; q.h.forEach((row, day) => { [...row].forEach((c, h) => { const n = B62.indexOf(c); if (n > 0 && (!best || n > best.n)) best = { day, h, n }; }); }); return best; };
    // Boards and gets off at the exact stops, with no walking, so only this ride can answer.
    const ride = (q, i, a, b, at) => {
      const r = E.plan({ from: place(q.s[a]), to: place(q.s[b]), day: at.day, time: Math.max(0, at.h * 3600 - 300), maxBuses: 1, maxWalk: 0 });
      const opts = r.groups.flatMap(g => g.options);
      checked++;
      if (!opts.length) { fails.push({ pattern: i, code: q.c, from: net.stops.n[q.s[a]], to: net.stops.n[q.s[b]], day: at.day, hour: at.h }); return; }
      found++;
      const own = q.t.slice(a, b).reduce((sum, x) => sum + x * 10, 0);
      let code = q.c; for (const [from, c] of q.x || []) if (a >= from) code = c;
      if (opts.some(o => o.legs.some(l => l.type === 'ride' && (l.code === code || (l.also || []).some(x => x.code === code))))) ownCode++;
      // Something faster can win, but never a trip much slower than this bus alone, since this bus was on offer.
      if (opts[0].ride > own * 1.8 + 600) slow.push({ code, from: net.stops.n[q.s[a]], to: net.stops.n[q.s[b]], ride: Math.round(opts[0].ride / 60), own: Math.round(own / 60) });
    };
    net.patterns.forEach((q, i) => {
      const at = peak(q);
      if (!at) { fails.push({ pattern: i, code: q.c, why: 'sin horas de servicio' }); return; }
      const usable = q.s.map((s, pos) => pos).filter(pos => E.atStop[q.s[pos]].length);
      if (usable.length < 2) { fails.push({ pattern: i, code: q.c, why: 'sin paradas para pasajeros' }); return; }
      const a = usable[0], b = usable[usable.length - 1], A = q.s[a], B = q.s[b];
      if (A !== B && dist(E.lat[A], E.lon[A], E.lat[B], E.lon[B]) >= 1000) { ride(q, i, a, b, at); return; }
      // A round trip: out to its farthest stop, and back.
      let far = usable[1], farM = -1;
      for (const pos of usable) { const s = q.s[pos], m = dist(E.lat[A], E.lon[A], E.lat[s], E.lon[s]); if (m > farM) { farM = m; far = pos; } }
      if (far !== a) ride(q, i, a, far, at);
      if (far !== b && q.s[far] !== B) ride(q, i, far, b, at);
    });
    // Across the city. The portals are the backbone: all of them must connect, on every day type and at any busy hour.
    const hub = q => { const k = net.stops.n.findIndex((n, j) => net.stops.k[j] === 1 && n.toLowerCase().startsWith(q) && E.children[j].some(x => E.atStop[x].length)); return k < 0 ? null : { stop: -1, station: k, name: net.stops.n[k], lat: E.lat[k], lon: E.lon[k] }; };
    const portals = ['portal norte', 'portal suba', 'portal 80', 'portal el dorado', 'portal américas', 'portal sur', 'portal tunal', 'portal usme', 'portal 20'].map(hub);
    if (portals.some(p => !p)) note(critical, 'portal-sin-rutas', 'Un portal se quedó sin rutas en el archivo');
    let crossChecked = 0, crossMaxBuses = 0;
    for (const day of [0, 1, 2]) for (const h of [6, 8, 12, 17, 20]) for (const a of portals) for (const b of portals) {
      if (!a || !b || a === b) continue;
      crossChecked++;
      const g = E.plan({ from: a, to: b, day, time: h * 3600, maxBuses: 3, maxWalk: 600 });
      if (g.fewest === null) crossFails.push({ from: a.name, to: b.name, day, hour: h }); else crossMaxBuses = Math.max(crossMaxBuses, g.fewest);
    }
    // The far ends are rural or served by few trips a day, so a quiet hour can have no route: this only reports it.
    const stopAtName = q => { const k = net.stops.n.findIndex((n, j) => !net.stops.k[j] && n === q && E.atStop[j].length); return k < 0 ? null : place(k); };
    const edges = Object.entries(extremes).map(([side, e]) => {
      const p = stopAtName(e.name);
      if (!p) return { side, name: e.name, served: false };
      const hours = [6, 8, 10, 12, 14, 16, 18], reached = hours.filter(h => portals.some(a => a && E.plan({ from: a, to: p, day: 0, time: h * 3600, maxBuses: 3, maxWalk: 900 }).fewest !== null));
      return { side, name: e.name, lat: e.lat, lon: e.lon, served: true, hours: reached };
    });
    engine = { checked, found, ownCode, failCount: fails.length, fails: fails.slice(0, 100), slowCount: slow.length, slow: slow.slice(0, 40), crossChecked, crossFailCount: crossFails.length, crossFails: crossFails.slice(0, 40), crossMaxBuses, edges, seconds: Math.round((Date.now() - tE) / 1000) };
    if (fails.length) note(critical, 'motor-falla', `El motor no encuentra ${fails.length} recorridos`, fails);
    if (crossFails.length) note(critical, 'portales-sin-conexion', `${crossFails.length} viajes entre portales sin ruta`, crossFails);
    summary.critical = critical.length;
  }

  const report = { summary, engine, critical, warnings };
  const out = opt('--out');
  if (out) fs.writeFileSync(out, JSON.stringify(report, null, 1));

  // ---------- map data: every route with its real shape ----------
  const mapOut = opt('--map');
  if (mapOut) {
    const code = v => Math.round(v * 1e5);
    const routes = [], stopIdx = new Map(), stops = [];
    const addStop = i => { if (!stopIdx.has(i)) { stopIdx.set(i, stops.length); const s = stopAt(i); stops.push([clean(s.stop_name), code(+s.stop_lat), code(+s.stop_lon)]); } return stopIdx.get(i); };
    geo.forEach((g, i) => {
      if (!g) return;
      const q = net.patterns[i], r = routeOf.get(g.p.route), first = g.along[0].seg, last = g.along[g.along.length - 1].seg;
      // Only the stretch this variant really runs, from its first stop to its last.
      const stretch = g.shape.pts.slice(first, last + 2), line = simplifyIndex(stretch, 18).map(k => stretch[k]);
      const flat = []; let pa = 0, po = 0; // delta coding keeps the page small
      for (const pt of line) { const a = code(pt[0]), o = code(pt[1]); flat.push(a - pa, o - po); pa = a; po = o; }
      let a0 = 90, a1 = -90, o0 = 180, o1 = -180;
      g.p.stops.forEach(s => { const a = +stopAt(s).stop_lat, o = +stopAt(s).stop_lon; a0 = Math.min(a0, a); a1 = Math.max(a1, a); o0 = Math.min(o0, o); o1 = Math.max(o1, o); });
      routes.push({ c: q.c, d: q.d, x: q.x || undefined, a: +r.agency_id, col: net.routes[q.r][2], n: g.p.n, km: +g.km.toFixed(1), min: Math.round(g.dur / 60), ns: Math.round(dist(a0, o0, a1, o0) / 100) / 10, ew: Math.round(dist(a0, o0, a0, o1) / 100) / 10, s: g.p.stops.map(addStop), l: flat });
    });
    fs.writeFileSync(mapOut, JSON.stringify({ feed: net.meta.feed, routes, stops, agencies: Object.fromEntries(ag) }));
    summary.mapMB = +(fs.statSync(mapOut).size / 1048576).toFixed(2);
  }

  console.log(JSON.stringify(summary, null, 1));
  for (const c of critical) console.log('CRITICO', c.code, c.text, c.count === undefined ? '' : `(${c.count})`);
  for (const w of warnings) console.log('aviso', w.code, w.text, w.count === undefined ? '' : `(${w.count})`);
  if (engine) console.log('motor', JSON.stringify({ checked: engine.checked, found: engine.found, ownCode: engine.ownCode, failCount: engine.failCount, slowCount: engine.slowCount, crossChecked: engine.crossChecked, crossFailCount: engine.crossFailCount, crossMaxBuses: engine.crossMaxBuses, seconds: engine.seconds }));
  if (has('--strict') && critical.length) { console.error('La auditoría encontró problemas críticos: no se publica.'); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
