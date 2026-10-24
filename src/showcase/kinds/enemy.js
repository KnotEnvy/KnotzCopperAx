// what=enemy&id=<type>[&tier=rust|violet|iron][&anim=clip][&cam=full|close|game][&yaw=deg]
// __KCA.showcase: actor, play(clip), setYaw(deg), clips() (ARCHITECTURE §6).
export default {
  id: 'enemy',
  async setup(ctx) {
    const { params, game } = ctx;
    const id = params.id || 'marauder';
    ctx.studio();
    const e = await ctx.enemy(id, { x: 0, z: 0, facing: 1, tier: params.get('tier'), puppet: true });
    if (!e) { ctx.label(`enemy '${id}' failed to load`); ctx.orbit({ target: [0, 1, 0], distance: 5 }); return; }
    const H = e.height || 1.8;
    const cams = { full: { target: [0, H * 0.52, 0], distance: H * 2.35 + 1.2, height: 0.25 }, close: { target: [0, H * 0.72, 0], distance: H * 1.35, height: 0.1 } };
    if (params.cam === 'game') ctx.gameCam([e]); else ctx.orbit({ ...(cams[params.cam] || cams.full), fov: 30 });
    ctx.turntable(e, params.get('yaw') !== null ? { yaw: Number(params.get('yaw')) } : params.get('spin', '1') === '0' ? { yaw: 35 } : { speed: 20 });
    const clip = params.anim || 'idle';
    e.play(clip, { loop: true, fade: 0 });
    ctx.label(`${e.def.name || id}${params.get('tier') ? ' · ' + params.get('tier') : ''} · ${clip}`);
    ctx.expose({
      actor: e,
      play: (c, o = {}) => { e.play(c, { loop: true, restart: true, fade: 0.1, ...o }); ctx.label(`${e.def.name || id} · ${c}`); return true; },
      setYaw: (d) => { ctx.turntable(e, { yaw: d }); return d; },
      clips: () => (game.anim ? game.anim.names({ rig: (e.model && e.model.rig) || 'humanoid', character: id }) : []),
    });
  },
};
