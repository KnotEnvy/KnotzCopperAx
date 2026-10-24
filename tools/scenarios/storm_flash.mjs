// Board-matched stage1 Brann+Gorrim bots; logs global post pulses and spell tiers through the 9s warm + 60×33ms clip.
// STORM_TIER=1|2|3 forces a centred cast after 4s; STORM_SURGE=1 casts Brann alongside Gorrim to exercise Knot Surge.
import fs from 'node:fs';
import path from 'node:path';
export default async api => {
  const tier = Number(process.env.STORM_TIER || 0), surge = process.env.STORM_SURGE === '1';
  await api.evalGame(() => {
    const g = window.__KCA.game, post = g.renderer.post, original = post.pulse.bind(post);
    window.__stormTrace = { pulses: [], casts: [] };
    post.pulse = o => {
      if (o.flash > 0) window.__stormTrace.pulses.push({ tick: g.tick, time: g.time, ...o, stack: new Error().stack });
      return original(o);
    };
    g.bus.on('magicCast', e => window.__stormTrace.casts.push({ tick: g.tick, tier: e.tier, hero: e.hero?.typeId || e.actor?.typeId }));
  });
  await api.advance(tier ? 4000 : 9000);
  if (tier) await api.evalGame(({ tier, surge }) => {
    const K = window.__KCA, g = K.game;
    for (const h of g.world.query({ kind: 'hero' })) { g.bots.detach(h); h.fsm.go('idle'); }
    K.input.releaseAll(); K.debug.god(true);
    if (surge) K.debug.cast(1, 2);
    K.debug.cast(2, tier);
  }, { tier, surge });
  await api.frames(tier ? 150 : 60, 33, 'storm');
  const trace = await api.evalGame(() => ({ ...window.__stormTrace, errors: window.__KCA.info().errors }));
  fs.writeFileSync(path.join(api.outDir, 'storm.json'), JSON.stringify(trace, null, 2));
  api.log(JSON.stringify(trace));
};
