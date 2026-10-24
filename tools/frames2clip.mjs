#!/usr/bin/env node
// Encode a scenario capture's frame_NNNN.png run into clip.mp4 (30 fps, libx264) + a 12-tile sheet.png (owner: hero-weapons,
// C2 r5: --scenario captures write frames but not the clip/sheet that --mp4/--sheet make for plain runs).
//   node tools/frames2clip.mjs <capture dir>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
const dir = process.argv[2];
const frames = fs.readdirSync(dir).filter((f) => /^frame_\d+\.png$/.test(f)).sort();
if (!frames.length) { console.error('no frames in', dir); process.exit(2); }
const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', path.join(dir, 'frame_%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', path.join(dir, 'clip.mp4')], { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status || 1);
const n = Math.min(12, frames.length), pick = Array.from({ length: n }, (_, i) => frames[Math.round(i * (frames.length - 1) / (n - 1))]);
const tw = 400, th = 225, cols = 4, rows = Math.ceil(n / cols), tiles = [];
for (let i = 0; i < n; i++) tiles.push({ input: await sharp(path.join(dir, pick[i])).resize(tw, th).png().toBuffer(), left: (i % cols) * tw, top: Math.floor(i / cols) * th });
await sharp({ create: { width: cols * tw, height: rows * th, channels: 3, background: '#000' } }).composite(tiles).png().toFile(path.join(dir, 'sheet.png'));
console.log('wrote', path.join(dir, 'clip.mp4'), `+ sheet.png (${frames.length} frames, tiles: ${pick.join(' ')})`);
