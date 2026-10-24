// Ogre-kit regression probe (Combat/AI team, Wave C2 r1). Use with a bot hero, e.g.
//   /?mode=showcase&what=ai&id=ogre            (two regular ogres vs the bot)
//   /?mode=stage&stage=1&p1=brann&bot=1&screen=2   (Brute Brothers; wave grunts are killed until the brothers spawn)
// God-mode heroes; runs KIT_SECS (default 60) game seconds and logs, per ogre-family move, how often it started, how
// many grabs lifted a hero (hero entered a grab-victim state), shockwaves, hero hits on ogres (+ highest contact point
// above the ogre's feet) and KOs. Shots at KIT_SHOTS seconds (default "8,20,40"). Writes ogre_kit.json.
import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  const SECS = Number(process.env.KIT_SECS || 60);
  const shots = (process.env.KIT_SHOTS || '8,20,40').split(',').map(Number);
  await api.evalGame(() => {
    const K = window.__KCA, g = K.game;
    K.debug.god(true);
    const fam = (a) => a && (a.typeId === 'ogre' || a.typeId === 'boss_brute');
    const L = window.__ok = { moves: {}, shockwaves: 0, heroStates: {}, hitsOnOgre: 0, maxContactY: 0, headHits: 0, ogreHitsOnHero: 0, kos: 0, ogres: {} };
    g.bus.on('attackStart', (e) => { if (fam(e.actor)) L.moves[e.moveId] = (L.moves[e.moveId] || 0) + 1; });
    g.bus.on('ai:shockwave', () => { L.shockwaves++; });
    g.bus.on('hit', (e) => {
      if (fam(e.target) && e.attacker && e.attacker.kind === 'hero') {
        L.hitsOnOgre++;
        const y = e.point ? e.point.y - (e.target.pos.y || 0) : 0;
        if (y > L.maxContactY) L.maxContactY = Math.round(y * 1000) / 1000;
        if (y > (e.target.height || 2.75) * 0.95) L.headHits++;
      }
      if (fam(e.attacker) && e.target && e.target.kind === 'hero') L.ogreHitsOnHero++;
    });
    g.bus.on('ko', (e) => { if (fam(e.actor)) L.kos++; });
  });
  let t = 0;
  const shotSet = new Set(shots);
  while (t < SECS) {
    await api.advance(1000); t++;
    await api.evalGame(() => {
      const K = window.__KCA, g = K.game, L = window.__ok;
      const foes = g.world.query({ team: 'enemies' });
      const ogres = foes.filter((e) => e.typeId === 'ogre' || e.typeId === 'boss_brute');
      if (!ogres.length && g.mode && g.levels) for (const e of foes) if (e.alive) K.debug.kill(e.id);
      for (const e of ogres) L.ogres[e.id] = { type: e.typeId, tier: e.tier, hp: e.hp, hurtTop: Math.round(e.hurt.h * 100) / 100 };
      for (const h of g.world.query({ kind: 'hero' })) { const s = h.fsm.name; if (/grab|held|thrown|toss|lift/i.test(s)) L.heroStates[s] = (L.heroStates[s] || 0) + 1; }
    });
    if (shotSet.has(t)) await api.shot(`kit_${t}s`);
  }
  const res = await api.evalGame(() => ({ ...window.__ok, errors: window.__KCA.info().errors }));
  api.log('KIT ' + JSON.stringify(res));
  fs.writeFileSync(path.join(api.outDir, 'ogre_kit.json'), JSON.stringify(res, null, 2));
};
