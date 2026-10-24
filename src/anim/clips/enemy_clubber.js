// Clubber archetype (Ashen Marauders and any club/mace grunt): a brawler, not a fencer. Slouched and cocky, club on
// the shoulder, telegraphed wind-ups the player can READ (Golden Axe Heninger DNA, Streets of Rage 4 readability):
// every attack has a clear anticipation silhouette, a snap, and an over-committed follow-through that leaves an
// opening. Frames match enemies/types/marauder.js (swing 11/4/22, smash 18/5/28; jab 6/3/12 for faster tiers).
// Reactions (hit_high/low, knockdown, launched, thrown, getup, death, blocked...) come from humanoid_base.js.
import { dir, W, torso, feet, gait, swingArm } from './_kit.js';

const ST = feet([0.18, 0, -0.05, 0, 10], [-0.18, 0, 0.08, 0, 28]);
const ST_W = feet([0.28, 0, -0.06, 0, 8], [-0.28, 0, 0.1, 0, 32]);
// club resting on the right shoulder, head behind
const SHOULDER = W([0.12, 0.08, 0.42], dir(172, 44), [0, 0.4, 1]);
const G_T = torso({ pelvis: -12, yaw: 6, pitch: -12, look: 0.9 });
const GUARD = { pose: G_T, hips: [0, -0.1, 0], ...ST, wpn: SHOULDER, handL: [0.36, -0.3, -0.34] };
const g = (f, x = {}) => ({ f, ...GUARD, ...x });

const walk = gait({
  P: 0.76, v: 2.3, duty: 0.56, cx: 0.34, lift: 0.12, heel: 0.1, bob: 0.03, hipsY: -0.1, twist: 9, lean: -12, sway: 0.025, toeOut: 14,
  upper: (ph) => {  // swaggering: club bouncing on the shoulder, free arm swinging wide
    const s = Math.sin(ph * Math.PI * 2), b = Math.sin(ph * Math.PI * 4);
    return { wpn: W([0.12, 0.08 + b * 0.02, 0.42], dir(172, 44 + b * 4), [0, 0.4, 1]), pose: swingArm('L', -26 * s, 34, 0.34) };
  },
});
const run = gait({
  P: 0.56, v: 5.2, duty: 0.3, cx: 0.4, lift: 0.28, heel: 0.1, bob: 0.045, hipsY: -0.11, twist: 12, lean: -18, flight: 0.1,
  upper: (ph) => {  // club raised, hollering charge
    const s = Math.sin(ph * Math.PI * 2);
    return { wpn: W([0.2 + s * 0.06, 0.34, 0.4], dir(150, 60), [0, 0.4, 1]), pose: swingArm('L', -50 * s, 80, 0.26) };
  },
});

