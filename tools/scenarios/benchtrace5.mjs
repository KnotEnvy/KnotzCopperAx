// perf-1650 r4: Chrome trace of a FULL /?mode=bench run (all processes: renderer, GPU, browser), streamed and filtered
// on the fly so a 6-minute run stays small. Run with --realtime:
//   node tools/capture.mjs --realtime --url "/?mode=bench&stages=1,2,3,4,5" --scenario tools/scenarios/benchtrace5.mjs --out ...
// Env: BT_MIN_MS (default 25) = keep trace slices at least this long; BT_CATS overrides the categories.
// Writes benchtrace5.json (kept slices + per-thread busy ms per 250 ms bucket + bench results) and prints, for every
// bench spike (rAF gap > 100 ms) >= 250 ms, the slices overlapping the gap on every thread, plus the thread busy
// fractions around each segment — tells a main-thread task from a GPU-process stall from an idle machine.
import fs from 'node:fs';
import path from 'node:path';

const MIN_US = Number(process.env.BT_MIN_MS || 25) * 1000;
const CATS = process.env.BT_CATS || [
  'toplevel', 'devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame',
  'v8', 'disabled-by-default-v8.gc', 'blink.user_timing', 'gpu', 'gpu.angle', 'disabled-by-default-gpu.angle', 'gpu.service',
  'viz', 'benchmark',
].join(',');
// BT_FROM=cast BT_TO=end: trace window = top spell + boss arena (the boss-start stall); default combat → boss start.
// Exclusive by default (holds every other capture slot; PB_EXCLUSIVE=0 to skip).
const FROM = process.env.BT_FROM || 'combat', TO = process.env.BT_TO || '';
// BT_KEEP=<regex>: also keep every slice whose name matches, whatever its length (e.g. Paint|Decode|RasterTask)
const KEEP = process.env.BT_KEEP ? new RegExp(process.env.BT_KEEP) : null;
const TOP = /^(ThreadControllerImpl::RunTask|ThreadPool_RunTask|RunTask|TaskQueueManager::ProcessTaskFromWorkQueue|MessageLoop::RunTask)$/;

