#!/usr/bin/env node
// VALUE RANGE of a weapon head across a weapon_read_probe run (owner: hero-weapons, C2 r6; board r5 acceptance: "in a 2x
// crop the bit shows three distinct values — dark brown-orange, mid copper, a small bright highlight — in most frames").
// For each probe frame: a box round the weapon (grip/tip/bit px from probe.json, --pad px), pixels filtered to the weapon's
// hue band (--hue a,b degrees, --sat floor) so ground / skin / flash are excluded, then luminance percentiles p10 / p50 / p90,
// the dark (< --dark) and bright (> --bright) pixel fractions, and a 3-value verdict: p10 < dark AND p90 > bright.
//   node tools/value_range.mjs <probe dir> [--hand R] [--hue 5,45] [--sat 0.3] [--pad 40] [--dark 0.22] [--bright 0.62] [--frames 0,5,10] [--lmin 0]
// --pale 0.78 --palesat 0.25: independent low-saturation highlight pass; does not discard white metal.
// --across metres: exclude masked pixels outside this local half-width (Grudgebrand .13 excludes raised guard horns).
// --mask 0: retain the original bounding-box sampling for comparison with prior rounds.
// --out filename.json: retain separate hand reports. weapon_read_metal.mjs supplies optional depth-tested blade masks.
// With masks, pale.bladeU follows the centroid along the blade; without them, pale counts are only candidates.
// blade.flatOrientation is geometric facing (1 = face-on), NOT a material-flatness score.
// --lmin: ignore pixels darker than this luminance (r6 resume: the L-hand box of a dark-clothed hero is full of near-black
// shadow texels in the hue band; 0 = off).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const [dir, ...rest] = process.argv.slice(2);
const opt = { hand: 'R', hue: '5,45', sat: 0.3, pad: 40, dark: 0.22, bright: 0.62, frames: '', lmin: 0, pale: 0.78, palesat: 0.25 };
for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) { opt[rest[i].slice(2)] = rest[i + 1]; i++; }
const [h0, h1] = opt.hue.split(',').map(Number); const sat0 = +opt.sat, pad = +opt.pad, dark = +opt.dark, bright = +opt.bright, lmin = +opt.lmin;
const P = JSON.parse(fs.readFileSync(path.join(dir, 'probe.json'), 'utf8'));
const want = opt.frames ? new Set(opt.frames.split(',').map(Number)) : null;
const rows = [];
for (const r of P.rows) {
  if (want && !want.has(r.frame)) continue;
  const hd = r.hands && r.hands[opt.hand]; if (!hd) continue;
  const pts = [hd.gripPx, hd.tipPx, hd.bitPx].filter(Boolean);
  if (hd.bitPx) { pts.push(hd.bitPx); }
  let x0 = Math.min(...pts.map((p) => p[0])) - pad, y0 = Math.min(...pts.map((p) => p[1])) - pad;
  let x1 = Math.max(...pts.map((p) => p[0])) + pad, y1 = Math.max(...pts.map((p) => p[1])) + pad;
  const file = path.join(dir, `frame_${String(r.frame).padStart(4, '0')}.png`);
  if (!fs.existsSync(file)) continue;
  const meta = await sharp(file).metadata();
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(meta.width, Math.ceil(x1)); y1 = Math.min(meta.height, Math.ceil(y1));
  const w = x1 - x0, h = y1 - y0; if (w < 4 || h < 4) continue;
  const { data } = await sharp(file).extract({ left: x0, top: y0, width: w, height: h }).raw().toBuffer({ resolveWithObject: true });
  const ch = data.length / (w * h); const L = [], palePixels = [], all = [];
  const maskFile = path.join(dir, `mask_${opt.hand}_${String(r.frame).padStart(4, '0')}.png`);
  const mask = opt.mask !== '0' && fs.existsSync(maskFile) ? await sharp(maskFile).extract({left:x0,top:y0,width:w,height:h}).ensureAlpha().raw().toBuffer() : null;
  let covered = 0;
  for (let i = 0; i < w * h; i++) {
    const R = data[i * ch] / 255, G = data[i * ch + 1] / 255, B = data[i * ch + 2] / 255;
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn, s = mx > 0 ? d / mx : 0;
    if (mask && (mask[i*4+2] < 250 || mask[i*4+3] < 250)) continue;
    if (mask && opt.across && Math.abs((mask[i*4+1]/255-.5)*.8) > +opt.across) continue;
    covered++;
    const luminance = .2126*R+.7152*G+.0722*B;
    all.push(luminance);
    if (luminance >= +opt.pale && s <= +opt.palesat) palePixels.push({x:x0+i%w,y:y0+Math.floor(i/w),u:mask?mask[i*4]/255:null});
    if (s < sat0 || d <= 0) continue;
    let hue; if (mx === R) hue = ((G - B) / d) % 6; else if (mx === G) hue = (B - R) / d + 2; else hue = (R - G) / d + 4; hue = (hue * 60 + 360) % 360;
    const inBand = h0 <= h1 ? (hue >= h0 && hue <= h1) : (hue >= h0 || hue <= h1);
    if (!inBand) continue;
    const lum = 0.2126 * R + 0.7152 * G + 0.0722 * B; if (lum < lmin) continue;
    L.push(lum);
  }
  L.sort((a, b) => a - b);
  const q = (p) => L.length ? L[Math.min(L.length - 1, Math.floor(p * L.length))] : 0;
  const nd = L.filter((v) => v < dark).length, nb = L.filter((v) => v > bright).length;
  const row = { frame: r.frame, move: r.move, hs: r.hs, n: L.length, p10: +q(0.1).toFixed(3), p50: +q(0.5).toFixed(3), p90: +q(0.9).toFixed(3), dark: +(nd / Math.max(1, L.length)).toFixed(3), bright: +(nb / Math.max(1, L.length)).toFixed(3) };
  const centroid = k => palePixels.length ? +(palePixels.reduce((n,p)=>n+p[k],0)/palePixels.length).toFixed(3) : null;
  row.pale = {n:palePixels.length, fraction:+(palePixels.length/Math.max(1,covered)).toFixed(4), x:centroid('x'),y:centroid('y'), bladeU:mask?centroid('u'):null, masked:!!mask};
  all.sort((a,b)=>a-b); const aq=p=>all[Math.min(all.length-1,Math.floor(p*all.length))]??0;
  row.blade = {n:all.length,p10:+aq(.1).toFixed(3),p90:+aq(.9).toFixed(3),bright:+(all.filter(l=>l>bright).length/Math.max(1,all.length)).toFixed(3), flatOrientation:hd.flat,three:all.length>40&&aq(.1)<dark&&aq(.9)>bright};
  row.three = L.length > 40 && row.p10 < dark && row.p90 > bright;
  rows.push(row);
}
const ok = rows.filter((r) => r.three).length, tot = rows.filter((r) => r.n > 40).length;
const mean = (k) => +(rows.reduce((a, r) => a + r[k], 0) / Math.max(1, rows.length)).toFixed(3);
const summary = { dir, hand: opt.hand, hue: opt.hue, sat: sat0, lmin, frames: rows.length, threeValue: `${ok}/${tot}`, p10: mean('p10'), p50: mean('p50'), p90: mean('p90'), range: +(mean('p90') - mean('p10')).toFixed(3), darkFrac: mean('dark'), brightFrac: mean('bright') };
summary.paleHighlight = {threshold:+opt.pale,saturationMax:+opt.palesat,frames:rows.filter(r=>r.pale.n>=3&&!r.hs).length,unflashed:rows.filter(r=>!r.hs).length,masked:rows.every(r=>r.pale.masked), note:'Without blade masks this is a bounding-box candidate count, not proof of a weapon highlight.'};
const bladeSummary = rs => {
  const valid = rs.filter(r => r.blade.n > 40);
  const mean = k => +(valid.reduce((s,r)=>s+r.blade[k],0)/Math.max(1,valid.length)).toFixed(3);
  return {frames:valid.length,threeValue:`${valid.filter(r=>r.blade.three).length}/${valid.length}`,p10:mean('p10'),p90:mean('p90'),brightFrac:mean('bright')};
};
summary.blade = bladeSummary(rows);
summary.blade.unflashed = bladeSummary(rows.filter(r=>!r.hs));

for (const r of rows) console.log(`f${String(r.frame).padStart(2, '0')} ${String(r.move || '-').padEnd(8)} ${r.hs ? 'HS' : '  '} n${String(r.n).padStart(5)} p10 ${r.p10.toFixed(2)} p50 ${r.p50.toFixed(2)} p90 ${r.p90.toFixed(2)} dark ${r.dark.toFixed(2)} bright ${r.bright.toFixed(2)} ${r.three ? '3-VALUE' : '-'}`);
console.log(JSON.stringify(summary));
fs.writeFileSync(path.join(dir, opt.out || 'value_range.json'), JSON.stringify({ summary, rows }, null, 1));
