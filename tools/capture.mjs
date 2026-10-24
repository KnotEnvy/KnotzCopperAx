#!/usr/bin/env node
// KnotzCopperAx capture tool — drives the REAL running game in a GPU browser (tools/lib/browser.mjs: Chromium on a hidden
// X display on Linux/WSL2, headless Edge on Windows)
// and produces screenshots, frame sequences, contact sheets and short MP4 clips.
//
// Usage examples (dev server must be running on http://127.0.0.1:5190 — `npm run dev`):
//   node tools/capture.mjs --url "/?mode=showcase&what=hero&id=brann" --out progress/shots/hero-brann/r1
//   node tools/capture.mjs --url "/?mode=stage&stage=1&p1=brann&bot=1" --out progress/shots/stage1/r1 --frames 90 --step 33 --every 1 --mp4 --sheet
//   node tools/capture.mjs --url "/?mode=showcase&what=hero&id=gorrim" --scenario tools/scenarios/combo.mjs --out ...
//
// Options:
//   --url <path|full url>   page to open (relative paths are resolved against --host)
//   --host <origin>         default http://127.0.0.1:5190
//   --out <dir>             output directory (created). Files: shot.png, frame_000.png..., sheet.png, clip.mp4, report.json
//   --size WxH              viewport, default 1600x900
//   --warm <ms>             game-time to advance before the first capture (default 500)
//   --frames <n>            capture n frames (default 1 = single shot.png)
//   --step <ms>             game-time advanced between frames (default 33 ≈ 30fps clip)
//   --every <k>             only keep every k-th frame as PNG for the sheet (clip still uses all) (default: auto)
//   --sheet                 compose a contact sheet (sheet.png) from kept frames (max 12 tiles)
//   --mp4                   encode all frames to clip.mp4 via ffmpeg (30fps)
//   --scenario <file.mjs>   custom script: export default async (api) => {}  (see below)
//   --eval <js>             JS evaluated in page after ready (before warm)
//   --realtime              do NOT use manual clock (for perf checks); frames taken with wall-clock waits
//   --timeout <ms>          ready timeout (default 90000)
//   --keep-frames           keep individual frame PNGs even when --mp4 (default: keep only sheet frames)
//
// Scenario api: { page, advance(ms), shot(name), frames(n, stepMs, prefix), evalGame(fn|string, arg), press(player, action, ms),
//                 hold(player, action, down), log(msg), outDir }
//   Game-side contract (implemented in src/core/testhooks.js): window.__KCA = {
//     ready: Promise, setManualClock(bool), advance(ms): Promise, input: { press(p, action, ms), hold(p, action, down) },
//     info(): object (fps, drawCalls, triangles, errors...) }
//
// Exit code 0 on success; non-zero if the page failed to become ready. Page errors are listed in report.json
// and printed to stdout — ALWAYS read them.

import { launchBrowser, gpuRenderer, isSoftwareRenderer } from './lib/browser.mjs';
import { KCA_HOST, memAvailableMB } from './lib/platform.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const opt = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) continue;
  const k = a.slice(2);
  const nxt = argv[i + 1];
  if (nxt === undefined || nxt.startsWith('--')) opt[k] = true;
  else { opt[k] = nxt; i++; }
}

const host = opt.host || KCA_HOST;
let url = opt.url || '/';
if (!/^https?:/.test(url)) url = host.replace(/\/$/, '') + (url.startsWith('/') ? url : '/' + url);
const realtime = !!opt.realtime;
if (!realtime) url += (url.includes('?') ? '&' : '?') + 'capture=1';
const outDir = path.resolve(opt.out || 'progress/tmp/capture');
fs.mkdirSync(outDir, { recursive: true });
const [W, H] = String(opt.size || '1600x900').split('x').map(Number);
const warm = Number(opt.warm ?? 500);
const nFrames = Number(opt.frames ?? 1);
const step = Number(opt.step ?? 33);
const timeout = Number(opt.timeout ?? 300000); // the shared machine is always busy; stage loads can exceed 3 min
const wantSheet = !!opt.sheet;
const wantMp4 = !!opt.mp4;
const every = Number(opt.every || (nFrames > 12 ? Math.ceil(nFrames / 12) : 1));

const report = { url, outDir, size: [W, H], consoleErrors: [], pageErrors: [], warnings: [], files: [], info: null, ok: false };
const t0 = Date.now();

