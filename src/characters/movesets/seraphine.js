// Seraphine's frame data: fast startup, shorter reach, lighter damage, best air game (twin sabres).
// Same string grammar as brann.js (continues on hit; close → pommels → finisher, range → finisher).
const BOX = { x: 0.9, y: 0.5, w: 1.45, h: 1.15, d: 0.8 };
const POMMEL = { x: 0.55, y: 0.7, w: 0.85, h: 0.85, d: 0.7 };
const lightHit = { box: BOX, damage: 4, hitstun: 18, knockback: 1.1, hitstop: 4, level: 'light', shake: 0.08 };
const dodgeOnHit = (from, to) => ({ from, to, on: 'dodge', into: '@dodge', hit: true });

export default {
  id: 'seraphine',
  moves: {
    light_1: {
      startup: 4, active: 3, recovery: 12,
      hits: [lightHit],
      move: [{ from: 1, to: 7, speed: 2.6, ease: 'out' }],
      cancels: [
        { from: 0, to: 3, on: 'jump', into: 'back_attack' },
        { from: 6, to: 18, on: 'light', into: 'light_2', hit: true },
        { from: 6, to: 18, on: 'heavy', into: 'heavy', hit: true },
        dodgeOnHit(6, 18),
      ],
    },
    light_2: {
      startup: 4, active: 3, recovery: 12,
      hits: [lightHit],
      move: [{ from: 1, to: 7, speed: 2.4, ease: 'out' }],
      cancels: [
        { from: 6, to: 18, on: 'light', into: 'pommel_1', hit: true, cond: 'close' },
        { from: 6, to: 18, on: 'light', into: 'light_3', hit: true, cond: 'far' },
        { from: 6, to: 18, on: 'heavy', into: 'launcher', hit: true },
        dodgeOnHit(6, 18),
      ],
    },
    light_3: {
      // Spinning double slash (two hit windows), the second knocks down.
      startup: 6, active: 8, recovery: 18,
      hits: [
        { from: 6, to: 9, box: { ...BOX, w: 1.6 }, damage: 3, hitstun: 20, knockback: 0.6, hitstop: 4, level: 'light', shake: 0.08 },
        { from: 10, to: 14, box: { ...BOX, x: 1.0, w: 1.7 }, damage: 5, hitstun: 22, knockback: 4.2, launch: 6, knockdown: true, hitstop: 8, level: 'heavy', shake: 0.26 },
      ],
      move: [{ from: 3, to: 12, speed: 3.2, ease: 'out' }],
      cancels: [dodgeOnHit(14, 31)],
    },
    pommel_1: {
      anim: 'pommel', animFallback: ['light_2'], startup: 3, active: 2, recovery: 10,
      hits: [{ box: POMMEL, damage: 2.5, hitstun: 22, knockback: 0.3, hitstop: 4, level: 'light', shake: 0.08 }],
      cancels: [{ from: 5, to: 14, on: 'light', into: 'pommel_2', hit: true }, dodgeOnHit(5, 14)],
    },
    pommel_2: {
      anim: 'pommel', animFallback: ['light_1'], startup: 3, active: 2, recovery: 10,
      hits: [{ box: POMMEL, damage: 2.5, hitstun: 24, knockback: 0.3, hitstop: 4, level: 'light', shake: 0.08 }],
      cancels: [{ from: 5, to: 14, on: 'light', into: 'throw', hit: true, cond: 'aim', turn: false }, { from: 5, to: 14, on: 'light', into: 'close_finisher', hit: true }, dodgeOnHit(5, 14)],
    },
    close_finisher: {
      anim: 'kick', animFallback: ['light_3'], startup: 6, active: 4, recovery: 18,
      hits: [{ box: { x: 0.8, y: 0.5, w: 1.2, h: 1.1, d: 0.8 }, damage: 6, hitstun: 22, knockback: 5, launch: 5.5, knockdown: true, hitstop: 8, level: 'heavy', shake: 0.24 }],
      move: [{ from: 2, to: 8, speed: 2.4, ease: 'out' }],
    },
    throw: {
      // Close string → hold ←/→ + Light: a spinning hip toss, fast and far (DESIGN §3). Hero 'throw' state.
      kind: 'throw', anim: 'throw', animFallback: ['heavy'], grab: 5, release: 14, total: 32, maxWeight: 1.4,
      lift: { x: 0.3, y: 1.6 }, fling: { speed: 9.5, vy: 3 }, damage: 6,
      impact: { damage: 6, knockback: 5, launch: 5.5, hitstun: 24, hitstop: 6, level: 'heavy', shake: 0.28 },
    },
    heavy: {
      charge: { at: 7, levels: [16, 38, 64], max: 140 }, // hold Heavy: quickest charge of the three
      startup: 11, active: 5, recovery: 20,
      hits: [{ box: { x: 1.0, y: 0.4, w: 1.9, h: 1.35, d: 0.95 }, damage: 9, hitstun: 26, knockback: 4.8, launch: 7.0, knockdown: true, hitstop: 9, level: 'heavy', shake: 0.35 }],
      move: [{ from: 8, to: 16, speed: 4.0, ease: 'out' }],
      cancels: [{ from: 16, to: 35, on: 'jump', into: '@jump', hit: true }, dodgeOnHit(16, 35)],
    },
    launcher: {
      anim: 'launcher', animFallback: ['heavy'], startup: 7, active: 4, recovery: 18,
      hits: [{ box: { x: 0.9, y: 0.2, w: 1.5, h: 1.8, d: 0.85 }, damage: 5, hitstun: 30, knockback: 0.6, launch: 10, knockdown: true, hitstop: 7, level: 'heavy', shake: 0.24 }],
      move: [{ from: 4, to: 10, speed: 2.2, ease: 'out' }],
      cancels: [{ from: 11, to: 29, on: 'jump', into: '@jump', hit: true }, dodgeOnHit(11, 29)],
    },
    air_slam: {
      // Heavy in the air: twin-sabre dive. Fast plunge, highest bounce (best air game).
      air: true, endOnLand: true, landInto: 'air_slam_land', anim: 'air_slam', animFallback: ['death_stab', 'jump_attack'],
      startup: 5, active: 60, recovery: 0, gravity: 0.45,
      move: [{ from: 0, to: 5, speed: 0.8, vy: 1.4 }, { from: 5, to: 65, speed: 1.6, vy: -17 }],
      hits: [{ from: 5, to: 65, box: { x: 0.55, y: -0.7, w: 1.2, h: 1.45, d: 0.8 }, damage: 7, hitstun: 24, knockback: 1.4, bounce: 9, knockdown: true, hitstop: 6, level: 'heavy', otg: true, shake: 0.26 }],
    },
    air_slam_land: {
      anim: 'land', animFallback: ['heavy'], startup: 0, active: 3, recovery: 14, friction: 30,
      hits: [{ box: { x: 0.3, y: 0, w: 2.3, h: 0.6, d: 1.1 }, damage: 3, hitstun: 20, knockback: 2.8, launch: 4.5, knockdown: true, hitstop: 5, level: 'heavy', otg: true, shake: 0.36 }],
    },
    run_attack: {
      // Flying kick: high priority, widest reach of the three dash attacks.
      clash: 'high', startup: 4, active: 9, recovery: 16,
      hits: [{ box: { x: 1.0, y: 0.6, w: 1.9, h: 1.2, d: 0.8 }, damage: 6, hitstun: 22, knockback: 4.6, launch: 4.5, knockdown: true, hitstop: 7, level: 'heavy', shake: 0.22 }],
      // C1 r5: vy 2.5 → 4.0 (apex 0.36 m instead of 0.14: the kick leaves the ground visibly; airtime 22 ticks = the active window + 9)
      move: [{ from: 0, to: 12, speed: 8.2, vy: 4.0 }, { from: 12, to: 22, speed: 8.2, ease: 'out' }],
    },
    jump_attack: {
      air: true, endOnLand: true, landInto: 'land', startup: 3, active: 40, recovery: 0,
      hits: [{ from: 3, to: 43, box: { x: 0.6, y: -0.3, w: 1.25, h: 1.35, d: 0.8 }, damage: 6, hitstun: 22, knockback: 2.8, launch: 3.5, knockdown: true, hitstop: 5, level: 'heavy', otg: true, shake: 0.14 }],
    },
    run_jump_attack: {
      air: true, endOnLand: true, landInto: 'land', anim: 'run_jump_attack', animFallback: ['jump_attack'], startup: 3, active: 40, recovery: 0,
      hits: [{ from: 3, to: 43, box: { x: 0.8, y: -0.3, w: 1.5, h: 1.45, d: 0.85 }, damage: 8, hitstun: 24, knockback: 4.6, launch: 4, knockdown: true, hitstop: 7, level: 'heavy', otg: true, shake: 0.24 }],
    },
    death_stab: {
      // C2 r1: hit volume = the sabre TIPS (re-keyed plunge pose: 0.45-0.55 m ahead, ≈ 0.3 m above the feet), active from mf 8 once
      // both blades have flipped point-down (the old box reached 0.7 m below the feet and connected on the first active
      // frame with the sabres still raised above her head); forward dive 6.0 m/s, vy -11 (see brann.js).
      air: true, endOnLand: true, landInto: 'land', anim: 'death_stab', animFallback: ['jump_attack'], startup: 6, active: 45, recovery: 0,
      move: [{ from: 0, to: 6, speed: 1.4, vy: 1.4 }, { from: 6, to: 51, speed: 6.0, vy: -11 }],
      hits: [{ from: 8, to: 51, box: { x: 0.5, y: 0.16, w: 0.45, h: 0.4, d: 0.7 }, damage: 13, hitstun: 30, knockback: 0.4, launch: 1.2, knockdown: true, hitstop: 11, level: 'heavy', otg: true, shake: 0.45 }],
    },
    back_attack: {
      anim: 'back_attack', animFallback: ['heavy'], startup: 3, active: 5, recovery: 14,
      hits: [{ box: { x: -0.75, y: 0.5, w: 1.3, h: 1.3, d: 0.8 }, damage: 7, hitstun: 22, knockback: 4, launch: 4, knockdown: true, hitstop: 6, level: 'heavy', shake: 0.16, dir: 'back' }],
    },
  },
};
