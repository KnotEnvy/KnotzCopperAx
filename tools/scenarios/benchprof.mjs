// perf-1650 r4: V8 sampling profile of a /?mode=bench run, one profile per stage window (combat + top spell), and a
// per-spike attribution: for every bench spike whose OWN frame JS (sim + render) exceeded BP_MIN_JS ms (default 80),
// the self-time and inclusive-time top functions of the samples inside that frame. Run with --realtime:
//   node tools/capture.mjs --realtime --url "/?mode=bench&stages=1,2,3,4,5" --scenario tools/scenarios/benchprof.mjs --out ...
// Env: BP_STAGES=0,4 (0-based run indices; default all) · BP_US=500 (sampling interval µs) · BP_MIN_JS=80.
// Writes benchprof.txt; the page's bench spikes carry cpu [sim, render, steps] (render/bench.js).
import fs from 'node:fs';
import path from 'node:path';

const MIN_JS = Number(process.env.BP_MIN_JS || 80);
export default async (api) => {
  const { page, log } = api;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: Number(process.env.BP_US || 500) });
  const want = String(process.env.BP_STAGES || '').split(',').filter(Boolean).map(Number);
  const bs = () => page.evaluate(() => (window.__BENCH ? { running: window.__BENCH.running, n: window.__BENCH.results.length, seg: window.__BENCH.seg || '' } : null));
  const profs = []; // { i, p0 (performance.now at start), profile }
  const t0 = Date.now();
  for (let i = 0; Date.now() - t0 < 600000; i++) {
    let s = await bs();
    // BP_SEG=boss: profile the boss segment instead (starts at the boss segment, ends when the stage's results land)
    const SEG = process.env.BP_SEG || 'combat';
    while (s && s.running && !(s.n === i && s.seg === SEG) && Date.now() - t0 < 600000) { await page.waitForTimeout(150); s = await bs(); }
    if (!s || !s.running) break;
    if (want.length && !want.includes(i)) { while (s && s.running && s.n === i) { await page.waitForTimeout(500); s = await bs(); } continue; }
    await cdp.send('Profiler.start');
    const p0 = await page.evaluate(() => performance.now());
    while (s && s.running && s.n === i && (SEG === 'boss' ? true : s.seg !== 'boss')) { await page.waitForTimeout(250); s = await bs(); }
    const { profile } = await cdp.send('Profiler.stop');
    profs.push({ i, p0, profile });
    log(`stage idx ${i} profiled (${profile.samples.length} samples) @${Math.round((Date.now() - t0) / 1000)} s`);
  }
  while (Date.now() - t0 < 600000) { const s = await bs(); if (!s || !s.running) break; await page.waitForTimeout(2000); }
  const B = await page.evaluate(() => window.__BENCH && { results: window.__BENCH.results, error: window.__BENCH.error || null });
  await api.shot('bench_card');

  const lines = [];
  const fnName = (n) => { const c = n.callFrame; return `${c.functionName || '(anon)'} ${String(c.url).replace(/^.*\/src\//, 'src/').replace(/\?.*$/, '')}:${c.lineNumber + 1}`; };
  const attrib = (P, a, b) => { // performance.now window [a, b] → self / inclusive ms
    const prof = P.profile, byId = new Map(prof.nodes.map((n) => [n.id, n])), parent = new Map();
    for (const n of prof.nodes) for (const c of n.children || []) parent.set(c, n.id);
    // profile times are µs on the trace clock; anchor: startTime ≈ p0 (performance.now right after Profiler.start)
    let t = prof.startTime; const self = new Map(), incl = new Map(); let tot = 0;
    const dts = prof.timeDeltas;
    for (let k = 0; k < prof.samples.length; k++) {
      t += dts[k];
      const pn = P.p0 + (t - prof.startTime) / 1000;
      if (pn < a || pn > b) continue;
      const dt = (k + 1 < dts.length ? dts[k + 1] : dts[k]) / 1000;
      tot += dt;
      let id = prof.samples[k]; const leaf = byId.get(id); const nm = fnName(leaf);
      self.set(nm, (self.get(nm) || 0) + dt);
      const seen = new Set();
      while (id !== undefined) { const f = fnName(byId.get(id)); if (!seen.has(f)) { seen.add(f); incl.set(f, (incl.get(f) || 0) + dt); } id = parent.get(id); }
    }
    const top = (m, n) => [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, n).map(([k, v]) => `      ${v.toFixed(0).padStart(6)} ms ${k}`);
    return { tot, self: top(self, 14), incl: top(incl, 26) };
  };
  for (const r of (B && B.results) || []) {
    lines.push(`\n=== stage ${r.stage}: combat ${JSON.stringify(r.combat)} cast ${JSON.stringify(r.cast)} boss ${JSON.stringify(r.boss)} drs ${r.drs}`);
    const idx = B.results.indexOf(r), P = profs.find((x) => x.i === idx);
    for (const sp of r.spikes) {
      const js = sp.cpu ? sp.cpu[0] + sp.cpu[1] : 0;
      lines.push(`-- spike ${sp.seg} ${sp.ms} ms @${sp.t} (prog ${sp.newProg}, heap ${sp.heapMB}, sim/render/steps ${sp.cpu})`);
      if (!P || js < MIN_JS) continue;
      const A = attrib(P, sp.t - sp.ms - 5, sp.t + 5);
      lines.push(`   sampled ${A.tot.toFixed(0)} ms  SELF:`); lines.push(...A.self); lines.push('   INCLUSIVE:'); lines.push(...A.incl);
    }
  }
  const txt = lines.join('\n');
  fs.writeFileSync(path.join(api.outDir, 'benchprof.txt'), txt);
  for (const P of profs) fs.writeFileSync(path.join(api.outDir, `stage${P.i}.cpuprofile`), JSON.stringify(P.profile));
  log(txt.slice(0, 12000));
};
