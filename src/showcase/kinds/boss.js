// what=boss&id=<boss id> — bosses live in src/enemies/bosses/<id>.js (docs/notes/bosses.md).
//   default (&scene=plinth): studio turntable of the boss model playing &anim (default idle); &phase=2 = corrupted form
//   &scene=fight: the boss's own stage (mod.stage) with 2 bot heroes (&p1=brann&p2=gorrim, &p2=none for solo,
//                 &skill=0.85), the full intro → phases → finale. &skip=1 skips the intro.
//   &scene=intro: the stage + boss intro only, heroes as puppets (camera/card/HUD check).
//   &scene=lineup: all five bosses side by side under ONE camera (game-camera elevation), facing screen-right, playing
//                 &anim (idle | walk, in place). &sil=1 = black-fill silhouettes on white (stance/silhouette test, C2).
//                 &phase=2 = Morvane's corrupted form. &only=<boss id> keeps one slot (same camera).
// __KCA.showcase: actor, play(clip), setYaw(deg), clips(), stats() → { hp, maxHp, phase, state, t, alive, heroes }
import { registries } from '../../core/registries.js';

export default {
  id: 'boss',
  async setup(ctx) {
    const { params, game } = ctx;
    const id = params.id || 'morvane';
    const scene = params.get('scene', 'plinth');
    const mod = registries.bosses.has(id) ? await registries.bosses.load(id) : null;
    const phase = Number(params.get('phase', '1'));
    if (scene === 'lineup') return lineup(ctx, phase);
    if (!mod) {
      ctx.studio({ plinth: { radius: 2.2 } });
      const a = await ctx.enemy('marauder', { x: 0, z: 0, facing: 1, tier: 'iron', puppet: true });
      ctx.label(`boss '${id}' not found (known: ${registries.bosses.ids().join(', ') || 'none'})`);
      ctx.orbit({ target: [0, 1.2, 0], distance: 6, height: 0.3, fov: 30 });
      ctx.expose({ actor: a });
      return;
    }
    if (scene === 'plinth') {
      ctx.studio({ plinth: { radius: 2.4 } });
      const actor = await mod.create(game, { x: 0, z: 0, facing: 1, showcase: true, skipIntro: true, captives: false, phase });
      if (actor && !actor.view.parent) game.world.add(actor);
      if (actor) { ctx.puppet(actor); actor.brain = null; }
      ctx.label(`${mod.name}${mod.title ? ' — ' + mod.title : ''}${phase > 1 ? ' (phase ' + phase + ')' : ''}`);
      const H = (actor && actor.height) || 2.6;
      ctx.orbit({ target: [0, H * 0.5, 0], distance: H * 2.1 + 1.5, height: 0.25, fov: 30 });
      if (actor) { ctx.turntable(actor, params.get('yaw') !== null ? { yaw: Number(params.get('yaw')) } : { speed: 16 }); actor.play(params.anim || 'idle', { loop: true, fade: 0 }); }
      ctx.expose({
        actor,
        play: (c, o = {}) => !!(actor && actor.play(c, { loop: true, restart: true, fade: 0.1, ...o }) !== false),
        setYaw: (d) => { if (actor) ctx.turntable(actor, { yaw: d }); return d; },
        clips: () => (game.anim ? game.anim.names({ rig: 'humanoid', character: actor && actor.character }) : []),
      });
      return;
    }
    // fight / intro: the boss's stage, heroes, the real encounter.
    const stageId = params.get('stage', mod.stage || 'stage5');
    await ctx.stage(stageId);
    const bx = Number(params.get('x', String(mod.arenaX ?? 10)));
    const heroes = [];
    const puppet = scene === 'intro';
    const h1 = await ctx.hero(params.get('p1', 'brann'), { x: bx - 6, z: 0.4, puppet });
    if (h1) heroes.push(h1);
    const p2 = params.get('p2', 'gorrim');
    if (p2 !== 'none') { const h2 = await ctx.hero(p2, { x: bx - 7, z: -0.9, playerIndex: 1, puppet }); if (h2) heroes.push(h2); }
    if (!puppet && game.bots) for (const h of heroes) game.bots.attach(h, { skill: Number(params.get('skill', '0.85')) });
    if (params.get('pots') !== null) for (const h of heroes) if (h.addPots) h.addPots(Number(params.get('pots')));
    ctx.gameCam(heroes, { lock: [bx - 11, bx + 8] });
    const skip = params.get('skip') === '1';
    let enc = null, lead = null;
    const opts = { x: bx + 2.5, z: -0.4, facing: -1, showcase: true, skipIntro: skip, phase };
    if (mod.encounter) { enc = await mod.encounter(game, opts); lead = enc.lead; }
    else { lead = await mod.create(game, opts); }
    const t0 = game.tick;
    ctx.after(skip ? 0.05 : 0.3, () => { if (enc && enc.begin) enc.begin(); else if (lead && lead.beginIntro) lead.beginIntro(); if (skip && lead && lead.announce) lead.announce(); });
    ctx.label(`${mod.name} — ${scene}`);
    ctx.expose({
      actor: lead, encounter: enc, heroes,
      play: (c) => !!(lead && lead.play(c, { restart: true })),
      stats: () => {
        const list = enc && enc.actors ? enc.actors : [lead];
        return {
          t: (game.tick - t0) / 60, phase: lead ? lead.phase : 0, state: lead && lead.fsm ? lead.fsm.name : null,
          hp: list.reduce((s, a) => s + Math.max(0, a ? a.hp : 0), 0), maxHp: list.reduce((s, a) => s + (a ? a.maxHp : 0), 0),
          alive: list.some((a) => a && a.alive), finale: !!(lead && lead.token && !lead.token.alive),
          heroes: heroes.map((h) => ({ id: h.heroId || h.typeId, hp: h.hp, state: h.fsm && h.fsm.name })),
        };
      },
    });
  },
};

