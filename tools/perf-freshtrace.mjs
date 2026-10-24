// perf-1650 r4: trace a /?mode=bench run from a FRESH browser (tracing starts BEFORE the first navigation, so the
// first-ever Skia raster / ANGLE executable compiles of a new profile are inside the trace). tools/capture.mjs can't do
// this (its scenario runs after the page is ready). Takes BOTH capture slots (quiet machine).
//   node tools/perf-freshtrace.mjs --url "/?mode=bench&stages=1" --out progress/tmp/perf/r4/f1 [--until cast] [--secs 90]
// Writes fresh.json: kept slices (≥ 15 ms, or names matching KEEP) with thread names + ms relative to page timeOrigin,
// and the bench results; prints each bench spike ≥ 150 ms with the GPU-process / renderer slices inside it.
import { launchBrowser } from './lib/browser.mjs';
import { KCA_HOST } from './lib/platform.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { acquire } from './lib/locks.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const url = new URL(arg('url', '/?mode=bench&stages=1'), KCA_HOST).href;
const out = path.resolve(arg('out', 'progress/tmp/perf/fresh')); fs.mkdirSync(out, { recursive: true });
const until = arg('until', 'cast'), secs = Number(arg('secs', 120));
const KEEP = /^(Paint|PaintImage|Decode Image|ImageDecodeTask|RasterTask|Commit|UpdateLayoutTree|Layout|RasterDecoderImpl::DoEndRasterCHROMIUM|D3DCompile|GetPixelExecutableTask::run|GetVertexExecutableTask::run|Program::MainLinkLoadEvent::wait|FireAnimationFrame|ProxyMain::BeginMainFrame)$/;
const CATS = 'toplevel,devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-v8.gc,gpu,gpu.angle,blink.user_timing,benchmark';
const SLOTS = Number(process.env.KCA_CAPTURE_SLOTS || 6), rels = [];
// slot 1 carries the browser (memory gate + stagger); the others only keep other captures out (holdOnly)
for (let i = 0; i < SLOTS; i++) rels.push(await acquire('capture', { slots: SLOTS, info: { what: `perf-freshtrace (${i + 1}/${SLOTS}, exclusive)`, owner: 'perf-1650', ...(i > 0 ? { holdOnly: true } : {}) } }));
const browser = await launchBrowser({ tool: 'perf-freshtrace', args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await context.route(/\/@vite\/client(\?.*)?$/, (route) => route.fulfill({ contentType: 'application/javascript', body: `const hot = () => ({ data: {}, accept() {}, acceptExports() {}, dispose() {}, prune() {}, decline() {}, invalidate() {}, on() {}, off() {}, send() {} });
export const createHotContext = hot; export function updateStyle(id, css) { let s = document.querySelector('style[data-vite-dev-id="' + id + '"]'); if (!s) { s = document.createElement('style'); s.setAttribute('data-vite-dev-id', id); document.head.appendChild(s); } s.textContent = css; }
export function removeStyle() {} export function injectQuery(u) { return u; } export class ErrorOverlay extends HTMLElement {} export default {};` }));
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  const cdp = await browser.newBrowserCDPSession();
  const threads = {}, procs = {}, kept = []; let nEv = 0;
  cdp.on('Tracing.dataCollected', (d) => { for (const e of d.value) { nEv++; const k = e.pid + ':' + e.tid;
    if (e.ph === 'M') { if (e.name === 'thread_name') threads[k] = e.args.name; else if (e.name === 'process_name') procs[e.pid] = e.args.name; continue; }
    if (e.name === 'TimeStamp' && e.args && e.args.data && /^KCA_/.test(e.args.data.message || '')) { kept.push([k, e.args.data.message, e.ts, 0, '']); continue; }
    if (e.ph !== 'X' || !e.dur) continue;
    if (e.dur >= 15000 || KEEP.test(e.name)) { let a = ''; try { a = JSON.stringify(e.args || {}).slice(0, 200); } catch { /* */ } kept.push([k, e.name, e.ts, e.dur, a]); } } });
  const done = new Promise((r) => cdp.on('Tracing.tracingComplete', r));
  await cdp.send('Tracing.start', { traceConfig: { recordMode: 'recordUntilFull', includedCategories: CATS.split(',') }, transferMode: 'ReportEvents' });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__KCA && window.__KCA.game, null, { timeout: 180000 });
  const origin = await page.evaluate(() => { const p = performance.now(); console.timeStamp('KCA_T0 ' + p.toFixed(3)); const mark = () => { const el = document.getElementById('kca-warm-curtain'); if (el && !el.__o) { el.__o = new MutationObserver(() => console.timeStamp('KCA_CURTAIN ' + el.style.opacity)); el.__o.observe(el, { attributes: true, attributeFilter: ['style'] }); } }; setInterval(mark, 50); return p; });
  const t0 = Date.now();
  for (;;) { const s = await page.evaluate(() => window.__BENCH ? { seg: window.__BENCH.seg, n: window.__BENCH.results.length, running: window.__BENCH.running } : null); if ((s && (s.seg === until || s.n > 0 || !s.running)) || Date.now() - t0 > secs * 1000) break; await page.waitForTimeout(200); }
  await cdp.send('Tracing.end'); await done;
  for (;;) { const s = await page.evaluate(() => window.__BENCH ? window.__BENCH.running : true); if (!s || Date.now() - t0 > 300000) break; await page.waitForTimeout(1000); }
  const B = await page.evaluate(() => window.__BENCH && window.__BENCH.results);
  const mk = kept.find((e) => /^KCA_T0/.test(e[1])); const p0 = mk ? Number(mk[1].split(' ')[1]) : 0, ts0 = mk ? mk[2] : 0;
  const tn = (k) => (procs[k.split(':')[0]] || '?') + '/' + (threads[k] || k.split(':')[1]);
  const rows = kept.map((e) => [tn(e[0]), e[1], Math.round((e[2] - ts0) / 1000 + p0), Math.round(e[3] / 100) / 10, e[4]]);
  fs.writeFileSync(path.join(out, 'fresh.json'), JSON.stringify({ url, nEv, errors, bench: B, rows }));
  const lines = [`events ${nEv}, kept ${rows.length}, errors ${errors.length}`, 'marks: ' + rows.filter((r) => /^KCA_/.test(r[1])).map((r) => r[1] + '@' + r[2]).join(' ; ')];
  for (const r of B || []) {
    lines.push(`stage ${r.stage} combat ${JSON.stringify(r.combat)} cast ${JSON.stringify(r.cast)} boss ${JSON.stringify(r.boss)}`);
    for (const sp of r.spikes.filter((x) => x.ms >= 150)) {
      const a = sp.t - sp.ms, b = sp.t;
      lines.push(`-- ${sp.seg} ${sp.ms} ms [${a}..${b}] cpu ${sp.cpu}`);
      for (const x of rows.filter((x) => x[2] < b && x[2] + x[3] > a - 30 && (x[3] >= 8 || /D3DCompile|Executable|DoEndRaster|Paint$|Decode/.test(x[1]))).sort((p, q) => p[2] - q[2]).slice(0, 60)) lines.push(`   ${String(x[2] - a).padStart(6)} +${String(x[3]).padStart(6)} ms  ${x[0]}  ${x[1]}  ${x[4].slice(0, 140)}`);
    }
  }
  fs.writeFileSync(path.join(out, 'fresh.txt'), lines.join('\n'));
  console.log(lines.join('\n').slice(0, 15000));
} finally { await browser.close().catch(() => {});  rels.forEach((r) => r()); }
