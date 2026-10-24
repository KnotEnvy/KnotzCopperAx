#!/usr/bin/env node
// Audio render + inspection tool: renders the game's SFX reels and music excerpts through the REAL mixer in an
// OfflineAudioContext inside headless Edge (the audio showcase's render API), then writes WAVs, loudness/peak analysis
// (sample peak, BS.1770 K-weighted integrated LUFS, short-term max, crest) and waveform + spectrogram contact sheets.
//
//   node tools/audio-render.mjs [--host http://127.0.0.1:5190] [--out progress/audio/r1] [--only sfx|music] [--jobs sfx_hits,music_title] [--timeout 180000]
//   The hits reel additionally yields zoom_hits_sub.png (heavy-hit excerpts, 20 Hz..2 kHz spectrogram) + analysis.subBand
//   (40-90 Hz band level per 50 ms after each heavy hit: the sustained sub-thump check).
//
// Output: <out>/<name>.wav, <out>/analysis.json, <out>/sheet_sfx.png, <out>/sheet_music.png, <out>/sfx_stats.json
import { launchBrowser } from './lib/browser.mjs';
import { KCA_HOST } from './lib/platform.mjs';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2), opt = {};
for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (!a.startsWith('--')) continue; const n = argv[i + 1]; if (n === undefined || n.startsWith('--')) opt[a.slice(2)] = true; else { opt[a.slice(2)] = n; i++; } }
const host = (opt.host || KCA_HOST).replace(/\/$/, '');
const outDir = path.resolve(opt.out || 'progress/audio/latest');
const timeout = Number(opt.timeout || 180000);
fs.mkdirSync(outDir, { recursive: true });

const SFX_JOBS = ['weapons', 'hits', 'movement', 'magic', 'ui', 'voices'].map((c) => ({ name: `sfx_${c}`, kind: 'reel', sel: c }));
const MUSIC_JOBS = [
  { name: 'music_stage1_adaptive', id: 'stage1', sec: 32, o: { levels: [[0, 0], [3, 1], [6, 2], [10, 3]] } },
  { name: 'music_stage1_boss_brawl', id: 'stage1', sec: 24, o: { levels: [[0, 2]], bossAt: 4, sfx: true } },
  { name: 'music_stage2_adaptive', id: 'stage2', sec: 32, o: { levels: [[0, 0], [4, 1], [8, 2], [11, 3]] } },
  { name: 'music_stage2_boss', id: 'stage2', sec: 24, o: { levels: [[0, 2]], bossAt: 3 } },
  { name: 'music_title', id: 'title', sec: 30, o: {} },
  { name: 'music_camp', id: 'camp', sec: 30, o: {} },
  { name: 'music_gameover', id: 'gameover', sec: 12, o: {} },
  { name: 'music_clear', id: 'clear', sec: 12, o: {} },
];

// ------------------------------------------------------------------ analysis
function biquad(x, b, a) {
  const y = new Float64Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
  return y;
}
function kweight(x) { // BS.1770 coefficients at 48 kHz
  return biquad(biquad(x, [1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]), [1, -2, 1], [1, -1.99004745483398, 0.99007225036621]);
}
function analyse(L, R, sr) {
  let peak = 0, sum = 0;
  for (let i = 0; i < L.length; i++) { peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); sum += (L[i] * L[i] + R[i] * R[i]) / 2; }
  const kl = kweight(L), kr = kweight(R);
  const blk = Math.floor(sr * 0.4), hop = Math.floor(blk / 4), pw = [];
  for (let s = 0; s + blk <= L.length; s += hop) { let e = 0; for (let i = s; i < s + blk; i++) e += kl[i] * kl[i] + kr[i] * kr[i]; pw.push(e / blk); }
  const lufs = (p) => -0.691 + 10 * Math.log10(p || 1e-12);
  const g1 = pw.filter((p) => lufs(p) > -70);
  const m1 = g1.reduce((a, b) => a + b, 0) / (g1.length || 1);
  const g2 = g1.filter((p) => lufs(p) > lufs(m1) - 10);
  const integrated = lufs(g2.reduce((a, b) => a + b, 0) / (g2.length || 1));
  // short-term (3 s) max
  const st = Math.floor(sr * 3); let stMax = -120;
  for (let s = 0; s + st <= L.length; s += Math.floor(sr * 0.5)) { let e = 0; for (let i = s; i < s + st; i += 2) e += kl[i] * kl[i] + kr[i] * kr[i]; stMax = Math.max(stMax, lufs(e / (st / 2))); }
  const peakDb = 20 * Math.log10(peak || 1e-9), rmsDb = 10 * Math.log10(sum / L.length || 1e-12);
  let clipped = 0; for (let i = 0; i < L.length; i++) if (Math.abs(L[i]) > 0.891 || Math.abs(R[i]) > 0.891) clipped++;
  return { peakDb: +peakDb.toFixed(2), lufsI: +integrated.toFixed(1), lufsSTmax: +stMax.toFixed(1), rmsDb: +rmsDb.toFixed(1), crestDb: +(peakDb - rmsDb).toFixed(1), overMinus1dB: clipped, seconds: +(L.length / sr).toFixed(2) };
}

