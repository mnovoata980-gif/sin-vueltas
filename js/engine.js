// Route engine: finds the fastest trip using at most k buses (RAPTOR rounds on a frequency model).
// Each round adds exactly one more bus, so the limit on buses is a hard rule and never a preference.
(function (root) {
  const B62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const B62I = {}; [...B62].forEach((c, i) => { B62I[c] = i; });
  const WALK_MPS = 1.25, DETOUR = 1.3;     // street walking speed, and streets are not straight lines
  const STATION_ENTRY = 150;               // ramp, turnstile and platform when walking into a BRT station
  const SAME_STATION = 90;                 // changing platform inside a station
  const TRANSFER_BUFFER = 60;              // getting off and reaching the next stop
  const TRANSFER_RADIUS = 400;             // metres
  const HOURS = 27;

  const hav = (a1, o1, a2, o2) => { const r = Math.PI / 180, x = (a2 - a1) * r, y = (o2 - o1) * r * Math.cos((a1 + a2) * r / 2); return 6371000 * Math.sqrt(x * x + y * y); };
  const walkSec = m => m * DETOUR / WALK_MPS;

  // Route plates must be readable: the official pairs include white text on fluorescent green.
  const channel = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
  const luminance = h => .2126 * channel(parseInt(h.slice(0, 2), 16)) + .7152 * channel(parseInt(h.slice(2, 4), 16)) + .0722 * channel(parseInt(h.slice(4, 6), 16));
  const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const shade = (h, f) => [0, 2, 4].map(i => Math.round(parseInt(h.slice(i, i + 2), 16) * f).toString(16).padStart(2, '0')).join('');
  const DARK_TEXT = '0b2410';
  // The feed uses pure screen colors that vibrate on a phone. Same red, green and blue riders know, easier on the eye.
  const BUS_COLORS = { ff0000: ['d9202a', 'ffffff'], e30613: ['d9202a', 'ffffff'], '00ff00': ['0a8540', 'ffffff'], '0000ff': ['1f4fe0', 'ffffff'] };
  function legible(background, text) {
    const bg = background.toLowerCase(), fg = text.toLowerCase();
    if (BUS_COLORS[bg]) return BUS_COLORS[bg];
    if (contrast(bg, fg) >= 4.5) return [bg, fg];
    // A slightly deeper shade keeps the route's recognizable color and its text.
    for (let f = .98; f >= .85; f -= .01) { const d = shade(bg, f); if (contrast(d, fg) >= 4.5) return [d, fg]; }
    return [bg, contrast(bg, DARK_TEXT) >= 4.5 ? DARK_TEXT : 'ffffff'];
  }

  // Bogotá's fare rules, in one place because they change by decree. Checked on 2026-11-06:
  // Decreto 007 de 2026 keeps 125 minutes and up to two free transfers; the Concejo's 150 minutes was objected to and is not in force.
  // Free transfers need a personalized TuLlave card. Changing buses inside a station needs no new validation.
  // Leaving one trunk station to enter another is charged again, even with the personalized card.
  const FARE_RULES = { price: 3550, windowMin: 125, maxTransfers: 2 };
  function fareOf(o, price) {
    const fare = price || FARE_RULES.price;
    const rides = o.legs.filter(l => l.type === 'ride');
    const kind = l => (l.agency === 2 ? 'feeder' : l.agency === 7 ? 'cable' : (l.agency === 1 || l.agency === 6) && l.boardPlace.station >= 0 ? 'trunk' : 'zonal');
    let plus = 0, basic = 0, start = null, used = 0, lateTransfer = false, transferMin = 0, stationWalk = false;
    rides.forEach((l, i) => {
      const k = kind(l), prev = rides[i - 1], pk = prev ? kind(prev) : null;
      // Stations are entered and paid before waiting; zonal buses are paid on board.
      const when = k === 'trunk' ? l.ready : l.ready + l.wait;
      if (prev) {
        const sameStation = l.boardPlace.station >= 0 && l.boardPlace.station === prev.alightPlace.station;
        const insidePaidArea = (pk === 'trunk' && k === 'trunk' && sameStation) || (pk === 'feeder' && k === 'trunk') || (pk === 'trunk' && k === 'feeder');
        if (insidePaidArea) return;
      }
      basic += fare;
      if (start === null) { plus += fare; start = when; used = 0; return; }
      const elapsed = (when - start) / 60;
      const noFreeTransfer = pk === 'trunk' && k === 'trunk';
      const sameRoute = k === 'zonal' && prev.routeIdx === l.routeIdx;
      if (noFreeTransfer || sameRoute || elapsed > FARE_RULES.windowMin || used >= FARE_RULES.maxTransfers) {
        if (elapsed > FARE_RULES.windowMin) lateTransfer = true;
        if (noFreeTransfer) stationWalk = true;
        plus += fare; start = when; used = 0;
        return;
      }
      used++; transferMin = Math.max(transferMin, elapsed);
    });
    return { plus, basic, lateTransfer, stationWalk, transferMin: Math.round(transferMin), windowMin: FARE_RULES.windowMin, feeder: rides.some(l => l.agency === 2) };
  }

  function create(net) {
    const S = net.stops, N = S.n.length;
    const routes = net.routes.map(r => { const [bg, fg] = legible(r[2], r[3]), c = r.slice(); c[2] = bg; c[3] = fg; return c; });
    const lat = S.a.map(v => v / 1e5), lon = S.o.map(v => v / 1e5);
    const P = net.patterns.map(p => {
      const cum = new Int32Array(p.s.length);
      p.t.forEach((v, i) => { cum[i + 1] = cum[i] + v * 10; });
      return { route: p.r, code: p.c, dest: p.d, signs: p.x || null, stops: p.s, cum,
        cnt: p.h.map(x => Array.from(x, c => B62I[c])), fac: p.m.map(x => Array.from(x, c => B62I[c] / 40)),
        first: p.f.map(v => v * 60), last: p.l.map(v => v * 60) };
    });
    // What the bus says at this point of its trip: on a round trip the sign changes halfway (A153 Centro, then C153 Suba).
    const signAt = (p, pos) => {
      let code = p.code, dest = p.dest;
      if (p.signs) for (const [from, c, d] of p.signs) if (pos >= from) { code = c; dest = d; }
      return { code, dest };
    };
    // Regulation points are where buses wait between trips. They appear in the file like any stop, but nobody gets on or off there.
    const NO_RIDERS = /regulaci/i, ridersUse = s => !NO_RIDERS.test(S.n[s]);
    const atStop = Array.from({ length: N }, () => []);
    P.forEach((p, i) => p.stops.forEach((s, pos) => { if (ridersUse(s)) atStop[s].push(i, pos); }));

    // Spatial grid for walking links.
    const CELL = 0.004, cells = new Map(), key = (a, o) => Math.floor(a / CELL) * 100000 + Math.floor((o + 80) / CELL);
    for (let i = 0; i < N; i++) { if (S.k[i]) continue; const k = key(lat[i], lon[i]); (cells.get(k) || cells.set(k, []).get(k)).push(i); }
    function near(a, o, meters) {
      const out = [], span = Math.ceil(meters / 420);
      const ca = Math.floor(a / CELL), co = Math.floor((o + 80) / CELL);
      for (let x = -span; x <= span; x++) for (let y = -span; y <= span; y++) {
        const list = cells.get((ca + x) * 100000 + co + y); if (!list) continue;
        for (const i of list) { const m = hav(a, o, lat[i], lon[i]); if (m <= meters) out.push(i, m); }
      }
      return out;
    }
    const stationOf = i => S.p[i] >= 0 ? S.p[i] : -1;
    const children = Array.from({ length: N }, () => []);
    for (let i = 0; i < N; i++) if (S.p[i] >= 0) children[S.p[i]].push(i);

    // Walking links between stops. Built on the first search, because the page's main thread may never need them.
    let links = null;
    function ensureLinks() {
      if (links) return;
      links = Array.from({ length: N }, () => []);
      for (let i = 0; i < N; i++) {
        if (S.k[i] || !atStop[i].length) continue;
        const si = stationOf(i), n = near(lat[i], lon[i], TRANSFER_RADIUS);
        for (let j = 0; j < n.length; j += 2) {
          const o = n[j]; if (o === i || !atStop[o].length) continue;
          const so = stationOf(o), same = si >= 0 && si === so;
          const sec = same ? SAME_STATION : walkSec(n[j + 1]) + (so >= 0 ? STATION_ENTRY : 0);
          links[i].push(o, sec);
        }
        if (si >= 0) for (const o of children[si]) if (o !== i && atStop[o].length && !links[i].includes(o)) links[i].push(o, SAME_STATION);
      }
    }

    function boardAt(p, pos, t, day) {
      const startT = t - p.cum[pos];
      if (p.last[day] < 0 || startT > p.last[day]) return null;
      const from = Math.max(startT, p.first[day]);
      const lead = from - startT;
      let h = Math.floor(from / 3600);
      if (h < 0) h = 0;
      for (let tries = 0; h < HOURS && tries < 3; h++, tries++) {
        const c = p.cnt[day][h];
        if (c > 0) {
          const hw = 3600 / c, late = Math.max(lead, h * 3600 - startT);
          return { wait: late + Math.min(hw / 2, Math.max(0, p.last[day] - (startT + late)) || hw / 2), hw, factor: p.fac[day][h] || 1, nearLast: p.last[day] - startT < 1800 };
        }
      }
      return null;
    }

    function access(place, maxSec) {
      const out = new Map();
      const add = (s, sec) => { if (atStop[s].length && sec <= maxSec && !(out.get(s) <= sec)) out.set(s, sec); };
      const meters = maxSec * WALK_MPS / DETOUR;
      const n = near(place.lat, place.lon, meters);
      for (let j = 0; j < n.length; j += 2) add(n[j], walkSec(n[j + 1]) + (stationOf(n[j]) >= 0 ? STATION_ENTRY : 0));
      if (place.station >= 0) for (const c of children[place.station]) out.set(c, Math.min(out.get(c) ?? Infinity, 60));
      if (place.stop >= 0 && atStop[place.stop].length) out.set(place.stop, 0);
      return out;
    }

    function search(from, to, day, t0, maxK, maxWalk, ban) {
      ensureLinks();
      const arr = [new Float64Array(N).fill(Infinity)], parP = [null], parB = [null], parA = [null], parW = [null];
      const orig = access(from, maxWalk), dest = access(to, maxWalk);
      let marked = [];
      for (const [s, sec] of orig) { arr[0][s] = t0 + sec; marked.push(s); }
      for (let k = 1; k <= maxK; k++) {
        const prev = arr[k - 1], cur = prev.slice(), ride = new Float64Array(N).fill(Infinity);
        const pp = new Int32Array(N).fill(-1), pb = new Int32Array(N), pa = new Int32Array(N), pw = new Int32Array(N).fill(-1);
        const queue = new Map();
        for (const s of marked) { const a = atStop[s]; for (let i = 0; i < a.length; i += 2) { const q = queue.get(a[i]); if (q === undefined || a[i + 1] < q) queue.set(a[i], a[i + 1]); } }
        const improved = [];
        for (const [pi, startPos] of queue) {
          const p = P[pi]; if (ban && ban.has(p.route)) continue;
          let bPos = -1, bDep = 0, bFac = 1;
          for (let pos = startPos; pos < p.stops.length; pos++) {
            const s = p.stops[pos];
            let here = Infinity;
            if (bPos >= 0) {
              here = bDep + (p.cum[pos] - p.cum[bPos]) * bFac;
              if (here < ride[s] && here < cur[s]) { ride[s] = here; cur[s] = here; pp[s] = pi; pb[s] = bPos; pa[s] = pos; pw[s] = -1; improved.push(s); }
            }
            const ready = prev[s];
            if (ready < Infinity) {
              const r = ready + (k > 1 ? TRANSFER_BUFFER : 0), b = boardAt(p, pos, r, day);
              if (b && r + b.wait < here) { bPos = pos; bDep = r + b.wait; bFac = b.factor; }
            }
          }
        }
        // Walk once after each ride. A walk never chains into another walk.
        const next = new Set(improved);
        for (const s of new Set(improved)) {
          const l = links[s];
          for (let i = 0; i < l.length; i += 2) {
            const o = l[i], t = ride[s] + l[i + 1];
            if (t < cur[o]) { cur[o] = t; pw[o] = s; pp[o] = -1; next.add(o); }
          }
        }
        arr.push(cur); parP.push(pp); parB.push(pb); parA.push(pa); parW.push(pw);
        marked = [...next];
        if (!marked.length) break;
      }
      return { arr, parP, parB, parA, parW, orig, dest };
    }

    const place = i => {
      const st = S.p[i] >= 0 ? S.p[i] : -1;
      return { stop: i, station: st, name: st >= 0 ? S.n[st] : S.n[i], platform: st >= 0 ? S.n[i] : null, lat: lat[i], lon: lon[i] };
    };

    function trace(res, k, s, day, egress, t0) {
      const legs = [];
      let cursor = s, round = k;
      legs.unshift({ type: 'walk', sec: egress, end: true });
      while (round > 0) {
        if (res.parW[round][cursor] >= 0) {
          const w = res.parW[round][cursor];
          legs.unshift({ type: 'walk', sec: res.arr[round][cursor] - res.arr[round][w], fromStop: w, toStop: cursor });
          cursor = w; continue;
        }
        const pi = res.parP[round][cursor];
        if (pi < 0) { round--; continue; }
        const p = P[pi], bPos = res.parB[round][cursor], aPos = res.parA[round][cursor], board = p.stops[bPos];
        const ready = res.arr[round - 1][board] + (round > 1 ? TRANSFER_BUFFER : 0);
        const b = boardAt(p, bPos, ready, day);
        legs.unshift({ type: 'ride', pat: pi, bPos, aPos, board, alight: cursor, ready,
          wait: b ? b.wait : 0, hw: b ? b.hw : 0, nearLast: b ? b.nearLast : false, sec: (p.cum[aPos] - p.cum[bPos]) * (b ? b.factor : 1) });
        cursor = board; round--;
      }
      legs.unshift({ type: 'walk', sec: res.arr[0][cursor] - t0, start: true, toStop: cursor });
      return legs.filter(l => l.type === 'ride' || l.sec >= 20 || l.fromStop !== undefined);
    }

    // Routes that cover the same hop, which also shortens the real wait at the stop.
    function sameHop(leg, day) {
      const group = s => { const st = stationOf(s); return st >= 0 ? new Set(children[st]) : new Set([s]); };
      const from = group(leg.board), to = group(leg.alight), seen = new Map();
      let perHour = 0;
      for (const s of from) {
        const a = atStop[s];
        for (let i = 0; i < a.length; i += 2) {
          const p = P[a[i]], bPos = a[i + 1];
          for (let pos = bPos + 1; pos < p.stops.length; pos++) {
            if (!to.has(p.stops[pos])) continue;
            const b = boardAt(p, bPos, leg.ready, day);
            if (b && b.wait < 2400) {
              const sec = (p.cum[pos] - p.cum[bPos]) * b.factor;
              if (sec <= leg.sec * 1.3 + 180) {
                const sign = signAt(p, bPos), key = sign.code + '|' + sign.dest, old = seen.get(key);
                if (!old) { seen.set(key, { code: sign.code, dest: sign.dest, route: p.route, hw: b.hw, sec }); perHour += 3600 / b.hw; }
                else if (b.hw < old.hw) { perHour += 3600 / b.hw - 3600 / old.hw; old.hw = b.hw; }
              }
            }
            break;
          }
        }
      }
      return { list: [...seen.values()].sort((x, y) => y.hw === x.hw ? x.sec - y.sec : x.hw - y.hw), perHour };
    }

    function describe(res, k, stop, egress, day, t0) {
      const legs = trace(res, k, stop, day, egress, t0);
      const rides = legs.filter(l => l.type === 'ride');
      if (rides.length !== k) return null;
      let wait = 0, ride = 0, walk = (k - 1) * TRANSFER_BUFFER;
      for (const l of legs) {
        if (l.type === 'walk') { walk += l.sec; continue; }
        const p = P[l.pat], r = routes[p.route], hop = sameHop(l, day);
        const sign = signAt(p, l.bPos), later = signAt(p, l.aPos);
        l.code = sign.code; l.dest = sign.dest; l.color = '#' + r[2]; l.text = '#' + r[3]; l.agency = r[4]; l.routeIdx = p.route;
        // The rider stays on while the sign changes, and should not take that for the wrong bus.
        if (later.code !== sign.code) l.signChange = { code: later.code, dest: later.dest };
        l.boardPlace = place(l.board); l.alightPlace = place(l.alight); l.stopsCount = l.aPos - l.bPos;
        l.via = p.stops.slice(l.bPos, l.aPos + 1).filter(ridersUse).map(s => stationOf(s) >= 0 ? S.n[S.p[s]] : S.n[s]);
        l.also = hop.list.filter(x => !(x.code === sign.code && x.dest === sign.dest)).slice(0, 6);
        l.allRoutes = hop.list.map(x => x.route);
        // Several routes over the same hop mean less waiting than the single chosen route suggests.
        if (hop.perHour > 3600 / l.hw && l.wait <= l.hw) { l.hwAll = 3600 / hop.perHour; l.wait = Math.min(l.wait, l.hwAll / 2); }
        else l.hwAll = l.hw;
        wait += l.wait; ride += l.sec;
      }
      for (const l of legs) if (l.type === 'walk') { l.fromPlace = l.fromStop !== undefined ? place(l.fromStop) : null; l.toPlace = l.toStop !== undefined ? place(l.toStop) : null; }
      const option = { buses: k, legs, walk, wait, ride, total: walk + wait + ride, arrive: t0 + walk + wait + ride };
      option.fare = fareOf(option, net.meta.fare);
      return option;
    }

    function bestAt(res, k) {
      let best = Infinity, stop = -1, eg = 0;
      for (const [s, sec] of res.dest) { const t = res.arr[k] ? res.arr[k][s] + sec : Infinity; if (t < best) { best = t; stop = s; eg = sec; } }
      return stop < 0 ? null : { stop, eg };
    }

    function exact(from, to, day, t0, k, maxWalk, ban) {
      const res = search(from, to, day, t0, k, maxWalk, ban), b = bestAt(res, k);
      return b ? describe(res, k, b.stop, b.eg, day, t0) : null;
    }

    function plan(q) {
      const { from, to, day, time, maxBuses, maxWalk } = q;
      const walkDirect = walkSec(hav(from.lat, from.lon, to.lat, to.lon));
      const groups = [];
      for (let k = 1; k <= maxBuses; k++) {
        const opts = [], first = exact(from, to, day, time, k, maxWalk);
        if (first) {
          opts.push(first);
          // Look for genuinely different routes by excluding the ones already offered.
          const ban = new Set(), sig = o => o.legs.filter(l => l.type === 'ride').map(l => l.code).join('+');
          const seen = new Set([sig(first)]);
          let last = first;
          for (let i = 0; i < 2 * k + 1 && opts.length < 3; i++) {
            const rides = last.legs.filter(l => l.type === 'ride');
            (rides[i % rides.length].allRoutes || []).forEach(x => ban.add(x));
            const alt = exact(from, to, day, time, k, maxWalk, ban);
            if (!alt || alt.total > first.total + 1500) continue;
            if (!seen.has(sig(alt))) { seen.add(sig(alt)); opts.push(alt); }
            last = alt;
          }
        }
        groups.push({ buses: k, options: opts.sort((a, b) => a.total - b.total) });
      }
      const fastestFewer = k => { let t = Infinity; for (const g of groups) if (g.buses < k && g.options[0]) t = Math.min(t, g.options[0].total); return t; };
      for (const g of groups) if (g.options[0]) {
        const f = fastestFewer(g.buses);
        g.saves = f < Infinity ? f - g.options[0].total : null;
        // One more bus has to earn its place: under 5 minutes saved is not worth a transfer.
        g.worth = g.saves === null || g.saves >= 300;
      }
      const fewest = groups.find(g => g.options.length);
      let hint = null;
      if ((!groups[0] || !groups[0].options.length) && maxWalk < 1800) {
        const longer = exact(from, to, day, time, 1, 1800);
        if (longer) hint = { walkMin: Math.ceil(longer.walk / 60), option: longer };
      }
      return { groups, fewest: fewest ? fewest.buses : null, hint, walkDirect };
    }

    // What runs near a point right now, grouped by station or by stop name.
    function nearby(a, o, meters, day, time) {
      const n = near(a, o, meters), groups = new Map();
      for (let j = 0; j < n.length; j += 2) {
        const s = n[j], m = n[j + 1], st = stationOf(s);
        if (!atStop[s].length) continue;
        const key = st >= 0 ? 's' + st : 'n' + S.n[s];
        let g = groups.get(key);
        if (!g) { g = { name: st >= 0 ? S.n[st] : S.n[s], station: st, lat: st >= 0 ? lat[st] : lat[s], lon: st >= 0 ? lon[st] : lon[s], meters: m, routes: new Map() }; groups.set(key, g); }
        g.meters = Math.min(g.meters, m);
        const walk = walkSec(m) + (st >= 0 ? STATION_ENTRY : 0), list = atStop[s];
        for (let i = 0; i < list.length; i += 2) {
          const p = P[list[i]], pos = list[i + 1];
          if (pos === p.stops.length - 1) continue;
          const b = boardAt(p, pos, time + walk, day);
          if (!b || b.wait > 2400) continue;
          const sign = signAt(p, pos), k = sign.code + '|' + sign.dest, old = g.routes.get(k), r = routes[p.route];
          if (!old || b.hw < old.hw) g.routes.set(k, { code: sign.code, dest: sign.dest, hw: b.hw, color: '#' + r[2], text: '#' + r[3], agency: r[4] });
        }
      }
      return [...groups.values()].filter(g => g.routes.size)
        .map(g => ({ ...g, walkSec: walkSec(g.meters) + (g.station >= 0 ? STATION_ENTRY : 0), routes: [...g.routes.values()].sort((x, y) => x.hw - y.hw) }))
        .sort((x, y) => x.walkSec - y.walkSec);
    }

    // Ranks trips by what the rider said matters. Fewer buses is the default: that is the point of the app.
    // "Menos buses" must mean it: another bus only wins when it saves over 30 minutes.
    const WEIGHTS = { buses: { transfer: 1800, walk: 0.5 }, time: { transfer: 120, walk: 0 }, walk: { transfer: 300, walk: 10 } };
    function score(o, pref) {
      const w = WEIGHTS[pref] || WEIGHTS.buses;
      let s = o.total + (o.buses - 1) * w.transfer + o.walk * w.walk;
      for (const l of o.legs) if (l.type === 'ride') {
        if (l.hwAll > 1200) s += (l.hwAll - 1200) / 2; // rare buses are risky even if the estimate looks fine
        if (l.nearLast) s += 300;                       // missing the last bus strands the rider
      }
      return s;
    }
    function recommend(q) {
      const limit = q.limit, maxWalk = q.maxWalk, pref = q.pref || 'buses';
      const base = plan({ ...q, maxBuses: Math.min(3, limit + 1) });
      const seen = new Map(), add = o => { const k = o.legs.filter(l => l.type === 'ride').map(l => l.code + '@' + l.board + '>' + l.alight).join('+'); if (!seen.has(k) || o.total < seen.get(k).total) seen.set(k, o); };
      base.groups.filter(g => g.buses <= limit).forEach(g => g.options.forEach(add));
      // Offer shorter walks too, since the fastest trip at the rider's limit often uses all of it.
      if (maxWalk > 300) plan({ ...q, maxBuses: limit, maxWalk: 300 }).groups.forEach(g => g.options.forEach(add));
      const ranked = [...seen.values()].sort((a, b) => score(a, pref) - score(b, pref));
      return { ...base, ranked, fastest: ranked.length ? ranked.reduce((a, b) => (b.total < a.total ? b : a)) : null };
    }

    // Arrive by a given time: finds the latest departure that still makes it.
    // The wait is only an average, so it adds a margin for a bus that has just left (up to 15 minutes per bus).
    function safetyMargin(o) {
      return o.legs.reduce((s, l) => (l.type === 'ride' ? s + Math.max(0, Math.min(900, l.hwAll - l.wait)) : s), 0);
    }
    function arriveBy(q) {
      const target = q.arriveBy, pref = q.pref || 'buses';
      const quickBest = t => {
        let best = null, low = Infinity;
        for (let k = 1; k <= q.limit; k++) {
          const o = exact(q.from, q.to, q.day, t, k, q.maxWalk);
          if (o && score(o, pref) < low) { low = score(o, pref); best = o; }
        }
        return best;
      };
      let t = Math.max(0, target - 3600), found = null;
      for (let i = 0; i < 7; i++) {
        const o = quickBest(t);
        if (!o) { if (t <= 0) break; t = Math.max(0, t - 1800); continue; }
        const slack = target - (o.arrive + safetyMargin(o));
        if (slack >= 0) {
          if (found === null || t > found) found = t;
          if (slack <= 180) break;
          t += slack;
        } else {
          if (t <= 0) break;
          t = Math.max(0, t + slack - 60);
        }
      }
      if (found === null) {
        return { groups: [], ranked: [], fastest: null, fewest: null, hint: null, target, depart: null, margin: 0, walkDirect: walkSec(hav(q.from.lat, q.from.lon, q.to.lat, q.to.lon)) };
      }
      const r = recommend({ ...q, time: found });
      const inTime = r.ranked.filter(o => o.arrive <= target);
      return { ...r, ranked: inTime, target, depart: found, margin: inTime.length ? safetyMargin(inTime[0]) : 0 };
    }
    const solve = q => (q.arriveBy !== undefined && q.arriveBy !== null ? arriveBy(q) : recommend(q));

    function dayType(date) {
      const pad = n => String(n).padStart(2, '0');
      const ymd = date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate());
      if (net.holidays.includes(ymd)) return 2;
      const w = date.getDay();
      return w === 0 ? 2 : w === 6 ? 1 : 0;
    }

    return { plan, recommend, arriveBy, solve, nearby, dayType, place, lat, lon, P, stationOf, atStop, children, near, warm: ensureLinks, stops: S, routes, meta: net.meta };
  }

  const api = { create, legible, contrast, fareOf, FARE_RULES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BusEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
