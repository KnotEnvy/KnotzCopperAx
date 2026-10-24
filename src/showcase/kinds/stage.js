// what=stage&id=<stage1..5|bonus|duel|test>&cam=<fly|game|wide|high>[&x=N][&hero=brann][&script=1]
// Environment flythrough or fixed camera. With script=1 the wave script runs (enemies appear).
export default {
  id: 'stage',
  async setup(ctx) {
    const { params, game } = ctx;
    const id = params.id || 'stage1';
    const mod = await ctx.stage(id, { script: params.bool('script') });
    const x = Number(params.get('x', String((mod.playerStart && mod.playerStart.x) || 2)));
    const heroId = params.get('hero', 'brann');
    let h = null;
    if (heroId !== 'none') h = await ctx.hero(heroId, { x, z: 0, puppet: !params.bool('script') });
    const cam = params.cam || 'game';
    const rig = game.cameraRig;
    if (cam === 'fly') {
      const ext = game.world.extents;
      const x0 = ext.xMin + 6, x1 = Math.max(x0 + 10, ext.xMax - 6);
      const o = ctx.orbit({ target: [x0, 1.2, 0], distance: 17, height: 5, fov: 32 });
      let t = 0;
      ctx.every(1 / 60, () => { t += 1 / 60; const u = (Math.sin(t * 0.12 - Math.PI / 2) + 1) / 2; o.target.x = x0 + (x1 - x0) * u; o.yaw = Math.sin(t * 0.2) * 0.12; });
    } else if (cam === 'wide') {
      ctx.orbit({ target: [x + 6, 2, -4], distance: 34, height: 9, fov: 34 });
    } else if (cam === 'high') {
      ctx.orbit({ target: [x + 4, 0, 0], distance: 16, height: 16, fov: 36 });
    } else {
      rig.manual = false;
      rig.follow(h ? [h] : []);
      if (!h) rig.focus.set(x, 0, 0);
      rig.snap();
    }
    ctx.label(`${mod.name} · cam ${cam}`);
    ctx.expose({ stage: mod.id });
  },
};
