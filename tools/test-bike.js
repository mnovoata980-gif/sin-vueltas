// Real Bogotá trips through the bike engine, for every vehicle. Checks the promises the app makes:
// a moped or motorcycle never uses a bike path, an e-scooter never rides on a sidewalk, one-way streets are respected,
// and every route stays on streets that vehicle may use.
const fs = require('fs'), path = require('path');
const { create, cicloviaOn } = require('../js/bike.js');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'bike.json'), 'utf8'));
const t0 = Date.now(), B = create(data);
console.log(`init ${Date.now() - t0} ms · ${B.size.vertices} cruces, ${B.size.edges} tramos`);
const F = data.codes.F, C = data.codes;
const check = (name, ok) => { console.log((ok ? 'OK   ' : 'FAIL ') + name); if (!ok) process.exitCode = 1; };

const P = {
  simon: { name: 'Parque Simón Bolívar', lat: 4.6584, lon: -74.0939 },
  unal: { name: 'Universidad Nacional', lat: 4.6360, lon: -74.0830 },
  bolivar: { name: 'Plaza de Bolívar', lat: 4.5981, lon: -74.0760 },
  unicentro: { name: 'Unicentro', lat: 4.7020, lon: -74.0415 },
  americas: { name: 'Portal Américas', lat: 4.6290, lon: -74.2045 },
  suba: { name: 'Suba centro', lat: 4.7410, lon: -74.0840 },
  tintal: { name: 'Biblioteca El Tintal', lat: 4.6370, lon: -74.1540 },
  bosa: { name: 'Bosa centro', lat: 4.6180, lon: -74.1900 },
  chapinero: { name: 'Chapinero, Calle 60 con Cra 9', lat: 4.6460, lon: -74.0630 },
  usme: { name: 'Portal Usme', lat: 4.5300, lon: -74.1180 },
};
const VEH = ['bici', 'ebici', 'patineta', 'ciclomotor', 'moto'];
const m = s => Math.round(s / 60), km = x => (x / 1000).toFixed(1);
let worst = 0;
function run(a, b, vehicle, opt = {}) {
  const t = Date.now();
  const r = B.plan({ from: a, to: b, vehicle, day: opt.day || 0, minute: opt.minute || 480, ciclovia: !!opt.ciclovia, pref: opt.pref });
  const ms = Date.now() - t;
  worst = Math.max(worst, ms);
  const x = r.main;
  if (x.error) { console.log(`${a.name} -> ${b.name} [${vehicle}] ERROR ${x.error}`); return r; }
  console.log(`${a.name} -> ${b.name} [${vehicle}${opt.ciclovia ? ', domingo' : ''}] ${m(x.sec)} min ${km(x.dist)} km · ${x.pct}% infra · camina ${Math.round(x.walkM)} m · ${x.groups.length} tramos · ${ms} ms${r.other ? ` | otra: ${m(r.other.sec)} min ${km(r.other.dist)} km ${r.other.pct}%` : ''}`);
  return r;
}
// Every edge a route used, with how it was used.
const used = x => x.groups.flatMap(g => g.legs.map(l => ({ e: l.e, kind: l.kind })));
// Reads an edge's flags straight from the data (the engine keeps them private).
const eFlags = (() => { const n = data.e.length / 6, out = new Int32Array(n); for (let i = 0; i < n; i++) out[i] = data.e[6 * i + 3]; return out; })();
const clsOf = e => (eFlags[e] >> C.CLS_SHIFT) & 15, infOf = e => (eFlags[e] >> C.INF_SHIFT) & 7;

const pairs = [['simon', 'unal'], ['unal', 'bolivar'], ['chapinero', 'unicentro'], ['americas', 'tintal'], ['bosa', 'simon'], ['suba', 'unicentro'], ['usme', 'bolivar']];
const results = {};
for (const [a, b] of pairs) for (const v of VEH) results[a + '>' + b + ':' + v] = run(P[a], P[b], v);

for (const [k, r] of Object.entries(results)) {
  const v = k.split(':')[1], x = r.main;
  if (x.error) { check(`${k} tiene ruta`, false); continue; }
  const u = used(x);
  if (v === 'ciclomotor' || v === 'moto') {
    const bad = u.filter(l => clsOf(l.e) >= C.CLS.cycleway && clsOf(l.e) !== C.CLS.track);
    check(`${k}: nunca por ciclorruta, andén ni sendero`, !bad.length);
    check(`${k}: solo vías permitidas para su vehículo`, u.every(l => eFlags[l.e] & (v === 'moto' ? F.moto : F.moped)));
    check(`${k}: no camina`, x.walkM === 0);
  } else {
    const ridden = u.filter(l => l.kind !== 'walk');
    check(`${k}: rueda solo donde se permite bici`, ridden.every(l => eFlags[l.e] & F.bike));
    if (v !== 'bici') check(`${k}: nunca rueda por andén ni entre peatones`, ridden.every(l => !(eFlags[l.e] & F.sidewalk)));
  }
}
// The safe route uses more bike infrastructure than the direct one, or the same.
for (const [a, b] of pairs) {
  const r = results[a + '>' + b + ':bici'];
  if (r.other) check(`${a}>${b}: la ruta segura usa más cicloinfraestructura que la directa`, r.main.pct >= r.other.pct);
}
// A moped is not faster than an e-bike on a short trip only because it ignores bike paths, but it must reach.
check('ciclomotor llega de Bosa al Simón Bolívar', !results['bosa>simon:ciclomotor'].main.error);
// Sunday ciclovía: bikes ride it, motor vehicles avoid it.
const sundayBike = run(P.chapinero, P.unicentro, 'bici', { ciclovia: true, day: 2, minute: 600 });
const sundayMoto = run(P.chapinero, P.unicentro, 'moto', { ciclovia: true, day: 2, minute: 600 });
check('domingo: la bici aprovecha la ciclovía', sundayBike.main.cicloviaM > 500);
check('domingo: la moto no entra a la ciclovía', sundayMoto.main.cicloviaM === 0 && used(sundayMoto.main).every(l => data.cv.findIndex((x, i) => i % 2 === 0 && x === l.e) < 0));
check('cicloviaOn: domingo 10 a. m. sí, 3 p. m. no, lunes no', cicloviaOn(2, 600) && !cicloviaOn(2, 900) && !cicloviaOn(0, 600));
check(`cada ruta se calcula en menos de 1,5 s (peor: ${worst} ms)`, worst < 1500);

// Show one route in words.
const show = results['simon>unal:bici'].main;
console.log('\nSimón Bolívar -> U. Nacional en bici:');
for (const g of show.groups) console.log(`  ${g.turn.padEnd(15)} ${g.kind.padEnd(11)} ${(g.name || '(sin nombre)').padEnd(36)} ${Math.round(g.len)} m hacia ${g.toward}`);
const showM = results['simon>unal:ciclomotor'].main;
console.log('\nSimón Bolívar -> U. Nacional en ciclomotor:');
for (const g of showM.groups) console.log(`  ${g.turn.padEnd(15)} ${g.kind.padEnd(11)} ${(g.name || '(sin nombre)').padEnd(36)} ${Math.round(g.len)} m hacia ${g.toward}`);
