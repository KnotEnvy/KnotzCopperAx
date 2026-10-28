// Hollow Knight (regular trooper, tiers silver / red / gold): own HALBERDIER clip set (enemies-art-2 r22, anim role).
// Before: the generic one-hander set (humanoid_base.js) carried the 2.15 m halberd like a sword (blade R 0.8), and the
// move clips were stretched over the knight's long startups, so every swing landed well before its hit box.
// Halberd (weapon_halberd.glb): grip_main at 0, grip_offhand at y -0.34 (BELOW the right hand), butt -0.65, tip +1.5,
// axe bit along weapon +X. With edge [0,0,1] the head's flat faces the side camera and the bit faces forward / leads
// the swing. Because the off hand sits below the main hand, two-handed holds need the right hand HIGH (guard, march,
// block, overhead chop); the sweep, thrust and counter are one-handed with the left arm thrown out for balance.
//   idle / guard   halberd upright before the right shoulder, both hands on the haft, head forward-up, heavy stance
//   walk           measured heavy march (can't run), halberd kept upright in both hands, no arm swing
//   heavy (sweep)  59 ticks = knight.js sweep total; hit at 22-29: wind back two-handed, low wide one-handed sweep
//   run_attack     48 ticks = thrust total; hit at 16-22: chamber at the right hip, long lunge
//   light_3 (chop) 67 ticks = chop total; hit at 28-33: two-handed overhead raise, armoured chop to the floor line
//   light_1        42 ticks = counter total; hit at 12-16: short cut from over the right shoulder
//   blocked        haft-block jolt (the frontal guard clank)
// Frame counts match the move totals so a frame = one tick (Combatant plays a move clip over total/60 s).
// Move timing lives in src/enemies/types/knight.js and is NOT changed here. Character 'knight' (types/knight.js
// animCharacter); the Captains keep 'boss_captain' and everything else falls through to the generic set.
import { dir, W, torso, feet, gait } from './_kit.js';

const ST = feet([0.24, 0, -0.07, 0, 6], [-0.24, 0, 0.11, 0, 30]);
const T = (p = 0, y = 0) => torso({ pelvis: -10, yaw: -6 + y, pitch: -5 + p, look: 0.9 });
const HG = (x = 0, y = 0, a = 0) => W([0.7 + x, 0.24 + y, 0.3], dir(2, 87 - a), [0, 0, 1]);   // upright guard hold, haft forward + out right of the legs
const g = (f, x = {}) => ({ f, pose: T(), hips: [0, -0.1, 0], ...ST, wpn: HG(), ...x });
const E = [0, 0, 1];
const LUNGE = feet([0.4, 0, -0.07, 0, 6], [-0.38, 0.03, 0.12, -16, 30]);

const walk = gait({
  P: 0.92, v: 1.75, duty: 0.6, cx: 0.3, lift: 0.1, heel: 0.08, bob: 0.03, hipsY: -0.1, width: 0.05, twist: 4, lean: -4, toeOut: 10,
  upper: (ph) => {
    const s = Math.sin(ph * Math.PI * 2), c = Math.cos(ph * Math.PI * 4);
    return { wpn: HG(0.02 * s, -0.02 * c, 2 + 2 * s) };   // the halberd rocks a little with each heavy step
  },
});

