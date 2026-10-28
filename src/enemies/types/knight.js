// Hollow Knight (DESIGN §4, GA Bitter knights): plate-armoured halberdier. Frontal guard vs light attacks (clank —
// break it with heavies, charged heavies, throws or hits from behind), wide halberd sweeps, a reach thrust that
// punishes dash-ins, an armoured overhead chop. Can't run or ride; every hit costs most of a life bar (14; the chop a full 16), so every
// attack has a long, loud telegraph and a real recovery window.
// VISUAL FIELDS (asset, proportions, palette, style, weapon) are PLACEHOLDERS for the art agent (enemy_knight).
// enemies-art-2: tiers select enemy_knight_<tier>.glb (silver = Lt., red = Col., gold = Gen.); halberd =
// weapon_halberd via the manifest ('spear' stays as the procedural fallback kind).
export default {
  id: 'knight',
  name: 'Hollow Knight',
  asset: 'enemy_knight',
  animCharacter: 'knight',   // r22 anim: own clips/profile (anim/clips/enemy_knight.js, profiles.js)
  height: 2.0,
  hp: 70,
  speed: 1.75,
  radius: 0.42,
  weight: 1.35,
  canRun: false,
  canRide: false,
  cannotDodge: true,
  canRetreat: false,
  stunBonus: 2,
  strikeWeight: 2.1,   // after a knight swing, the director holds other attackers off this hero for longer
  threat: 2.5,          // CrowdDirector shared pressure cap (elite ≥ 1.5; ≥ 2.5 = tank → token/strike priority)
  downTicks: 40,
  weapon: 'spear',
  proportions: { shoulderW: 0.27, chestR: [0.24, 0.18], waistR: [0.19, 0.15], hipR: [0.18, 0.14], upperArmR: 0.075, foreArmR: 0.066, thighR: 0.1, shinR: 0.085, headR: 0.12 },
  palette: { skin: '#3a3a3e', hair: '#101012', cloth: '#2c2a30', leather: '#2a2320', boots: '#26262a', metal: '#8a8e96', accent: '#8a2a20', eyes: '#d8f0ff', armor: '#5e6470' },
  style: { hair: 'none', helm: 'horned', armor: 'plate', bracers: 'metal', gloves: true, pants: true, pauldron: 'both' },
  behaviour: 'knight',
  ai: { spacing: 2.6, attackRange: 2.0, reaction: 12, aggression: 0.55, cooldown: [66, 118], depthTol: 0.55, rush: 1.0, feint: 0, taunt: 0.02, retreatHp: 0 },
  moves: {
    // Low wide sweep: jump it or step out in depth.
    sweep: {
      anim: 'heavy', animFallback: ['light_1'], startup: 22, active: 7, recovery: 30, teleLead: 13, whiffPause: 16, tracking: 1.6, armor: { from: 2, to: 22, damage: 9 },
      hits: [{ box: { x: 1.25, y: 0, w: 2.8, h: 0.9, d: 1.35 }, damage: 11, hitstun: 26, knockback: 4.5, launch: 4, knockdown: true, hitstop: 10, level: 'heavy', reaction: 'hit_low', shake: 0.34 }],
      move: [{ from: 16, to: 26, speed: 1.6, ease: 'out' }],
    },
    // Reach thrust: long but narrow (sidestep it).
    thrust: {
      anim: 'run_attack', animFallback: ['light_1'], startup: 16, active: 6, recovery: 26, teleLead: 10, whiffPause: 12, tracking: 1.8, armor: { from: 2, to: 16, damage: 9 },
      hits: [{ box: { x: 1.7, y: 0.7, w: 2.4, h: 0.8, d: 0.75 }, damage: 11, hitstun: 24, knockback: 4, launch: 3.2, knockdown: true, hitstop: 9, level: 'heavy', shake: 0.28 }],
      move: [{ from: 12, to: 20, speed: 3.4, ease: 'out' }],
    },
    // Armoured overhead chop: light hits won't stop it; big punish window after a whiff.
    chop: {
      anim: 'light_3', animFallback: ['heavy'], startup: 28, active: 5, recovery: 34, armor: { from: 4, to: 27, damage: 9 }, teleLead: 15, whiffPause: 24, tracking: 1.4,
      hits: [{ box: { x: 1.3, y: 0.2, w: 1.9, h: 1.8, d: 1.05 }, damage: 12, hitstun: 30, knockback: 5, launch: 5.2, knockdown: true, hitstop: 12, level: 'heavy', shake: 0.45 }],
      move: [{ from: 20, to: 30, speed: 2.2, ease: 'out' }],
    },
    // Counter after blocking twice: quicker, shorter, still telegraphed.
    counter: {
      anim: 'light_1', startup: 12, active: 4, recovery: 26, teleLead: 9,
      hits: [{ box: { x: 1.2, y: 0.5, w: 1.8, h: 1.2, d: 0.8 }, damage: 11, hitstun: 24, knockback: 4.2, launch: 3.5, knockdown: true, hitstop: 9, level: 'heavy', shake: 0.3 }],
      move: [{ from: 6, to: 14, speed: 2.4, ease: 'out' }],
    },
  },
  tiers: {
    silver: { asset: 'enemy_knight_silver' },   // Lt.
    red: { asset: 'enemy_knight_red', hp: 84, speed: 1.9, palette: { armor: '#7a2a24', accent: '#d0a040' }, ai: { aggression: 0.65, reaction: 12, cooldown: [50, 96] } },
    gold: { asset: 'enemy_knight_gold', hp: 100, speed: 2.0, palette: { armor: '#a08030', metal: '#c8a860', accent: '#5a1a14' }, ai: { aggression: 0.72, reaction: 10, cooldown: [44, 88] } },
  },
  score: { hit: 20, ko: 500 },
};
