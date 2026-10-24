// Viper Maiden (DESIGN §4, GA Amazons): agile whip-spear warrior. Pokes at range, leaps in with a diving slash,
// backflips away when crowded or hit, lunges with an unblockable dash, and jump-slashes riders off their beasts.
// VISUAL FIELDS: asset/tiers.asset/anim owned by enemies-art-3 (GLBs enemy_viper_<tier>); proportions/palette/style
// only drive the procedural placeholder fallback.
export default {
  id: 'viper',
  name: 'Viper Maiden',
  asset: 'enemy_viper',
  height: 1.78,
  hp: 36,
  speed: 3.1,
  radius: 0.33,
  weight: 0.85,
  weapon: 'spear',      // procedural fallback; GLB weapon = manifest weapon_whip_spear
  // whip-spear tip y 1.52, rattle butt -0.25 (C1 r4); C2 r1: hair_* = the high ponytail (lighter than the old hood
  // tail) -> a lively but less floppy swing. C2 r6 (anim): clip sets anim/clips/enemy_viper*.js; dusk / captain tiers
  // use their own anim character ids (lower / more upright variants of idle + locomotion; attacks shared).
  anim: { blade: { R: 1.5, pommel: 0.25 }, springs: { hair: 1.4, stiff: 0.7 } },
  proportions: { shoulderW: 0.19, chestR: [0.17, 0.12], waistR: [0.12, 0.1], hipR: [0.16, 0.12], upperArmR: 0.045, foreArmR: 0.038, thighR: 0.07, shinR: 0.052, headR: 0.108 },
  palette: { skin: '#c89a78', hair: '#1c1612', cloth: '#2a4a3a', leather: '#4a3222', boots: '#2e2218', metal: '#a08850', accent: '#b08a3a', eyes: '#1a120c', armor: '#2f5a52' },
  style: { hair: 'braid', helm: 'circlet', armor: 'scale', bracers: 'leather', pants: false, sash: true },
  behaviour: 'viper',
  threat: 1.5,          // CrowdDirector shared pressure cap (elite ≥ 1.5)
  ai: { spacing: 2.7, attackRange: 2.1, reaction: 9, aggression: 0.7, cooldown: [50, 96], depthTol: 0.4, rush: 1.3, agility: 1.6, feint: 0.15, taunt: 0.05, retreatHp: 0.4, retreatChance: 0.7, leap: 0.4, flip: 0.55, dash: 0.25 },
  moves: {
    poke: {
      anim: 'light_1', startup: 8, active: 4, recovery: 16, tracking: 0.9, teleLead: 6,
      hits: [{ box: { x: 1.45, y: 0.7, w: 1.8, h: 0.6, d: 0.65 }, damage: 3, hitstun: 18, knockback: 1.8, hitstop: 5, level: 'light', shake: 0.1 }],
      move: [{ from: 4, to: 10, speed: 2.6, ease: 'out' }],
      chain: { into: 'poke_2', at: 13, hit: true, chance: 0.6 },
    },
    poke_2: {
      anim: 'light_2', animFallback: ['light_1'], startup: 7, active: 4, recovery: 20,
      hits: [{ box: { x: 1.5, y: 0.5, w: 1.9, h: 0.9, d: 0.7 }, damage: 5, hitstun: 22, knockback: 3.6, launch: 3.6, knockdown: true, hitstop: 7, level: 'heavy', shake: 0.18 }],
      move: [{ from: 2, to: 9, speed: 3, ease: 'out' }],
    },
    // Leaping dive slash from mid range.
    leap: {
      anim: 'jump_attack', animFallback: ['light_1'], startup: 12, active: 14, recovery: 16, air: true, endOnLand: true, teleLead: 9,
      hits: [{ from: 14, to: 30, box: { x: 0.8, y: 0.2, w: 1.4, h: 1.5, d: 0.8 }, damage: 6, hitstun: 22, knockback: 3.4, launch: 3.8, knockdown: true, hitstop: 8, level: 'heavy', dismount: true, shake: 0.22 }],
      move: [{ from: 8, to: 30, speed: 5.4, vy: 7.4 }],
    },
    jump_slash: {
      anim: 'jump_attack', animFallback: ['light_1'], startup: 10, active: 10, recovery: 12, air: true, endOnLand: true, teleLead: 7,
      hits: [{ from: 10, to: 22, box: { x: 0.8, y: 0.6, w: 1.3, h: 1.4, d: 0.8 }, damage: 5, hitstun: 22, knockback: 3.5, launch: 3.5, knockdown: true, hitstop: 7, level: 'heavy', dismount: true, shake: 0.2 }],
      move: [{ from: 6, to: 20, speed: 3.4, vy: 6.8 }],
    },
    // Evasive backflip: i-frames early, no hitbox (the body roll is driven by the viper brain).
    backflip: {
      anim: 'jump_up', animFallback: ['dodge_roll'], startup: 2, active: 0, recovery: 30, air: true, endOnLand: true, invuln: [0, 16], telegraph: 'none',
      hits: [],
      move: [{ from: 2, to: 24, speed: -6.2, vy: 6.6 }],
    },
    dash: {
      anim: 'run_attack', animFallback: ['light_1'], startup: 15, active: 11, recovery: 20, unblockable: true, teleLead: 11, whiffPause: 12, tracking: 0.8,
      hits: [{ from: 15, to: 26, box: { x: 1.1, y: 0.5, w: 1.6, h: 1.0, d: 0.75 }, damage: 5, hitstun: 22, knockback: 4, launch: 3.6, knockdown: true, hitstop: 7, level: 'heavy', shake: 0.22 }],
      move: [{ from: 13, to: 26, speed: 9, ease: 'out' }],
    },
  },
  tiers: {
    jade: { asset: 'enemy_viper_jade' },
    crimson: { asset: 'enemy_viper_crimson', hp: 46, speed: 3.3, palette: { cloth: '#6a1e22', armor: '#5a2a2a' }, ai: { aggression: 0.8, reaction: 8, dash: 0.35 }, damageMul: 1.15 },
    dusk: { asset: 'enemy_viper_dusk', animCharacter: 'viper_dusk', hp: 54, speed: 3.4, palette: { cloth: '#2a2438', armor: '#3a2e50' }, ai: { aggression: 0.88, reaction: 7, dash: 0.4, leap: 0.5 }, damageMul: 1.25 },
    // Wyrm Rider boss look (enemies-art-3): visual only -- the boss agent sets its own stats.
    captain: { asset: 'enemy_viper_captain', animCharacter: 'viper_captain' },
  },
  score: { hit: 15, ko: 300 },
};
