// First-use hitch probe (chapter1-integration): REALTIME frame-time recording over the three moments that used to
// stall on shader/program compiles and GLB/texture uploads:
//   A. the first 10 s of a stage (from __KCA.ready, i.e. the moment the stage is playable)
//   B. the first spell cast (tier 1, then the top tier)
//   C. the first boss appearance (heroes are moved to the boss screen and its waves are skipped; god mode on)
//   node tools/capture.mjs --realtime --url "/?mode=stage&stage=3&p1=brann&bot=1" --scenario tools/scenarios/warmperf.mjs --out <dir> --timeout 180000
// env: WP_BOSS=0 skips C. Writes warmperf.json: per phase { frames, worstMs, minFps (worst 500 ms window), p50Fps, slow (frames > 22 ms) }.
import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  const E = (fn, arg) => api.evalGame(fn, arg);
  const wait = (ms) => api.page.waitForTimeout(ms);
  await E(() => {
    window.__WP = { t: [], mark: [], lt: [] };
    try { new PerformanceObserver((li) => { for (const e of li.getEntries()) if (e.duration > 100) window.__WP.lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ entryTypes: ['longtask'] }); } catch (e) { /* unsupported */ }
    const loop = (t) => { window.__WP.t.push(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
  const phase = async (name, ms, during) => {
    const i0 = await E(() => window.__WP.t.length);
    if (during) await during();
    await wait(ms);
    return stats(name, i0);
  };
  const stats = (name, i0) => E(({ i0, name }) => {
      const t = window.__WP.t.slice(i0);
      const dts = []; for (let i = 1; i < t.length; i++) dts.push(t[i] - t[i - 1]);
      let minFps = Infinity;
      for (let i = 0; i < t.length; i++) { // frames in each 500 ms window starting at frame i
        let j = i; while (j < t.length && t[j] - t[i] < 500) j++;
        if (j >= t.length) break;
        minFps = Math.min(minFps, (j - i) / ((t[j] - t[i]) / 1000));
      }
      const s = dts.slice().sort((a, b) => a - b);
      const worst = s[s.length - 1] || 0;
      const top = dts.map((d, k) => [Math.round(d), k]).sort((a, b) => b[0] - a[0]).slice(0, 5).map(([d, k]) => `${d}ms@${Math.round(t[k] - t[0])}`);
      const lt = window.__WP.lt.filter(([st]) => st >= t[0] - 50).map(([st, d]) => `${d}ms@${Math.round(st - t[0])}`);
      return { name, lt, frames: t.length, worstMs: Math.round(worst), minFps: Math.round(minFps === Infinity ? 0 : minFps), p50Fps: Math.round(1000 / (s[s.length >> 1] || 16.7)), slow: dts.filter((d) => d > 22).length, top };
    }, { i0, name });
  // Enter the stage the way the arcade does (title → map interlude → stage), so the measurement includes the map-time
  // prefetch and the stage-start prewarm, with the game loop already running (a ?mode=stage direct load starts the
  // loop only after boot and mixes boot compile work into the first seconds).
  const N = Number(process.env.WP_STAGE || 1);
  if (process.env.WP_NOCARD === '1') await E(() => { window.__KCA.game.ui.card = () => null; }); // A/B: DOM card cost
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
  await E(() => { const P = window.__KCA.game.renderer.webgl.info.programs; window.__WP.known = new Set(P); });
  const newProgs = () => E(() => { const P = window.__KCA.game.renderer.webgl.info.programs, K = window.__WP.known, out = []; for (const p of P) if (!K.has(p)) { K.add(p); const k = p.cacheKey.split(','); out.push(`${p.name}[${k[4] || ''}]${k.slice(-1)[0].slice(-40)}`); } return out; });
  const R = { url: api.page.url(), stage: N, prewarm: await E(() => window.__KCA.game.prewarmReport || null), phases: [] };
  const push = async (r) => { r.newPrograms = await newProgs(); R.phases.push(r); api.log(JSON.stringify(r)); };
  await push(await phase('start10s', 10000));
  await E(() => { const d = window.__KCA.debug; d.god(true); d.pots(1, 9); });
  await push(await phase('cast1', 3500, () => E(() => window.__KCA.debug.cast(1, 1))));
  await E(() => window.__KCA.debug.pots(1, 9));
  // who owns programs created during the top-tier cast: sample the scene every 100 ms
  await E(() => { const g = window.__KCA.game, R = g.renderer, K = window.__WP.known, seen = window.__WP.owners = {};
    const iv = setInterval(() => { R.scene.traverse((o) => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; for (const m of ms) { const pr = R.webgl.properties.get(m); const prog = pr && pr.currentProgram; if (prog && !K.has(prog)) { let n = o.name || o.type, p = o.parent; for (let d = 0; p && d < 3; d++, p = p.parent) n = (p.name || p.type) + '/' + n; seen[`${n}:${m.type}:${m.name}`] = 1; } } }); }, 100);
    setTimeout(() => clearInterval(iv), 4400); });
  await push(await phase('castTop', 4500, () => E(() => { const h = window.__KCA.game.world.query({ kind: 'hero' })[0]; return window.__KCA.debug.cast(1, Math.max(1, h ? h.pots : 4)); })));
  R.castOwners = await E(() => Object.keys(window.__WP.owners || {}));
  api.log('castTop owners ' + JSON.stringify(R.castOwners));
  if (process.env.WP_BOSS !== '0') {
    await E(() => { const g = window.__KCA.game; window.__WP.boss = 0; g.bus.on('bossIntro', () => { window.__WP.boss++; }); });
    const i0 = await E(() => window.__WP.t.length);
    await E(() => {
      const g = window.__KCA.game, L = g.levels, last = L.screens.length - 1;
      for (let i = L.screenIndex; i < last; i++) { window.__KCA.debug.kill('enemies'); L.waveActors.clear(); }
      for (const h of g.world.query({ kind: 'hero' })) h.pos.x = L.screens[last].x[0] + 3;
      L.pendingSpawns = 0; L.waveActors.clear(); L.enterScreen(last);
      if (g.cameraRig) g.cameraRig.snap();
      // skip straight to the boss wave (the screen's own waves still trickle in from their timers)
      L.waveActors.clear(); L.pendingSpawns = 0; L.waveIndex = (L.screens[last].waves || []).length - 1; L.nextWave();
    });
    let t = 0;
    for (; t < 90000; t += 500) {
      if (await E(() => window.__WP.boss > 0)) break;
      await E(() => { const L = window.__KCA.game.levels; for (const a of L.waveActors) if (a.kind !== 'boss' && a.alive && !(a.def && a.def.boss)) { a.hp = 0; if (a.kill) try { a.kill(); } catch (e) { /* ignore */ } } });
      await wait(500);
    }
    R.bossAfterMs = t;
    await wait(6000);
    const r = await stats('boss', i0); // from the jump: covers boss spawn (GLB/materials) + intro + first attacks
    r.note = `boss intro ${t} ms after the jump`;
    await push(r);
  }
  if (process.env.WP_CARD === '1') { // DOM stage card cost (forged SVG lettering) — shown again mid-stage
    await push(await phase('idle', 3000));
    await push(await phase('card', 4000, () => E(() => window.__KCA.game.ui.card('STAGE 1', 'The Ashen Wilds', 3.2))));
    await wait(1500);
    await push(await phase('cardNoAnim', 4000, () => E(() => { window.__KCA.game.ui.card('STAGE 1', 'The Ashen Wilds', 3.2); setTimeout(() => document.querySelectorAll('.kca-card animate').forEach((n) => n.remove()), 0); })));
    await wait(1500);
    await push(await phase('cardNoCss', 4000, () => E(() => { window.__KCA.game.ui.card('STAGE 1', 'The Ashen Wilds', 3.2); setTimeout(() => document.querySelectorAll('.kca-card .forge').forEach((n) => { n.style.filter = 'none'; }), 0); })));
    await wait(1500);
    await push(await phase('cardNoSvgFilter', 4000, () => E(() => { window.__KCA.game.ui.card('STAGE 1', 'The Ashen Wilds', 3.2); setTimeout(() => document.querySelectorAll('.kca-card [filter]').forEach((n) => n.removeAttribute('filter')), 0); })));
  }
  R.errors = await E(() => window.__KCA.info().errors || []);
  fs.writeFileSync(path.join(api.outDir, 'warmperf.json'), JSON.stringify(R, null, 1));
  await api.page.screenshot({ path: path.join(api.outDir, 'end.png') });
};
