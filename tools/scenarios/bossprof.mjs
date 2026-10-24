// perf-1650 r4: V8 CPU profile of N manual-clock boss frames, reported per SUBTREE: World.render (actors: animation, IK,
// springs), WebGLRenderer.render (scene traversal, uniforms, GL calls), World.update / sim steps. For each subtree the top
// self-time functions. Teleports to the boss like bosscpu.mjs. Sampling 200 µs (the machine is shared: compare shares, not ms).
//   node tools/capture.mjs --url "/?mode=stage&stage=2&p1=brann&bot=1" --scenario tools/scenarios/bossprof.mjs --out ...    env BP_N=150
import fs from 'node:fs';
import path from 'node:path';

export default async function (api) {
  const { page, log, advance } = api;
  const N = Number(process.env.BP_N || 150);
  await advance(2500);
  if (process.env.BP_COMBAT !== '1') {
    await page.evaluate(() => {
      const g = window.__KCA.game, L = g.levels, d = window.__KCA.debug;
      d.god(true); d.pots(1, 9);
      const last = L.screens.length - 1;
      for (let k = L.screenIndex; k < last; k++) { d.kill('enemies'); L.waveActors.clear(); }
      for (const h of g.world.query({ kind: 'hero' })) h.pos.x = L.screens[last].x[0] + 3;
      L.pendingSpawns = 0; L.waveActors.clear(); L.enterScreen(last);
      if (g.cameraRig && g.cameraRig.snap) g.cameraRig.snap();
      L.waveActors.clear(); L.pendingSpawns = 0; L.waveIndex = (L.screens[last].waves || []).length - 1; L.nextWave();
    });
    await advance(9000);
    await page.evaluate(() => { const g = window.__KCA.game; setInterval(() => { for (const a of g.world.actors) if (a.kind === 'boss' || a.inStage) { a.maxHp = Math.max(a.maxHp || 0, 99999); a.hp = 99999; } }, 300); });
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  const t = await page.evaluate(async (N) => {
    const g = window.__KCA.game, R = g.renderer, DT = 1 / 60;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) { g._advanceReal(DT); g.renderFrame(Math.min(1, g.acc / DT), DT); await new Promise((r) => setTimeout(r, 0)); }
    return (performance.now() - t0) / N;
  }, N);
  const { profile } = await cdp.send('Profiler.stop');
  fs.writeFileSync(path.join(api.outDir, 'boss.cpuprofile'), JSON.stringify(profile));
  const byId = new Map(profile.nodes.map((n) => [n.id, n])), parent = new Map();
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const fname = (n) => { const c = n.callFrame; return `${c.functionName || '(anon)'} ${String(c.url).replace(/^.*\/src\//, 'src/').replace(/^.*\/deps\//, 'deps/').replace(/\?.*$/, '')}:${c.lineNumber + 1}`; };
  const subtrees = {
    'World.render': (f) => /^render src\/core\/World\.js/.test(f),
    'WebGLRenderer.render': (f) => /^WebGLRenderer\.render /.test(f) || /^render deps\/three\.module.*:5199/.test(f),
    'sim step': (f) => /^step src\/core\/Game\.js/.test(f),
    'vfx/ui/other systems': (f) => /^render src\/(vfx|ui)\//.test(f),
  };
  const agg = {}; for (const k in subtrees) agg[k] = { tot: 0, self: new Map() };
  let total = 0;
  const dts = profile.timeDeltas;
  for (let k = 0; k < profile.samples.length; k++) {
    const dt = (dts[k + 1] ?? dts[k]) / 1000; total += dt;
    let id = profile.samples[k]; const leaf = fname(byId.get(id));
    const chain = []; for (let x = id; x !== undefined; x = parent.get(x)) chain.push(fname(byId.get(x)));
    for (const key in subtrees) if (chain.some(subtrees[key])) { const A = agg[key]; A.tot += dt; A.self.set(leaf, (A.self.get(leaf) || 0) + dt); }
  }
  log(`wall ${t.toFixed(1)} ms/frame (profiled), sampled ${total.toFixed(0)} ms over ${N} frames = ${(total / N).toFixed(1)} ms/frame`);
  for (const key in agg) {
    const A = agg[key];
    log(`--- ${key}: ${(A.tot / N).toFixed(2)} ms/frame`);
    for (const [f, ms] of [...A.self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) log(`     ${(ms / N).toFixed(2).padStart(6)} ms/frame  ${f}`);
  }
}
