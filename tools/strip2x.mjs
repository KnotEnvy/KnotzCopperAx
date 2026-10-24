#!/usr/bin/env node
// Multi-frame 2x nearest-neighbour strip for board evidence (owner: hero-weapons, C2 r5): the SAME crop box from many
// frames, tiled left->right (wrapping every --cols) at --scale. Labels = frame file names.
//   node tools/strip2x.mjs <out.png> "x,y,w,h" [--scale 2] [--cols 6] <frame.png> [<frame.png> ...]
import sharp from 'sharp';
const argv = process.argv.slice(2);
const out = argv.shift(); const [x, y, w, h] = argv.shift().split(',').map(Number);
const opt = { scale: 2, cols: 6 }; const files = [];
for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) { opt[argv[i].slice(2)] = Number(argv[i + 1]); i++; } else files.push(argv[i]); }
const S = opt.scale, cols = Math.max(1, opt.cols | 0), tw = w * S, th = h * S;
const rows = Math.ceil(files.length / cols);
const tiles = [];
for (let i = 0; i < files.length; i++) {
  const buf = await sharp(files[i]).extract({ left: x, top: y, width: w, height: h }).resize(tw, th, { kernel: 'nearest' }).png().toBuffer();
  tiles.push({ input: buf, left: (i % cols) * (tw + 4), top: Math.floor(i / cols) * (th + 4) });
}
await sharp({ create: { width: cols * (tw + 4) - 4, height: rows * (th + 4) - 4, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
  .composite(tiles).png().toFile(out);
console.log('wrote', out, `${files.length} tiles ${tw}x${th}`);
