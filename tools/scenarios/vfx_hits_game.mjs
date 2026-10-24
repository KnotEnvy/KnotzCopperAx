// Natural bot brawl AFTER the stage intro. Must run with --warm 8000 and bot=1.
// URL /?mode=stage&stage=2&p1=brann&p2=seraphine&bot=1&seed=1&drs=0
// Captures 120 x33ms (4s); event log proves real CombatSystem contacts, not synthetic spawned effects.
import fs from 'node:fs';
import path from 'node:path';
export default async (api) => {
  await api.evalGame(() => {
    const k = window.__KCA;
    window.__hitEvidence = [];
    k.game.bus.on('hit', e => window.__hitEvidence.push({ tick:k.game.tick, time:k.game.time,
      moveId:e.moveId, level:e.level, blocked:!!e.blocked, killed:!!e.killed,
      attacker:e.attacker?.typeId, target:e.target?.typeId, hp:e.target?.hp,
      point:e.point && {...e.point}, kind:e.kind, knockdown:e.knockdown, element:e.hit?.element }));
  });
  let seen = 0, light = false;
  for (let i = 0; i < 120; i++) {
    await api.frames(1, 33, 'brawl');
    const hits = await api.evalGame(() => window.__hitEvidence);
    if (hits.length > seen) {
      const fresh = hits.slice(seen);
      api.log({frame:i,hits:fresh});
      await api.shot(`hit_${String(i).padStart(3,'0')}_${fresh.at(-1).moveId}`);
      if (!light && fresh.some(h => h.level === 'light' && !h.blocked && !h.killed && !h.knockdown)) {
        await api.shot('light_gameplay'); light = true;
      }
      seen = hits.length;
    }
  }
  const hits = await api.evalGame(() => window.__hitEvidence);
  fs.writeFileSync(path.join(api.outDir,'connecting-hits.json'), JSON.stringify(hits,null,2));
  if (!hits.some(h=>!h.blocked)) throw new Error('No real connecting hits in clip');
  if (!light) api.log('No clean light contact in this run; inspect contact kinds in connecting-hits.json');
  api.log(`Verified ${hits.length} real hits; light still ${light}`);
};