export default async (api) => {
  const { page, log } = api;
  const browser = page.context().browser();
  const cdp = await browser.newBrowserCDPSession();
  const threads = {}, procs = {};
  const kept = []; // [pidtid, name, ts, dur, cat, args]
  const busy = {}; // pidtid -> Map(bucket -> us) of top-level task time
  const BK = 250000;
  let marker = null, nEv = 0;
  const addBusy = (k, ts, dur) => {
    let m = busy[k]; if (!m) m = busy[k] = new Map();
    let a = ts, end = ts + dur;
    while (a < end) { const b = Math.floor(a / BK), bEnd = (b + 1) * BK, d = Math.min(end, bEnd) - a; m.set(b, (m.get(b) || 0) + d); a += d; }
  };
  cdp.on('Tracing.dataCollected', (d) => {
    for (const e of d.value) {
      nEv++;
      const k = e.pid + ':' + e.tid;
      if (e.ph === 'M') { if (e.name === 'thread_name') threads[k] = e.args.name; else if (e.name === 'process_name') procs[e.pid] = e.args.name; continue; }
      if (e.name === 'TimeStamp' && e.args && e.args.data && /^KCA_/.test(e.args.data.message || '')) { if (!marker && e.args.data.message.startsWith('KCA_T0')) marker = { ts: e.ts, p: Number(e.args.data.message.split(' ')[1]) }; kept.push([k, e.args.data.message, e.ts, 0, 'mark', '']); continue; }
      if (e.ph !== 'X' || !e.dur) continue;
      if (TOP.test(e.name)) addBusy(k, e.ts, e.dur);
      const gc = /GC|Scavenge|MarkCompact|Sweep/.test(e.name);
      if (e.dur >= MIN_US || (gc && e.dur >= 5000) || (KEEP && KEEP.test(e.name)) || (/angle|HLSL|D3D|Compile|Link|Shader|Program/i.test(e.name) && e.dur >= 3000)) {
        let a = ''; try { a = JSON.stringify(e.args || {}).slice(0, 220); } catch { /* ignore */ }
        kept.push([k, e.name, e.ts, e.dur, e.cat, a]);
      }
    }
  });
  // Chrome delivers ReportEvents data only at Tracing.end → trace one WINDOW per stage (combat + cast, ~19 s), then
  // stop, collect, filter, and re-arm for the next stage (a whole-run trace would overflow the buffer).
  let complete = null;
  cdp.on('Tracing.tracingComplete', () => { if (complete) complete(); });
  const bs = () => page.evaluate(() => (window.__BENCH ? { running: window.__BENCH.running, n: window.__BENCH.results.length, seg: window.__BENCH.seg || '' } : null));
  // mark the prewarm curtain lifting (opacity → 0) in the trace
  await page.evaluate(() => { const c = document.getElementById('kca-warm-curtain'); const mark = () => { const el = document.getElementById('kca-warm-curtain'); if (el && !el.__btObs) { el.__btObs = new MutationObserver(() => console.timeStamp('KCA_CURTAIN ' + el.style.opacity)); el.__btObs.observe(el, { attributes: true, attributeFilter: ['style'] }); } }; mark(); setInterval(mark, 500); return !!c; });
  const t0 = Date.now();
  const want = String(process.env.BT_STAGES || '').split(',').filter(Boolean).map(Number); // 0-based run indices, default all
  for (let i = 0; Date.now() - t0 < 600000; i++) {
    let s = await bs();
    // BT_EARLY=1: the first window starts at once (before the stage-1 fight) and ends when the top spell starts — the
    // tracing start-up hitch then lands in the load, not in the measured fight start
    const early = process.env.BT_EARLY === '1' && i === 0;
    while (!early && s && s.running && !(s.n === i && s.seg === FROM) && Date.now() - t0 < 600000) { await page.waitForTimeout(150); s = await bs(); }
    if (!s || !s.running) break;
    if (want.length && !want.includes(i)) { while (s && s.running && s.n === i) { await page.waitForTimeout(500); s = await bs(); } continue; }
    await cdp.send('Tracing.start', { traceConfig: { recordMode: 'recordUntilFull', includedCategories: CATS.split(',') }, transferMode: 'ReportEvents', bufferUsageReportingInterval: 1000 });
    if (early && process.env.BT_RELOAD === '1') { // trace the whole stage-1 load + prewarm + curtain lift too
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__KCA && window.__KCA.game, null, { timeout: 180000 });
      await page.evaluate(() => { const mark = () => { const el = document.getElementById('kca-warm-curtain'); if (el && !el.__btObs) { el.__btObs = new MutationObserver(() => console.timeStamp('KCA_CURTAIN ' + el.style.opacity)); el.__btObs.observe(el, { attributes: true, attributeFilter: ['style'] }); } }; mark(); setInterval(mark, 100); });
      s = await bs(); while (!s) { await page.waitForTimeout(100); s = await bs(); }
    }
    await page.evaluate(() => { const p = performance.now(); console.timeStamp('KCA_T0 ' + p.toFixed(3)); });
    while (s && s.running && s.n === i && (TO === 'end' || s.seg !== (early ? 'cast' : 'boss'))) { await page.waitForTimeout(250); s = await bs(); }
    const fin = new Promise((r) => { complete = r; });
    await cdp.send('Tracing.end');
    await fin;
    log(`stage idx ${i} traced @${Math.round((Date.now() - t0) / 1000)} s, trace events ${nEv}, kept ${kept.length}`);
  }
  while (Date.now() - t0 < 600000) { const s = await bs(); if (!s || !s.running) break; await page.waitForTimeout(2000); }
  const B = await page.evaluate(() => window.__BENCH && { results: window.__BENCH.results, error: window.__BENCH.error || null });
  await api.shot('bench_card');
  const tn = (k) => { const pid = k.split(':')[0]; return (procs[pid] || pid) + '/' + (threads[k] || k.split(':')[1]); };
  const toTs = (p) => (marker ? marker.ts + (p - marker.p) * 1000 : 0);
  const lines = [`trace events ${nEv}, kept ${kept.length}, marker ${marker ? 'ok' : 'MISSING'}`];
  // per-thread busy fraction over a window
  const busyIn = (a, b) => {
    const out = [];
    for (const k in busy) {
      let s = 0; for (let x = Math.floor(a / BK); x <= Math.floor(b / BK); x++) s += busy[k].get(x) || 0;
      const f = s / Math.max(1, b - a); if (f > 0.08) out.push(`${tn(k)} ${(f * 100).toFixed(0)}%`);
    }
    return out.sort().join(' | ');
  };
  for (const r of (B && B.results) || []) {
    lines.push(`\n=== stage ${r.stage}: combat ${JSON.stringify(r.combat)} cast ${JSON.stringify(r.cast)} boss ${JSON.stringify(r.boss)} drs ${r.drs}`);
    for (const sp of r.spikes) {
      if (sp.ms < 250) continue;
      const b = toTs(sp.t), a = b - sp.ms * 1000;
      lines.push(`-- spike ${sp.seg} ${sp.ms} ms @${sp.t} (prog ${sp.newProg}, heap ${sp.heapMB}, cpu sim/render/steps ${sp.cpu}); busy: ${busyIn(a, b)}`);
      const ov = kept.filter((e) => e[2] < b + 50000 && e[2] + e[3] > a - 50000).sort((x, y) => y[3] - x[3]).slice(0, 25);
      for (const e of ov) lines.push(`   ${(e[3] / 1000).toFixed(0).padStart(6)} ms @${((e[2] - a) / 1000).toFixed(0).padStart(6)} ${tn(e[0])} ${e[1]} ${e[5]}`);
    }
  }
  const top = [...kept].sort((x, y) => y[3] - x[3]).slice(0, 40);
  lines.push('\n=== top 40 slices');
  for (const e of top) lines.push(`${(e[3] / 1000).toFixed(0).padStart(6)} ms @${marker ? ((e[2] - marker.ts) / 1000 + marker.p).toFixed(0) : e[2]} ${tn(e[0])} ${e[1]} ${e[5]}`);
  const txt = lines.join('\n');
  fs.writeFileSync(path.join(api.outDir, 'benchtrace5.txt'), txt);
  const busyOut = {}; for (const k in busy) busyOut[tn(k)] = [...busy[k].entries()].map(([b, us]) => [marker ? Math.round(((b * BK - marker.ts) / 1000 + marker.p)) : b, Math.round(us / 1000)]);
  fs.writeFileSync(path.join(api.outDir, 'benchtrace5.json'), JSON.stringify({ marker, bench: B, kept: kept.map((e) => [tn(e[0]), e[1], marker ? Math.round((e[2] - marker.ts) / 1000 + marker.p) : e[2], Math.round(e[3] / 1000), e[4], e[5]]), busy: busyOut }));
  log(txt.slice(0, 20000));
};
