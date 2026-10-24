// bosses r6: stage boss → skip to just above the phase threshold, shots after the phase shift.
export default async (api) => {
  await api.evalGame(() => { window.__KCA.debug.god(true); });
  let ok = false;
  for (let i = 0; i < 240 && !ok; i++) {
    await api.advance(500);
    ok = await api.evalGame(() => {
      const K = window.__KCA, g = K.game;
      if (g._bossCam) return true;
      for (const e of g.world.query({ team: 'enemies' })) if (e.alive && !e.inStage) K.debug.kill(e.id);
      return false;
    });
  }
  if (!ok) throw new Error('no boss');
  await api.advance(6000);
  await api.shot('p1');
  await api.evalGame(() => { const g = window.__KCA.game; for (const b of g.world.query({ kind: 'boss' })) b.hp = Math.min(b.hp, Math.ceil(b.maxHp * 0.52)); });
  for (const s of [6, 10, 16]) { await api.advance(s === 6 ? 6000 : (s === 10 ? 4000 : 6000)); await api.shot('p2_' + s); }
  return await api.evalGame(() => { const g = window.__KCA.game; return g.world.query({ kind: 'boss' }).map((b) => ({ hp: b.hp, max: b.maxHp, phase: b.phase, rig: b.lightRig && b.lightRig.k })); });
};
