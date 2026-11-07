// Runs real Bogotá trips through the engine and checks its core promises.
const fs = require('fs'), path = require('path');
const { create, legible, contrast, fareOf } = require('../js/engine.js');
const net = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'network.json'), 'utf8'));
const t0 = Date.now(), E = create(net);
console.log('init ms', Date.now() - t0);
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const served = i => E.children[i].some(c => E.atStop[c].length);
const station = q => { const i = E.stops.n.findIndex((n, j) => E.stops.k[j] === 1 && served(j) && norm(n).includes(norm(q))); if (i < 0) throw new Error('no station ' + q); return { stop: -1, station: i, name: E.stops.n[i], lat: E.lat[i], lon: E.lon[i] }; };
const stop = q => { const i = E.stops.n.findIndex((n, j) => !E.stops.k[j] && E.stops.p[j] < 0 && norm(n).includes(norm(q)) && E.atStop[j].length); if (i < 0) throw new Error('no stop ' + q); return { stop: i, station: -1, name: E.stops.n[i], lat: E.lat[i], lon: E.lon[i] }; };
const m = s => Math.round(s / 60);
const show = (a, b, h = 8, day = 0, maxWalk = 600) => {
  const t = Date.now(), r = E.plan({ from: a, to: b, day, time: h * 3600, maxBuses: 3, maxWalk });
  console.log(`\n=== ${a.name} -> ${b.name} @${h}h day${day} (${Date.now() - t} ms)`);
  for (const g of r.groups) {
    console.log(` ${g.buses} bus: ${g.options.length ? '' : 'sin opcion'} ${g.saves != null ? 'ahorra ' + m(g.saves) + ' min' : ''}`);
    for (const o of g.options) console.log(`   ${m(o.total)} min (camina ${m(o.walk)} espera ${m(o.wait)} va ${m(o.ride)}) ` + o.legs.filter(l => l.type === 'ride').map(l => `${l.code}->${l.dest} [${l.boardPlace.name} -> ${l.alightPlace.name}, ${l.stopsCount}p, cada ${m(l.hwAll)}m${l.also.length ? ', o ' + l.also.map(x => x.code).join('/') : ''}]`).join(' + '));
  }
  if (r.hint) console.log('  hint: directo caminando', r.hint.walkMin, 'min');
  return r;
};
const check = (name, ok) => { console.log((ok ? 'OK   ' : 'FAIL ') + name); if (!ok) process.exitCode = 1; }; // a failure blocks the daily publish
const pn = station('Portal Norte'), ps = station('Portal Sur'), usme = station('Portal Usme'), jim = station('Jim'), ame = station('Portal Am'), suba = station('Portal Suba'), el80 = station('Portal 80');

