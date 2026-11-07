// Sin Vueltas UI. Two targets share this code: the web app (GPS, addresses, real map, trip mode)
// and the embedded preview page (none of those, because its host blocks them).
window.SVBoot = function (networkText) {
  const WEB = window.SV_TARGET === 'web';
  const net = JSON.parse(networkText);
  const E = BusEngine.create(net), S = E.stops, N = S.n.length;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage may be blocked */ } },
  };

  const ICONS = {
    walk: '<circle cx="13.5" cy="4.5" r="1.9"/><path d="M12.6 8.6 9.6 12.2l2 3.2-1.4 6M12.6 8.6l2.2 3.6 3.4 1.4M11.6 15.4l3 1.8 1 4.4M9.6 12.2 7 13.6"/>',
    bus: '<rect x="5" y="3.5" width="14" height="14.5" rx="3"/><path d="M5 11.5h14M8 18v2.5M16 18v2.5M8.6 14.8h.01M15.4 14.8h.01"/>',
    pin: '<path d="M12 21.5s7-6.6 7-11.7a7 7 0 1 0-14 0c0 5.1 7 11.7 7 11.7z"/><circle cx="12" cy="9.8" r="2.4"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    map: '<path d="M9 4.5 3.5 7v12.5L9 17l6 2.5 5.5-2.5V4.5L15 7 9 4.5zM9 4.5V17M15 7v12.5"/>',
    go: '<path d="M8 5.5v13l10.5-6.5L8 5.5z" fill="currentColor"/>',
    check: '<path d="M5 12.5 10 17.5 19.5 7"/>',
    home: '<path d="M4 11.5 12 4.5l8 7M6.5 10v9.5h11V10"/>',
    work: '<rect x="4" y="8" width="16" height="11.5" rx="2.5"/><path d="M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>',
    target: '<circle cx="12" cy="12" r="4"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
    down: '<path d="m6 9.5 6 6 6-6"/>',
    recent: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  };
  const icon = name => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

  // ---------- route calculation off the main thread ----------
  // On a slow phone one recommendation can take close to a second, which would freeze scrolling and taps.
  // A worker does the calculation. If workers are missing or fail, the page does it itself, so a route always appears.
  function workerMain() {
    let engine = null;
    self.onmessage = e => {
      const m = e.data;
      if (m.init) { engine = BusEngine.create(JSON.parse(m.init)); engine.warm(); return; }
      try { self.postMessage({ id: m.id, result: engine.solve(m.q) }); } catch (err) { self.postMessage({ id: m.id, failed: String(err) }); }
    };
  }
  const Planner = (function () {
    const pending = new Map();
    let worker = null, seq = 0, usedWorker = 0, usedPage = 0;
    const onPage = q => { usedPage++; return E.solve(q); };
    function stopWorker() {
      worker = null;
      for (const [id, p] of pending) { pending.delete(id); clearTimeout(p.limit); p.resolve(onPage(p.q)); }
    }
    try {
      const source = document.getElementById('engineSrc').textContent + `\n;(${workerMain.toString()})();`;
      worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
      worker.onerror = stopWorker;
      worker.onmessage = e => {
        const p = pending.get(e.data.id);
        if (!p) return;
        pending.delete(e.data.id); clearTimeout(p.limit);
        if (e.data.failed) p.resolve(onPage(p.q)); else { usedWorker++; p.resolve(e.data.result); }
      };
      worker.postMessage({ init: networkText });
    } catch (e) { worker = null; }
    return {
      recommend(q) {
        if (!worker) return new Promise(resolve => setTimeout(() => resolve(onPage(q)), 0));
        return new Promise(resolve => {
          const id = ++seq;
          // A worker that never answers must not leave the rider without a route.
          const limit = setTimeout(() => { if (pending.delete(id)) resolve(onPage(q)); }, 8000);
          pending.set(id, { resolve, q, limit });
          worker.postMessage({ id, q });
        });
      },
      stats: () => ({ worker: !!worker, usedWorker, usedPage }),
    };
  })();

  // ---------- names ----------
  const titleIfCaps = s => /[a-záéíóúñ]/.test(s) ? s : s.toLowerCase().replace(/(^|[\s.-])([a-záéíóúñ])/g, (m, a, b) => a + b.toUpperCase());
  const fullName = raw => titleIfCaps(String(raw)
    .replace(/^\d{3}[A-Z]\d{2}\s+/, '')
    .replace(/\bcra\.?\s*(?=\d)/gi, 'Carrera ')
    .replace(/\bBr\.?\s/gi, 'Barrio ').replace(/\bPq\.?\s/gi, 'Parque ').replace(/\bUrb\.?\s/gi, 'Urbanización ')
    .replace(/\bCdad\.?\s/gi, 'Ciudad ').replace(/\bAC\s*(?=\d)/g, 'Av. Calle ').replace(/\bAK\s*(?=\d)/g, 'Av. Carrera ')
    .replace(/\bCL\s*(?=\d)/gi, 'Calle ').replace(/\bKR\s*(?=\d)/gi, 'Carrera ').replace(/\bK\s*(?=\d)/g, 'Carrera ')
    .replace(/\bDG\s*(?=\d)/gi, 'Diagonal ').replace(/\bTV\s*(?=\d)/gi, 'Transversal ').replace(/\bAV\.?\s/gi, 'Av. ')
    .replace(/^P\.\s?/, 'Portal ').replace(/\s+/g, ' ').trim());
  // Many stations carry a sponsor after the dash and get cut off on small screens ("Portal Sur - JFK Coop. Finan…").
  // The second part stays only when it tells stations apart, as in "Suba - Calle 95".
  const KEEP_BOTH = /^(guatoque|tibanica)\b/i, STREET = /^(calle|carrera|transversal|diagonal|av\.?)(\s|$)/i;
  function stationShort(full) {
    const parts = full.split(/\s[-–]\s/);
    if (parts.length < 2) return full;
    if (/^c\.?\s?c\.?\s/i.test(parts[0])) return parts[1]; // "C.C Paseo Villa Del Rio - Madelena"
    return STREET.test(parts[1]) || KEEP_BOTH.test(parts[0]) ? full : parts[0];
  }
  const stationRaw = new Set(S.n.filter((_, i) => S.k[i] === 1));
  const pretty = raw => (stationRaw.has(raw) ? stationShort(fullName(raw)) : fullName(raw));
  const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const ALIAS = { cl: 'calle', cll: 'calle', kr: 'carrera', kra: 'carrera', cra: 'carrera', cr: 'carrera', br: 'barrio', pq: 'parque', avenida: 'av', dg: 'diagonal', tv: 'transversal' };
  const STOPWORDS = new Set(['de', 'del', 'la', 'el', 'las', 'los', 'y', 'con']);
  const tokens = s => norm(s).split(' ').filter(Boolean).map(t => ALIAS[t] || t);
  const dist = (a1, o1, a2, o2) => { const r = Math.PI / 180, x = (a2 - a1) * r, y = (o2 - o1) * r * Math.cos((a1 + a2) * r / 2); return 6371000 * Math.sqrt(x * x + y * y); };

  // ---------- searchable places ----------
  const served = i => E.children[i].some(c => E.atStop[c].length);
  const stationIdx = []; for (let i = 0; i < N; i++) if (S.k[i] === 1) stationIdx.push(i);
  const stationsServed = stationIdx.filter(served);
  const servedNames = new Set(stationsServed.map(i => norm(fullName(S.n[i]))));
  const nearestStation = (a, o) => { let b = -1, d = 1e12; for (const i of stationsServed) { const m = dist(a, o, E.lat[i], E.lon[i]); if (m < d) { d = m; b = i; } } return { i: b, m: d }; };
  const distLabel = m => m < 950 ? Math.max(50, Math.round(m / 50) * 50) + ' m' : (m / 1000).toFixed(1).replace('.', ',') + ' km';

  const places = [];
  for (const i of stationIdx) {
    const ok = served(i);
    if (!ok && servedNames.has(norm(fullName(S.n[i])))) continue; // a served twin of this station already exists
    if (/ old$/i.test(S.n[i])) continue;
    const name = pretty(S.n[i]), full = fullName(S.n[i]);
    // The search also knows the sponsor's name, since people may look for it.
    places.push({ kind: 'station', station: i, stop: -1, name, full, lat: E.lat[i], lon: E.lon[i], noService: !ok, tok: tokens(full) });
  }
  const byName = new Map();
  for (let i = 0; i < N; i++) {
    if (S.k[i] || S.p[i] >= 0 || !E.atStop[i].length || /regulaci|plat ?\d|plt\b/i.test(S.n[i])) continue;
    const name = pretty(S.n[i]);
    if (/^\d+-\d+$/.test(name)) continue;
    const key = norm(name);
    (byName.get(key) || byName.set(key, []).get(key)).push(i);
  }
  for (const list of byName.values()) {
    // A barrio has stops spread over several blocks, so it merges over a wider radius than a street name.
    const clusters = [], radius = /^barrio /i.test(pretty(S.n[list[0]])) ? 800 : 250;
    for (const i of list) {
      const c = clusters.find(c => dist(c.lat, c.lon, E.lat[i], E.lon[i]) < radius);
      if (c) { c.n++; c.lat += (E.lat[i] - c.lat) / c.n; c.lon += (E.lon[i] - c.lon) / c.n; } else clusters.push({ lat: E.lat[i], lon: E.lon[i], n: 1 });
    }
    const name = pretty(S.n[list[0]]), tok = tokens(name);
    for (const c of clusters) places.push({ kind: 'stop', station: -1, stop: -1, name, lat: c.lat, lon: c.lon, tok });
  }
  // True when two words differ by at most `max` letters, so "tobrin" still finds Toberín.
  function closeEnough(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return false;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let low = i;
      for (let j = 1; j <= b.length; j++) {
        const c = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        cur[j] = c;
        if (c < low) low = c;
      }
      if (low > max) return false;
      prev = cur;
    }
    return prev[b.length] <= max;
  }
  function matchPlaces(q, tolerant) {
    let want = tokens(q).filter(t => !STOPWORDS.has(t));
    if (!want.length) want = tokens(q);
    if (!want.length) return [];
    const out = [];
    for (const p of places) {
      let score = 0, ok = true;
      for (const w of want) {
        let hit = p.tok.findIndex(t => t.startsWith(w));
        // Numbers must match exactly: Calle 72 is not Calle 73.
        if (hit < 0 && tolerant && w.length >= 4 && !/\d/.test(w)) {
          const max = w.length >= 8 ? 2 : 1;
          hit = p.tok.findIndex(t => closeEnough(w, t, max) || closeEnough(w, t.slice(0, w.length), max));
        }
        if (hit < 0) { ok = false; break; }
        score += hit === 0 ? 0 : 1;
      }
      if (ok) out.push([score + (p.kind === 'station' ? 0 : 2) + (p.noService ? 1 : 0) + p.name.length / 200, p]);
    }
    return out;
  }
  function searchPlaces(q, limit, exactOnly) {
    const alias = BusGeo.canonical(q), found = new Map();
    for (const text of alias ? [q, alias] : [q]) for (const [s, p] of matchPlaces(text, false)) if (!found.has(p) || s < found.get(p)) found.set(p, s);
    if (!exactOnly && found.size < 5) for (const [s, p] of matchPlaces(q, true)) if (!found.has(p)) found.set(p, s + 3);
    return [...found].sort((a, b) => a[1] - b[1]).slice(0, limit || 40).map(x => x[0]);
  }
  // A station without routes in the official file: where to go instead.
  // Why these names: press and city notes from 2023 to 2026 tie their closures to Metro Line 1 works. Recheck them with each publication.
  const METRO_WORKS = /^(hospital|tercer milenio|calle 19|calle 34|calle 45|marly|calle 63|calle 76|sena)\b/i;
  const nearestServed = p => {
    const n = nearestStation(p.lat, p.lon), place = places.find(x => x.kind === 'station' && x.station === n.i);
    return place ? { place, m: n.m } : null;
  };
  const subLabel = p => {
    if (p.sub !== undefined) return p.sub || 'Dirección o lugar';
    if (p.kind === 'station' && p.noService) {
      const alt = nearestServed(p);
      return `Sin rutas por ahora${alt ? ` · la más cercana con servicio es ${alt.place.name}` : ''}`;
    }
    if (p.kind === 'station') return p.full && p.full !== p.name ? `Estación · ${p.full}` : 'Estación de TransMilenio';
    const n = nearestStation(p.lat, p.lon);
    return `Paradero · a ${distLabel(n.m)} de ${pretty(S.n[n.i])}`;
  };
  const plain = p => ({ name: p.name, station: p.station, stop: p.stop, lat: p.lat, lon: p.lon, kind: p.kind, noService: !!p.noService });
  // Station indexes change with each data update, so saved places are matched again by position.
  function rehydrate(p) {
    if (!p) return null;
    if (p.kind !== 'station') return { ...p, station: -1, stop: -1 };
    const match = places.filter(x => x.kind === 'station' && (norm(x.name) === norm(p.name) || norm(x.full) === norm(p.name)))[0];
    if (match) return plain(match);
    return { ...p, kind: 'geo', station: -1, stop: -1 };
  }

  // ---------- time ----------
  function bogotaNow() {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
    const v = {}; f.formatToParts(new Date()).forEach(p => { v[p.type] = +p.value; });
    return { date: new Date(v.year, v.month - 1, v.day), sec: v.hour * 3600 + v.minute * 60 };
  }
  const clock = sec => { const s = ((sec % 86400) + 86400) % 86400; let h = Math.floor(s / 3600); const m = Math.floor(s % 3600 / 60), ap = h < 12 ? 'a. m.' : 'p. m.'; h = h % 12 || 12; return `${h}:${String(m).padStart(2, '0')} ${ap}`; };
  const mins = s => Math.max(1, Math.round(s / 60));
  const DAYS = ['día hábil', 'sábado', 'domingo o festivo'];
  const PREF = { buses: 'Menos buses', time: 'Más rápido', walk: 'Caminar menos' };
  const busWord = n => n === 1 ? '1 bus' : n + ' buses';

  // ---------- state ----------
  const SAVE = 'sinvueltas.v2', saved = store.get(SAVE, null);
  const pick = q => plain(places.find(p => p.kind === 'station' && norm(p.name).startsWith(q)));
  // Coming back hours later usually means a new trip, so the app asks again. The last destinations stay one tap away.
  const FRESH_MS = 3 * 3600000, fresh = !!saved && Date.now() - (saved.at || 0) < FRESH_MS;
  const state = {
    from: saved ? rehydrate(saved.from) : null,
    to: fresh ? rehydrate(saved.to) : null,
    fromGps: saved ? !!saved.fromGps : WEB,
    limit: saved && saved.limit || 2, walk: saved && saved.walk || 10, pref: saved && saved.pref || 'buses',
    card: saved && saved.card || 'unknown', voice: !(saved && saved.voice === false),
    lite: saved && saved.lite || 'auto', glance: !(saved && saved.glance === false), mapDark: !!(saved && saved.mapDark),
    mode: 'now', day: 0, time: '08:00', example: false,
    lastTo: (saved && saved.lastTo || []).map(rehydrate),
    recent: (saved && saved.recent || []).map(r => ({ key: r.key, from: rehydrate(r.from), to: rehydrate(r.to) })),
    favs: { casa: saved && saved.favs ? rehydrate(saved.favs.casa) : null, trabajo: saved && saved.favs ? rehydrate(saved.favs.trabajo) : null },
    gps: null, gpsState: 'idle', savingFav: null, formOpen: false,
  };
  // Coordinates are never stored: only whether the rider chose "my location" as the origin.
  const persist = () => {
    if (state.example) return;
    const slim = p => (p && p.kind !== 'gps' ? plain(p) : null);
    store.set(SAVE, { at: Date.now(), from: slim(state.from), to: slim(state.to), fromGps: state.from ? state.from.kind === 'gps' : state.fromGps, limit: state.limit, walk: state.walk, pref: state.pref, card: state.card, voice: state.voice, lite: state.lite, glance: state.glance, mapDark: state.mapDark,
      lastTo: state.lastTo.map(plain), recent: state.recent.map(r => ({ key: r.key, from: plain(r.from), to: plain(r.to) })), favs: { casa: slim(state.favs.casa), trabajo: slim(state.favs.trabajo) } });
  };
  // Light mode: the head script reads the phone's signals, and the rider can override them from the footer.
  const isLite = () => state.lite === 'on' || (state.lite !== 'off' && !!window.SVLite.signal);
  function applyLite() {
    if (isLite()) document.documentElement.setAttribute('data-lite', '');
    else { document.documentElement.removeAttribute('data-lite'); window.SVLite.font(); }
  }
  function remember() {
    if (state.to && state.to.kind !== 'gps') state.lastTo = [state.to, ...state.lastTo.filter(p => p.name !== state.to.name)].slice(0, 4);
    if (!state.from || !state.to || state.from.kind === 'gps' && !state.to) return;
    const fixed = state.from.kind === 'gps' ? null : state.from;
    if (!fixed) return; // "my location" is not a fixed trip worth listing
    const key = fixed.name + '>' + state.to.name;
    state.recent = [{ key, from: fixed, to: state.to }, ...state.recent.filter(r => r.key !== key)].slice(0, 4);
  }

  // ---------- location ----------
  const gpsPlace = () => ({ kind: 'gps', station: -1, stop: -1, name: 'Tu ubicación', lat: state.gps.lat, lon: state.gps.lon });
  function nearestLabel(lat, lon) {
    const st = nearestStation(lat, lon);
    if (st.m < 300) return pretty(S.n[st.i]);
    const n = E.near(lat, lon, 500);
    let best = -1, bd = 1e9;
    for (let j = 0; j < n.length; j += 2) if (n[j + 1] < bd && S.p[n[j]] < 0) { bd = n[j + 1]; best = n[j]; }
    return best >= 0 ? pretty(S.n[best]) : pretty(S.n[st.i]);
  }
  const inCoverage = g => E.near(g.lat, g.lon, 3000).length > 0;
  function locate() {
    if (!WEB || !navigator.geolocation) { state.gpsState = 'unavailable'; return Promise.resolve(null); }
    state.gpsState = 'asking';
    return new Promise(res => navigator.geolocation.getCurrentPosition(
      pos => { state.gps = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy, at: Date.now() }; state.gpsState = 'ok'; res(state.gps); },
      err => { state.gpsState = err.code === 1 ? 'denied' : 'failed'; res(null); },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }));
  }
  async function useMyLocation(which) {
    target = which || target;
    const field = target;
    $('picker').hidden = true; $('mapSheet').hidden = true;
    render();
    const g = await locate();
    if (g) { state[field] = gpsPlace(); if (field === 'from') state.fromGps = true; state.example = false; if (state.mode === 'pick') state.mode = 'now'; persist(); }
    render();
    // Without a position the trip can still go on: the rider says what they are near.
    if (!g && field === 'from' && state.to) openPicker('from');
  }
  function gpsProblem() {
    if (state.gpsState === 'denied') return 'No tenemos permiso para ver tu ubicación. Dinos cerca de qué estás, o actívala en los ajustes del navegador para este sitio.';
    if (state.gpsState === 'failed') return 'No pudimos ubicarte. Dinos cerca de qué estás, o revisa que el GPS esté encendido.';
    if (state.gpsState === 'unavailable') return 'Este navegador no puede darnos tu ubicación. Dinos cerca de qué estás.';
    return '';
  }

  // ---------- form rendering ----------
  const fromLine = () => {
    if (state.gpsState === 'asking' && (!state.from || state.from.kind === 'gps')) return 'Buscando tu ubicación…';
    if (state.from) return state.from.kind === 'gps' ? `Sales de tu ubicación · cerca de ${nearestLabel(state.from.lat, state.from.lon)}` : `Sales de ${state.from.name}`;
    return WEB && !gpsProblem() ? 'Sales de tu ubicación' : 'Elige de dónde sales';
  };
  function renderForm() {
    const setField = (id, p, ph) => {
      const el = $(id).querySelector('span');
      if (p && p.kind === 'gps') el.textContent = `Tu ubicación · cerca de ${nearestLabel(p.lat, p.lon)}`;
      else el.textContent = p ? p.name : ph;
      el.className = p ? '' : 'empty';
    };
    const locating = state.gpsState === 'asking';
    setField('fromField', state.from, locating ? 'Buscando tu ubicación…' : (WEB ? 'Toca para usar tu ubicación' : 'Elige de dónde sales'));
    setField('toField', state.to, 'Toca para elegir');
    $('ask').textContent = state.from && state.to ? 'Cambia tu viaje' : state.to ? '¿De dónde sales?' : '¿Para dónde vas?';
    document.querySelectorAll('[data-limit]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.limit === state.limit)));
    document.querySelectorAll('[data-walk]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.walk === state.walk)));
    document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
    document.querySelectorAll('[data-pref]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pref === state.pref)));
    document.querySelectorAll('[data-card]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.card === state.card)));
    $('when').hidden = state.mode === 'now';
    $('day').value = String(state.day); $('time').value = state.time;
    $('optsLabel').textContent = `${PREF[state.pref]} · caminas hasta ${state.walk} min · ${state.mode === 'now' ? 'sales ahora' : currentQuery().sum}`;
    // With a complete trip, the phone shows one summary line so the answer fits on the first screen.
    const hasTrip = !!(state.from && state.to), collapsed = hasTrip && !state.formOpen;
    $('panel').classList.toggle('is-first', !hasTrip);
    $('panel').classList.toggle('is-collapsed', collapsed);
    $('panel').classList.toggle('has-trip', hasTrip);
    if (!hasTrip) {
      $('destText').textContent = state.to ? state.to.name : 'Busca un lugar, dirección o estación';
      $('destText').className = state.to ? '' : 'empty';
      $('fromText').textContent = fromLine();
      const chips = [];
      if (!state.to) {
        const hour = Math.floor(bogotaNow().sec / 3600), order = hour < 12 ? ['trabajo', 'casa'] : ['casa', 'trabajo'];
        for (const k of order) if (state.favs[k]) chips.push(`<button type="button" class="chip" data-go-fav="${k}">${icon(k === 'casa' ? 'home' : 'work')}<span>${k === 'casa' ? 'Casa' : 'Trabajo'}</span></button>`);
        state.lastTo.forEach((p, i) => { if (chips.length < 3 && ![state.favs.casa, state.favs.trabajo].some(f => f && f.name === p.name)) chips.push(`<button type="button" class="chip" data-go-last="${i}">${icon('recent')}<span>${esc(p.name)}</span></button>`); });
      }
      $('quick').hidden = !chips.length;
      $('quick').innerHTML = chips.join('');
    }
    document.body.classList.toggle('trip-view', collapsed);
    if (hasTrip) {
      const q = currentQuery();
      $('sumRoute').textContent = `${state.from.kind === 'gps' ? 'Tu ubicación' : state.from.name} → ${state.to.name}`;
      $('sumOpts').textContent = `Máximo ${busWord(state.limit)} · ${q.sum}`;
    }
    const currentKey = state.from && state.to ? state.from.name + '>' + state.to.name : '';
    const others = state.recent.filter(r => r.key !== currentKey);
    $('recent').hidden = !others.length;
    $('recentList').innerHTML = others.map(r => `<button type="button" data-recent="${esc(r.key)}">${esc(r.from.name)} → ${esc(r.to.name)}</button>`).join('');
  }

  // ---------- results ----------
  const plate = (code, color, text, sm) => `<span class="plate${sm ? ' sm' : ''}" style="background:${esc(color)};color:${esc(text)}">${esc(code)}</span>`;
  const routeColors = r => { const x = E.routes[r]; return ['#' + x[2], '#' + x[3]]; };
  const SVC = { 1: 'Troncal', 2: 'Alimentador', 3: 'Zonal', 4: 'Complementario', 5: 'Especial', 6: 'Dual', 7: 'TransMiCable' };
  let lastOptions = [];

  const giveUpMin = l => Math.min(45, Math.max(10, Math.round((2 * l.hwAll + 300) / 300) * 5));
  const planB = l => (l.also.length ? `toma el ${l.also[0].code}, que también te sirve` : 'busca otra ruta desde ahí: puede haber un cierre o un desvío');
  function stepsHtml(o) {
    const out = [];
    const walkStep = html => out.push(`<li class="step walk"><div class="rail"></div><div class="step-body">${html}</div></li>`);
    const rides = o.legs.filter(l => l.type === 'ride');
    o.legs.forEach(l => {
      if (l.type === 'walk') {
        if (l.start) {
          const b = rides[0].boardPlace;
          const origin = state.from.kind === 'gps' ? 'tu ubicación' : state.from.name;
          if (l.sec > 75) walkStep(`<p class="step-title">Camina ${mins(l.sec)} min</p><p class="step-meta">${walkRoute(origin, pretty(b.name))}</p>`);
        } else if (l.end) {
          const a = rides[rides.length - 1].alightPlace;
          if (l.sec > 75) walkStep(`<p class="step-title">Camina ${mins(l.sec)} min</p><p class="step-meta">${walkRoute(pretty(a.name), state.to.name)}</p>`);
        } else {
          const same = l.fromPlace.station >= 0 && l.fromPlace.station === l.toPlace.station;
          walkStep(same
            ? `<p class="step-title">Transbordo dentro de la estación</p><p class="step-meta">Cambia de plataforma en ${esc(pretty(l.fromPlace.name))}, cerca de ${mins(l.sec)} min</p>`
            : `<p class="step-title">Camina ${mins(l.sec)} min para el siguiente bus</p><p class="step-meta">De ${esc(pretty(l.fromPlace.name))} a ${esc(pretty(l.toPlace.name))}</p>`);
        }
        return;
      }
      const also = l.also.length ? `<p class="step-meta">También te sirven: ${l.also.map(x => { const c = routeColors(x.route); return plate(x.code, c[0], c[1], true); }).join(' ')}</p>` : '';
      const freq = l.also.length ? `Entre todas pasa un bus cada ~${mins(l.hwAll)} min` : `Pasa cada ~${mins(l.hwAll)} min`;
      const via = [...new Set(l.via.map(pretty))];
      out.push(`<li class="step" style="--rail:${esc(l.color)}"><div class="rail"></div><div class="step-body">
        <p>${plate(l.code, l.color, l.text)} <span class="step-title">hacia ${esc(pretty(l.dest))}</span></p>
        <p class="step-meta">${SVC[l.agency] || 'Bus'} · súbete en <b>${esc(pretty(l.boardPlace.name))}</b>${l.boardPlace.platform ? `, ${esc(platformLabel(l.boardPlace.platform))}` : ''}</p>
        <p class="step-meta">${freq}. Espera estimada: ${mins(l.wait)} min</p>${also}
        <p class="step-meta">Si en ${giveUpMin(l)} min no ha pasado, ${planB(l)}.</p>
        ${l.signChange ? `<p class="warn">En el camino su letrero cambia a ${esc(l.signChange.code)}. Es el mismo bus: sigue hasta tu parada.</p>` : ''}
        ${l.nearLast ? '<p class="warn">Es de los últimos buses del día en esta ruta</p>' : ''}
        ${l.hwAll >= 1500 && !l.nearLast ? '<p class="warn">Pasa poco a esta hora. Llega con tiempo</p>' : ''}
        <p class="step-meta">${mins(l.sec)} min en el bus · bájate en <b>${esc(pretty(l.alightPlace.name))}</b></p>
        <details class="via"><summary>Ver las ${via.length} paradas</summary><ol>${via.map(v => `<li>${esc(v)}</li>`).join('')}</ol></details>
      </div></li>`);
    });
    return out.join('');
  }
  const money = n => '$' + String(n).replace(/\B(?=(\d{3})+$)/g, '.');
  // The file names platforms "Alcalá C - 2 ó 5": car C, doors 2 or 5. A trailing "-T" marks a temporary station.
  function platformLabel(raw) {
    if (!raw) return '';
    const text = String(raw).trim(), temporary = /-\s*T\.?$/.test(text);
    // Lowercase endings such as "-nw" are internal tags of the file, not part of what the sign says.
    const clean = text.replace(/\.\s*$/, '').replace(/-\s*T\.?$/, '').replace(/-\s*(?:[a-z]{1,3}|NW)$/, '').trim();
    const m = clean.match(/\s([A-H])\s*-?\s*(\d)(?:\s*(?:ó|o|y)\s*(\d))?(?:\s+[IV]+)?\s*$/);
    if (m) return `vagón ${m[1]}, ${m[3] ? `puertas ${m[2]} o ${m[3]}` : `puerta ${m[2]}`}${temporary ? ', estación temporal' : ''}`;
    const feeder = clean.match(/Alim\.?\s*Plat\.?\s*(\d+)/i);
    if (feeder) return `plataforma de alimentadores ${feeder[1]}`;
    const numbered = clean.match(/\b(?:PLT|Plat)\.?\s*(\d+)$/i);
    if (numbered) return `plataforma ${numbered[1]}`;
    const bay = clean.match(/\s(T-?\d+[A-Z]?(?:\s?[A-Z])?)\.?$/);
    if (bay) return `plataforma ${bay[1].replace(/[\s-]/g, '')}`;
    return pretty(text);
  }

  // What this rider pays. The difference between cards appears only when it exists, and "No sé" shows both.
  function priceOf(o) {
    const f = o.fare;
    if (!f) return { chip: '', note: '', warn: '' };
    const differs = f.plus !== f.basic;
    let chip = money(f.plus), note = '';
    if (differs && state.card === 'plus') note = `Con tu tarjeta personalizada. Sin ella serían ${money(f.basic)}.`;
    else if (differs && state.card === 'other') { chip = money(f.basic); note = `Con tarjeta personalizada serían ${money(f.plus)}.`; }
    else if (differs) { chip = `${money(f.plus)} o ${money(f.basic)}`; note = `${money(f.plus)} con tarjeta personalizada y ${money(f.basic)} sin ella.`; }
    if (f.stationWalk) note += ' Hay que salir de una estación y entrar a otra, y eso se cobra de nuevo.';
    let warn = '';
    if (f.lateTransfer) warn = `Tu transbordo llegaría después de los ${f.windowMin} minutos, así que pagarías otro pasaje.`;
    else if (f.transferMin >= f.windowMin - 10) warn = `Tu transbordo sería a los ${f.transferMin} minutos, muy cerca del límite de ${f.windowMin}. Si te demoras, pagarías otro pasaje.`;
    return { chip, note: note.trim(), warn, ask: differs && state.card === 'unknown' };
  }
  function cardHtml(o, open, tag, reasons) {
    const id = lastOptions.push(o) - 1;
    const rides = o.legs.filter(l => l.type === 'ride'), price = priceOf(o);
    const start2 = `<button type="button" class="btn primary" data-follow="${id}">${icon('go')}Iniciar viaje</button>`;
    const actions = `<div class="card-actions">${start2}<button type="button" class="btn" data-map-option="${id}">${icon('map')}Ver en el mapa</button></div>`;
    const priceNote = `${price.note ? `<p class="fare-note">${esc(price.note)}</p>` : ''}${price.warn ? `<p class="warn">${esc(price.warn)}</p>` : ''}`;
    const head = `<div class="head"><span class="big">${mins(o.total)} <small>min</small></span><span class="arrive">Llegas ~${clock(o.arrive)}</span></div>
        ${tripStrip(o)}
        <p class="meta"><b class="price">${esc(price.chip)}</b> · caminas ${mins(o.walk)} min · esperas ~${mins(o.wait)} min</p>`;
    if (!open) {
      return `<details class="card"><summary>${head}${priceNote}<span class="more">Ver el paso a paso</span></summary><ol class="steps">${stepsHtml(o)}</ol>${actions}</details>`;
    }
    // The main option keeps where to get on, where to get off and the actions together, on the first screen.
    const hops = rides.length === 1
      ? `<li>Sube en <b>${esc(pretty(rides[0].boardPlace.name))}</b> y baja en <b>${esc(pretty(rides[0].alightPlace.name))}</b></li>`
      : rides.map(l => `<li>${plate(l.code, l.color, l.text, true)}De <b>${esc(pretty(l.boardPlace.name))}</b> a <b>${esc(pretty(l.alightPlace.name))}</b></li>`).join('');
    return `<article class="card${tag ? ' has-tag' : ''}">
      <div class="card-main">
        ${tag ? `<span class="tagline">${esc(tag)}</span>` : ''}
        ${head}
        <ul class="hops">${hops}</ul>
        ${priceNote}
        ${price.ask ? '<button type="button" class="linkish" data-open-card="1">Dinos cuál es tu tarjeta</button>' : ''}
        ${reasons && reasons.length ? `<ul class="reasons">${reasons.map(x => `<li>${icon('check')}${esc(x)}</li>`).join('')}</ul>` : ''}
      </div>
      ${actions}
      <details class="steps-box"><summary>Ver el paso a paso${icon('down')}</summary><ol class="steps">${stepsHtml(o)}</ol><div class="trip-links"><button type="button" class="linkish" data-share="${id}">Compartir este viaje</button><button type="button" class="linkish" data-report="${id}">Reportar un error en esta ruta</button></div></details>
    </article>`;
  }
  // The trip at a glance: walking, waiting and each bus in its own color, all on the same time scale,
  // so a longer trip draws a longer strip when options are compared.
  // Picking a station means walking inside it to the platform, so both ends can have the same name.
  const walkRoute = (a, b) => (a === b ? `Dentro de ${esc(a)}` : `Desde ${esc(a)} hasta ${esc(b)}`);
  let stripMax = 1;
  function tripStrip(o) {
    const parts = [], grow = s => Math.max(1, Math.round(s));
    o.legs.forEach(l => {
      if (l.type === 'walk') {
        if (l.sec >= 45) parts.push(`<span class="seg walk" style="flex:${grow(l.sec)} 1 auto">${icon('walk')}${l.sec >= 90 ? `<span class="n">${mins(l.sec)}</span>` : ''}</span>`);
        return;
      }
      if (l.wait >= 120) parts.push(`<span class="seg wait" style="flex:${grow(l.wait)} 1 auto">${icon('clock')}<span class="n">${mins(l.wait)}</span></span>`);
      parts.push(`<span class="seg bus" style="flex:${grow(l.sec)} 1 auto;background:${esc(l.color)};color:${esc(l.text)}">${esc(l.code)} <small>${mins(l.sec)} min</small></span>`);
    });
    // An empty piece takes the time this trip saves against the longest one, so shorter trips show a shorter bar.
    const spare = Math.round(stripMax - o.total);
    const minWord = s => (mins(s) === 1 ? '1 minuto' : `${mins(s)} minutos`);
    const said = o.legs.map(l => (l.type === 'walk' ? (l.sec >= 45 ? `caminar ${minWord(l.sec)}` : '') : `esperar ${minWord(l.wait)} e ir ${minWord(l.sec)} en el ${l.code}`)).filter(Boolean).join(', ');
    return `<div class="strip" role="img" aria-label="${esc(said)}">${parts.join('')}${spare > 0 ? `<i class="strip-rest" style="flex:${spare} 1 0"></i>` : ''}</div>`;
  }
  // Drops detail from each strip until it fits on one row, whatever the phone or text size.
  function fitStrips() {
    $('results').querySelectorAll('.strip').forEach(strip => {
      const segs = strip.querySelectorAll('.seg'), wrapped = () => segs[segs.length - 1].offsetTop !== segs[0].offsetTop;
      strip.removeAttribute('data-fit');
      for (let level = 1; level <= 3 && wrapped(); level++) strip.dataset.fit = level;
    });
  }
  function currentQuery() {
    if (state.mode === 'pick' || state.mode === 'arrive') {
      const [h, m] = state.time.split(':').map(Number), sec = h * 3600 + m * 60, when = `${DAYS[state.day]}, ${clock(sec)}`;
      if (state.mode === 'arrive') return { day: state.day, time: sec, arriveBy: sec, label: `llegar: ${when}`, sum: `llegar a las ${clock(sec)} (${DAYS[state.day]})` };
      return { day: state.day, time: sec, label: when, sum: `sales ${when}` };
    }
    const n = bogotaNow(), day = E.dayType(n.date), label = `ahora, ${clock(n.sec)} (${DAYS[day]})`;
    return { day, time: n.sec, label, sum: `sales ${label}` };
  }
  function reasonsFor(best, r) {
    const out = [];
    if (best.buses === 1) out.push('Sin transbordos');
    else {
      const fewer = r.ranked.filter(o => o.buses < best.buses).sort((a, b) => a.total - b.total)[0];
      if (fewer) out.push(`${mins(fewer.total - best.total)} min menos que con ${busWord(fewer.buses)}`);
      else if (r.fewest === best.buses) out.push('Es el mínimo de buses posible');
    }
    if (best.walk <= 300) out.push(`Caminas solo ${mins(best.walk)} min`);
    if (best.legs.every(l => l.type !== 'ride' || l.hwAll <= 480)) out.push(best.buses === 1 ? 'Pasa seguido' : 'Pasan seguido');
    return out;
  }
  function nearbyHtml() {
    // Someone without GPS who said what they are near gets the same list, for that place.
    const q = currentQuery(), fixed = state.from && state.from.kind !== 'gps' ? state.from : null, g = fixed || state.gps;
    if (!g) return '';
    if (!inCoverage(g)) return '<div class="notice">Estás fuera de la zona que cubren TransMilenio y el SITP. Elige un origen dentro de Bogotá.</div>';
    const list = E.nearby(g.lat, g.lon, 600, q.day, q.time).slice(0, 5), title = fixed ? `Cerca de ${esc(fixed.name)}` : 'Cerca de ti';
    if (!list.length) return `<section class="nearby"><h3 class="group-title">${title}</h3><p class="step-meta">A esta hora no encontramos buses a menos de 600 m.</p></section>`;
    return `<section class="nearby"><h3 class="group-title">${title} <small>lo que pasa ahora</small></h3>${list.map((n, i) => `
      <details class="near"${i === 0 ? ' open' : ''}>
        <summary><b>${esc(pretty(n.name))}</b><small>${mins(n.walkSec)} min a pie · ${distLabel(n.meters)}</small></summary>
        <ul class="near-routes">${n.routes.slice(0, 6).map(nearRow).join('')}</ul>
        ${n.routes.length > 6 ? `<details class="more-routes"><summary>Ver las otras ${n.routes.length - 6} rutas</summary><ul class="near-routes">${n.routes.slice(6).map(nearRow).join('')}</ul></details>` : ''}
      </details>`).join('')}</section>`;
  }
  const nearRow = x => `<li><button type="button" class="near-route" data-route-code="${esc(routeKey(x.code, x.agency))}">${plate(x.code, x.color, x.text, true)}<span>hacia ${esc(pretty(x.dest))}</span><small>cada ~${mins(x.hw)} min</small></button></li>`;
  function homeHtml() {
    const problem = gpsProblem();
    let html = '';
    if (WEB && !state.gps && !state.from && state.gpsState !== 'asking') {
      const useGps = `<button type="button" class="btn${problem ? '' : ' primary'} wide" id="enableGps">${icon('target')}${problem ? 'Intentar de nuevo con mi ubicación' : 'Usar mi ubicación'}</button>`;
      const sayNear = `<button type="button" class="btn${problem ? ' primary' : ''} wide" id="sayNear">Decir cerca de qué estoy</button>`;
      html += `<section class="enable">
        <h2>Mira qué buses tienes cerca</h2>
        <p>Con tu ubicación te decimos cómo llegar con los buses que pasan por donde estás. Si prefieres no activarla, dinos cerca de qué estás.</p>
        ${problem ? `<div class="notice">${esc(problem)}</div>` : ''}
        <div class="enable-actions">${problem ? sayNear + useGps : useGps + sayNear}</div>
        <p class="fine-line">Tu ubicación se usa en tu teléfono para calcular la ruta. No la guardamos ni la enviamos a ningún servidor nuestro. Si abres el mapa, este descarga la zona que estás viendo.</p>
      </section>`;
    }
    if (!state.to && !WEB) html += '<div class="verdict"><p>Dinos a dónde vas y de dónde sales.</p><button type="button" class="linkish" id="showExample">Ver un viaje de ejemplo</button></div>';
    if (!state.recent.length && !state.lastTo.length) html += '<button type="button" class="linkish first-time" data-help="1">¿Primera vez en TransMilenio? Así funciona</button>';
    html += nearbyHtml();
    html += `<button type="button" class="btn wide routes-cta" data-open-routes="1">${icon('bus')}Buscar una ruta y ver sus paradas</button>`;
    return html + fineHtml();
  }
  let renderSeq = 0;
  function render() {
    renderForm();
    const seq = ++renderSeq, box = $('results');
    if (state.routeView) { lastOptions = []; box.innerHTML = routeHtml(state.routeView); return; }
    if (!state.from || !state.to) { lastOptions = []; box.innerHTML = homeHtml(); return; }
    if (dist(state.from.lat, state.from.lon, state.to.lat, state.to.lon) < 60) { lastOptions = []; box.innerHTML = '<div class="verdict"><h2>Ya estás ahí</h2><p>El origen y el destino son el mismo lugar. Cambia uno de los dos.</p></div>'; return; }
    const q = currentQuery();
    if (state.routeView) { lastOptions = []; box.innerHTML = routeHtml(state.routeView); return; }
    // Only mention the wait if it is noticeable, so fast phones never flash a message.
    const notice = setTimeout(() => { if (seq === renderSeq) box.innerHTML = '<p class="calc">Calculando tu ruta…</p>'; }, 250);
    Planner.recommend({ from: state.from, to: state.to, day: q.day, time: q.time, arriveBy: q.arriveBy, limit: state.limit, maxWalk: state.walk * 60, pref: state.pref }).then(r => {
      clearTimeout(notice);
      if (seq === renderSeq) showResults(r, q);
    });
  }
  function showResults(r, q) {
    lastOptions = [];
    const box = $('results');
    // All strips on one page share a time scale, so the longest trip fills the card.
    const shown = [...r.ranked.slice(0, 5), ...r.groups.flatMap(g => g.options), ...(r.hint ? [r.hint.option] : [])];
    stripMax = Math.max(1, ...shown.map(o => o.total));
    const beyond = r.groups.find(g => g.buses === state.limit + 1 && g.options.length);
    const walkNote = r.walkDirect <= 1500 ? `<p>A pie son unos ${mins(r.walkDirect)} min.</p>` : '';
    const banner = state.example ? '<div class="notice">Este es un ejemplo para un día hábil a las 8:00 a. m. Elige tu origen y destino para ver tu viaje.</div>' : '';
    const closedNote = which => {
      const p = state[which];
      if (!p.noService) return '';
      const alt = nearestServed(p), why = METRO_WORKS.test(p.name) ? 'Las obras del Metro han cerrado estaciones en esta zona.' : 'Puede estar cerrada o sin servicio.';
      return `<div class="notice closed"><p><b>${esc(p.name)} no tiene rutas en el archivo oficial.</b> ${why}${alt ? ` La más cercana con servicio es <b>${esc(alt.place.name)}</b>, a ${distLabel(alt.m)}.` : ''} Confírmalo antes de viajar.</p>${alt ? `<button type="button" class="btn" data-use-alt="${which}">Usar ${esc(alt.place.name)}</button>` : ''}</div>`;
    };
    const servNote = closedNote('from') + closedNote('to');
    const gpsOut = state.from.kind === 'gps' && !inCoverage(state.from) ? '<div class="notice">Tu ubicación está fuera de la zona que cubren TransMilenio y el SITP.</div>' : '';
    let html = banner + servNote + gpsOut;

    const arriving = r.target !== undefined;
    if (arriving && !r.ranked.length && r.walkDirect > 1500) {
      html += `<div class="verdict"><h2>No llegas en bus a esa hora</h2><p>Con estos límites no encontramos cómo llegar a las ${clock(r.target)} Prueba una hora más tarde, permite más buses o camina un poco más.</p></div>`;
      box.innerHTML = html + fineHtml(); return;
    }
    if (!r.ranked.length) {
      if (r.walkDirect <= 1500) {
        html += `<div class="verdict"><h2>Te queda cerca: son ${mins(r.walkDirect)} min a pie</h2><p>Con estos límites no hay un bus que te convenga para este trayecto.</p></div>`;
      } else if (r.fewest) {
        const g = r.groups.find(x => x.buses === r.fewest);
        html += `<div class="verdict"><h2>Con ${busWord(state.limit)} no hay ruta</h2><p>Caminando hasta ${state.walk} min por tramo, lo mínimo son ${busWord(r.fewest)}. Mira abajo o camina un poco más.</p>${walkNote}</div>`;
        if (r.hint && state.limit === 1) html += hintHtml(r.hint);
        html += `<section class="group"><h3 class="group-title">Con ${busWord(g.buses)}</h3>${g.options.map((o, i) => cardHtml(o, !i)).join('')}</section>`;
      } else if (r.hint) {
        html += `<div class="verdict"><h2>Solo caminando bastante</h2><p>Con estos límites no hay ruta a esta hora.</p>${walkNote}</div>${hintHtml(r.hint)}`;
      } else {
        html += `<div class="verdict"><h2>No hay ruta a esta hora</h2><p>No encontramos buses para ${esc(q.label)}. Prueba otra hora o camina un poco más.</p>${walkNote}</div>`;
      }
      box.innerHTML = html + fineHtml(); return;
    }

    const best = r.ranked[0], first = best.legs.find(l => l.type === 'ride');
    const faster = r.ranked.filter(o => o.buses > best.buses).sort((a, b) => a.total - b.total)[0];
    let extra = '';
    // A faster trip is only a good deal if the rider knows what it costs.
    const costOf = o => {
      if (!o.fare || !best.fare) return '';
      const pay = f => (state.card === 'plus' ? f.plus : f.basic);
      if (pay(o.fare) <= pay(best.fare)) return '';
      // "Without the card" only makes sense when the card would change the price.
      return state.card === 'unknown' && o.fare.plus !== o.fare.basic ? ` Sin tarjeta personalizada pagarías ${money(pay(o.fare))}.` : ` Pagarías ${money(pay(o.fare))}.`;
    };
    if (arriving) {
      const route = best.buses === 1 ? `Toma el ${first.code}` : `Vas en ${busWord(best.buses)}`;
      extra = `${route} y llegas cerca de las ${clock(best.arrive)}${r.margin >= 120 ? ` Incluye ${mins(r.margin)} min de margen por si el bus tarda.` : ''}`;
    } else if (faster) {
      const s = best.total - faster.total;
      if (s >= 300) extra = `Con ${busWord(faster.buses)} llegarías ${mins(s)} min antes.${costOf(faster)}`;
      else if (s > 30) extra = `Otro bus solo te ahorra ${mins(s)} min. No vale el transbordo.`;
    } else if (beyond && beyond.saves >= 300) extra = `Si aceptaras ${busWord(beyond.buses)}, llegarías ${mins(beyond.saves)} min antes.${costOf(beyond.options[0])}`;
    if (r.night) extra = `${extra} De noche damos prioridad a caminar y esperar menos.`.trim();
    // Late at night the best trip can start with hours of waiting, and the rider should know why.
    if (!arriving && first.wait >= 1800) {
      const walkFirst = best.legs[0].type === 'walk' ? best.legs[0].sec : 0;
      extra = `A esta hora casi no pasan buses. El ${first.code} pasaría hacia las ${clock(q.time + walkFirst + first.wait)} ${extra}`.trim();
    }
    const headline = arriving ? `Sal a las ${clock(r.depart)} para llegar a las ${clock(r.target)}`
      : `Toma ${best.legs.filter(l => l.type === 'ride').map(l => `el ${plate(l.code, l.color, l.text)}`).join(best.buses === 2 ? ' y luego ' : ', ')}`;
    // On a short trip, waiting for a bus can take longer than simply walking there.
    const walkWins = r.walkDirect <= 1500 && r.walkDirect <= best.total;
    if (walkWins) {
      html += arriving
        ? `<div class="verdict"><h2>Mejor camina: sal a las ${clock(r.target - r.walkDirect)}</h2><p>Son unos ${mins(r.walkDirect)} min a pie. En bus tardarías unos ${mins(best.total)} min contando la espera.</p></div>`
        : `<div class="verdict"><h2>Mejor camina: llegas en ${mins(r.walkDirect)} min</h2><p>En bus tardarías unos ${mins(best.total)} min contando la espera.</p><p class="salida">Salida: ${esc(q.label)}</p></div>`;
      html += `<section class="group"><h3 class="group-title">Si prefieres el bus</h3>${cardHtml(best, false)}</section>`;
    } else {
      html += `<div class="verdict"><h2>${headline}</h2>${extra ? `<p>${esc(extra)}</p>` : ''}<p class="salida">Salida: ${esc(q.label)}</p>${walkNote}</div>`;
      html += cardHtml(best, true, 'Te la recomendamos', reasonsFor(best, r));
    }

    const rest = r.ranked.slice(1, 5);
    if (rest.length) html += `<section class="group"><h3 class="group-title">Otras opciones</h3>${rest.map(o => cardHtml(o, false)).join('')}</section>`;
    if (best.buses > 1 && r.hint) html += hintHtml(r.hint);
    box.innerHTML = html + fineHtml();
  }
  function hintHtml(h) {
    return `<section class="group"><h3 class="group-title">Un solo bus <small>si caminas ${h.walkMin} min en total</small></h3>${cardHtml(h.option, false)}</section>`;
  }
  function fineHtml() {
    const [y, m, d] = net.meta.feed.split('-');
    const age = Math.round((Date.now() - new Date(+y, +m - 1, +d).getTime()) / 86400000);
    const stale = age > 14 ? ` Tienen ${age} días: pueden haber cambiado.` : '';
    const preview = WEB ? '' : '<p>Esta vista previa no usa GPS, direcciones ni mapa de calles. La versión web sí.</p>';
    const rules = BusEngine.FARE_RULES, price = money(net.meta.fare || rules.price);
    const why = { data: 'tu teléfono pide ahorrar datos', slow: 'tu conexión es muy lenta', memory: 'tu teléfono tiene poca memoria' }[window.SVLite.signal];
    const liteOn = isLite(), liteSaid = !liteOn ? 'Modo ligero: letra del sistema, mapa simple y sin animaciones, para gastar menos datos.' : state.lite === 'on' ? 'Modo ligero activado.' : `Modo ligero activado porque ${why}.`;
    const lite = `<p class="lite-line"><span>${liteSaid}</span><button type="button" class="linkish" data-lite="${liteOn ? 'off' : 'on'}">${liteOn ? 'Desactivar' : 'Activar'}</button></p>`;
    const update = updateLine();
    return `<footer class="fine">${lite}<p class="update-line"${update ? '' : ' hidden'}>${update}</p><p>Rutas oficiales de TransMilenio del ${d}/${m}/${y}.${stale} Los tiempos salen de horarios programados. No es información en vivo: el bus real puede adelantarse o retrasarse.</p><p>Precios estimados con las reglas de 2026: pasaje de ${price} y hasta ${rules.maxTransfers} transbordos gratis en ${rules.windowMin} minutos con tarjeta personalizada. No incluyen subsidios ni pasajes gratuitos, y el cobro en alimentadores puede variar.</p>${preview}<p><b>Sin Vueltas no es una app oficial</b> de TransMilenio ni de la Alcaldía de Bogotá. Rutas: <a href="https://datosabiertos-transmilenio.hub.arcgis.com/" target="_blank" rel="noopener">datos abiertos de TransMilenio</a>.${WEB ? ' Mapa y direcciones: © colaboradores de <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>, OpenFreeMap y OpenMapTiles. Búsqueda: Photon, de komoot.' : ''} En una emergencia llama al 123.</p><p class="foot-links"><button type="button" class="linkish" data-help="1">Cómo funciona el sistema e instalar la app</button><button type="button" class="linkish" data-legal="1">Privacidad, términos y borrar mis datos</button></p></footer>`;
  }

  // ---------- one route, all of it ----------
  // Every stretch of every pattern that shows this code, keeping the busiest one for each destination.
  // Many zonal routes are one trip in the file that goes out and comes back to where it started (the 593 leaves Bosa,
  // reaches Chicó and returns). Shown whole, the way out and the way back look like one line. When the sign does not
  // change halfway, the turn is the stop farthest from the start: everything before it is the way out, the rest the way back.
  function loopTurn(p, from, to) {
    const s = p.stops, a = s[from];
    if (to - from < 6 || dist(E.lat[a], E.lon[a], E.lat[s[to]], E.lon[s[to]]) > 800) return -1;
    let turn = -1, far = 0;
    for (let k = from + 1; k < to; k++) { const m = dist(E.lat[a], E.lon[a], E.lat[s[k]], E.lon[s[k]]); if (m > far) { far = m; turn = k; } }
    return far > 1500 && turn - from >= 2 && to - turn >= 2 ? turn : -1;
  }
  // A route is its code plus its type: four codes (3, 7, C15 and C25) belong to a trunk route and to a zonal route at once.
  const routeKey = (code, svc) => `${code}~${svc}`;
  const parseRoute = key => { const k = String(key), i = k.lastIndexOf('~'); return i < 0 ? { code: k, svc: 0 } : { code: k.slice(0, i), svc: +k.slice(i + 1) }; };
  const codeTypes = (() => { const m = new Map(); E.P.forEach(p => [p.code, ...(p.signs || []).map(x => x[1])].forEach(c => (m.get(c) || m.set(c, new Set()).get(c)).add(E.routes[p.route][4]))); return m; })();
  const typeWord = svc => (SVC[svc] || 'bus').toLowerCase();
  function routeVariants(code, svc) {
    const day = currentQuery().day, byDest = new Map();
    const keep = v => {
      const old = byDest.get(v.dest);
      if (!old || v.trips > old.trips || (v.trips === old.trips && v.to - v.from > old.to - old.from)) byDest.set(v.dest, v);
    };
    E.P.forEach((p, pat) => {
      if (svc && E.routes[p.route][4] !== svc) return;
      const signs = [[0, p.code, p.dest], ...(p.signs || [])];
      signs.forEach(([from, c, dest], k) => {
        if (c !== code) return;
        const to = k + 1 < signs.length ? signs[k + 1][0] - 1 : p.stops.length - 1;
        if (to <= from) return;
        const trips = p.cnt[day].reduce((a, b) => a + b, 0), turn = loopTurn(p, from, to);
        if (turn < 0) { keep({ pat, from, to, dest, trips }); return; }
        keep({ pat, from, to: turn, dest: E.place(p.stops[turn]).name, trips, part: 'ida', order: 0 });
        keep({ pat, from: turn, to, dest: E.place(p.stops[to]).name, trips, part: 'regreso', order: 1 });
      });
    });
    // The way out goes before the way back; otherwise the busiest direction goes first.
    return [...byDest.values()].sort((a, b) => b.trips - a.trips || (a.order || 0) - (b.order || 0));
  }
  const codeIndex = (() => { const m = new Map(); E.P.forEach(p => [p.code, ...(p.signs || []).map(x => x[1])].forEach(c => m.set(c.toUpperCase().replace(/\s+/g, ''), c))); return m; })();
  const routeCodesFor = q => { const k = q.toUpperCase().replace(/\s+/g, ''); return k.length >= 1 && codeIndex.has(k) ? [codeIndex.get(k)] : []; };
  const fromMid = (p, pos, sec) => sec + p.cum[pos];
  // Each direction of a route gets its own color, the same on the map and on its card.
  const dirTitle = v => (v.part === 'ida' ? 'Ida · hacia ' : v.part === 'regreso' ? 'Regreso · hacia ' : 'Hacia ') + pretty(v.dest);
  function routeLeg(v, dir) {
    const p = E.P[v.pat], r = E.routes[p.route];
    return { type: 'ride', pat: v.pat, bPos: v.from, aPos: v.to, board: p.stops[v.from], alight: p.stops[v.to], code: parseRoute(state.routeView).code, dest: v.dest, dir, dirTitle: dirTitle(v), color: '#' + r[2], text: '#' + r[3], boardPlace: E.place(p.stops[v.from]), alightPlace: E.place(p.stops[v.to]) };
  }
  function routeHtml(key) {
    const { code, svc } = parseRoute(key), vs = routeVariants(code, svc), q = currentQuery(), h = Math.floor(q.time / 3600);
    if (!vs.length) return `<div class="verdict"><h2>No encontramos la ruta ${esc(code)}</h2></div>`;
    const p0 = E.P[vs[0].pat], r0 = E.routes[p0.route];
    const cards = vs.map((v, i) => {
      const p = E.P[v.pat], perHour = p.cnt[q.day][h] || 0, stops = p.stops.slice(v.from, v.to + 1).filter(s => E.atStop[s].length);
      const runMin = mins(p.cum[v.to] - p.cum[v.from]), first = p.first[q.day], last = p.last[q.day];
      const service = last < 0 ? '<p class="warn">Hoy no tiene salidas en el archivo oficial.</p>'
        : `<p class="meta">${perHour ? `Ahora pasa cada ~${Math.max(1, Math.round(60 / perHour))} min` : 'A esta hora no pasa'} · primer bus ${clock(fromMid(p, v.from, first))} · último ${clock(fromMid(p, v.from, last))}</p>`;
      const names = stops.map(s => pretty(E.place(s).name));
      // Each stop is a button: it lists the other routes that stop there, so a rider can plan a transfer by hand.
      const rows = stops.map((s, k) => `<li class="${S.p[s] >= 0 ? 'is-station' : 'is-stop'}"><button type="button" class="stop-link" data-stop-at="${s}">${esc(names[k])}</button></li>`).join('');
      return `<article class="card route-card" style="--dir:var(--dir-${(i % DIR_COUNT) + 1})"><div class="card-main">
        <h3 class="group-title dir-title"><i class="dir-swatch" aria-hidden="true"></i><span>${esc(dirTitle(v))}</span></h3>
        <p class="meta">${stops.length} paradas · ${runMin} min de punta a punta · de ${esc(names[0])} a ${esc(names[names.length - 1])}</p>
        ${service}
        <div class="card-actions route-actions"><button type="button" class="btn" data-route-map="${i}">${icon('map')}Ver en el mapa</button></div>
        <details class="via stops-line"${i === 0 ? ' open' : ''}><summary>Sus ${stops.length} paradas, en orden</summary>
          <p class="stops-key"><span class="k-st">Estación</span><span class="k-pd">Paradero</span> Toca una parada para ver qué otras rutas paran ahí.</p>
          <ol>${rows}</ol></details>
      </div></article>`;
    }).join('');
    const back = state.routeFrom === 'routes' ? 'Volver a las rutas' : 'Volver';
    // The other route that wears the same code, one tap away, so nobody takes the trunk 7 for the zonal 7.
    const twins = svc ? [...(codeTypes.get(code) || [])].filter(t => t !== svc) : [];
    const twin = twins.map(t => `<p class="twin">Ojo: también hay una ruta ${esc(typeWord(t))} con el código ${esc(code)}, con otro recorrido. <button type="button" class="linkish" data-route-code="${esc(routeKey(code, t))}">Ver la ${esc(typeWord(t))} ${esc(code)}</button></p>`).join('');
    const loop = vs.some(v => v.part) ? ' Sale y vuelve al mismo lugar: la ida y el regreso tienen colores distintos.' : vs.length > 1 ? ' Cada sentido tiene su color, también en el mapa.' : '';
    return `<div class="verdict"><h2>Ruta ${plate(code, '#' + r0[2], '#' + r0[3])}</h2><p>${esc(SVC[r0[4]] || 'Bus')} · ${vs.length === 1 ? '1 sentido' : `${vs.length} sentidos`}.${loop} Horarios programados del ${dayLabel(net.meta.feed)}.</p>${twin}<button type="button" class="linkish" data-route-close="1">${back}</button></div>${cards}${fineHtml()}`;
  }

  // ---------- «Rutas»: every route, searchable by code, destination or station ----------
  // One entry per code painted on the bus, built the first time someone opens the section.
  const ROUTE_KINDS = [['todas', 'Todas'], ['troncal', 'Troncales'], ['zonal', 'Zonales'], ['alimentador', 'Alimentadores'], ['otras', 'Otras']];
  const kindOf = svc => svc === 1 ? 'troncal' : svc === 2 ? 'alimentador' : svc === 3 ? 'zonal' : 'otras';
  const codeKey = c => String(c).toUpperCase().replace(/[\s-]+/g, '');
  const byCodeOrder = (a, b) => a.code.localeCompare(b.code, 'es', { numeric: true });
  let routeIndex = null, routeById = null;
  function getRouteIndex() {
    if (routeIndex) return routeIndex;
    const found = new Map(), day = currentQuery().day;
    E.P.forEach(p => {
      const r = E.routes[p.route], trips = p.cnt[day].reduce((a, b) => a + b, 0);
      for (const [, code, dest] of [[0, p.code, p.dest], ...(p.signs || [])]) {
        const id = routeKey(code, r[4]);
        let e = found.get(id);
        if (!e) found.set(id, e = { id, code, key: codeKey(code), color: '#' + r[2], text: '#' + r[3], svc: r[4], dests: new Map() });
        e.dests.set(dest, (e.dests.get(dest) || 0) + trips + 1);
      }
    });
    routeIndex = [...found.values()].map(e => {
      const dests = [...new Set([...e.dests].sort((a, b) => b[1] - a[1]).map(x => pretty(x[0])))];
      return { id: e.id, code: e.code, key: e.key, color: e.color, text: e.text, svc: e.svc, twin: codeTypes.get(e.code).size > 1, dests, destKey: norm(dests.join(' ')) };
    }).sort((a, b) => byCodeOrder(a, b) || a.svc - b.svc);
    routeById = new Map(routeIndex.map(e => [e.id, e]));
    return routeIndex;
  }
  // The codes that stop at any of these stops, read from the sign the bus shows at that point.
  function routesAt(stops) {
    getRouteIndex();
    const codes = new Set();
    for (const s of stops) {
      const at = E.atStop[s];
      for (let k = 0; k < at.length; k += 2) {
        const p = E.P[at[k]], pos = at[k + 1];
        let code = p.code;
        if (p.signs) for (const [from, c] of p.signs) if (pos >= from) code = c;
        codes.add(routeKey(code, E.routes[p.route][4]));
      }
    }
    return [...codes].map(id => routeById.get(id)).filter(Boolean).sort((a, b) => byCodeOrder(a, b) || a.svc - b.svc);
  }
  // A station is all its platforms; a street stop is every stop with that name close by (both sides of the street).
  function stopsOfPlace(p) {
    if (p.kind === 'station') return E.children[p.station];
    const key = norm(p.name), near = E.near(p.lat, p.lon, /^barrio /i.test(p.name) ? 800 : 300), out = [];
    for (let k = 0; k < near.length; k += 2) if (norm(pretty(S.n[near[k]])) === key) out.push(near[k]);
    return out;
  }
  function stopAtPlace(s) {
    const st = S.p[s];
    if (st >= 0) return { title: pretty(S.n[st]), sub: 'Estación de TransMilenio', stops: E.children[st] };
    const name = pretty(S.n[s]);
    return { title: name, sub: 'Paradero', stops: stopsOfPlace({ kind: 'stop', name, lat: E.lat[s], lon: E.lon[s] }) };
  }
  const routesUi = { q: '', kind: 'todas', shown: 40, at: null };
  const destLine = e => !e.dests.length ? 'Sin destino en el archivo' : 'Hacia ' + e.dests.slice(0, 2).join(' · ') + (e.dests.length > 2 ? ` y ${e.dests.length - 2} más` : '');
  const routeRow = e => `<button type="button" class="opt route-row" data-route-code="${esc(e.id)}"><span class="route-plate">${plate(e.code, e.color, e.text)}</span><span class="opt-t"><b>${esc(destLine(e))}</b><small>${esc(SVC[e.svc] || 'Bus')}${e.twin ? ' · hay otra ruta con este código' : ''}</small></span></button>`;
  const inKind = e => routesUi.kind === 'todas' || kindOf(e.svc) === routesUi.kind;
  function placeBlock(title, sub, list, closed) {
    const rows = list.filter(inKind);
    if (!rows.length) return `<h3 class="list-title">Paran en ${esc(title)}</h3><p class="hint">${list.length ? 'Ninguna de este tipo. Prueba con «Todas».' : closed ? esc(closed) + '.' : 'En el archivo oficial no le para ninguna ruta.'}</p>`;
    const head = `<h3 class="list-title">Paran en ${esc(title)} <small>${esc(sub)} · ${rows.length} ${rows.length === 1 ? 'ruta' : 'rutas'}</small></h3>`;
    return head + rows.slice(0, 8).map(routeRow).join('') + (rows.length > 8 ? `<details class="more-rows"><summary>Ver las otras ${rows.length - 8}</summary>${rows.slice(8).map(routeRow).join('')}</details>` : '');
  }
  function renderRoutes() {
    const all = getRouteIndex(), q = routesUi.q.trim();
    $('routeKinds').innerHTML = ROUTE_KINDS.map(([k, label]) => `<button type="button" class="chip" data-route-kind="${k}" aria-pressed="${routesUi.kind === k}">${label}</button>`).join('');
    let html = '';
    if (!q && routesUi.at) {
      const at = routesUi.at;
      html += placeBlock(at.title, at.sub, routesAt(at.stops));
      html += '<button type="button" class="linkish more-link" data-routes-all="1">Ver todas las rutas</button>';
    } else if (!q) {
      const list = all.filter(inKind);
      html += '<p class="hint">Escribe el código que lleva el bus (B28, 8-1, H710), a dónde va (Suba, Usme) o una estación (Calle 72) y mira todas sus paradas.</p>';
      html += `<h3 class="list-title">${routesUi.kind === 'todas' ? 'Todas las rutas' : esc(ROUTE_KINDS.find(k => k[0] === routesUi.kind)[1])} <small>${list.length}</small></h3>`;
      html += list.slice(0, routesUi.shown).map(routeRow).join('');
      if (list.length > routesUi.shown) html += `<button type="button" class="btn wide more-link" data-routes-more="1">Ver ${Math.min(40, list.length - routesUi.shown)} más</button>`;
    } else {
      const key = codeKey(q), words = norm(q);
      const byCode = key ? all.filter(e => inKind(e) && e.key.startsWith(key)).sort((a, b) => (b.key === key) - (a.key === key) || byCodeOrder(a, b)) : [];
      const listed = new Set(byCode.map(e => e.id));
      if (byCode.length) html += `<h3 class="list-title">Con ese código <small>${byCode.length}</small></h3>` + byCode.slice(0, 40).map(routeRow).join('');
      // Stations and stops with that name: the routes that stop there.
      // Codes have no real words (B28, 8-1, TC12), so places and destinations are only searched for words like «calle» or «suba».
      if (/[a-zñ]{3,}/.test(words)) {
        const seen = new Set(), placesFound = searchPlaces(q, 8).filter(p => p.kind === 'station' || p.kind === 'stop').filter(p => { const k = p.kind + norm(p.name); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 2);
        for (const p of placesFound) html += placeBlock(p.name, p.kind === 'station' ? 'Estación de TransMilenio' : 'Paradero', routesAt(stopsOfPlace(p)), p.noService ? subLabel(p) : '');
        const byDest = all.filter(e => inKind(e) && !listed.has(e.id) && e.destKey.includes(words));
        if (byDest.length) html += `<h3 class="list-title">Van hacia «${esc(q)}» <small>${byDest.length}</small></h3>` + byDest.slice(0, 40).map(routeRow).join('') + (byDest.length > 40 ? '<p class="hint">Hay más. Escribe un poco más para afinar.</p>' : '');
      }
      if (!html) html = `<p class="hint">No encontramos rutas con «${esc(q)}». Revisa el código como aparece en el bus, o escribe una estación o un barrio.</p>`;
    }
    $('routesList').innerHTML = html;
  }
  function openRoutes(at) {
    routesUi.at = at || null;
    if (at) { routesUi.q = ''; routesUi.kind = 'todas'; }
    $('routesQuery').value = routesUi.q;
    renderRoutes();
    $('routesList').scrollTop = 0;
    $('routesSheet').hidden = false;
  }

  // ---------- place picker ----------
  let target = 'from', searchSeq = 0, searchTimer = 0, searchAbort = null, picks = [], pickerCat = null;
  function openPicker(which, fav) {
    target = which; state.savingFav = fav || null; pickerCat = null;
    const label = fav ? `Busca tu ${fav === 'casa' ? 'casa' : 'trabajo'}` : which === 'from' ? (gpsProblem() ? '¿Cerca de qué estás?' : '¿De dónde sales?') : '¿Para dónde vas?';
    const input = $('pickerTitle');
    input.setAttribute('aria-label', label); input.placeholder = label; input.value = '';
    $('picker').setAttribute('aria-label', label);
    $('picker').hidden = false;
    renderPicker('');
    setTimeout(() => input.focus(), 30);
  }
  const KIND_ICON = { route: 'bus', station: 'bus', stop: 'bus', geo: 'pin', point: 'pin', gps: 'target', home: 'home', work: 'work', recent: 'recent', mapPick: 'map' };
  const optRow = (kind, title, sub, attrs, extraClass) => `<button type="button" class="opt ${extraClass || ''}" ${attrs}><span class="opt-i k-${kind}">${icon(KIND_ICON[kind] || 'pin')}</span><span class="opt-t"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span></button>`;
  function rowHtml(p, i, sub, kind, title) { return optRow(kind || p.kind || 'geo', title || p.name, sub !== undefined ? sub : subLabel(p), `data-pick="${i}"`); }
  const CAT_COLOR = { hospital: 'c-red', clinica: 'c-red', universidad: 'c-blue', centro: 'c-yellow', biblioteca: 'c-green', notaria: 'c-blue', viajes: 'c-green' };
  function renderPicker(q) {
    const query = q.trim();
    picks = [];
    const add = p => picks.push(p) - 1;
    let html = '';
    if (!query) {
      if (pickerCat) { renderCategory(); return; }
      const lost = target === 'from' && !state.savingFav && !!gpsProblem();
      if (lost) html += `<div class="notice" style="margin-top:.5rem">${esc(gpsProblem())}</div>`;
      if (WEB && !state.savingFav) html += optRow('gps', lost ? 'Intentar de nuevo con mi ubicación' : 'Usar mi ubicación', '', 'id="useGps"', 'map-opt').replace('k-gps', 'k-me');
      if (!state.savingFav) {
        for (const k of ['casa', 'trabajo']) {
          const label = k === 'casa' ? 'Casa' : 'Trabajo', f = state.favs[k];
          const favKind = k === 'casa' ? 'home' : 'work';
          html += f ? rowHtml(f, add({ ...f, known: true }), f.name, favKind, label)
            : optRow(favKind, label, 'Toca para guardarla', `data-set-fav="${k}"`);
        }
      }
      html += optRow('mapPick', 'Elegir en el mapa', '', 'data-open-map="1"', 'map-opt');
      if (lost) html += '<p class="hint">Escribe arriba una estación, un barrio o un lugar cerca de ti: Portal Suba, Kennedy, Unicentro.</p>';
      else html += `<p class="list-title">¿Qué estás buscando?</p><div class="cats">${BusGeo.CATEGORIES.map(c => `<button type="button" class="cat ${CAT_COLOR[c.id] || 'c-blue'}" data-cat="${c.id}">${esc(c.label)}</button>`).join('')}</div>`;
      // The other end of the trip is left out: choosing it would mean going nowhere.
      const otherEnd = target === 'from' ? state.to : state.from, seen = new Set(otherEnd ? [otherEnd.name] : []);
      [...state.lastTo, ...state.recent.flatMap(r => [r.from, r.to])].forEach(p => { if (p && !seen.has(p.name)) { seen.add(p.name); html += rowHtml(p, add({ ...p, known: true }), 'Reciente', 'recent'); } });
      if (!lost) html += `<p class="hint">${WEB ? 'Escribe como lo dirías: calle 72 con 10, la Caracas con 45, Unicentro o Portal Suba.' : 'Escribe una estación, un barrio o una esquina: Portal Suba, Kennedy, calle 72 con 10.'}</p>`;
      $('pickerList').innerHTML = html;
      return;
    }
    for (const code of routeCodesFor(query)) {
      const types = [...(codeTypes.get(code) || [])];
      for (const t of types) {
        const vs = routeVariants(code, t);
        if (vs.length) html += optRow('route', `Ruta ${code}${types.length > 1 ? ` · ${SVC[t] || 'Bus'}` : ''}`, `Ver su recorrido · hacia ${vs.slice(0, 2).map(v => pretty(v.dest)).join(' y ')}`, `data-route-code="${esc(routeKey(code, t))}"`, 'map-opt');
      }
    }
    // A link from Google Maps or WhatsApp, or plain coordinates.
    const linked = linkCoords(query);
    if (linked) html += rowHtml(linked, add(linked), `Del enlace · ${nearText(linked) || 'Bogotá'}`, 'point');
    else if (/maps\.app\.goo\.gl|goo\.gl\/maps/i.test(query)) html += '<p class="hint">Los enlaces cortos de Google Maps no se pueden abrir desde aquí. En Google Maps mantén presionado el punto, copia las coordenadas que aparecen arriba y pégalas aquí.</p>';
    const addr = BusGeo.parseAddress(query);
    // An address like "Calle 72 # 10-20" sits on the corner of Calle 72 and Carrera 10, and many stops are named after corners.
    const corner = !addr ? [] : addr.road ? searchPlaces(`${addr.roadWord} ${addr.cross}`, 3, true)
      : addr.via === 'calle' || addr.via === 'carrera' ? searchPlaces(`${addr.via} ${addr.num} ${BusGeo.other(addr.via)} ${addr.cross}`, 3, true) : [];
    const local = addr ? corner : searchPlaces(query, 25);
    // Order: an exact address first; otherwise stations, then outside results, then stops with similar names.
    // A nickname goes first too: "la terminal" means the bus terminal more often than the station called Terminal.
    const outsideFirst = addr || (WEB && BusGeo.canonical(query));
    const stationsFirst = outsideFirst ? [] : local.filter(p => p.kind === 'station'), others = outsideFirst ? local : local.filter(p => p.kind !== 'station');
    html += stationsFirst.map(p => rowHtml(p, add(p))).join('');
    html += '<div id="remoteRows"></div>';
    html += others.map(p => rowHtml(p, add(p), addr ? `Esquina cercana · ${subLabel(p)}` : undefined)).join('');
    if (!local.length && !WEB) html += '<p class="hint">No encontramos ese nombre. Prueba con el barrio o una estación cercana, o búscalo en el mapa.</p>';
    html += optRow('mapPick', 'Elegir en el mapa', '', 'data-open-map="1"', 'map-opt');
    $('pickerList').innerHTML = html;
    announceCount();
    if (WEB) remoteSearch(query, local.length);
  }
  // Places by type, closest first. The distance is worked out here, so the rider's position is not sent anywhere.
  let categorySeq = 0;
  function renderCategory() {
    const cat = BusGeo.CATEGORIES.find(c => c.id === pickerCat);
    const ref = state.gps || (target === 'from' ? state.to : state.from);
    const seq = ++categorySeq;
    const sorted = list => {
      if (!ref) return list;
      list.forEach(p => { p.meters = dist(ref.lat, ref.lon, p.lat, p.lon); });
      return list.sort((a, b) => a.meters - b.meters);
    };
    // Only stops named after the place: the station called "Hospital" is not a hospital.
    const local = sorted(places.filter(p => p.kind === 'stop' && cat.local.test(p.name)).map(p => ({ ...p })));
    const draw = (remote, message) => {
      picks = [];
      const row = p => rowHtml(p, picks.push(p) - 1, [p.meters !== undefined ? `A ${distLabel(p.meters)}` : '', p.sub !== undefined ? p.sub : subLabel(p)].filter(Boolean).join(' · '));
      $('pickerList').innerHTML = `<button type="button" class="btn" data-cat-back="1" style="margin-top:.5rem">Volver a todas las opciones</button><p class="list-title">${esc(cat.label)}</p>${message ? `<p class="hint">${esc(message)}</p>` : ''}${remote.slice(0, 25).map(row).join('')}${remote.length ? '<p class="list-title">Paraderos con ese nombre</p>' : ''}${local.slice(0, remote.length ? 6 : 30).map(row).join('')}`;
    };
    const canAsk = WEB && navigator.onLine && !photonPaused();
    draw([], canAsk ? 'Buscando…' : (local.length ? (photonPaused() ? 'La búsqueda de lugares no está respondiendo. Estos son los paraderos con ese nombre.' : '') : 'Sin internet solo podemos mostrar estaciones y paraderos, y no hay ninguno con este nombre.'));
    if (!canAsk) return;
    BusGeo.category(cat.id).then(list => { Photon.fails = 0; if (seq === categorySeq && pickerCat === cat.id) draw(sorted(list), list.length ? '' : 'No encontramos lugares de este tipo.'); })
      .catch(() => { photonFailed(); if (seq === categorySeq && pickerCat === cat.id) draw([], 'La búsqueda no respondió. Estos son los paraderos con ese nombre.'); });
  }
  // The address search is a free public service that promises nothing. Answers are remembered, a slow answer is dropped
  // after 6 seconds, and after two failures in a row the app stops asking for 5 minutes, so riders do not wait for
  // nothing and the service is not hammered while it is down. Stations, stops and the map keep working meanwhile.
  const Photon = { fails: 0, pausedUntil: 0, cache: new Map() };
  const photonPaused = () => Date.now() < Photon.pausedUntil;
  const photonFailed = () => { Photon.fails++; if (Photon.fails >= 2) { Photon.pausedUntil = Date.now() + 5 * 60000; Photon.fails = 0; } };
  const PAUSED_HINT = '<p class="hint">La búsqueda de direcciones no está respondiendo. Mientras tanto ves estaciones y paraderos, o puedes elegir el punto en el mapa.</p>';
  function remoteSearch(query, localCount) {
    clearTimeout(searchTimer);
    if (searchAbort) searchAbort.abort();
    const seq = ++searchSeq, rows = () => $('remoteRows');
    if (query.length < 3) return;
    if (!navigator.onLine) { rows().innerHTML = '<p class="hint">Sin internet no podemos buscar direcciones. Las estaciones y los paraderos sí funcionan.</p>'; return; }
    if (photonPaused()) { rows().innerHTML = PAUSED_HINT; return; }
    const key = query.trim().toLowerCase();
    rows().innerHTML = '<p class="hint">Buscando direcciones y lugares…</p>';
    searchTimer = setTimeout(async () => {
      const abort = searchAbort = new AbortController();
      let timedOut = false;
      const limit = setTimeout(() => { timedOut = true; abort.abort(); }, 6000);
      try {
        const res = Photon.cache.get(key) || await BusGeo.search(query, abort.signal);
        clearTimeout(limit);
        Photon.fails = 0;
        Photon.cache.set(key, res);
        if (Photon.cache.size > 60) Photon.cache.delete(Photon.cache.keys().next().value);
        if (seq !== searchSeq || !rows()) return;
        const list = res.results.filter(p => !res.address || p.score > 0);
        const strong = list.some(p => p.exact);
        let h = '';
        if (res.address && !strong) h += '<p class="hint">No encontramos esa dirección exacta. Revisa si alguna opción te sirve o elige el punto en el mapa.</p>';
        h += list.map(p => { const i = picks.push(p) - 1; return rowHtml(p, i, (res.address && !p.exact ? 'Aproximada · ' : '') + (p.sub || 'Dirección o lugar')); }).join('');
        if (!list.length && !localCount && !res.address) h += '<p class="hint">No encontramos ese nombre. Prueba con otro lugar cercano o elígelo en el mapa.</p>';
        rows().innerHTML = h;
        announceCount();
      } catch (e) {
        clearTimeout(limit);
        if (e.name === 'AbortError' && !timedOut) return; // the rider kept typing
        photonFailed();
        if (seq === searchSeq && rows()) rows().innerHTML = photonPaused() ? PAUSED_HINT : '<p class="hint">La búsqueda de direcciones no respondió. Las estaciones y los paraderos siguen funcionando.</p>';
      }
    }, 350);
  }
  function choose(p, confirmed) {
    // Search results and stops can share a name with other places, so the rider sees the point before it counts.
    // Stations, saved places and recent ones are already known.
    if (!confirmed && !p.known && (p.kind === 'geo' || p.kind === 'stop')) { openMap('confirm', null, { ...plain(p), sub: p.sub }); return; }
    if (state.savingFav) {
      state.favs[state.savingFav] = plain(p); state.savingFav = null;
      persist(); $('mapSheet').hidden = true; openPicker(target); return;
    }
    if (state.example) { state.example = false; state.mode = 'now'; state[target === 'from' ? 'to' : 'from'] = null; }
    state[target] = plain(p);
    state.formOpen = false;
    if (target === 'from') state.fromGps = false;
    $('picker').hidden = true; $('mapSheet').hidden = true;
    remember(); persist(); render();
    if (!state.to) openPicker('to');
    else if (!state.from && !WEB) openPicker('from');
    else if (!state.from) useMyLocation('from');
  }

  // ---------- maps: a real street map on the web, the hand-drawn one as fallback ----------
  const MAP = { scale: 0.02, cx: 0, cy: 0, w: 0, h: 0, mode: 'pick', picked: null, option: null, me: null, drawQueued: false };
  const RM = { map: null, ready: false, failed: false, geoLoaded: false };
  // The street map library weighs 220 KB, so it is fetched the first time someone opens a map.
  const MAP_LIB = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl';
  let mapLibLoading = null;
  function loadMapLib() {
    if (window.maplibregl) return Promise.resolve(true);
    if (mapLibLoading) return mapLibLoading;
    mapLibLoading = new Promise(resolve => {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = MAP_LIB + '.css';
      document.head.appendChild(css);
      const js = document.createElement('script');
      const finish = ok => { clearTimeout(limit); if (!ok) mapLibLoading = null; resolve(ok); };
      const limit = setTimeout(() => finish(false), 20000);
      js.src = MAP_LIB + '.js';
      js.onload = () => finish(!!window.maplibregl);
      js.onerror = () => finish(false);
      document.head.appendChild(js);
    });
    return mapLibLoading;
  }
  const LAT0 = 4.65, LON0 = -74.1, KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KY = 110540;
  const mx = new Float32Array(N), my = new Float32Array(N);
  for (let i = 0; i < N; i++) { mx[i] = (E.lon[i] - LON0) * KX; my[i] = -(E.lat[i] - LAT0) * KY; }
  const toX = lon => (lon - LON0) * KX, toY = lat => -(lat - LAT0) * KY;
  const corridors = (() => {
    const seen = new Set(), out = [];
    E.P.forEach(p => {
      if (E.routes[p.route][4] !== 1) return;
      for (let i = 1; i < p.stops.length; i++) {
        const a = E.stationOf(p.stops[i - 1]), b = E.stationOf(p.stops[i]);
        if (a < 0 || b < 0 || a === b) continue;
        const k = a < b ? a + '-' + b : b + '-' + a;
        if (seen.has(k) || dist(E.lat[a], E.lon[a], E.lat[b], E.lon[b]) > 1500) continue;
        seen.add(k); out.push(a, b);
      }
    });
    return out;
  })();
  const usedStops = []; for (let i = 0; i < N; i++) if (!S.k[i] && S.p[i] < 0 && E.atStop[i].length) usedStops.push(i);

  function pickGeo(lat, lon, metersPerPx) {
    let best = -1, bd = 26 * metersPerPx;
    for (const i of stationsServed) { const d = dist(lat, lon, E.lat[i], E.lon[i]); if (d < bd) { bd = d; best = i; } }
    if (best >= 0) {
      MAP.picked = { kind: 'station', station: best, stop: -1, name: pretty(S.n[best]), lat: E.lat[best], lon: E.lon[best] };
    } else {
      let near = -1, nd = 1e12;
      for (const i of usedStops) { const d = dist(lat, lon, E.lat[i], E.lon[i]); if (d < nd) { nd = d; near = i; } }
      MAP.picked = nd < 14 * metersPerPx
        ? { kind: 'stop', station: -1, stop: -1, name: pretty(S.n[near]), lat: E.lat[near], lon: E.lon[near] }
        : { kind: 'point', station: -1, stop: -1, name: 'Punto cerca de ' + pretty(S.n[near]), lat, lon };
    }
    $('mapChosen').textContent = MAP.picked.name;
    $('mapUse').hidden = false;
    $('mapUse').textContent = MAP.mode === 'confirm' ? 'Sí, es aquí' : 'Usar este punto';
    showPlaceHelp(MAP.picked);
    refreshMapData();
  }

  // --- real map ---
  const tok = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  // The map has its own light or dark look, chosen on the map itself. Light by default, even on a dark phone: the dark
  // street map hides street names and places, and the map is where people check that a place is the right one.
  const MAP_LOOK = {
    light: { style: 'liberty', bg: '#eef1f6', line: '#2b3a63', dot: '#7d89a8', text: '#10192e', halo: '#ffffff', surface: '#ffffff', muted: '#4f5b78', casing: '#10192e', dirs: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'] },
    dark: { style: 'dark', bg: '#111a3a', line: '#c5d0ee', dot: '#5d6a91', text: '#eef2ff', halo: '#111a3a', surface: '#182145', muted: '#a9b5d6', casing: '#05081a', dirs: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300'] },
  };
  // Directions of one route: colors checked for color blindness on both map looks (also in app.css as --dir-1 to --dir-6).
  const DIR_COUNT = 6;
  const legColor = l => (l.dir !== undefined ? look().dirs[l.dir % DIR_COUNT] : l.color);
  const look = () => MAP_LOOK[state.mapDark ? 'dark' : 'light'];
  const PIN = '#d9202a';
  function renderMapLook() {
    const b = $('mapStyle');
    b.setAttribute('aria-pressed', String(state.mapDark));
    b.setAttribute('aria-label', state.mapDark ? 'Cambiar a mapa claro' : 'Cambiar a mapa oscuro');
    b.innerHTML = state.mapDark
      ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>'
      : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>';
    document.querySelector('.map-wrap').style.background = look().bg;
  }
  // Under a route's map: which color is which direction, with the arrow that shows the way.
  function renderLegend() {
    const box = $('mapLegend'), o = MAP.option;
    if (!o || !o.routeView || MAP.mode !== 'view') { box.hidden = true; box.innerHTML = ''; return; }
    const legs = [...o.legs].sort((a, b) => a.dir - b.dir);
    box.innerHTML = legs.map(l => `<li><svg viewBox="0 0 28 12" aria-hidden="true"><path d="M2 6h24" stroke="${legColor(l)}" stroke-width="5" stroke-linecap="round"/><path d="M11 2.5l6 3.5-6 3.5" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${esc(l.dirTitle)}</span></li>`).join('');
    box.hidden = false;
  }
  function setMapLook(dark) {
    state.mapDark = dark; persist(); renderMapLook(); renderLegend();
    if (RM.map && RM.ready) {
      RM.ready = false;
      RM.map.setStyle(`https://tiles.openfreemap.org/styles/${look().style}`, { diff: false });
      RM.map.once('style.load', () => { addRealLayers(); RM.ready = true; refreshMapData(); });
    }
    if (!$('map').hidden) draw();
  }
  // Landmarks that help someone who does not know the area tell whether this is the place.
  function nearText(p) {
    const out = [];
    if (p.kind !== 'station') {
      const st = nearestStation(p.lat, p.lon);
      if (st.i >= 0 && st.m < 3000) out.push(`A ${distLabel(st.m)} de la estación ${pretty(S.n[st.i])}`);
    }
    const n = E.near(p.lat, p.lon, 500);
    let best = -1, bd = 1e9;
    for (let j = 0; j < n.length; j += 2) { const i = n[j]; if (!S.k[i] && S.p[i] < 0 && E.atStop[i].length && n[j + 1] < bd) { bd = n[j + 1]; best = i; } }
    if (best >= 0 && pretty(S.n[best]) !== p.name) out.push(`paradero ${pretty(S.n[best])} a ${distLabel(bd)}`);
    return out.join(' · ');
  }
  function showPlaceHelp(p) {
    $('mapNear').textContent = p ? nearText(p) : '';
    $('mapNear').hidden = !p;
    const look2 = $('mapLook');
    look2.hidden = !p;
    if (p) look2.href = `https://www.google.com/maps/search/?api=1&query=${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
  }
  const isDark = () => { const t = document.documentElement.getAttribute('data-theme'); return t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches; };
  const fc = features => ({ type: 'FeatureCollection', features });
  const pt = (lat, lon, props) => ({ type: 'Feature', properties: props || {}, geometry: { type: 'Point', coordinates: [lon, lat] } });
  const line = (coords, props) => ({ type: 'Feature', properties: props || {}, geometry: { type: 'LineString', coordinates: coords } });
  function initReal(done) {
    if (RM.map) { RM.map.resize(); if (RM.ready) done(); else RM.after = done; return; }
    try {
      RM.map = new maplibregl.Map({ container: 'realMap', style: `https://tiles.openfreemap.org/styles/${look().style}`, center: [-74.09, 4.65], zoom: 10.4, dragRotate: false, pitchWithRotate: false, attributionControl: false });
      RM.map.addControl(new maplibregl.AttributionControl({ compact: true }));
      RM.map.touchZoomRotate.disableRotation();
      // The library already moves and zooms with the keyboard. Enter chooses the point in the middle.
      RM.map.getCanvas().addEventListener('keydown', e => {
        if (e.key !== 'Enter' || (MAP.mode !== 'pick' && MAP.mode !== 'confirm')) return;
        const c = RM.map.getCenter();
        pickGeo(c.lat, c.lng, 78271.5 * Math.cos(c.lat * Math.PI / 180) / Math.pow(2, RM.map.getZoom()));
      });
    } catch (e) { RM.failed = true; RM.map = null; showCanvasMap(); return; }
    RM.after = done;
    const timer = setTimeout(() => { if (!RM.ready) { RM.failed = true; showCanvasMap(); } }, 8000);
    // Draw as soon as the style arrives. Waiting for every tile leaves the rider without a route on a weak signal.
    RM.map.once('style.load', () => {
      clearTimeout(timer);
      if (RM.failed) return;
      addRealLayers(); RM.ready = true;
      $('realMap').hidden = false;
      if (RM.after) { RM.after(); RM.after = null; }
    });
    // Choosing a point: the map moves under a fixed pin, which is more precise than a fingertip on a small screen.
    RM.map.on('moveend', e => { if (MAP.mode === 'pick' && e.originalEvent) { const c = RM.map.getCenter(); pickGeo(c.lat, c.lng, 78271.5 * Math.cos(c.lat * Math.PI / 180) / Math.pow(2, RM.map.getZoom())); } });
    RM.map.on('click', e => { if (MAP.mode === 'pick') RM.map.easeTo({ center: e.lngLat, duration: 300 }); if (MAP.mode === 'pick' || MAP.mode === 'confirm') { const z = RM.map.getZoom(), mpp = 78271.5 * Math.cos(e.lngLat.lat * Math.PI / 180) / Math.pow(2, z); pickGeo(e.lngLat.lat, e.lngLat.lng, mpp); } });
  }
  // One small arrow per direction color and map look, drawn here so no extra file has to download.
  function arrowCanvas(color, size) {
    const c = document.createElement('canvas'), g = c.getContext('2d'), u = size / 18;
    c.width = c.height = size;
    g.beginPath(); g.moveTo(4 * u, 3.5 * u); g.lineTo(14.5 * u, 9 * u); g.lineTo(4 * u, 14.5 * u); g.lineTo(6.5 * u, 9 * u); g.closePath();
    g.lineJoin = 'round'; g.lineWidth = 2.4 * u; g.strokeStyle = '#ffffff'; g.stroke(); g.fillStyle = color; g.fill();
    return g.getImageData(0, 0, size, size);
  }
  function addArrowImages(m) {
    for (const name of ['light', 'dark']) MAP_LOOK[name].dirs.forEach((color, i) => { const id = `sv-arrow-${name}-${i}`; if (!m.hasImage(id)) m.addImage(id, arrowCanvas(color, 36), { pixelRatio: 2 }); });
  }
  function addRealLayers() {
    const m = RM.map;
    const corridorLines = []; for (let i = 0; i < corridors.length; i += 2) corridorLines.push(line([[E.lon[corridors[i]], E.lat[corridors[i]]], [E.lon[corridors[i + 1]], E.lat[corridors[i + 1]]]]));
    m.addSource('corridors', { type: 'geojson', data: fc(corridorLines) });
    m.addSource('stops', { type: 'geojson', data: fc(usedStops.map(i => pt(E.lat[i], E.lon[i], { name: pretty(S.n[i]) }))) });
    m.addSource('stations', { type: 'geojson', data: fc(stationsServed.map(i => pt(E.lat[i], E.lon[i], { name: pretty(S.n[i]), portal: /^Portal/.test(S.n[i]) ? 1 : 0 }))) });
    m.addSource('trip', { type: 'geojson', data: fc([]) });
    m.addSource('tripPts', { type: 'geojson', data: fc([]) });
    m.addSource('picked', { type: 'geojson', data: fc([]) });
    m.addSource('me', { type: 'geojson', data: fc([]) });
    const L = look(), font = ['Noto Sans Regular'], text = L.text, halo = L.halo;
    m.addLayer({ id: 'corridors', type: 'line', source: 'corridors', paint: { 'line-color': L.line, 'line-opacity': .5, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 15, 4] }, layout: { 'line-cap': 'round' } });
    m.addLayer({ id: 'stops', type: 'circle', source: 'stops', minzoom: 13.5, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13.5, 2, 17, 5], 'circle-color': L.dot, 'circle-stroke-color': halo, 'circle-stroke-width': 1 } });
    m.addLayer({ id: 'trip-walk', type: 'line', source: 'trip', filter: ['==', ['get', 'walk'], 1], paint: { 'line-color': text, 'line-width': 3, 'line-dasharray': [0.5, 2] }, layout: { 'line-cap': 'round' } });
    // A route's directions: each drawn to the right of its way of travel, so the way out and the way back sit side by side
    // on the same street, with a dark edge for contrast and arrows that show which way the bus goes.
    const dirLine = ['==', ['get', 'dir'], 1], DIR_OFFSET = 3.5;
    m.addLayer({ id: 'trip-casing', type: 'line', source: 'trip', filter: dirLine, paint: { 'line-color': L.casing, 'line-opacity': .55, 'line-width': 8, 'line-offset': DIR_OFFSET }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
    m.addLayer({ id: 'trip-ride', type: 'line', source: 'trip', filter: ['!=', ['get', 'walk'], 1], paint: { 'line-color': ['get', 'color'], 'line-width': ['case', dirLine, 5, 6], 'line-offset': ['case', dirLine, DIR_OFFSET, 0] }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
    addArrowImages(m);
    m.addLayer({ id: 'trip-arrows', type: 'symbol', source: 'trip', filter: dirLine, layout: { 'symbol-placement': 'line', 'symbol-spacing': 110, 'icon-image': ['get', 'arrow'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-offset': [0, DIR_OFFSET] } });
    m.addLayer({ id: 'stations', type: 'circle', source: 'stations', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 15, 6], 'circle-color': L.surface, 'circle-stroke-color': L.line, 'circle-stroke-width': 2 } });
    m.addLayer({ id: 'trip-pts', type: 'circle', source: 'tripPts', paint: { 'circle-radius': 7, 'circle-color': L.surface, 'circle-stroke-color': text, 'circle-stroke-width': 3 } });
    m.addLayer({ id: 'stops-label', type: 'symbol', source: 'stops', minzoom: 16, layout: { 'text-field': ['get', 'name'], 'text-font': font, 'text-size': 11, 'text-anchor': 'left', 'text-offset': [.7, 0], 'text-optional': true }, paint: { 'text-color': L.muted, 'text-halo-color': halo, 'text-halo-width': 1.5 } });
    m.addLayer({ id: 'stations-label', type: 'symbol', source: 'stations', minzoom: 12, layout: { 'text-field': ['get', 'name'], 'text-font': font, 'text-size': 12, 'text-anchor': 'left', 'text-offset': [.8, 0] }, paint: { 'text-color': text, 'text-halo-color': halo, 'text-halo-width': 1.5 } });
    m.addLayer({ id: 'portals-label', type: 'symbol', source: 'stations', maxzoom: 12, filter: ['==', ['get', 'portal'], 1], layout: { 'text-field': ['get', 'name'], 'text-font': font, 'text-size': 12, 'text-anchor': 'left', 'text-offset': [.8, 0] }, paint: { 'text-color': text, 'text-halo-color': halo, 'text-halo-width': 1.5 } });
    m.addLayer({ id: 'trip-label', type: 'symbol', source: 'tripPts', layout: { 'text-field': ['get', 'name'], 'text-font': font, 'text-size': 13, 'text-variable-anchor': ['left', 'right', 'top', 'bottom'], 'text-radial-offset': 1, 'text-justify': 'auto', 'text-allow-overlap': true }, paint: { 'text-color': text, 'text-halo-color': halo, 'text-halo-width': 2 } });
    m.addLayer({ id: 'picked-ring', type: 'circle', source: 'picked', paint: { 'circle-radius': 24, 'circle-color': PIN, 'circle-opacity': .18 } });
    m.addLayer({ id: 'picked', type: 'circle', source: 'picked', paint: { 'circle-radius': 11, 'circle-color': PIN, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 4 } });
    m.addLayer({ id: 'picked-label', type: 'symbol', source: 'picked', layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 15, 'text-anchor': 'top', 'text-offset': [0, 1.4], 'text-max-width': 14, 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-color': text, 'text-halo-color': halo, 'text-halo-width': 2.5 } });
    m.addLayer({ id: 'me', type: 'circle', source: 'me', paint: { 'circle-radius': 8, 'circle-color': tok('--me'), 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 } });
  }
  // ---------- route updates ----------
  // Downloading the routes every day would cost a prepaid phone about 11 MB a month, and most days only timetables change.
  // The app checks a file of a few bytes and downloads only when a station or a route code changed, or when its copy
  // is a week old (two in light mode). The rider can always download at once from the footer.
  const DATA_CACHE = 'sinvueltas-data';
  const Update = { latest: null, ready: false, urgent: false, busy: false, checkedAt: 0 };
  const daysOld = feed => { const [y, m, d] = feed.split('-'); return Math.floor((Date.now() - new Date(+y, +m - 1, +d).getTime()) / 86400000); };
  const dayLabel = feed => { const [y, m, d] = feed.split('-'); return `${d}/${m}/${y}`; };
  async function downloadLatest(v) {
    if (Update.busy || !('caches' in window)) return false;
    Update.busy = true; refreshUpdateLine();
    try {
      const get = file => fetch(`${file}?v=${v.feed}`, { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(file + ' ' + r.status); return r; });
      const [routes, lines] = await Promise.all([get('network.json'), isLite() ? null : get('shapes.json')]);
      if ((await routes.clone().json()).meta.feed !== v.feed) throw new Error('the server changed while downloading');
      const cache = await caches.open(DATA_CACHE);
      await cache.put('network.json', routes);
      if (lines) await cache.put('shapes.json', lines); else await cache.delete('shapes.json');
      Update.ready = true;
      return true;
    } catch (e) { return false; } finally { Update.busy = false; refreshUpdateLine(); }
  }
  async function checkForUpdate() {
    if (!WEB || !navigator.onLine || Date.now() - Update.checkedAt < 6 * 3600000) return;
    Update.checkedAt = Date.now();
    let v = null;
    try { v = await fetch('version.json', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)); } catch (e) { return; }
    if (!v || !v.feed || v.feed <= net.meta.feed) return;
    Update.latest = v;
    Update.urgent = !!net.meta.sig && v.sig !== net.meta.sig;
    if (Update.urgent || daysOld(net.meta.feed) >= (isLite() ? 14 : 7)) await downloadLatest(v);
    refreshUpdateLine();
    if (Update.urgent && Update.ready && $('picker').hidden && $('mapSheet').hidden) render();
  }
  function updateLine() {
    if (!WEB) return '';
    if (Update.ready) return `<span>Ya bajamos las rutas del ${dayLabel(Update.latest.feed)}.</span><button type="button" class="linkish" data-update-now="1">Usarlas ahora</button>`;
    if (Update.busy) return '<span>Bajando las rutas nuevas…</span>';
    if (!Update.latest) return '';
    const when = new Date(Date.now() + Math.max(1, (isLite() ? 14 : 7) - daysOld(net.meta.feed)) * 86400000);
    return `<span>Hay rutas del ${dayLabel(Update.latest.feed)} con cambios menores de horario. Para ahorrar datos se bajan solas el ${when.getDate()}/${when.getMonth() + 1}.</span><button type="button" class="linkish" data-update-get="1">Bajarlas ahora</button>`;
  }
  function refreshUpdateLine() { document.querySelectorAll('.update-line').forEach(el => { el.innerHTML = updateLine(); el.hidden = !el.innerHTML; }); }

  // The street each route really follows. It loads when a map first opens, and until then a trip draws from stop to stop.
  const Streets = { data: null, loading: null, decoded: new Map() };
  function loadStreets() {
    if (Streets.data || isLite()) return Promise.resolve();
    if (Streets.loading) return Streets.loading;
    // Lines from another update would not match these routes. Then the server's copy is tried, and if that one is newer too,
    // the trip draws from stop to stop until the routes themselves update.
    const accept = d => { if (d && d.feed === net.meta.feed) { Streets.data = d; return true; } return false; };
    const inline = $('shapes');
    const json = r => (r.ok ? r.json() : null);
    const fresh = () => fetch(`shapes.json?v=${net.meta.feed}`, { cache: 'no-store' }).then(json).then(d => {
      if (accept(d) && 'caches' in window) caches.open(DATA_CACHE).then(c => c.put('shapes.json', new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json' } }))).catch(() => {});
    });
    Streets.loading = (inline ? Promise.resolve(accept(JSON.parse(inline.textContent))) : fetch('shapes.json').then(json).then(d => accept(d) || fresh()))
      .catch(() => {}).then(() => { Streets.loading = null; });
    return Streets.loading;
  }
  function streetLine(i) {
    let pts = Streets.decoded.get(i);
    if (!pts) {
      const flat = Streets.data.lines[i];
      pts = [];
      let a = 0, o = 0;
      for (let k = 0; k < flat.length; k += 2) { a += flat[k]; o += flat[k + 1]; pts.push([a / 1e5, o / 1e5]); }
      Streets.decoded.set(i, pts);
    }
    return pts;
  }
  // A ride as [lat, lon] points, from the stop where it starts to the stop where it ends.
  function rideLine(l) {
    const stops = E.P[l.pat].stops, entry = Streets.data && Streets.data.pats[l.pat];
    if (!entry) return stops.slice(l.bPos, l.aPos + 1).map(s => [E.lat[s], E.lon[s]]);
    let k = 0, from = 0, to = 0;
    entry[1].forEach((step, pos) => { k += step; if (pos === l.bPos) from = k; if (pos === l.aPos) to = k; });
    return [[E.lat[l.board], E.lon[l.board]], ...streetLine(entry[0]).slice(from + 1, to + 1), [E.lat[l.alight], E.lon[l.alight]]];
  }
  function tripGeo(o) {
    const lines = [], points = [];
    const coordOf = s => [E.lon[s], E.lat[s]];
    const rides = o.legs.filter(l => l.type === 'ride');
    const from = o.routeView ? null : state.from, to = o.routeView ? null : state.to;
    if (from) lines.push(line([[from.lon, from.lat], coordOf(rides[0].board)], { walk: 1 }));
    o.legs.forEach(l => {
      if (l.type === 'ride') {
        lines.push(line(rideLine(l).map(p => [p[1], p[0]]), o.routeView ? { color: legColor(l), dir: 1, arrow: `sv-arrow-${state.mapDark ? 'dark' : 'light'}-${l.dir % DIR_COUNT}` } : { color: l.color }));
        points.push(pt(E.lat[l.board], E.lon[l.board], { name: o.routeView ? `${l.code} hacia ${pretty(l.dest)}` : `${l.code}: ${pretty(l.boardPlace.name)}` }));
        if (!o.routeView) points.push(pt(E.lat[l.alight], E.lon[l.alight], { name: `Bájate: ${pretty(l.alightPlace.name)}` }));
      } else if (l.fromStop !== undefined) lines.push(line([coordOf(l.fromStop), coordOf(l.toStop)], { walk: 1 }));
    });
    if (to) lines.push(line([coordOf(rides[rides.length - 1].alight), [to.lon, to.lat]], { walk: 1 }));
    return { lines, points };
  }
  function refreshMapData() {
    if (RM.ready && !$('realMap').hidden) {
      const m = RM.map, g = MAP.option ? tripGeo(MAP.option) : { lines: [], points: [] };
      m.getSource('trip').setData(fc(g.lines));
      m.getSource('tripPts').setData(fc(g.points));
      m.getSource('picked').setData(fc(MAP.picked && MAP.mode !== 'pick' ? [pt(MAP.picked.lat, MAP.picked.lon, { name: MAP.picked.name.length > 40 ? MAP.picked.name.slice(0, 38) + '…' : MAP.picked.name })] : []));
      m.getSource('me').setData(fc(MAP.me ? [pt(MAP.me.lat, MAP.me.lon)] : []));
    } else queueDraw();
  }
  function frameReal() {
    const m = RM.map, pad = { top: 80, bottom: 40, left: 40, right: 70 };
    m.resize();
    if (MAP.option) {
      const g = tripGeo(MAP.option), b = new maplibregl.LngLatBounds();
      g.lines.forEach(l => l.geometry.coordinates.forEach(c => b.extend(c)));
      m.fitBounds(b, { padding: pad, duration: 0, maxZoom: 15.5 });
    } else if (MAP.picked) m.jumpTo({ center: [MAP.picked.lon, MAP.picked.lat], zoom: MAP.mode === 'confirm' ? 16.3 : Math.max(m.getZoom(), 15) });
    else if (MAP.me) m.jumpTo({ center: [MAP.me.lon, MAP.me.lat], zoom: 14.5 });
    else m.jumpTo({ center: [-74.09, 4.65], zoom: 10.4 });
    refreshMapData();
  }
  function showCanvasMap() {
    $('realMap').hidden = true; $('map').hidden = false; $('mapLoading').hidden = true;
    sizeCanvas(); frameCanvas(); draw();
  }
  // The street map builds underneath the simple one and replaces it only when it is ready to use.
  function showRealMap() {
    $('realMap').hidden = false;
    initReal(() => { $('map').hidden = true; $('mapLoading').hidden = true; frameReal(); });
  }

  // --- hand-drawn fallback (embedded preview, no internet, or no WebGL) ---
  const sx = x => (x - MAP.cx) * MAP.scale + MAP.w / 2, sy = y => (y - MAP.cy) * MAP.scale + MAP.h / 2;
  function fit(minX, minY, maxX, maxY, pad) {
    MAP.cx = (minX + maxX) / 2; MAP.cy = (minY + maxY) / 2;
    MAP.scale = Math.min((MAP.w - pad * 2) / Math.max(200, maxX - minX), (MAP.h - pad * 2) / Math.max(200, maxY - minY));
  }
  function sizeCanvas() {
    const c = $('map'), r = c.getBoundingClientRect(), dpr = Math.min(2.5, window.devicePixelRatio || 1);
    MAP.w = r.width; MAP.h = r.height; c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
    c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function frameCanvas() {
    let a = 1e12, b = 1e12, c = -1e12, d = -1e12;
    const add = v => { a = Math.min(a, mx[v]); b = Math.min(b, my[v]); c = Math.max(c, mx[v]); d = Math.max(d, my[v]); };
    if (MAP.option) {
      MAP.option.legs.forEach(l => { if (l.type === 'ride') E.P[l.pat].stops.slice(l.bPos, l.aPos + 1).forEach(add); });
      fit(a, b, c, d, 70); MAP.cx += 30 / MAP.scale;
    } else if (MAP.mode === 'confirm' && MAP.picked) {
      MAP.cx = toX(MAP.picked.lon); MAP.cy = toY(MAP.picked.lat); MAP.scale = 0.15;
    } else {
      stationsServed.forEach(add);
      fit(a, b, c, d, 40); MAP.cx += 32 / MAP.scale; // labels run to the right of each station, so leave them room
    }
  }
  function queueDraw() { if (!MAP.drawQueued) { MAP.drawQueued = true; requestAnimationFrame(() => { MAP.drawQueued = false; if (!$('map').hidden && !$('mapSheet').hidden) draw(); }); } }
  // The simple map draws a direction like the street map: moved to the right of travel, with an edge and arrows.
  function drawDirection(g, pts, color, L) {
    const off = 3.5, out = pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
      return [p[0] - dy / len * off, p[1] + dx / len * off];
    });
    const path = () => { g.beginPath(); out.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); };
    g.setLineDash([]); g.lineJoin = 'round'; g.lineCap = 'round';
    path(); g.globalAlpha = .55; g.strokeStyle = L.casing; g.lineWidth = 8; g.stroke(); g.globalAlpha = 1;
    path(); g.strokeStyle = color; g.lineWidth = 5; g.stroke();
    let since = 55;
    for (let i = 1; i < out.length; i++) {
      const [x0, y0] = out[i - 1], [x1, y1] = out[i], seg = Math.hypot(x1 - x0, y1 - y0);
      since += seg;
      if (since < 110 || seg < 1) continue;
      since = 0;
      const ang = Math.atan2(y1 - y0, x1 - x0), mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      g.save(); g.translate(mx, my); g.rotate(ang);
      g.beginPath(); g.moveTo(-5, -5.5); g.lineTo(5.5, 0); g.lineTo(-5, 5.5); g.lineTo(-2.5, 0); g.closePath();
      g.lineWidth = 2.2; g.strokeStyle = '#ffffff'; g.stroke(); g.fillStyle = color; g.fill(); g.restore();
    }
  }
  function draw() {
    const c = $('map'), g = c.getContext('2d');
    const W = MAP.w, H = MAP.h, s = MAP.scale;
    const L = look();
    g.clearRect(0, 0, W, H); g.fillStyle = L.bg; g.fillRect(0, 0, W, H);
    const inView = (x, y) => x > -30 && x < W + 30 && y > -30 && y < H + 30;
    if (s > 0.012) {
      g.fillStyle = L.dot;
      const r = s > 0.12 ? 3 : s > 0.05 ? 2 : 1;
      for (const i of usedStops) { const x = sx(mx[i]), y = sy(my[i]); if (inView(x, y)) g.fillRect(x - r / 2, y - r / 2, r, r); }
    }
    g.strokeStyle = L.line; g.globalAlpha = MAP.option ? .35 : 1; g.lineWidth = s > 0.05 ? 3 : 2; g.lineCap = 'round';
    g.beginPath();
    for (let i = 0; i < corridors.length; i += 2) { const a = corridors[i], b = corridors[i + 1]; g.moveTo(sx(mx[a]), sy(my[a])); g.lineTo(sx(mx[b]), sy(my[b])); }
    g.stroke(); g.globalAlpha = 1;
    if (MAP.option) {
      for (const l of MAP.option.legs) {
        if (l.type === 'ride' && MAP.option.routeView) drawDirection(g, rideLine(l).map(p => [sx(toX(p[1])), sy(toY(p[0]))]), legColor(l), L);
        else if (l.type === 'ride') {
          g.strokeStyle = l.color; g.lineWidth = 6; g.setLineDash([]); g.lineJoin = 'round';
          g.beginPath(); rideLine(l).forEach((p, i) => { const x = sx(toX(p[1])), y = sy(toY(p[0])); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
        } else if (l.fromStop !== undefined) {
          g.strokeStyle = L.text; g.lineWidth = 2.5; g.setLineDash([2, 6]);
          g.beginPath(); g.moveTo(sx(mx[l.fromStop]), sy(my[l.fromStop])); g.lineTo(sx(mx[l.toStop]), sy(my[l.toStop])); g.stroke(); g.setLineDash([]);
        }
      }
    }
    const occ = new Set();
    g.font = '500 12px Rubik, "Segoe UI", Arial, sans-serif'; g.textBaseline = 'middle';
    const label = (x, y, t, strong) => {
      if (!inView(x, y)) return;
      const w = g.measureText(t).width, cols = [], cx0 = Math.floor(x / 40), cx1 = Math.floor((x + 8 + w) / 40), cy = Math.floor(y / 16);
      for (let a = cx0; a <= cx1; a++) for (let b = cy - 1; b <= cy + 1; b++) { const k = a + ':' + b; if (occ.has(k)) return; cols.push(k); }
      cols.forEach(k => occ.add(k));
      g.lineWidth = 3; g.strokeStyle = L.halo; g.strokeText(t, x + 8, y); g.fillStyle = strong ? L.text : L.muted; g.fillText(t, x + 8, y);
    };
    if (MAP.option) {
      const dots = [];
      MAP.option.legs.forEach(l => { if (l.type === 'ride') { dots.push([l.board, l.boardPlace.name]); dots.push([l.alight, l.alightPlace.name]); } });
      dots.forEach(([v, name]) => {
        const x = sx(mx[v]), y = sy(my[v]);
        g.beginPath(); g.arc(x, y, 6, 0, 7); g.fillStyle = L.surface; g.fill(); g.lineWidth = 3; g.strokeStyle = L.text; g.stroke();
        label(x, y, pretty(name), true);
      });
    }
    for (const i of stationsServed) {
      const x = sx(mx[i]), y = sy(my[i]);
      if (!inView(x, y)) continue;
      const big = /^Portal/.test(S.n[i]);
      g.beginPath(); g.arc(x, y, big ? 5 : s > 0.05 ? 4 : 2.5, 0, 7); g.fillStyle = L.surface; g.fill(); g.lineWidth = 2; g.strokeStyle = L.line; g.stroke();
    }
    for (const i of stationsServed) if (/^Portal/.test(S.n[i])) label(sx(mx[i]), sy(my[i]), pretty(S.n[i]), true);
    if (s > 0.03) for (const i of stationsServed) label(sx(mx[i]), sy(my[i]), pretty(S.n[i]), true);
    if (s > 0.3) for (const i of usedStops) label(sx(mx[i]), sy(my[i]), pretty(S.n[i]), false);
    if (MAP.picked && MAP.mode !== 'pick') {
      const x = sx(toX(MAP.picked.lon)), y = sy(toY(MAP.picked.lat));
      g.beginPath(); g.arc(x, y, 22, 0, 7); g.fillStyle = PIN; g.globalAlpha = .18; g.fill(); g.globalAlpha = 1;
      g.beginPath(); g.arc(x, y, 11, 0, 7); g.fillStyle = PIN; g.fill(); g.lineWidth = 4; g.strokeStyle = '#ffffff'; g.stroke();
      g.font = '700 14px Rubik, "Segoe UI", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'top';
      g.lineWidth = 4; g.strokeStyle = L.halo; g.strokeText(MAP.picked.name.slice(0, 40), x, y + 18); g.fillStyle = L.text; g.fillText(MAP.picked.name.slice(0, 40), x, y + 18);
      g.textAlign = 'start'; g.textBaseline = 'middle';
    }
    if (MAP.me) {
      const x = sx(toX(MAP.me.lon)), y = sy(toY(MAP.me.lat));
      g.beginPath(); g.arc(x, y, 8, 0, 7); g.fillStyle = tok('--me'); g.fill(); g.lineWidth = 3; g.strokeStyle = '#ffffff'; g.stroke();
    }
  }
  function zoomCanvas(f, px, py) {
    const next = Math.max(0.006, Math.min(2, MAP.scale * f));
    const wx = (px - MAP.w / 2) / MAP.scale + MAP.cx, wy = (py - MAP.h / 2) / MAP.scale + MAP.cy;
    MAP.scale = next; MAP.cx = wx - (px - MAP.w / 2) / next; MAP.cy = wy - (py - MAP.h / 2) / next;
    queueDraw();
  }
  (function bindCanvas() {
    const c = $('map'), pts = new Map();
    let moved = 0, downAt = 0, pinch = 0;
    const pos = e => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    c.addEventListener('pointerdown', e => { c.setPointerCapture(e.pointerId); pts.set(e.pointerId, pos(e)); moved = 0; downAt = Date.now(); pinch = 0; });
    c.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      const p = pos(e), old = pts.get(e.pointerId);
      pts.set(e.pointerId, p);
      if (pts.size === 1) {
        moved += Math.hypot(p[0] - old[0], p[1] - old[1]);
        MAP.cx -= (p[0] - old[0]) / MAP.scale; MAP.cy -= (p[1] - old[1]) / MAP.scale; queueDraw();
      } else if (pts.size === 2) {
        moved += 20;
        const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) zoomCanvas(d / pinch, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        pinch = d;
      }
    });
    const up = e => {
      if (!pts.has(e.pointerId)) return;
      const p = pos(e); pts.delete(e.pointerId); pinch = 0;
      const tapped = !pts.size && moved < 8 && Date.now() - downAt < 600;
      if (MAP.mode === 'pick' && !pts.size) {
        // The pin stays in the middle: a tap brings that spot under it, a drag moves the map beneath it.
        if (tapped) { MAP.cx = (p[0] - MAP.w / 2) / MAP.scale + MAP.cx; MAP.cy = (p[1] - MAP.h / 2) / MAP.scale + MAP.cy; queueDraw(); }
        pickGeo(-MAP.cy / KY + LAT0, MAP.cx / KX + LON0, 1 / MAP.scale);
      } else if (tapped && MAP.mode === 'confirm') {
        const wx = (p[0] - MAP.w / 2) / MAP.scale + MAP.cx, wy = (p[1] - MAP.h / 2) / MAP.scale + MAP.cy;
        pickGeo(-wy / KY + LAT0, wx / KX + LON0, 1 / MAP.scale);
      }
    };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', e => pts.delete(e.pointerId));
    c.addEventListener('wheel', e => { e.preventDefault(); const p = pos(e); zoomCanvas(e.deltaY < 0 ? 1.25 : 0.8, p[0], p[1]); }, { passive: false });
    c.addEventListener('keydown', e => {
      const step = 60 / MAP.scale, move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (move) { e.preventDefault(); MAP.cx += move[0]; MAP.cy += move[1]; queueDraw(); }
      else if (e.key === '+' || e.key === '=') zoomCanvas(1.5, MAP.w / 2, MAP.h / 2);
      else if (e.key === '-') zoomCanvas(1 / 1.5, MAP.w / 2, MAP.h / 2);
      else if (e.key === 'Enter' && (MAP.mode === 'pick' || MAP.mode === 'confirm')) pickGeo(-MAP.cy / KY + LAT0, MAP.cx / KX + LON0, 1 / MAP.scale);
    });
    window.addEventListener('resize', () => { if (!$('mapSheet').hidden && !$('map').hidden) { sizeCanvas(); draw(); } });
  })();

  let openToken = 0;
  function openMap(mode, option, place) {
    MAP.mode = mode; MAP.option = option || null; MAP.picked = place || null;
    MAP.me = state.gps ? { lat: state.gps.lat, lon: state.gps.lon } : null;
    $('mapSheet').hidden = false;
    const confirming = mode === 'confirm';
    $('mapTitle').textContent = confirming ? '¿Es aquí?' : mode === 'pick' ? (target === 'from' ? 'Toca de dónde sales' : 'Toca a dónde vas') : mode === 'follow' ? 'En viaje' : option && option.routeView ? `Ruta ${option.legs[0].code}` : 'Tu recorrido';
    $('mapTip').hidden = mode !== 'pick' && !confirming;
    $('mapTip').textContent = confirming ? 'Si no es este lugar, toca el punto correcto.' : 'Mueve el mapa hasta dejar el pin sobre tu punto.';
    $('centerPin').hidden = mode !== 'pick';
    $('mapBar').hidden = mode !== 'pick' && !confirming;
    $('followBar').hidden = mode !== 'follow';
    $('mapClose').hidden = mode === 'follow';
    $('mapUse').hidden = !confirming;
    $('mapUse').textContent = 'Sí, es aquí';
    $('mapNo').hidden = !confirming;
    $('mapChosen').textContent = confirming ? [place.name, place.sub].filter(Boolean).join(' · ') : 'Toca el mapa para elegir un punto';
    showPlaceHelp(confirming ? place : null);
    renderMapLook();
    renderLegend();
    $('zoomMe').hidden = !WEB;
    // The glance screen has no map, so nothing is downloaded until the rider asks for one.
    const glance = mode === 'follow' && state.glance;
    $('mapSheet').classList.toggle('glance', glance);
    if (mode === 'follow') renderMapButton();
    if (!glance) showMapNow();
  }
  function renderMapButton() { $('fMap').textContent = state.glance ? 'Ver mapa' : 'Ocultar mapa'; }
  function showMapNow() {
    if (MAP.option) { const shown = MAP.option; loadStreets().then(() => { if (MAP.option === shown) refreshMapData(); }); }
    const canStreets = WEB && navigator.onLine && !RM.failed, wantStreets = canStreets && (!isLite() || RM.allowed);
    $('mapStreets').hidden = !canStreets || wantStreets;
    if (wantStreets && RM.ready) { showRealMap(); return; }
    // The simple map opens at once on any phone. The street map takes over if it arrives.
    showCanvasMap();
    if (!wantStreets) return;
    const token = ++openToken;
    $('mapLoading').hidden = false;
    loadMapLib().then(ok => {
      if (token !== openToken) return;
      if (ok && !$('mapSheet').hidden) showRealMap();
      else $('mapLoading').hidden = true;
    });
  }

  // ---------- trip mode ----------
  // Follows the rider with GPS and warns before the stop to get off. There is no live bus data behind this:
  // it only compares the rider's own position with the route.
  const FOLLOW = { active: false, option: null, stages: [], i: 0, watch: null, wake: null, warned: new Set(), lastPos: null };
  function buildStages(o) {
    const out = [], rides = o.legs.filter(l => l.type === 'ride');
    const placeOfStop = s => ({ lat: E.lat[s], lon: E.lon[s], name: pretty(E.place(s).name) });
    o.legs.forEach(l => {
      if (l.type === 'ride') { out.push({ type: 'wait', leg: l }); out.push({ type: 'ride', leg: l }); return; }
      if (l.start) { if (l.sec > 75) out.push({ type: 'walk', to: placeOfStop(rides[0].board) }); return; }
      if (l.end) { if (l.sec > 75) out.push({ type: 'walk', to: { lat: state.to.lat, lon: state.to.lon, name: state.to.name } }); return; }
      out.push({ type: 'walk', to: placeOfStop(l.toStop) });
    });
    out.push({ type: 'done' });
    return out;
  }
  function legProgress(l, lat, lon) {
    const p = E.P[l.pat];
    let best = l.bPos, bd = 1e12;
    for (let i = l.bPos; i <= l.aPos; i++) { const s = p.stops[i], d = dist(lat, lon, E.lat[s], E.lon[s]); if (d < bd) { bd = d; best = i; } }
    return { pos: best, off: bd };
  }
  // Sound and voice, so the rider can keep the phone away. iPhone cannot vibrate from a web page, and phones
  // only allow sound after a tap, which is why it is unlocked when "Iniciar viaje" is pressed.
  const Voice = (function () {
    let audio = null, spanish = null, lastSaid = '';
    const canSpeak = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
    function findVoice() {
      if (!canSpeak || spanish) return;
      const all = speechSynthesis.getVoices();
      spanish = all.find(v => /^es[-_]CO/i.test(v.lang)) || all.find(v => /^es[-_](419|MX|US)/i.test(v.lang)) || all.find(v => /^es/i.test(v.lang)) || null;
    }
    return {
      canSpeak,
      unlock() {
        try {
          const Ctx = window.AudioContext || window.webkitAudioContext;
          if (Ctx) { audio = audio || new Ctx(); if (audio.state === 'suspended') audio.resume(); }
        } catch (e) { /* the on-screen alert still works */ }
        if (canSpeak) { findVoice(); const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); }
      },
      beep(times) {
        if (!audio) return;
        try {
          for (let i = 0; i < times; i++) {
            const o = audio.createOscillator(), g = audio.createGain(), at = audio.currentTime + i * .55;
            o.frequency.value = 880; g.gain.value = .25; o.connect(g); g.connect(audio.destination); o.start(at); o.stop(at + .35);
          }
        } catch (e) { /* the on-screen alert still works */ }
      },
      say(text, urgent) {
        if (!canSpeak || !state.voice || !text || text === lastSaid) return;
        lastSaid = text;
        findVoice();
        if (urgent) speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = spanish ? spanish.lang : 'es-CO';
        if (spanish) u.voice = spanish;
        speechSynthesis.speak(u);
      },
      stop() { lastSaid = ''; if (canSpeak) speechSynthesis.cancel(); },
    };
  })();
  const spokenCode = code => String(code).replace(/^([a-z]+)(\d)/i, '$1 $2');
  function alarm(text) {
    if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]);
    Voice.beep(3);
    Voice.say(text, true);
  }
  let shownPlate = null;
  function showFollow(title, sub, level, plateHtml, speech) {
    // Only what changed, so a screen reader does not repeat the instruction with each GPS reading.
    if (shownPlate !== (plateHtml || '')) { shownPlate = plateHtml || ''; $('fPlate').innerHTML = shownPlate; }
    if ($('fTitle').textContent !== title) $('fTitle').textContent = title;
    if ($('fSub').textContent !== (sub || '')) $('fSub').textContent = sub || '';
    $('followBar').dataset.level = level || '';
    if (speech) Voice.say(speech);
  }
  function renderVoiceButton() {
    const b = $('fVoice');
    b.hidden = !Voice.canSpeak;
    b.textContent = state.voice ? 'Voz activada' : 'Voz apagada';
    b.setAttribute('aria-pressed', String(state.voice));
  }
  function followStep(lat, lon) {
    const st = FOLLOW.stages[FOLLOW.i];
    if (!st) return;
    if (FOLLOW.seenStage !== FOLLOW.i) { FOLLOW.seenStage = FOLLOW.i; FOLLOW.stageAt = Date.now(); }
    $('fRecalc').hidden = true;
    if (st.type === 'done') { showFollow('Llegaste', `Estás cerca de ${state.to.name}.`, 'good', '', 'Llegaste a tu destino.'); $('fNext').hidden = true; return; }
    $('fNext').hidden = false;
    if (st.type === 'walk') {
      const d = lat === null ? null : dist(lat, lon, st.to.lat, st.to.lon);
      if (d !== null && d < 60) { FOLLOW.i++; followStep(lat, lon); return; }
      const walkMin = d === null ? 0 : mins(d * 1.3 / 1.25);
      showFollow(`Camina hasta ${st.to.name}`, d === null ? 'Buscando tu ubicación…' : `Te faltan ${distLabel(d)}, ${walkMin === 1 ? 'cerca de 1 min' : `unos ${walkMin} min`}`, '', '', `Camina hasta ${st.to.name}.`);
      return;
    }
    const l = st.leg, pl = plate(l.code, l.color, l.text), alight = pretty(l.alightPlace.name);
    if (st.type === 'wait') {
      // Without live data, the app says when to stop waiting.
      if (Date.now() - FOLLOW.stageAt > giveUpMin(st.leg) * 60000) {
        showFollow(`El ${st.leg.code} está tardando`, `Llevas más de ${giveUpMin(st.leg)} min esperando. ${planB(st.leg).replace(/^./, c => c.toUpperCase())}.`, 'alert', plate(st.leg.code, st.leg.color, st.leg.text), `El ${spokenCode(st.leg.code)} está tardando.`);
        $('fRecalc').hidden = false;
        return;
      }
      if (lat !== null) {
        const g = legProgress(l, lat, lon), dBoard = dist(lat, lon, E.lat[l.board], E.lon[l.board]);
        if (g.pos > l.bPos && dBoard > 200 && g.off < 250) { FOLLOW.i++; followStep(lat, lon); return; }
      }
      const others = l.also.length ? ` También te sirven: ${l.also.slice(0, 4).map(x => x.code).join(', ')}.` : '';
      const sign = l.signChange ? ` Su letrero cambia a ${l.signChange.code} en el camino: es el mismo bus.` : '';
      showFollow(`Toma el ${l.code} hacia ${pretty(l.dest)}`, `En ${pretty(l.boardPlace.name)}. Pasa cada ~${mins(l.hwAll)} min.${others}${sign}`, '', pl, `Toma el ${spokenCode(l.code)} hacia ${pretty(l.dest)}.`);
      return;
    }
    // On the bus.
    if (lat === null) { showFollow(`Bájate en ${alight}`, 'Sin ubicación no podemos avisarte. Mira las paradas por la ventana.', '', pl, `Bájate en ${alight}.`); return; }
    const g = legProgress(l, lat, lon), left = l.aPos - g.pos, dA = dist(lat, lon, E.lat[l.alight], E.lon[l.alight]);
    const key = l.board + '>' + l.alight;
    if (dA < 90) {
      showFollow(`Bájate aquí: ${alight}`, 'Estás en tu parada.', 'alert', pl);
      if (FOLLOW.said !== key + ':here') { FOLLOW.said = key + ':here'; alarm(`Bájate aquí. Esta es tu parada, ${alight}.`); }
      FOLLOW.warned.add(key);
      FOLLOW.arrived = key;
      return;
    }
    if (FOLLOW.arrived === key) { FOLLOW.arrived = null; FOLLOW.i++; followStep(lat, lon); return; } // moved away from the stop on foot
    if (g.off > 900) { showFollow('Parece que te saliste de la ruta', `Estás a ${distLabel(g.off)} del recorrido del ${l.code}.`, 'alert', pl, 'Parece que te saliste de la ruta.'); $('fRecalc').hidden = false; return; }
    if (left <= 1 || dA < 350) {
      showFollow(`Prepárate: bájate en ${alight}`, left <= 1 ? 'Es la próxima parada.' : `Quedan ${distLabel(dA)}.`, 'alert', pl);
      if (!FOLLOW.warned.has(key)) { FOLLOW.warned.add(key); alarm(`Prepárate. Te bajas en ${alight}. Es la próxima parada.`); }
      return;
    }
    // Only a few reminders, so the voice does not talk at every stop.
    const reminder = left === 5 || left === 3 ? `Faltan ${left} paradas para ${alight}.` : FOLLOW.i === 1 || FOLLOW.onBoardSaid !== key ? `Vas en el ${spokenCode(l.code)}. Te avisamos antes de ${alight}.` : '';
    FOLLOW.onBoardSaid = key;
    showFollow(`Faltan ${left} paradas`, `Bájate en ${alight}.`, '', pl, reminder);
  }
  async function startFollow(option) {
    Voice.unlock(); // must happen during the tap, before anything waits
    renderVoiceButton();
    // Always a fresh position: an old one could skip steps the rider has not done yet.
    const fresh = WEB ? await locate() : null;
    if (WEB && !fresh && state.gps) state.gps = null;
    Object.assign(FOLLOW, { active: true, option, stages: buildStages(option), i: 0, warned: new Set(), arrived: null, said: null, onBoardSaid: null, seenStage: -1, stageAt: Date.now() });
    // Waiting at a stop sends no GPS changes, so the screen also checks the time on its own.
    clearInterval(FOLLOW.tick);
    FOLLOW.tick = setInterval(() => { if (FOLLOW.active) followStep(state.gps && WEB ? state.gps.lat : null, state.gps && WEB ? state.gps.lon : null); }, 30000);
    openMap('follow', option);
    // The preview page has no GPS: the rider advances by hand, which still shows how the trip looks.
    $('fHint').textContent = WEB ? 'Deja la pantalla encendida para recibir el aviso de bajarte.' : 'Vista previa sin GPS: avanza con «Siguiente paso». La versión web te avisa sola cuándo bajarte.';
    if (!WEB) { followStep(null, null); return; }
    if (gpsProblem()) { showFollow('Sin ubicación', 'No podemos avisarte cuándo bajarte. Mira las paradas y avanza con «Siguiente paso».', 'alert'); $('fNext').hidden = false; return; }
    followStep(state.gps ? state.gps.lat : null, state.gps ? state.gps.lon : null);
    FOLLOW.watch = navigator.geolocation.watchPosition(pos => {
      const { latitude: lat, longitude: lon, accuracy } = pos.coords;
      state.gps = { lat, lon, acc: accuracy, at: Date.now() };
      MAP.me = { lat, lon };
      if (!state.glance) {
        refreshMapData();
        if (RM.ready && !$('realMap').hidden) RM.map.easeTo({ center: [lon, lat], duration: 600 });
      }
      followStep(lat, lon);
    }, () => { /* keep showing the last instruction; the rider can advance by hand */ }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    requestWake();
  }
  async function requestWake() { try { if (navigator.wakeLock && FOLLOW.active) FOLLOW.wake = await navigator.wakeLock.request('screen'); } catch (e) { /* the rider keeps the screen on by hand */ } }
  function stopFollow() {
    FOLLOW.active = false;
    clearInterval(FOLLOW.tick);
    Voice.stop();
    if (FOLLOW.watch !== null) navigator.geolocation.clearWatch(FOLLOW.watch);
    FOLLOW.watch = null;
    if (FOLLOW.wake) { FOLLOW.wake.release().catch(() => {}); FOLLOW.wake = null; }
    $('mapSheet').hidden = true;
  }

  // ---------- events ----------
  document.addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.limit) { state.limit = +t.dataset.limit; persist(); render(); }
    else if (t.dataset.walk) { state.walk = +t.dataset.walk; persist(); render(); }
    else if (t.dataset.pref) { state.pref = t.dataset.pref; persist(); render(); }
    else if (t.dataset.card) { state.card = t.dataset.card; persist(); render(); }
    else if (t.dataset.openCard) { state.formOpen = true; renderForm(); document.querySelector('.opts').open = true; $('cardLbl').scrollIntoView({ block: 'center' }); }
    else if (t.dataset.cat) { pickerCat = t.dataset.cat; renderCategory(); }
    else if (t.dataset.catBack) { pickerCat = null; renderPicker(''); }
    else if (t.id === 'fVoice') { state.voice = !state.voice; if (!state.voice) Voice.stop(); persist(); renderVoiceButton(); }
    else if (t.id === 'fMap') { state.glance = !state.glance; persist(); $('mapSheet').classList.toggle('glance', state.glance); renderMapButton(); if (!state.glance) showMapNow(); }
    else if (t.id === 'mapStreets') { RM.allowed = true; showMapNow(); }
    else if (t.dataset.lite) { state.lite = t.dataset.lite; persist(); applyLite(); render(); }
    else if (t.dataset.useAlt) { const alt = nearestServed(state[t.dataset.useAlt]); if (alt) { state[t.dataset.useAlt] = plain(alt.place); remember(); persist(); render(); window.scrollTo(0, 0); } }
    else if (t.dataset.goFav) { target = 'to'; choose({ ...state.favs[t.dataset.goFav], known: true }); }
    else if (t.dataset.goLast !== undefined) { target = 'to'; choose({ ...state.lastTo[+t.dataset.goLast], known: true }); }
    else if (t.dataset.legal) openLegal();
    else if (t.dataset.help) openHelp();
    else if (t.id === 'helpClose') $('helpSheet').hidden = true;
    else if (t.id === 'installNow' && deferredInstall) { deferredInstall.prompt(); deferredInstall.userChoice.finally(() => { deferredInstall = null; openHelp(); }); }
    else if (t.dataset.share !== undefined) shareTrip(lastOptions[+t.dataset.share]);
    else if (t.dataset.routeCode) { state.routeFrom = t.closest('#routesSheet') ? 'routes' : t.closest('.twin') ? state.routeFrom : null; state.routeView = t.dataset.routeCode; $('picker').hidden = true; $('routesSheet').hidden = true; state.formOpen = false; render(); window.scrollTo(0, 0); }
    else if (t.dataset.routeClose) { const back = state.routeFrom === 'routes'; state.routeView = null; state.routeFrom = null; render(); window.scrollTo(0, 0); if (back) $('routesSheet').hidden = false; }
    else if (t.dataset.openRoutes) openRoutes();
    else if (t.id === 'routesClose') $('routesSheet').hidden = true;
    else if (t.dataset.routeKind) { routesUi.kind = t.dataset.routeKind; routesUi.shown = 40; renderRoutes(); $('routesList').scrollTop = 0; }
    else if (t.dataset.routesMore) { routesUi.shown += 40; renderRoutes(); }
    else if (t.dataset.routesAll) { routesUi.at = null; renderRoutes(); $('routesList').scrollTop = 0; }
    else if (t.dataset.stopAt !== undefined) openRoutes(stopAtPlace(+t.dataset.stopAt));
    else if (t.dataset.routeMap !== undefined) { const i = +t.dataset.routeMap, { code, svc } = parseRoute(state.routeView), legs = routeVariants(code, svc).map((v, k) => routeLeg(v, k)); openMap('view', { routeView: true, focus: i, legs: [...legs.filter(l => l.dir !== i), legs[i]] }); }
    else if (t.id === 'legalClose') $('legalSheet').hidden = true;
    else if (t.id === 'forgetBtn') forgetMe(t);
    else if (t.dataset.report !== undefined) openReport(lastOptions[+t.dataset.report]);
    else if (t.id === 'reportClose') $('reportSheet').hidden = true;
    else if (t.id === 'reportCopy') copyReport();
    else if (t.dataset.updateNow) location.reload();
    else if (t.dataset.updateGet && Update.latest) downloadLatest(Update.latest);
    else if (t.id === 'showExample') { state.from = pick('portal 80'); state.to = pick('portal sur'); state.mode = 'pick'; state.example = true; render(); window.scrollTo(0, 0); }
    else if (t.id === 'sayNear' || t.id === 'fromLine') openPicker('from');
    else if (t.dataset.mode) { state.mode = t.dataset.mode; render(); }
    else if (t.dataset.pick !== undefined) choose(picks[+t.dataset.pick]);
    else if (t.dataset.setFav) openPicker(target, t.dataset.setFav);
    else if (t.dataset.openMap) openMap('pick');
    else if (t.dataset.mapOption !== undefined) openMap('view', lastOptions[+t.dataset.mapOption]);
    else if (t.dataset.follow !== undefined) startFollow(lastOptions[+t.dataset.follow]);
    else if (t.dataset.recent) { const r = state.recent.find(x => x.key === t.dataset.recent); if (r) { state.from = r.from; state.to = r.to; state.fromGps = false; state.example = false; state.mode = 'now'; state.formOpen = false; remember(); persist(); render(); window.scrollTo(0, 0); } }
    else if (t.id === 'openForm') { state.formOpen = true; renderForm(); window.scrollTo(0, 0); }
    else if (t.id === 'closeForm') { state.formOpen = false; renderForm(); window.scrollTo(0, 0); }
    else if (t.id === 'fromField') openPicker('from');
    else if (t.id === 'toField' || t.id === 'askDest') openPicker('to');
    else if (t.id === 'enableGps') useMyLocation('from');
    else if (t.id === 'useGps') useMyLocation(target);
    else if (t.id === 'swap') { const a = state.from; state.from = state.to; state.to = a; persist(); render(); }
    else if (t.id === 'pickerClose') { $('picker').hidden = true; state.savingFav = null; render(); }
    else if (t.id === 'mapClose' || t.id === 'mapNo') $('mapSheet').hidden = true;
    else if (t.id === 'mapStyle') setMapLook(!state.mapDark);
    else if (t.id === 'zoomIn') { if (!$('map').hidden) zoomCanvas(1.5, MAP.w / 2, MAP.h / 2); else if (RM.map) RM.map.zoomIn(); }
    else if (t.id === 'zoomOut') { if (!$('map').hidden) zoomCanvas(1 / 1.5, MAP.w / 2, MAP.h / 2); else if (RM.map) RM.map.zoomOut(); }
    else if (t.id === 'zoomMe') {
      locate().then(g => { if (!g) return; MAP.me = { lat: g.lat, lon: g.lon }; refreshMapData(); if (MAP.mode === 'pick') { const z = RM.map && !$('realMap').hidden ? RM.map.getZoom() : 16; pickGeo(g.lat, g.lon, 0.01); void z; } if (RM.ready && !$('realMap').hidden) RM.map.easeTo({ center: [g.lon, g.lat], zoom: 15 }); });
    }
    else if (t.id === 'mapUse' && MAP.picked) choose(MAP.picked, true);
    else if (t.id === 'fNext') { FOLLOW.i = Math.min(FOLLOW.stages.length - 1, FOLLOW.i + 1); followStep(state.gps ? state.gps.lat : null, state.gps ? state.gps.lon : null); }
    else if (t.id === 'fEnd') stopFollow();
    else if (t.id === 'fRecalc') { stopFollow(); locate().then(g => { if (g) { state.from = gpsPlace(); state.fromGps = true; state.mode = 'now'; } render(); }); }
    else if (t.id === 'installApp' && deferredInstall) { deferredInstall.prompt(); deferredInstall.userChoice.finally(() => { deferredInstall = null; $('installApp').hidden = true; }); }
  });
  document.addEventListener('click', e => { const a = e.target.closest('a[data-copy-first]'); if (a) copyReport(); });
  $('reportSheet').addEventListener('input', () => renderReport());
  $('pickerTitle').addEventListener('input', e => { pickerCat = null; renderPicker(e.target.value); });
  let routesTimer = 0;
  $('routesQuery').addEventListener('input', e => { clearTimeout(routesTimer); routesTimer = setTimeout(() => { routesUi.q = e.target.value; routesUi.at = null; routesUi.shown = 40; renderRoutes(); $('routesList').scrollTop = 0; }, 120); });
  $('day').addEventListener('change', e => { state.day = +e.target.value; render(); });
  $('time').addEventListener('change', e => { if (e.target.value) { state.time = e.target.value; render(); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !FOLLOW.active) { if (!$('helpSheet').hidden) $('helpSheet').hidden = true; else if (!$('reportSheet').hidden) $('reportSheet').hidden = true; else if (!$('legalSheet').hidden) $('legalSheet').hidden = true; else if (!$('mapSheet').hidden) $('mapSheet').hidden = true; else if (!$('routesSheet').hidden) $('routesSheet').hidden = true; else if (!$('picker').hidden) { $('picker').hidden = true; state.savingFav = null; render(); } } });
  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; $('installApp').hidden = false; });

  // Coming back to the app: refresh the position, and the route only if the rider really moved.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (FOLLOW.active) { requestWake(); return; }
    if (!state.gps || Date.now() - state.gps.at < 60000) return;
    const old = state.gps;
    locate().then(g => {
      if (!g) { state.gps = old; state.gpsState = 'ok'; return; }
      const moved = dist(old.lat, old.lon, g.lat, g.lon) > 100;
      if (state.from && state.from.kind === 'gps') state.from = gpsPlace();
      if (moved && $('picker').hidden && $('mapSheet').hidden) render();
    });
  });

  // ---------- sharing ----------
  // The link carries the two places, never the rider's exact position: "my location" becomes the nearest stop or station.
  function shareablePlace(p) {
    if (p.kind !== 'gps') return { name: p.name, lat: p.lat, lon: p.lon };
    const st = nearestStation(p.lat, p.lon);
    if (st.i >= 0 && st.m < 600) return { name: pretty(S.n[st.i]), lat: E.lat[st.i], lon: E.lon[st.i] };
    const n = E.near(p.lat, p.lon, 600);
    let best = -1, bd = 1e9;
    for (let j = 0; j < n.length; j += 2) if (!S.k[n[j]] && E.atStop[n[j]].length && n[j + 1] < bd) { bd = n[j + 1]; best = n[j]; }
    return best >= 0 ? { name: pretty(S.n[best]), lat: E.lat[best], lon: E.lon[best] } : { name: 'Cerca de ' + nearestLabel(p.lat, p.lon), lat: +p.lat.toFixed(3), lon: +p.lon.toFixed(3) };
  }
  const placeParam = p => `${p.lat.toFixed(5)},${p.lon.toFixed(5)},${encodeURIComponent(p.name)}`;
  function tripLink() {
    if (!WEB) return '';
    const a = shareablePlace(state.from), b = shareablePlace(state.to);
    return `${location.origin}${location.pathname}#de=${placeParam(a)}&a=${placeParam(b)}&max=${state.limit}`;
  }
  async function shareTrip(o) {
    const rides = o.legs.filter(l => l.type === 'ride');
    const from = shareablePlace(state.from).name, steps = rides.map((l, i) => `${i ? 'luego ' : ''}el ${l.code} en ${pretty(l.boardPlace.name)} y me bajo en ${pretty(l.alightPlace.name)}`).join(', ');
    const text = `Voy de ${from} a ${state.to.name}: tomo ${steps}. Llego cerca de las ${clock(o.arrive)}`, url = tripLink();
    try { if (navigator.share) { await navigator.share({ title: 'Mi viaje en Sin Vueltas', text, url: url || undefined }); return; } } catch (e) { if (e.name === 'AbortError') return; }
    const all = url ? `${text} ${url}` : text;
    try { await navigator.clipboard.writeText(all); announce('Viaje copiado. Pégalo en WhatsApp o donde quieras.'); toast('Viaje copiado. Pégalo en WhatsApp o donde quieras.'); }
    catch (e) { window.open(`https://wa.me/?text=${encodeURIComponent(all)}`, '_blank', 'noopener'); }
  }
  function toast(text) {
    let t = $('toast');
    if (!t) { t = document.createElement('p'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = text; t.hidden = false;
    clearTimeout(t._timer); t._timer = setTimeout(() => { t.hidden = true; }, 3500);
  }
  // Opening a shared link: the trip it names, as fixed places.
  function openSharedTrip() {
    const h = new URLSearchParams(location.hash.slice(1));
    const read = v => { if (!v) return null; const [lat, lon, ...name] = v.split(','); const a = +lat, o = +lon; return isFinite(a) && isFinite(o) ? { kind: 'geo', station: -1, stop: -1, name: decodeURIComponent(name.join(',')) || 'Punto compartido', lat: a, lon: o } : null; };
    const a = read(h.get('de')), b = read(h.get('a'));
    if (!a || !b) return false;
    state.from = a; state.to = b; state.fromGps = false; state.mode = 'now'; state.example = false;
    if ([1, 2, 3].includes(+h.get('max'))) state.limit = +h.get('max');
    history.replaceState(null, '', location.pathname + location.search);
    return true;
  }

  // ---------- links from Google Maps, WhatsApp or plain coordinates ----------
  function linkCoords(q) {
    const text = String(q), tries = [/@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/, /[?&](?:q|query|ll|destination|daddr|center)=(-?\d{1,2}\.\d+)(?:,|%2C)\s*(-?\d{1,3}\.\d+)/i, /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/, /^\s*(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})\s*$/];
    for (const re of tries) {
      const m = text.match(re);
      if (!m) continue;
      const lat = +m[1], lon = +m[2];
      if (lat > 3.7 && lat < 4.95 && lon > -74.6 && lon < -73.85) return { kind: 'geo', station: -1, stop: -1, name: 'Punto del enlace', lat, lon };
    }
    return null;
  }

  // ---------- help: how the system works, and installing the app ----------
  function openHelp() {
    const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent), installed = window.matchMedia && matchMedia('(display-mode: standalone)').matches;
    $('installSteps').innerHTML = installed ? '<p>Ya la tienes instalada.</p>'
      : `${deferredInstall ? '<button type="button" class="btn primary wide" id="installNow">Instalar ahora</button>' : ''}
      <p><b>${ios ? 'En iPhone, con Safari' : 'En Android, con Chrome'}:</b> ${ios ? 'toca el botón Compartir, el cuadro con la flecha hacia arriba, y luego «Agregar a inicio».' : 'toca el menú de los tres puntos y luego «Instalar app» o «Agregar a la pantalla principal».'}</p>
      <p>${ios ? 'En Android, con Chrome: menú de los tres puntos y «Instalar app».' : 'En iPhone, con Safari: botón Compartir y «Agregar a inicio».'}</p>`;
    $('helpSheet').hidden = false;
  }

  // ---------- privacy, terms and error reports ----------
  const CONFIG = window.SV_CONFIG || {};
  function openLegal() {
    $('legalOwner').textContent = CONFIG.owner || 'pendiente de definir';
    $('legalContact').textContent = CONFIG.contact || 'pendiente de definir';
    $('forgetBtn').textContent = 'Borrar mis datos de este teléfono'; delete $('forgetBtn').dataset.armed;
    $('legalSheet').hidden = false;
  }
  // Two taps, because the page cannot show a confirmation dialog and this cannot be undone.
  async function forgetMe(btn) {
    if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = 'Toca otra vez para borrar lugares, viajes y preferencias'; return; }
    try { localStorage.removeItem(SAVE); } catch (e) { /* storage may be blocked */ }
    try { if ('caches' in window) await caches.delete(DATA_CACHE); } catch (e) { /* nothing saved */ }
    location.reload();
  }
  const REPORT_KINDS = ['La ruta ya no pasa por ahí o cambió de recorrido', 'La parada no existe, está cerrada o se movió', 'El bus tiene otro código o destino', 'Los tiempos están muy lejos de la realidad', 'Otra cosa'];
  let reportOption = null;
  function reportText() {
    const o = reportOption, q = currentQuery();
    const rides = o.legs.filter(l => l.type === 'ride').map(l => `${l.code} hacia ${pretty(l.dest)}: de ${pretty(l.boardPlace.name)} a ${pretty(l.alightPlace.name)}`);
    const picked = [...document.querySelectorAll('#reportKinds input:checked')].map(x => REPORT_KINDS[+x.value]);
    const from = state.from.kind === 'gps' ? `cerca de ${nearestLabel(state.from.lat, state.from.lon)}` : state.from.name;
    return [`Sin Vueltas: reporte de error`, `Rutas del archivo del ${dayLabel(net.meta.feed)}`, `Viaje: ${from} → ${state.to.name}`, `Salida: ${q.label}, máximo ${busWord(state.limit)}`, ...rides.map(r => `Bus: ${r}`),
      `Problema: ${picked.length ? picked.join('; ') : 'sin marcar'}`, `Detalles: ${$('reportNote').value.trim() || 'sin detalles'}`].join('\n');
  }
  function renderReport() {
    const text = reportText();
    $('reportPreview').textContent = text;
    const mail = CONFIG.reportEmail ? `<a class="btn primary wide" href="mailto:${encodeURIComponent(CONFIG.reportEmail)}?subject=${encodeURIComponent('Error en una ruta')}&body=${encodeURIComponent(text)}">Enviar por correo</a>` : '';
    const form = CONFIG.reportForm ? `<a class="btn${mail ? '' : ' primary'} wide" href="${esc(CONFIG.reportForm)}" target="_blank" rel="noopener" data-copy-first="1">Abrir el formulario</a>` : '';
    const none = mail || form ? '' : '<p class="hint">Todavía no hay un correo ni un formulario para recibir reportes. Puedes copiarlo y guardarlo.</p>';
    $('reportActions').innerHTML = `${mail}${form}<button type="button" class="btn wide" id="reportCopy">Copiar el reporte</button>${none}<p class="hint" id="reportDone" role="status"></p>`;
  }
  function openReport(o) {
    reportOption = o;
    $('reportKinds').innerHTML = REPORT_KINDS.map((k, i) => `<label class="check"><input type="checkbox" value="${i}"><span>${esc(k)}</span></label>`).join('');
    $('reportNote').value = '';
    renderReport();
    $('reportSheet').hidden = false;
  }
  async function copyReport() {
    const text = reportText();
    try { await navigator.clipboard.writeText(text); $('reportDone').textContent = 'Copiado. Pégalo donde quieras enviarlo.'; }
    catch (e) {
      const range = document.createRange(); range.selectNodeContents($('reportPreview'));
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
      $('reportDone').textContent = 'No pudimos copiar solos. El texto quedó seleccionado: cópialo con el menú del teléfono.';
    }
  }

  // ---------- keyboard and screen readers ----------
  // Short spoken summaries: the whole results page would take minutes to read out after each change.
  function announce(text) { const el = $('announce'); el.textContent = ''; setTimeout(() => { el.textContent = text; }, 60); }
  let countTimer = 0;
  function announceCount() {
    clearTimeout(countTimer);
    countTimer = setTimeout(() => {
      if ($('picker').hidden) return;
      const n = $('pickerList').querySelectorAll('[data-pick]').length;
      announce(n === 0 ? 'Sin resultados' : n === 1 ? '1 opción' : `${n} opciones`);
    }, 700);
  }
  function announceResults() {
    const box = $('results'), head = box.querySelector('.verdict h2, .verdict p, .calc');
    if (!head) return;
    const part = s => { const el = box.querySelector(`.card-main ${s}`); return el ? el.textContent.trim().replace('~', 'cerca de las ') : ''; };
    announce([head.textContent, part('.big'), part('.arrive'), part('.price')].filter(Boolean).map(x => x.replace(/\.$/, '')).join('. '));
  }
  // Focus goes into a sheet when it opens and back where it was when it closes, and the page behind cannot be reached.
  const SHEETS = [$('picker'), $('routesSheet'), $('mapSheet'), $('legalSheet'), $('reportSheet'), $('helpSheet')], shell = document.querySelector('.shell');
  const openSheet = () => SHEETS.filter(s => !s.hidden).pop() || null;
  let topSheet = null, returnTo = null;
  function sheetsChanged() {
    const top = openSheet();
    if (top === topSheet) return;
    if (!topSheet) returnTo = document.activeElement;
    topSheet = top;
    shell.inert = !!top;
    if (top) shell.setAttribute('aria-hidden', 'true'); else shell.removeAttribute('aria-hidden');
    (top || document.body).appendChild($('announce'));
    if (top) { ({ picker: $('pickerTitle'), routesSheet: routesUi.at ? $('routesList') : $('routesQuery'), mapSheet: $('mapTitle'), legalSheet: $('legalTitle'), reportSheet: $('reportTitle'), helpSheet: $('helpTitle') })[top.id].focus(); return; }
    if (returnTo && returnTo.isConnected && returnTo.offsetParent !== null) returnTo.focus();
    else $('results').focus({ preventScroll: true });
  }
  SHEETS.forEach(s => new MutationObserver(sheetsChanged).observe(s, { attributes: true, attributeFilter: ['hidden'] }));
  // Tab stays inside the open sheet, also on browsers that do not know "inert".
  document.addEventListener('keydown', e => {
    const top = openSheet();
    if (e.key !== 'Tab' || !top) return;
    const items = [...top.querySelectorAll('a[href], button, input, select, summary, [tabindex]:not([tabindex="-1"])')].filter(x => x.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1], at = document.activeElement;
    if (e.shiftKey && (at === first || !items.includes(at))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (at === last || !items.includes(at))) { e.preventDefault(); first.focus(); }
  });

  // A strip's room changes with new results, a turned phone, the form closing or the font arriving.
  new MutationObserver(() => { fitStrips(); announceResults(); }).observe($('results'), { childList: true });
  if (window.ResizeObserver) new ResizeObserver(fitStrips).observe($('results'));
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', fitStrips);

  // First paint. Location is asked for only if the browser already has permission; otherwise the rider taps.
  const shared = WEB && openSharedTrip();
  render();
  // A shared link opened while the app is already on screen changes only the hash.
  window.addEventListener('hashchange', () => { if (WEB && openSharedTrip()) { state.routeView = null; $('picker').hidden = true; $('routesSheet').hidden = true; $('mapSheet').hidden = true; render(); window.scrollTo(0, 0); } });
  setTimeout(checkForUpdate, 4000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });
  if (WEB && navigator.geolocation && navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'geolocation' }).then(p => {
      if (p.state !== 'granted') return;
      // After hours away the current position is a better guess than the origin chosen back then.
      const stale = !!saved && !fresh;
      if (shared) return;
      locate().then(g => { if (g && (stale || !state.from && state.fromGps || state.from && state.from.kind === 'gps')) { state.from = gpsPlace(); state.fromGps = true; } render(); });
    }).catch(() => {});
  }
  window.__sinVueltas = { state, E, FOLLOW, Planner, MAP, RM, Streets, rideLine, render, Update, checkForUpdate, Photon }; // handy when debugging on a phone
};
