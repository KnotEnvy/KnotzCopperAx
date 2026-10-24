// In-game spell check (owner: magic-vfx). Use with /?mode=stage&stage=1&p1=<hero>&bot=1 (&p2=<hero> for Knot Surge).
// Waits for a wave of enemies, casts the top tier (window.__magicTier overrides) through the real input path's
// debug hook, records frames and verifies canon damage + perf numbers. Writes magic.json.
import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  const E = (fn, a) => api.evalGame(fn, a);
  await E(() => { window.__KCA.debug.god(true); });
  // walk until a few enemies are on screen
  for (let i = 0; i < 40; i++) {
    const n = await E(() => window.__KCA.game.world.query({ team: 'enemies' }).filter((e) => e.alive !== false).length);
    if (n >= 3) break;
    await api.hold(1, 'right', true); await api.advance(250);
  }
  await api.hold(1, 'right', false);
  await api.advance(600);
  const before = await E(() => window.__KCA.game.world.query({ team: 'enemies' }).map((e) => ({ id: e.id, hp: e.hp })));
  const tier = await E(() => window.__magicTier || window.__KCA.game.world.query({ kind: 'hero' })[0].maxTier);
  const t0 = await E(() => window.__KCA.game.tick);
  await E((t) => window.__KCA.debug.cast(1, t), tier);
  const surge = await E(() => new URLSearchParams(location.search).get('p2'));
  if (surge) { await api.advance(150); await E(() => window.__KCA.debug.cast(2, 2)); }
  let maxCalls = 0, maxTris = 0;
  for (let i = 0; i < 80; i++) {
    await api.advance(50);
    const inf = await E(() => { const i = window.__KCA.info(); const c = window.__KCA.game.magic.cutIn; return { d: i.drawCalls + (c && c.active ? c.lastCalls : 0), t: i.triangles }; });
    maxCalls = Math.max(maxCalls, inf.d); maxTris = Math.max(maxTris, inf.t);
    if (i % 6 === 0) await api.shot(`cast_${String(i).padStart(2, '0')}`);
  }
  const after = await E(() => window.__KCA.game.world.query({ team: 'enemies' }).map((e) => ({ id: e.id, hp: e.hp })));
  const hits = await E((t) => window.__KCA.events('hit', t).filter((e) => e.level === 'magic').length, t0);
  const dmg = before.map((b) => { const a = after.find((x) => x.id === b.id); return Math.round((b.hp - (a ? a.hp : 0)) * 100) / 100; });
  const R = { tier, surge: !!surge, enemies: before.length, damage: dmg, magicHits: hits, maxDrawCalls: maxCalls, maxTriangles: maxTris };
  fs.writeFileSync(path.join(api.outDir, 'magic.json'), JSON.stringify(R, null, 1));
  api.log(JSON.stringify(R));
};
