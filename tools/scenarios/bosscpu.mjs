// perf-1650 r4: where does the main-thread JS of a BOSS segment go? Teleports to the stage's boss like the realtime bench,
// lets the intro settle, then measures synchronous sim / system-render / renderer.render ms per frame (median of N frames,
// manual clock, alternating configurations A B A B… so machine drift cancels) with parts switched off:
//   base · noPost (no composer) · noShadow · noEnv · noVfx · noHud · noActors (heroes/enemies invisible)
//   node tools/capture.mjs --url "/?mode=stage&stage=2&p1=brann&bot=1" --scenario tools/scenarios/bosscpu.mjs --out ...    env BC_N=60 BC_ROUNDS=3
export default async function (api) {
  const { page, log, advance } = api;
  const N = Number(process.env.BC_N || 60), ROUNDS = Number(process.env.BC_ROUNDS || 3);
  if (process.env.BC_SMALL) { const [w, h] = process.env.BC_SMALL.split('x').map(Number); await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(800); } // tiny canvas: GPU cost ~0 → CPU-only A/B
  await advance(2500);
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
  await advance(9000); // boss spawn + intro + first seconds of the fight
  await page.evaluate(() => { const g = window.__KCA.game; setInterval(() => { for (const a of g.world.actors) if (a.kind === 'boss' || a.inStage) { a.maxHp = Math.max(a.maxHp || 0, 99999); a.hp = 99999; } }, 300); });
  const res = await page.evaluate(async ({ N, ROUNDS }) => {
    const g = window.__KCA.game, R = g.renderer, W = R.webgl, DT = 1 / 60;
    const med = (a) => { const v = a.slice().sort((x, y) => x - y); return v[v.length >> 1]; };
    const vis = (o, v) => { if (o) o.visible = v; };
    const configs = {
      base: () => () => {},
      noPost: () => { const w = R.postEnabled; R.postEnabled = false; return () => { R.postEnabled = w; }; },
      noShadow: () => { const w = W.shadowMap.enabled; W.shadowMap.enabled = false; return () => { W.shadowMap.enabled = w; }; },
      noPrepass: () => { const p = R.prepass; const w = p && p.enabled; if (p) p.enabled = false; return () => { if (p) p.enabled = w; }; },
      noEnv: () => { const w = R.envGroup.visible; R.envGroup.visible = false; return () => { R.envGroup.visible = w; }; },
      noVfx: () => { const o = g.vfx && g.vfx.group; const w = o && o.visible; vis(o, false); return () => vis(o, w); },
      noActors: () => { const l = g.world.actors.map((a) => [a.view, a.view.visible]); for (const [v] of l) v.visible = false; return () => { for (const [v, w] of l) v.visible = w; }; },
      noHud: () => { const el = document.querySelector('.kca-ui'); const w = el && el.style.display; if (el) el.style.display = 'none'; return () => { if (el) el.style.display = w || ''; }; },
    };
    const out = {};
    for (const k in configs) out[k] = { sim: [], sys: [], ren: [], steps: 0 };
    const perSys = new Map(), subs = [[], [], [], [], []];
    for (let round = 0; round < ROUNDS; round++) {
      for (const k in configs) {
        const undo = configs[k]();
        // warm a few frames so toggled state settles (program guard, freeze)
        for (let i = 0; i < 6; i++) { g._advanceReal(DT); g.renderFrame(0.5, DT); }
        const o = out[k];
        for (let i = 0; i < N; i++) {
          const tk = g.tick;
          const t0 = performance.now(); g._advanceReal(DT);
          const t1 = performance.now();
          g.alpha = Math.min(1, g.acc / DT);
          for (const s of g.systems) { if (!s.render) continue; const ts = performance.now(); try { s.render(g.alpha, DT); } catch (e) { /* ignore */ } if (k === 'base') { const a = perSys.get(s.name || '?') || []; a.push(performance.now() - ts); perSys.set(s.name || '?', a); } }
          const t2 = performance.now();
          R.render(DT);
          const t3 = performance.now();
          if (k === 'base' && R._sub) for (let q = 0; q < 5; q++) subs[q].push(R._sub[q]);
          o.sim.push(t1 - t0); o.sys.push(t2 - t1); o.ren.push(t3 - t2); o.steps += g.tick - tk;
          await new Promise((r) => setTimeout(r, 0)); // let async continuations run like rAF play
        }
        undo();
      }
    }
    const table = {};
    for (const k in out) table[k] = { sim: +med(out[k].sim).toFixed(2), systemsRender: +med(out[k].sys).toFixed(2), rendererRender: +med(out[k].ren).toFixed(2), total: +(med(out[k].sim) + med(out[k].sys) + med(out[k].ren)).toFixed(2) };
    const census = { actors: {}, calls: R.frameInfo.calls, tris: R.frameInfo.triangles, lights: 0 };
    for (const a of g.world.actors) census.actors[a.kind] = (census.actors[a.kind] || 0) + 1;
    R.scene.traverse((o) => { if (o.isLight) census.lights++; });
    const sysTable = [...perSys.entries()].map(([n, a]) => [n, +med(a).toFixed(2)]).sort((a, b) => b[1] - a[1]).slice(0, 10);
    return { table, census, sysTable, subMed: subs.map((a) => +med(a).toFixed(2)) };
  }, { N, ROUNDS });
  log('boss cpu (ms/frame, medians; total = sim + systems.render + renderer.render): ' + JSON.stringify(res.census));
  log('  systems.render by system (base): ' + JSON.stringify(res.sysTable));
  log('  renderer.render sub-steps [patch+look, freeze, guard, scans, draw] (base): ' + JSON.stringify(res.subMed));
  for (const k in res.table) log(`  ${k.padEnd(9)} sim ${res.table[k].sim}  systems.render ${res.table[k].systemsRender}  renderer.render ${res.table[k].rendererRender}  = ${res.table[k].total}`);
}
