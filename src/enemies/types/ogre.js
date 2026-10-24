// Ogre Brute (DESIGN §4, GA Bad Brothers): hammer giant mini-boss, usually a pair ("the Brute Brothers": spawn two
// with the same opts.group). Super-armoured swings, a ground-pound shockwave (jump it), a dash, and a grab that
// lifts an unmounted hero and tosses them over its shoulder. Can't ride, can't be thrown.
// VISUAL FIELDS: asset/tiers.asset/anim/height owned by enemies-art-3 (GLBs enemy_ogre_<tier>); proportions/palette/
// style only drive the procedural placeholder fallback.
export default {
  id: 'ogre',
  name: 'Ogre Brute',
  asset: 'enemy_ogre',
  height: 2.75,        // enemies-art-3: GLB is natively ~2.75 m (reference build x1.42)
  // C2 r1: standing hurtbox top (gameplay; height × 0.95 = 2.61 stopped below the C1 r3 head). Measured idle mesh
  // tops in game: green 3.06 (crown/topknot), red 3.12 (horns), silver 3.18 (crest) — tiers below.
  hurtHeight: 3.05,
  hp: 120,
  speed: 2.0,
  radius: 0.62,
  weight: 2.4,
  mass: 4,
  throwable: false,
  canRide: false,
  cannotDodge: true,
  canRetreat: false,
  stunBonus: 4,
  strikeWeight: 1.8,
  threat: 2.5,          // CrowdDirector shared pressure cap (elite ≥ 1.5)
  armorDamage: 9,
  downTicks: 44,
  weapon: 'mace',       // procedural fallback; GLB weapon = manifest weapon_ogre_hammer
  anim: { blade: { R: 1.2, pommel: 0.36 }, weight: 1.8, breathe: 1.3 },   // hammer head y 0.96, spike 1.28, butt -0.36
  proportions: { shoulderW: 0.36, chestR: [0.34, 0.26], waistR: [0.33, 0.27], hipR: [0.26, 0.2], upperArmR: 0.11, foreArmR: 0.1, thighR: 0.14, shinR: 0.115, neckR: 0.11, headR: 0.13 },
  palette: { skin: '#7c8a60', hair: '#1c1812', cloth: '#4a3524', leather: '#3a2a1c', boots: '#2a2018', metal: '#6c6258', accent: '#8a3a22', eyes: '#ffcc40', armor: '#4a3a2c' },
  style: { hair: 'none', helm: 'none', armor: 'harness', bracers: 'leather', pants: true, pauldron: 'L', furShoulder: 'R' },
  behaviour: 'ogre',
  grab: { tossAt: 36, reach: 1.0, liftY: 1.35, fling: { speed: 8.5, vy: 6.5 }, damage: 14, over: true, recover: 34 },
  ai: { spacing: 3.0, attackRange: 1.7, reaction: 14, aggression: 0.55, cooldown: [100, 170], depthTol: 0.5, rush: 1.0, feint: 0, taunt: 0.05, retreatHp: 0 },
  moves: {
    swing: {
      anim: 'heavy', animFallback: ['light_1'], startup: 18, active: 6, recovery: 28, armor: { from: 0, to: 24, damage: 12 }, teleLead: 11, tracking: 0.9, whiffPause: 12,
      hits: [{ box: { x: 1.3, y: 0.3, w: 1.8, h: 1.8, d: 0.8 }, damage: 10, hitstun: 26, knockback: 5.2, launch: 4.5, knockdown: true, hitstop: 11, level: 'heavy', shake: 0.4 }],
      move: [{ from: 12, to: 22, speed: 2.2, ease: 'out' }],
    },
    // Ground pound: armoured overhead into a shockwave ring (grounded heroes within 3 m are floored — jump it).
    pound: {
      anim: 'light_3', animFallback: ['heavy'], startup: 30, active: 4, recovery: 40, armor: { from: 0, to: 34, damage: 14 }, teleLead: 18, whiffPause: 18,
      hits: [{ box: { x: 1.2, y: 0, w: 1.6, h: 1.8, d: 1.0 }, damage: 12, hitstun: 28, knockback: 4, launch: 5, knockdown: true, hitstop: 12, level: 'heavy', shake: 0.5 }],
      shockwave: { at: 31, radius: 3.1, x: 1.1, hit: { damage: 8, knockback: 4.2, launch: 4.6, knockdown: true, hitstop: 8, level: 'heavy', shake: 0.35 } },
    },
    // Grab: reaches out (purple telegraph); an unmounted, grounded hero in reach is lifted and tossed.
    grab: {
      anim: 'grab', animFallback: ['light_1'], startup: 12, active: 0, recovery: 40, teleLead: 10, whiffPause: 22,
      grab: { from: 12, to: 22, reach: 1.35 },
      hits: [],
      move: [{ from: 8, to: 20, speed: 3.0, ease: 'out' }],
    },
    dash: {
      anim: 'run_attack', animFallback: ['heavy'], startup: 24, active: 16, recovery: 28, unblockable: true, armor: { from: 0, to: 40, damage: 12 }, teleLead: 16, whiffPause: 20,
      hits: [{ from: 24, to: 40, box: { x: 0.9, y: 0.3, w: 1.5, h: 2.0, d: 1.1 }, damage: 8, hitstun: 24, knockback: 6, launch: 4.5, knockdown: true, hitstop: 10, level: 'heavy', shake: 0.4 }],
      move: [{ from: 22, to: 40, speed: 7.4, ease: 'out' }],
    },
  },
  tiers: {
    green: { asset: 'enemy_ogre_green' },
    silver: { asset: 'enemy_ogre_silver', hurtHeight: 3.15, hp: 140, palette: { skin: '#8a8e90', cloth: '#3a3e44' }, ai: { aggression: 0.68, reaction: 12 } },
    red: { asset: 'enemy_ogre_red', hurtHeight: 3.1, hp: 170, speed: 2.2, palette: { skin: '#9a5a44', cloth: '#5a2a1e' }, ai: { aggression: 0.78, reaction: 10, cooldown: [40, 86] }, damageMul: 1.15 },
  },
  score: { hit: 25, ko: 1000 },
};
