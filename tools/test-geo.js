// Address and place search. The parsing checks run offline; pass --online to also query the search service.
const Geo = require('../js/geo.js');
const dist = (a1, o1, a2, o2) => { const r = Math.PI / 180, x = (a2 - a1) * r, y = (o2 - o1) * r * Math.cos((a1 + a2) * r / 2); return 6371000 * Math.sqrt(x * x + y * y); };
const check = (name, ok, extra) => { console.log((ok ? 'OK   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!ok) process.exitCode = 1; };

const PARSE = [
  ['Calle 72 # 10-20', { via: 'calle', num: '72', cross: '10', plate: '20' }],
  ['kr 7 #32-16', { via: 'carrera', num: '7', cross: '32', plate: '16' }],
  ['Cra. 15 No. 93-47', { via: 'carrera', num: '15', cross: '93', plate: '47' }],
  ['Av. Calle 26 # 68-10', { via: 'calle', num: '26', cross: '68', plate: '10' }],
  ['Calle 58 sur # 24-30', { via: 'calle', num: '58', cross: '24', plate: '30', sur: true }],
  ['calle 72 con 10', { via: 'calle', num: '72', cross: '10', plate: null }],
  ['calle 72 con carrera 10', { via: 'calle', num: '72', cross: '10', plate: null }],
  ['cra 7 # 32', { via: 'carrera', num: '7', cross: '32', plate: null }],
  ['carrera 15 con 93', { via: 'carrera', num: '15', cross: '93', plate: null }],
  ['la 72 con 10', { via: 'calle', num: '72', cross: '10', plate: null }],
  ['la 15 con 93', { via: 'carrera', num: '15', cross: '93', plate: null }],
  ['72 con 10', { via: 'calle', num: '72', cross: '10', plate: null }],
  ['la séptima con 32', { via: 'carrera', num: '7', cross: '32', plate: null }],
  ['la caracas con 45', { road: 'avenida caracas', cross: '45', plate: null }],
  ['boyacá con calle 80', { road: 'avenida boyaca', cross: '80', plate: null }],
  ['autonorte con 170', { road: 'autopista norte', cross: '170', plate: null }],
  ['Calle 45A con 13', { via: 'calle', num: '45', letter: 'a', cross: '13', plate: null }],
];
for (const [q, want] of PARSE) {
  const got = Geo.parseAddress(q);
  check(`entiende «${q}»`, !!got && Object.entries(want).every(([k, v]) => got[k] === v), got ? got.text : 'sin reconocer');
}
for (const q of ['unicentro', 'portal suba', 'hospital san ignacio', 'calle 72', 'barrio galan']) check(`«${q}» no es una dirección`, Geo.parseAddress(q) === null);
// How people really type addresses: abbreviations, no "#", glued letters, apartment and neighborhood at the end.
const LABELS = [
  ['cl72#10-20', 'Calle 72 # 10-20'], ['CALLE 72 No. 10 - 20 Apto 301, Bogotá D.C.', 'Calle 72 # 10-20'], ['calle 72 numero 10 20', 'Calle 72 # 10-20'],
  ['Cra 7 # 45-10 Chapinero', 'Carrera 7 # 45-10'], ['Tv. 18 # 75-30 torre 2 apto 502', 'Transversal 18 # 75-30'], ['AK 15 # 100-20', 'Carrera 15 # 100-20'],
  ['Kra 50 Bis A # 3-25 Sur', 'Carrera 50 Bis A # 3-25 Sur'], ['calle 45abis # 13-20', 'Calle 45A Bis # 13-20'], ['Dg 40 A Bis # 15-20', 'Diagonal 40A Bis # 15-20'],
  ['Carrera 1 G E # 84A-42', 'Carrera 1G Este # 84A-42'], ['Calle 26 Sur # 10-15 Este', 'Calle 26 Sur # 10-15 Este'], ['calle 1 a bis sur 12 30', 'Calle 1A Bis Sur # 12-30'],
  ['Av Boyacá # 64-60', 'Avenida Boyacá # 64-60'], ['Av. Primero de Mayo # 30-20', 'Avenida Primero de Mayo # 30-20'], ['Cll 100 # 19A-30 of 501', 'Calle 100 # 19A-30'],
];
for (const [q, want] of LABELS) { const got = Geo.parseAddress(q); check(`lee «${q}»`, !!got && got.label === want, got ? got.label : 'sin reconocer'); }

// Placing addresses by the street grid, offline. Known places, checked against the map.
const grid = require('../data/grid.json');
const PLACED = [
  ['Carrera 11 # 82-71', 4.6665, -74.0526, 150], ['Carrera 7 # 28-66', 4.6155, -74.0690, 150], ['Calle 72 # 10-20', 4.6565, -74.0581, 150],
  ['Calle 38A Sur # 34D-50', 4.5925, -74.1236, 200], ['Calle 185 # 45-03', 4.7630, -74.0447, 200], ['Carrera 1 # 18A-12', 4.6015, -74.0662, 150],
  ['la caracas con 45', 4.6326, -74.0677, 250],
];
for (const [q, lat, lon, tol] of PLACED) {
  const r = Geo.findAddress(grid, q)[0], m = r ? Math.round(dist(lat, lon, r.lat, r.lon)) : null;
  check(`ubica «${q}» con la cuadrícula`, m !== null && m < tol, r ? `${r.label} a ${m} m` : 'nada');
}
const both = Geo.findAddress(grid, '72 con 10').map(r => r.label);
check('«72 con 10» ofrece calle y carrera', both.includes('Calle 72 con Carrera 10') && both.includes('Carrera 72 con Calle 10'), both.join(' | '));
const sur = Geo.findAddress(grid, 'calle 73a 82d 65').map(r => r.label);
check('sin «Sur» ofrece también la del sur, después', sur[0] === 'Calle 73A # 82D-65' && sur.includes('Calle 73A Sur # 82D-65'), sur.join(' | '));
check('no inventa una dirección fuera de la ciudad', Geo.findAddress(grid, 'Calle 400 # 300-20').length === 0);

const ALIAS = { 'u nacional': 'universidad nacional de colombia', 'Universidad Nacional': 'universidad nacional de colombia', 'la javeriana': 'pontificia universidad javeriana', 'el campín': 'estadio el campin', 'la terminal': 'terminal de transporte', aeropuerto: 'aeropuerto internacional el dorado', autonorte: 'autopista norte', 'la 72': 'calle 72', 'la 15': 'carrera 15', 'la séptima': 'carrera 7' };
for (const [q, want] of Object.entries(ALIAS)) check(`alias «${q}»`, Geo.canonical(q) === want, Geo.canonical(q));

if (process.argv.includes('--online')) {
  const CASES = [
    ['Calle 72 # 10-20', 4.6565, -74.0585, 400], ['Carrera 7 # 32-16', 4.6188, -74.0675, 400], ['calle 72 con 10', 4.6565, -74.0585, 400],
    ['cra 7 con 32', 4.6188, -74.0675, 400], ['la caracas con 45', 4.633, -74.0673, 400], ['Unicentro', 4.7021, -74.0412, 400],
    ['Universidad Nacional', 4.6387, -74.0852, 600], ['la terminal', 4.654, -74.1163, 500], ['aeropuerto', 4.7021, -74.1477, 900], ['el campín', 4.6459, -74.0776, 400],
  ];
  const agent = (u, o) => fetch(u, { ...o, headers: { 'User-Agent': 'SinVueltas/0.3 (prototype)' } });
  (async () => {
    for (const [q, lat, lon, tol] of CASES) {
      const r = await Geo.search(q, undefined, agent), top = r.results[0];
      const m = top ? Math.round(dist(lat, lon, top.lat, top.lon)) : null;
      check(`${q} -> ${top ? top.name : 'nada'}`, m !== null && m < tol, `a ${m} m`);
      await new Promise(s => setTimeout(s, 700));
    }
    for (const c of Geo.CATEGORIES) { const l = await Geo.category(c.id, undefined, agent); check(`categoría ${c.label}: ${l.length} lugares`, l.length >= 2, l.slice(0, 3).map(p => p.name).join(' | ')); await new Promise(s => setTimeout(s, 700)); }
  })();
}
