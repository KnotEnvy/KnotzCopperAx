// Wave C1 (perf, chapter1-integration r3): REALTIME probe of the two moments the critic measured — the stage reveal
// (curtain lift → first 10 s) and the boss appearance (boss wave start → bossIntro → +BI_AFTER ms) — entered the way the
// arcade does (title → map interlude → stage: map-time prefetch + stage prewarm behind the curtain, loop running).
//   node tools/capture.mjs --realtime --url "/?mode=title" --scenario tools/scenarios/bossintro.mjs --out <dir> --timeout 300000
// env: BI_STAGE=1..5 · BI_PROF=reveal,boss (V8 profiles: curtain→reveal window, boss window; 0 = none) · BI_US=250 (sampling µs) · BI_AFTER=5000 ·
//      BI_TRACE=1 (CDP trace of the boss window incl. the GPU process; heavier) · BI_REVEAL=10000 · BI_HERO=brann
// Per window: frames, worst gap, min fps (worst 500 ms window), p50 fps, frames > 34 ms, longtasks, and every rAF gap ≥ 50 ms
// with the JS of that frame (sim / render ms, from game.perf), programs linked and textures uploaded since the previous
// frame. With the profile: the self / inclusive top functions inside each gap whose frame JS ≥ 40 ms.
// Normalised (≈1650 Ti laptop) ms = raw × (laptop cpuCal 13.6 ms ÷ this page's cpuCal now) — JS-bound work only; a gap
// with little JS is GPU-process / compositor time and does not scale that way (it is listed with its JS split).
import fs from 'node:fs';
import path from 'node:path';

const LAPTOP_CPUCAL = 13.6; // tools/perfbench.calib.json, GTX 1650 Ti laptop cpuCalIdleMs

