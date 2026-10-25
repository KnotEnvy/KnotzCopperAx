// Ashen Marauder: the grunt (Heninger/Longmoan analogue). Club/mace; colour tiers raise HP + aggression.
// Visuals (enemies-art-1): enemy_marauder.glb = the untiered/straw grunt; each tier has its own GLB (colour AND gear
// escalation) + weapon GLB via src/assets/manifest.js: straw club, rust mace, violet flanged mace, iron spiked mace.
// AI/moves (enemies-ai): tiers scale HP, damage (damageMul), aggression and moveset (straw: swing/smash; rust: +jab
// chain; violet/iron: +unblockable dash). All tiers jump-slash mounted riders. Elites: spawn with { elite: 1..4 }.
export default {
  id: 'marauder',
  name: 'Ashen Marauder',
  asset: 'enemy_marauder',
  height: 1.75,       // C2 r7: = the untiered/straw GLB (manifest scale 0.94 on the 1.86 m body); tiers override
  hurtHeight: 1.77,   // C2 r7: gameplay hurtbox unchanged (= the old 0.95 x 1.86) for every rank; the per-tier `height`
               //   below is visual only (anchors / bars / FX follow the rank's size)
  cheatYaw: 0.45,     // C2 r10 art (forwarded by Enemy.js since r15): visual turn toward the lens (Actor default 0.32 rad =
               //   near-profile faces at the game camera); visual only, facing / hitboxes unchanged
  hp: 34,
  speed: 2.5,
  radius: 0.37,
  weight: 1.0,
  weapon: 'club',
  behaviour: 'grunt',
  proportions: { shoulderW: 0.24, chestR: [0.22, 0.16], waistR: [0.18, 0.14], upperArmR: 0.068, foreArmR: 0.058, thighR: 0.095, headR: 0.118 },
  palette: { skin: '#8d6a55', hair: '#2a2420', cloth: '#6f6a3c', leather: '#3b2a1e', boots: '#2b2019', metal: '#6a6660', accent: '#8a6a3a', eyes: '#0e0806', armor: '#5a5236' },
  style: { hair: 'none', helm: 'cap', armor: 'rags', bracers: 'leather', pants: true, pauldron: 'R' },
  // AI (enemies-ai): tier-scaled aggression + moveset. ai.moveset gates moves per tier; dash = GA unblockable dash (violet+).
  ai: { spacing: 2.0, attackRange: 1.3, reaction: 12, aggression: 0.6, cooldown: [30, 72], moveset: ['jab', 'swing', 'smash'], smashBias: 0.25, dash: 0, feint: 0.1, taunt: 0.06 },
  moves: {
    // Quick poke (rust+): fast, low damage; chains into the swing on hit (GA 2-hit combo DNA).
    jab: {
      anim: 'jab', animFallback: ['light_1'], startup: 6, active: 3, recovery: 12, tracking: 0.8, teleLead: 5,
      hits: [{ box: { x: 0.85, y: 0.6, w: 1.2, h: 1.0, d: 0.7 }, damage: 3, hitstun: 18, knockback: 1.2, hitstop: 5, level: 'light', shake: 0.1 }],
      move: [{ from: 3, to: 8, speed: 2.2, ease: 'out' }],
      chain: { into: 'swing', at: 12, hit: true, chance: 0.65 },
    },
    swing: {
      anim: 'swing', animFallback: ['light_1'], startup: 11, active: 4, recovery: 22, tracking: 0.9, // homes in depth during the windup
      hits: [{ box: { x: 0.95, y: 0.5, w: 1.4, h: 1.2, d: 0.75 }, damage: 4, hitstun: 20, knockback: 2.2, hitstop: 6, level: 'light', shake: 0.14 }],
      move: [{ from: 8, to: 15, speed: 2.0, ease: 'out' }],
    },
    smash: {
      // Armoured overhead: light hits (< 7 dmg) during the windup don't stop it (read it and dodge, or interrupt with a heavy).
      anim: 'smash', animFallback: ['light_3'], startup: 18, active: 5, recovery: 28, armor: { from: 3, to: 17, damage: 7 }, tracking: 1.0, whiffPause: 14,
      hits: [{ box: { x: 1.0, y: 0.3, w: 1.6, h: 1.3, d: 0.8 }, damage: 7, hitstun: 24, knockback: 4.2, launch: 4.5, knockdown: true, hitstop: 9, level: 'heavy', shake: 0.3 }],
      move: [{ from: 12, to: 20, speed: 2.8, ease: 'out' }],
    },
    // Unblockable dash attack (violet / iron, GA Heninger dash): long red telegraph, then a charging shoulder-club.
    dash: {
      anim: 'run_attack', animFallback: ['swing', 'light_1'], startup: 20, active: 12, recovery: 24, unblockable: true, teleLead: 14, clash: 'mid', tracking: 0.8, whiffPause: 18,
      hits: [{ from: 20, to: 32, box: { x: 0.8, y: 0.3, w: 1.3, h: 1.4, d: 0.8 }, damage: 5, hitstun: 22, knockback: 4.8, launch: 4.2, knockdown: true, hitstop: 8, level: 'heavy', shake: 0.28 }],
      move: [{ from: 18, to: 32, speed: 8.2, ease: 'out' }],
    },
    // Short hop slash that knocks a rider off its beast (GA arcade grunts).
    jump_slash: {
      anim: 'jump_attack', animFallback: ['swing'], startup: 12, active: 8, recovery: 14, air: true, endOnLand: true, teleLead: 8,
      hits: [{ from: 10, to: 20, box: { x: 0.8, y: 0.6, w: 1.3, h: 1.4, d: 0.8 }, damage: 5, hitstun: 22, knockback: 3.5, launch: 3.5, knockdown: true, hitstop: 7, level: 'heavy', dismount: true, shake: 0.2 }],
      move: [{ from: 6, to: 20, speed: 3.2, vy: 6.8 }],
    },
  },
  tiers: {
    // C2 r7: per-tier `height` = body height x the manifest root scale (straw 0.94 / rust 1 / violet 1.05 / iron 1.11) so
    // anchors / bars / FX follow the rank's size (gameplay hurtbox stays hurtHeight 1.77)
    straw: { asset: 'enemy_marauder_straw', height: 1.75, weapon: 'club', hp: 26, palette: { cloth: '#8b7f4a' }, ai: { aggression: 0.42, moveset: ['swing', 'smash'], smashBias: 0.15, feint: 0.04, cooldown: [44, 92] }, damageMul: 0.85 },
    rust: { asset: 'enemy_marauder_rust', height: 1.86, weapon: 'mace', hp: 40, palette: { cloth: '#8a3f22', armor: '#6b2d18' }, ai: { aggression: 0.62, reaction: 12, moveset: ['jab', 'swing', 'smash'] } },
    violet: { asset: 'enemy_marauder_violet', height: 1.95, weapon: 'mace', hp: 52, speed: 2.8, palette: { cloth: '#553070', armor: '#3a2250' }, ai: { aggression: 0.72, reaction: 10, moveset: ['jab', 'swing', 'smash', 'dash'], dash: 0.3, feint: 0.16 }, damageMul: 1.1 },
    iron: { asset: 'enemy_marauder_iron', height: 2.06, weapon: 'mace', hp: 70, palette: { cloth: '#50545c', armor: '#3a3e46' }, style: { hair: 'none', helm: 'cap', armor: 'plate', bracers: 'metal', pants: true, pauldron: 'both' }, ai: { aggression: 0.82, reaction: 8, moveset: ['jab', 'swing', 'smash', 'dash'], dash: 0.4, smashBias: 0.35, feint: 0.18, cooldown: [30, 70] }, damageMul: 1.25 },
  },
  score: { hit: 10, ko: 200 },
};