function decode(b64) { const buf = Buffer.from(b64, 'base64'); const i16 = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2); const f = new Float32Array(i16.length); for (let i = 0; i < i16.length; i++) f[i] = i16[i] / 32768; return { f, i16 }; }
function writeWav(file, l16, r16, sr) {
  const n = l16.length, data = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) { data.writeInt16LE(l16[i], i * 4); data.writeInt16LE(r16[i], i * 4 + 2); }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

// ------------------------------------------------------------------ drawing
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let j = 0; j < len / 2; j++) { const a = i + j, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr; re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
}
const MAGMA = [[0, 0, 4], [28, 16, 68], [79, 18, 123], [129, 37, 129], [181, 54, 122], [229, 80, 100], [251, 135, 97], [254, 194, 135], [252, 253, 191]];
function cmap(t) { t = Math.max(0, Math.min(1, t)) * (MAGMA.length - 1); const i = Math.floor(t), f = t - i, a = MAGMA[i], b = MAGMA[Math.min(MAGMA.length - 1, i + 1)]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; }

const W = 1600, HEAD = 22, WAVE = 64, SPEC = 180, GAP = 10, ROW = HEAD + WAVE + SPEC + GAP;
function drawRow(px, y0, L, R, sr) {
  const n = L.length, cols = W;
  // waveform (peak envelope), −1 dBFS line
  const mid = y0 + HEAD + WAVE / 2;
  for (let x = 0; x < cols; x++) {
    const a = Math.floor((x / cols) * n), b = Math.max(a + 1, Math.floor(((x + 1) / cols) * n));
    let mx = 0; for (let i = a; i < b; i++) mx = Math.max(mx, Math.abs(L[i]), Math.abs(R[i]));
    const h = Math.round(mx * (WAVE / 2 - 1)), hot = mx > 0.891;
    for (let y = -h; y <= h; y++) set(px, x, mid + y, hot ? [255, 60, 50] : [240, 176, 96]);
    set(px, x, mid - Math.round(0.891 * (WAVE / 2 - 1)), [120, 40, 40]); set(px, x, mid + Math.round(0.891 * (WAVE / 2 - 1)), [120, 40, 40]);
  }
  // spectrogram: log-f 30 Hz..20 kHz, −100..−10 dB
  const N = 2048, win = new Float64Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  const [f0, f1] = SPEC_F, sy = y0 + HEAD + WAVE;
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let x = 0; x < cols; x++) {
    const c = Math.floor(((x + 0.5) / cols) * n) - N / 2;
    for (let i = 0; i < N; i++) { const j = c + i; re[i] = j >= 0 && j < n ? ((L[j] + R[j]) / 2) * win[i] : 0; im[i] = 0; }
    fft(re, im);
    for (let y = 0; y < SPEC; y++) {
      const fr = f0 * Math.pow(f1 / f0, 1 - y / (SPEC - 1)), fn = f0 * Math.pow(f1 / f0, 1 - (y + 1) / (SPEC - 1));
      const k0 = Math.max(1, Math.floor((fn / sr) * N)), k1 = Math.max(k0, Math.ceil((fr / sr) * N));
      let m = 0; for (let k = k0; k <= k1 && k < N / 2; k++) m = Math.max(m, re[k] * re[k] + im[k] * im[k]);
      const db = 10 * Math.log10(m / ((N / 4) ** 2) + 1e-14);
      set(px, x, sy + y, cmap((db + 100) / 90));
    }
  }
}
let SH = 0, SPEC_F = [30, 20000];
function set(px, x, y, c) { if (x < 0 || x >= W || y < 0 || y >= SH) return; const i = (y * W + x) * 3; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; }
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

