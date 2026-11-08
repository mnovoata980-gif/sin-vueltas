// Route engine for bicycles, e-bikes, e-scooters, mopeds and electric motorcycles in Bogotá.
// Each vehicle only uses what the rules allow it (data/bike-rules.json): a moped never enters a bike path, an e-scooter
// never rides on a sidewalk, nobody rides on TransMilenio lanes. Within that, the route prefers bike infrastructure and
// quiet streets over fast avenues, and says plainly where it has none. A* over the street graph built by
// tools/build-bike.js, in the phone, with no server.
(function (root) {
  const LAT0 = 4.65, LON0 = -74.1, KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KY = 110540;
  const KIND = ['calle', 'ciclorruta', 'bicicarril', 'busbici', 'peatonal', 'compartida'];
  const WALK_KMH = 4.5;
  // How much nicer (below 1) or worse (above 1) a meter feels than on a quiet street, when safety matters.
  const INFRA_FEEL = [1, 0.78, 0.9, 1.12, 1.08, 0.95];
  const ROAD_FEEL = [9, 2.4, 1.9, 1.5, 1.22, 1, 0.95, 1.08, 1, 1.15, 1.1, 1.3, 3];
  const CICLOVIA_FEEL = 0.7;
  // Average speeds in the city (lights, traffic), by road class, for motor vehicles.
  const MOTO_KMH = [55, 42, 36, 32, 28, 22, 12, 15, 0, 0, 0, 15, 0];
  const MOPED_KMH = [0, 36, 33, 30, 27, 22, 12, 15, 0, 0, 0, 14, 0];
  const URBAN_LIMIT = 50; // Ley 2251 de 2022: 50 km/h in cities unless a sign says otherwise

  function create(data) {
    const C = data.codes, F = C.F;
    const nV = data.v.length / 2, nE = data.e.length / 6;
    const lat = new Float64Array(nV), lon = new Float64Array(nV), vx = new Float64Array(nV), vy = new Float64Array(nV);
    let la = 0, lo = 0;
    for (let i = 0; i < nV; i++) { la += data.v[2 * i]; lo += data.v[2 * i + 1]; lat[i] = la / 1e5; lon[i] = lo / 1e5; vx[i] = (lon[i] - LON0) * KX; vy[i] = (lat[i] - LAT0) * KY; }
    const eA = new Int32Array(nE), eB = new Int32Array(nE), eLen = new Float32Array(nE), eF = new Int32Array(nE), eName = new Int32Array(nE), gOff = new Int32Array(nE + 1);
    for (let i = 0, g = 0, a = 0; i < nE; i++) {
      const k = 6 * i;
      a += data.e[k]; eA[i] = a; eB[i] = a + data.e[k + 1]; eLen[i] = data.e[k + 2] / 10; eF[i] = data.e[k + 3]; eName[i] = data.e[k + 4];
      gOff[i] = g; g += data.e[k + 5];
      if (i === nE - 1) gOff[nE] = g;
    }
    // Shape points (between the two ends), decoded as [lat, lon] when first needed.
    const shapeCache = new Map();
    function shape(i) {
      let s = shapeCache.get(i);
      if (s) return s;
      s = [];
      let a = Math.round(lat[eA[i]] * 1e5), o = Math.round(lon[eA[i]] * 1e5);
      for (let k = gOff[i]; k < gOff[i + 1]; k++) { a += data.g[2 * k]; o += data.g[2 * k + 1]; s.push([a / 1e5, o / 1e5]); }
      if (shapeCache.size > 20000) shapeCache.clear();
      shapeCache.set(i, s);
      return s;
    }
    const pointsOf = i => [[lat[eA[i]], lon[eA[i]]], ...shape(i), [lat[eB[i]], lon[eB[i]]]];
    const cls = i => (eF[i] >> C.CLS_SHIFT) & 15, inf = i => (eF[i] >> C.INF_SHIFT) & 7, maxOf = i => ((eF[i] >> C.MAX_SHIFT) & 15) * 10;
    // Adjacency: every edge leaves from both ends; direction 0 is A to B.
    const deg = new Int32Array(nV + 1);
    for (let i = 0; i < nE; i++) { deg[eA[i] + 1]++; deg[eB[i] + 1]++; }
    for (let i = 0; i < nV; i++) deg[i + 1] += deg[i];
    const adj = new Int32Array(2 * nE), fill = deg.slice(0, nV);
    for (let i = 0; i < nE; i++) { adj[fill[eA[i]]++] = 2 * i; adj[fill[eB[i]]++] = 2 * i + 1; }
    // Sunday ciclovía and places closed to some vehicles.
    const cvOf = new Int16Array(nE).fill(-1);
    for (let k = 0; k < data.cv.length; k += 2) cvOf[data.cv[k]] = data.cv[k + 1];
    const closedOf = new Int16Array(nE).fill(-1);
    for (let k = 0; k < (data.closed || []).length; k += 2) closedOf[data.closed[k]] = data.closed[k + 1];
    const closedRules = (data.rules && data.rules.closed) || [];

    // A grid of edge pieces, to start and end the route on the nearest usable street.
    const CELL = 120, grid = new Map(), gkey = (i, j) => i * 4096 + j;
    for (let i = 0; i < nE; i++) {
      const pts = pointsOf(i);
      const seen = new Set();
      for (const p of pts) {
        const k = gkey(Math.floor(((p[1] - LON0) * KX + 200000) / CELL), Math.floor(((p[0] - LAT0) * KY + 200000) / CELL));
        if (seen.has(k)) continue;
        seen.add(k);
        let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(i);
      }
    }
    shapeCache.clear();

    // ---------- vehicles ----------
    const rules = (data.rules && data.rules.vehicles) || {};
    // How a vehicle moves on edge i in direction d: { ride: true } on its wheels, { ride: false } pushing it, or null.
    function makeProfile(key, opt) {
      const r = rules[key] || {}, group = r.group || 'bike';
      const motor = group === 'moped' || group === 'moto';
      const safe = opt.pref !== 'direct';
      const feel = m => (safe ? m : 1 + (m - 1) * 0.3);
      const sunday = opt.ciclovia; // the ciclovía is on right now
      const base = (r.kmh || 15) / 3.6;
      const closedFor = i => { const c = closedOf[i]; return c >= 0 && (closedRules[c].vehicles || []).includes(key); };
      const p = { key, group, motor, safe, sunday };
      if (motor) {
        const table = group === 'moto' ? MOTO_KMH : MOPED_KMH, need = group === 'moto' ? F.moto : F.moped;
        p.edge = (i, d) => {
          const f = eF[i];
          if (!(f & need) || (d && (f & F.ow)) || closedFor(i)) return null;
          if (sunday && cvOf[i] >= 0) return null; // closed to motor traffic during the ciclovía
          const c = cls(i), lim = maxOf(i) || URBAN_LIMIT;
          let kmh = Math.min(table[c] || 15, lim * 0.85);
          if (group === 'moped') kmh = Math.min(kmh, 40);
          if (f & F.unpaved) kmh *= 0.6;
          const sec = eLen[i] / (kmh / 3.6);
          // Mopeds are slow for fast avenues: they still may use them, but the route prefers others.
          const m = group === 'moped' && c <= 1 ? 1.35 : 1;
          return { ride: true, sec, cost: sec * m };
        };
        p.minCostPerM = 1 / ((group === 'moto' ? 55 : 40) / 3.6);
      } else {
        const velmpu = group === 'velmpu';
        p.edge = (i, d) => {
          const f = eF[i];
          if (closedFor(i)) return null;
          let ride = !!(f & F.bike);
          // Light electric vehicles never ride on sidewalks or among pedestrians: they push.
          if (ride && velmpu && (f & F.sidewalk)) ride = false;
          if (ride && d && (f & F.owBike)) ride = false; // against a one-way street: walk it on the sidewalk
          if (!ride && !(f & (F.bike | F.walk))) return null;
          if (!ride) {
            const sec = eLen[i] / (WALK_KMH / 3.6);
            return { ride: false, sec, cost: sec * (d && (f & F.owBike) ? 1.6 : 1.25) };
          }
          const c = cls(i), k = inf(i);
          let v = base;
          if (k === 4) v = Math.min(v, 11 / 3.6); // among pedestrians
          else if (k === 0 && c <= 4) v *= 0.88; // lights and traffic on avenues
          else if (c === 6) v = Math.min(v, 12 / 3.6);
          if (f & F.unpaved) v *= key === 'patineta' ? 0.45 : 0.7;
          const sec = eLen[i] / v;
          let m;
          if (sunday && cvOf[i] >= 0) m = CICLOVIA_FEEL;
          else if (k) m = INFRA_FEEL[k];
          else { m = ROAD_FEEL[c]; if (velmpu && c <= 5) m *= 1.12; } // the law sends them to bike infrastructure when there is one
          return { ride: true, sec, cost: sec * feel(m) };
        };
        p.minCostPerM = feel(CICLOVIA_FEEL) / base;
      }
      return p;
    }

    // ---------- where a vehicle can go and come back ----------
    // A street can look usable and still be a trap: a one-way block that only pedestrians reach, a lane inside a closed
    // complex. Routes start and end only on the largest part of the network where every point reaches every other
    // (strongly connected, found with Kosaraju's two passes), computed once per vehicle.
    const mainCache = new Map();
    function mainPart(p) {
      const key = p.key + (p.sunday ? ':cv' : '');
      if (mainCache.has(key)) return mainCache.get(key);
      const seen = new Uint8Array(nV), order = new Int32Array(nV);
      let n = 0;
      const stack = new Int32Array(nV), it = new Int32Array(nV);
      for (let r = 0; r < nV; r++) {
        if (seen[r]) continue;
        let top = 0; stack[0] = r; it[r] = deg[r]; seen[r] = 1;
        while (top >= 0) {
          const u = stack[top];
          if (it[u] < deg[u + 1]) {
            const ed = adj[it[u]++], e = ed >> 1, d = ed & 1;
            if (!p.edge(e, d)) continue;
            const w = d ? eA[e] : eB[e];
            if (!seen[w]) { seen[w] = 1; it[w] = deg[w]; stack[++top] = w; }
          } else { order[n++] = u; top--; }
        }
      }
      const comp = new Int32Array(nV).fill(-1), sizes = [];
      for (let k = n - 1; k >= 0; k--) {
        const r = order[k];
        if (comp[r] >= 0) continue;
        const c = sizes.length; let size = 0, top = 0; stack[0] = r; comp[r] = c;
        while (top >= 0) {
          const w = stack[top--]; size++;
          // Reverse edges: an edge leaving w in direction d arrives at w in direction 1 - d.
          for (let q = deg[w]; q < deg[w + 1]; q++) {
            const ed = adj[q], e = ed >> 1, d = ed & 1;
            if (!p.edge(e, 1 - d)) continue;
            const u = d ? eA[e] : eB[e];
            if (comp[u] < 0) { comp[u] = c; stack[++top] = u; }
          }
        }
        sizes.push(size);
      }
      const big = sizes.indexOf(Math.max(...sizes)), inMain = new Uint8Array(nV);
      for (let v = 0; v < nV; v++) if (comp[v] === big) inMain[v] = 1;
      mainCache.set(key, inMain);
      return inMain;
    }

    // ---------- nearest usable street ----------
    function snap(la1, lo1, p, maxM) {
      const inMain = mainPart(p);
      const px = (lo1 - LON0) * KX, py = (la1 - LAT0) * KY;
      let best = null;
      for (const r of [150, 400, maxM || 1200]) {
        const i0 = Math.floor((px + 200000 - r) / CELL), i1 = Math.floor((px + 200000 + r) / CELL), j0 = Math.floor((py + 200000 - r) / CELL), j1 = Math.floor((py + 200000 + r) / CELL);
        const seen = new Set();
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
          const a = grid.get(gkey(i, j));
          if (!a) continue;
          for (const e of a) {
            if (seen.has(e)) continue;
            seen.add(e);
            if (!p.edge(e, 0) && !p.edge(e, 1)) continue;
            if (!inMain[eA[e]] || !inMain[eB[e]]) continue;
            const pts = pointsOf(e);
            let along = 0;
            for (let k = 1; k < pts.length; k++) {
              const ax = (pts[k - 1][1] - LON0) * KX, ay = (pts[k - 1][0] - LAT0) * KY, bx = (pts[k][1] - LON0) * KX, by = (pts[k][0] - LAT0) * KY;
              const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, l = Math.sqrt(l2);
              let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
              const d = Math.hypot(ax + t * dx - px, ay + t * dy - py);
              // A bike path is worth a few more meters than the road next to it.
              const score = d - (inf(e) && !p.motor ? 6 : 0);
              if (!best || score < best.score) best = { e, score, d, at: along + t * l, k, t, x: ax + t * dx, y: ay + t * dy };
              along += l;
            }
          }
        }
        if (best) break;
      }
      if (!best) return null;
      // Real edge length (the stored one), so partial costs add up.
      const pts = pointsOf(best.e);
      let total = 0; for (let k = 1; k < pts.length; k++) total += Math.hypot((pts[k][1] - pts[k - 1][1]) * KX, (pts[k][0] - pts[k - 1][0]) * KY);
      best.frac = total ? Math.min(1, best.at / total) : 0;
      best.lat = best.y / KY + LAT0; best.lon = best.x / KX + LON0;
      return best;
    }

    // ---------- search ----------
    // A* with a binary heap. Costs are seconds weighted by how the street feels; time is kept apart.
    function search(p, s, t) {
      const dist = new Float64Array(nV).fill(Infinity), prev = new Int32Array(nV).fill(-1), done = new Uint8Array(nV);
      const heap = [], hv = [];
      const tx = t.x, ty = t.y, hk = p.minCostPerM;
      const h = v => Math.hypot(vx[v] - tx, vy[v] - ty) * hk;
      const push = (v, f) => { heap.push(f); hv.push(v); let i = heap.length - 1; while (i) { const q = (i - 1) >> 1; if (heap[q] <= heap[i]) break; [heap[q], heap[i]] = [heap[i], heap[q]]; [hv[q], hv[i]] = [hv[i], hv[q]]; i = q; } };
      const pop = () => {
        const v = hv[0], last = heap.length - 1;
        heap[0] = heap[last]; hv[0] = hv[last]; heap.pop(); hv.pop();
        let i = 0;
        for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l] < heap[m]) m = l; if (r < heap.length && heap[r] < heap[m]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; [hv[m], hv[i]] = [hv[i], hv[m]]; i = m; }
        return v;
      };
      // Leave the start point toward either end of its street.
      const startEdge = s.e;
      for (const d of [0, 1]) {
        const c = p.edge(startEdge, d);
        if (!c) continue;
        const part = d === 0 ? 1 - s.frac : s.frac, v = d === 0 ? eB[startEdge] : eA[startEdge];
        const cost = c.cost * part;
        if (cost < dist[v]) { dist[v] = cost; prev[v] = -2 - d; push(v, cost + h(v)); }
      }
      // Reach the end point from either end of its street.
      const endEdge = t.e, endIn = [];
      for (const d of [0, 1]) {
        const c = p.edge(endEdge, d);
        if (!c) continue;
        endIn.push({ v: d === 0 ? eA[endEdge] : eB[endEdge], d, cost: c.cost * (d === 0 ? t.frac : 1 - t.frac) });
      }
      let best = Infinity, bestVia = null;
      // Both points on the same street, in a direction that street allows.
      if (startEdge === endEdge) for (const d of [0, 1]) {
        if ((d === 0) !== (t.frac >= s.frac)) continue;
        const c = p.edge(startEdge, d);
        if (c) { const cost = c.cost * Math.abs(t.frac - s.frac); if (cost < best) { best = cost; bestVia = { direct: d }; } }
      }
      let settled = 0;
      while (heap.length) {
        const fu = heap[0], u = pop();
        if (done[u]) continue;
        if (fu >= best) break;
        done[u] = 1; settled++;
        for (const x of endIn) if (x.v === u && dist[u] + x.cost < best) { best = dist[u] + x.cost; bestVia = { v: u, d: x.d }; }
        for (let k = deg[u]; k < deg[u + 1]; k++) {
          const ed = adj[k], e = ed >> 1, d = ed & 1;
          const c = p.edge(e, d);
          if (!c) continue;
          const w = d ? eA[e] : eB[e], nd = dist[u] + c.cost;
          if (nd < dist[w]) { dist[w] = nd; prev[w] = ed; push(w, nd + h(w)); }
        }
      }
      if (!bestVia) return null;
      // Walk back from the end.
      const steps = [];
      if (bestVia.direct !== undefined) steps.push({ e: startEdge, d: bestVia.direct, f0: s.frac, f1: t.frac });
      else {
        steps.push({ e: endEdge, d: bestVia.d, f0: bestVia.d === 0 ? 0 : 1, f1: t.frac });
        let v = bestVia.v, guard = 0;
        while (prev[v] >= 0 && guard++ < nV) { const ed = prev[v], e = ed >> 1, d = ed & 1; steps.push({ e, d, f0: d ? 1 : 0, f1: d ? 0 : 1 }); v = d ? eB[e] : eA[e]; }
        const d0 = -2 - prev[v];
        steps.push({ e: startEdge, d: d0, f0: s.frac, f1: d0 === 0 ? 1 : 0 });
        steps.reverse();
      }
      return { steps: steps.filter(x => Math.abs(x.f1 - x.f0) > 1e-6), cost: best, settled };
    }

    // ---------- describing the route ----------
    // The piece of an edge between two fractions of its length, in travel order, as [lat, lon].
    function piece(e, f0, f1) {
      const pts = pointsOf(e);
      const cum = [0];
      for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot((pts[k][1] - pts[k - 1][1]) * KX, (pts[k][0] - pts[k - 1][0]) * KY));
      const total = cum[cum.length - 1] || 1;
      const at = f => {
        const m = f * total;
        let k = 1; while (k < pts.length - 1 && cum[k] < m) k++;
        const t = cum[k] === cum[k - 1] ? 0 : (m - cum[k - 1]) / (cum[k] - cum[k - 1]);
        return { k, p: [pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * t, pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * t] };
      };
      const lo2 = Math.min(f0, f1), hi = Math.max(f0, f1), a = at(lo2), b = at(hi);
      const out = [a.p, ...pts.slice(a.k, b.k), b.p];
      return f0 > f1 ? out.reverse() : out;
    }
    const bearing = (p, q) => Math.atan2((q[1] - p[1]) * KX, (q[0] - p[0]) * KY) * 180 / Math.PI;
    // Direction over the first or last ~25 m of a line, so a little kink at a corner does not decide the turn.
    function headOf(pts, fromEnd) {
      const seq = fromEnd ? pts.slice().reverse() : pts;
      let m = 0, k = 1;
      for (; k < seq.length - 1; k++) { m += Math.hypot((seq[k][1] - seq[k - 1][1]) * KX, (seq[k][0] - seq[k - 1][0]) * KY); if (m > 25) break; }
      return fromEnd ? bearing(seq[Math.min(k, seq.length - 1)], seq[0]) : bearing(seq[0], seq[Math.min(k, seq.length - 1)]);
    }
    const CARD = ['el norte', 'el nororiente', 'el oriente', 'el suroriente', 'el sur', 'el suroccidente', 'el occidente', 'el noroccidente'];
    const cardinal = b => CARD[Math.round(((b % 360) + 360) % 360 / 45) % 8];
    function turnWord(a, b) {
      let d = b - a; while (d > 180) d -= 360; while (d <= -180) d += 360;
      if (Math.abs(d) < 28) return 'sigue';
      if (Math.abs(d) > 150) return 'vuelta';
      if (d > 0) return d < 60 ? 'leve-derecha' : 'derecha';
      return d > -60 ? 'leve-izquierda' : 'izquierda';
    }

    function describe(p, res, s, t, opt) {
      const legs = [];
      let total = 0, time = 0;
      for (const st of res.steps) {
        const e = st.e, c = p.edge(e, st.d), frac = Math.abs(st.f1 - st.f0);
        const len = eLen[e] * frac, sec = c.sec * frac;
        total += len; time += sec;
        const k = inf(e), cl = cls(e), sunday = opt.ciclovia && cvOf[e] >= 0;
        // What the rider sees: on a bike path, on the road, pushing the bike.
        let kind = !c.ride ? 'walk' : p.motor ? 'calle' : sunday ? 'ciclovia' : KIND[k];
        const name = eName[e] ? data.names[eName[e] - 1] : '';
        legs.push({ e, kind, name, len, sec, cls: cl, max: maxOf(e), near: !!(eF[e] & F.near), cv: cvOf[e], pts: piece(e, st.f0, st.f1), sidewalk: !!(eF[e] & F.sidewalk), bridge: !!(eF[e] & F.bridge), unpaved: !!(eF[e] & F.unpaved), against: !c.ride && st.d === 1 && !!(eF[e] & F.owBike) });
      }
      // Stretches: same name and same kind of way, joined. Tiny connectors melt into their neighbors.
      const groups = [];
      for (const l of legs) {
        const g = groups[groups.length - 1];
        // A piece without a name joins its neighbor only if it keeps going the same way.
        const straight = () => { let d = headOf(l.pts, false) - headOf(g.pts, true); while (d > 180) d -= 360; while (d <= -180) d += 360; return Math.abs(d) < 35; };
        const same = g && g.kind === l.kind && (g.name === l.name || ((!l.name || !g.name) && straight()));
        if (same) { g.len += l.len; g.sec += l.sec; g.pts.push(...l.pts.slice(1)); if (!g.name) g.name = l.name; g.cls = Math.min(g.cls, l.cls); if (l.max) g.max = g.max ? Math.min(g.max, l.max) : l.max; g.legs.push(l); }
        else groups.push({ kind: l.kind, name: l.name, len: l.len, sec: l.sec, pts: l.pts.slice(), cls: l.cls, max: l.max, near: l.near, legs: [l] });
      }
      for (let pass = 0; pass < 2; pass++) for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        const tiny = g.kind === 'walk' ? g.len < 15 : g.len < 60;
        if (!tiny || groups.length === 1) continue;
        const prev = groups[i - 1], next = groups[i + 1];
        const into = prev && next && prev.kind === next.kind && (prev.name === next.name || !next.name) ? prev : prev || next;
        if (!into) continue;
        if (into === prev) { prev.len += g.len; prev.sec += g.sec; prev.pts.push(...g.pts.slice(1)); prev.legs.push(...g.legs); if (next && next.kind === prev.kind && (next.name === prev.name || !next.name)) { prev.len += next.len; prev.sec += next.sec; prev.pts.push(...next.pts.slice(1)); prev.legs.push(...next.legs); groups.splice(i, 2); } else groups.splice(i, 1); }
        else { next.len += g.len; next.sec += g.sec; next.pts.unshift(...g.pts.slice(0, -1)); next.legs.unshift(...g.legs); groups.splice(i, 1); }
        i--;
      }
      // Turns between stretches.
      groups.forEach((g, i) => {
        g.head = headOf(g.pts, false);
        // Where the stretch goes overall, which says more than its first meters on a long one.
        const a0 = g.pts[0], a1 = g.pts[g.pts.length - 1], far = Math.hypot((a1[1] - a0[1]) * KX, (a1[0] - a0[0]) * KY);
        g.toward = cardinal(g.len > 120 && far > g.len * 0.5 ? bearing(a0, a1) : g.head);
        g.turn = i ? turnWord(headOf(groups[i - 1].pts, true), g.head) : 'start';
        // Same street, a little bend (a bike lane moving from the sidewalk to the road): it is still "keep going".
        if (i && g.name && g.name === groups[i - 1].name && /^(sigue|leve)/.test(g.turn)) g.turn = 'sigue';
        if (g.turn === 'vuelta' && (g.len < 100 || groups[i - 1].len < 100)) { let d = g.head - headOf(groups[i - 1].pts, true); while (d > 180) d -= 360; while (d <= -180) d += 360; g.turn = d > 0 ? 'derecha' : 'izquierda'; }
      });
      // Totals by kind of way.
      const by = {};
      for (const l of legs) by[l.kind] = (by[l.kind] || 0) + l.len;
      const infraM = (by.ciclorruta || 0) + (by.bicicarril || 0) + (by.busbici || 0) + (by.peatonal || 0) + (by.compartida || 0) + (by.ciclovia || 0);
      // Avenues with nothing for bikes, worth a warning.
      const exposed = p.motor ? [] : groups.filter(g => g.kind === 'calle' && g.cls <= 3 && g.len >= 120).map(g => ({ name: g.name, len: g.len }));
      return {
        dist: total, sec: time, by, infraM, pct: total ? Math.round(100 * infraM / total) : 0,
        walkM: by.walk || 0, groups, exposed,
        cicloviaM: by.ciclovia || 0, tramos: [...new Set(legs.filter(l => l.cv >= 0).map(l => l.cv))],
        from: { lat: s.lat, lon: s.lon, off: s.d }, to: { lat: t.lat, lon: t.lon, off: t.d },
      };
    }

    function route(q) {
      const p = makeProfile(q.vehicle, q);
      const s = snap(q.from.lat, q.from.lon, p), t = snap(q.to.lat, q.to.lon, p);
      if (!s || !t) return { error: !s ? 'from' : 'to' };
      const res = search(p, s, t);
      if (!res) return { error: 'none' };
      const r = describe(p, res, s, t, q);
      r.vehicle = q.vehicle; r.pref = p.safe ? 'safe' : 'direct'; r.settled = res.settled;
      return r;
    }
    // The recommended route and, for bikes, the most direct one when it is really different.
    function plan(q) {
      const main = route({ ...q, pref: q.pref || 'safe' });
      if (main.error) return { main };
      const group = (rules[q.vehicle] || {}).group;
      if (group === 'moped' || group === 'moto') return { main };
      const other = route({ ...q, pref: q.pref === 'direct' ? 'safe' : 'direct' });
      if (other.error) return { main };
      // Shared length decides whether they are really two options.
      const mine = new Set(main.groups.flatMap(g => g.legs.map(l => l.e)));
      const shared = other.groups.flatMap(g => g.legs).filter(l => mine.has(l.e)).reduce((a, l) => a + l.len, 0);
      const differs = shared < 0.8 * other.dist && Math.abs(other.sec - main.sec) >= 120;
      return { main, other: differs ? other : null };
    }
    // Bike infrastructure as lines, for the map layer that shows the network around the route.
    function network() {
      const out = [];
      for (let i = 0; i < nE; i++) {
        const k = inf(i);
        if (!k || !(eF[i] & F.bike)) continue;
        out.push({ k, pts: pointsOf(i).map(p => [+p[1].toFixed(5), +p[0].toFixed(5)]) });
      }
      return out;
    }
    function ciclovia() {
      const out = [];
      for (let i = 0; i < nE; i++) if (cvOf[i] >= 0) out.push({ t: cvOf[i], pts: pointsOf(i).map(p => [+p[1].toFixed(5), +p[0].toFixed(5)]) });
      return out;
    }
    return { route, plan, snap: (la1, lo1, vehicle) => snap(la1, lo1, makeProfile(vehicle, {}), 3000), network, ciclovia, meta: data.meta, rules: data.rules, tramos: data.tramos, parking: data.parking, size: { vertices: nV, edges: nE } };
  }

  // Is the ciclovía on at this moment? Sundays and holidays (day type 2), during its hours.
  const cicloviaOn = (dayType, minute) => dayType === 2 && minute >= 420 && minute < 840;
  const api = { create, cicloviaOn, KIND };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BikeEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
