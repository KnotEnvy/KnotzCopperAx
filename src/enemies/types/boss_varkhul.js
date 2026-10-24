// Iron Chancellor Varkhul (DESIGN §6 stage 4): a giant knight-lord (2.6 m) with a flail and lieutenant tactics.
//   Flail sweep (wide, long reach), overhead flail smash (range 3 m + ground shock), armoured windmill spin; he calls
//   Hollow Knights (lieutenant tactics) and at 60 % raises a SHIELD WALL of 3 knights and smashes over their heads.
// Script: src/enemies/bosses/_varkhul.js · brain: src/ai/bosses/varkhul.js · art: boss_varkhul.glb (build_boss_armor.py,
// knight kit re-parameterised) + boss_varkhul_flail.glb / boss_varkhul_ball.glb (build_boss_weapons.py).
import { Boss } from '../bosses/_Boss.js';
import { varkhulScript } from '../bosses/_varkhul.js';
import brainMod from '../../ai/bosses/varkhul.js';
import { soloMercy } from '../bosses/_poise.js';

const HEAVY = { level: 'heavy', hitstop: 11, shake: 0.45 };

export default {
  id: 'boss_varkhul',
  kind: 'boss',
  name: 'Iron Chancellor Varkhul',
  title: 'Warden of the Serpent Keep',
  asset: 'boss_varkhul',
  animCharacter: 'boss_varkhul',
  anim: { grip: { twoHand: false }, blade: { R: 0.6, pommel: 0.3 }, weight: 1.6 },
  height: 3.15,  // r4 (critic r3: buried behind heroes at 2.6 → 1.43× Brann); 3.0 → ~3.2 m silhouette, 1.6×. C2 r12: 3.15 + bodyScale
  bodyScale: [0.88, 0.9],   // C2 r12: a tall, narrow iron column (Morvane is the broad, hunched one) — _Boss.js
  hp: 470,
  coopHp: 0,
  coopScale: 0.55,
  speed: 1.9,
  radius: 0.66,
  weight: 3.0,
  mass: 5,
  throwable: false, canRide: false, cannotDodge: true, canRetreat: false,
  armorDamage: 9,           // legacy (&poise=0)
  kdCooldown: 400,          // legacy (&poise=0)
  downTicks: 56, getupTicks: 32, getupInvuln: 36,
  // r7 poise (see boss_morvane.js / src/enemies/bosses/_poise.js): flail-sweep counter after a stagger
  poise: { max: 70, immune: 540, counter: 'flail_sweep', counterReach: 3.0, stagger: { ticks: 96, mul: 1.4, shove: 3.2 } },
  phases: [{ at: 0.6 }],
  element: 'storm',
  // r6 separation audit: blue-steel plate on the rain-blue flagstones under a blue stage rim → a torch-amber rim + key
  // that light only him and a mild scene desaturation (_look.js bossGrade)
  grade: { scene: [0.94, 0.92, 0.9], desat: 0.3, rim: '#ffbe78', rimMul: 1.35, key: '#fff0dc', keyMul: 1.0 },
  weapon: 'mace',
  proportions: { shoulderW: 0.3, chestR: [0.27, 0.21], waistR: [0.22, 0.17], hipR: [0.2, 0.15], upperArmR: 0.085, foreArmR: 0.075, thighR: 0.11, shinR: 0.095, headR: 0.12 },
  palette: { skin: '#3a3a3e', hair: '#101012', cloth: '#6a1418', leather: '#2a2320', boots: '#26262a', metal: '#7a7e86', accent: '#c89a48', eyes: '#ffc070', armor: '#4a5a58' },
  style: { hair: 'none', helm: 'horned', armor: 'plate', bracers: 'metal', gloves: true, pants: true, pauldron: 'both' },
  behaviour: null,
  score: { hit: 30, ko: 12000 },
  moves: {
    flail_sweep: {
      anim: 'light_2', animFallback: ['light_1'], startup: 30, active: 10, recovery: 30, teleLead: 18, telegraph: 'heavy', tracking: 0.8, whiffPause: 18,
      hits: [{ box: { x: 2.0, y: 0.2, w: 3.6, h: 1.6, d: 1.7 }, damage: 10, hitstun: 26, knockback: 6.5, launch: 3.8, knockdown: true, ...HEAVY }],
    },
    flail_smash: {
      anim: 'heavy', animFallback: ['light_3'], startup: 36, active: 4, recovery: 34, teleLead: 22, telegraph: 'heavy', tracking: 0.5, whiffPause: 22,
      hits: [{ box: { x: 3.0, y: 0, w: 1.7, h: 2.6, d: 1.0 }, damage: 12, hitstun: 30, knockback: 4, launch: 5, knockdown: true, ...HEAVY }],
      shockwave: { at: 37, radius: 1.7, x: 3.0, hit: { damage: 5, knockback: 3, launch: 4, knockdown: true, hitstop: 8, level: 'heavy', shake: 0.3 } },
    },
    flail_spin: {
      anim: 'flail_spin', startup: 30, active: 30, recovery: 36, teleLead: 20, unblockable: true, armor: { from: 0, to: 60, damage: 14 }, whiffPause: 20,
      hits: [{ from: 30, to: 60, box: { x: 0, y: 0.3, w: 4.6, h: 1.6, d: 2.0 }, damage: 7, hits: 2, interval: 14, hitstun: 22, knockback: 5, launch: 3.5, knockdown: true, ...HEAVY }],
      move: [{ from: 30, to: 60, speed: 1.2 }],
    },
    rally: { anim: 'summon', startup: 26, active: 1, recovery: 44, teleLead: 16, telegraph: 'grab', hits: [] },
  },
  async create(game, opts, { def }) {
    const model = await game.assets.character({ ...def, asset: def.asset });
    const script = varkhulScript();
    const b = new Boss(game, def, model, { ...opts, script });
    const heroes = game.world.query({ kind: 'hero' }).length;
    if (opts.hp === undefined && heroes > 1) { b.maxHp = Math.round(b.maxHp * (1 + def.coopScale * (heroes - 1))); b.hp = b.maxHp; }
    if (opts.hp === undefined && heroes <= 1) { b.maxHp = Math.round(b.maxHp * 0.85); b.hp = b.maxHp; }   // r7 solo mercy (poise: he is no longer interrupted; the shield-wall phase made lone-hero fights 110-185 s)
    soloMercy(b, 0.72);
    b.brain = brainMod.create(b, game, opts);
    await script.setup(b, opts);
    return b;
  },
};
