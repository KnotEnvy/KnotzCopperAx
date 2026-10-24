#!/usr/bin/env node
// perfbench (perf-1650) — CONTENTION-ROBUST performance measurement. This machine is never quiet (other agents' Edge +
// Blender share the GTX 1650 Ti and the CPU), so wall-clock fps is not a measure. perfbench reports:
//   1. deterministic budget metrics per stage × phase (manual clock, seed 1): draw calls, triangles, programs,
//      passes + render-target pixels ("1080p-equivalents"), VRAM estimate, shadow casters, skinned meshes/bones,
//      MEASURED overdraw (counting clones of every material → fragments/pixel, opaque vs transparent), JS allocations
//      per frame (V8 sampling heap profiler incl. GC'd objects), new programs compiled during play, JS slices > 50 ms;
//   2. GPU frame time by TIMER QUERY over bursts of identical frames (a GPU "blocker" kernel first, so every command is
//      queued before the timed window → pure GPU time, no CPU starvation), interleaved with a fixed CALIBRATION kernel:
//      ratio = frame_p10 / cal_p10 (interference only ADDS time → low percentiles; clock throttling scales both),
//      estIdle = ratio × calIdle (the kernel's best-ever p10, tools/perfbench.calib.json) ≈ quiet-machine GPU ms;
//   3. A/B: --baseline <git ref | dist dir> measures candidate and baseline in the SAME browser, samples interleaved
//      ABAB…, → ratio cand/base with a bootstrap 95 % CI.
// Docs: docs/PERF.md. Usage:
//   node tools/perfbench.mjs                                   # build working tree, stages 1-5, High, 1920x1080
//   node tools/perfbench.mjs --stages 3,5 --phases combat,cast --quality high,low
//   node tools/perfbench.mjs --baseline HEAD --stages 5        # A/B working tree vs HEAD (git worktree + build)
//   node tools/perfbench.mjs --dev                             # measure the shared dev server (unbundled) instead of a build
// NO SERVERS: builds go to public/_bench/<name> and are opened as http://127.0.0.1:5190/_bench/<name>/index.html (the
// browser fulfils the build files from disk; public assets come from the shared :5190 server). The browser holds one of
// the 3 machine-wide capture slots (tools/lib/locks.mjs) for the whole run.
//   node tools/perfbench.mjs --repeat 3                        # repeatability (CV per metric)
// Options: --size 1920x1080 · --samples 20 (GPU samples per phase per target) · --frames 2 (frames per burst) ·
//   --players brann,seraphine · --no-gpu · --no-overdraw · --no-alloc · --out <dir> · --dist <dir> (candidate dist) ·
//   --nobuild (reuse the last candidate build) · --calibrate (update calIdle from this run) · --timeout 240000 ·
//   --url-extra "&foo=1" (candidate only) · --base-extra "&foo=0" (baseline only; A/B a runtime toggle with --baseline self)
//   --cpuprof (V8 CPU profile of each phase window → top self-time functions; replaces --no-alloc sampling) ·
//   --nominify (unminified candidate build: readable profiles) · --no-prio (don't raise the bench browser's priority) ·
//   --parts [all|a,b] --parts-phases combat,cast (GPU cost split by hiding parts) · --part-samples 10 ·
//   --od-parts earlyZ (overdraw with a part toggled) · --clean 1.3 (clean-window threshold × calIdle) ·
//   --max-attempts N (GPU samples tried per checkpoint, default 4 × --samples) · --host <origin> (shared server,
//   default http://127.0.0.1:5190) · --retry 1 (re-open pages + retry a phase after a page / GPU-process crash)
import { launchBrowser } from './lib/browser.mjs';
import { KCA_HOST } from './lib/platform.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2); const opt = {};
for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (!a.startsWith('--')) continue; const k = a.slice(2), n = argv[i + 1]; if (n === undefined || n.startsWith('--')) opt[k] = true; else { opt[k] = n; i++; } }
const list = (v, d) => String(v ?? d).split(',').map((s) => s.trim()).filter(Boolean);
const STAGES = list(opt.stages, '1,2,3,4,5');
const PHASES = list(opt.phases, 'reveal,combat,cast,boss');
const QUALS = list(opt.quality, 'high');
const [VW, VH] = String(opt.size || '1920x1080').split('x').map(Number);
const SAMPLES = Number(opt.samples || 20), FRAMES = Number(opt.frames || 2), REPEAT = Number(opt.repeat || 1);
const PLAYERS = list(opt.players, 'brann,seraphine');
const TIMEOUT = Number(opt.timeout || 240000);
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = path.resolve(opt.out || path.join(ROOT, 'progress/tmp/perf/bench', stamp));
fs.mkdirSync(OUT, { recursive: true });
const CALF = path.join(ROOT, 'tools/perfbench.calib.json');
const log = (...a) => console.log('[perfbench]', ...a);
const sh = (cmd, cwd = ROOT) => execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// ------------------------------------------------------------------ targets (build; NO servers — ARCHITECTURE §0 rule 8)
// Every target is a production build in public/_bench/<name> (gitignored + watch-ignored), opened as
// ${HOST}/_bench/<name>/index.html on the ONE shared dev server. Built with base './' and no public/ copy.
// NOTE: Vite's dev server only serves public files it saw at startup (watcher ignores _bench), so a fresh build would
// fall through to the SPA index.html. The bench browser therefore fulfils /_bench/<name>/* straight from the build dir
// (exact production bytes) and rewrites every other /_bench/<name>/<path> to ${HOST}/<path> (public assets via :5190).
const HOST = String(opt.host || KCA_HOST).replace(/[/]$/, '');
const BENCH = path.join(ROOT, 'public/_bench');
function build(srcRoot, outDir) {
  log('build', path.relative(ROOT, srcRoot) || '.', '→', path.relative(ROOT, outDir));
  const t = Date.now();
  const r = spawnSync(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--config', path.join(ROOT, 'tools/perfbench.vite.mjs')],
    { cwd: srcRoot, env: { ...process.env, PB_OUT: outDir, PB_MINIFY: opt.nominify ? '0' : '1' }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('build failed: ' + (r.stderr || r.stdout).slice(-2000));
  log(`built in ${((Date.now() - t) / 1000).toFixed(0)} s`);
}
const benchTarget = (label, name, dist, rev) => ({ label, name, dist, rev, url: `${HOST}/_bench/${name}/index.html` });
function resolveTarget(spec, label) {
  if (!spec || spec === 'working') {
    const name = 'cand' + (opt.nominify ? '-nomin' : '');
    const dist = opt.dist ? path.resolve(opt.dist) : path.join(BENCH, name);
    if (!opt.dist && !opt.nobuild) build(ROOT, dist);
    return benchTarget(label, opt.dist ? 'dir-' + path.basename(dist) : name, dist, 'working');
  }
  if (spec === 'self') return null;
  if (fs.existsSync(spec) && fs.existsSync(path.join(spec, 'index.html'))) return benchTarget(label, 'dir-' + path.basename(spec), path.resolve(spec), 'dir:' + spec);
  const sha = sh(`git rev-parse --short ${spec}`);
  const wt = path.join(ROOT, 'progress/tmp/perf/bench', 'wt-' + sha), dist = path.join(BENCH, sha);
  if (!fs.existsSync(path.join(wt, 'index.html'))) { log('git worktree', sha); sh(`git worktree add --detach "${wt}" ${sha}`); }
  if (!fs.existsSync(path.join(dist, 'index.html'))) build(wt, dist);
  return benchTarget(label, sha, dist, sha);
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
/** Route /_bench/<name>/* of a browser context: build files from disk, everything else → the shared dev server. */
async function routeBench(ctx) {
  await ctx.route((u) => u.pathname.startsWith('/_bench/'), async (route) => {
    const u = new URL(route.request().url());
    const parts = decodeURIComponent(u.pathname).split('/'); // ['', '_bench', name, ...rest]
    const t = targets.find((x) => x.name === parts[2]);
    if (!t) return route.continue();
    const m = [null, parts[2], parts.slice(3).join('/')];
    const f = path.join(t.dist, m[2] || 'index.html');
    if (f.startsWith(t.dist) && fs.existsSync(f) && fs.statSync(f).isFile()) {
      return route.fulfill({ status: 200, body: fs.readFileSync(f), headers: { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' } });
    }
    return route.continue({ url: `${HOST}/${m[2]}${u.search}` });
  });
  // same HMR stub as tools/capture.mjs (only matters for --dev targets: other agents' saves must not reload the page)
  await ctx.route((u) => u.pathname === '/@vite/client', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: 'export const createHotContext=()=>({accept(){},dispose(){},prune(){},on(){},off(){},send(){},invalidate(){},data:{}});export const updateStyle=(id,css)=>{let s=document.querySelector(`style[data-vite-dev-id="${id}"]`);if(!s){s=document.createElement("style");s.setAttribute("data-vite-dev-id",id);document.head.appendChild(s);}s.textContent=css;};export const removeStyle=(id)=>{const s=document.querySelector(`style[data-vite-dev-id="${id}"]`);if(s)s.remove();};export const injectQuery=(u)=>u;export class ErrorOverlay{};' }));
}

// ------------------------------------------------------------------ stats
const q = (a, p) => { const s = a.filter((v) => v != null && isFinite(v)).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1) + 0.5)))] : null; };
const r2 = (v, d = 2) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
const cvOf = (a) => { const v = a.filter((x) => x != null); if (v.length < 2) return null; const m = v.reduce((s, x) => s + x, 0) / v.length; const sd = Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)); return m ? sd / m : null; };
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
function bootRatio(fa, ca, fb, cb, P = 0.1, N = 1000) {
  const pick = (a) => { const o = []; for (let i = 0; i < a.length; i++) o.push(a[Math.floor(rnd() * a.length)]); return o; };
  const vals = [];
  for (let k = 0; k < N; k++) { const ra = q(pick(fa), P) / q(pick(ca), P), rb = q(pick(fb), P) / q(pick(cb), P); vals.push(ra / rb); }
  return { ratio: r2((q(fa, P) / q(ca, P)) / (q(fb, P) / q(cb, P)), 3), lo: r2(q(vals, 0.025), 3), hi: r2(q(vals, 0.975), 3) };
}

