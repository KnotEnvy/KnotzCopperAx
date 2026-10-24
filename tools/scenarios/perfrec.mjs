// Per-frame perf recorder (perf-1650). REALTIME. Enters a stage the arcade way (title → map → stage, so the map
// prefetch + stage prewarm run), then records per-frame wall dt, CPU sim / render ms, GPU ms (+ per segment: shadow,
// scene, post passes) from window.__PERF (src/render/perfProbe.js) over phases:
//   reveal (first 10 s of play) · combat (20 s steady bot fight) · castTop (top-tier spell) · boss (jump to the boss
//   screen, spawn + intro + 8 s) · bossFight (10 s steady)
// Longtasks are attributed with a CDP CPU profile (busy runs > 50 ms → top inclusive functions).
//   node tools/capture.mjs --realtime --host http://127.0.0.1:5167 --url "/?mode=title" --scenario tools/scenarios/perfrec.mjs --out <dir> --timeout 180000
// env: PR_STAGE=1..5 · PR_BOSS=0 · PR_PROF=0 (no CPU profile) · PR_COMBAT=20000 · PR_Q=low (quality via reload not supported: use &quality in url)
import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  const E = (fn, arg) => api.evalGame(fn, arg);
  const wait = (ms) => api.page.waitForTimeout(ms);
  const N = Number(process.env.PR_STAGE || 1);
  const PROF = process.env.PR_PROF !== '0';
  const cdp = await api.page.context().newCDPSession(api.page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });

  const hasPerf = await E(() => !!window.__PERF);
  if (!hasPerf) throw new Error('window.__PERF missing (render/perfProbe.js not installed)');
  await E(() => { const P = window.__PERF; P.gpuOn = P.gpuAvailable; P.start(); });

  if (await E(() => window.__KCA.game.flow && window.__KCA.game.flow.state !== 'stage')) {
    await E((n) => {
      const g = window.__KCA.game, f = g.flow;
      g.session.reset(); g.session.join(0, 'brann', { bot: true }); g.session.autoContinue = true;
      f.mode = 'arcade'; f.seqIndex = ['1', 'bonus', '2', 'bonus', '3', 'bonus', '4', 'bonus', '5'].indexOf(String(n));
      f.go('map', { from: n - 1, to: n, then: { stage: String(n), players: [{ player: 0, heroId: 'brann', bot: true, magic: 3 }] } });
    }, N);
    for (let t = 0; t < 240000; t += 250) {
      const ok = await E((n) => { const g = window.__KCA.game; return g.flow.state === 'stage' && g.levels.phase === 'fight' && g.levels.stage && g.levels.stage.id === `stage${n}`; }, N);
      if (ok) break;
      await wait(250);
    }
  }
  await E(() => { const P = window.__KCA.game.renderer.webgl.info.programs; window.__PRK = new Set(P); });
  // programs linked since the last call, with the scene objects that use them (who missed the prewarm)
  const newProgs = () => E(() => {
    const g = window.__KCA.game, W = g.renderer.webgl, K = window.__PRK, fresh = new Set();
    for (const p of W.info.programs) if (!K.has(p)) { K.add(p); fresh.add(p); }
    if (!fresh.size) return [];
    const own = new Map();
    g.renderer.scene.traverse((o) => { const ms = o.material ? [].concat(o.material) : []; for (const m of ms) { const pr = W.properties.get(m); const prog = pr && pr.currentProgram; if (prog && fresh.has(prog)) { let n = o.name || o.type, q = o.parent; for (let d = 0; q && d < 3; d++, q = q.parent) n = (q.name || q.type) + '/' + n; if (!own.has(prog)) own.set(prog, new Set()); own.get(prog).add(`${n}:${m.type}:${m.name}`); } } });
    // diff each fresh key against the closest older key of the same shader name (what parameter changed?)
    const olds = W.info.programs.filter((p) => !fresh.has(p));
    return [...fresh].map((p) => {
      const k = p.cacheKey.split(',');
      let best = null, bd = 1e9;
      for (const o of olds) { const ok = o.cacheKey.split(','); let d = Math.abs(ok.length - k.length); for (let i = 0; i < Math.min(ok.length, k.length); i++) if (ok[i] !== k[i]) d++; if (d < bd) { bd = d; best = ok; best.nm = o.name; } }
      const diff = best ? k.map((v, i) => (v !== best[i] ? `${i}:${String(best[i]).slice(0, 24)}>${String(v).slice(0, 24)}` : null)).filter(Boolean).slice(0, 6).join(' ') : 'no-sibling';
      return `${p.name} {${diff}} ~${best && best.nm} <- ${[...(own.get(p) || [])].slice(0, 3).join(' ; ')}`;
    });
  });
  const R = { url: api.page.url(), stage: N, gpu: await E(() => window.__PERF.gpuAvailable), prewarm: await E(() => window.__KCA.game.prewarmReport || null), phases: [] };

  const profStart = async () => { if (PROF) await cdp.send('Profiler.start'); };
  const profStop = async () => {
    if (!PROF) return null;
    const { profile } = await cdp.send('Profiler.stop');
    return attribute(profile);
  };
  const phase = async (name, ms, { during, prof = true } = {}) => {
    const i0 = await E(() => window.__PERF.frames.length);
    const lt0 = await E(() => window.__PERF.longtasks.length);
    if (prof) await profStart();
    if (during) await during();
    await wait(ms);
    const attr = prof ? await profStop() : null;
    const st = await E(({ i0, lt0, DUMP }) => {
      const F = window.__PERF.frames.slice(i0), P = window.__PERF;
      const q = (arr, p) => { const s = arr.filter((v) => v >= 0).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : -1; };
      const col = (k) => F.map((f) => f[k]);
      const dts = col(1);
      const seg = {}; let nseg = 0;
      for (const f of F) if (f[7]) { nseg++; for (const k in f[7]) seg[k] = (seg[k] || 0) + f[7][k]; }
      for (const k in seg) seg[k] = Math.round((seg[k] / nseg) * 100) / 100;
      const r2 = (v) => Math.round(v * 10) / 10;
      const sorted = dts.slice().sort((a, b) => a - b);
      const lowN = Math.max(1, Math.floor(sorted.length * 0.01));
      const low1 = sorted.slice(-lowN).reduce((s, v) => s + v, 0) / lowN;
      const top = F.map((f, k) => [f[1], k]).sort((a, b) => b[0] - a[0]).slice(0, 6).map(([d, k]) => `${Math.round(d)}ms@${Math.round(F[k][0] - F[0][0])} sim${Math.round(F[k][2])} r${Math.round(F[k][3])} st${F[k][5]}`);
      return {
        frames: F.length, fpsP50: r2(1000 / (q(dts, 0.5) || 16.7)), fps1Low: r2(1000 / (low1 || 16.7)), worstMs: Math.round(sorted[sorted.length - 1] || 0),
        slow22: dts.filter((d) => d > 22).length, slow40: dts.filter((d) => d > 40).length,
        simP50: q(col(2), 0.5), simP95: q(col(2), 0.95), renP50: q(col(3), 0.5), renP95: q(col(3), 0.95),
        gpuP50: q(col(4), 0.5), gpuP95: q(col(4), 0.95), gpuSeg: seg, calls: q(col(6), 0.5), stepsMax: Math.max(0, ...col(5)),
        raw: DUMP ? F.map((f) => [Math.round(f[0] - F[0][0]), f[1], f[2], f[3], f[4], f[5], f[6]]) : undefined,
        longtasks: P.longtasks.slice(lt0).map(([s, d]) => `${d}ms@${Math.round(s - (F[0] ? F[0][0] : s))}`), top,
      };
    }, { i0, lt0, DUMP: process.env.PR_DUMP === '1' });
    st.name = name; if (attr) st.busy = attr; st.newPrograms = await newProgs(); st.guard = await E(() => { const G = window.__KCA.game.renderer.guard; return G ? { ...G.stats, pending: G.pending.size } : null; }); st.drs = await E(() => { const d = window.__KCA.game.renderer.drs; return d ? { scale: d.scale, changes: d.changes } : null; });
    R.phases.push(st); api.log(JSON.stringify(st));
    return st;
  };

  await phase('reveal', 10000);
  if (process.env.PR_EVAL) await api.page.evaluate(process.env.PR_EVAL); // A/B hook (e.g. strip DOM effects)
  await E(() => { const d = window.__KCA.debug; d.god(true); d.pots(1, 9); });
  await phase('combat', Number(process.env.PR_COMBAT || 20000), { prof: process.env.PR_PROFCOMBAT === '1' });
  await E(() => window.__KCA.debug.pots(1, 9));
  if (process.env.PR_CAST !== '0') await phase('castTop', 6000, { during: () => E(() => { const h = window.__KCA.game.world.query({ kind: 'hero' })[0]; return window.__KCA.debug.cast(1, Math.max(1, h ? h.pots : 4)); }) });
  if (process.env.PR_BOSS !== '0') {
    await E(() => { const g = window.__KCA.game; window.__PR = { boss: 0 }; g.bus.on('bossIntro', () => { window.__PR.boss++; }); });
    const i0 = await E(() => window.__PERF.frames.length);
    await profStart();
    await E(() => {
      const g = window.__KCA.game, L = g.levels, last = L.screens.length - 1;
      for (let i = L.screenIndex; i < last; i++) { window.__KCA.debug.kill('enemies'); L.waveActors.clear(); }
      for (const h of g.world.query({ kind: 'hero' })) h.pos.x = L.screens[last].x[0] + 3;
      L.pendingSpawns = 0; L.waveActors.clear(); L.enterScreen(last);
      if (g.cameraRig) g.cameraRig.snap();
      L.waveActors.clear(); L.pendingSpawns = 0; L.waveIndex = (L.screens[last].waves || []).length - 1; L.nextWave();
    });
    let t = 0;
    for (; t < 90000; t += 500) {
      if (await E(() => window.__PR.boss > 0)) break;
      await E(() => { const L = window.__KCA.game.levels; for (const a of L.waveActors) if (a.kind !== 'boss' && a.alive && !(a.def && a.def.boss)) { a.hp = 0; if (a.kill) try { a.kill(); } catch (e) { /* ignore */ } } });
      await wait(500);
    }
    // keep the boss alive for the steady boss-fight window (god-mode bots kill some bosses in seconds)
    const immortal = () => E(() => { for (const a of window.__KCA.game.world.actors) if (a.kind === 'boss' || (a.def && a.def.boss)) { a.maxHp = Math.max(a.maxHp || 0, 99999); a.hp = 99999; } });
    for (let k = 0; k < 16; k++) { await immortal(); await wait(500); }
    const attr = await profStop();
    const bossProgs = await newProgs();
    // reuse the phase stats code on the recorded window
    const iv = setInterval(() => { immortal().catch(() => {}); }, 700);
    const st = await phase('bossFight', 10000);
    clearInterval(iv);
    R.phases.pop();
    const b = await E((i0) => { const F = window.__PERF.frames.slice(i0); return F.length; }, i0);
    api.log(`boss window frames ${b}, intro after ${t} ms`);
    // boss window stats = frames from i0 up to bossFight start
    const bs = await E(({ i0, n }) => {
      const F = window.__PERF.frames.slice(i0, window.__PERF.frames.length - n);
      const d = F.map((f) => f[1]).sort((a, b) => a - b);
      const top = F.map((f, k) => [f[1], k]).sort((a, b) => b[0] - a[0]).slice(0, 6).map(([x, k]) => `${Math.round(x)}ms@${Math.round(F[k][0] - F[0][0])} sim${Math.round(F[k][2])} r${Math.round(F[k][3])} st${F[k][5]}`);
      return { frames: F.length, fpsP50: Math.round(1000 / (d[d.length >> 1] || 16.7)), worstMs: Math.round(d[d.length - 1] || 0), slow40: d.filter((x) => x > 40).length, top };
    }, { i0, n: st.frames });
    bs.name = 'boss'; bs.introAfterMs = t; if (attr) bs.busy = attr; bs.newPrograms = bossProgs; bs.guard = await E(() => { const G = window.__KCA.game.renderer.guard; return G ? { ...G.stats, pending: G.pending.size } : null; });
    bs.longtasks = await E((i0) => { const F = window.__PERF.frames; const t0 = F[i0] ? F[i0][0] : 0; return window.__PERF.longtasks.filter(([s]) => s >= t0).map(([s, d]) => `${d}ms@${Math.round(s - t0)}`); }, i0);
    R.phases.push(bs); api.log(JSON.stringify(bs));
    R.phases.push(st);
  }
  R.errors = await E(() => window.__KCA.info().errors || []);
  R.info = await E(() => { const i = window.__KCA.info(); return { drawCalls: i.drawCalls, triangles: i.triangles, programs: i.programs, geometries: i.geometries, textures: i.textures }; });
  fs.writeFileSync(path.join(api.outDir, 'perfrec.json'), JSON.stringify(R, null, 1));
  await api.page.screenshot({ path: path.join(api.outDir, 'end.png') });
};

