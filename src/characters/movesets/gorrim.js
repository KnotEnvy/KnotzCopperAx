// Gorrim's frame data: slow, huge damage/hitstop, the Copper Ax's wide arcs.
// Same string grammar as brann.js. Back attack = long invulnerable backward roll-stab (DESIGN §3).
const BOX = { x: 0.95, y: 0.2, w: 1.7, h: 1.25, d: 0.85 };
const POMMEL = { x: 0.55, y: 0.45, w: 0.9, h: 0.9, d: 0.75 };
const lightHit = { box: BOX, damage: 6, hitstun: 22, knockback: 1.8, hitstop: 7, level: 'light', shake: 0.16 };
const dodgeOnHit = (from, to) => ({ from, to, on: 'dodge', into: '@dodge', hit: true });

export default {
  id: 'gorrim',
  moves: {
    light_1: {
      startup: 8, active: 4, recovery: 15,
      hits: [lightHit],
      move: [{ from: 3, to: 10, speed: 2.0, ease: 'out' }],
      cancels: [
        { from: 0, to: 3, on: 'jump', into: 'back_attack' },
        { from: 11, to: 26, on: 'light', into: 'light_2', hit: true },
        dodgeOnHit(11, 26),
      ],
    },
    light_2: {
      startup: 7, active: 4, recovery: 16,
      hits: [lightHit],
      move: [{ from: 3, to: 9, speed: 2.0, ease: 'out' }],
      cancels: [
        { from: 10, to: 26, on: 'light', into: 'pommel_1', hit: true, cond: 'close' },
        { from: 10, to: 26, on: 'light', into: 'light_3', hit: true, cond: 'far' },
        { from: 10, to: 26, on: 'heavy', into: 'launcher', hit: true },
        dodgeOnHit(10, 26),
      ],
    },
    light_3: {
      startup: 10, active: 5, recovery: 24,
      hits: [{ box: { ...BOX, x: 1.05, w: 2.0, h: 1.4 }, damage: 11, hitstun: 26, knockback: 5.2, launch: 5.0, knockdown: true, hitstop: 11, level: 'heavy', shake: 0.4 }],
      move: [{ from: 5, to: 12, speed: 2.6, ease: 'out' }],
      cancels: [dodgeOnHit(16, 38)],
    },
    pommel_1: {
      anim: 'pommel', animFallback: ['light_2'], startup: 5, active: 2, recovery: 13,
      hits: [{ box: POMMEL, damage: 4, hitstun: 26, knockback: 0.3, hitstop: 6, level: 'light', shake: 0.12 }],
      cancels: [{ from: 7, to: 19, on: 'light', into: 'pommel_2', hit: true }, dodgeOnHit(7, 19)],
    },
    pommel_2: {
      anim: 'pommel', animFallback: ['light_1'], startup: 5, active: 2, recovery: 13,
      hits: [{ box: POMMEL, damage: 4, hitstun: 28, knockback: 0.3, hitstop: 6, level: 'light', shake: 0.12 }],
      cancels: [{ from: 7, to: 19, on: 'light', into: 'throw', hit: true, cond: 'aim', turn: false }, { from: 7, to: 19, on: 'light', into: 'close_finisher', hit: true }, dodgeOnHit(7, 19)],
    },
    close_finisher: {
      // Headbutt-and-heave (the grapple specialist turns it into Gorrim's throw).
      anim: 'kick', animFallback: ['light_3'], startup: 8, active: 4, recovery: 22,
      hits: [{ box: { x: 0.7, y: 0.4, w: 1.1, h: 1.0, d: 0.8 }, damage: 10, hitstun: 26, knockback: 6, launch: 5.5, knockdown: true, hitstop: 11, level: 'heavy', shake: 0.36 }],
    },
    throw: {
      // Close string → hold ←/→ + Light: heave the foe overhead and hurl it like a keg (DESIGN §3). Strongest throw.
      kind: 'throw', anim: 'throw', animFallback: ['heavy'], grab: 7, release: 20, total: 42, maxWeight: 2.2,
      lift: { x: 0.25, y: 1.55 }, fling: { speed: 8, vy: 2.4 }, damage: 11,
      impact: { damage: 10, knockback: 6, launch: 5.5, hitstun: 28, hitstop: 9, level: 'heavy', shake: 0.45 },
    },
    heavy: {
      charge: { at: 9, levels: [20, 46, 80], max: 160, scale: [ // hold Heavy: slow charge, biggest payoff
        { damage: 1.3, knockback: 1.15, launch: 1.05, hitstop: 2, shake: 1.2 },
        { damage: 1.7, knockback: 1.3, launch: 1.15, hitstop: 4, shake: 1.5 },
        { damage: 2.4, knockback: 1.6, launch: 1.3, hitstop: 7, shake: 1.9, guardBreak: true },
      ] },
      startup: 16, active: 5, recovery: 26,
      hits: [{ box: { x: 1.1, y: 0.0, w: 2.4, h: 1.5, d: 1.1 }, damage: 16, hitstun: 30, knockback: 6.0, launch: 5.5, knockdown: true, hitstop: 12, level: 'heavy', shake: 0.55 }],
      move: [{ from: 12, to: 20, speed: 3.0, ease: 'out' }],
      cancels: [dodgeOnHit(22, 46)],
    },
    launcher: {
      anim: 'launcher', animFallback: ['heavy'], startup: 11, active: 5, recovery: 24,
      hits: [{ box: { x: 0.95, y: 0.0, w: 1.7, h: 1.7, d: 0.9 }, damage: 9, hitstun: 30, knockback: 0.8, launch: 9, knockdown: true, hitstop: 10, level: 'heavy', shake: 0.34 }],
      move: [{ from: 7, to: 14, speed: 1.8, ease: 'out' }],
      cancels: [{ from: 16, to: 39, on: 'jump', into: '@jump', hit: true }, dodgeOnHit(16, 39)],
    },
    air_slam: {
      // Heavy in the air: Copper Ax meteor. Slowest plunge, biggest shockwave.
      air: true, endOnLand: true, landInto: 'air_slam_land', anim: 'air_slam', animFallback: ['death_stab', 'jump_attack'],
      startup: 8, active: 60, recovery: 0, gravity: 0.45,
      move: [{ from: 0, to: 8, speed: 0.4, vy: 1.8 }, { from: 8, to: 68, speed: 1.0, vy: -14 }],
      hits: [{ from: 8, to: 68, box: { x: 0.5, y: -0.8, w: 1.5, h: 1.5, d: 0.9 }, damage: 12, hitstun: 28, knockback: 1.8, bounce: 8, knockdown: true, hitstop: 10, level: 'heavy', otg: true, shake: 0.45 }],
    },
    air_slam_land: {
      anim: 'land', animFallback: ['heavy'], startup: 0, active: 4, recovery: 22, friction: 30,
      hits: [{ box: { x: 0.3, y: 0, w: 3.4, h: 0.7, d: 1.4 }, damage: 6, hitstun: 24, knockback: 3.6, launch: 4.5, knockdown: true, hitstop: 8, level: 'heavy', otg: true, shake: 0.6 }],
    },
    run_attack: {
      // Headbutt charge.
      clash: 'mid', anim: 'run_attack', startup: 6, active: 8, recovery: 20,
      hits: [{ box: { x: 0.8, y: 0.4, w: 1.5, h: 1.0, d: 0.9 }, damage: 10, hitstun: 26, knockback: 6.2, launch: 4.0, knockdown: true, hitstop: 10, level: 'heavy', shake: 0.34 }],
      move: [{ from: 0, to: 13, speed: 6.4 }, { from: 13, to: 24, speed: 6.4, ease: 'out' }],
    },
    jump_attack: {
      air: true, endOnLand: true, landInto: 'land', startup: 5, active: 40, recovery: 0,
      hits: [{ from: 5, to: 45, box: { x: 0.6, y: -0.4, w: 1.4, h: 1.3, d: 0.85 }, damage: 8, hitstun: 24, knockback: 3.2, launch: 3.5, knockdown: true, hitstop: 8, level: 'heavy', otg: true, shake: 0.25 }],
    },
    run_jump_attack: {
      air: true, endOnLand: true, landInto: 'land', anim: 'run_jump_attack', animFallback: ['jump_attack'], startup: 4, active: 40, recovery: 0,
      hits: [{ from: 4, to: 44, box: { x: 0.8, y: -0.4, w: 1.6, h: 1.4, d: 0.9 }, damage: 11, hitstun: 26, knockback: 5.4, launch: 4, knockdown: true, hitstop: 10, level: 'heavy', otg: true, shake: 0.35 }],
    },
    death_stab: {
      // C2 r1: hit volume = the axe's top SPIKE (plunge pose: 0.55 m ahead, 0.17 m above the feet), active from mf 10 once
      // the axe is reversed point-down (the old box reached 0.6 m below the feet and hit on the first active frame);
      // forward dive 5.0 m/s, vy -11 (see brann.js).
      air: true, endOnLand: true, landInto: 'land', anim: 'death_stab', animFallback: ['jump_attack'], startup: 8, active: 45, recovery: 0,
      move: [{ from: 0, to: 8, speed: 1.0, vy: 1.0 }, { from: 8, to: 53, speed: 5.0, vy: -11 }],
      hits: [{ from: 10, to: 53, box: { x: 0.55, y: 0.02, w: 0.4, h: 0.4, d: 0.75 }, damage: 18, hitstun: 30, knockback: 0.5, launch: 1.2, knockdown: true, hitstop: 13, level: 'heavy', otg: true, shake: 0.55 }],
    },
    back_attack: {
      // Long invulnerable backward roll-stab.
      anim: 'back_attack', animFallback: ['dodge_roll'], startup: 6, active: 12, recovery: 14, invuln: [0, 20],
      move: [{ from: 0, to: 18, speed: -5.5, ease: 'out' }],
      hits: [{ from: 6, to: 18, box: { x: -0.7, y: 0.1, w: 1.3, h: 1.0, d: 0.85 }, damage: 10, hitstun: 24, knockback: 4.6, launch: 4, knockdown: true, hitstop: 9, level: 'heavy', shake: 0.22, dir: 'back' }],
    },
  },
};
