// Keeps the app and its routes usable with a weak or missing signal, which happens a lot inside buses and stations.
// The app's own files live in a cache named after their content, so a day with no code changes downloads nothing.
// The routes live apart, in a cache that survives app updates: the page decides when to replace them (see checkForUpdate).
const CACHE = 'sinvueltas-__VERSION__', DATA = 'sinvueltas-data';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];
const PATIENCE = 3000; // how long to wait for the network when a saved copy is ready

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== DATA).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Our own files: fresh from the network when it answers quickly, otherwise the saved copy.
// The network request keeps going in the background, so the next visit gets the update.
function ownFile(e) {
  const req = e.request;
  const network = fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); return caches.open(CACHE).then(c => c.put(req, copy)).then(() => res); }
    return res;
  });
  e.waitUntil(network.catch(() => {}));
  const saved = () => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('index.html') : undefined));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = res => { if (!settled) { settled = true; clearTimeout(timer); resolve(res); } };
    const timer = setTimeout(() => saved().then(hit => { if (hit) finish(hit); }), PATIENCE);
    network.then(finish).catch(() => saved().then(hit => {
      if (hit) finish(hit);
      else if (!settled) { settled = true; clearTimeout(timer); reject(new TypeError('Sin conexión y sin copia guardada')); }
    }));
  });
}
// Routes and street lines: the saved copy always wins. Only the first visit downloads them here.
function routeData(req) {
  return caches.open(DATA).then(c => c.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
    if (res.ok) c.put(req, res.clone());
    return res;
  })));
}

// The street-corner table and the bike map: kept like the routes, but each build of them has its own address (?b=),
// and an older one is thrown away when the new one arrives.
function builtData(req, name) {
  const same = new RegExp('/' + name + '\\.json');
  return caches.open(DATA).then(c => c.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok) {
      c.put(req, res.clone());
      c.keys().then(keys => keys.filter(k => same.test(k.url) && k.url !== req.url).forEach(k => c.delete(k)));
    }
    return res;
  })));
}

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.origin === location.origin) {
    // A request with ?v= is the page asking for a newer copy, and version.json must always be fresh.
    if (url.searchParams.has('v') || url.pathname.endsWith('/version.json')) return;
    if (/\/(network|shapes)\.json$/.test(url.pathname)) { e.respondWith(routeData(req)); return; }
    if (/\/grid\.json$/.test(url.pathname)) { e.respondWith(builtData(req, 'grid')); return; }
    if (/\/bike\.json$/.test(url.pathname)) { e.respondWith(builtData(req, 'bike')); return; }
    e.respondWith(ownFile(e));
    return;
  }
  // The map library and fonts never change at these pinned addresses, so a saved copy is safe.
  // Address searches and map tiles are not cached here.
  if (url.hostname === 'unpkg.com' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
  }
});
