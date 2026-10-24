// Transition hitch probe (perf-1650 r2): stage N (arcade entry) → jump to the boss → kill it → tally → next entry
// (camp or map → stage N+1). Logs every longtask and frame > 50 ms with the flow state it happened in.
//   TS_STAGE=1 node tools/capture.mjs --realtime --size 1920x1080 --host http://127.0.0.1:4167 --url "/?mode=title&mute" \
//     --scenario tools/scenarios/transit.mjs --out <dir> --timeout 180000
import fs from 'node:fs';
import path from 'node:path';
import { attribute } from './perfrec.mjs';
export default async (api) => {
  const E = (fn, arg) => api.evalGame(fn, arg);
  const wait = (ms) => api.page.waitForTimeout(ms);
  const N = Number(process.env.TS_STAGE || 1);
  const cdp = await api.page.context().newCDPSession(api.page);
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
  await E(() => { const P = window.__PERF; P.gpuOn = false; P.start(); });
  await E((n) => {
    const g = window.__KCA.game, f = g.flow;
    g.session.reset(); g.session.join(0, 'brann', { bot: true }); g.session.autoContinue = true;
    f.mode = 'arcade'; f.seqIndex = ['1', 'bonus', '2', 'bonus', '3', 'bonus', '4', 'bonus', '5'].indexOf(String(n));
    f.go('map', { from: n - 1, to: n, then: { stage: String(n), players: [{ player: 0, heroId: 'brann', bot: true, magic: 3 }] } });
  }, N);
  for (let t = 0; t < 240000; t += 250) { if (await E((n) => { const g = window.__KCA.game; return g.flow.state === 'stage' && g.levels.phase === 'fight' && g.levels.stage && g.levels.stage.id === `stage${n}`; }, N)) break; await wait(250); }
  await wait(3000);
  // state log: every 100 ms record flow state/stage/phase with a timestamp (to label hitches)
  await E(() => { const g = window.__KCA.game; window.__TS = []; window.__PW = []; g.bus.on('prewarm:done', (r) => window.__PW.push({ ...r, programs: g.renderer.webgl.info.programs.length })); const P = window.__PERF; P.frames.length = 0; P.longtasks.length = 0; window.__TSiv = setInterval(() => { const s = `${g.flow.state}:${g.levels.stage ? g.levels.stage.id : '-'}:${g.levels.phase || '-'}`; const L = window.__TS; if (!L.length || L[L.length - 1][1] !== s) L.push([Math.round(performance.now()), s]); }, 50); window.__KCA.debug.god(true); });
  await E(() => {
    const g = window.__KCA.game, L = g.levels, last = L.screens.length - 1;
    for (let i = L.screenIndex; i < last; i++) { window.__KCA.debug.kill('enemies'); L.waveActors.clear(); }
    for (const h of g.world.query({ kind: 'hero' })) h.pos.x = L.screens[last].x[0] + 3;
    L.pendingSpawns = 0; L.waveActors.clear(); L.enterScreen(last);
    if (g.cameraRig) g.cameraRig.snap();
    L.waveActors.clear(); L.pendingSpawns = 0; L.waveIndex = (L.screens[last].waves || []).length - 1; L.nextWave();
  });
  // wait for the boss, let it fight 4 s, then kill every foe until the stage clears
  for (let t = 0; t < 60000; t += 500) { if (await E(() => window.__KCA.game.world.actors.some((a) => a.kind === 'boss' || (a.def && a.def.boss)))) break; await wait(500); }
  await wait(4000);
  const t0 = Date.now();
  if (process.env.TS_PROF !== '0') await cdp.send('Profiler.start');
  for (; Date.now() - t0 < 90000;) {
    const st = await E(() => { const g = window.__KCA.game; for (const a of g.world.actors) if ((a.kind === 'enemy' || a.kind === 'boss') && a.alive) { a.hp = 0; try { if (a.kill) a.kill(); } catch (e) { /* ignore */ } } return g.flow.state; });
    if (st !== 'stage') break;
    await wait(400);
  }
  // then sit through tally (press through) and the next entry until it is fighting/playing for 5 s
  let done = 0;
  for (let t = 0; t < 120000 && done < 5000; t += 500) {
    const s = await E(() => { const g = window.__KCA.game; return { st: g.flow.state, ph: g.levels.phase, id: g.levels.stage && g.levels.stage.id }; });
    if (s.st === 'tally' || s.st === 'map') await api.press(0, 'attack', 60).catch(() => {});
    if (s.st === 'stage' && s.id !== `stage${N}` && (s.ph === 'fight' || s.ph === 'go' || s.ph === 'play')) done += 500;
    await wait(500);
  }
  let busy = null;
  if (process.env.TS_PROF !== '0') { const { profile } = await cdp.send('Profiler.stop'); busy = attribute(profile).filter((r) => !r.all).map((r) => ({ ...r, at: r.at })); }
  const R = await E(() => {
    clearInterval(window.__TSiv);
    const P = window.__PERF, L = window.__TS;
    const lab = (t) => { let s = '?'; for (const [u, v] of L) if (u <= t) s = v; return s; };
    return { states: L.map(([t, s]) => `${t} ${s}`), longtasks: P.longtasks.map(([s, d]) => `${d}ms@${s} [${lab(s)}]`), slow: P.frames.filter((f) => f[1] > 50).map((f) => `${Math.round(f[1])}ms@${Math.round(f[0])} [${lab(f[0])}]`), errors: window.__KCA.info().errors || [], prewarm: window.__PW };
  });
  R.busy = busy; R.profT0 = await E(() => 0);
  api.log(JSON.stringify(R.states));
  fs.writeFileSync(path.join(api.outDir, 'transit.json'), JSON.stringify(R, null, 1));
};
