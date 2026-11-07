// Geometry and feed checks shared by build-data.js and audit-routes.js.
const R = Math.PI / 180;
const dist = (a1, o1, a2, o2) => { const x = (a2 - a1) * R, y = (o2 - o1) * R * Math.cos((a1 + a2) * R / 2); return 6371000 * Math.sqrt(x * x + y * y); };

// Nearest point on a segment, in meters on a local flat projection (fine at city scale).
function segDist(a, o, a1, o1, a2, o2) {
  const kx = Math.cos(a * R) * 111320, ky = 110540;
  const x = (o - o1) * kx, y = (a - a1) * ky, dx = (o2 - o1) * kx, dy = (a2 - a1) * ky, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, (x * dx + y * dy) / l)) : 0;
  return { d: Math.hypot(x - t * dx, y - t * dy), t };
}

// shape_id -> points in order, with the running distance. shape_dist_traveled is not used: it is wrong on some routes.
function loadShapes(table, dir) {
  const raw = new Map();
  for (const s of table(dir, 'shapes.txt')) (raw.get(s.shape_id) || raw.set(s.shape_id, []).get(s.shape_id)).push([+s.shape_pt_sequence, +s.shape_pt_lat, +s.shape_pt_lon]);
  const shapes = new Map();
  for (const [id, a] of raw) {
    a.sort((x, y) => x[0] - y[0]);
    const pts = a.map(x => [x[1], x[2]]), cum = new Float64Array(pts.length);
    for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + dist(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    shapes.set(id, { pts, cum, length: cum[cum.length - 1] || 0 });
  }
  return shapes;
}

// Places each stop on the shape, always moving forward. The first pass near a stop is the right one:
// on a round trip the bus may come back along the same street later.
function walkAlong(shape, coords) {
  const { pts, cum } = shape, out = [];
  let seg = 0;
  for (const [a, o] of coords) {
    let best = null, inRun = false;
    for (let i = seg; i < pts.length - 1; i++) {
      const r = segDist(a, o, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
      if (!best || r.d < best.d) best = { d: r.d, seg: i, at: cum[i] + r.t * (cum[i + 1] - cum[i]) };
      if (r.d < 60) inRun = true; else if (inRun && r.d > 200) break;
    }
    if (!best) best = { d: 1e9, seg, at: cum[seg] };
    out.push(best); seg = best.seg;
  }
  return out;
}

// Douglas-Peucker: indexes of the points worth keeping.
function simplifyIndex(pts, tolM) {
  if (pts.length < 3) return pts.map((_, i) => i);
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let best = -1, bd = tolM;
    for (let k = i + 1; k < j; k++) { const d = segDist(pts[k][0], pts[k][1], pts[i][0], pts[i][1], pts[j][0], pts[j][1]).d; if (d > bd) { bd = d; best = k; } }
    if (best >= 0) { keep[best] = 1; stack.push([i, best], [best, j]); }
  }
  const out = [];
  keep.forEach((v, i) => { if (v) out.push(i); });
  return out;
}

const B62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
// Departures per day type: weekday, Saturday, Sunday or holiday.
const tripsByDay = net => [0, 1, 2].map(day => net.patterns.reduce((sum, p) => { for (const c of p.h[day]) sum += B62.indexOf(c); return sum; }, 0));

// TransMilenio's daily file is not always complete: the one from the 2 Nov 2026 holiday had 6 weekday trips instead
// of 80,000 and 135 fewer routes. Publishing it would have left riders without weekday buses, so it must not pass.
const LIMITS = { routes: 0.03, stops: 0.03, trips: 0.10, minDayShare: 0.25 };
function feedProblems(next, prev) {
  const out = [], days = ['días hábiles', 'sábados', 'domingos y festivos'], now = tripsByDay(next);
  const busiest = Math.max(...now);
  now.forEach((n, i) => { if (n < busiest * LIMITS.minDayShare) out.push(`Casi no hay viajes en ${days[i]}: ${n} contra ${busiest} del día con más viajes`); });
  if (!prev) return out;
  const was = tripsByDay(prev);
  const drop = (a, b) => (b ? (b - a) / b : 0), pct = x => `${Math.round(x * 100)} %`;
  const dr = drop(next.routes.length, prev.routes.length), ds = drop(next.stops.n.length, prev.stops.n.length);
  if (dr > LIMITS.routes) out.push(`Se perderían ${prev.routes.length - next.routes.length} de ${prev.routes.length} rutas (${pct(dr)})`);
  if (ds > LIMITS.stops) out.push(`Se perderían ${prev.stops.n.length - next.stops.n.length} de ${prev.stops.n.length} paradas (${pct(ds)})`);
  now.forEach((n, i) => { const x = drop(n, was[i]); if (x > LIMITS.trips) out.push(`Bajan los viajes de ${days[i]}: ${n} contra ${was[i]} (${pct(x)} menos)`); });
  return out;
}

module.exports = { dist, segDist, loadShapes, walkAlong, simplifyIndex, tripsByDay, feedProblems, B62 };