// Machine-wide cap on concurrent capture browsers. KCA_CAPTURE_SLOTS overrides (default 6). Queued captures wait for a free slot.
const { acquire, claimPriority } = await import('./lib/locks.mjs');
// KCA_EXCLUSIVE=1 (perf-1650): claim priority first so other captures leave the free slots to this run (see lib/locks.mjs)
if (process.env.KCA_EXCLUSIVE === '1') await claimPriority('capture', { info: { what: 'exclusive ' + url.slice(0, 100), owner: 'perf-1650' } });
// Also wait while free memory is low (a capture browser needs ~1.5-2.5 GB; KCA_CAPTURE_MIN_FREE_MB overrides).
const CAPTURE_MIN_FREE_MB = Number(process.env.KCA_CAPTURE_MIN_FREE_MB || 3000);
let memWaitLogged = 0;
const releaseSlot = await acquire('capture', {
  slots: Number(process.env.KCA_CAPTURE_SLOTS || 6), info: { what: url.slice(0, 120) },
  extraBusy: async () => {
    const free = memAvailableMB();
    if (free >= CAPTURE_MIN_FREE_MB) return false;
    if (!memWaitLogged || Date.now() - memWaitLogged > 60000) {
      memWaitLogged = Date.now();
      console.error(`[capture] waiting for memory: ${Math.round(free)} MB free, need ${CAPTURE_MIN_FREE_MB} MB (KCA_CAPTURE_MIN_FREE_MB)`);
    }
    return true;
  },
});
const browser = await launchBrowser({
  tool: 'capture',
  args: ['--autoplay-policy=no-user-gesture-required',
    // KCA_UNCAP=1 (perf-1650): no vsync / no rAF cap → frame time = real GPU/CPU throughput (A/B cost tables; use &fpscap=0)
    ...(process.env.KCA_UNCAP === '1' ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])],
});
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
// Shared-server safety: by default, replace Vite's HMR client with an inert stub. Other agents' saves then can't
// hot-reload this page mid-capture, so everyone can share the one dev server on :5190 instead of private servers.
// CSS still works (updateStyle injects <style>). Pass --hmr to keep live reload.
if (!opt.hmr) {
  await context.route(/\/@vite\/client(\?.*)?$/, (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `const styles = new Map();
const hot = () => ({ data: {}, accept() {}, acceptExports() {}, dispose() {}, prune() {}, decline() {}, invalidate() {}, on() {}, off() {}, send() {} });
export const createHotContext = hot;
export function updateStyle(id, css) { let s = styles.get(id); if (!s) { s = document.createElement('style'); s.setAttribute('data-vite-dev-id', id); document.head.appendChild(s); styles.set(id, s); } s.textContent = css; }
export function removeStyle(id) { const s = styles.get(id); if (s) { s.remove(); styles.delete(id); } }
export function injectQuery(url) { return url; }
export class ErrorOverlay extends HTMLElement {}
export default {};`,
  }));
}
const page = await context.newPage();
// A CPU fallback renderer makes every frame and number wrong: fail loudly instead of producing plausible-looking output.
report.gpu = await gpuRenderer(page);
if (isSoftwareRenderer(report.gpu)) report.pageErrors.push('SOFTWARE RENDERER (no GPU): ' + report.gpu + ' — run node tools/doctor.mjs');
page.on('console', (m) => {
  const t = m.type();
  if (t === 'error') report.consoleErrors.push(m.text().slice(0, 800));
  else if (t === 'warning') { if (report.warnings.length < 30) report.warnings.push(m.text().slice(0, 300)); }
  else if (opt.verbose) console.log('[page]', m.text());
});
page.on('pageerror', (e) => report.pageErrors.push(String(e && e.stack || e).slice(0, 1500)));

async function finish(code) {
  try { report.info = await page.evaluate(() => (window.__KCA && window.__KCA.info) ? window.__KCA.info() : null); } catch {}
  report.seconds = (Date.now() - t0) / 1000;
  report.ok = code === 0;
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, outDir, gpu: report.gpu, files: report.files, pageErrors: report.pageErrors, consoleErrors: report.consoleErrors.slice(0, 15), info: report.info, seconds: report.seconds }, null, 2));
  // browser.close() can hang forever after outputs are written (seen in Wave C1: a capture held a slot for ~2 h).
  // Cap it, free the capture slot first, then kill only this process's own child browser if it is still alive.
  const closed = await Promise.race([browser.close().then(() => true, () => true), new Promise((r) => setTimeout(() => r(false), 15000))]);
  releaseSlot();
  if (!closed) {
    console.error('[capture] browser.close() timed out after 15 s; killing own child browser');
    try { (await import('node:child_process')).execSync(`pkill -KILL -P ${process.pid}`); } catch {}
  }
  process.exit(code);
}

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  await page.waitForFunction(() => window.__KCA && window.__KCA.ready, null, { timeout });
  await page.evaluate(() => window.__KCA.ready);
  // Vite error overlay means a compile error somewhere — report it loudly.
  const overlay = await page.evaluate(() => {
    const o = document.querySelector('vite-error-overlay');
    return o && o.shadowRoot ? o.shadowRoot.textContent.slice(0, 1500) : null;
  });
  if (overlay) report.pageErrors.push('VITE OVERLAY: ' + overlay);
} catch (e) {
  report.pageErrors.push('READY FAILED: ' + e.message.split('\n')[0]);
  try { await page.screenshot({ path: path.join(outDir, 'failed.png') }); report.files.push(path.join(outDir, 'failed.png')); } catch {}
  await finish(2);
}