const a = show(pn, jim); show(pn, usme); show(ame, suba); show(el80, ps); show(ps, pn, 18); show(pn, jim, 23); show(pn, jim, 8, 2);
show(stop('Br. Techo'), jim);
// The feed's first buses leave around 02:30, so at 01:00 every option must include that long wait.
const late = E.plan({ from: pn, to: jim, day: 0, time: 1 * 3600, maxBuses: 2, maxWalk: 600 });
check('a la 1 am ninguna opcion finge que hay bus ya', late.groups.every(g => g.options.every(o => o.wait >= 80 * 60)));
const dead = E.plan({ from: pn, to: jim, day: 0, time: 26.9 * 3600, maxBuses: 2, maxWalk: 600 });
check('despues del ultimo servicio no hay opciones', dead.groups.every(g => !g.options.length));
const noServ = E.stops.n.findIndex((n, j) => E.stops.k[j] === 1 && !served(j));
if (noServ >= 0) {
  const closed = { stop: -1, station: noServ, name: E.stops.n[noServ], lat: E.lat[noServ], lon: E.lon[noServ] };
  check('estacion sin rutas se resuelve por lo que hay cerca', E.plan({ from: pn, to: closed, day: 0, time: 8 * 3600, maxBuses: 2, maxWalk: 900 }).fewest !== null);
}
const worst = net.routes.map(r => legible(r[2], r[3])).reduce((m, [b, f]) => Math.min(m, contrast(b, f)), 99);
console.log('peor contraste de placa', worst.toFixed(2), '| verde', legible('00ff00', 'ffffff').join('/'), '| rojo', legible('ff0000', 'ffffff').join('/'), '| azul', legible('0000ff', 'ffffff').join('/'));
check('todas las placas son legibles', worst >= 4.5);
check('todas las placas de cada motor son legibles', E.routes.every(r => contrast(r[2], r[3]) >= 4.5));
const ride = o => o.legs.filter(l => l.type === 'ride').map(l => l.code).join('+');
const q = { from: ame, to: suba, day: 0, time: 8 * 3600, limit: 2, maxWalk: 600 };
const byBuses = E.recommend({ ...q, pref: 'buses' }), byTime = E.recommend({ ...q, pref: 'time' }), byWalk = E.recommend({ ...q, pref: 'walk' });
console.log('recomienda | buses:', ride(byBuses.ranked[0]), Math.round(byBuses.ranked[0].total / 60), '| rapido:', ride(byTime.ranked[0]), Math.round(byTime.ranked[0].total / 60), '| caminar:', ride(byWalk.ranked[0]), Math.round(byWalk.ranked[0].walk / 60));
check('recomendacion respeta el limite', [byBuses, byTime, byWalk].every(r => r.ranked.every(o => o.buses <= 2)));
// "Menos buses": a second bus wins only when it saves more than its change costs (6 min in a station, 8 at the stop, 12 walking).
const COST = { station: 360, stop: 480, walk: 720 }, changeCost = o => o.legs.reduce((s, l) => s + (l.change ? COST[l.change] : 0), 0);
const direct = byBuses.ranked.filter(o => o.buses === 1).sort((a, b) => a.total - b.total)[0], recB = byBuses.ranked[0];
check('menos buses: otro bus solo si ahorra mas que el cambio', recB.buses === 1 || !direct || recB.total + changeCost(recB) < direct.total);
check('cada transbordo dice como es (estacion, paradero o caminando)', byTime.ranked.every(o => o.legs.filter(l => l.type === 'ride').every((l, i) => (i === 0) === !l.change)));
// Without a personalized card every bus is paid, so a second fare needs a bigger saving.
const other = E.recommend({ ...q, pref: 'buses', card: 'other' }).ranked[0], plus = E.recommend({ ...q, pref: 'buses', card: 'plus' }).ranked[0];
check('sin tarjeta personalizada no paga mas por ahorrar poco', other.fare.basic <= plus.fare.basic);
check('prioridad rapido no es mas lenta que menos buses', byTime.ranked[0].total <= byBuses.ranked[0].total);
check('prioridad caminar no camina mas que menos buses', byWalk.ranked[0].walk <= byBuses.ranked[0].walk);
// Fares: built by hand so each rule is tested on its own.
const leg = (agency, boardSt, alightSt, ready, wait = 0, routeIdx = agency * 100) => ({ type: 'ride', agency, ready, wait, routeIdx, boardPlace: { station: boardSt }, alightPlace: { station: alightSt } });
const fare = (...rides) => fareOf({ legs: rides }, 3550);
const T0 = 8 * 3600;
const one = fare(leg(3, -1, -1, T0));
check('un bus cuesta un pasaje', one.plus === 3550 && one.basic === 3550);
const insideStation = fare(leg(1, 5, 9, T0), leg(1, 9, 12, T0 + 1800));
check('cambiar de bus dentro de la estacion no se cobra a nadie', insideStation.plus === 3550 && insideStation.basic === 3550);
const trunkZonal = fare(leg(1, 5, 9, T0), leg(3, -1, -1, T0 + 1800));
check('troncal y zonal: gratis solo con tarjeta personalizada', trunkZonal.plus === 3550 && trunkZonal.basic === 7100);
const twoZonal = fare(leg(3, -1, -1, T0, 0, 1), leg(3, -1, -1, T0 + 1800, 0, 2));
check('dos zonales: gratis solo con tarjeta personalizada', twoZonal.plus === 3550 && twoZonal.basic === 7100);
const betweenStations = fare(leg(1, 5, 9, T0), leg(1, 20, 12, T0 + 1800));
check('salir de una estacion y entrar a otra se cobra incluso con personalizada', betweenStations.plus === 7100 && betweenStations.stationWalk);
const lateT = fare(leg(3, -1, -1, T0, 0, 1), leg(3, -1, -1, T0 + 126 * 60, 0, 2));
check('pasados 125 minutos se paga otro pasaje', lateT.plus === 7100 && lateT.lateTransfer);
const onTime = fare(leg(3, -1, -1, T0, 0, 1), leg(3, -1, -1, T0 + 120 * 60, 0, 2));
check('a los 120 minutos sigue gratis y se avisa que esta cerca', onTime.plus === 3550 && onTime.transferMin === 120);
const threeBuses = fare(leg(3, -1, -1, T0, 0, 1), leg(3, -1, -1, T0 + 1800, 0, 2), leg(7, -1, -1, T0 + 3600, 0, 3));
check('tres buses con dos transbordos gratis', threeBuses.plus === 3550 && threeBuses.basic === 10650);
const feederTrunk = fare(leg(2, -1, 5, T0), leg(1, 5, 9, T0 + 900));
check('alimentador y troncal: un solo pasaje', feederTrunk.plus === 3550 && feederTrunk.basic === 3550 && feederTrunk.feeder);
const realInside = E.recommend({ from: pn, to: usme, day: 0, time: 8 * 3600, limit: 2, maxWalk: 600, pref: 'time' }).ranked[0];
check('el motor calcula precio en sus opciones', !!realInside.fare && realInside.fare.plus >= 3550);
console.log('precio real', ride(realInside), realInside.fare.plus, realInside.fare.basic);