async function sheet(file, rows) {
  SH = rows.length * ROW;
  const px = Buffer.alloc(W * SH * 3, 14);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${SH}" font-family="Consolas,monospace">`;
  rows.forEach((r, i) => {
    const y0 = i * ROW;
    drawRow(px, y0, r.L, r.R, r.sr);
    const a = r.a;
    svg += `<text x="6" y="${y0 + 15}" font-size="14" fill="#ffd9a0">${esc(r.name)}   ${a.seconds}s   peak ${a.peakDb} dBFS   ${a.lufsI} LUFS-I   ST max ${a.lufsSTmax}   crest ${a.crestDb} dB   ${a.overMinus1dB ? `OVER −1dB: ${a.overMinus1dB}` : 'no overs'}</text>`;
    (r.markers || []).forEach((m, j) => {
      const x = Math.round((m.t / a.seconds) * W);
      svg += `<line x1="${x}" x2="${x}" y1="${y0 + HEAD}" y2="${y0 + HEAD + WAVE + SPEC}" stroke="#7fd0ff" stroke-opacity=".35"/>`;
      svg += `<text x="${x + 2}" y="${y0 + HEAD + 9 + (j % 3) * 10}" font-size="9" fill="#bfe6ff">${esc(m.name.replace(/^vo_/, ''))}</text>`;
    });
    for (const f of SPEC_F[1] <= 4000 ? [40, 60, 90, 150, 300, 1000] : [100, 1000, 10000]) { const yy = y0 + HEAD + WAVE + Math.round((1 - Math.log(f / SPEC_F[0]) / Math.log(SPEC_F[1] / SPEC_F[0])) * (SPEC - 1)); svg += `<text x="${W - 34}" y="${yy}" font-size="9" fill="#ddd">${f >= 1000 ? f / 1000 + 'k' : f}</text>`; if (SPEC_F[1] <= 4000) svg += `<line x1="0" x2="${W - 38}" y1="${yy}" y2="${yy}" stroke="#fff" stroke-opacity=".12"/>`; }
  });
  svg += '</svg>';
  await sharp(px, { raw: { width: W, height: SH, channels: 3 } }).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toFile(file);
}

// ------------------------------------------------------------------ heavy-hit sub-band check
const HEAVY = ['hit_heavy', 'hit_ko', 'hit_block', 'body_impact', 'hit_light'];
function rbj(type, f, q, sr) { // RBJ cookbook 2nd-order HP/LP
  const w = 2 * Math.PI * f / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al;
  const b = type === 'lp' ? [(1 - c) / 2, 1 - c, (1 - c) / 2] : [(1 + c) / 2, -(1 + c), (1 + c) / 2];
  return [b.map((v) => v / a0), [1, (-2 * c) / a0, (1 - al) / a0]];
}
function subBand(L, R, sr, markers) {
  const m = new Float64Array(L.length); for (let i = 0; i < m.length; i++) m[i] = (L[i] + R[i]) / 2;
  let x = m; for (const [t, f] of [['hp', 40], ['hp', 40], ['lp', 90], ['lp', 90]]) { const [b, a] = rbj(t, f, 0.707, sr); x = biquad(x, b, a); }
  const out = [];
  for (const mk of markers.filter((q) => HEAVY.includes(q.name))) {
    const s0 = Math.floor(mk.t * sr), w = Math.floor(sr * 0.05), win = [];
    for (let k = 0; k < 8; k++) { let e = 0; for (let i = s0 + k * w; i < s0 + (k + 1) * w && i < x.length; i++) e += x[i] * x[i]; win.push(+(10 * Math.log10(e / w + 1e-14) + 3.01).toFixed(1)); }
    out.push({ name: mk.name, t: +mk.t.toFixed(2), band40_90_dBFS_per50ms: win });
  }
  return out;
}
async function zoomSheet(file, row) {
  const sr = row.sr, pre = Math.floor(sr * 0.04), len = Math.floor(sr * 0.56), gap = Math.floor(sr * 0.06);
  const pick = row.markers.filter((q) => HEAVY.includes(q.name)).slice(0, 12);
  const n = pick.length * (len + gap), L = new Float32Array(n), R = new Float32Array(n), markers = [];
  pick.forEach((mk, j) => { const s0 = Math.max(0, Math.floor(mk.t * sr) - pre), d = j * (len + gap); for (let i = 0; i < len && s0 + i < row.L.length; i++) { L[d + i] = row.L[s0 + i]; R[d + i] = row.R[s0 + i]; } markers.push({ name: mk.name, t: (d + pre) / sr }); });
  const keep = SPEC_F; SPEC_F = [20, 2000];
  await sheet(file, [{ name: 'hits zoom 20Hz-2kHz (0.56 s per excerpt; gridlines 40/60/90/150/300/1k)', L, R, sr, a: analyse(L, R, sr), markers }]);
  SPEC_F = keep;
}

