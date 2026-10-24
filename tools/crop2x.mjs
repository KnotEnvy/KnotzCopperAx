#!/usr/bin/env node
// 2x nearest-neighbour crops for board evidence (owner: hero-weapons, generic). Each spec = "x,y,w,h[:label]"; the crops
// are tiled left→right into one PNG at 2x (what a critic sees when they zoom a native frame).
//   node tools/crop2x.mjs <in.png> <out.png> "x,y,w,h:label" ["x,y,w,h:label" ...]
import sharp from 'sharp';
const [inp, out, ...specs] = process.argv.slice(2);
if (!inp || !out || !specs.length) { console.error('usage: crop2x <in.png> <out.png> "x,y,w,h[:label]" ...'); process.exit(2); }
const tiles = [];
for (const s of specs) {
  const [geo, label = ''] = s.split(':');
  const [x, y, w, h] = geo.split(',').map(Number);
  let t = sharp(inp).extract({ left: x, top: y, width: w, height: h }).resize(w * 2, h * 2, { kernel: 'nearest' });
  if (label) t = t.composite([{ input: Buffer.from(`<svg width="${w * 2}" height="22"><rect width="100%" height="100%" fill="#000" opacity="0.6"/><text x="6" y="16" font-family="monospace" font-size="15" fill="#ffd27a">${label}</text></svg>`), top: 0, left: 0 }]);
  tiles.push({ buf: await t.png().toBuffer(), w: w * 2, h: h * 2 });
}
const W = tiles.reduce((a, t) => a + t.w + 8, -8), H = Math.max(...tiles.map((t) => t.h));
let left = 0;
await sharp({ create: { width: W, height: H, channels: 3, background: '#141414' } })
  .composite(tiles.map((t) => { const c = { input: t.buf, left, top: 0 }; left += t.w + 8; return c; })).png().toFile(out);
console.log(out, `${W}x${H}`);