// What the rider reads on the bus. These come from real routes in the official file.
const placeOf = i => ({ stop: i, station: -1, name: E.stops.n[i], lat: E.lat[i], lon: E.lon[i] });
const round = net.patterns.find(p => p.c === 'A153' && p.x && p.x[0][1] === 'C153');
check('ruta de ida y vuelta guarda su cambio de letrero', !!round);
if (round) {
  const turn = round.x[0][0], direct = (a, b) => E.plan({ from: placeOf(a), to: placeOf(b), day: 0, time: 8 * 3600, maxBuses: 1, maxWalk: 200 }).groups.flatMap(g => g.options);
  const shown = o => o.flatMap(x => x.legs.filter(l => l.type === 'ride').flatMap(l => [l.code, ...l.also.map(y => y.code)]));
  check('en la primera mitad se ve A153', shown(direct(round.s[2], round.s[turn - 3])).includes('A153'));
  check('en la segunda mitad se ve C153, no A153', shown(direct(round.s[turn + 2], round.s[round.s.length - 3])).includes('C153'));
  const across = direct(round.s[turn - 2], round.s[turn + 2]).flatMap(o => o.legs).find(l => l.type === 'ride' && l.code === 'A153');
  if (across) check('quien sigue a bordo recibe aviso del cambio de letrero', !!across.signChange && across.signChange.code === 'C153');
}
const feederLoop = net.patterns.find(p => p.c === '8-1' && p.x);
check('alimentador: de ida dice el barrio y de vuelta la estacion', !!feederLoop && feederLoop.d === 'Kennedy Central' && feederLoop.x[0][2] === 'Banderas');
const sameCode = net.patterns.filter(p => p.c === 'H632');
check('mismo codigo en los dos sentidos: el destino sale de donde termina', sameCode.length > 0 && sameCode.some(p => /General Santander/.test(p.d) && /General Santander/.test(E.stops.n[p.s[p.s.length - 1]])));
check('nadie sube ni baja en puntos de regulacion', E.stops.n.every((n, i) => !/regulaci/i.test(n) || !E.atStop[i].length));
const shapeFile = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'shapes.json'), 'utf8'));
check('cada recorrido tiene su trazado', shapeFile.feed === net.meta.feed && shapeFile.pats.length === net.patterns.length && shapeFile.pats.every(Boolean));
{
  // Each stop must fall on the stretch of street it was anchored to, or the map would draw the wrong part of the route.
  const { segDist } = require('./shape-tools');
  let total = 0, off = 0;
  net.patterns.forEach((p, i) => {
    const [lineIdx, steps] = shapeFile.pats[i], flat = shapeFile.lines[lineIdx], pts = [];
    let a = 0, o = 0;
    for (let k = 0; k < flat.length; k += 2) { a += flat[k]; o += flat[k + 1]; pts.push([a / 1e5, o / 1e5]); }
    let at = 0;
    steps.forEach((step, pos) => {
      at += step;
      const s = p.s[pos], q = pts[Math.min(at + 1, pts.length - 1)], r = pts[at];
      total++;
      if (segDist(E.lat[s], E.lon[s], r[0], r[1], q[0], q[1]).d > 150) off++;
    });
  });
  console.log('paradas sobre su tramo de calle', total - off, 'de', total);
  check('las paradas caen sobre su tramo de calle', off / total < 0.005);
}
check('ninguna ruta del archivo queda sin tiempos', net.patterns.every(p => p.t.length === p.s.length - 1 && p.h.some(row => /[^0]/.test(row))));