// ------------------------------------------------------------------ run
const calib = fs.existsSync(CALF) ? JSON.parse(fs.readFileSync(CALF, 'utf8')) : {};
const targets = [];
const cand = opt.dev ? { label: 'cand', name: null, url: HOST + '/', rev: 'dev:' + HOST } : resolveTarget('working', 'cand');
targets.push(cand);
if (opt.baseline) {
  const b = opt.baseline === 'self' ? { ...cand, label: 'base', rev: cand.rev + ' (self)' } : resolveTarget(opt.baseline, 'base');
  targets.push(b);
}
const extra = { cand: opt['url-extra'] || '', base: opt['base-extra'] || '' };
log('targets', targets.map((t) => `${t.label}=${t.rev} @ ${t.url}`).join(' · '));
const PAGE_KIT = fs.readFileSync(path.join(ROOT, 'tools/perfbench.page.js'), 'utf8');

const { acquire } = await import('./lib/locks.mjs');
const releaseSlot = await acquire('capture', { slots: Number(process.env.KCA_CAPTURE_SLOTS || 6), info: { owner: 'perf-1650', what: 'perfbench ' + stamp } });
const browser = await launchBrowser({ tool: 'perfbench', args: ['--autoplay-policy=no-user-gesture-required', `--kca-perfbench=${stamp}`] });
// CPU contention defence: the measuring browser's processes (browser, GPU process, renderers) run at AboveNormal
// priority, so other agents' work cannot starve the command submission / GPU-process decode during timed windows.
// Only processes this run started (found by the marker switch on the browser's command line + its descendants).
function boostPriority() {
  if (process.platform !== 'win32' || opt['no-prio']) return 0;
  const ps = `$all = Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Select-Object ProcessId,ParentProcessId,CommandLine;
$root = $all | Where-Object { $_.CommandLine -like '*kca-perfbench=${stamp}*' -and $_.CommandLine -notlike '*--type=*' } | Select-Object -First 1;
if (-not $root) { Write-Output 0; exit }
$ids = @($root.ProcessId); $grew = $true
while ($grew) { $grew = $false; foreach ($p in $all) { if (($ids -contains $p.ParentProcessId) -and -not ($ids -contains $p.ProcessId)) { $ids += $p.ProcessId; $grew = $true } } }
$n = 0; foreach ($i in $ids) { try { $pr = Get-Process -Id $i -ErrorAction Stop; if ($pr.PriorityClass -ne 'AboveNormal') { $pr.PriorityClass = 'AboveNormal' }; $n++ } catch {} }
Write-Output $n`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
  return Number(String(r.stdout || '').trim().split(/\s+/).pop()) || 0;
}
const results = { meta: { date: new Date().toISOString(), git: sh('git rev-parse --short HEAD'), dirty: !!sh('git status --porcelain --untracked-files=no src'), size: [VW, VH], samples: SAMPLES, frames: FRAMES, players: PLAYERS, targets: targets.map((t) => ({ label: t.label, rev: t.rev })) }, runs: [] };

