// Morvane Deathcoil, the Adder King (DESIGN §6 stage 5 / §10 script; GA Death Adder). Final boss.
//   Phase 1: hulking armoured tyrant with a serpent great-axe — long-tell cleaves and sweeps, a crouch that plants a
//            HOMING SPARK crawling along the floor (the crouch is his vulnerable window: no armour, ×1.6 damage,
//            floorable), 4 elite purple skeletons summoned from the ground, witchfire shadow eruptions under the heroes.
//   Phase 2 (≤ 50 % — the Copper Ax relic corrupts him): serpent coils + rearing heads, arena cracks, serpent lunge,
//            sparks split into 6, and after knocking a hero down he casts that hero's OWN element back at everyone.
//   Finale: the Copper Ax tears free and impales him; he unravels into snakes; the chained captives are lowered.
// Script: src/enemies/bosses/_morvane.js · brain: src/ai/bosses/morvane.js · art: blender/build_boss_armor.py
// (boss_morvane.glb) + blender/build_boss_weapons.py (boss_morvane_axe.glb). Spawn: stage hook / { type: 'boss_morvane' }.
import { Boss } from '../bosses/_Boss.js';
import { morvaneScript } from '../bosses/_morvane.js';
import brainMod from '../../ai/bosses/morvane.js';
import { soloMercy } from '../bosses/_poise.js';

const HEAVY = { level: 'heavy', hitstop: 12, shake: 0.5 };