// ------------------------------------------------------------------------------------------- lineup (C2 r1)
// Same camera for every boss: a long lens from the game camera's elevation (~20° down), bosses facing +X (the way they
// face a hero standing to their right on screen). Group bosses show one member each (Gor, Patina).
async function lineup(ctx, phase) {
  const { params, game } = ctx;
  const THREE = await import('three');
  const sil = params.get('sil') === '1';
  const anim = params.get('anim', 'idle');
  const only = params.get('only');
  const scene = game.renderer && game.renderer.scene;
  const before = new Set();
  ctx.studio({ plinth: false });
  if (scene) scene.traverse((o) => before.add(o));
  const SLOTS = [
    { id: 'brute_brothers', x: -12.5 },
    { id: 'captains', x: -6.8 },
    { id: 'wyrm_rider', x: 0.2 },
    { id: 'varkhul', x: 7.4 },
    { id: 'morvane', x: 13.0 },
  ].filter((s) => !only || s.id === only);
  const actors = [];
  const { spawnEnemy } = await import('../../enemies/spawnEnemy.js');
  const LK = await import('../../enemies/bosses/_look.js');
  for (const s of SLOTS) {
    try {
      if (s.id === 'brute_brothers') {
        const e = await spawnEnemy(game, 'boss_brute', { x: s.x, z: 0, facing: 1, tier: 'gor' });
        if (e) { LK.bossLook(e.modelRoot || e.view); LK.bossRim(e.modelRoot || e.view, 1.35); actors.push(e); }
      } else if (s.id === 'captains') {
        const e = await spawnEnemy(game, 'boss_captain', { x: s.x, z: 0, facing: 1, tier: 'patina', elite: 3 });
        if (e) { LK.bossRim(e.modelRoot || e.view, 1.35); actors.push(e); }
      } else if (s.id === 'wyrm_rider') {
        const W = await registries.bosses.load('wyrm_rider');
        const WR = await import('../../enemies/bosses/wyrm_rider.js');
        const m = game.mounts && await game.mounts.spawn('cinderwyrm', { x: s.x, z: 0, facing: 1, rider: 'viper', riderOpts: { elite: 4, tier: 'captain' } });
        const r = m && m.rider;
        if (r) { LK.bossScale(r, 1.28); if (W && W.stance) W.stance(game, r); actors.push(r); }
        if (m) WR.scaleBeast(m, WR.WYRM_K);
        if (r && m && r.mountedOn === m && r.hurt) r.hurt.h = (m.saddleY || 0) + r.height * 0.62;
        for (const a of [r, m]) if (a && (a.modelRoot || a.view)) LK.bossRim(a.modelRoot || a.view, 1.4);
        try { const WL = await import('../../enemies/bosses/_wyrmLook.js'); WL.wyrmRiderLook(game, r, m); } catch (e) { /* cosmetic */ }
      } else {
        const mod = await registries.bosses.load(s.id);
        const a = mod && await mod.create(game, { x: s.x, z: 0, facing: 1, showcase: true, skipIntro: true, captives: false, phase });
        if (a && !a.view.parent) game.world.add(a);
        if (a) actors.push(a);
      }
    } catch (e) { console.warn('lineup', s.id, e); }
  }
  // C2 r13: &hero=<id> — a hero puppet 2.2 m behind every boss slot (same facing) for the size read (e.g. Varkhul vs Gorrim)
  const heroId = params.get('hero');
  if (heroId) for (const s of SLOTS) { try { const h = await ctx.hero(heroId, { x: s.x - 2.2, z: 0.35, facing: 1, puppet: true }); if (h) actors.push(h); } catch (e) { console.warn('lineup hero', e); } }
  for (const a of actors) {
    ctx.puppet(a);
    a.boundsMode = 'none';
    if (a.mountedOn) continue;   // seated: riding.js maps every clip to ride_idle
    a.play(anim, { loop: true, fade: 0, startAt: 0 });
  }
  // C2 r13: hold every actor on its slot (stepped at a true 60 Hz the puppets drifted off their slots between rows)
  const pins = [...actors, ...actors.map((x) => x.mountedOn).filter(Boolean)].map((x) => ({ a: x, x: x.pos.x, z: x.pos.z }));
  ctx.every(1 / 60, () => { for (const p of pins) { p.a.pos.x = p.x; p.a.pos.z = p.z; if (p.a.vel) { p.a.vel.x = 0; p.a.vel.z = 0; } } });
  // one camera offset for every slot: frame(i) re-centres it on slot i (same distance / elevation / lens)
  const CAM = { distance: 15, height: 15 * 0.36, fov: 30 };
  const orbit = ctx.orbit({ target: [0.25, 1.6, 0], distance: 40, height: 40 * 0.36, fov: 26, lookHeight: 1.55 });
  const frame = (i) => {
    const s = SLOTS[i]; if (!s) return false;
    orbit.target.set(s.x + (s.id === 'wyrm_rider' ? -0.2 : 0), 1.6, 0); orbit.distance = CAM.distance; orbit.height = CAM.height; orbit.fov = CAM.fov; orbit.lookHeight = 1.6;
    return s.id;
  };
  if (only) frame(0);
  ctx.label(sil ? '' : 'boss lineup — ' + anim);
  const hideDecor = () => {
    for (const a of [...actors, ...actors.map((x) => x.mountedOn).filter(Boolean)]) {
      if (a.nameTag) { a.nameTag.visible = false; a.nameTag.scale.set(0, 0, 0); }
      if (a.shadow && a.shadow.parent) a.shadow.parent.remove(a.shadow);
    }
  };
  hideDecor();
  ctx.every(0.2, hideDecor);
  if (sil && scene) {
    const black = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false });
    scene.background = new THREE.Color('#ffffff');
    if (scene.fog) scene.fog = null;
    const apply = () => scene.traverse((o) => {
      if (before.has(o)) { if (o.isMesh || o.isPoints || o.isLine || o.isSprite) o.visible = false; return; }
      if (o.name === 'boss_bonepile') { o.visible = false; return; }
      if (o.isSprite || o.isPoints || o.isLine) { o.visible = false; return; }
      if (o.isMesh && o.material !== black) { o.material = black; o.castShadow = false; }
    });
    apply();
    ctx.every(0.2, apply);
    if (game.renderer.post) game.renderer.postEnabled = false;
  }
  ctx.expose({ actors, frame, slots: SLOTS.map((x) => x.id), play: (c) => { for (const a of actors) if (!a.mountedOn) a.play(c, { loop: true, restart: true, fade: 0.1 }); return true; } });
}