export default {
  rig: 'humanoid', character: ['knight'], priority: 6,
  clips: {
    idle: {
      frames: 150, loop: true, plant: 1, breathe: 1, tags: ['idle'],
      keys: [g(0), g(75, { pose: T(-1.5, 1), hips: [0, -0.115, 0], wpn: HG(0, -0.015, 1.5) }), g(150)],
    },
    walk: { duration: 0.92, loop: true, keys: walk, events: [{ n: 0.02, name: 'footstep', foot: 'L' }, { n: 0.52, name: 'footstep', foot: 'R' }] },

    // ---- sweep (heavy): 22 startup / 7 active / 30 recovery
    heavy: {
      frames: 59,
      keys: [
        g(0),
        // side-plane swing (reads from the belt-scroller camera): head hauled up behind, low wide sweep forward
        { f: 12, ease: 'out', pose: torso({ pelvis: -14, yaw: -16, pitch: -4 }), hips: [-0.04, -0.15, 0], ...feet([0.3, 0, -0.08, 0, 6], [-0.3, 0, 0.13, 0, 34]),
          wpn: W([0.2, 0.05, 0.65], dir(165, 18), [0, 1, 0]) },
        { f: 19, pose: torso({ pelvis: -12, yaw: -14, pitch: -6 }), hips: [-0.05, -0.16, 0], wpn: W([0.15, 0.02, 0.66], dir(168, 14), [0, 1, 0]) },
        { f: 21, pose: torso({ pelvis: -4, yaw: -4, pitch: -12 }), hips: [0.03, -0.19, 0], wpn: W([0.42, -0.12, 0.74], dir(90, 72), [0, 1, 0]) },   // haft swings through upright, clear of the legs
        { f: 22, ease: 'in', pose: torso({ pelvis: 4, yaw: 4, pitch: -18 }), hips: [0.1, -0.21, 0], ...LUNGE,
          wpn: W([0.62, -0.5, 0.62], dir(10, -12), [0, 1, 0]), handL: [0.3, -0.3, -0.55] },
        { f: 26, pose: torso({ pelvis: 12, yaw: 12, pitch: -20 }), hips: [0.13, -0.22, 0], wpn: W([0.75, -0.55, 0.42], dir(-8, -13), [0, 1, 0]), handL: [0.1, -0.25, -0.62] },
        { f: 31, ease: 'out', pose: torso({ pelvis: 16, yaw: 18, pitch: -18 }), hips: [0.13, -0.21, 0], wpn: W([0.64, -0.52, 0.3], dir(-30, -10), [0, 1, 0]), handL: [-0.05, -0.25, -0.62] },
        { f: 44, pose: torso({ pelvis: 14, yaw: 16, pitch: -16 }), hips: [0.11, -0.19, 0], wpn: W([0.62, -0.48, 0.32], dir(-26, -4), [0, 1, 0]), handL: [-0.02, -0.3, -0.6] },
        { f: 52, ease: 'inOut', pose: T(-3), hips: [0.04, -0.12, 0], wpn: W([0.74, 0.1, 0.5], dir(2, 62), E) },
        g(59, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 12, name: 'swing' }, { f: 22, name: 'impact' }],
    },

    // ---- thrust (run_attack): 16 startup / 6 active / 26 recovery
    run_attack: {
      frames: 48,
      keys: [
        g(0),
        { f: 10, ease: 'out', pose: torso({ pelvis: -16, yaw: -20, pitch: -6 }), hips: [-0.06, -0.14, 0], ...feet([0.28, 0, -0.08, 0, 6], [-0.3, 0, 0.13, 0, 34]),
          wpn: W([0.1, -0.3, 0.72], dir(-4, 4), [0, 1, 0]), handL: [0.5, -0.25, -0.2] },
        { f: 14, pose: torso({ pelvis: -18, yaw: -22, pitch: -7 }), hips: [-0.08, -0.15, 0], wpn: W([0.05, -0.3, 0.74], dir(-4, 4), [0, 1, 0]), handL: [0.52, -0.24, -0.22] },
        { f: 16, ease: 'in', pose: torso({ pelvis: 10, yaw: 12, pitch: -16 }), hips: [0.18, -0.18, 0], ...LUNGE,
          wpn: W([0.85, -0.2, 0.45], dir(-6, 2), [0, 1, 0]), handL: [0.0, -0.4, -0.6] },
        { f: 22, pose: torso({ pelvis: 12, yaw: 14, pitch: -17 }), hips: [0.2, -0.19, 0], wpn: W([0.88, -0.22, 0.44], dir(-6, 1), [0, 1, 0]), handL: [-0.05, -0.4, -0.6] },
        { f: 34, ease: 'inOut', pose: torso({ pelvis: 2, yaw: 2, pitch: -10 }), hips: [0.12, -0.15, 0], wpn: W([0.7, 0.0, 0.55], dir(0, 45), [0, 0, 1]), handL: [0.25, -0.3, -0.45] },
        { f: 41, pose: T(-2), hips: [0.03, -0.11, 0], wpn: W([0.72, 0.18, 0.5], dir(2, 74), E) },   // raise the haft out right, then back to guard
        g(48, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 10, name: 'swing' }, { f: 16, name: 'impact' }],
    },

    // ---- chop (light_3): 28 startup / 5 active / 34 recovery
    light_3: {
      frames: 67,
      keys: [
        g(0),
        { f: 16, ease: 'out', pose: torso({ pelvis: -8, yaw: -8, pitch: 8, look: 1 }), hips: [-0.04, -0.06, 0], ...feet([0.26, 0.02, -0.07, 4, 6], [-0.26, 0, 0.12, -6, 30]),
          wpn: W([0.3, 0.95, 0.2], dir(172, 48), E) },
        { f: 25, pose: torso({ pelvis: -10, yaw: -10, pitch: 11, look: 1 }), hips: [-0.06, -0.05, 0], wpn: W([0.24, 1.0, 0.2], dir(176, 40), E) },
        { f: 28, ease: 'in', pose: torso({ pelvis: 6, yaw: 4, pitch: -28 }), hips: [0.16, -0.24, 0], ...LUNGE, wpn: W([0.85, 0.0, 0.3], dir(0, -28), E) },
        { f: 33, ease: 'out', pose: torso({ pelvis: 8, yaw: 4, pitch: -32 }), hips: [0.18, -0.27, 0], wpn: W([0.85, -0.1, 0.3], dir(0, -34), E) },
        { f: 50, pose: torso({ pelvis: 8, yaw: 4, pitch: -28 }), hips: [0.17, -0.25, 0], wpn: W([0.84, -0.08, 0.42], dir(0, -32), E) },
        { f: 59, ease: 'inOut', pose: T(-6), hips: [0.06, -0.14, 0], wpn: W([0.78, 0.12, 0.5], dir(2, 62), E) },
        g(67, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 16, name: 'swing' }, { f: 28, name: 'impact' }],
    },

    // ---- counter (light_1): 12 startup / 4 active / 26 recovery
    light_1: {
      frames: 42,
      keys: [
        g(0),
        { f: 7, ease: 'out', pose: torso({ pelvis: -16, yaw: -18, pitch: 2 }), hips: [-0.03, -0.1, 0], wpn: W([0.35, 0.45, 0.45], dir(160, 55), E), handL: [0.45, -0.1, -0.25] },
        { f: 12, ease: 'in', pose: torso({ pelvis: 10, yaw: 12, pitch: -16 }), hips: [0.1, -0.15, 0], ...LUNGE, wpn: W([0.75, -0.12, 0.35], dir(2, -18), E), handL: [0.2, -0.4, -0.5] },
        { f: 16, ease: 'out', pose: torso({ pelvis: 16, yaw: 16, pitch: -18 }), hips: [0.12, -0.16, 0], wpn: W([0.66, -0.34, 0.2], dir(-24, -30), E), handL: [0.05, -0.35, -0.6] },
        { f: 28, pose: torso({ pelvis: 14, yaw: 14, pitch: -16 }), hips: [0.11, -0.15, 0], wpn: W([0.64, -0.32, 0.22], dir(-20, -26), E), handL: [0.08, -0.38, -0.58] },
        g(42, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 7, name: 'swing' }, { f: 12, name: 'impact' }],
    },

    // ---- frontal guard clank: the haft takes the hit, a short jolt back, both hands stay on
    blocked: {
      frames: 24, look: 0.6, plant: 0.6,
      keys: [
        g(0),
        { f: 2, ease: 'outExpo', pose: T(10, 8), hips: [-0.08, -0.12, 0], wpn: HG(-0.06, 0.08, -6) },
        { f: 8, pose: T(6, 5), hips: [-0.07, -0.12, 0], wpn: HG(-0.04, 0.05, -4) },
        g(24, { ease: 'inOut' }),
      ],
    },
  },
};
