// Builds both targets from one source:
//   site/  the web app (GPS, addresses, street map, installable), published as static files
//   dist/  one file with the data inside, for the embedded preview page
const fs = require('fs'), path = require('path');
const r = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const safe = s => s.replace(/<\/script/gi, '<\\/script');
const fill = (html, key, value) => html.split(key).join(value); // split/join: values contain "$" patterns
const write = (f, c) => { const p = path.join(__dirname, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); };

// Added from a script so a slow connection never holds up the first paint. The system font shows until it arrives.
// Light mode is decided here, before the page paints, so a phone that asks to save data never downloads the font.
const FONT_URL = 'https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700;800&display=swap';
const FONTS = `<script>(function () {
  var c = navigator.connection || {}, m = navigator.deviceMemory, choice = '', loaded = false;
  var signal = c.saveData ? 'data' : /2g/.test(c.effectiveType || '') ? 'slow' : m && m <= 2 ? 'memory' : '';
  try { choice = (JSON.parse(localStorage.getItem('sinvueltas.v2')) || {}).lite || ''; } catch (e) {}
  window.SVLite = { signal: signal, font: function () {
    if (loaded) return;
    loaded = true;
    var p = document.createElement('link'); p.rel = 'preconnect'; p.href = 'https://fonts.gstatic.com'; p.crossOrigin = ''; document.head.appendChild(p);
    var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '${FONT_URL}'; document.head.appendChild(l);
  } };
  if (choice === 'on' || (choice !== 'off' && signal)) document.documentElement.setAttribute('data-lite', ''); else window.SVLite.font();
})();</script>`;
const css = r('app.css'), engine = safe(r('js/engine.js')), geo = safe(r('js/geo.js')), app = safe(r('js/app.js')), data = r('data/network.json'), streets = r('data/shapes.json');
const meta = JSON.parse(data).meta;
// The owner's own choices (name, contact, where error reports go). Empty fields stay empty: the app says so instead of inventing them.
const config = fs.existsSync(path.join(__dirname, 'config.json')) ? JSON.parse(r('config.json')) : {};
const CONFIG = `<script>window.SV_CONFIG = ${JSON.stringify({ owner: config.owner || '', contact: config.contact || '', reportEmail: config.reportEmail || '', reportForm: config.reportForm || '' }).replace(/</g, '\\u003c')};</script>`;
const body = r('index.src.html');

const LOADER = `(function () {
  var el = document.getElementById('network');
  if (el) { SVBoot(el.textContent); return; }
  fetch('network.json').then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }).then(SVBoot).catch(function () {
    document.getElementById('results').innerHTML = '<div class="notice">No pudimos cargar las rutas. Revisa tu conexión a internet e intenta de nuevo.</div>';
  });
  if ('serviceWorker' in navigator && (location.hostname !== 'localhost' || /[?&]sw=1/.test(location.search))) navigator.serviceWorker.register('sw.js');
})();`;

// ---------- web app ----------
const webHead = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Sin Vueltas</title>
<meta name="description" content="Rutas de TransMilenio y SITP en Bogotá con el número de buses que tú decides. App no oficial.">
<meta name="theme-color" content="#1b3fcb">
${config.siteUrl ? `<meta property="og:title" content="Sin Vueltas">
<meta property="og:description" content="Rutas de TransMilenio y SITP en Bogotá con el número de buses que tú decides.">
<meta property="og:type" content="website">
<meta property="og:url" content="${config.siteUrl}">
<meta property="og:image" content="${config.siteUrl}icon-512.png">
<meta name="twitter:card" content="summary">` : ''}
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icon-180.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Sin Vueltas">
${FONTS}
<style>${css}</style>
</head>
<body>`;
const webScripts = `<script>window.SV_TARGET = 'web';</script>
${CONFIG}
<script id="engineSrc">${engine}</script>
<script>${geo}</script>
<script>${app}</script>
<script>${LOADER}</script>
</body>
</html>`;
const site = fill(fill(body, '<!--__HEAD__-->', webHead), '<!--__SCRIPTS__-->', webScripts);
write('site/index.html', site);
write('site/network.json', data);
write('site/shapes.json', streets);
write('site/manifest.webmanifest', JSON.stringify({
  name: 'Sin Vueltas', short_name: 'Sin Vueltas', description: 'Rutas de TransMilenio y SITP con el número de buses que tú decides.',
  lang: 'es', start_url: '.', scope: '.', display: 'standalone', background_color: '#1b3fcb', theme_color: '#1b3fcb',
  icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }],
}, null, 1));
for (const f of ['icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png']) fs.copyFileSync(path.join(__dirname, 'assets', f), path.join(__dirname, 'site', f));
// The phone checks this small file each day and downloads the routes only when it is worth it (see checkForUpdate in js/app.js).
write('site/version.json', JSON.stringify({ feed: meta.feed, sig: meta.sig }));
// Named after the app's own files, so a daily build that only brings new routes does not make phones download the app again.
const shellHash = require('crypto').createHash('sha1');
for (const f of ['site/index.html', 'site/manifest.webmanifest', 'sw.src.js', 'assets/icon.svg', 'assets/icon-192.png', 'assets/icon-512.png']) shellHash.update(fs.readFileSync(path.join(__dirname, f)));
write('site/sw.js', fill(r('sw.src.js'), '__VERSION__', shellHash.digest('hex').slice(0, 12)));

// ---------- embedded preview ----------
const previewHead = `<title>Sin Vueltas</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n${FONTS}\n<style>${css}</style>`;
const previewScripts = `<script type="application/json" id="network">${data.replace(/<\//g, '<\\/')}</script>
<script type="application/json" id="shapes">${streets}</script>
<script>window.SV_TARGET = 'preview';</script>
${CONFIG}
<script id="engineSrc">${engine}</script>
<script>${geo}</script>
<script>${app}</script>
<script>${LOADER}</script>`;
write('dist/index.html', fill(fill(body, '<!--__HEAD__-->', previewHead), '<!--__SCRIPTS__-->', previewScripts));

const size = f => (fs.statSync(path.join(__dirname, f)).size / 1048576).toFixed(2) + ' MB';
console.log(`rutas del ${meta.feed} | site/index.html ${size('site/index.html')} | site/network.json ${size('site/network.json')} | dist/index.html ${size('dist/index.html')}`);
