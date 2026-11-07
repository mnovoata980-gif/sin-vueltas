// Draws the app icon (a yellow bus front on the app's blue) as SVG and PNG. Needs nothing but Node.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
const YELLOW = [27, 63, 203], INK = [255, 196, 0]; // background and bus
// Shapes on a 100-unit square: the outer shape of the bus, then its windows and headlights cut out.
const body = [28, 22, 44, 56], radius = 8, cuts = [[34, 30, 32, 18], [34, 63, 8, 6], [58, 63, 8, 6]], wheels = [[32, 78, 10, 7], [58, 78, 10, 7]];
const inRect = (x, y, r) => x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3];
function inRounded(x, y, r, c) {
  if (!inRect(x, y, r)) return false;
  const dx = Math.max(r[0] + c - x, x - (r[0] + r[2] - c), 0), dy = Math.max(r[1] + c - y, y - (r[1] + r[3] - c), 0);
  return dx * dx + dy * dy <= c * c;
}
function png(size) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let j = 0; j < size; j++) {
    const row = j * (size * 3 + 1);
    raw[row] = 0;
    for (let i = 0; i < size; i++) {
      const x = (i + .5) / size * 100, y = (j + .5) / size * 100;
      const onBus = (inRounded(x, y, body, radius) && !cuts.some(c => inRect(x, y, c))) || wheels.some(w => inRect(x, y, w));
      const c = onBus ? INK : YELLOW, p = row + 1 + i * 3;
      raw[p] = c[0]; raw[p + 1] = c[1]; raw[p + 2] = c[2];
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), sum = Buffer.alloc(4); len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, sum]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const s of [180, 192, 512]) fs.writeFileSync(path.join(out, `icon-${s}.png`), png(s));
fs.writeFileSync(path.join(out, 'icon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="18" fill="#1b3fcb"/><path fill-rule="evenodd" fill="#ffc400" d="M36 22h28a8 8 0 0 1 8 8v40a8 8 0 0 1-8 8H36a8 8 0 0 1-8-8V30a8 8 0 0 1 8-8zM34 30v18h32V30zM34 63v6h8v-6zM58 63v6h8v-6z"/><path fill="#ffc400" d="M32 78h10v7H32zM58 78h10v7H58z"/></svg>`);
console.log('iconos listos en assets/');
