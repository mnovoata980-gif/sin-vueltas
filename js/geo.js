// Place and address search. Bogotá addresses encode a grid position ("Calle 72 # 10-20" is Calle 72 at Carrera 10),
// so results are re-ranked by that logic, because the search service alone often picks the wrong block.
// Only the typed text and Bogotá's fixed bounding box are ever sent. The rider's position never is.
(function (root) {
  const BBOX = '-74.25,4.45,-73.98,4.85';
  const PHOTON = 'https://photon.komoot.io/api/';
  const fold = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  // ---------- reading an address ----------
  // People write the same address many ways: "Cl 72 #10-20", "calle72 n 10 20", "CRA. 15 No. 93-47 apto 301",
  // "Av Boyacá # 64-60", "la 72 con 10". Everything is first brought to one plain spelling, then read.
  const VIA_WORDS = [
    ['calle', 'avenida calle|avenida cll|avenida cl|avda calle|av calle|av cll|av cl|ac'],
    ['carrera', 'avenida carrera|avenida cra|avenida kra|avenida kr|avda carrera|av carrera|av cra|av kra|av kr|av cr|av k|ak'],
    ['calle', 'calle|calles|cll|clle|cl|cale|call|cal|c'],
    ['carrera', 'carrera|carerra|carrrera|carera|karrera|cra|crr|carr|cr|kra|kr|k'],
    ['diagonal', 'diagonal|diag|dgl|dig|dg|dl'],
    ['transversal', 'transversal|tranversal|transv|trans|tranv|trv|tv|tr'],
  ];
  const VIA = {};
  for (const [via, words] of VIA_WORDS) for (const w of words.split('|')) VIA[w] = via;
  const VIA_RE = Object.keys(VIA).sort((a, b) => b.length - a.length).map(w => w.replace(/ /g, '\\s')).join('|');
  // Roads people call by name. Most have a number in the grid ("la Caracas" is Carrera 14), which places them;
  // the rest are only searched by name.
  const ROADS = {
    caracas: ['carrera', 14, 'avenida caracas'], 'autopista norte': ['carrera', 45, 'autopista norte'], autonorte: ['carrera', 45, 'autopista norte'], 'auto norte': ['carrera', 45, 'autopista norte'],
    boyaca: ['carrera', 72, 'avenida boyaca'], nqs: ['carrera', 30, 'avenida nqs'], 'ciudad de quito': ['carrera', 30, 'avenida ciudad de quito'],
    'el dorado': ['calle', 26, 'avenida el dorado'], eldorado: ['calle', 26, 'avenida el dorado'],
    'primero de mayo': ['calle', -22, 'avenida primero de mayo'], 'primera de mayo': ['calle', -22, 'avenida primero de mayo'], '1 de mayo': ['calle', -22, 'avenida primero de mayo'],
    'ciudad de cali': ['carrera', 86, 'avenida ciudad de cali'], cali: ['carrera', 86, 'avenida ciudad de cali'], chile: ['calle', 72, 'avenida chile'],
    jimenez: ['calle', 13, 'avenida jimenez'], 'pepe sierra': ['calle', 116, 'avenida pepe sierra'], esperanza: ['calle', 24, 'avenida la esperanza'], 'la esperanza': ['calle', 24, 'avenida la esperanza'],
    rojas: ['carrera', 70, 'avenida rojas'], 'ciudad de lima': ['calle', 19, 'avenida ciudad de lima'], comuneros: ['calle', 6, 'avenida comuneros'], centenario: ['calle', 13, 'avenida centenario'],
    'autopista medellin': ['calle', 80, 'autopista medellin'], 'san jose': ['calle', 170, 'avenida san jose'], 'las villas': ['carrera', 58, 'avenida las villas'],
    primera: ['carrera', 1, 'carrera 1'], septima: ['carrera', 7, 'carrera 7'], octava: ['carrera', 8, 'carrera 8'], novena: ['carrera', 9, 'carrera 9'], decima: ['carrera', 10, 'carrera 10'],
    once: ['carrera', 11, 'carrera 11'], trece: ['carrera', 13, 'carrera 13'], quince: ['carrera', 15, 'carrera 15'], treinta: ['carrera', 30, 'carrera 30'],
    suba: [null, 0, 'avenida suba'], americas: [null, 0, 'avenida de las americas'], 'las americas': [null, 0, 'avenida de las americas'], circunvalar: [null, 0, 'avenida circunvalar'],
    'autopista sur': [null, 0, 'autopista sur'], 'ciudad de villavicencio': [null, 0, 'avenida ciudad de villavicencio'], villavicencio: [null, 0, 'avenida ciudad de villavicencio'],
  };
  const ROAD_RE = Object.keys(ROADS).sort((a, b) => b.length - a.length).map(w => w.replace(/ /g, '\\s')).join('|');
  // Numbered roads people call just "la 7" or "la 68". Any other "la N" is read as a calle first.
  const CARRERAS = new Set(['7', '9', '10', '11', '13', '14', '15', '19', '30', '50', '68', '86', '96']);
  const WORDS = { primera: '1', septima: '7', octava: '8', novena: '9', decima: '10', once: '11', trece: '13', quince: '15', treinta: '30' };
  // What comes after the address itself: apartment, tower, office, neighborhood.
  const EXTRAS = /\s(?:apto|apartamento|apart|apt|ap|int|interior|torre|tor|piso|of|ofi|oficina|local|loc|lc|casa|cs|bloque|blq|bl|etapa|conjunto|conj|edificio|edif|ed|barrio|br|urbanizacion|urb|lote|lt|manzana|mz|parqueadero|consultorio|cons|bodega|sector|unidad|porteria|primer|segundo)\b.*$/;

  function clean(q) {
    let s = fold(q).replace(/\b(no|nro|numero|num|n°)\.?\s*(?=\d)/g, '# ').replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
    s = s.replace(new RegExp(`\\b(?:la\\s+)?(${Object.keys(WORDS).join('|')})\\b`, 'g'), (m, w) => `la ${WORDS[w]}`);
    return s;
  }
  function cleanAddress(q) {
    let s = fold(q).replace(/\([^)]*\)/g, ' ').replace(/[–—_]/g, '-').replace(/[º°]/g, ' ');
    s = s.replace(/\b1\s?o\s+de\s+mayo/g, '1 de mayo');
    s = s.replace(/\b(?:n|no|nro|numero|num|nm)\s*\.?\s*(?=\d)/g, ' # ').replace(/#/g, ' # ').replace(/-/g, ' - ');
    s = s.replace(/[.,;:'"/]/g, ' ').replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2').replace(/\b([a-h])bis\b/g, '$1 bis');
    s = s.replace(/\b(?:bogota|d\s?c|colombia|cundinamarca)\b/g, ' ').replace(/\s+/g, ' ').trim();
    s = (' ' + s).replace(EXTRAS, '').trim();
    return s.replace(/(?:\s[#-])+$/, '').trim();
  }

  // 45, 45A, 45 Bis, 45A Bis B. A second letter comes only after "bis"; a lone "e" after a number means Este.
  const NUM = '(\\d{1,3})(?:\\s([a-h])\\b)?(?:\\s(bis)(?:\\s([a-h])\\b)?)?';
  const FLAG = '(?:\\s(sur|este|e))?';
  // After the first road: a separator, maybe the second road's name, its number, then the plate.
  const TAIL = new RegExp(`^${FLAG}(?:\\s(?:#|con|x|y|esq|esquina|entre|con\\sesquina))?(?:\\s(?:${VIA_RE}|la))?\\s${NUM}${FLAG}(?:(?:\\s-)?\\s(\\d{1,3}))?${FLAG}(?:\\s(?!sur\\b|este\\b|bis\\b|[a-h]\\b)[a-z]{2,}.*)?$`);
  const VIA_NAME = { calle: 'Calle', carrera: 'Carrera', diagonal: 'Diagonal', transversal: 'Transversal' };
  const ACCENTS = { boyaca: 'Boyacá', jimenez: 'Jiménez', medellin: 'Medellín', jose: 'José', americas: 'Américas' };
  const title = s => s.split(' ').map((w, i) => ACCENTS[w] || (i && /^(de|la|las|el|del|los)$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
  const numText = (n, l, b, bl) => `${n}${l ? l.toUpperCase() : ''}${b ? ' Bis' : ''}${bl ? ' ' + bl.toUpperCase() : ''}`;

  // Every reasonable reading of what was typed, the likeliest first. A reading marked alt adds a "Sur" or "Este"
  // that the rider may have left out; guess marks a road whose kind (calle or carrera) was not said.
  function addressReadings(q) {
    const s = cleanAddress(q);
    const heads = [];
    let m = s.match(new RegExp(`^(${VIA_RE})\\s(?=\\d)`));
    if (m) heads.push({ via: VIA[m[1]], rest: s.slice(m[0].length), named: null });
    if (!heads.length) {
      m = s.match(new RegExp(`^(?:(?:la|el|avenida|av|avda|ave)\\s)*(${ROAD_RE})(?=\\s(?:#|con|x|y|esq|-|\\d))`));
      if (m) {
        const [via, num, text] = ROADS[m[1]];
        heads.push({ via, named: { word: m[1], text, num }, rest: s.slice(m[0].length) });
      }
    }
    if (!heads.length) {
      // "la 72 con 10", "avenida 19 # 120-30", "72 # 10-20": calle or carrera is not said.
      m = s.match(/^(?:(?:la|avenida|av|avda|ave)\s)?(?=\d)/);
      if (m) {
        const n = (s.slice(m[0].length).match(/^\d+/) || [''])[0], first = CARRERAS.has(n) ? 'carrera' : 'calle';
        for (const via of [first, first === 'calle' ? 'carrera' : 'calle']) heads.push({ via, guess: true, rest: s.slice(m[0].length), named: null });
      }
    }
    const out = [];
    for (const h of heads) {
      let rest = ' ' + h.rest.trim(), num = '', letter = '', bis = false, bisLetter = '';
      if (h.named) num = h.via ? String(Math.abs(h.named.num)) : '';
      else {
        const n = rest.match(new RegExp(`^\\s${NUM}`));
        if (!n) continue;
        [num, letter, bis, bisLetter] = [n[1], n[2] || '', !!n[3], n[4] || ''];
        rest = rest.slice(n[0].length);
      }
      const t = rest.match(TAIL);
      if (!t) continue;
      const [, f1, cross, crossLetter, crossBis, crossBisLetter, f2, plate, f3] = t;
      // Bogotá's rule: "Sur" belongs to the calle and "Este" to the carrera, wherever it was written.
      const axis = h.via ? AXIS[h.via] : null, flags = [f1, f2, f3].filter(Boolean).map(f => (f === 'e' ? 'este' : f));
      const sur = flags.includes('sur'), este = flags.includes('este');
      let viaNeg = axis === 'cl' ? sur : axis === 'kr' ? este : false, crossNeg = axis === 'cl' ? este : axis === 'kr' ? sur : sur;
      if (h.named && h.named.num < 0) viaNeg = true;
      const base = {
        via: h.via, num, letter: letter || '', bis, bisLetter: bisLetter || '', viaNeg, axis,
        cross, crossLetter: crossLetter || '', crossBis: !!crossBis, crossBisLetter: crossBisLetter || '', crossNeg, plate: plate || null,
        road: h.named && !/^(carrera|calle) /.test(h.named.text) ? h.named.text : null, roadWord: h.named ? h.named.word : null, guess: !!h.guess, alt: null,
      };
      out.push(finish(base));
      // A missing "Sur" or "Este" is the most common slip; those readings count only if that corner really exists.
      // A named avenue keeps its own side; only the cross street can be the forgotten one.
      if (axis && !sur && !este) {
        if (!h.named || axis === 'kr') out.push(finish({ ...base, viaNeg: h.named ? viaNeg : axis === 'cl', crossNeg: axis === 'kr', alt: 'sur' }));
        if (!h.named || axis === 'cl') out.push(finish({ ...base, viaNeg: h.named ? viaNeg : axis === 'kr', crossNeg: axis === 'cl', alt: 'este' }));
      }
    }
    return out;
  }
  function finish(a) {
    a.value = a.axis ? seriesValue(a.num, a.letter, a.bis, a.bisLetter, a.viaNeg) : null;
    // The search service's street name says "Sur" only when the road itself is a Sur calle.
    a.sur = a.axis === 'cl' && a.viaNeg;
    const crossAxis = a.axis === 'cl' ? 'kr' : 'cl';
    const negWord = ax => (ax === 'cl' ? ' Sur' : ' Este');
    const crossText = numText(a.cross, a.crossLetter, a.crossBis, a.crossBisLetter);
    const viaText = a.road && !/^carrera|^calle/.test(a.road) ? title(a.road) : `${VIA_NAME[a.via]} ${numText(a.num, a.letter, a.bis, a.bisLetter)}${a.viaNeg ? negWord(a.axis) : ''}`;
    const crossNegText = a.crossNeg ? negWord(a.axis ? crossAxis : 'cl') : '';
    a.label = a.plate ? `${viaText} # ${crossText}-${a.plate}${crossNegText}` : `${viaText} con ${a.axis ? (crossAxis === 'cl' ? 'Calle' : 'Carrera') : ''} ${crossText}${crossNegText}`.replace(/\s+/g, ' ');
    // What the search service is asked for.
    a.text = a.road ? `${a.road} ${a.cross}${a.crossLetter}-${a.plate || ''}` : `${a.via} ${a.num}${a.letter}${a.viaNeg ? ' ' + negWord(a.axis).trim().toLowerCase() : ''} ${a.cross}${a.crossLetter}-${a.plate || ''}`;
    a.corner = !a.plate;
    return a;
  }
  // The likeliest reading, or null when the text is not an address.
  function parseAddress(q) {
    const r = addressReadings(q);
    return r.length ? r[0] : null;
  }
  const other = via => (via === 'calle' || via === 'diagonal' ? 'carrera' : 'calle');

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

  // ---------- the street grid ----------
  // Calles and diagonales run one way, carreras and transversales the other. A street's place in its series is a
  // number: "Calle 45A Bis B Sur" is -(45 + A + bis + B). Sur calles and Este carreras count negative, so the
  // whole city is one grid. Letters split the block: 45 < 45 Bis < 45A < 45A Bis < 45B.
  const LETTERS = 'abcdefgh';
  function seriesValue(num, letter, bis, bisLetter, neg) {
    const li = letter ? LETTERS.indexOf(letter) + 1 : 0, bi = bisLetter ? LETTERS.indexOf(bisLetter) + 1 : 0;
    const v = +num + Math.min(li, 6) * 0.14 + (bis ? 0.07 : 0) + Math.min(bi, 3) * 0.02;
    return neg ? -v : v;
  }
  const AXIS = { calle: 'cl', diagonal: 'cl', carrera: 'kr', transversal: 'kr' };
  // How the map data writes a numbered street: "Avenida Carrera 68D Bis Este", "Calle 12F", "Calle 25 bis".
  function parseStreet(name) {
    const m = fold(name).trim().match(/^(?:avenida\s+)?(calle|carrera|diagonal|transversal)\s+(\d{1,3})\s*([a-h])?\s*(bis)?\s*([a-h])?\s*(sur|este)?$/);
    if (!m) return null;
    const via = m[1], axis = AXIS[via], neg = (axis === 'cl' && m[6] === 'sur') || (axis === 'kr' && m[6] === 'este');
    return { via, axis, value: seriesValue(m[2], m[3], !!m[4], m[5], neg) };
  }

  // grid: { cl: [...], kr: [...], lat: [...], lon: [...] } — every corner where a numbered calle meets a numbered carrera.
  function gridIndex(grid) {
    if (grid._buckets) return grid;
    const b = new Map();
    for (let i = 0; i < grid.cl.length; i++) {
      const k = Math.floor(grid.cl[i]);
      if (!b.has(k)) b.set(k, []);
      b.get(k).push(i);
    }
    grid._buckets = b;
    return grid;
  }
  // Corners near (cl, kr) in grid terms, nearest first. One block is one unit.
  function gridNear(grid, cl, kr, radius, max) {
    gridIndex(grid);
    const out = [];
    for (let k = Math.floor(cl - radius); k <= Math.floor(cl + radius); k++) {
      const list = grid._buckets.get(k);
      if (!list) continue;
      for (const i of list) {
        const d = Math.hypot(grid.cl[i] - cl, grid.kr[i] - kr);
        if (d <= radius) out.push([i, d]);
      }
    }
    return out.sort((a, b) => a[1] - b[1]).slice(0, max || 12);
  }
  const M_LAT = 110574, mLon = lat => 111320 * Math.cos(lat * Math.PI / 180);

  // Weighted plane through nearby corners: lat and lon as straight functions of (cl, kr). Gives the spot even when the
  // two streets never actually meet, and the direction the plate numbers grow in.
  function planeFit(grid, near, cl, kr) {
    const solve = (vals) => {
      let s = [0, 0, 0, 0, 0, 0], t = [0, 0, 0];
      for (const [i, d] of near) {
        const w = 1 / (0.3 + d * d), x = grid.cl[i] - cl, y = grid.kr[i] - kr, z = vals[i];
        s[0] += w; s[1] += w * x; s[2] += w * y; s[3] += w * x * x; s[4] += w * x * y; s[5] += w * y * y;
        t[0] += w * z; t[1] += w * x * z; t[2] += w * y * z;
      }
      // 3x3 normal equations [[s0 s1 s2][s1 s3 s4][s2 s4 s5]] · [a b c] = t
      const A = [[s[0], s[1], s[2]], [s[1], s[3], s[4]], [s[2], s[4], s[5]]];
      const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
      const D = det(A);
      if (Math.abs(D) < 1e-9) return null;
      const col = (j) => det(A.map((row, r) => row.map((v, c) => (c === j ? t[r] : v))));
      return [col(0) / D, col(1) / D, col(2) / D];
    };
    const la = solve(grid.lat), lo = solve(grid.lon);
    return la && lo ? { lat: la[0], lon: lo[0], dLat: [la[1], la[2]], dLon: [lo[1], lo[2]] } : null;
  }

  // Where "Calle 72 # 10-20" is: the corner of Calle 72 and Carrera 10, then 20 m along Calle 72 toward Carrera 11.
  // Returns null when the grid has nothing near enough to say.
  function locateAddress(grid, addr) {
    const onAxis = addr.axis, crossNeg = addr.crossNeg;
    const viaV = addr.value, crossV = seriesValue(addr.cross, addr.crossLetter, addr.crossBis, addr.crossBisLetter, crossNeg);
    const cl = onAxis === 'cl' ? viaV : crossV, kr = onAxis === 'cl' ? crossV : viaV;
    const near = gridNear(grid, cl, kr, 4, 14);
    if (near.length < 3) return null;
    const nearest = near[0][1];
    // Several corners close by, or the exact one, are needed: across a gap the plane would land in the wrong place.
    if (nearest > 2.5) return null;
    let fit = planeFit(grid, near, cl, kr);
    const exact = nearest < 0.02 ? near[0][0] : -1;
    if (!fit) {
      if (exact < 0) return null;
      fit = { lat: grid.lat[exact], lon: grid.lon[exact], dLat: [0, 0], dLon: [0, 0] };
    }
    // Sanity: the plane must land close to the corners it was built from.
    const n0 = near[0][0], gap = Math.hypot((fit.lat - grid.lat[n0]) * M_LAT, (fit.lon - grid.lon[n0]) * mLon(fit.lat));
    if (gap > 150 + nearest * 220) return null;
    let lat = exact >= 0 ? grid.lat[exact] : fit.lat, lon = exact >= 0 ? grid.lon[exact] : fit.lon;
    // The plate counts meters from the corner toward the next cross street. Este carreras and Sur calles grow the other way.
    const plate = addr.plate ? Math.min(+addr.plate, 120) : 0;
    if (plate) {
      const j = onAxis === 'cl' ? 1 : 0, sign = crossNeg ? -1 : 1;
      const gy = fit.dLat[j] * M_LAT * sign, gx = fit.dLon[j] * mLon(lat) * sign, len = Math.hypot(gx, gy);
      if (len > 5) { lat += (gy / len) * plate / M_LAT; lon += (gx / len) * plate / mLon(lat); }
    }
    return { lat, lon, exact: exact >= 0 && nearest < 0.02, blocks: nearest };
  }

  // Every reading of the text that the grid can place, best first. A reading that adds a forgotten Sur or Este, or
  // guesses calle or carrera, counts only when that corner really exists. Two readings on the same spot are one.
  function findAddress(grid, q) {
    if (!grid) return [];
    const found = [];
    addressReadings(q).forEach((a, order) => {
      if (!a.axis) return;
      const r = locateAddress(grid, a);
      if (!r) return;
      if (a.alt && !r.exact) return;
      if (a.guess && !r.exact && r.blocks > 1) return;
      found.push({ ...a, lat: r.lat, lon: r.lon, exact: r.exact, blocks: r.blocks, rank: (a.alt ? 20 : 0) + (r.exact ? 0 : 10) + order * 0.01 });
    });
    found.sort((x, y) => x.rank - y.rank);
    const out = [];
    for (const f of found) if (!out.some(o => Math.hypot((o.lat - f.lat) * M_LAT, (o.lon - f.lon) * mLon(f.lat)) < 60)) out.push(f);
    return out.slice(0, 4);
  }

  const api = { findAddress, parseAddress, addressReadings, cleanAddress, canonical, scoreCandidate, search, category, toPlace, other, CATEGORIES, parseStreet, seriesValue, locateAddress, gridIndex, gridNear };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BusGeo = api;
})(typeof window !== 'undefined' ? window : globalThis);
