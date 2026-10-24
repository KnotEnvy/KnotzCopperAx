// PostFX flash calibration (perf-1650, Wave C1). Holds a constant post flash (pulse with a huge duration, re-rendered
// with frameDt 0 so the envelope stays at 1 and the sim does not move) and measures the frame's mean luma (Rec.709 on
// the sRGB PNG, 0..255) and the mean of the fighting-lane band, against flash 0. Also reports the darkest-decile mean
// (how much the blacks lift = "milky" haze). Same scenario works on any PostFX version (public pulse() API only).
//   node tools/capture.mjs --url "/?mode=stage&stage=1&p1=brann&bot=1&seed=3" --warm 9000 \
//     --scenario tools/scenarios/post_flash_luma.mjs --out progress/shots/perf-1650/c1-render/flash-before
// env: FLASHES=0.1,0.3,0.6  COLORS=#ffffff,#ffd890
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const FL = String(process.env.FLASHES || '0.1,0.3,0.6').split(',').map(Number);
const COLS = String(process.env.COLORS || '#ffffff,#ffd890').split(',');

async function stats(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, n = W * H, L = new Float32Array(n);
  let sum = 0, lane = 0, laneN = 0;
  for (let i = 0; i < n; i++) {
    const l = 0.2126 * data[i * 3] + 0.7152 * data[i * 3 + 1] + 0.0722 * data[i * 3 + 2];
    L[i] = l; sum += l;
    const y = Math.floor(i / W);
    if (y >= H * 0.45 && y < H * 0.92) { lane += l; laneN++; }
  }
  const s = Float32Array.from(L).sort();
  let d10 = 0; const k = Math.floor(n / 10); for (let i = 0; i < k; i++) d10 += s[i];
  let rms = 0; const m = sum / n; for (let i = 0; i < n; i += 7) rms += (L[i] - m) ** 2;
  return { mean: sum / n, lane: lane / laneN, dark10: d10 / k, std: Math.sqrt(rms / Math.ceil(n / 7)) };
}

export default async (api) => {
  const rows = [];
  const hold = async (flash, color) => {
    await api.evalGame(([f, c]) => { const p = window.__KCA.game.renderer.post; p.pulse({ flash: f, flashColor: c, ca: 0, desat: 0, duration: 1e6 }); }, [flash, color]);
    await api.advance(0);
  };
  await hold(0, '#ffffff');
  const base = await stats(await api.shot('flash_0'));
  rows.push({ flash: 0, color: '-', ...base });
  for (const c of COLS) {
    for (const f of FL) {
      await hold(f, c);
      const st = await stats(await api.shot(`flash_${c.slice(1)}_${f}`));
      rows.push({ flash: f, color: c, ...st, dMean: st.mean - base.mean, dLane: st.lane - base.lane, dDark10: st.dark10 - base.dark10, contrastRatio: st.std / base.std });
    }
  }
  await hold(0, '#ffffff');
  const rd = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(2) : v]));
  const out = rows.map(rd);
  fs.writeFileSync(path.join(api.outDir, 'flash_luma.json'), JSON.stringify(out, null, 1));
  for (const r of out) api.log(JSON.stringify(r));
};