// ------------------------------------------------------------------ run
const browser = await launchBrowser({ tool: 'audio-render', gpu: false, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e).slice(0, 600)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 400)); });
const result = { host, when: new Date().toISOString(), renders: {}, errors };
try {
  await page.goto(`${host}/?mode=showcase&what=audio&capture=1`, { waitUntil: 'domcontentloaded', timeout });
  await page.waitForFunction(() => window.__KCA && window.__KCA.ready, null, { timeout });
  await page.evaluate(() => window.__KCA.ready);
  await page.waitForFunction(() => window.__KCA.showcase && window.__KCA.showcase.renderReel, null, { timeout: 60000 });
  const want = opt.jobs ? String(opt.jobs).split(',') : null;
  const jobs = [...(opt.only === 'music' ? [] : SFX_JOBS), ...(opt.only === 'sfx' ? [] : MUSIC_JOBS)].filter((j) => !want || want.includes(j.name));
  const rows = { sfx: [], music: [] };
  for (const j of jobs) {
    const t = Date.now();
    const r = j.kind === 'reel'
      ? await page.evaluate(([sel]) => window.__KCA.showcase.renderReel(sel), [j.sel])
      : await page.evaluate(([id, sec, o]) => window.__KCA.showcase.renderMusic(id, sec, o), [j.id, j.sec, j.o]);
    const L = decode(r.L), R = decode(r.R);
    writeWav(path.join(outDir, `${j.name}.wav`), L.i16, R.i16, r.sr);
    const a = analyse(L.f, R.f, r.sr);
    result.renders[j.name] = { ...a, markers: r.markers.length, renderMs: Date.now() - t };
    (j.kind === 'reel' ? rows.sfx : rows.music).push({ name: j.name, L: L.f, R: R.f, sr: r.sr, a, markers: r.markers });
    console.log(j.name, JSON.stringify(a));
    if (j.name === 'sfx_hits') {
      result.subBand = subBand(L.f, R.f, r.sr, r.markers);
      await zoomSheet(path.join(outDir, 'zoom_hits_sub.png'), { L: L.f, R: R.f, sr: r.sr, markers: r.markers });
      for (const b of result.subBand) console.log('  sub40-90', b.name.padEnd(12), b.band40_90_dBFS_per50ms.join(' '));
    }
  }
  if (rows.sfx.length) await sheet(path.join(outDir, 'sheet_sfx.png'), rows.sfx);
  if (rows.music.length) await sheet(path.join(outDir, 'sheet_music.png'), rows.music);
  if (opt.only !== 'music' && !want) {
    const st = await page.evaluate(() => window.__KCA.showcase.sfxStats());
    fs.writeFileSync(path.join(outDir, 'sfx_stats.json'), JSON.stringify(st, null, 1));
    const hot = st.filter((s) => s.peakDb > 0);
    result.sfx = { count: st.length, rawPeakMax: Math.max(...st.map((s) => s.peakDb)), rawOver0dB: hot.map((s) => `${s.name} ${s.peakDb}`), quietest: [...st].sort((a, b) => a.rmsDb - b.rmsDb).slice(0, 5).map((s) => `${s.name} ${s.rmsDb}`) };
  }
} catch (e) { errors.push('FAILED: ' + (e.message || e).split('\n')[0]); }
fs.writeFileSync(path.join(outDir, 'analysis.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ outDir, errors, sfx: result.sfx }, null, 2));
await browser.close();
process.exit(errors.some((e) => e.startsWith('FAILED')) ? 2 : 0);
