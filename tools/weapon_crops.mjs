#!/usr/bin/env node
// Board evidence from a weapon_read_probe run (owner: hero-weapons, C2 r4): picks, per hero, UNFLASHED swing frames (attack
// frames before the first hitstop, widest projected blade), the CONTACT frame (first hitstop frame) and a follow-through
// frame, then writes native copies + a 2x nearest crop strip of the weapon region (the probe's grip/tip pixel positions
// define the box) via tools/crop2x.mjs.
//   node tools/weapon_crops.mjs <probe dir> <out prefix> [--pad 90] [--frames 12,18,24]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [dir, outPrefix, ...rest] = process.argv.slice(2);
if (!dir || !outPrefix) { console.error('usage: weapon_crops <probe dir> <out prefix> [--pad 90] [--frames a,b,c]'); process.exit(2); }
const opt = {}; for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) { opt[rest[i].slice(2)] = rest[i + 1]; i++; }
const pad = Number(opt.pad || 90);
const P = JSON.parse(fs.readFileSync(path.join(dir, 'probe.json'), 'utf8'));
const rows = P.rows;
let picks = [];
if (opt.frames) picks = opt.frames.split(',').map((f) => ({ frame: Number(f), tag: 'f' + f }));
else {
  // the heavy is pressed at probe frame 10 (weapon_read_probe.mjs): windup / swing are its unflashed frames before the
  // first hitstop, contact = its first hitstop frame, follow = the first unfrozen frame after it
  let att = rows.filter((r) => r.move === 'heavy' && r.frame >= 10);
  if (!att.length) att = rows.filter((r) => r.move && !/walk|run|idle|hitstun|dodge/.test(r.st || '') && !/hitstun/.test(r.move));   // the heavy press landed inside a chain: use whatever attack is there
  const firstHS = att.find((r) => r.hs);
  const pre = att.filter((r) => !r.hs && (!firstHS || r.frame < firstHS.frame));
  const windup = pre.length ? pre[Math.min(pre.length - 1, 2)] : null;
  const swing = pre.length ? pre[pre.length - 1] : null;
  const follow = firstHS ? att.find((r) => r.frame > firstHS.frame && !r.hs) : null;
  for (const [tag, r] of [['windup', windup], ['swing', swing], ['contact', firstHS], ['follow', follow]]) if (r) picks.push({ frame: r.frame, tag, row: r });
}
const specs = [];
for (const p of picks) {
  const r = p.row || rows.find((x) => x.frame === p.frame);
  const src = path.join(dir, `frame_${String(p.frame).padStart(4, '0')}.png`);
  if (!fs.existsSync(src)) continue;
  fs.copyFileSync(src, `${outPrefix}-${p.tag}-native.png`);
  if (!r) continue;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const h of Object.values(r.hands)) for (const q of [h.gripPx, h.tipPx, h.bitPx]) if (q) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
  if (r.headPx) { x0 = Math.min(x0, r.headPx[0]); y0 = Math.min(y0, r.headPx[1]); x1 = Math.max(x1, r.headPx[0]); y1 = Math.max(y1, r.headPx[1] + (r.heroPx || 0)); }
  if (x0 > x1) continue;
  const X = Math.max(0, Math.floor(x0 - pad)), Y = Math.max(0, Math.floor(y0 - pad));
  const W = Math.min(1600 - X, Math.ceil(x1 - x0 + 2 * pad)), H = Math.min(900 - Y, Math.ceil(y1 - y0 + 2 * pad));
  const flat = Object.entries(r.hands).map(([k, h]) => `${k} flat ${h.flat} w ${h.wpx}px`).join(' ');
  specs.push(`${X},${Y},${W},${H}:${p.tag} f${p.frame} ${r.move || r.st}${r.hs ? ' HITSTOP' : ''} ${flat}`);
}
if (specs.length) {
  const srcs = picks.filter((p) => fs.existsSync(path.join(dir, `frame_${String(p.frame).padStart(4, '0')}.png`)));
  // one crop strip per pick (crop2x takes a single source image), then a combined strip via sharp
  const sharp = (await import('sharp')).default;
  const tiles = [];
  for (let i = 0; i < specs.length; i++) {
    const p = srcs[i];
    const tmp = `${outPrefix}-${p.tag}-2x.png`;
    const res = spawnSync(process.execPath, ['tools/crop2x.mjs', path.join(dir, `frame_${String(p.frame).padStart(4, '0')}.png`), tmp, specs[i]], { stdio: 'inherit' });
    if (res.status === 0) tiles.push(tmp);
  }
  if (tiles.length > 1) {
    const metas = await Promise.all(tiles.map((t) => sharp(t).metadata()));
    const H = Math.max(...metas.map((m) => m.height)), W = metas.reduce((a, m) => a + m.width + 8, 0);
    const comp = tiles.map((t, i) => ({ input: t, left: metas.slice(0, i).reduce((a, m) => a + m.width + 8, 0), top: 0 }));
    await sharp({ create: { width: W, height: H, channels: 4, background: '#101010' } }).composite(comp).png().toFile(`${outPrefix}-strip-2x.png`);
    console.log('wrote', `${outPrefix}-strip-2x.png`, 'from', tiles.length, 'crops');
  }
}
console.log(JSON.stringify(picks.map((p) => ({ frame: p.frame, tag: p.tag })), null, 0));