async function openPage(t, stage, quality) {
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
  await routeBench(ctx);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e && e.message || e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error' && errs.length < 20) errs.push('console: ' + m.text().slice(0, 300)); else if (m.text().startsWith('[pb]')) log('   ', t.label, m.text()); });
  page.on('crash', () => log('   ', t.label, 'PAGE CRASHED'));
  const pl = PLAYERS.map((h, i) => `&p${i + 1}=${h}`).join('');
  const url = `${t.url}?mode=stage&stage=${stage}${pl}&bot=1&mute&drs=0&quality=${quality}&capture=1${extra[t.label] || ''}`;
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await page.waitForFunction(() => window.__KCA && window.__KCA.ready, null, { timeout: TIMEOUT });
  await page.evaluate(() => window.__KCA.ready);
  await page.evaluate(() => window.__KCA.setManualClock(true));
  await page.addScriptTag({ content: PAGE_KIT });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  const info = await page.evaluate(() => { window.__PB.slicesOn(); return window.__PB.info(); });
  info.boosted = boostPriority();
  try { info.glErrors = await page.evaluate(() => window.__PB.glErrors()); if (info.glErrors.length) log("   ", t.label, "GL ERRORS in one frame (draws SKIPPED by the driver):", info.glErrors.join(" | ")); } catch (e) { /* older kit */ }
  return { t, ctx, page, cdp, errs, info, loadS: (Date.now() - t0) / 1000, url };
}
const E = (P, fn, arg) => P.page.evaluate(fn, arg);

