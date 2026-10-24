// enemies-ai C2 r2 evidence clip in stage mode (C2 r3: + AI_FIND=sandwich | react, see below; use &botmagic=0 for melee-only bots): optional direct wave start (AI_WAVE=k kills the start screen's earlier
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
  // C2 r3 AI_FIND=sandwich: after the warm-up, step 100 ms at a time (≤ AI_FIND_S s, default 60) until a hero (standing) has a
  // standing foe on EACH side within 0.7–2.6 m of screen x (at his depth ±1.8 m) and at least one more foe standing in frame —
  // the board's "a hero visibly sandwiched while a third circles" — then capture from there. Writes the find into clip_foes.json.
  let found = null;
  if (process.env.AI_FIND === 'sandwich') {
    const lim = Number(process.env.AI_FIND_S || 60) * 10;
    for (let i = 0; i < lim && !found; i++) {
      await api.advance(100);
      found = await E(() => {
        const g = window.__KCA.game, c = g.cameraRig.camera, V = c.position.constructor, w = window.innerWidth;
        c.updateMatrixWorld();
        const NO = ['knockdown', 'down', 'getup', 'thrown', 'grabbed', 'dead', 'bones', 'rise', 'reform', 'enter', 'clinch'];
        const sx = (a) => { const p0 = new V(a.pos.x, a.pos.y + (a.height || 1.8) * 0.55, a.pos.z).project(c), p1 = new V(a.pos.x + 1, a.pos.y + (a.height || 1.8) * 0.55, a.pos.z).project(c); return { x: (p0.x + 1) / 2 * w, ppm: Math.abs(p1.x - p0.x) / 2 * w }; };
        const foes = g.world.query({ team: 'enemies' }).filter((e) => e.alive && e.kind !== 'boss' && e.kind !== 'mount' && e.typeId !== 'thief' && e.pos.y < 0.3 && !(e.fsm && e.fsm.is(...NO)));
        for (const h of g.world.query({ kind: 'hero' })) {
          if (!h.alive || (h.fsm && h.fsm.is(...NO))) continue;
          const hb = sx(h), near = (e) => { const b = sx(e), d = (b.x - hb.x) / hb.ppm; return Math.abs(e.pos.z - h.pos.z) < 1.8 && Math.abs(d) > 0.7 && Math.abs(d) < 2.6 ? Math.sign(d) : 0; };
          const L = foes.filter((e) => near(e) < 0), R = foes.filter((e) => near(e) > 0);
          if (!L.length || !R.length) continue;
          const third = foes.filter((e) => !L.includes(e) && !R.includes(e) && (() => { const b = sx(e); return b.x > 0.06 * w && b.x < 0.94 * w; })());
          if (third.length) return { tick: g.tick, hero: h.id, left: L.map((e) => [e.typeId, e.id, e.fsm.name]), right: R.map((e) => [e.typeId, e.id, e.fsm.name]), third: third.map((e) => [e.typeId, e.id, e.fsm.name]) };
        }
        return null;
      });
    }
    api.log('FIND ' + JSON.stringify(found));
  }
  // C2 r3 AI_FIND=react: step 50 ms at a time until a crowd reaction ('ai:react': an ally floored / thrown by a hero) fires with the
  // reacting foe in frame, then capture from there (the reaction is 13–30 ticks long: it plays in the first frames).
  if (process.env.AI_FIND === 'react') {
    await E(() => { const g = window.__KCA.game; window.__REACT = []; g.bus.on('ai:react', (ev) => window.__REACT.push({ tick: g.tick, id: ev.actor.id, type: ev.actor.typeId, order: ev.order, from: ev.from && ev.from.id, why: ev.why })); });
    const lim = Number(process.env.AI_FIND_S || 60) * 20;
    for (let i = 0; i < lim && !found; i++) {
      await api.advance(50);
      found = await E(() => { const R = window.__REACT, g = window.__KCA.game; const r = R.length && g.tick - R[R.length - 1].tick < 4 ? R[R.length - 1] : null; if (!r) return null; const e = g.world.byId.get(r.id); if (!e) return null; const c = g.cameraRig.camera, V = c.position.constructor; c.updateMatrixWorld(); const x = (new V(e.pos.x, 1, e.pos.z).project(c).x + 1) / 2; return x > 0.08 && x < 0.92 ? { ...r, n: R.length } : null; });
    }
    api.log('FIND ' + JSON.stringify(found));
  }
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
  r.find = found;
  fs.writeFileSync(path.join(api.outDir, 'clip_foes.json'), JSON.stringify(r));
  api.log('CLIP ' + JSON.stringify({ ...r, list: undefined }));
};
