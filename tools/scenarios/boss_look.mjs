// Boss art look-check in stage (bosses agent): kill the screen's wave foes until the boss spawns, then take shots at
// AT seconds after spawn (default "4,9") with god bots; logs each boss actor's model materials (maps present) so
// untextured/fallback parts show up in the log. Use with /?mode=stage&stage=<n>&...&bot=1&screen=<boss screen>.
export default async (api) => {
  const AT = (process.env.AT || '4,9').split(',').map(Number);
  await api.evalGame(() => window.__KCA.debug.god(true));
  let spawnT = null;
  for (let i = 0; i < 240 && spawnT === null; i++) {
    await api.advance(500);
    spawnT = await api.evalGame(() => {
      const K = window.__KCA, g = K.game;
      const foes = g.world.query({ team: 'enemies' });
      if (g.world.query({ kind: 'boss' }).length || foes.some((e) => e.inStage)) return g.tick / 60;
      if (K.events('waveStart').some((e) => /boss/.test(JSON.stringify(e.summary || '')))) return null;
      for (const e of foes) if (e.alive) K.debug.kill(e.id);
      return null;
    });
  }
  if (spawnT === null) throw new Error('no boss');
  let t = 0;
  for (const s of AT) {
    await api.advance((s - t) * 1000); t = s;
    if (s === AT[0]) {
      const mats = await api.evalGame(() => {
        const g = window.__KCA.game, out = [];
        for (const e of g.world.query({ team: 'enemies' })) {
          const m = {};
          (e.view || e.modelRoot)?.traverse?.((o) => { if (o.isMesh) { const mm = [].concat(o.material); for (const x of mm) m[o.name + ':' + x.name] = [!!x.map, !!x.normalMap, x.color && x.color.getHexString(), x.emissive && x.emissive.getHexString(), +(x.emissiveIntensity || 0).toFixed(2)]; } });
          out.push({ type: e.typeId || e.def?.id, tier: e.tier, asset: e.def?.asset, mats: m });
        }
        return out;
      });
      api.log(JSON.stringify(mats));
    }
    await api.shot('t' + s);
  }
};
