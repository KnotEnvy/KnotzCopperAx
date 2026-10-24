// perf-1650: verifies the in-game benchmark (/?mode=bench) end to end — run with --realtime:
//   node tools/capture.mjs --realtime --url "/?mode=bench&stages=1&secs=5" --scenario tools/scenarios/perf_bench.mjs --out ...
// Waits for the run to finish (window.__BENCH.running === false), logs the results and shoots the results card.
//
// r4 EXCLUSIVE (default): the multi-second bench freezes QA saw (S3 combat 6 s, S1 2 s) were a SECOND headless game
// page — another agent's capture in the other slot — sharing the 4 GB GPU and the CPU (quiet run: no stall > 1.1 s).
// So this scenario first takes ALL the OTHER capture slots too (KCA_CAPTURE_SLOTS − 1 of them; tools/lib/locks.mjs;
// waits for the running captures to finish, max PB_EXCL_WAIT s per slot, default 900), then reloads the page so the
// bench starts on a machine with no other headless game. PB_EXCLUSIVE=0 skips it. The log line says
// `exclusive: true|false` — a non-exclusive card is not a measurement of the game (it IS the QA condition, though:
// PB_EXCLUSIVE=0 shows how the game behaves next to other agents' pages).
import fs from 'node:fs';
import path from 'node:path';
import { takeOtherSlots, boostBrowser } from '../lib/exclusive.mjs';

export default async function (api) {
  const { page, log, shot } = api;
  let release = null;
  if (process.env.PB_EXCLUSIVE !== '0') {
    try {
      release = await takeOtherSlots('perf_bench exclusive');
      if (!release) throw new Error('slots not available');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__KCA && window.__KCA.ready, null, { timeout: 180000 });
      log('browser processes raised to ABOVE_NORMAL: ' + await boostBrowser(page));
    } catch (e) { log('exclusive slot not taken (' + e.message + ') — results are contended'); release = null; }
  }
  const t0 = Date.now();
  while (Date.now() - t0 < 600000) {
    const s = await page.evaluate(() => (window.__BENCH ? { running: window.__BENCH.running, n: window.__BENCH.results.length, err: window.__BENCH.error || null } : null));
    if (s && !s.running) break;
    await page.waitForTimeout(2000);
  }
  const B = await page.evaluate(() => window.__BENCH && { results: window.__BENCH.results, error: window.__BENCH.error || null, card: !!document.querySelector('.kca-bench') });
  if (release) release();
  log('bench: exclusive=' + !!release + ' error=' + (B && B.error) + ' card=' + (B && B.card));
  const f = (x) => (x ? `${x.med}/${x.low1} w${x.worst} js${x.js}(sim${x.sim}+ren${x.ren} st${x.steps}) sub[${(x.sub || []).join(',')}] gpu${x.gpu} >20:${x.over20}%` : '-');
  for (const r of (B && B.results) || []) {
    log(`S${r.stage} combat ${f(r.combat)} | cast ${f(r.cast)} | boss ${f(r.boss)} | drs ${r.drs.join('/')} | cpu× ${r.cpu ? ['combat', 'cast', 'boss'].map((k) => r.cpu[k]).join('/') : '-'}`);
    for (const sp of r.spikes || []) if (sp.ms >= 100) log(`    spike ${sp.seg} ${sp.ms} ms prog+${sp.newProg} drs[${sp.drs}] heap ${sp.heapMB} cpu[${sp.cpu}]${sp.progNames && sp.progNames.length ? ' ' + sp.progNames.join(';').slice(0, 160) : ''}`);
    for (const d of r.firstDraw || []) log(`    FIRST-DRAW ${d.seg} @${d.t} ${d.prog} | ${d.obj} | ${d.mat} | ${d.flags || ''}`);
    if (r.actors) log(`    actors ${JSON.stringify(r.actors)}`);
  }
  try { fs.writeFileSync(path.join(api.outDir, 'bench_results.json'), JSON.stringify({ exclusive: !!release, ...B }, null, 1)); } catch (e) { /* ignore */ }
  await page.waitForTimeout(800);
  await shot('bench_card');
}
