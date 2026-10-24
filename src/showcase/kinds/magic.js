// what=magic&id=<hero>&tier=N — casts the hero's spell at tier N against a group of marauders (repeats).
// &p2=<hero> adds a second hero who casts 0.2 s later → Knot Surge team spell.
export default {
  id: 'magic',
  async setup(ctx) {
    const { params, game } = ctx;
    const id = params.id || 'brann';
    const tier = Math.max(1, params.tier || 1);
    await ctx.stage(params.get('stage', 'stage1'));
    const h = await ctx.hero(id, { x: 1, z: 0 });
    h.godMode = true;
    const foes = [];
    const spawnFoes = async () => {
      for (const [x, z] of [[3.8, 0.6], [5.2, -0.9], [6.6, 0.3], [-2.6, 0.8], [8.2, -1.3], [-4.2, -0.6]]) {
        const e = await ctx.enemy('marauder', { x, z, facing: -1 });
        if (e) { e.brain = null; foes.push(e); }
      }
    };
    await spawnFoes();
    ctx.gameCam([h], { lock: [-6, 14] });
    let h2 = null;
    if (params.get('p2')) { h2 = await ctx.hero(params.get('p2'), { x: -1, z: 1.2 }); if (h2) h2.godMode = true; }
    const cast = () => { h.castMagic(tier); if (h2) ctx.after(0.2, () => h2.castMagic(Math.min(tier, 3))); };
    ctx.after(0.6, cast);
    ctx.every(Math.max(7, 5 + tier * 1.2), async () => { for (const f of foes) if (!f.removed) f.remove(); foes.length = 0; await spawnFoes(); ctx.after(0.5, cast); });
    ctx.label(`${h.def.name} · magic tier ${tier}`);
    ctx.expose({ actor: h, cast: (t = tier) => h.castMagic(t) });
  },
};
