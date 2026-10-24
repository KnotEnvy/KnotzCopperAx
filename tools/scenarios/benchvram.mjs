// perf-1650 r4: plain /?mode=bench run (no profiler / trace — those cause their own start-up gaps) that also logs the
// page's performance.timeOrigin, so bench spikes (performance.now) can be matched to an external wall-clock sampler
// (e.g. Windows "GPU Process Memory" / "GPU Adapter Memory" counters). Run with --realtime:
//   node tools/capture.mjs --realtime --url "/?mode=bench&stages=1,2,3,4,5" --scenario tools/scenarios/benchvram.mjs --out ...
import fs from 'node:fs';
import path from 'node:path';
export default async function (api) {
  const { page, log, shot } = api;
  const t0 = Date.now();
  const origin = await page.evaluate(() => performance.timeOrigin);
  while (Date.now() - t0 < 600000) {
    const s = await page.evaluate(() => (window.__BENCH ? { running: window.__BENCH.running } : null));
    if (s && !s.running) break;
    await page.waitForTimeout(2000);
  }
  const B = await page.evaluate(() => window.__BENCH && { results: window.__BENCH.results, error: window.__BENCH.error || null });
  const R = page.evaluate(() => { const g = window.__KCA.game, W = g.renderer.webgl; return { mem: W.info.memory, programs: W.info.programs.length, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0 }; });
  fs.writeFileSync(path.join(api.outDir, 'bench.json'), JSON.stringify({ origin, bench: B, end: await R }, null, 1));
  for (const r of (B && B.results) || []) log(`S${r.stage} combat ${JSON.stringify(r.combat)} cast ${JSON.stringify(r.cast)} boss ${JSON.stringify(r.boss)} drs ${r.drs} | spikes ${r.spikes.filter((s) => s.ms >= 150).map((s) => `
   ${s.seg} ${s.ms}@${Math.round(s.t)} cpu[${s.cpu}] rsub[${s.rsub || ''}] sys[${(s.sys || []).join(', ')}]${(s.gl || []).map((c) => `
      GL ${c.fn}(${c.arg}) ${c.ms} ms < ${c.stack}`).join('')}`).join('')}`);
  for (const r of (B && B.results) || []) if (r.prof) for (const k in r.prof) log(`S${r.stage} ${k} steps/frame ${r.prof[k].steps} | ${r.prof[k].top.join(' · ')}
      ${r.prof[k].gl}`);
  for (const r of (B && B.results) || []) if (r.actors) log(`S${r.stage} actors ${JSON.stringify(r.actors)}`);
  log('end ' + JSON.stringify(await R));
  await page.waitForTimeout(500);
  await shot('bench_card');
}
