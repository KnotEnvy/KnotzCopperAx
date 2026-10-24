// enemies-ai C2 r2 diagnostic: per-foe trace in stage mode (every AI_EVERY ticks): state, brain mode, why, its hero,
// dx/dz to the hero, hero frame fraction, hero state, foe frame inset (C2 r3: + cooldown, overdue, hasAtk, af reason (diagAtk), heat, x). Writes ai_trace.json. Env AI_SECONDS, AI_FLAGS, AI_IDS.
import fs from 'node:fs';
import path from 'node:path';
export default async (api) => {
  const secs = Number(process.env.AI_SECONDS || 60), every = Number(process.env.AI_EVERY || 10);
  const E = (fn, arg) => api.evalGame(fn, arg);
  if (process.env.AI_FLAGS) await E((f) => Object.assign(window.__KCA.game.ai.director, f), JSON.parse(process.env.AI_FLAGS));
  const wave = Number(process.env.AI_WAVE || 0);
  if (wave > 0) {
    await E(() => { const k = window.__KCA; if (k.debug && k.debug.god) k.debug.god(true); });
    for (let i = 0; i < 60; i++) {
      await api.advance(500);
      if ((await E(() => window.__KCA.game.levels.waveIndex)) >= wave) break;
      if (i >= 3) await E(() => { const g = window.__KCA.game; for (const e of g.world.query({ team: 'enemies' })) if (e.alive && e.kind !== 'boss' && e.typeId !== 'thief' && !e.mountedOn && e.kind !== 'mount' && !(e.fsm && e.fsm.is('enter'))) window.__KCA.debug.kill(e.id); });
    }
  }
  await E((ev) => {
    const k = window.__KCA, g = k.game; if (k.debug && k.debug.god) k.debug.god(true);
    const T = (window.__TR = []), t0 = g.tick;
    const vr = (z) => { const c = g.cameraRig.camera, V = c.position.constructor; c.updateMatrixWorld(); const p0 = new V(c.position.x, 0, z).project(c).x, p1 = new V(c.position.x + 1, 0, z).project(c).x, sl = p1 - p0; return { a: c.position.x + (-1 - p0) / sl, b: c.position.x + (1 - p0) / sl }; };
    g.addSystem({ name: 'trace', order: 99, update() {
      if ((g.tick - t0) % ev) return;
      const hs = g.world.query({ kind: 'hero' }).map((h) => { const v = vr(h.pos.z); return [h.id, +h.pos.x.toFixed(2), +h.pos.z.toFixed(2), +((h.pos.x - v.a) / (v.b - v.a)).toFixed(2), h.fsm.name]; });
      const fs2 = g.world.query({ team: 'enemies' }).filter((e) => e.alive && e.brain && e.kind !== 'boss').map((e) => { const t = e.aiTarget, v = vr(e.pos.z); const row = [e.id, e.fsm.name, e.brain.mode, e.aiWhy || '', t ? t.id : 0, t ? +(e.pos.x - t.pos.x).toFixed(2) : 0, t ? +(e.pos.z - t.pos.z).toFixed(2) : 0, +Math.min(e.pos.x - v.a, v.b - e.pos.x).toFixed(2), e.aiCrossing ? 1 : 0, e.aiSlot ? e.aiSlot.side : 0, g.ai.tokens && g.ai.tokens.has(e) ? 1 : 0, e.brain.cooldown | 0, e.aiOverdue ? 1 : 0, e.aiHasAtk ? 1 : 0, e.aiAf || '', +(g.ai.director.heat(t) || 0).toFixed(2), +(e.pos.x).toFixed(1), e.aiSlot && e.aiSlot.flank ? 1 : 0]; e.aiAf = ''; return row; });
      T.push([g.tick - t0, hs, fs2]);
    } });
  }, every);
  for (let t = 0; t < secs * 1000; t += 5000) await api.advance(5000);
  const r = await E(() => window.__TR);
  fs.writeFileSync(path.join(api.outDir, 'ai_trace.json'), JSON.stringify(r));
  api.log('TRACE ' + r.length);
};
