// Place and address search. Bogotá addresses encode a grid position ("Calle 72 # 10-20" is Calle 72 at Carrera 10),
// so results are re-ranked by that logic, because the search service alone often picks the wrong block.
// Only the typed text and Bogotá's fixed bounding box are ever sent. The rider's position never is.
(function (root) {
  const BBOX = '-74.25,4.45,-73.98,4.85';
  const PHOTON = 'https://photon.komoot.io/api/';
  const fold = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  const VIA = { calle: 'calle', cl: 'calle', cll: 'calle', clle: 'calle', 'av calle': 'calle', 'avenida calle': 'calle', ac: 'calle', carrera: 'carrera', cra: 'carrera', cr: 'carrera', kr: 'carrera', kra: 'carrera', k: 'carrera', ak: 'carrera', 'av carrera': 'carrera', 'avenida carrera': 'carrera', diagonal: 'diagonal', dg: 'diagonal', diag: 'diagonal', transversal: 'transversal', tv: 'transversal', trans: 'transversal' };
  const VIA_RE = 'avenida\\s+calle|avenida\\s+carrera|av\\s+calle|av\\s+carrera|calle|clle|cll|cl|ac|carrera|cra|kra|cr|kr|ak|k|diagonal|diag|dg|transversal|trans|tv';
  // Roads people name without a number, as they appear in the map data.
  const ROADS = { caracas: 'avenida caracas', boyaca: 'avenida boyaca', autonorte: 'autopista norte', 'autopista norte': 'autopista norte', 'auto norte': 'autopista norte', nqs: 'avenida nqs', suba: 'avenida suba', americas: 'avenida de las americas', 'primero de mayo': 'avenida primero de mayo', 'primera de mayo': 'avenida primero de mayo', cali: 'avenida ciudad de cali', 'ciudad de cali': 'avenida ciudad de cali', circunvalar: 'avenida circunvalar', eldorado: 'avenida el dorado', 'el dorado': 'avenida el dorado', esperanza: 'avenida la esperanza' };
  const ROAD_RE = Object.keys(ROADS).sort((a, b) => b.length - a.length).join('|');
  // Numbered carreras that people call just "la 7" or "la 68". Any other "la N" is taken as a calle.
  const CARRERAS = new Set(['7', '9', '10', '11', '14', '15', '30', '50', '68', '86', '96']);
  const WORDS = { primera: '1', septima: '7', octava: '8', novena: '9', decima: '10', once: '11', trece: '13', quince: '15', treinta: '30' };

  function clean(q) {
    let s = fold(q).replace(/\b(no|nro|numero|num|n°)\.?\s*(?=\d)/g, '# ').replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
    s = s.replace(new RegExp(`\\b(?:la\\s+)?(${Object.keys(WORDS).join('|')})\\b`, 'g'), (m, w) => `la ${WORDS[w]}`);
    return s;
  }
  const other = via => (via === 'calle' ? 'carrera' : 'calle');

  function parseAddress(q) {
    const s = clean(q);
    const build = (a) => {
      const crossText = `${a.cross}${a.crossLetter || ''}`;
      a.text = a.road ? `${a.road} ${crossText}-${a.plate || ''}` : `${a.via} ${a.num}${a.letter || ''} ${crossText}-${a.plate || ''}`;
      a.corner = !a.plate;
      return a;
    };
    // Calle 72 # 10-20 and all its spellings.
    let m = s.match(new RegExp(`^(${VIA_RE})\\s*(\\d+)\\s*([a-z]{0,2})\\s*(?:bis)?\\s*(sur|este)?\\s*(?:#|-|\\s)\\s*(\\d+)\\s*([a-z]{0,2})\\s*(?:-|\\s)\\s*(\\d+)\\s*(sur|este)?$`));
    if (m) return build({ via: VIA[m[1].replace(/\s+/g, ' ')], num: m[2], letter: m[3] || '', cross: m[5], crossLetter: m[6] || '', plate: m[7], sur: m[4] === 'sur' || m[8] === 'sur' });
    // Calle 72 con 10, Cra 7 # 32, Calle 72 con Carrera 10 (a corner, no plate).
    m = s.match(new RegExp(`^(${VIA_RE})\\s*(\\d+)\\s*([a-z]{0,2})\\s*(?:bis)?\\s*(sur|este)?\\s*(?:#|con|x|y|esquina|-|\\s)\\s*(?:(?:${VIA_RE})\\s*)?(\\d+)\\s*([a-z]{0,2})\\s*(sur|este)?$`));
    if (m) return build({ via: VIA[m[1].replace(/\s+/g, ' ')], num: m[2], letter: m[3] || '', cross: m[5], crossLetter: m[6] || '', plate: null, sur: m[4] === 'sur' || m[7] === 'sur' });
    // La Caracas con 45, Boyacá con Calle 80.
    m = s.match(new RegExp(`^(?:la\\s+|avenida\\s+|av\\s+)?(${ROAD_RE})\\s+(?:con|#|x|y)\\s+(?:(?:${VIA_RE})\\s*)?(\\d+)\\s*([a-z]{0,2})\\s*(sur)?$`));
    if (m) return build({ road: ROADS[m[1]], roadWord: m[1], cross: m[2], crossLetter: m[3] || '', plate: null, sur: m[4] === 'sur' });
    // La 72 con 10, 72 con 10. Which is calle and which carrera comes from how Bogotá calls them.
    m = s.match(/^(?:la\s+)?(\d+)\s*([a-z]{0,2})\s*(sur)?\s+(?:con|x|y)\s+(?:la\s+)?(\d+)\s*([a-z]{0,2})\s*(sur)?$/);
    if (m) {
      const firstIsCarrera = CARRERAS.has(m[1]) && !CARRERAS.has(m[4]);
      return build({ via: firstIsCarrera ? 'carrera' : 'calle', num: m[1], letter: m[2] || '', cross: m[4], crossLetter: m[5] || '', plate: null, sur: m[3] === 'sur' || m[6] === 'sur' });
    }
    return null;
  }

  // What people say, turned into what the map data calls it.
  const ALIASES = [
    [/^(la )?(u )?nacional$|^unal$|^universidad nacional$|^la nacho$/, 'universidad nacional de colombia'],
    [/^(los )?andes$|^uniandes$/, 'universidad de los andes'],
    [/^(la )?javeriana$/, 'pontificia universidad javeriana'],
    [/^(el )?rosario$/, 'universidad del rosario'],
    [/^(la )?pedagogica$/, 'universidad pedagogica nacional'],
    [/^(el )?externado$/, 'universidad externado de colombia'],
    [/^(el )?campin$|^estadio$/, 'estadio el campin'],
    [/^(la )?terminal$|^terminal de buses$|^terminal salitre$/, 'terminal de transporte'],
    [/^aeropuerto$|^(el )?aeropuerto el dorado$/, 'aeropuerto internacional el dorado'],
    [/^abastos$/, 'corabastos'],
    [/^(el )?simon bolivar$|^parque simon$/, 'parque metropolitano simon bolivar'],
    [/^autonorte$|^auto norte$/, 'autopista norte'],
    [/^(la )?plaza de bolivar$/, 'plaza de bolivar'],
    [/^(el )?san ignacio$/, 'hospital universitario san ignacio'],
    [/^(el )?hospital militar$/, 'hospital militar central'],
    [/^(la )?caracas$/, 'avenida caracas'],
    [/^(la )?boyaca$/, 'avenida boyaca'],
  ];
  function canonical(q) {
    const s = clean(q);
    for (const [re, to] of ALIASES) if (re.test(s)) return to;
    const road = s.match(/^la (\d+)([a-z]?)$/);
    if (road) return `${CARRERAS.has(road[1]) ? 'carrera' : 'calle'} ${road[1]}${road[2]}`;
    return null;
  }

  function scoreCandidate(addr, p) {
    if (!addr) return 0;
    const street = fold(p.street || p.name || ''), house = fold(p.housenumber || '').replace(/\s+/g, '');
    let score = 0;
    if (addr.road) {
      if (!street.includes(addr.roadWord)) return -5;
      score += 5;
    } else {
      const streetNum = street.match(/(\d+)\s*([a-z]{0,2})\b/);
      // A matching plate on a different road means nothing: Carrera 45 # 26-85 is not Carrera 13 # 26-45.
      if (!streetNum || streetNum[1] !== addr.num) return -5;
      score += street.includes(addr.via) ? 4 : 2;
      if ((streetNum[2] || '') === addr.letter) score += 1;
    }
    const h = house.match(/^(\d+)([a-z]{0,2})-(\d+)/);
    if (h) {
      if (h[1] === addr.cross) {
        score += 5;
        if (h[2] === addr.crossLetter) score += 1;
        // For a corner, the lowest plate is the closest to it.
        const plate = addr.plate ? +addr.plate : 0;
        score += Math.max(0, 1 - Math.abs(+h[3] - plate) / 100);
      } else score -= Math.min(3, Math.abs(+h[1] - +addr.cross) / 3);
    }
    if (/\bsur\b/.test(street) !== addr.sur) score -= 2;
    return score;
  }

  // Bus stops and stations are already in our own data, and their map entries would crowd out the places people want.
  const isTransitEntry = p => (p.osm_key === 'highway' && p.osm_value === 'bus_stop') || p.osm_key === 'railway' || (p.osm_value === 'bus_station' && !/terminal/i.test(p.name || ''));
  const USELESS = new Set(['charging_station', 'atm', 'parking', 'parking_entrance', 'taxi']);

  function toPlace(f, addr) {
    const p = f.properties || {}, c = f.geometry.coordinates, score = scoreCandidate(addr, p);
    const title = p.name || [p.street, p.housenumber].filter(Boolean).join(' # ');
    const sub = [p.name && p.street ? [p.street, p.housenumber].filter(Boolean).join(' # ') : null, p.district || p.locality, p.city].filter(Boolean).join(', ');
    return { kind: 'geo', station: -1, stop: -1, name: title, sub, lat: c[1], lon: c[0], score, exact: !!addr && score >= 9, transit: isTransitEntry(p), useless: USELESS.has(p.osm_value) };
  }

  function unique(list) {
    const seen = new Set();
    return list.filter(p => { const k = fold(p.name) + '|' + p.lat.toFixed(3) + p.lon.toFixed(3); if (seen.has(k)) return false; seen.add(k); return true; });
  }

  async function search(q, signal, fetcher) {
    const addr = parseAddress(q), alias = addr ? null : canonical(q), f = fetcher || fetch;
    const text = addr ? addr.text : (alias || q);
    const url = `${PHOTON}?limit=${addr ? 15 : 10}&bbox=${BBOX}&q=${encodeURIComponent(text + ' Bogotá')}`;
    const r = await f(url, { signal });
    if (!r.ok) throw new Error('search ' + r.status);
    const j = await r.json();
    let list = (j.features || []).map(x => toPlace(x, addr)).filter(p => p.name && !p.useless);
    if (addr) list.sort((a, b) => b.score - a.score);
    else list = list.filter(p => !p.transit).concat(list.filter(p => p.transit).slice(0, 1));
    return { address: addr, alias, results: unique(list).slice(0, 6) };
  }

  // Lists for people who know what kind of place they need but not how it is written.
  const CATEGORIES = [
    { id: 'hospital', label: 'Hospital', query: 'hospital', tag: 'amenity:hospital', local: /\bhospital\b/i },
    { id: 'clinica', label: 'Clínica', query: 'clinica', tag: 'amenity:clinic', local: /\bcl[ií]nica\b/i },
    { id: 'universidad', label: 'Universidad', query: 'universidad', tag: 'amenity:university', local: /\buniversidad\b/i },
    { id: 'centro', label: 'Centro comercial', query: 'centro comercial', tag: 'shop:mall', local: /^c\.?\s?c\.?\s|centro comercial/i },
    { id: 'biblioteca', label: 'Biblioteca', query: 'biblioteca', tag: 'amenity:library', local: /\bbiblioteca\b/i },
    { id: 'notaria', label: 'Notaría', query: 'notaria', tag: 'office:notary', local: /\bnotar[ií]a\b/i },
    { id: 'viajes', label: 'Terminal y aeropuerto', queries: ['terminal de transporte', 'aeropuerto internacional el dorado'], only: /^(terminal|aeropuerto)/i, local: /\bterminal\b|\baeropuerto\b/i },
  ];
  // Bare labels in the map data ("Notaria", "Centro Comercial") do not tell a rider where they are going.
  const isBare = name => /^(centro comercial|c\.?c\.?|notar[ií]a|hospital|cl[ií]nica|universidad|biblioteca)$/i.test(String(name).trim());

  async function category(id, signal, fetcher) {
    const cat = CATEGORIES.find(c => c.id === id), f = fetcher || fetch;
    const urls = cat.queries
      ? cat.queries.map(q => `${PHOTON}?limit=4&bbox=${BBOX}&q=${encodeURIComponent(q + ' Bogotá')}`)
      : [`${PHOTON}?limit=40&bbox=${BBOX}&q=${encodeURIComponent(cat.query)}&osm_tag=${encodeURIComponent(cat.tag)}`];
    const pages = await Promise.all(urls.map(u => f(u, { signal }).then(r => { if (!r.ok) throw new Error('search ' + r.status); return r.json(); })));
    const list = pages.flatMap(j => j.features || []).map(x => toPlace(x, null)).filter(p => p.name && !p.useless && !p.transit && !isBare(p.name) && (!cat.only || cat.only.test(p.name)));
    return unique(list);
  }

  const api = { parseAddress, canonical, scoreCandidate, search, category, toPlace, other, CATEGORIES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BusGeo = api;
})(typeof window !== 'undefined' ? window : globalThis);
