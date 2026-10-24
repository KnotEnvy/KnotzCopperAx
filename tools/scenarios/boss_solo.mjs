// Solo boss difficulty probe (bosses agent). /?mode=stage&stage=<n>&p1=brann&bot=1&screen=<boss screen>&seed=N
// NOGOD=1: real deaths (session.players[0].deaths delta; bots auto-continue). Default: god hero (so the fight always finishes) driven by the hero bot at SKILL (default 1.0); regular wave foes are killed
// until the boss spawns; then the damage the hero WOULD have taken from the boss fight is summed →
// livesLost ≈ dmg / hero maxHp. Writes boss_solo.json { ttk, dmg, maxHp, livesLost, bySource }.
import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  const MAX = Number(process.env.MAX || 200), SKILL = Number(process.env.SKILL || 1);
  await api.evalGame(([skill, nogod]) => {
    const K = window.__KCA, g = K.game; K.debug.god(!nogod);
    for (const h of g.world.query({ kind: 'hero' })) { g.bots.detach(h); g.bots.attach(h, { skill }); }
    const L = window.__bs = { on: false, dmg: 0, hits: 0, src: {}, done: false };
    g.bus.on('hit', (e) => {
      if (!L.on || !e.target || e.target.kind !== 'hero' || !e.attacker || e.attacker.team !== 'enemies') return;
      L.dmg += e.damage || 0; L.hits++; const k = (e.attacker.typeId || '?') + ':' + (e.moveId || '?'); L.src[k] = (L.src[k] || 0) + (e.damage || 0);
    });
    g.bus.on('boss:finaleDone', () => { L.done = true; });
  }, [SKILL, process.env.NOGOD === '1']);
  let spawnT = null;
  for (let i = 0; i < 240 && spawnT === null; i++) {
    await api.advance(500);
    spawnT = await api.evalGame(() => {
      const K = window.__KCA, g = K.game;
      if (g._bossCam || g.world.query({ kind: 'boss' }).length) { window.__bs.on = true; window.__bs.t0 = g.tick / 60; window.__bs.d0 = g.session && g.session.players[0] ? g.session.players[0].deaths : 0; return g.tick / 60; }
      for (const e of g.world.query({ team: 'enemies' })) if (e.alive && !e.inStage) K.debug.kill(e.id);
      return null;
    });
  }
  if (spawnT === null) throw new Error('no boss');
  let t = 0;
  while (t < MAX) { await api.advance(1000); t += 1; if (await api.evalGame(() => window.__bs.done)) break; }
  const res = await api.evalGame(() => { const g = window.__KCA.game, L = window.__bs, h = g.world.query({ kind: 'hero' })[0]; const p0 = g.session && g.session.players[0]; return { deaths: p0 ? p0.deaths - (L.d0 || 0) : null, ttk: +(g.tick / 60 - L.t0).toFixed(1), dmg: Math.round(L.dmg), hits: L.hits, maxHp: h && h.maxHp, livesLost: h ? +(L.dmg / h.maxHp).toFixed(2) : null, done: L.done, bySource: L.src }; });
  api.log(JSON.stringify(res));
  fs.writeFileSync(path.join(api.outDir, 'boss_solo.json'), JSON.stringify(res, null, 2));
};