export default {
  rig: 'humanoid', character: ['marauder'], priority: 5,
  clips: {
    idle: {  // shifting weight, rolling the shoulders, tapping the club
      frames: 120, loop: true, plant: 1, breathe: 1, tags: ['idle'],
      keys: [
        g(0),
        g(30, { pose: torso({ pelvis: -14, yaw: 8, pitch: -13, look: 0.9, hy: 8 }), hips: [0.01, -0.105, 0.01], wpn: W([0.12, 0.12, 0.42], dir(172, 50), [0, 0.4, 1]) }),
        g(60, { pose: torso({ pelvis: -10, yaw: 4, pitch: -11, roll: -3, look: 0.9 }), hips: [0, -0.095, -0.015] }),
        g(90, { pose: torso({ pelvis: -13, yaw: 7, pitch: -12.5, look: 0.9, hy: -6 }), wpn: W([0.12, 0.1, 0.42], dir(172, 47), [0, 0.4, 1]), handL: [0.4, -0.26, -0.3] }),
        g(120),
      ],
    },
    walk: { duration: 0.76, loop: true, keys: walk, events: [{ n: 0.02, name: 'footstep', foot: 'L' }, { n: 0.52, name: 'footstep', foot: 'R' }] },
    run: { duration: 0.56, loop: true, keys: run, events: [{ n: 0.02, name: 'footstep', foot: 'L' }, { n: 0.52, name: 'footstep', foot: 'R' }] },

    // swing: wild right→left haymaker. Long readable coil (club drawn way back, free arm pointing), snap, over-spin.
    swing: {
      frames: 37,
      keys: [
        g(0),
        { f: 6, ease: 'out', pose: torso({ pelvis: -24, yaw: -30, pitch: -6, look: 1 }), hips: [-0.05, -0.12, 0], ...ST_W,
          wpn: W([-0.1, 0.24, 0.5], dir(160, 20), [0, 0.8, 0.5]), handL: [0.6, 0.02, -0.2] },
        { f: 10, ease: 'in', pose: torso({ pelvis: -28, yaw: -36, pitch: -4, look: 1 }), hips: [-0.07, -0.13, 0], wpn: W([-0.16, 0.26, 0.52], dir(166, 18), [0, 0.8, 0.5]), handL: [0.62, 0.06, -0.2] },
        { f: 11, ease: 'linear', pose: torso({ pelvis: 12, yaw: 10, pitch: -12 }), hips: [0.1, -0.13, 0], ...feet([0.34, 0, -0.06, 0, 8], [-0.34, 0, 0.1, 0, 32]),
          wpn: W([0.7, 0.06, 0.1], dir(0, 4), [0, 0.8, 0.5]), handL: [0.1, -0.2, -0.45] },
        { f: 15, ease: 'outCubic', pose: torso({ pelvis: 34, yaw: 34, pitch: -14 }), hips: [0.14, -0.14, 0], ...feet([0.34, 0, -0.06, 0, 8], [-0.4, 0.04, 0.1, -12, 20]),
          wpn: W([0.3, -0.12, -0.5], dir(-110, -16), [0, 0.8, -0.5]), handL: [-0.2, -0.3, -0.45] },
        { f: 24, pose: torso({ pelvis: 38, yaw: 38, pitch: -12 }), hips: [0.13, -0.13, 0], wpn: W([0.2, -0.2, -0.52], dir(-130, -24), [0, 0.8, -0.5]) },
        { f: 31, ease: 'inOut', pose: torso({ pelvis: 0, yaw: 10, pitch: -12 }), hips: [0.04, -0.1, 0], ...ST, wpn: W([0.3, -0.2, 0.3], dir(30, 30), [0, 0.4, 1]), handL: [0.36, -0.3, -0.34] },
        g(37, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 8, name: 'swing' }, { f: 11, name: 'impact' }],
    },
    // smash: armoured overhead. Club hoisted high with a war-cry rock back (the armour window), then slammed to the floor.
    smash: {
      frames: 51,
      keys: [
        g(0),
        { f: 6, ease: 'out', pose: torso({ pelvis: -8, yaw: -4, pitch: 10, look: 0.8, hp: 10 }), hips: [-0.04, -0.06, 0], ...ST_W,
          wpn: W([0.0, 0.9, 0.3], dir(170, 50), [0, 0, 1]), handL: [0.5, 0.3, -0.3] },
        { f: 14, pose: torso({ pelvis: -8, yaw: -6, pitch: 16, look: 0.9, hp: 12 }), hips: [-0.06, -0.04, 0], wpn: W([-0.12, 0.96, 0.28], dir(178, 34), [0, 0, 1]), handL: [0.55, 0.4, -0.3] },
        { f: 17, ease: 'in', pose: torso({ pelvis: 0, yaw: 0, pitch: 4 }), hips: [0.04, -0.06, 0], wpn: W([0.36, 0.84, 0.2], dir(10, 76), [0, 0, 1]), handL: [0.3, 0.2, -0.4] },
        { f: 18, ease: 'linear', pose: torso({ pelvis: 6, yaw: 4, pitch: -30, look: 0.8 }), hips: [0.16, -0.22, 0], ...feet([0.4, 0, -0.06, 0, 8], [-0.36, 0, 0.1, 0, 32]),
          wpn: W([0.74, 0.02, 0.2], dir(0, -30), [0, 0, 1]), handL: [0.1, -0.4, -0.45] },
        { f: 22, ease: 'outCubic', pose: torso({ pelvis: 8, yaw: 4, pitch: -38, look: 0.8 }), hips: [0.18, -0.27, 0], wpn: W([0.62, -0.34, 0.2], dir(0, -60), [0, 0, 1]) },
        { f: 34, pose: torso({ pelvis: 8, yaw: 5, pitch: -36, look: 0.8 }), hips: [0.17, -0.26, 0], wpn: W([0.6, -0.36, 0.2], dir(0, -62), [0, 0, 1]) },
        { f: 44, ease: 'inOut', pose: torso({ pelvis: -6, yaw: 6, pitch: -14 }), hips: [0.06, -0.12, 0], ...ST, wpn: W([0.3, -0.2, 0.36], dir(40, 30), [0, 0, 1]), handL: [0.36, -0.3, -0.34] },
        g(51, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 15, name: 'swing' }, { f: 18, name: 'impact' }],
    },
    // jab: quick left-hand shove / club-butt poke for the faster tiers (6 / 3 / 12)
    jab: {
      frames: 21,
      keys: [
        g(0),
        { f: 4, ease: 'out', pose: torso({ pelvis: -16, yaw: -10, pitch: -8 }), hips: [-0.03, -0.11, 0], handL: [0.24, 0.1, -0.28] },
        { f: 6, ease: 'outCubic', pose: torso({ pelvis: 14, yaw: 14, pitch: -14 }), hips: [0.1, -0.12, 0], ...feet([0.3, 0, -0.06, 0, 8], [-0.26, 0, 0.1, 0, 28]),
          handL: [0.86, 0.16, -0.08] },
        { f: 9, pose: torso({ pelvis: 12, yaw: 12, pitch: -13 }), hips: [0.09, -0.12, 0], handL: [0.8, 0.14, -0.1] },
        g(21, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 4, name: 'swing' }, { f: 6, name: 'impact' }],
    },
    // taunt: beckon with the free hand, slap the club into the palm
    taunt: {
      frames: 64, plant: 1,
      keys: [
        g(0),
        { f: 8, ease: 'out', pose: torso({ pelvis: -8, yaw: 10, pitch: 4, look: 0.8, hp: 8 }), hips: [0, -0.07, 0], handL: [0.62, 0.2, -0.2] },
        { f: 13, ease: 'inOut', handL: [0.42, 0.28, -0.16] },
        { f: 18, ease: 'inOut', handL: [0.64, 0.2, -0.2] },
        { f: 23, ease: 'inOut', handL: [0.42, 0.28, -0.16] },
        { f: 32, ease: 'out', pose: torso({ pelvis: -12, yaw: 4, pitch: -10, look: 0.9 }), hips: [0, -0.1, 0], wpn: W([0.36, 0.14, 0.12], dir(-40, 30), [0, 0, 1]), handL: [0.42, -0.02, -0.08] },
        { f: 36, ease: 'in', wpn: W([0.38, 0.22, 0.12], dir(-30, 50), [0, 0, 1]) },
        { f: 38, ease: 'outCubic', wpn: W([0.38, 0.06, 0.12], dir(-40, 10), [0, 0, 1]) },
        { f: 44, ease: 'in', wpn: W([0.38, 0.22, 0.12], dir(-30, 50), [0, 0, 1]) },
        { f: 46, ease: 'outCubic', wpn: W([0.38, 0.06, 0.12], dir(-40, 10), [0, 0, 1]) },
        g(64, { ease: 'inOut' }),
      ],
      events: [{ f: 8, name: 'roar' }, { f: 38, name: 'impact' }, { f: 46, name: 'impact' }],
    },
  },
};