export default async (api) => {
  const { page, log } = api;
  const E = (fn, arg) => api.evalGame(fn, arg);
  const wait = (ms) => page.waitForTimeout(ms);
  const N = Number(process.env.BI_STAGE || 1), HERO = process.env.BI_HERO || 'brann';
  const AFTER = Number(process.env.BI_AFTER || 5000), REVEAL = Number(process.env.BI_REVEAL || 10000);
  await E(() => {
    const g = window.__KCA.game, W = g.renderer.webgl;
    const X = window.__BI = { f: [], lt: [], marks: {} };
    try { new PerformanceObserver((li) => { for (const e of li.getEntries()) if (e.duration >= 50) X.lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ entryTypes: ['longtask'] }); } catch (e) { /* unsupported */ }
    const loop = (t) => { const P = g.perf || {}; X.f.push([t, +(P.sim || 0).toFixed(1), +(P.render || 0).toFixed(1), P.steps || 0, W.info.programs ? W.info.programs.length : 0, W.info.memory.textures, W.info.memory.geometries]); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    const calBuf = new Float64Array(4096);
    X.cal = () => { const r = []; for (let k = 0; k < 7; k++) { const t = performance.now(); let s = 0.5; for (let q = 0; q < 60; q++) for (let i = 0; i < 4096; i++) { s = (s * 1.0000003 + calBuf[(i * 7 + q) & 4095]) % 97.13; calBuf[i] = Math.sqrt(s + i) * 0.5; } X._sink = s; r.push(performance.now() - t); } r.sort((a, b) => a - b); return r[1]; };
    g.bus.on('prewarm:done', (rep) => { X.marks.prewarmDone = performance.now(); X.prewarm = rep; });
    g.bus.on('bossIntro', () => { if (!X.marks.intro) X.marks.intro = performance.now(); });
  });
  // arcade entry: title → map → stage N
  await E(({ n, hero }) => {
    const g = window.__KCA.game, f = g.flow;
    g.session.reset(); g.session.join(0, hero, { bot: true }); g.session.autoContinue = true;
    f.mode = 'arcade'; f.seqIndex = ['1', 'bonus', '2', 'bonus', '3', 'bonus', '4', 'bonus', '5'].indexOf(String(n));
    f.go('map', { from: n - 1, to: n, then: { stage: String(n), players: [{ player: 0, heroId: hero, bot: true, magic: 3 }] } });
  }, { n: N, hero: HERO });
  const cdp = await page.context().newCDPSession(page);
  const PROFS = String(process.env.BI_PROF ?? 'reveal,boss').split(',');
  const PROF = PROFS.includes('boss');
  // BI_PROF=reveal: V8 profile from the moment the stage's prewarm curtain is up (warming) to the end of the reveal window
  let rprof = null, rp0 = 0;
  if (PROFS.includes('reveal')) {
    for (let t = 0; t < 240000; t += 100) { if (await E(() => !!window.__KCA.game.warming)) break; await wait(100); }
    await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: Number(process.env.BI_US || 250) }); await cdp.send('Profiler.start');
    rp0 = await E(() => performance.now());
  }
  for (let t = 0; t < 240000; t += 250) {
    if (await E((n) => { const g = window.__KCA.game; return !!window.__BI.marks.prewarmDone && g.flow.state === 'stage' && g.levels.stage && g.levels.stage.id === `stage${n}`; }, N)) break;
    await wait(250);
  }
  await wait(REVEAL + 500);
  if (rp0) { rprof = (await cdp.send('Profiler.stop')).profile; fs.writeFileSync(path.join(api.outDir, `reveal_s${N}.cpuprofile`), JSON.stringify(rprof)); }
  const cal0 = await E(() => window.__BI.cal());
  // ---------------------------------------------------------------- boss window
  let bcdp = null; const kept = [], threads = {}, procs = {};
  if (process.env.BI_TRACE === '1') {
    bcdp = await page.context().browser().newBrowserCDPSession();
    bcdp.on('Tracing.dataCollected', (d) => { for (const e of d.value) { const k = e.pid + ':' + e.tid;
      if (e.ph === 'M') { if (e.name === 'thread_name') threads[k] = e.args.name; else if (e.name === 'process_name') procs[e.pid] = e.args.name; continue; }
      if (e.name === 'TimeStamp' && e.args && e.args.data && /^BI_/.test(e.args.data.message || '')) { kept.push([k, e.args.data.message, e.ts, 0, '']); continue; }
      if (e.ph === 'X' && e.dur >= 8000) { let a = ''; try { a = JSON.stringify(e.args || {}).slice(0, 160); } catch { /* */ } kept.push([k, e.name, e.ts, e.dur, a]); } } });
    await bcdp.send('Tracing.start', { traceConfig: { recordMode: 'recordUntilFull', includedCategories: ['toplevel', 'devtools.timeline', 'disabled-by-default-devtools.timeline', 'gpu', 'gpu.angle', 'blink.user_timing', 'v8', 'disabled-by-default-v8.gc'] }, transferMode: 'ReportEvents' });
  }
  if (PROF) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: Number(process.env.BI_US || 250) }); await cdp.send('Profiler.start'); }
  const p0 = await E(() => { const p = performance.now(); console.timeStamp('BI_T0 ' + p.toFixed(3)); return p; });
  await wait(1500); // Profiler/Tracing start artifacts land here, not in the boss window
  const jump = await E(() => {
    const g = window.__KCA.game, L = g.levels, d = window.__KCA.debug;
    d.god(true);
    window.__BI.marks.jump = performance.now();
    const last = L.screens.length - 1;
    for (let i = L.screenIndex; i < last; i++) { d.kill('enemies'); L.waveActors.clear(); }
    for (const h of g.world.query({ kind: 'hero' })) h.pos.x = L.screens[last].x[0] + 3;
    L.pendingSpawns = 0; L.waveActors.clear(); L.enterScreen(last);
    if (g.cameraRig && g.cameraRig.snap) g.cameraRig.snap();
    L.waveActors.clear(); L.pendingSpawns = 0; L.waveIndex = (L.screens[last].waves || []).length - 1; L.nextWave();
    window.__BI.marks.waveStart = performance.now();
    return window.__BI.marks.jump;
  });
  let tw = 0;
  for (; tw < 90000; tw += 250) {
    if (await E(() => !!window.__BI.marks.intro)) break;
    await E(() => { const L = window.__KCA.game.levels; for (const a of L.waveActors) if (a.alive && !a.inStage && !(a.kind === 'boss' || (a.def && a.def.boss))) { a.hp = 0; try { a.kill && a.kill(); } catch (e) { /* ignore */ } } });
    await wait(250);
  }
  await E(() => { const g = window.__KCA.game; window.__BI.keep = setInterval(() => { for (const a of g.world.actors) if (a.kind === 'boss' || a.inStage || (a.def && a.def.boss)) { a.maxHp = Math.max(a.maxHp || 0, 99999); a.hp = 99999; } }, 300); });
  await wait(AFTER);
  let profile = null;
  if (PROF) { profile = (await cdp.send('Profiler.stop')).profile; fs.writeFileSync(path.join(api.outDir, `boss_s${N}.cpuprofile`), JSON.stringify(profile)); }
  if (bcdp) { const done = new Promise((r) => bcdp.on('Tracing.tracingComplete', r)); await bcdp.send('Tracing.end'); await done; }
  const cal1 = await E(() => window.__BI.cal());
  const X = await E(() => { const B = window.__BI; clearInterval(B.keep); return { f: B.f, lt: B.lt, marks: B.marks, prewarm: B.prewarm || null, errors: (window.__KCA.info().errors || []).slice(0, 10), boss: (() => { const g = window.__KCA.game; const b = g.world.actors.find((a) => a.kind === 'boss'); return b ? (b.typeId || (b.def && b.def.id)) : null; })() }; });
  const bprof = profile, bp0 = p0;
  const cal = Math.min(cal0, cal1), kNorm = LAPTOP_CPUCAL / cal;
  // ---------------------------------------------------------------- stats
  const F = X.f;
  const win = (name, a, b) => {
    const fr = F.filter((x) => x[0] >= a && x[0] <= b);
    const gaps = [];
    for (let i = 1; i < fr.length; i++) { const d = fr[i][0] - fr[i - 1][0]; if (d >= 50) gaps.push({ at: Math.round(fr[i][0]), rel: Math.round(fr[i][0] - a), ms: Math.round(d), sim: fr[i][1], ren: fr[i][2], steps: fr[i][3], prog: fr[i][4] - fr[i - 1][4], tex: fr[i][5] - fr[i - 1][5], geo: fr[i][6] - fr[i - 1][6] }); }
    let minFps = Infinity;
    for (let i = 0; i < fr.length; i++) { let j = i; while (j < fr.length && fr[j][0] - fr[i][0] < 500) j++; if (j >= fr.length) break; minFps = Math.min(minFps, (j - i) / ((fr[j][0] - fr[i][0]) / 1000)); }
    const dts = []; for (let i = 1; i < fr.length; i++) dts.push(fr[i][0] - fr[i - 1][0]);
    const s = dts.slice().sort((x, y) => x - y);
    const lt = X.lt.filter(([st, d]) => st + d >= a && st <= b).map(([st, d]) => ({ rel: Math.round(st - a), ms: d }));
    return { name, a: Math.round(a), frames: fr.length, worst: Math.round(s[s.length - 1] || 0), minFps: Math.round(minFps === Infinity ? 0 : minFps), p50Fps: Math.round(1000 / (s[s.length >> 1] || 16.7)), over34: dts.filter((d) => d > 34).length, longtasks: lt, ltMax: lt.reduce((m, x) => Math.max(m, x.ms), 0), gaps };
  };
  const M = X.marks;
  const R = { stage: N, hero: HERO, boss: X.boss, cpuCal: +cal.toFixed(2), kNorm: +kNorm.toFixed(2), waitIntroMs: M.intro ? Math.round(M.intro - M.jump) : null, prewarm: X.prewarm, errors: X.errors, windows: [] };
  if (M.prewarmDone) R.windows.push(win('reveal10s', M.prewarmDone, M.prewarmDone + REVEAL));
  R.windows.push(win('bossSpawn', M.jump, M.intro || M.jump + 90000));
  if (M.intro) { R.windows.push(win('bossIntro', M.intro - 1000, M.intro + 3000)); R.windows.push(win('bossAll', M.jump, M.intro + AFTER)); }
  // ---------------------------------------------------------------- profile attribution of the long frames
  const fnName = (n) => { const c = n.callFrame; return `${c.functionName || '(anon)'} ${String(c.url).replace(/^.*\/src\//, 'src/').replace(/^.*\/deps\//, 'deps/').replace(/\?.*$/, '')}:${c.lineNumber + 1}`; };
  const attrib = (a, b, profile = bprof, p0 = bp0) => {
    const byId = new Map(profile.nodes.map((n) => [n.id, n])), parent = new Map();
    for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
    let t = profile.startTime; const self = new Map(), incl = new Map(); let tot = 0;
    const dts = profile.timeDeltas;
    for (let k = 0; k < profile.samples.length; k++) {
      t += dts[k];
      const pn = p0 + (t - profile.startTime) / 1000;
      if (pn < a || pn > b) continue;
      const dt = (k + 1 < dts.length ? dts[k + 1] : dts[k]) / 1000; tot += dt;
      let id = profile.samples[k]; const nm = fnName(byId.get(id));
      if (/^\((idle|program)\)/.test(nm)) continue;
      self.set(nm, (self.get(nm) || 0) + dt);
      const seen = new Set();
      while (id !== undefined) { const f = fnName(byId.get(id)); if (!seen.has(f)) { seen.add(f); incl.set(f, (incl.get(f) || 0) + dt); } id = parent.get(id); }
    }
    const top = (m, n) => [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, n).map(([k, v]) => `${v.toFixed(1).padStart(7)} ms  ${k}`);
    return { tot: +tot.toFixed(1), self: top(self, 12), incl: top(incl, 24) };
  };
  const lines = [`stage ${N} boss ${R.boss} · cpuCal ${R.cpuCal} ms → ≈laptop ×${R.kNorm} (JS-bound) · intro ${R.waitIntroMs} ms after the jump · prewarm ${X.prewarm ? X.prewarm.totalMs + ' ms' : '-'}`];
  for (const w of R.windows) {
    lines.push(`\n== ${w.name}: frames ${w.frames} worst ${w.worst} ms (≈laptop ${Math.round(w.worst * kNorm)}) minFps ${w.minFps} p50 ${w.p50Fps} >34ms ${w.over34} longtask max ${w.ltMax} ms [${w.longtasks.map((x) => x.ms + '@' + x.rel).join(' ')}]`);
    for (const gp of w.gaps.slice(0, 20)) lines.push(`   gap ${String(gp.ms).padStart(5)} ms @${gp.rel} js ${(gp.sim + gp.ren).toFixed(0)} (sim ${gp.sim} ren ${gp.ren} st ${gp.steps}) ≈laptop js ${Math.round((gp.sim + gp.ren) * kNorm)} · prog +${gp.prog} tex +${gp.tex} geo +${gp.geo}`);
  }
  // every longtask ≥ 50 ms in the reveal / boss windows, attributed with the profile that covers it
  const ltAttr = (w, prof, pp0, tag) => {
    for (const lt of [...w.longtasks].sort((x, y) => y.ms - x.ms).slice(0, 6)) {
      const a = w.a + lt.rel, A = attrib(a - 1, a + lt.ms + 1, prof, pp0);
      lines.push(`\n-- ${tag} LONGTASK ${lt.ms} ms @+${lt.rel} (≈laptop ${Math.round(lt.ms * kNorm)}): sampled ${A.tot} ms  SELF:`); lines.push(...A.self.map((s) => '     ' + s)); lines.push('   INCLUSIVE:'); lines.push(...A.incl.map((s) => '     ' + s));
    }
  };
  if (rprof) { const rw = R.windows.find((w) => w.name === 'reveal10s'); if (rw) ltAttr(rw, rprof, rp0, 'reveal'); }
  if (profile) { const bw = R.windows.find((w) => w.name === 'bossAll') || R.windows.find((w) => w.name === 'bossSpawn'); if (bw) ltAttr(bw, profile, p0, 'boss'); }
  if (rprof) {
    const rw = R.windows.find((w) => w.name === 'reveal10s');
    for (const gp of rw ? [...rw.gaps].filter((x) => x.sim + x.ren >= 15).sort((x, y) => y.ms - x.ms).slice(0, 6) : []) {
      const A = attrib(gp.at - gp.ms - 2, gp.at + 2, rprof, rp0);
      lines.push(`\n-- reveal gap ${gp.ms} ms @+${gp.rel} (js ${(gp.sim + gp.ren).toFixed(0)} ms): sampled ${A.tot} ms  SELF:`); lines.push(...A.self.map((s) => '     ' + s)); lines.push('   INCLUSIVE:'); lines.push(...A.incl.map((s) => '     ' + s));
    }
  }
  if (profile) {
    const bw = R.windows.find((w) => w.name === 'bossAll') || R.windows.find((w) => w.name === 'bossSpawn');
    const seen = new Set();
    for (const gp of [...bw.gaps].sort((x, y) => y.ms - x.ms).slice(0, 8)) {
      if (seen.has(gp.at)) continue; seen.add(gp.at);
      const A = attrib(gp.at - gp.ms - 2, gp.at + 2);
      lines.push(`\n-- boss gap ${gp.ms} ms @+${gp.rel} (js ${(gp.sim + gp.ren).toFixed(0)} ms): sampled ${A.tot} ms  SELF:`); lines.push(...A.self.map((s) => '     ' + s)); lines.push('   INCLUSIVE:'); lines.push(...A.incl.map((s) => '     ' + s));
    }
    // whole boss-spawn window (jump → intro): where the main thread went
    const A = attrib(M.jump, M.intro || M.jump + 90000);
    lines.push(`\n-- whole spawn window jump→intro: sampled ${A.tot} ms  INCLUSIVE:`); lines.push(...A.incl.map((s) => '     ' + s));
  }
  if (bcdp) {
    const mk = kept.find((e) => /^BI_T0/.test(e[1])); const pp0 = mk ? Number(mk[1].split(' ')[1]) : 0, ts0 = mk ? mk[2] : 0;
    const tn = (k) => (procs[k.split(':')[0]] || '?') + '/' + (threads[k] || k.split(':')[1]);
    const rows = kept.filter((e) => e[3] > 0).map((e) => [tn(e[0]), e[1], Math.round((e[2] - ts0) / 1000 + pp0), Math.round(e[3] / 100) / 10, e[4]]);
    const bw = R.windows.find((w) => w.name === 'bossAll') || R.windows[R.windows.length - 1];
    for (const gp of [...bw.gaps].sort((x, y) => y.ms - x.ms).slice(0, 6)) {
      const a = gp.at - gp.ms, b = gp.at;
      lines.push(`\n-- trace in gap ${gp.ms} ms @+${gp.rel}:`);
      for (const x of rows.filter((x) => x[2] < b && x[2] + x[3] > a - 20 && x[3] >= 10).sort((p, q) => p[2] - q[2]).slice(0, 40)) lines.push(`   ${String(x[2] - a).padStart(6)} +${String(x[3]).padStart(6)} ms  ${x[0]}  ${x[1]}  ${x[4].slice(0, 120)}`);
    }
  }
  const txt = lines.join('\n');
  fs.writeFileSync(path.join(api.outDir, 'bossintro.json'), JSON.stringify(R, null, 1));
  fs.writeFileSync(path.join(api.outDir, 'bossintro.txt'), txt);
  log(txt.slice(0, 14000));
  await api.shot('end');
};