async function allocWindow(P, fn) {
  if (opt['no-alloc']) { await fn(); return null; }
  await P.cdp.send('HeapProfiler.startSampling', { samplingInterval: 16384, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  const f0 = await E(P, () => window.__PB.sl.frames.length);
  await fn();
  const f1 = await E(P, () => window.__PB.sl.frames.length);
  const { profile } = await P.cdp.send('HeapProfiler.stopSampling');
  const tops = new Map(); let total = 0;
  // key = allocating function < caller < caller's caller (who is allocating matters more than the three.js leaf)
  const nm = (cf) => `${cf.functionName || '(anon)'} ${(cf.url || '').replace(/^.*\//, '').replace(/\?.*$/, '')}:${cf.lineNumber + 1}`;
  const walk = (n, up) => { const chain = [nm(n.callFrame), ...up].slice(0, Number(opt["alloc-depth"] || 3)); if (n.selfSize) { total += n.selfSize; const k = chain.join(' < '); tops.set(k, (tops.get(k) || 0) + n.selfSize); } for (const c of n.children || []) walk(c, chain); };
  walk(profile.head, []);
  const frames = Math.max(1, f1 - f0);
  return { kbPerFrame: r2(total / frames / 1024, 1), frames, top: [...tops.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${r2(v / frames / 1024, 1)}KB ${k}`) };
}

// --cpuprof: V8 CPU profile over the phase window → top self-time functions (attribution of long JS slices)
async function cpuProfWindow(P, fn) {
  await P.cdp.send('Profiler.enable'); await P.cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  await P.cdp.send('Profiler.start');
  try { await fn(); } finally { /* stop below */ }
  const { profile } = await P.cdp.send('Profiler.stop');
  const byId = new Map(profile.nodes.map((n) => [n.id, n])), self = new Map();
  const dts = profile.timeDeltas || []; let tot = 0;
  (profile.samples || []).forEach((id, i) => { const n = byId.get(id); const cf = n.callFrame; if (cf.functionName === '(idle)' || cf.functionName === '(program)') return; const k = `${cf.functionName || '(anon)'} ${(cf.url || '').replace(/^.*\//, '').replace(/\?.*$/, '')}:${cf.lineNumber + 1}`; const d = (dts[i] || 0) / 1000; tot += d; self.set(k, (self.get(k) || 0) + d); });
  return { busyMs: r2(tot, 0), top: [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${r2(v, 0)}ms ${k}`) };
}

// CLEAN-WINDOW estimator: contention on this GPU is bimodal (the kernel reads either ~its idle time or 2–8× that while
// another process's burst runs). A sample counts as CLEAN when both calibration windows bracketing the frame burst are
// ≤ CLEAN_K × calIdle; each clean sample is normalised f × calIdle / cal (clock throttling) and the estimate is the
// p25 of those. Fallback when < 4 clean samples: the plain ratio p10(frame)/p10(cal) × calIdle (flagged "noisy").
const CLEAN_K = Number(opt.clean || 1.3), STABLE_K = Number(opt.stable || 1.12);
async function measureGPU(pages, calIdle) {
  if (opt['no-gpu']) return pages.map(() => null);
  for (const P of pages) await E(P, () => window.__PB.gpuWarm());
  const dom = [];
  for (const P of pages) dom.push(await E(P, (q) => { const d = window.__PB.domInfo ? window.__PB.domInfo() : null; if (q && window.__PB.quietDom) window.__PB.quietDom(true); return d; }, !opt['no-quiet']));
  try {
  const acc = pages.map(() => ({ frame: [], cal: [], cpu: [], wall: [], cpuCal: [], clean: [], stable: [], rejected: 0, attempts: 0 }));
  const need = (A) => A.clean.length < SAMPLES && A.clean.length + A.stable.length < SAMPLES * 1.5;
  const maxAttempts = Number(opt['max-attempts'] || SAMPLES * 4);
  // interleaved ABAB…; only VALID samples (GPU never starved by CPU submission, see page kit) count
  const tEnd = Date.now() + Number(opt["cp-secs"] || 150) * 1000; // time cap per checkpoint (CPU-starved machine: attempts get slow)
  for (let s = 0; s < maxAttempts && acc.some(need) && Date.now() < tEnd; s++) {
    for (let i = 0; i < pages.length; i++) {
      const P = pages[(i + s) % pages.length], A = acc[(i + s) % pages.length];
      if (!need(A) && A.frame.length >= SAMPLES) continue;
      A.attempts++;
      const r = await E(P, async (fr) => { const x = await window.__PB.gpuSample({ frames: fr }); x.cc = window.__PB.cpuCal(); return x; }, FRAMES);
      if (r.frame != null && r.cal != null && r.valid) {
        A.frame.push(r.frame); A.cal.push(r.cal); A.cpu.push(r.cpu); A.wall.push(r.wall);
        const ref = calIdle || Math.min(...A.cal);
        if (r.calMax <= CLEAN_K * ref) A.clean.push(r.frame * ref / r.cal);
        // STABLE: contended, but at the same level on both sides of the frame burst (steady proportional sharing, e.g.
        // a long Blender render) → the per-sample normalisation f × calIdle / cal holds
        else if (r.calMin != null && r.calMax <= STABLE_K * r.calMin && r.calMax <= 4 * ref) A.stable.push(r.frame * ref / r.cal);
      } else A.rejected++;
      A.cpuCal.push(r.cc);
    }
  }
  acc.forEach((A, i) => { A.dom = dom[i]; });
  return acc;
  } finally { for (const P of pages) await E(P, () => window.__PB.quietDom && window.__PB.quietDom(false)).catch(() => {}); }
}

function summarizeGPU(A, calIdle) {
  if (!A || !A.frame.length) return null;
  const f10 = q(A.frame, 0.1), c10 = q(A.cal, 0.1), ratio = f10 / c10;
  // tiers: ≥ 8 clean → p25(clean); else ≥ 4 clean → p25 ("few"); else ≥ 6 clean+stable → p25(both) ("stable", an UPPER BOUND:
  // steady contention slows the scene more than the kernel — repeat3 S1 cast stable 8.2–12.7 vs clean 7.0–7.3 ms); else noisy
  const clean = A.clean.length >= 8, few = !clean && A.clean.length >= 4, stable = !clean && !few && A.clean.length + A.stable.length >= 6; // stable reads HIGH (upper bound)
  const est = clean || few ? q(A.clean, 0.25) : stable ? q(A.clean.concat(A.stable), 0.25) : (calIdle ? ratio * calIdle : null);
  return { estIdleMs: r2(est), method: clean ? 'clean' : stable ? 'stable' : few ? 'few' : 'noisy', nClean: A.clean.length, nStable: A.stable.length, cleanCV: clean ? r2(cvOf(A.clean.filter((v) => v <= q(A.clean, 0.5))), 3) : null,
    dom: A.dom || null, frameP10: r2(f10), frameP50: r2(q(A.frame, 0.5)), calP10: r2(c10, 3), ratio: r2(ratio, 3), cpuSubmitP50: r2(q(A.cpu, 0.5)), cpuCalP10: r2(q(A.cpuCal, 0.1)), n: A.frame.length, rejected: A.rejected, attempts: A.attempts };
}
/** A/B on the clean normalised samples: ratio of p25s, bootstrap 95 % CI. */
function bootClean(a, b, N = 1000) {
  if (a.length < 4 || b.length < 4) return null;
  const pick = (x) => { const o = []; for (let i = 0; i < x.length; i++) o.push(x[Math.floor(rnd() * x.length)]); return o; };
  const v = []; for (let k = 0; k < N; k++) v.push(q(pick(a), 0.25) / q(pick(b), 0.25));
  return { ratio: r2(q(a, 0.25) / q(b, 0.25), 3), lo: r2(q(v, 0.025), 3), hi: r2(q(v, 0.975), 3), method: 'clean' };
}

const calKey = (info) => (info.renderer || 'gpu').replace(/\s+/g, ' ').slice(0, 120);
let calSeen = {}, cpuSeen = {};
// Target hardware = the user's GTX 1650 Ti laptop. On any other GPU every estimate is also converted to "≈1650 Ti ms"
// with the calibration kernels' ratio (est × ref calIdle / this calIdle); JS times are normalised to the laptop's CPU
// kernel the same way. PB_REF_GPU (a calib key substring) overrides the reference.
const REF_KEY = Object.keys(calib).find((k) => k.includes(process.env.PB_REF_GPU || '1650')) || Object.keys(calib)[0];
let runKey = null;
for (let rep = 0; rep < REPEAT; rep++) {
  for (const quality of QUALS) {
    for (const stage of STAGES) {
      log(`rep ${rep + 1}/${REPEAT} · stage ${stage} · ${quality}`);
      const pages = [];
      try {
        for (const t of targets) { const P = await openPage(t, stage, quality); pages.push(P); log(`  ${t.label} ready in ${P.loadS.toFixed(0)} s (${P.info.renderer}; ${P.info.boosted} processes AboveNormal)`); }
      } catch (e) { log('  LOAD FAILED', e.message.split('\n')[0]); for (const P of pages) await P.ctx.close(); results.runs.push({ rep, stage, quality, error: 'load: ' + e.message.slice(0, 300) }); continue; }
      const key = calKey(pages[0].info); runKey = key; const calIdle = calib[key] ? calib[key].calIdleMs : null;
      let retries = Number(opt.retry ?? 1);
      for (let pi = 0; pi < PHASES.length; pi++) {
        const phase = PHASES[pi];
        const t0 = Date.now();
        const rows = pages.map((P) => ({ rep, stage, quality, phase, target: P.t.label }));
        try {
          for (let i = 0; i < pages.length; i++) {
            const P = pages[i];
            if (opt['big-ms']) await E(P, (v) => { window.__PB.bigMs = v; }, Number(opt['big-ms']));
            rows[i].note = await E(P, (ph) => window.__PB.pre(ph), phase);
            await E(P, () => window.__PB.takeSlices());
            if (opt.cpuprof) rows[i].cpuprof = await cpuProfWindow(P, () => E(P, (ph) => window.__PB.window(ph), phase));
            else rows[i].alloc = await allocWindow(P, () => E(P, (ph) => window.__PB.window(ph), phase));
            if (rows[i].cpuprof) log(`    cpuprof ${phase} busy ${rows[i].cpuprof.busyMs} ms: ` + rows[i].cpuprof.top.join(' | '));
            const sl = await E(P, () => window.__PB.takeSlices());
            const fr = sl.frames.map((f) => f[0]);
            rows[i].slices = { frames: fr.length, p50: r2(q(fr, 0.5), 1), p99: r2(q(fr, 0.99), 1), max: r2(Math.max(0, ...fr), 1), over50: fr.filter((x) => x > 50).length, big: sl.big.slice(0, 4) };
            rows[i].newPrograms = await E(P, () => window.__PB.newPrograms());
            const cc = await E(P, () => { const a = []; for (let k = 0; k < 15; k++) a.push(window.__PB.cpuCal()); return a; });
            rows[i].cpuCal = r2(q(cc, 0.1), 3);
            const ck = calKey(P.info); if (!cpuSeen[ck] || Math.min(...cc) < cpuSeen[ck]) cpuSeen[ck] = Math.min(...cc);
            const cIdle = calib[ck] && calib[ck].cpuCalIdleMs;
            if (cIdle) { const k = cIdle / rows[i].cpuCal; rows[i].slices.cpuFactor = r2(1 / k, 2); rows[i].slices.maxNorm = r2(rows[i].slices.max * k, 1); rows[i].slices.p50Norm = r2(rows[i].slices.p50 * k, 1); rows[i].slices.over50Norm = sl.frames.filter((f) => f[0] * k > 50).length; }
          }
          const cps = [0, ...((phase === 'cast') ? [700, 700] : [])];
          for (let c = 0; c < cps.length; c++) {
            if (cps[c]) for (const P of pages) { await E(P, (ms) => window.__PB.drive(ms), cps[c]); }
            const cens = []; for (const P of pages) cens.push(await E(P, () => window.__PB.census()));
            // a WebGL context loss (GPU TDR under contention) renders nothing afterwards → retry the phase on fresh pages
            if (cens.some((c) => !c || !c.calls)) throw new Error('context lost (census drew 0 calls)');
            const gpu = await measureGPU(pages, calIdle);
            const ods = []; for (const P of pages) ods.push(opt['no-overdraw'] ? null : await E(P, () => window.__PB.overdraw()));
            if (opt['od-heat'] && !opt['no-overdraw']) for (let i = 0; i < pages.length; i++) { const u = await E(pages[i], () => window.__PB.odHeat()); if (u) { fs.mkdirSync(OUT, { recursive: true }); const f = path.join(OUT, `odheat_s${stage}_${phase}_${c}_${pages[i].t.label}.png`); fs.writeFileSync(f, Buffer.from(u.split(',')[1], 'base64')); log('    od heat → ' + f); } }
            // --od-parts earlyZ,sky: deterministic overdraw with one part toggled (e.g. what an early-z reorder saves)
            if (opt['od-parts'] && !opt['no-overdraw']) for (let i = 0; i < pages.length; i++) { ods[i].parts = {}; for (const nm of list(opt['od-parts'])) { const o2 = await E(pages[i], (n) => window.__PB.overdraw(n), nm); ods[i].parts[nm] = o2 && `${o2.mean} (O ${o2.opaque} T ${o2.transparent}) p95 ${o2.p95}`; } await E(pages[i], () => window.__PB.absorbPrograms()); log(`    od parts ${phase} ${pages[i].t.label}: now ${ods[i].mean} (O ${ods[i].opaque} T ${ods[i].transparent}) · ` + Object.entries(ods[i].parts).map(([k, v]) => `${k} → ${v}`).join(' · ')); }
            // --od-mats [phases]: transparent overdraw split by material (which spell FX layer is the hot one)
            if (opt['od-mats'] && !opt['no-overdraw'] && (opt['od-mats'] === true || list(opt['od-mats']).includes(phase))) for (let i = 0; i < pages.length; i++) { ods[i].byMat = await E(pages[i], (op) => window.__PB.odByMat(op ? 14 : 8, op), !!opt['od-opaque']); await E(pages[i], () => window.__PB.absorbPrograms()); log(`    od by material ${phase}#${c} ${pages[i].t.label}: ` + ods[i].byMat.join(' · ')); }
            for (let i = 0; i < pages.length; i++) {
              const g = summarizeGPU(gpu[i], calIdle);
              const cp = { census: cens[i], gpu: g, overdraw: ods[i], _raw: gpu[i] };
              rows[i].checkpoints = rows[i].checkpoints || []; rows[i].checkpoints.push(cp);
              if (gpu[i] && gpu[i].cal.length) { const m = Math.min(...gpu[i].cal); if (!calSeen[key] || m < calSeen[key]) calSeen[key] = m; }
            }
            if (pages.length > 1 && gpu[0] && gpu[1] && gpu[0].frame.length > 3 && gpu[1].frame.length > 3) {
              rows[0].checkpoints[c].ab = bootClean(gpu[0].clean, gpu[1].clean) || (() => { const x = bootClean(gpu[0].clean.concat(gpu[0].stable), gpu[1].clean.concat(gpu[1].stable)); return x && { ...x, method: 'stable' }; })() || { ...bootRatio(gpu[0].frame, gpu[0].cal, gpu[1].frame, gpu[1].cal), method: 'noisy' };
            }
          }
          // cost split: interleaved full vs part-removed samples (same calibration) → idle-ms estimate per part
          if (opt.parts && list(opt['parts-phases'], 'combat').includes(phase)) {
            const P = pages[0];
            let names = opt.parts === true || opt.parts === 'all' ? await E(P, () => Object.keys(window.__PB.parts)) : list(opt.parts);
            if (names.includes('envkids')) names = names.filter((n) => n !== 'envkids').concat(await E(P, () => window.__PB.envParts()));
            const PS = Number(opt['part-samples'] || 10);
            rows[0].parts = {};
            await E(P, () => window.__PB.gpuWarm());
            for (const nm of names) {
              const F = [], C = [], F2 = [], C2 = [];
              for (let s2 = 0; s2 < PS * 4 && F.length < PS; s2++) {
                const a = await E(P, (fr) => window.__PB.gpuSample({ frames: fr }), FRAMES);
                const b = await E(P, ([fr, part]) => window.__PB.gpuSample({ frames: fr, part }), [FRAMES, nm]);
                const cl = (x) => !calIdle || x.calMax <= CLEAN_K * calIdle;
                if (a.frame != null && b.frame != null && a.valid && b.valid && cl(a) && cl(b)) { F.push(a.frame); C.push(a.cal); F2.push(b.frame); C2.push(b.cal); }
              }
              await E(P, () => window.__PB.absorbPrograms());
              if (!F.length) continue;
              // PAIRED estimator: each (full, part-removed) pair is measured back to back (same contention state) →
              // share = 1 − median(part_i / full_i); 95 % CI by bootstrap of the median
              const rf = q(F, 0.1) / q(C, 0.1);
              const pr = F.map((f, k) => F2[k] / f);
              const bm = []; for (let b = 0; b < 1000; b++) { const o = []; for (let k = 0; k < pr.length; k++) o.push(pr[Math.floor(rnd() * pr.length)]); bm.push(q(o, 0.5)); }
              const med = q(pr, 0.5);
              rows[0].parts[nm] = { share: r2(1 - med, 3), ciLo: r2(1 - q(bm, 0.975), 3), ciHi: r2(1 - q(bm, 0.025), 3), estMs: calIdle ? r2(rf * (1 - med) * calIdle) : null, ratioFull: r2(rf, 3), n: pr.length };
              log(`    part ${nm.padEnd(18)} ${(rows[0].parts[nm].share * 100).toFixed(1)}% [${(rows[0].parts[nm].ciLo * 100).toFixed(1)}, ${(rows[0].parts[nm].ciHi * 100).toFixed(1)}] ≈ ${rows[0].parts[nm].estMs} ms idle`);
            }
          }
          // phase value = worst checkpoint
          for (const r of rows) {
            const cps2 = r.checkpoints;
            // worst checkpoint AMONG the best estimator tier present (a "stable"/"noisy" checkpoint reads high: repeat3 S1 cast
            // clean 7.0–7.3 vs stable 8.2–12.7 ms) — the other checkpoints stay in r.checkpoints
            const TIER = { clean: 4, few: 3, stable: 2, noisy: 1 }, tierOf = (c) => (c.gpu ? TIER[c.gpu.method] || 0 : 0), topT = Math.max(...cps2.map(tierOf));
            const worst = cps2.filter((c) => tierOf(c) === topT).reduce((a, b) => ((b.gpu && a.gpu && b.gpu.estIdleMs > a.gpu.estIdleMs) ? b : a));
            r.census = worst.census; r.gpu = worst.gpu; r.ab = worst.ab || null;
            r.overdraw = cps2.reduce((a, b) => (!a || (b.overdraw && b.overdraw.mean > a.mean) ? b.overdraw : a), null);
            r.errors = pages.find((P) => P.t.label === r.target).errs.splice(0);
          }
        } catch (e) {
          for (const r of rows) r.error = e.message.slice(0, 400); log('  PHASE FAILED', phase, e.message.split('\n')[0]);
          // page / GPU-process crash (context lost → every program relinks): re-open all pages and retry this phase once
          if (/crash|closed|context/i.test(e.message)) {
            for (const P of pages) await P.ctx.close().catch(() => {});
            pages.length = 0;
            try { for (const t of targets) pages.push(await openPage(t, stage, quality)); } catch (e2) { log('  RE-OPEN FAILED', e2.message.split('\n')[0]); }
            if (pages.length === targets.length && retries-- > 0) { log('  retrying', phase, 'on fresh pages'); pi--; continue; }
            if (pages.length !== targets.length) { for (const r of rows) results.runs.push(r); break; }
          }
        }
        for (const r of rows) {
          results.runs.push(r);
          const g = r.gpu || {}, c = r.census || {}, o = r.overdraw || {};
          log(`  ${phase.padEnd(6)} ${r.target} gpu est ${g.estIdleMs}ms (${g.method} ${g.nClean}/${g.attempts}) ratio ${g.ratio}${g.dom ? ` (dom anims ${g.dom.running} run, ${g.dom.infinite} inf)` : ""} · calls ${c.calls} tris ${c.triangles} px ${c.passPixels1080} · od ${o.mean}/${o.p95} · js max ${r.slices && r.slices.max} · alloc ${r.alloc && r.alloc.kbPerFrame}KB · newProg ${r.newPrograms && r.newPrograms.length ? r.newPrograms.join('+') : 0}${r.ab ? ` · A/B ${r.ab.ratio} [${r.ab.lo}, ${r.ab.hi}]` : ''}${r.error ? ' ERR ' + r.error : ''}`);
        }
        log(`  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
      }
      for (const P of pages) await P.ctx.close();
      fs.writeFileSync(path.join(OUT, 'perfbench.json'), JSON.stringify(results, null, 1));
    }
  }
}
await browser.close();
releaseSlot();

// calibration store: best-ever kernel p10-ish (min over all samples of the kernel draw ms)
for (const k in calSeen) {
  // FROZEN once set (estimates stay comparable across runs/days); --calibrate re-derives it from this run
  if (!calib[k] || !calib[k].calIdleMs || opt.calibrate) { calib[k] = { ...(calib[k] || {}), calIdleMs: r2(calSeen[k], 4), date: new Date().toISOString() }; log('calibration', k, '→', calib[k].calIdleMs, 'ms/draw'); }
}
for (const k in cpuSeen) { calib[k] = calib[k] || {}; if (!calib[k].cpuCalIdleMs || opt.calibrate) calib[k].cpuCalIdleMs = r2(cpuSeen[k], 3); }
for (const r of results.runs) { const k = REF_KEY; const cI = k && calib[k].cpuCalIdleMs; if (r.slices && r.cpuCal && cI && r.slices.maxNorm == null) { const f = cI / r.cpuCal; r.slices.cpuFactor = r2(1 / f, 2); r.slices.maxNorm = r2(r.slices.max * f, 1); r.slices.p50Norm = r2(r.slices.p50 * f, 1); } }
fs.writeFileSync(CALF, JSON.stringify(calib, null, 1));
// recompute estIdle with the (possibly new) calibration where missing
for (const r of results.runs) { if (r.gpu && r.gpu.estIdleMs == null) { const k = runKey || REF_KEY; if (k && calib[k]) r.gpu.estIdleMs = r2(r.gpu.ratio * calib[k].calIdleMs); } }
// ≈1650 Ti ms (the perf target): same as estIdleMs when measuring on the laptop itself
const refScale = REF_KEY && runKey && calib[REF_KEY] && calib[runKey] && calib[runKey].calIdleMs ? calib[REF_KEY].calIdleMs / calib[runKey].calIdleMs : null;
for (const r of results.runs) { if (r.gpu && r.gpu.estIdleMs != null && refScale) r.gpu.estRefMs = r2(r.gpu.estIdleMs * refScale); }
results.meta.reference = { gpu: REF_KEY, scale: refScale && r2(refScale, 3) };
if (refScale && runKey !== REF_KEY) log(`≈1650 Ti ms = est × ${r2(refScale, 3)} (calibration kernels: ${calib[REF_KEY].calIdleMs} / ${calib[runKey].calIdleMs} ms/draw)`);

// ------------------------------------------------------------------ summary
const rows = results.runs.filter((r) => !r.error);
const groups = new Map();
for (const r of rows) { const k = `${r.quality}|${r.stage}|${r.phase}|${r.target}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
const md = [];
md.push(`# perfbench ${results.meta.date} · git ${results.meta.git}${results.meta.dirty ? '+dirty' : ''} · ${VW}x${VH} · ${PLAYERS.join('+')} · ${SAMPLES}×${FRAMES} GPU samples`);
md.push('');
md.push('| q | stage | phase | tgt | est GPU ms (clean n) | ≈1650 Ti ms | ratio (CV) | calls | tris k | passPx 1080p | od mean/p95/max (T mean) | JS p50/max ms (1650-laptop CPU norm) | alloc KB/f | new prog | A/B cand/base [95% CI] |');
md.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
const med = (a) => q(a, 0.5);
for (const [k, rs] of groups) {
  const [quality, stage, phase, target] = k.split('|');
  const ratios = rs.map((r) => r.gpu && r.gpu.ratio), est = rs.map((r) => r.gpu && r.gpu.estIdleMs);
  const c = rs[0].census || {}, o = rs.map((r) => r.overdraw).filter(Boolean);
  const cv = cvOf(ratios);
  const ab = rs.map((r) => r.ab).filter(Boolean);
  md.push(`| ${quality} | ${stage} | ${phase} | ${target} | ${r2(med(est))}${est.length > 1 ? ` (CV ${((cvOf(est) || 0) * 100).toFixed(1)}%)` : ''} ${rs.map((r) => (r.gpu ? (r.gpu.method === 'clean' ? r.gpu.nClean : r.gpu.method === 'stable' ? 's' + (r.gpu.nClean + r.gpu.nStable) : r.gpu.method === 'few' ? 'f' + r.gpu.nClean : 'noisy') : '-')).join('/')} | ${r2(med(rs.map((r) => r.gpu && r.gpu.estRefMs)))} | ${r2(med(ratios), 3)}${cv != null ? ` (${(cv * 100).toFixed(1)}%)` : ''} | ${c.calls} | ${Math.round((c.triangles || 0) / 1000)} | ${c.passPixels1080} | ${o.length ? `${r2(med(o.map((x) => x.mean)))}/${med(o.map((x) => x.p95))}/${med(o.map((x) => x.max))} (${r2(med(o.map((x) => x.transparent)))})` : '-'} | ${r2(med(rs.map((r) => r.slices && (r.slices.p50Norm ?? r.slices.p50))), 1)}/${r2(Math.max(...rs.map((r) => (r.slices ? (r.slices.maxNorm ?? r.slices.max) : 0))), 0)} | ${r2(med(rs.map((r) => r.alloc && r.alloc.kbPerFrame)), 0)} | ${Math.max(...rs.map((r) => (r.newPrograms ? r.newPrograms.length : 0)))} | ${ab.length ? ab.map((x) => `${x.ratio} [${x.lo}, ${x.hi}]`).join(' ; ') : ''} |`);
}
const errs = results.runs.filter((r) => r.error || (r.errors && r.errors.length));
if (errs.length) { md.push(''); md.push('Errors:'); for (const r of errs) md.push(`- ${r.stage}/${r.phase}/${r.target}: ${r.error || ''} ${(r.errors || []).slice(0, 3).join(' | ')}`); }
fs.writeFileSync(path.join(OUT, 'summary.md'), md.join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'perfbench.json'), JSON.stringify(results, null, 1));
console.log(md.join('\n'));
log('wrote', path.relative(ROOT, OUT));