/** CPU profile → busy runs > 50 ms with their top inclusive functions. */
export function attribute(profile) {
  const byId = new Map(); for (const n of profile.nodes) byId.set(n.id, n);
  const parent = new Map(); for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const label = (n) => { const f = n.callFrame; const u = (f.url || '').replace(/^.*\/(src|node_modules|@fs)\//, '$1/').replace(/\?.*$/, ''); return `${f.functionName || '(anon)'} ${u}:${f.lineNumber + 1}`; };
  const idle = (n) => { const fn = n.callFrame.functionName; return fn === '(idle)' || fn === '(program)' || fn === '(root)'; };
  const S = profile.samples, D = profile.timeDeltas;
  const runs = []; let cur = null, t = 0;
  for (let i = 0; i < S.length; i++) {
    t += D[i] / 1000;
    const n = byId.get(S[i]);
    if (!idle(n)) { if (!cur) cur = { t0: t, t1: t, samples: [] }; cur.t1 = t; cur.samples.push(S[i]); }
    else if (cur) { if (t - cur.t1 > 3) { runs.push(cur); cur = null; } }
  }
  if (cur) runs.push(cur);
  const out = [];
  for (const r of runs.filter((x) => x.t1 - x.t0 > 50).sort((a, b) => (b.t1 - b.t0) - (a.t1 - a.t0)).slice(0, Number(process.env.ATTR_N || 6))) {
    const incl = new Map(), self = new Map();
    for (const id of r.samples) {
      const seen = new Set();
      let n = byId.get(id); self.set(label(n), (self.get(label(n)) || 0) + 1);
      for (let x = id; x !== undefined; x = parent.get(x)) { const L = label(byId.get(x)); if (!seen.has(L)) { seen.add(L); incl.set(L, (incl.get(L) || 0) + 1); } }
    }
    const top = (m, k) => [...m.entries()].filter(([L]) => !/^\((root|program|idle)\)/.test(L)).sort((a, b) => b[1] - a[1]).slice(0, k).map(([L, c]) => `${c} ${L}`);
    out.push({ ms: Math.round(r.t1 - r.t0), at: Math.round(r.t0), incl: top(incl, 22), self: top(self, 8) });
  }
  // whole-window aggregate (steady-state CPU): inclusive + self top lists, and who calls the hot self functions
  const incl = new Map(), self = new Map(), callers = new Map(); let busy = 0;
  for (const id of S) {
    const n = byId.get(id); if (idle(n)) continue; busy++;
    const L0 = label(n); self.set(L0, (self.get(L0) || 0) + 1);
    const seen = new Set(); const chain = [];
    for (let x = id; x !== undefined; x = parent.get(x)) { const L = label(byId.get(x)); chain.push(L); if (!seen.has(L)) { seen.add(L); incl.set(L, (incl.get(L) || 0) + 1); } }
    const key = L0 + ' <= ' + chain.slice(1, 6).map((c) => c.split(' ')[0]).join(' < ');
    callers.set(key, (callers.get(key) || 0) + 1);
  }
  const top = (m, k) => [...m.entries()].filter(([L]) => !/^\((root|program|idle)\)/.test(L)).sort((a, b) => b[1] - a[1]).slice(0, k).map(([L, c]) => `${c} ${L}`);
  const total = (S.length ? (profile.endTime - profile.startTime) / 1000 : 1);
  out.push({ all: true, ms: Math.round(total), busySamples: busy, incl: top(incl, 45), self: top(self, 25), chains: top(callers, 25) });
  return out;
}
