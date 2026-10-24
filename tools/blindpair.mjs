#!/usr/bin/env node
// Blind side-by-side composer for critics. Randomly places OUR image and a REFERENCE image
// left/right (or in a grid with several refs), strips all labels except neutral letters, and
// writes the answer key to a separate file the critic must NOT open until after judging.
//
//   node tools/blindpair.mjs --ours progress/shots/stage1/r2/shot.png --ref refs/golden-axe/stage1_a.png --ref refs/modern/trine5_forest.jpg --out progress/compare/stage1-r2
//
// Output: <out>/blind.png  (tiles labelled A, B, C… in random order, all scaled to equal height)
//         <out>/key.json   (which letter is ours / which ref file each letter is) — open only AFTER writing your verdict.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const argv = process.argv.slice(2);
const refs = []; let ours = null; let out = 'progress/tmp/blind'; let tileH = 540;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--ours') ours = argv[++i];
  else if (argv[i] === '--ref') refs.push(argv[++i]);
  else if (argv[i] === '--out') out = argv[++i];
  else if (argv[i] === '--height') tileH = Number(argv[++i]);
}
if (!ours || !refs.length) { console.error('need --ours and at least one --ref'); process.exit(1); }
fs.mkdirSync(out, { recursive: true });
const items = [{ file: ours, kind: 'OURS' }, ...refs.map((r) => ({ file: r, kind: 'REFERENCE' }))];
for (let i = items.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [items[i], items[j]] = [items[j], items[i]]; }
const letters = 'ABCDEFGH';
const tiles = [];
for (let i = 0; i < items.length; i++) {
  const img = sharp(items[i].file);
  const meta = await img.metadata();
  const w = Math.round(meta.width * tileH / meta.height);
  // nearest-neighbour for tiny pixel-art refs so they are judged fairly (crisp, not blurred)
  const kernel = meta.height < 400 ? 'nearest' : 'lanczos3';
  const buf = await sharp(items[i].file).resize({ height: tileH, width: w, kernel, fit: 'fill' }).png().toBuffer();
  const label = Buffer.from(`<svg width="70" height="56"><rect width="70" height="56" rx="8" fill="#000" fill-opacity="0.75"/><text x="35" y="42" font-size="40" font-family="Arial" font-weight="bold" text-anchor="middle" fill="#fff">${letters[i]}</text></svg>`);
  tiles.push({ buf, w, label });
}
const gap = 12;
const totalW = tiles.reduce((s, t) => s + t.w, 0) + gap * (tiles.length - 1);
const comps = []; let x = 0;
for (const t of tiles) { comps.push({ input: t.buf, left: x, top: 0 }); comps.push({ input: t.label, left: x + 10, top: 10 }); x += t.w + gap; }
await sharp({ create: { width: totalW, height: tileH, channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(out, 'blind.png'));
const key = Object.fromEntries(items.map((it, i) => [letters[i], { kind: it.kind, file: it.file }]));
fs.writeFileSync(path.join(out, 'key.json'), JSON.stringify(key, null, 2));
console.log(JSON.stringify({ blind: path.join(out, 'blind.png').replace(/\\/g, '/'), key: path.join(out, 'key.json').replace(/\\/g, '/'), tiles: items.length }));
