// Boss-time shader links (bosses C2 r1): records renderer.info.programs right before the boss wave spawns and again
// AFTER s later; prints every program linked in between (name + a short cache-key tag). With the stage prewarm on, a
// boss spawn should link none. Use with /?mode=stage&stage=<n>&p1=brann&p2=gorrim&bot=1&screen=<boss screen>.
export default async (api) => {
  const AFTER = Number(process.env.AFTER || 10);
  await api.evalGame(() => window.__KCA.debug.god(true));
  const snap = () => api.evalGame(() => {
    const g = window.__KCA.game, P = g.renderer.webgl.info.programs || [];
    return P.map((p) => ({ id: p.id, name: p.name, key: String(p.cacheKey).slice(0, 40).replace(/\s+/g, ' '), tags: (String(p.cacheKey).match(/\|[A-Za-z]+[0-9a-z]*/g) || []).join('') }));
  });
  let before = null, spawned = false;
  for (let i = 0; i < 240 && !spawned; i++) {
    await api.advance(500);
    const st = await api.evalGame(() => {
      const K = window.__KCA, g = K.game;
      if (g._bossCam || g.world.query({ kind: 'boss' }).length) return 'boss';
      const foes = g.world.query({ team: 'enemies' }).filter((e) => e.alive);
      for (const e of foes) K.debug.kill(e.id);
      return foes.length;
    });
    if (st === 'boss') spawned = true; else before = await snap();
  }
  if (!spawned) throw new Error('no boss');
  await api.advance(AFTER * 1000);
  const after = await snap();
  const ids = new Set((before || []).map((p) => p.id));
  const fresh = after.filter((p) => !ids.has(p.id));
  api.log(`programs before ${before ? before.length : '?'} after ${after.length} new ${fresh.length}`);
  for (const p of fresh) api.log(`NEW ${p.name} ${p.tags} :: ${p.key}`);
  await api.shot('after');
};
