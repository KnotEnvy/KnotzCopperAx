// Brann's frame data (60 Hz ticks). Format: combat/MoveRunner.js header and docs/ENGINE_API.md §Movesets.
// Greatsword: long reach, mid speed, heavy hitstop on finishers.
//
// String (DESIGN §3): light_1 → light_2 only if light_1 CONNECTED (hit: true). Then it branches:
//   range (cond 'far')  → light_3 (overhead chop, knockdown)
//   close (cond 'close')→ pommel_1 → pommel_2 → close_finisher (kick), or hold ←/→ + Light → throw (cond 'aim')
// Heavy after two lights = launcher (jump-cancel on hit for air combos).
const BOX = { x: 1.05, y: 0.45, w: 1.7, h: 1.25, d: 0.8 };
const POMMEL = { x: 0.6, y: 0.7, w: 0.9, h: 0.9, d: 0.7 };
const lightHit = { box: BOX, damage: 5, hitstun: 20, knockback: 1.4, hitstop: 5, level: 'light', shake: 0.12 };
const dodgeOnHit = (from, to) => ({ from, to, on: 'dodge', into: '@dodge', hit: true });

export default {
  id: 'brann',
  moves: {
    light_1: {
      startup: 6, active: 3, recovery: 14,
      hits: [lightHit],
      move: [{ from: 2, to: 9, speed: 2.4, ease: 'out' }],
      cancels: [
        { from: 0, to: 3, on: 'jump', into: 'back_attack' },
        { from: 8, to: 22, on: 'light', into: 'light_2', hit: true },
        { from: 8, to: 22, on: 'heavy', into: 'heavy', hit: true },
        dodgeOnHit(8, 22),
      ],
    },
    light_2: {
      startup: 5, active: 3, recovery: 15,
      hits: [lightHit],
      move: [{ from: 2, to: 8, speed: 2.2, ease: 'out' }],
      cancels: [
        { from: 7, to: 22, on: 'light', into: 'pommel_1', hit: true, cond: 'close' },
        { from: 7, to: 22, on: 'light', into: 'light_3', hit: true, cond: 'far' },
        { from: 7, to: 22, on: 'heavy', into: 'launcher', hit: true },
        dodgeOnHit(7, 22),
      ],
    },
    light_3: {
      startup: 8, active: 4, recovery: 22,
      hits: [{ box: { ...BOX, x: 1.15, w: 1.9 }, damage: 9, hitstun: 24, knockback: 4.6, launch: 5.5, knockdown: true, hitstop: 9, level: 'heavy', shake: 0.32 }],
      move: [{ from: 4, to: 11, speed: 3.2, ease: 'out' }],
      cancels: [dodgeOnHit(14, 33)],
    },
    pommel_1: {
      anim: 'pommel', animFallback: ['light_2'], startup: 4, active: 2, recovery: 12,
      hits: [{ box: POMMEL, damage: 3, hitstun: 24, knockback: 0.3, hitstop: 5, level: 'light', shake: 0.1, reaction: 'hit_high' }],
      cancels: [{ from: 6, to: 17, on: 'light', into: 'pommel_2', hit: true }, dodgeOnHit(6, 17)],
    },
    pommel_2: {
      anim: 'pommel', animFallback: ['light_1'], startup: 4, active: 2, recovery: 12,
      hits: [{ box: POMMEL, damage: 3, hitstun: 26, knockback: 0.3, hitstop: 5, level: 'light', shake: 0.1 }],
      cancels: [{ from: 6, to: 17, on: 'light', into: 'throw', hit: true, cond: 'aim', turn: false }, { from: 6, to: 17, on: 'light', into: 'close_finisher', hit: true }, dodgeOnHit(6, 17)],
    },
    close_finisher: {
      anim: 'kick', animFallback: ['light_3'], startup: 7, active: 4, recovery: 20,
      hits: [{ box: { x: 0.8, y: 0.3, w: 1.2, h: 1.1, d: 0.8 }, damage: 8, hitstun: 24, knockback: 5.5, launch: 5, knockdown: true, hitstop: 9, level: 'heavy', shake: 0.3 }],
      move: [{ from: 3, to: 9, speed: 2.0, ease: 'out' }],
      cancels: [dodgeOnHit(12, 30)],
    },
    throw: {
      // Close string → hold ←/→ + Light: hoist the foe over the shoulder and hurl it (DESIGN §3). Hero 'throw' state.
      kind: 'throw', anim: 'throw', animFallback: ['heavy'], grab: 6, release: 18, total: 38, maxWeight: 1.6,
      lift: { x: 0.35, y: 1.85 }, fling: { speed: 8.5, vy: 2.6 }, damage: 8,
      impact: { damage: 8, knockback: 5.5, launch: 5.2, hitstun: 26, hitstop: 7, level: 'heavy', shake: 0.35 },
    },
    heavy: {
      charge: { at: 8, levels: [18, 42, 72], max: 150 }, // hold Heavy: 3 levels (Hero CHARGE_DEFAULTS.scale)
      startup: 14, active: 4, recovery: 24,
      hits: [{ box: { x: 1.2, y: 0.35, w: 2.1, h: 1.4, d: 1.0 }, damage: 12, hitstun: 28, knockback: 5.5, launch: 4.5, knockdown: true, hitstop: 10, level: 'heavy', shake: 0.45 }],
      move: [{ from: 10, to: 18, speed: 3.6, ease: 'out' }],
      cancels: [dodgeOnHit(20, 41), { from: 20, to: 41, on: 'jump', into: '@jump', hit: true }],
    },
    launcher: {
      anim: 'launcher', animFallback: ['heavy'], startup: 9, active: 4, recovery: 22,
      hits: [{ box: { x: 1.0, y: 0.2, w: 1.6, h: 1.8, d: 0.9 }, damage: 7, hitstun: 30, knockback: 0.8, launch: 9.5, knockdown: true, hitstop: 8, level: 'heavy', shake: 0.3 }],
      move: [{ from: 5, to: 12, speed: 2.0, ease: 'out' }],
      cancels: [{ from: 13, to: 34, on: 'jump', into: '@jump', hit: true }, dodgeOnHit(13, 34)],
    },
    air_slam: {
      // Heavy in the air: hang, then drive the greatsword into the ground; victims ground-bounce (juggle).
      air: true, endOnLand: true, landInto: 'air_slam_land', anim: 'air_slam', animFallback: ['death_stab', 'jump_attack'],
      startup: 7, active: 60, recovery: 0, gravity: 0.45,
      move: [{ from: 0, to: 7, speed: 0.6, vy: 1.6 }, { from: 7, to: 67, speed: 1.2, vy: -15 }],
      hits: [{ from: 7, to: 67, box: { x: 0.55, y: -0.75, w: 1.3, h: 1.5, d: 0.85 }, damage: 9, hitstun: 26, knockback: 1.6, bounce: 8.5, knockdown: true, hitstop: 8, level: 'heavy', otg: true, shake: 0.35 }],
    },
    air_slam_land: {
      // Impact shockwave around the blade (also catches foes the plunge missed).
      anim: 'land', animFallback: ['heavy'], startup: 0, active: 3, recovery: 18, friction: 30,
      hits: [{ box: { x: 0.35, y: 0, w: 2.8, h: 0.7, d: 1.25 }, damage: 4, hitstun: 22, knockback: 3.2, launch: 4.5, knockdown: true, hitstop: 6, level: 'heavy', otg: true, shake: 0.5 }],
    },
    run_attack: {
      // Shoulder barge: low priority dash attack (dash-clash specialist reads `clash`).
      clash: 'low', startup: 5, active: 7, recovery: 17,
      hits: [{ box: { x: 0.9, y: 0.4, w: 1.6, h: 1.3, d: 0.85 }, damage: 8, hitstun: 24, knockback: 5.2, launch: 4.5, knockdown: true, hitstop: 8, level: 'heavy', shake: 0.28 }],
      move: [{ from: 0, to: 11, speed: 7.2 }, { from: 11, to: 22, speed: 7.2, ease: 'out' }], // keeps the dash momentum through the active frames
    },
    jump_attack: {
      air: true, endOnLand: true, landInto: 'land', startup: 4, active: 40, recovery: 0,
      hits: [{ from: 4, to: 44, box: { x: 0.65, y: -0.35, w: 1.3, h: 1.4, d: 0.8 }, damage: 7, hitstun: 22, knockback: 3.0, launch: 3.5, knockdown: true, hitstop: 6, level: 'heavy', otg: true, shake: 0.2 }],
    },
    run_jump_attack: {
      air: true, endOnLand: true, landInto: 'land', anim: 'run_jump_attack', animFallback: ['jump_attack'], startup: 3, active: 40, recovery: 0,
      hits: [{ from: 3, to: 43, box: { x: 0.8, y: -0.3, w: 1.6, h: 1.5, d: 0.85 }, damage: 10, hitstun: 24, knockback: 5, launch: 4, knockdown: true, hitstop: 8, level: 'heavy', otg: true, shake: 0.3 }],
    },
    death_stab: {
      // Dash → jump → Light near the apex: hang, then plunge blade-first. Huge damage, OTG.
      // C2 r1: the hit volume is the BLADE TIP (measured in the plunge pose: 0.55 m ahead, 0.31 m above the feet), active
      // only once the blade has flipped down (mf 9), so the stab lands when the point is in the foe's head/shoulders
      // (a lying foe: the hero is ~0.3 m off the floor) instead of 0.7 m below the feet on the first active frame; the
      // plunge is a forward DIVE (5.6 m/s, vy -11) so he comes down on the foe; the stab PINS the body (knockback 2.5 → 0.4,
      // launch 3 → 1.2: a jolt, not a swat) so it stays under him and he lands on it.
      air: true, endOnLand: true, landInto: 'land', anim: 'death_stab', animFallback: ['jump_attack'], startup: 7, active: 45, recovery: 0,
      move: [{ from: 0, to: 7, speed: 1.2, vy: 1.2 }, { from: 7, to: 52, speed: 5.6, vy: -11 }],
      hits: [{ from: 9, to: 52, box: { x: 0.55, y: 0.16, w: 0.4, h: 0.4, d: 0.7 }, damage: 16, hitstun: 30, knockback: 0.4, launch: 1.2, knockdown: true, hitstop: 12, level: 'heavy', otg: true, shake: 0.5 }],
    },
    back_attack: {
      // Light+Jump: overhead swirl behind (always knocks down).
      anim: 'back_attack', animFallback: ['heavy'], startup: 4, active: 5, recovery: 16,
      hits: [{ box: { x: -0.8, y: 0.4, w: 1.4, h: 1.4, d: 0.85 }, damage: 8, hitstun: 22, knockback: 4.2, launch: 4, knockdown: true, hitstop: 7, level: 'heavy', shake: 0.2, dir: 'back' }],
    },
  },
};