if (!realtime) await page.evaluate(() => window.__KCA.setManualClock && window.__KCA.setManualClock(true));
if (opt.eval) await page.evaluate(opt.eval);

const advance = async (ms) => {
  if (realtime) { await page.waitForTimeout(ms); return; }
  await page.evaluate((m) => window.__KCA.advance(m), ms);
};
const rel = (p) => path.relative(process.cwd(), p).replace(/\\/g, '/');
const shot = async (name) => {
  const p = path.join(outDir, name.endsWith('.png') ? name : name + '.png');
  await page.screenshot({ path: p });
  report.files.push(rel(p));
  return p;
};
const frameFiles = [];
const frames = async (n, stepMs = step, prefix = 'frame') => {
  const list = [];
  for (let i = 0; i < n; i++) {
    await advance(stepMs);
    const p = path.join(outDir, `${prefix}_${String(frameFiles.length).padStart(4, '0')}.png`);
    await page.screenshot({ path: p });
    frameFiles.push(p); list.push(p);
  }
  return list;
};
const api = {
  page, outDir, advance, shot, frames,
  evalGame: (fn, arg) => page.evaluate(fn, arg),
  press: (p, action, ms = 80) => page.evaluate(([p, a, m]) => window.__KCA.input.press(p, a, m), [p, action, ms]),
  hold: (p, action, down = true) => page.evaluate(([p, a, d]) => window.__KCA.input.hold(p, a, d), [p, action, down]),
  log: (m) => console.log('[scenario]', m),
};

try {
  if (warm > 0) await advance(warm);
  if (opt.scenario) {
    const mod = await import(pathToFileURL(path.resolve(opt.scenario)).href);
    await mod.default(api);
  } else if (nFrames <= 1) {
    await shot('shot');
  } else {
    await frames(nFrames, step);
  }
} catch (e) {
  report.pageErrors.push('CAPTURE FAILED: ' + (e.stack || e.message).slice(0, 1200));
  try { await shot('failed'); } catch {}
  await finish(3);
}

// Post-process frames: sheet + mp4
if (frameFiles.length) {
  const kept = frameFiles.filter((_, i) => i % every === 0).slice(0, 12);
  if (wantSheet) {
    const sharp = (await import('sharp')).default;
    const tileW = 640, tileH = Math.round(640 * H / W);
    const cols = kept.length <= 4 ? kept.length : (kept.length <= 6 ? 3 : 4);
    const rows = Math.ceil(kept.length / cols);
    const comps = await Promise.all(kept.map(async (f, i) => ({
      input: await sharp(f).resize(tileW, tileH).png().toBuffer(),
      left: (i % cols) * (tileW + 6), top: Math.floor(i / cols) * (tileH + 6),
    })));
    const sheetPath = path.join(outDir, 'sheet.png');
    await sharp({ create: { width: cols * (tileW + 6) - 6, height: rows * (tileH + 6) - 6, channels: 3, background: '#111' } })
      .composite(comps).png().toFile(sheetPath);
    report.files.push(rel(sheetPath));
  }
  if (wantMp4) {
    const listFile = path.join(outDir, 'frames.txt');
    fs.writeFileSync(listFile, frameFiles.map((f) => `file '${f.replace(/\\/g, '/')}'\nduration ${(step / 1000).toFixed(4)}`).join('\n'));
    const mp4 = path.join(outDir, 'clip.mp4');
    // One output frame per captured frame, evenly spaced at the capture step (real speed). The old `fps=30` resample
    // read the concat timestamps on a 25 fps grid, so it duplicated every 6th frame and dropped others: fake stutter.
    const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile,
      '-vf', `setpts=N*${(step / 1000).toFixed(6)}/TB,scale=${Math.min(W, 1280)}:-2`, '-fps_mode', 'cfr', '-r', `1000/${step}`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-movflags', '+faststart', mp4], { encoding: 'utf8' });
    if (r.status === 0) report.files.push(rel(mp4)); else report.warnings.push('ffmpeg failed: ' + (r.stderr || '').slice(0, 400));
    fs.rmSync(listFile, { force: true });
  }
  // Disk hygiene: the sheet already shows every kept frame, so beyond it keep at most 4 evenly spaced full-res
  // frames (for close inspection / crops). --keep-frames keeps everything.
  let fullRes = kept;
  if (!opt['keep-frames']) {
    fullRes = wantSheet ? kept.filter((_, i) => i % Math.max(1, Math.ceil(kept.length / 4)) === 0).slice(0, 4) : kept;
    const keep = new Set(fullRes);
    for (const f of frameFiles) if (!keep.has(f)) fs.rmSync(f, { force: true });
  }
  for (const f of fullRes) report.files.push(rel(f));
}

await finish(0);
