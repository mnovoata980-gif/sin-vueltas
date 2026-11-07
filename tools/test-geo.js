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
