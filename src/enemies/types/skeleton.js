// Grave Skeleton (DESIGN §4, GA skeleton): horde undead with sword + shield. RISES FROM THE GROUND (spawn opts.rise,
// 'ai:rise' events for VFX), blocks frontal light hits with its shield, crumbles into bones on KO and REASSEMBLES
// unless the pile is hit OTG or by magic (Enemy.js `reassemble`). White = basic; purple (elite, Morvane's summons)
// uses the hero grammar: 4-hit string, dash, jump slash and the Death Stab at double grunt damage.
// VISUAL FIELDS (asset, proportions, palette, style, weapon, tiers' palette) are PLACEHOLDERS owned by the art agent
// once enemy_skeleton.glb lands; behaviour/moves/ai/stats are enemies-ai.
// enemies-art-2: enemy_skeleton.glb = white; tiers select enemy_skeleton_<tier>.glb (shield embedded, sword =
// weapon_sword_bone via the manifest; 'sabre' stays as the procedural fallback kind).
export default {
  id: 'skeleton',
  name: 'Grave Skeleton',
  asset: 'enemy_skeleton',
  animCharacter: 'skeleton',   // r22 anim: own profile (anim/profiles.js); clips = the generic set
  height: 1.8,
  hp: 30,
  speed: 2.7,
  radius: 0.33,
  weight: 0.8,
  weapon: 'sabre',
  proportions: { shoulderW: 0.2, chestR: [0.15, 0.11], waistR: [0.075, 0.065], hipR: [0.12, 0.09], upperArmR: 0.034, foreArmR: 0.028, thighR: 0.045, shinR: 0.036, neckR: 0.035, headR: 0.112 },
  palette: { skin: '#d8cfb4', hair: '#1a1410', cloth: '#3a2f2a', leather: '#4a3a2a', boots: '#2a221c', metal: '#7d776a', accent: '#6a1c16', eyes: '#ff6a2a', armor: '#5c574c' },
  style: { hair: 'none', helm: 'none', armor: 'rags', bracers: 'metal', pants: false, pauldron: 'L' },
  behaviour: 'skeleton',
  reassemble: { ticks: 150, hp: 0.5, max: 2 },
  strikeWeight: 1.1,
  threat: 1.5,          // CrowdDirector shared pressure cap (elite ≥ 1.5)
  ai: { spacing: 2.2, attackRange: 1.35, reaction: 11, aggression: 0.62, cooldown: [44, 90], guard: 0.5, moveset: ['slash', 'thrust'], jump: 0.25, dash: 0, deathStab: 0, feint: 0.08, taunt: 0.03, retreatHp: 0 },
  moves: {
    slash: {
      anim: 'light_1', startup: 9, active: 4, recovery: 18, tracking: 0.9,
      hits: [{ box: { x: 0.95, y: 0.5, w: 1.4, h: 1.2, d: 0.75 }, damage: 4, hitstun: 20, knockback: 1.8, hitstop: 6, level: 'light', shake: 0.12 }],
      move: [{ from: 5, to: 12, speed: 2.2, ease: 'out' }],
      chain: { into: 'slash_2', at: 14, hit: true, chance: 0.7 },
    },
    slash_2: {
      anim: 'light_2', animFallback: ['light_1'], startup: 8, active: 4, recovery: 22,
      hits: [{ box: { x: 1.0, y: 0.4, w: 1.5, h: 1.3, d: 0.8 }, damage: 6, hitstun: 24, knockback: 3.8, launch: 4, knockdown: true, hitstop: 8, level: 'heavy', shake: 0.22 }],
      move: [{ from: 3, to: 11, speed: 2.4, ease: 'out' }],
    },
    // Purple 4-hit string (the brain swaps slash → pslash_1 for the purple tier).
    pslash_1: {
      anim: 'light_1', startup: 8, active: 4, recovery: 16, tracking: 1.0,
      hits: [{ box: { x: 0.95, y: 0.5, w: 1.4, h: 1.2, d: 0.75 }, damage: 5, hitstun: 22, knockback: 1.4, hitstop: 6, level: 'light', shake: 0.12 }],
      move: [{ from: 4, to: 11, speed: 2.2, ease: 'out' }],
      chain: { into: 'pslash_2', at: 13, hit: true, chance: 0.85 },
    },
    pslash_2: {
      anim: 'light_2', animFallback: ['light_1'], startup: 7, active: 4, recovery: 16,
      hits: [{ box: { x: 1.0, y: 0.5, w: 1.4, h: 1.2, d: 0.75 }, damage: 5, hitstun: 22, knockback: 1.4, hitstop: 6, level: 'light', shake: 0.12 }],
      chain: { into: 'pslash_3', at: 12, hit: true, chance: 0.85 },
    },
    pslash_3: {
      anim: 'light_3', animFallback: ['light_1'], startup: 8, active: 4, recovery: 16,
      hits: [{ box: { x: 1.0, y: 0.5, w: 1.4, h: 1.2, d: 0.75 }, damage: 6, hitstun: 22, knockback: 1.6, hitstop: 6, level: 'light', shake: 0.14 }],
      chain: { into: 'pslash_4', at: 13, hit: true, chance: 0.8 },
    },
    pslash_4: {
      anim: 'heavy', animFallback: ['light_3'], startup: 12, active: 5, recovery: 26, armor: { from: 2, to: 12, damage: 6 },
      hits: [{ box: { x: 1.05, y: 0.3, w: 1.6, h: 1.4, d: 0.85 }, damage: 8, hitstun: 26, knockback: 4.6, launch: 5, knockdown: true, hitstop: 10, level: 'heavy', shake: 0.3 }],
      move: [{ from: 6, to: 14, speed: 3, ease: 'out' }],
    },
    thrust: {
      anim: 'run_attack', animFallback: ['light_1'], startup: 14, active: 5, recovery: 22, tracking: 1.0, whiffPause: 10,
      hits: [{ box: { x: 1.25, y: 0.6, w: 1.6, h: 0.8, d: 0.7 }, damage: 7, hitstun: 22, knockback: 3.2, hitstop: 7, level: 'heavy', shake: 0.18 }],
      move: [{ from: 10, to: 18, speed: 4.2, ease: 'out' }],
    },
    dash: {
      anim: 'run_attack', animFallback: ['light_1'], startup: 16, active: 12, recovery: 22, unblockable: true, teleLead: 12, whiffPause: 14,
      hits: [{ from: 16, to: 28, box: { x: 0.9, y: 0.4, w: 1.3, h: 1.2, d: 0.8 }, damage: 7, hitstun: 22, knockback: 4.4, launch: 4, knockdown: true, hitstop: 8, level: 'heavy', shake: 0.26 }],
      move: [{ from: 14, to: 28, speed: 8.4, ease: 'out' }],
    },
    jump_slash: {
      anim: 'jump_attack', animFallback: ['light_1'], startup: 12, active: 10, recovery: 14, air: true, endOnLand: true, teleLead: 8,
      hits: [{ from: 12, to: 24, box: { x: 0.8, y: 0.3, w: 1.3, h: 1.5, d: 0.8 }, damage: 10, hitstun: 24, knockback: 3.6, launch: 4, knockdown: true, hitstop: 8, level: 'heavy', dismount: true, shake: 0.24 }],
      move: [{ from: 6, to: 24, speed: 4.2, vy: 7.2 }],
    },
    // Death Stab (purple): dash → leap → skull-crushing downward stab near the apex (GA 16 = a full bar).
    death_stab: {
      anim: 'death_stab', animFallback: ['jump_attack'], startup: 18, active: 16, recovery: 22, air: true, endOnLand: true, unblockable: true, teleLead: 14,
      hits: [{ from: 20, to: 36, box: { x: 0.55, y: -0.4, w: 1.2, h: 1.4, d: 0.8 }, damage: 16, hitstun: 30, knockback: 3, launch: 3, knockdown: true, hitstop: 12, level: 'heavy', otg: true, shake: 0.45 }],
      move: [{ from: 4, to: 16, speed: 6.5, ease: 'out' }, { from: 16, to: 34, speed: 3.2, vy: 7.6 }],
    },
  },
  tiers: {
    white: { asset: 'enemy_skeleton_white' },
    purple: {
      asset: 'enemy_skeleton_purple',
      hp: 46, speed: 3.0, damageMul: 1.25, reassemble: { ticks: 120, hp: 0.6, max: 3 },
      palette: { skin: '#b9a6d6', accent: '#5a2a8a', cloth: '#2a1f38', eyes: '#d060ff', armor: '#4a3c5c' },
      ai: { aggression: 0.8, reaction: 8, guard: 0.72, moveset: ['pslash_1', 'thrust'], jump: 0.3, dash: 0.35, deathStab: 0.45, feint: 0.14, cooldown: [28, 64] },
    },
  },
  score: { hit: 15, ko: 300 },
};
