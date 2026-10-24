// Pixel diff of two same-size PNGs (A/B look checks for perf changes that must not change the image).
//   node tools/imgdiff.mjs a.png b.png [--out diff.png] [--thr 8]
// Prints JSON: mean |Δ| per channel (0–255), max |Δ|, share of pixels whose max channel |Δ| > thr, and the bounding box
// of those pixels. --out writes a heat image (|Δ| × 8, red where > thr).
import sharp from 'sharp';

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--') && !/^\d+$/.test(a));
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const thr = Number(opt('thr', 8));
const [A, B] = files;
if (!A || !B) { console.error('usage: node tools/imgdiff.mjs a.png b.png [--out diff.png] [--thr 8]'); process.exit(2); }
const load = async (f) => { const { data, info } = await sharp(f).removeAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, w: info.width, h: info.height }; };
const a = await load(A), b = await load(B);
if (a.w !== b.w || a.h !== b.h) { console.log(JSON.stringify({ error: 'size mismatch', a: [a.w, a.h], b: [b.w, b.h] })); process.exit(1); }
const n = a.w * a.h, heat = Buffer.alloc(n * 3);
let sum = 0, max = 0, over = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
for (let i = 0; i < n; i++) {
  let m = 0;
  for (let c = 0; c < 3; c++) { const d = Math.abs(a.data[i * 3 + c] - b.data[i * 3 + c]); sum += d; if (d > m) m = d; }
  if (m > max) max = m;
  if (m > thr) { over++; const x = i % a.w, y = (i / a.w) | 0; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  const v = Math.min(255, m * 8);
  heat[i * 3] = m > thr ? 255 : v; heat[i * 3 + 1] = m > thr ? 0 : v; heat[i * 3 + 2] = m > thr ? 0 : v;
}
const out = opt('out', null);
if (out) await sharp(heat, { raw: { width: a.w, height: a.h, channels: 3 } }).png().toFile(out);
console.log(JSON.stringify({ size: [a.w, a.h], meanAbs: +(sum / (n * 3)).toFixed(4), max, thr, overShare: +(over / n).toFixed(6), overPx: over, bbox: over ? [x0, y0, x1, y1] : null, out }));
