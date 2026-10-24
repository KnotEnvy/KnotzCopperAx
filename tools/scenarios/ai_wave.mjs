// Real-stage wave spacing audit (enemies-ai r5b): runs a stage with the hero bot and samples every 6 ticks for
// on-screen screen-x clumps among standing foes (arrivals included, not just contact frames).
//   node tools/capture.mjs --url "/?mode=stage&stage=1&p1=brann&bot=1&capture=1" --scenario tools/scenarios/ai_wave.mjs --out <dir>
// Env: AI_SECONDS (default 40). Writes ai_wave.json:
//   frames2      sampled frames with ≥ 2 standing on-screen foes
//   pairX08      …of those, frames with two foes < 0.8 m apart in x (and < 3.4 m in depth = overlapping on screen)
//   pairX05      …frames with a pair < 0.5 m x (fused)
//   pairS08/05   same on perspective-true screen x (what the player sees; depth shifts bodies toward frame centre)
//   enterX08     pairX08 frames where one of the pair is still walking in (fsm 'enter')
//   worst        samples; director stats entryLanes / entryStagger
import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  const secs = Number(process.env.AI_SECONDS || 40);
  const E = (fn, arg) => api.evalGame(fn, arg);
  if (process.env.AI_FLAGS) await E((f) => Object.assign(window.__KCA.game.ai.director, f), JSON.parse(process.env.AI_FLAGS)); // r6 A/B director hooks
  if (process.env.AI_NOENTRY) await E(() => { window.__KCA.game.ai.director.noEntryLanes = true; }); // A/B r5b entry lanes
  await E((process_env_all) => {
    const k = window.__KCA, g = k.game;
    if (k.debug && k.debug.god) k.debug.god(true);
    const S = (window.__WAVE = { frames: 0, frames2: 0, pairX08: 0, pairX05: 0, enterX08: 0, worst: [], cause: {} });
    const STAND = (e) => e.alive && !e.removed && e.kind !== 'boss' && e.kind !== 'mount' && !e.mountedOn && !e.riding && e.pos.y < 0.5 && !(e.fsm && e.fsm.is('thrown', 'grabbed', 'clinch', 'bones', 'rise', 'down', 'knockdown', 'getup', 'dead'));
    const sample = () => {
      if (g.tick % 6) return;
      S.frames++;
      const vr = g.cameraRig && g.cameraRig.visibleRange ? g.cameraRig.visibleRange(0) : { xMin: -9, xMax: 9 };
      const fs = g.world.query({ team: 'enemies' }).filter((e) => STAND(e) && e.pos.x > vr.xMin - 0.3 && e.pos.x < vr.xMax + 0.3);
      if (fs.length < 2) return;
      S.frames2++;
      let mx = 99, pair = null;
      for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) {
        const a = fs[i], b = fs[j];
        if (Math.abs(a.pos.z - b.pos.z) >= 3.4) continue;
        const d = Math.abs(a.pos.x - b.pos.x);
        if (d < mx) { mx = d; pair = [a, b]; }
      }
      if (mx < 0.8) {
        S.pairX08++;
        const tag = (e) => e.fsm.name + '/' + (e.brain && e.brain.mode);
        const key = pair.map(tag).sort().join(' + ');
        S.cause[key] = (S.cause[key] || 0) + 1;
        if (pair.some((e) => e.fsm.is('enter'))) S.enterX08++;
        if (S.worst.length < 10 && (g.tick % 60 === 0 || process_env_all)) S.worst.push({ tick: g.tick, dx: +mx.toFixed(2), hero: g.world.query({ kind: 'hero' }).map((h) => [+h.pos.x.toFixed(2), +h.pos.z.toFixed(2)]), foes: pair.map((e) => [e.typeId, e.fsm.name, e.brain && e.brain.mode, +e.pos.x.toFixed(2), +e.pos.z.toFixed(2), e.desired && e.desired.active ? [+e.desired.x.toFixed(2), +e.desired.z.toFixed(2)] : null]) });
      }
      if (mx < 0.5) S.pairX05++;
      // perspective-true screen x (metres on the z=0 plane): at the frame edges depth shifts bodies toward the centre
      const c = g.cameraRig && g.cameraRig.camera;
      if (c) {
        const P = (e) => { const d = c.position.z - e.pos.z; return c.position.x + (e.pos.x - c.position.x) * c.position.z / d; };
        let ms = 99;
        for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) ms = Math.min(ms, Math.abs(P(fs[i]) - P(fs[j])));
        if (ms < 0.8) {
          S.pairS08 = (S.pairS08 || 0) + 1;
          for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) {
            if (Math.abs(P(fs[i]) - P(fs[j])) >= 0.8) continue;
            const tg = (e) => e.typeId[0] + ':' + e.fsm.name + '/' + (e.brain && e.brain.mode);
            const key = [tg(fs[i]), tg(fs[j])].sort().join(' + ');
            (S.causeS = S.causeS || {})[key] = (S.causeS[key] || 0) + 1;
            if ((S.worstS = S.worstS || []).length < 6 && g.tick % 30 === 0) S.worstS.push({ tick: g.tick, cam: +c.position.x.toFixed(1), p: [fs[i], fs[j]].map((e) => [e.typeId, e.fsm.name, +e.pos.x.toFixed(2), +e.pos.z.toFixed(2), +P(e).toFixed(2)]) });
          }
        }
        if (ms < 0.5) S.pairS05 = (S.pairS05 || 0) + 1;
      }
    };
    const sys = { name: 'wave-probe', order: 99, update: sample };
    if (g.addSystem) g.addSystem(sys); else if (g.systems) g.systems.push(sys);
  }, !!process.env.AI_ALLWORST);
  const step = 5000;
  for (let t = 0; t < secs * 1000; t += step) await api.advance(step);
  const r = await E(() => {
    const g = window.__KCA.game, S = window.__WAVE, st = g.ai && g.ai.director ? g.ai.director.stats : {};
    return { ...S, entryLanes: st.entryLanes || 0, entryStagger: st.entryStagger || 0, stage: g.level && g.level.screenIndex, pct08: S.frames2 ? +(S.pairX08 / S.frames2 * 100).toFixed(1) : 0 };
  });
  api.log('WAVE ' + JSON.stringify(r).slice(0, 1800));
  fs.writeFileSync(path.join(api.outDir, 'ai_wave.json'), JSON.stringify(r, null, 2));
  await api.shot('wave_end');
};