export default {
  id: 'boss_morvane',
  kind: 'boss',
  chapterFinal: true,
  name: 'Morvane Deathcoil',
  title: 'The Adder King',
  asset: 'boss_morvane',
  animCharacter: 'boss_morvane',
  anim: { grip: { twoHand: true, off: -0.32, flip: 'auto' }, blade: { R: 1.35, pommel: 0.42 }, weight: 1.8 },
  height: 3.0,
  bodyScale: [1.13, 1.08],  // C2 r12: broad and heavy over the hunch (Varkhul is the tall narrow column) — _Boss.js
  hp: 410,                  // r7: 510 → 410 (poise: he is no longer stun-locked, but the bots' dps against an armoured boss swings 300-620/min → TTK 60-125 s at 410 with 2 bots)
  coopHp: 0,
  coopScale: 0.55,          // +55 % HP per extra hero (applied in create)
  speed: 1.75,
  radius: 0.78,
  weight: 3.4,
  mass: 6,
  throwable: false, canRide: false, cannotDodge: true, canRetreat: false,
  armorDamage: 9,           // legacy (&poise=0): hits under 9 never interrupt him
  kdCooldown: 420,          // legacy (&poise=0): at most one floor per 7 s
  vulnerableMul: 1.6,       // the crouch (plant) window: no armour, ×1.6 damage, poise burns ×2.2
  downTicks: 60, getupTicks: 34, getupInvuln: 40,
  // r7 poise (critic r6: "no poise — the lead boss is floored / stunlocked half the fight"): super-armour on every move,
  // 7-tick flinches, a meter that only breaks after a real combo → readable STAGGER (×1.45 damage), 7 s break immunity,
  // armoured sweep counter. See src/enemies/bosses/_poise.js.
  poise: { max: 72, immune: 480, counter: 'sweep', counterReach: 3.0, stagger: { ticks: 96, mul: 1.45, shove: 3.4 } },
  phases: [{ at: 0.5 }],
  element: 'earth',
  // r6 (critic r5: jade armour + lime braziers + lime stage rim = a dark green mass lost in the throne hall): his own
  // light rig — scene light darkened + desaturated (the lime braziers no longer tint him), a warm gold/ember key and
  // rim that light ONLY him (per-material uniforms, _look.js bossGrade). Phase 2 pushes handle.k up (script).
  grade: { scene: [0.55, 0.5, 0.52], desat: 0.8, rim: '#ffa844', rimMul: 1.8, key: '#ffc080', keyMul: 0.72, amb: ['#6a5040', 0.26] },
  dyingAnim: 'hit_high',
  // placeholder rig until boss_morvane.glb exists
  weapon: 'greatsword',
  proportions: { shoulderW: 0.34, chestR: [0.3, 0.24], waistR: [0.26, 0.2], hipR: [0.22, 0.17], upperArmR: 0.1, foreArmR: 0.09, thighR: 0.13, shinR: 0.11, neckR: 0.1, headR: 0.12 },
  palette: { skin: '#3a4a3c', hair: '#0a0c0a', cloth: '#18281c', leather: '#1c1a16', boots: '#141412', metal: '#3c4a42', accent: '#b08a3a', eyes: '#80ff90', armor: '#2c3a30' },
  style: { hair: 'none', helm: 'horned', armor: 'plate', bracers: 'plate', pauldron: 'both', pants: true },
  behaviour: null,
  score: { hit: 40, ko: 20000 },
  moves: {
    // Overhead cleave: a long, readable wind-up (orange telegraph 22 ticks before impact), ground crack on impact.
    cleave: {
      anim: 'heavy', animFallback: ['light_3'], startup: 38, active: 5, recovery: 36, teleLead: 22, telegraph: 'heavy', tracking: 0.55, whiffPause: 26,
      hits: [{ box: { x: 2.0, y: 0, w: 2.4, h: 3.0, d: 1.1 }, damage: 12, hitstun: 30, knockback: 5, launch: 5, knockdown: true, ...HEAVY }],
      shockwave: { at: 39, radius: 1.9, x: 2.3, hit: { damage: 6, knockback: 3.5, launch: 4, knockdown: true, hitstop: 8, level: 'heavy', shake: 0.3 } },
      move: [{ from: 26, to: 38, speed: 1.6, ease: 'out' }],
    },
    // Wide horizontal sweep: deep depth box (sidestep can't dodge it — jump or back off).
    sweep: {
      anim: 'light_2', animFallback: ['light_1'], startup: 30, active: 8, recovery: 30, teleLead: 18, telegraph: 'heavy', tracking: 0.8, whiffPause: 18,
      hits: [{ box: { x: 1.5, y: 0.2, w: 3.4, h: 1.7, d: 1.55 }, damage: 10, hitstun: 26, knockback: 6.5, launch: 3.8, knockdown: true, ...HEAVY }],
      move: [{ from: 22, to: 34, speed: 2.2, ease: 'out' }],
    },
    // Crouch → plant the homing spark (spawned by the brain on frame 22). Long, punishable recovery.
    plant: { anim: 'crouch_plant', startup: 22, active: 1, recovery: 78, teleLead: 14, telegraph: 'normal', hits: [] },
    // Summon 4 elite purple skeletons (brain, frame 28).
    summon: { anim: 'summon', startup: 28, active: 1, recovery: 52, teleLead: 18, telegraph: 'grab', hits: [] },
    // Shadow magic: witchfire eruptions telegraphed under every hero (brain, frame 22).
    shadow: { anim: 'cast', startup: 22, active: 1, recovery: 46, teleLead: 14, telegraph: 'unblockable', hits: [] },
    // Phase 2: serpent lunge — the coils hurl him forward (unblockable, armoured).
    lunge: {
      anim: 'run_attack', animFallback: ['heavy'], startup: 28, active: 14, recovery: 34, teleLead: 20, unblockable: true, armor: { from: 0, to: 42, damage: 16 }, whiffPause: 22,
      hits: [{ from: 28, to: 42, box: { x: 1.3, y: 0.2, w: 2.3, h: 2.4, d: 1.25 }, damage: 12, hitstun: 26, knockback: 7, launch: 4.5, knockdown: true, ...HEAVY }],
      move: [{ from: 26, to: 42, speed: 8.5, ease: 'out' }],
    },
    // Phase 2: the stolen spell (brain, frame 26).
    mirror: { anim: 'cast', startup: 26, active: 1, recovery: 62, teleLead: 18, telegraph: 'unblockable', hits: [] },
  },
  async create(game, opts, { def }) {
    const model = await game.assets.character({ ...def, asset: def.asset });
    const script = morvaneScript();
    const b = new Boss(game, def, model, { ...opts, script });
    const heroes = game.world.query({ kind: 'hero' }).length;
    if (opts.hp === undefined && heroes > 1) { b.maxHp = Math.round(b.maxHp * (1 + def.coopScale * (heroes - 1))); b.hp = b.maxHp; }
    if (opts.hp === undefined && heroes <= 1) { b.maxHp = Math.round(b.maxHp * 0.92); b.hp = b.maxHp; }   // r7 solo mercy (poise: he is no longer interrupted)
    soloMercy(b, 0.76);
    b.brain = brainMod.create(b, game, opts);
    await script.setup(b, opts);
    return b;
  },
};
