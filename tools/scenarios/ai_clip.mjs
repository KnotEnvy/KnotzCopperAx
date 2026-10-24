// enemies-ai C2 r2 evidence clip in stage mode: optional direct wave start (AI_WAVE=k kills the start screen's earlier
// waves off, like ai_stage.mjs), AI_WARM ms of play, then AI_FRAMES frames every AI_STEP ms (use with --sheet --mp4).
// Writes clip_foes.json: per captured frame, every live foe's state, screen centre x (px), inset from the nearest frame
// edge (px) and whether it was hit that frame (so "every struck foe inside the frame" can be checked), plus the heroes.
//   AI_WAVE=1 AI_WARM=4000 AI_FRAMES=180 node tools/capture.mjs --url "/?mode=stage&stage=2&p1=gorrim&p2=brann&bot=1" \
//     --scenario tools/scenarios/ai_clip.mjs --sheet --mp4 --keep-frames --out <dir>
import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  const E = (fn, arg) => api.evalGame(fn, arg);
  const wave = Number(process.env.AI_WAVE || 0), warm = Number(process.env.AI_WARM || 4000);
  const n = Number(process.env.AI_FRAMES || 180), step = Number(process.env.AI_STEP || 33);
  await E(() => { const k = window.__KCA; if (k.debug && k.debug.god) k.debug.god(true); });
  if (wave > 0) {
    for (let i = 0; i < 60; i++) {
      await api.advance(500);
      if ((await E(() => window.__KCA.game.levels.waveIndex)) >= wave) break;
      if (i >= 3) await E(() => { const g = window.__KCA.game; for (const e of g.world.query({ team: 'enemies' })) if (e.alive && e.kind !== 'boss' && e.typeId !== 'thief' && !e.mountedOn && e.kind !== 'mount' && !(e.fsm && e.fsm.is('enter'))) window.__KCA.debug.kill(e.id); });
    }
  }
  if (warm > 0) await api.advance(warm);
  await E(() => {
    const g = window.__KCA.game, R = (window.__CLIP = { frames: [], hits: [] });
    g.bus.on('hit', (ev) => { if (ev.target && ev.target.team === 'enemies' && ev.attacker && ev.attacker.kind === 'hero') R.hits.push([g.tick, ev.target.id]); });
    R.sample = () => {
      const c = g.cameraRig.camera, V = c.position.constructor, w = window.innerWidth;
      c.updateMatrixWorld();
      const sx = (a) => (new V(a.pos.x, a.pos.y + (a.height || 1.8) * 0.55, a.pos.z).project(c).x + 1) / 2 * w;
      const hit = new Set(R.hits.filter((h) => g.tick - h[0] < 3).map((h) => h[1]));
      R.frames.push({ tick: g.tick, heroes: g.world.query({ kind: 'hero' }).map((h) => [h.id, Math.round(sx(h)), h.fsm.name]),
        foes: g.world.query({ team: 'enemies' }).filter((e) => e.alive && e.kind !== 'boss' && e.kind !== 'mount').map((e) => { const x = sx(e); return [e.typeId, e.id, e.fsm.name, Math.round(x), Math.round(Math.min(x, w - x)), hit.has(e.id) ? 1 : 0]; }) });
    };
  });
  for (let i = 0; i < n; i++) { await api.frames(1, step); await E(() => window.__CLIP.sample()); } // sampled at the screenshot's tick
  const r = await E(() => { const R = window.__CLIP, w = window.innerWidth, lim = 90 / 1600 * w; let struck = 0, struckIn = 0, anyCut = 0; for (const f of R.frames) { let cut = false; for (const e of f.foes) { if (e[2] !== 'enter' && e[4] < lim) cut = true; if (e[5]) { struck++; if (e[4] >= lim) struckIn++; } } if (cut) anyCut++; } return { w, frames: R.frames.length, struckFoeFrames: struck, struckInside90px: struckIn, framesAnyFoeWithin90px: anyCut, minStruckInsetPx: Math.min(...R.frames.flatMap((f) => f.foes.filter((e) => e[5]).map((e) => e[4])), 9999), list: R.frames }; });
  fs.writeFileSync(path.join(api.outDir, 'clip_foes.json'), JSON.stringify(r));
  api.log('CLIP ' + JSON.stringify({ ...r, list: undefined }));
};
