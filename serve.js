// Local preview. / serves the web app; /preview serves the one-file page wrapped like its host does.
// For testing only: /__net?delay=5000 slows every answer, /__net?down=1 drops connections, /__net resets both.
// /?noworker=1 serves the app with Web Workers disabled, to test the fallback.
const http = require('http'), fs = require('fs'), path = require('path');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const HEAD = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>';
const net = { delay: 0, down: false };
http.createServer((req, res) => {
  const [url, query = ''] = req.url.split('?');
  const params = new URLSearchParams(query);
  if (url === '/__net') {
    net.delay = +params.get('delay') || 0; net.down = params.get('down') === '1';
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(net));
    return;
  }
  if (net.down) { req.socket.destroy(); return; }
  setTimeout(() => {
    try {
      if (url === '/preview') {
        res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' });
        res.end(HEAD + fs.readFileSync(path.join(__dirname, 'dist', 'index.html'), 'utf8') + '</body></html>');
        return;
      }
      const file = path.normalize(path.join(__dirname, 'site', url === '/' ? 'index.html' : url));
      if (!file.startsWith(path.join(__dirname, 'site'))) throw new Error('outside site');
      let body = fs.readFileSync(file);
      if (url === '/' && params.get('noworker') === '1') body = body.toString('utf8').replace('<body>', '<body><script>window.Worker = undefined;</script>');
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch (e) {
      res.writeHead(404); res.end('No encontrado');
    }
  }, net.delay);
}).listen(5175, () => console.log('Sin Vueltas on http://localhost:5175'));
