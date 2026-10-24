#!/usr/bin/env node
// Encode a baked UI art PNG (blender/build_ui_map.py, blender/ui_desk_paint.py) to WebP for the shipped build.
//   node tools/ui-art-encode.mjs <in.png> <out.webp> [quality=86] [--w N]
import sharp from 'sharp';
import fs from 'node:fs';
const a = process.argv.slice(2).filter((x) => !x.startsWith('--'));
const wi = process.argv.indexOf('--w');
const [inp, out, q] = a;
if (!inp || !out) { console.error('usage: node tools/ui-art-encode.mjs <in.png> <out.webp> [quality] [--w N]'); process.exit(2); }
let img = sharp(inp);
if (wi > 0) img = img.resize({ width: Number(process.argv[wi + 1]) });
const info = await img.webp({ quality: Number(q) || 86, effort: 5 }).toFile(out);
console.log(`${out}: ${info.width}x${info.height} ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
