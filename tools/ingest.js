// Reads raw GTFS into per-trip records. Used by build-data.js.
const fs = require('fs'), path = require('path'), readline = require('readline');

const split = l => { const o = []; let c = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { o.push(c); c = ''; } else c += ch; } o.push(c.replace(/\r$/, '')); return o; };
function table(dir, n) {
  const L = fs.readFileSync(path.join(dir, n), 'utf8').replace(/^﻿/, '').split('\n').filter(x => x.trim());
  const h = split(L[0]);
  return L.slice(1).map(l => { const v = split(l), r = {}; h.forEach((k, i) => r[k] = v[i]); return r; });
}
const hms = s => { const a = s.split(':'); return +a[0] * 3600 + +a[1] * 60 + +a[2]; };

async function ingest(dir) {
  const routes = table(dir, 'routes.txt'), trips = table(dir, 'trips.txt'), stops = table(dir, 'stops.txt');
  const freqs = table(dir, 'frequencies.txt');
  const tripIdx = new Map(trips.map((t, i) => [t.trip_id, i]));
  const stopIdx = new Map(stops.map((s, i) => [s.stop_id, i]));
  const file = path.join(dir, 'stop_times.txt');
  // A stop_times row is at least 45 bytes, so this always leaves room however large the daily file gets.
  const N = Math.ceil(fs.statSync(file).size / 45);
  const T = new Int32Array(N), Q = new Int32Array(N), A = new Int32Array(N), S = new Int32Array(N), H = new Int32Array(N);
  // stop_headsign holds the code painted on the bus, which can differ by direction (A547 / G547).
  const signs = [], signIdx = new Map();
  let n = 0, col = null;
  for await (const l of readline.createInterface({ input: fs.createReadStream(file) })) {
    if (!col) { const h = split(l.replace(/^﻿/, '')); col = {}; h.forEach((k, i) => { col[k] = i; }); continue; }
    const f = l.split(',');
    const t = tripIdx.get(f[col.trip_id]), s = stopIdx.get(f[col.stop_id]);
    if (t === undefined || s === undefined) continue;
    if (n >= N) throw new Error('stop_times.txt has more rows than expected');
    const sign = f[col.stop_headsign];
    let h = signIdx.get(sign);
    if (h === undefined) { h = signs.length; signs.push(sign); signIdx.set(sign, h); }
    T[n] = t; A[n] = hms(f[col.arrival_time]); S[n] = s; Q[n] = +f[col.stop_sequence]; H[n] = h; n++;
  }
  // Rows are interleaved between trips: bucket them per trip, then order by stop_sequence.
  const start = new Int32Array(trips.length + 1);
  for (let i = 0; i < n; i++) start[T[i] + 1]++;
  for (let i = 0; i < trips.length; i++) start[i + 1] += start[i];
  const pos = start.slice(), order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[pos[T[i]]++] = i;

  const eachTrip = fn => {
    for (let t = 0; t < trips.length; t++) {
      const idx = Array.from(order.subarray(start[t], start[t + 1])).sort((a, b) => Q[a] - Q[b]);
      if (idx.length >= 2) fn(t, idx);
    }
  };
  return { routes, trips, stops, freqs, A, S, Q, H, signs, eachTrip };
}
module.exports = { ingest, table, hms };
