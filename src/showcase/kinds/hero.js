// what=hero&id=<brann|seraphine|gorrim>&anim=<clip>[&cam=full|close|face|feet|game][&yaw=deg][&spin=0]
// Hero on a lit plinth playing a clip (default idle). __KCA.showcase.play(clip), .setYaw(deg), .clips()
export default {
  id: 'hero',
  async setup(ctx) {
    const { params, game } = ctx;
    const id = params.id || 'brann';
    ctx.studio();
    const h = await ctx.hero(id, { x: 0, z: 0, puppet: true });
    const H = h.height || 1.8;
    const cams = {
      full: { target: [0, H * 0.52, 0], distance: H * 2.35 + 1.2, height: 0.25, fov: 30 },
      close: { target: [0, H * 0.72, 0], distance: H * 1.35, height: 0.1, fov: 30 },
      face: { target: [0, H * 0.9, 0], distance: 1.3, height: 0.02, fov: 28 },
      feet: { target: [0, 0.3, 0], distance: 1.8, height: 0.3, fov: 30 },
    };
    const camName = params.cam || 'full';
    if (camName === 'game') ctx.gameCam([h]);
    else ctx.orbit({ ...(cams[camName] || cams.full), yaw: 0, speed: 0 });
    const spin = params.get('spin', '1') !== '0' && params.get('yaw') === null;
    ctx.turntable(h, spin ? { speed: 20 } : { yaw: Number(params.get('yaw', '35')) });
    const clip = params.anim || 'idle';
    h.play(clip, { loop: true, fade: 0 });
    ctx.label(`${h.def.name} · ${clip} · ${h.model.source}`);
    ctx.expose({
      actor: h,
      play: (c, o = {}) => { h.play(c, { loop: true, restart: true, fade: 0.1, ...o }); ctx.label(`${h.def.name} · ${c} · ${h.model.source}`); return true; },
      setYaw: (deg) => { ctx.turntable(h, { yaw: deg }); return deg; },
      clips: () => game.anim.names({ character: id }),
      source: () => h.model.source,
    });
  },
};
