// what=mount&id=<cluckhorn|emberdrake|cinderwyrm|tusker>[&anim=idle|walk|run|<attack id>|attacks][&rider=brann]
//   [&cam=full|close|side][&yaw=deg]   Turntable by default; anim=<attack> loops that beast attack every 1.6 s;
//   anim=attacks cycles every attack. __KCA.showcase: { actor, rider, play(id), setYaw(d), setSpeed(v) }
export default {
  id: 'mount',
  async setup(ctx) {
    const { params, game } = ctx;
    const id = params.get('id') || 'cluckhorn';
    if (params.get('scene') === 'ride') return rideScene(ctx, id);
    ctx.studio({ plinth: { radius: 2.0 } });
    const m = await ctx.mount(id, { x: 0, z: 0, puppet: true });
    if (!m) { ctx.label(`mount '${id}' failed to load`); ctx.orbit({ target: [0, 1, 0], distance: 6 }); return; }
    const H = m.height || 2;
    const cam = params.get('cam') || 'full';
    ctx.orbit({ target: [0, H * (cam === 'close' ? 0.7 : 0.5), 0], distance: cam === 'close' ? H * 1.6 + 1 : H * 2.4 + 2.2, height: 0.35, fov: 30 });
    const yaw = params.get('yaw');
    const anim = params.get('anim') || 'idle';
    const attacks = Object.keys(m.attacks);
    if (yaw !== null) ctx.turntable(m, { yaw: Number(yaw) }); else if (!attacks.includes(anim) && anim !== 'attacks') ctx.turntable(m, { speed: 18 });
    else ctx.turntable(m, { yaw: 70 });
    m.demoSpeed = anim === 'walk' ? 2.6 : anim === 'run' ? 7.5 : 0;
    let rider = null;
    const rid = params.get('rider');
    if (rid) {
      rider = await ctx.hero(rid, { x: 0, puppet: true });
      if (rider) { m.mount(rider, { force: true }); rider.fsm.go('puppet'); rider.play('ride_idle', { fade: 0 }); }
    }
    const play = (a) => { if (!m.demoAction(a)) return false; const an = m.attacks[a].anim || 'ride_attack'; if (rider && an === 'ride_attack') rider.play('ride_attack', { restart: true, fade: 0.05, duration: m.action.total / 60 }); return true; };
    let cyc = 0;
    if (attacks.includes(anim)) { play(anim); ctx.every(1.6, () => play(anim)); }
    else if (anim === 'attacks') { play(attacks[0]); ctx.every(1.7, () => play(attacks[++cyc % attacks.length])); }
    ctx.every(1 / 60, () => m.demoTick());
    ctx.label(`${m.def.name || id}${m.def.placeholder ? ' (placeholder visual)' : ''} · ${m.rig ? m.rig.source : 'proc'}`);
    ctx.expose({ actor: m, rider, play, setYaw: (d) => ctx.turntable(m, { yaw: d }), setSpeed: (v) => { m.demoSpeed = v; } });
  },
};

// scene=ride: in-game riding sandbox in stage 1 (x ≈ 22). Player 1 = &hero (default brann, keyboard/test input),
// a marauder (&rider) rides in on the beast from the right, two straw marauders follow after `&foes` seconds.
//   __KCA.showcase: { hero, beast(), foes(), spawnFoe(type, dx, dz, tier), state() }
async function rideScene(ctx, id) {
  const { params, game } = ctx;
  await ctx.stage('stage1');
  const ox = 22;
  const h = await ctx.hero(params.get('hero') || 'brann', { x: ox - 2, z: 0 });
  if (params.get('god') !== '0') h.godMode = true;
  ctx.gameCam([h], { lock: [ox - 12, ox + 12] });
  let beast = await game.mounts.spawn(id, { x: ox + 4.2, z: 0.1, facing: -1, rider: params.get('rider') || 'marauder', riderOpts: { tier: 'rust' }, wave: false });
  const foes = [];
  const spawnFoe = async (type, dx, dz, tier) => { const e = await ctx.enemy(type, { x: h.pos.x + dx, z: dz, tier, facing: dx > 0 ? -1 : 1 }); if (e) foes.push(e); return e; };
  const later = Number(params.get('foes') ?? -1);
  if (later >= 0) ctx.after(later, () => { const p = Promise.all([spawnFoe('marauder', 6, 0.5, 'straw'), spawnFoe('marauder', 7.5, -0.6, 'straw')]); if (game.track) game.track(p); });
  ctx.label(`mount · ride · ${id}`);
  ctx.expose({
    hero: h, beast: () => beast, foes: () => foes, spawnFoe,
    state: () => ({ hero: { x: h.pos.x, z: h.pos.z, y: h.pos.y, hp: h.hp, st: h.fsm.name, mounted: !!h.mountedOn, move: h.moveId },
      beast: beast && { x: beast.pos.x, z: beast.pos.z, hp: beast.hp, mode: beast.mode, rider: beast.rider && beast.rider.kind, action: beast.action && beast.action.id },
      enemies: game.world.query({ team: 'enemies' }).map((e) => ({ t: e.typeId, x: +e.pos.x.toFixed(2), st: e.fsm.name, hp: e.hp, mounted: !!e.mountedOn })) }),
  });
}
