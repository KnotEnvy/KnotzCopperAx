#!/usr/bin/env node
// Mean colour / hue of a region of a PNG (owner: hero-weapons; board verification "axe head mean hue is copper-orange").
//   node tools/hue_region.mjs <png> x,y,w,h [--sat 0.25]   → prints mean RGB, mean hue (deg), and the hue histogram of the
// pixels above the saturation floor (so a mostly-grey background does not swamp the metal), with the dominant hue name.
import sharp from 'sharp';
const [file, geo, ...rest] = process.argv.slice(2);
const sat0 = rest.includes("--sat") ? Number(rest[rest.indexOf("--sat") + 1]) : 0.25;
const min0 = rest.includes("--min") ? Number(rest[rest.indexOf("--min") + 1]) : 0.12;   // brightness floor (max channel)
const [x, y, w, h] = geo.split(',').map(Number);
const { data } = await sharp(file).extract({ left: x, top: y, width: w, height: h }).raw().toBuffer({ resolveWithObject: true });
const ch = data.length / (w * h);
let sr = 0, sg = 0, sb = 0, n = 0; const hist = new Array(12).fill(0); let sx = 0, sy = 0, m = 0;
for (let i = 0; i < w * h; i++) {
  const r = data[i * ch] / 255, g = data[i * ch + 1] / 255, b = data[i * ch + 2] / 255;
  sr += r; sg += g; sb += b; n++;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; const s = mx > 0 ? d / mx : 0;
  if (s < sat0 || mx < min0) continue;
  let hue = 0; if (d > 0) { if (mx === r) hue = ((g - b) / d) % 6; else if (mx === g) hue = (b - r) / d + 2; else hue = (r - g) / d + 4; hue = (hue * 60 + 360) % 360; }
  hist[Math.floor(hue / 30)]++; sx += Math.cos(hue * Math.PI / 180); sy += Math.sin(hue * Math.PI / 180); m++;
}
const names = ['red', 'orange', 'yellow', 'yellow-green', 'green', 'spring', 'cyan', 'azure', 'blue', 'violet', 'magenta', 'rose'];
const meanHue = ((Math.atan2(sy, sx) * 180 / Math.PI) + 360) % 360;
const top = hist.map((c, i) => [c, i]).sort((a, b) => b[0] - a[0]).slice(0, 3).map(([c, i]) => `${names[i]} ${(100 * c / Math.max(1, m)).toFixed(0)}%`);
console.log(JSON.stringify({ file, region: [x, y, w, h], meanRGB: [sr, sg, sb].map((v) => Math.round(255 * v / n)), saturatedFrac: +(m / n).toFixed(3), meanHueDeg: +meanHue.toFixed(1), meanHueName: names[Math.floor(meanHue / 30)], top3: top }));