// Arriving by a set time.
const byEight = E.solve({ from: pn, to: jim, day: 0, time: 8 * 3600, arriveBy: 8 * 3600, limit: 2, maxWalk: 600, pref: 'buses' });
const fm = s => `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}`;
console.log('llegar a las 8:00: sal', fm(byEight.depart), 'llega', fm(byEight.ranked[0].arrive), 'margen', Math.round(byEight.margin / 60), 'min', ride(byEight.ranked[0]));
check('llegar a tiempo: sale antes y llega antes de la hora', byEight.depart < 8 * 3600 && byEight.ranked.every(o => o.arrive <= 8 * 3600));
check('llegar a tiempo: no sale absurdamente temprano', 8 * 3600 - byEight.ranked[0].arrive < 45 * 60);
const dawn = E.solve({ from: pn, to: jim, day: 0, time: 3600, arriveBy: 3600, limit: 2, maxWalk: 600, pref: 'buses' });
check('llegar a la 1 am: dice que no hay como', dawn.depart === null && dawn.ranked.length === 0);
const longTrip = E.solve({ from: pn, to: usme, day: 2, time: 10 * 3600, arriveBy: 10 * 3600, limit: 1, maxWalk: 600, pref: 'buses' });
check('respeta el limite de buses al pedir hora de llegada', longTrip.ranked.every(o => o.buses <= 1));
let tA = Date.now(); E.solve({ from: ame, to: suba, day: 0, time: 8 * 3600, arriveBy: 8 * 3600, limit: 3, maxWalk: 900, pref: 'buses' }); console.log('hora de llegada ms', Date.now() - tA);

const close = E.nearby(4.6565, -74.0585, 500, 0, 8 * 3600);
console.log('cerca de Calle 72 con Cra 10:', close.slice(0, 3).map(g => `${g.name} (${Math.round(g.meters)} m, ${g.routes.length} rutas: ${g.routes.slice(0, 3).map(r => r.code).join('/')})`).join(' | '));
check('hay rutas cerca de un punto central', close.length > 0);
check('de madrugada no hay rutas cerca', E.nearby(4.6565, -74.0585, 500, 0, 0.5 * 3600).length === 0);
const same = E.plan({ from: pn, to: pn, day: 0, time: 8 * 3600, maxBuses: 2, maxWalk: 600 });
console.log('mismo origen y destino', same.fewest, Math.round(same.walkDirect));
const pt = { stop: -1, station: -1, name: 'Punto', lat: 4.65, lon: -74.1 };
check('punto arbitrario del mapa funciona', E.plan({ from: pt, to: jim, day: 0, time: 8 * 3600, maxBuses: 2, maxWalk: 900 }).fewest !== null);
console.log('plataformas Jimenez', E.children[jim.station].slice(0, 5).map(i => E.stops.n[i]));
for (const g of a.groups) for (const o of g.options) check(`limite exacto: ${g.buses} bus`, o.legs.filter(l => l.type === 'ride').length === g.buses);
check('tiempos positivos', a.groups.every(g => g.options.every(o => o.legs.every(l => l.sec >= 0 && (l.wait === undefined || l.wait >= 0)))));
let t = Date.now(), runs = 0; for (const [x, y] of [[pn, usme], [ame, suba], [el80, ps], [usme, pn]]) { E.plan({ from: x, to: y, day: 0, time: 8 * 3600, maxBuses: 3, maxWalk: 900 }); runs++; }
console.log('avg plan ms', (Date.now() - t) / runs);
const dq = name => { const seen = new Set(); return E.stops.n.filter((n, j) => !E.stops.k[j] && E.stops.p[j] < 0 && new RegExp(name, 'i').test(n) && !seen.has(n) && seen.add(n)).slice(0, 12); };
console.log('nombres calle', dq('^(cl|kr|ak|ac|av)'), '\nnombres raros', dq('regul|plat|plt|^\\d'));
