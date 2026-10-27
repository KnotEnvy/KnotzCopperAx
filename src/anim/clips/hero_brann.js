// Brann Stormhewn — heavy two-handed greatsword (Grudgebrand). Big wind-ups, huge arcs driven by the pelvis and
// torso, committed lunges, long follow-through, weight settling through the legs. Frames match
// characters/movesets/brann.js (strike pose on the first ACTIVE tick). Both hands stay on the grip (profile
// grip lock) except where a key sets grip: 0 (kick, throw, grabs, run).
// Weapon goals: W(at, blade, flat) — `at` = right-hand grip point from the posed chest in arm lengths.
import { dir, W, torso, pose, gait, arm, feet } from './_kit.js';
import { rideSet } from './_ride.js';

// ----------------------------------------------------------------------------------------------- stances
const ST = feet([0.22, 0, -0.03, 0, 6], [-0.23, 0, 0.07, 0, 30]);            // guard: left foot leads
const ST_WIDE = feet([0.3, 0, -0.05, 0, 5], [-0.27, 0, 0.1, 0, 34]);
const G_HIPS = [0, -0.1, 0];
const G_TORSO = torso({ pelvis: -14, yaw: 6, pitch: -6, look: 0.9 });
const G_WPN = W([0.45, -0.3, 0.1], dir(-12, 38), [0, 0.2, 1]);
const GUARD = { pose: G_TORSO, hips: G_HIPS, ...ST, wpn: G_WPN, grip: 1 };
const g = (f, extra = {}) => ({ f, ...GUARD, ...extra });

// ----------------------------------------------------------------------------------------------- locomotion
// Locomotion carry is separate from GUARD so combat poses and hit frames stay unchanged.
const CARRY = W([0.42, -0.32, 0.24], dir(-55, 22), [0, 0.2, 1]);
const walk = gait({
  P: 0.6, v: 3.2, duty: 0.5, cx: 0.4, lift: 0.13, heel: 0.12, bob: 0.028, hipsY: -0.09, hipsX: 0.03, twist: 5, lean: -8,
  upper: (ph) => {
    const b = Math.sin(ph * Math.PI * 4);                        // two steps per cycle
    const s = Math.sin(ph * Math.PI * 2);
    return { pose: torso({ pelvis: -5 * s, yaw: 13 * s, pitch: -8 + b * 2, roll: 4 * s, pelvisRoll: -2 * s, look: 0.9 }),
      wpn: W([0.42 + s * 0.085, -0.32 + b * 0.075, 0.24 + s * 0.055], dir(-55 + s * 9, 22 + b * 6), [0, 0.2, 1]), grip: 1 };
  },
});
const run = gait({
  P: 0.56, v: 7.0, duty: 0.24, cx: 0.44, lift: 0.32, heel: 0.1, bob: 0.045, hipsY: -0.1, hipsX: 0.06, twist: 10, lean: -16,
  flight: 0.1, strike: 6, pushOff: 38,
  upper: (ph) => {
    const s = Math.sin(ph * Math.PI * 2);
    return {
      // Raised outside carry stays in the idle/walk hemisphere throughout a crossfade.
      // The old 172deg/-28deg trailing carry interpolated down through the front leg.
      // Left arm counter-swings; the right elbow yields to every stride.
      wpn: W([0.34 + s * 0.055, -0.27 + Math.cos(ph * Math.PI * 4) * 0.035, 0.36], dir(-58 + s * 4, 28 + s * 3), [0, 0.2, 1]), grip: 0,
      pose: arm('L', { upper: [0.72 * s, -0.76, -0.42], fore: [0.6 + 0.65 * s, 0.14 + 0.3 * s, -0.34] }),
    };
  },
});

export default {
  rig: 'humanoid', character: 'brann', priority: 10,
  clips: {
    // riding: greatsword carried one-handed, blade up; a big one-armed overhead hack from the saddle
    ...rideSet({ carry: W([0.34, -0.1, 0.44], dir(10, 62), [0, 0, 1]), up: W([-0.05, 0.9, 0.36], dir(170, 40), [0, 0, 1]), hit: W([0.78, 0.0, 0.34], dir(10, -30), [0, 0, 1]), follow: W([0.6, -0.42, 0.3], dir(0, -62), [0, 0, 1]) }),
    idle: {
      frames: 150, loop: true, plant: 1, breathe: 1, tags: ['idle'],
      keys: [
        g(0, { wpn: CARRY, pose: torso({ pelvis: -12, yaw: 4, pitch: -5, roll: -1, look: 0.9 }) }),
        g(50, { pose: torso({ pelvis: -17, yaw: 9, pitch: -8, roll: 3, look: 0.9 }), hips: [0.022, -0.072, 0.022], wpn: W([0.43, -0.30, 0.24], dir(-53, 24), [0, 0.2, 1]) }),
        g(100, { pose: torso({ pelvis: -11, yaw: 3, pitch: -5, roll: -3, look: 0.9, hy: 4 }), hips: [-0.018, -0.095, -0.020], wpn: W([0.41, -0.33, 0.25], dir(-57, 20), [0, 0.2, 1]) }),
        g(150, { wpn: CARRY }),
      ],
    },
    walk: { duration: 0.6, loop: true, keys: walk, events: [{ n: 0.02, name: 'footstep', foot: 'L' }, { n: 0.52, name: 'footstep', foot: 'R' }] },
    run: { duration: 0.56, loop: true, grip: 0, keys: run, events: [{ n: 0.02, name: 'footstep', foot: 'L' }, { n: 0.52, name: 'footstep', foot: 'R' }] },

    // ------------------------------------------------------------------------------------------- the string
    // light_1: forehand horizontal cleave, right → left (6 / 3 / 14)
    light_1: {
      frames: 23,
      keys: [
        g(0),
        { f: 3, ease: 'out', pose: torso({ pelvis: -26, yaw: -22, pitch: -4 }), hips: [-0.04, -0.09, 0], wpn: W([0.05, 0.26, 0.55], dir(138, 16), [0, 0.8, 0.5]),
          ...feet([0.2, 0, -0.03, 0, 6], [-0.24, 0, 0.07, 0, 30]) },
        { f: 5, ease: 'in', pose: torso({ pelvis: -6, yaw: -8, pitch: -8 }), hips: [0.05, -0.1, 0], wpn: W([0.48, 0.06, 0.46], dir(62, 4), [0, 0.8, 0.5]),
          ...feet([0.3, 0.03, -0.03, 0, 6], [-0.32, 0, 0.07, 0, 30]) },
        { f: 6, ease: 'linear', pose: torso({ pelvis: 14, yaw: 14, pitch: -11 }), hips: [0.11, -0.12, 0], wpn: W([0.72, -0.04, 0.12], dir(0, 0), [0, 0.8, 0.5]),
          ...feet([0.36, 0, -0.03, 0, 6], [-0.38, 0, 0.07, 0, 30]) },
        { f: 9, ease: 'out', pose: torso({ pelvis: 26, yaw: 24, pitch: -12 }), hips: [0.13, -0.12, 0], wpn: W([0.56, -0.06, -0.34], dir(-66, -6), [0, 0.8, -0.5]),
          ...feet([0.36, 0, -0.03, 0, 6], [-0.42, 0.02, 0.07, -8, 30]) },
        { f: 13, pose: torso({ pelvis: 29, yaw: 28, pitch: -11 }), hips: [0.12, -0.115, 0], wpn: W([0.36, -0.14, -0.46], dir(-108, -14), [0, 0.8, -0.5]) },
        { f: 18, ease: 'inOut', pose: torso({ pelvis: 4, yaw: 12, pitch: -8 }), hips: [0.04, -0.09, 0], wpn: W([0.42, -0.26, -0.02], dir(-35, 22), [0, 0.4, 1]),
          ...feet([0.26, 0, -0.03, 0, 6], [-0.26, 0.06, 0.07, 0, 30]) },
        g(23, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 3, name: 'swing' }, { f: 6, name: 'impact' }],
    },
    // light_2: backhand rising diagonal, left-low → right-high (5 / 3 / 15)
    light_2: {
      frames: 23,
      keys: [
        { f: 0, pose: torso({ pelvis: 26, yaw: 24, pitch: -10 }), hips: [0.08, -0.11, 0], wpn: W([0.4, -0.18, -0.4], dir(-118, -10), [0, 0.8, -0.5]), grip: 1, ...ST },
        { f: 3, ease: 'out', pose: torso({ pelvis: 30, yaw: 30, pitch: -14 }), hips: [0.02, -0.13, 0], wpn: W([0.22, -0.34, -0.5], dir(-150, -26), [0, 0.6, -0.8]),
          ...feet([0.22, 0, -0.03, 0, 6], [-0.24, 0, 0.07, 0, 30]) },
        { f: 5, ease: 'in', pose: torso({ pelvis: 2, yaw: -4, pitch: -9 }), hips: [0.1, -0.1, 0], wpn: W([0.72, 0.05, -0.04], dir(8, 26), [0, -0.5, 1]),
          ...feet([0.34, 0, -0.03, 0, 6], [-0.36, 0, 0.07, 0, 30]) },
        { f: 8, ease: 'out', pose: torso({ pelvis: -18, yaw: -20, pitch: -3 }), hips: [0.12, -0.07, 0], wpn: W([0.5, 0.36, 0.34], dir(58, 52), [-0.5, 0, 1]),
          ...feet([0.36, 0, -0.03, 0, 6], [-0.4, 0.03, 0.07, -10, 30]) },
        { f: 12, pose: torso({ pelvis: -22, yaw: -24, pitch: 1 }), hips: [0.1, -0.065, 0], wpn: W([0.32, 0.46, 0.44], dir(112, 60), [-0.5, 0, 1]) },
        { f: 17, ease: 'inOut', pose: torso({ pelvis: -16, yaw: -4, pitch: -5 }), hips: [0.04, -0.08, 0], wpn: W([0.44, -0.12, 0.2], dir(20, 48), [0, 0.2, 1]),
          ...feet([0.26, 0, -0.03, 0, 6], [-0.26, 0.06, 0.07, 0, 30]) },
        g(23, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 3, name: 'swing' }, { f: 5, name: 'impact' }],
    },
    // light_3: overhead chop into the ground (8 / 4 / 22) — knockdown finisher
    light_3: {
      frames: 34,
      keys: [
        g(0, { hips: [0.02, -0.08, 0] }),
        { f: 3, ease: 'out', pose: torso({ pelvis: -8, yaw: -6, pitch: 4 }), hips: [-0.02, -0.1, 0], wpn: W([0.2, 0.55, 0.22], dir(150, 62), [0, 0, 1]), grip: 1 },
        { f: 6, ease: 'out', pose: torso({ pelvis: -4, yaw: -4, pitch: 13, look: 1 }), hips: [-0.05, -0.03, 0], wpn: W([-0.14, 1.0, 0.14], dir(180, 38), [0, 0, 1]),
          ...feet([0.28, 0.1, -0.03, 12, 6], [-0.22, 0.04, 0.07, -18, 30]) },
        { f: 7, ease: 'in', pose: torso({ pelvis: 2, yaw: 0, pitch: 0 }), hips: [0.06, -0.08, 0], wpn: W([0.38, 0.82, 0.08], dir(0, 78), [0, 0, 1]),
          ...feet([0.42, 0.06, -0.03, 8, 6], [-0.28, 0.02, 0.07, -10, 30]) },
        { f: 8, ease: 'linear', pose: torso({ pelvis: 8, yaw: 4, pitch: -28, look: 0.8 }), hips: [0.18, -0.2, 0], wpn: W([0.76, 0.14, 0.05], dir(0, -20), [0, 0, 1]),
          ...feet([0.48, 0, -0.03, 0, 6], [-0.42, 0, 0.07, 0, 30]) },
        { f: 11, ease: 'outCubic', pose: torso({ pelvis: 8, yaw: 4, pitch: -35, look: 0.8 }), hips: [0.2, -0.25, 0], wpn: W([0.62, -0.26, 0.05], dir(0, -46), [0, 0, 1]),
          ...feet([0.48, 0, -0.03, 0, 6], [-0.46, 0.04, 0.07, -16, 30]) },
        { f: 17, pose: torso({ pelvis: 8, yaw: 5, pitch: -33, look: 0.85 }), hips: [0.19, -0.245, 0], wpn: W([0.58, -0.3, 0.06], dir(0, -50), [0, 0, 1]) },
        { f: 26, ease: 'inOut', pose: torso({ pelvis: -6, yaw: 6, pitch: -12 }), hips: [0.08, -0.12, 0], wpn: W([0.46, -0.26, 0.1], dir(-6, 12), [0, 0.2, 1]),
          ...feet([0.32, 0, -0.03, 0, 6], [-0.26, 0.08, 0.07, 0, 30]) },
        g(34, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 5, name: 'swing' }, { f: 8, name: 'impact' }],
    },

    // ------------------------------------------------------------------------------------------- heavy (hold = charge)
    // Stormhewn cleave: coil the whole body back over the right leg, uncoil through a stepping lunge (14 / 4 / 24).
    // Frame 8 is the charge hold (Hero freezes here; heavy_charge overlays a deeper coil + tremble).
    heavy: {
      frames: 42,
      keys: [
        g(0),
        { f: 5, ease: 'out', pose: torso({ pelvis: -30, yaw: -34, pitch: -2, look: 1 }), hips: [-0.06, -0.12, 0], wpn: W([0.02, 0.3, 0.6], dir(150, 24), [0, 0.7, 0.7]), grip: 1, ...ST_WIDE },
        { f: 8, ease: 'out', pose: torso({ pelvis: -38, yaw: -44, pitch: 0, look: 1 }), hips: [-0.085, -0.15, 0], wpn: W([-0.14, 0.36, 0.62], dir(168, 18), [0, 0.8, 0.6]), ...ST_WIDE },
        { f: 11, ease: 'in', pose: torso({ pelvis: -30, yaw: -40, pitch: -4, look: 1 }), hips: [-0.02, -0.14, 0], wpn: W([-0.08, 0.32, 0.64], dir(158, 12), [0, 0.8, 0.6]),
          ...feet([0.44, 0.09, -0.05, 10, 5], [-0.3, 0, 0.1, 0, 34]) },
        { f: 13, ease: 'in', pose: torso({ pelvis: -6, yaw: -16, pitch: -8, look: 0.9 }), hips: [0.12, -0.16, 0], wpn: W([0.42, 0.14, 0.56], dir(78, 4), [0, 0.8, 0.6]),
          ...feet([0.56, 0.02, -0.05, 0, 5], [-0.38, 0, 0.1, 0, 34]) },
        { f: 14, ease: 'linear', pose: torso({ pelvis: 20, yaw: 14, pitch: -13 }), hips: [0.22, -0.18, 0], wpn: W([0.8, 0.0, 0.1], dir(0, -3), [0, 0.8, 0.6]),
          ...feet([0.58, 0, -0.05, 0, 5], [-0.44, 0, 0.1, 0, 34]) },
        { f: 17, ease: 'out', pose: torso({ pelvis: 40, yaw: 36, pitch: -15 }), hips: [0.25, -0.18, 0], wpn: W([0.56, -0.05, -0.46], dir(-76, -8), [0, 0.8, -0.6]),
          ...feet([0.58, 0, -0.05, 0, 5], [-0.48, 0.08, 0.1, -26, 22]) },
        { f: 22, pose: torso({ pelvis: 50, yaw: 44, pitch: -13 }), hips: [0.24, -0.175, 0], wpn: W([0.24, -0.1, -0.56], dir(-132, -12), [0, 0.8, -0.6]) },
        { f: 31, ease: 'inOut', pose: torso({ pelvis: 22, yaw: 16, pitch: -9 }), hips: [0.12, -0.11, 0], wpn: W([0.36, -0.24, -0.2], dir(-62, 12), [0, 0.5, 0.8]),
          ...feet([0.38, 0, -0.05, 0, 5], [-0.24, 0.1, 0.07, 0, 30]) },
        g(42, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 11, name: 'swing' }, { f: 14, name: 'impact' }],
    },
    heavy_charge: {
      frames: 40, loop: true, grip: 1,
      keys: [
        { f: 0, pose: torso({ pelvis: -40, yaw: -47, pitch: 2, look: 1 }), hips: [-0.095, -0.18, 0], wpn: W([-0.18, 0.4, 0.62], dir(170, 22), [0, 0.8, 0.6]), ...ST_WIDE },
        { f: 20, pose: torso({ pelvis: -42, yaw: -50, pitch: 4, look: 1 }), hips: [-0.1, -0.2, 0], wpn: W([-0.22, 0.44, 0.6], dir(174, 26), [0, 0.8, 0.6]), ...ST_WIDE },
        { f: 40, pose: torso({ pelvis: -40, yaw: -47, pitch: 2, look: 1 }), hips: [-0.095, -0.18, 0], wpn: W([-0.18, 0.4, 0.62], dir(170, 22), [0, 0.8, 0.6]), ...ST_WIDE },
      ],
    },
    // launcher: crouch, then rip the blade up through the foe and finish overhead (9 / 4 / 22)
    launcher: {
      frames: 35,
      keys: [
        g(0),
        { f: 5, ease: 'out', pose: torso({ pelvis: -20, yaw: -24, pitch: -20, look: 1 }), hips: [-0.02, -0.25, 0], wpn: W([0.1, -0.56, 0.46], dir(160, -32), [0, 0.3, 1]), grip: 1, ...ST_WIDE },
        { f: 8, ease: 'in', pose: torso({ pelvis: -6, yaw: -8, pitch: -14 }), hips: [0.06, -0.22, 0], wpn: W([0.58, -0.36, 0.26], dir(30, -18), [0, 0.3, 1]), ...ST_WIDE },
        { f: 9, ease: 'linear', pose: torso({ pelvis: 4, yaw: 2, pitch: -4 }), hips: [0.12, -0.08, 0], wpn: W([0.72, 0.1, 0.1], dir(0, 40), [0, 0, 1]),
          ...feet([0.36, 0, -0.05, 0, 5], [-0.3, 0.02, 0.1, -8, 34]) },
        { f: 12, ease: 'out', pose: torso({ pelvis: 4, yaw: 0, pitch: 14 }), hips: [0.14, 0.03, 0], wpn: W([0.34, 0.88, 0.14], dir(8, 86), [0, 0, 1]),
          ...feet([0.36, 0.02, -0.05, -22, 5], [-0.3, 0.12, 0.1, -38, 34]) },
        { f: 18, pose: torso({ pelvis: 2, yaw: 0, pitch: 12 }), hips: [0.13, 0.01, 0], wpn: W([0.26, 0.9, 0.12], dir(-8, 82), [0, 0, 1]),
          ...feet([0.36, 0.01, -0.05, -18, 5], [-0.3, 0.1, 0.1, -32, 34]) },
        { f: 27, ease: 'inOut', pose: torso({ pelvis: -8, yaw: 4, pitch: -6 }), hips: [0.06, -0.1, 0], wpn: W([0.42, -0.08, 0.1], dir(-6, 44), [0, 0.2, 1]), ...ST },
        g(35, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 6, name: 'swing' }, { f: 9, name: 'impact' }],
    },
    // ------------------------------------------------------------------------------------------- close string
    // pommel_1: short chambered pommel thrust to the face (4 / 2 / 12)
    pommel_1: {
      frames: 18,
      keys: [
        g(0),
        { f: 2, ease: 'out', pose: torso({ pelvis: -20, yaw: -18, pitch: -4 }), hips: [-0.03, -0.1, 0], wpn: W([0.1, 0.14, 0.34], dir(162, 44), [0, 0, 1]), grip: 1 },
        { f: 4, ease: 'outCubic', pose: torso({ pelvis: 12, yaw: 12, pitch: -12 }), hips: [0.1, -0.11, 0], wpn: W([0.64, 0.24, 0.02], dir(165, 30), [0, 0, 1]),
          ...feet([0.32, 0, -0.03, 0, 6], [-0.3, 0, 0.07, 0, 30]) },
        { f: 7, pose: torso({ pelvis: 10, yaw: 9, pitch: -11 }), hips: [0.09, -0.11, 0], wpn: W([0.56, 0.2, 0.06], dir(160, 34), [0, 0, 1]) },
        { f: 12, ease: 'inOut', pose: torso({ pelvis: -6, yaw: 4, pitch: -8 }), hips: [0.04, -0.09, 0], wpn: W([0.44, -0.1, 0.1], dir(40, 52), [0, 0.2, 1]),
          ...feet([0.26, 0, -0.03, 0, 6], [-0.24, 0.05, 0.07, 0, 30]) },
        g(18, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 2, name: 'swing' }, { f: 4, name: 'impact' }],
    },
    // pommel_2: hooking pommel smash right → left, hips whipping through (4 / 2 / 12)
    pommel_2: {
      frames: 18,
      keys: [
        { f: 0, pose: torso({ pelvis: 10, yaw: 9, pitch: -11 }), hips: [0.06, -0.11, 0], wpn: W([0.56, 0.2, 0.06], dir(160, 34), [0, 0, 1]), grip: 1, ...ST },
        { f: 2, ease: 'out', pose: torso({ pelvis: -28, yaw: -28, pitch: -6 }), hips: [0.0, -0.12, 0], wpn: W([0.22, 0.26, 0.6], dir(110, 12), [0, 1, 0]) },
        { f: 4, ease: 'outCubic', pose: torso({ pelvis: 22, yaw: 26, pitch: -12 }), hips: [0.1, -0.12, 0], wpn: W([0.62, 0.24, -0.08], dir(140, 4), [0, 1, 0]),
          ...feet([0.3, 0, -0.03, 0, 6], [-0.3, 0.02, 0.07, -10, 30]) },
        { f: 8, pose: torso({ pelvis: 30, yaw: 30, pitch: -11 }), hips: [0.1, -0.12, 0], wpn: W([0.44, 0.18, -0.32], dir(168, 2), [0, 1, 0]) },
        { f: 13, ease: 'inOut', pose: torso({ pelvis: 4, yaw: 10, pitch: -8 }), hips: [0.04, -0.09, 0], wpn: W([0.44, -0.12, 0.0], dir(-20, 40), [0, 0.2, 1]) },
        g(18, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 2, name: 'swing' }, { f: 4, name: 'impact' }],
    },
    // close finisher: rear-leg push kick (Spartan kick) with the greatsword cocked back one-handed (7 / 4 / 20)
    kick: {
      frames: 31,
      keys: [
        { f: 0, ...GUARD },
        { f: 4, ease: 'out', pose: torso({ pelvis: 6, yaw: 4, pitch: 8, look: 1 }), hips: [-0.04, -0.06, 0], grip: 0,
          ...feet([0.14, 0, -0.03, 0, 8], [0.18, 0.5, 0.04, 26, 4]), wpn: W([0.02, 0.18, 0.56], dir(165, 40), [0, 0, 1]), handL: [0.5, -0.05, -0.3] },
        { f: 7, ease: 'outCubic', pose: torso({ pelvis: 10, yaw: 6, pitch: 20, look: 1 }), hips: [-0.12, -0.05, 0],
          ...feet([0.12, 0, -0.03, 0, 8], [0.88, 0.52, 0.02, 72, 0]), wpn: W([-0.1, 0.1, 0.56], dir(172, 30), [0, 0, 1]), handL: [0.55, 0.08, -0.32] },
        { f: 11, pose: torso({ pelvis: 10, yaw: 6, pitch: 18, look: 1 }), hips: [-0.11, -0.05, 0], ...feet([0.12, 0, -0.03, 0, 8], [0.82, 0.48, 0.02, 64, 0]) },
        { f: 17, ease: 'inOut', pose: torso({ pelvis: 0, yaw: 4, pitch: 2 }), hips: [0.0, -0.07, 0], ...feet([0.14, 0, -0.03, 0, 8], [0.3, 0.26, 0.05, 14, 10]),
          wpn: W([0.25, -0.1, 0.4], dir(60, 50), [0, 0, 1]), handL: [0.45, -0.25, -0.2] },
        { f: 23, ease: 'inOut', ...GUARD, ...feet([0.14, 0, -0.03, 0, 8], [0.2, 0.02, 0.07, 0, 20]), grip: 1 },
        g(31, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 4, name: 'swing' }, { f: 7, name: 'impact' }],
    },
    // clinch: collar grip at arm's length, greatsword held low and back
    grab: {
      frames: 40, loop: true, grip: 0, plant: 1,
      keys: [
        { f: 0, pose: torso({ pelvis: -10, yaw: 12, pitch: -10, look: 1 }), hips: [0, -0.12, 0], ...ST_WIDE, wpn: W([0.04, -0.52, 0.44], dir(168, -34), [0, 0.3, 1]), handL: [0.74, 0.14, -0.06] },
        { f: 20, pose: torso({ pelvis: -12, yaw: 10, pitch: -12, look: 1 }), hips: [0.01, -0.13, 0], ...ST_WIDE, wpn: W([0.05, -0.54, 0.44], dir(168, -36), [0, 0.3, 1]), handL: [0.72, 0.1, -0.06] },
      ],
    },
    knee: {
      frames: 17, grip: 0,
      keys: [
        { f: 0, pose: torso({ pelvis: -10, yaw: 12, pitch: -10, look: 1 }), hips: [0, -0.12, 0], ...ST_WIDE, wpn: W([0.04, -0.52, 0.44], dir(168, -34), [0, 0.3, 1]), handL: [0.74, 0.14, -0.06] },
        { f: 3, ease: 'out', pose: torso({ pelvis: -14, yaw: 8, pitch: -4, look: 1 }), hips: [-0.03, -0.1, 0], ...feet([0.3, 0, -0.05, 0, 5], [-0.2, 0.12, 0.08, -30, 20]), handL: [0.76, 0.2, -0.06] },
        { f: 5, ease: 'outCubic', pose: torso({ pelvis: 8, yaw: 2, pitch: -18, look: 1 }), hips: [0.08, -0.06, 0], ...feet([0.3, 0, -0.05, 0, 5], [0.44, 0.58, 0.04, -34, 0]), handL: [0.62, -0.12, -0.06] },
        { f: 9, pose: torso({ pelvis: 6, yaw: 2, pitch: -16, look: 1 }), hips: [0.07, -0.07, 0], ...feet([0.3, 0, -0.05, 0, 5], [0.38, 0.46, 0.05, -28, 0]) },
        { f: 17, ease: 'inOut', pose: torso({ pelvis: -10, yaw: 12, pitch: -10, look: 1 }), hips: [0, -0.12, 0], ...ST_WIDE, handL: [0.74, 0.14, -0.06] },
      ],
      events: [{ f: 5, name: 'impact' }],
    },
    grab_hit: { alias: 'knee' },
    // throw: hoist the foe over the shoulder and hurl it forward (grab 6, release 18, total 38)
    throw: {
      frames: 38, grip: 0,
      keys: [
        { f: 0, pose: torso({ pelvis: -10, yaw: 12, pitch: -10 }), hips: [0, -0.12, 0], ...ST_WIDE, wpn: W([0.04, -0.52, 0.44], dir(168, -34), [0, 0.3, 1]), handL: [0.74, 0.14, -0.06] },
        { f: 6, ease: 'out', pose: torso({ pelvis: 0, yaw: 6, pitch: -22 }), hips: [0.04, -0.24, 0], ...ST_WIDE, wpn: W([0.62, -0.05, 0.3], dir(170, -50), [0, 0, 1]), handL: [0.68, -0.02, -0.22] },
        { f: 12, ease: 'inOut', pose: torso({ pelvis: 0, yaw: 2, pitch: 2 }), hips: [0.0, -0.1, 0], wpn: W([0.42, 0.62, 0.26], dir(175, -10), [0, 0, 1]), handL: [0.42, 0.62, -0.24] },
        { f: 16, ease: 'inOut', pose: torso({ pelvis: 0, yaw: 0, pitch: 18, look: 0.6 }), hips: [-0.06, -0.06, 0], ...feet([0.34, 0.02, -0.05, 10, 5], [-0.3, 0, 0.1, 0, 34]),
          wpn: W([0.12, 1.0, 0.24], dir(178, 20), [0, 0, 1]), handL: [0.12, 1.0, -0.24] },
        { f: 18, ease: 'in', pose: torso({ pelvis: 10, yaw: 6, pitch: -24 }), hips: [0.14, -0.16, 0], ...feet([0.46, 0, -0.05, 0, 5], [-0.4, 0.04, 0.1, -20, 34]),
          wpn: W([0.72, 0.5, 0.22], dir(30, 30), [0, 0, 1]), handL: [0.72, 0.48, -0.22] },
        { f: 24, ease: 'out', pose: torso({ pelvis: 12, yaw: 8, pitch: -26 }), hips: [0.15, -0.17, 0], wpn: W([0.6, -0.1, 0.3], dir(20, 0), [0, 0, 1]), handL: [0.55, -0.2, -0.3] },
        { f: 31, ease: 'inOut', ...GUARD, hips: [0.06, -0.1, 0], grip: 1 },
        g(38, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 6, name: 'grab' }, { f: 18, name: 'impact' }],
    },
    // throw_back: lift, arch back and slam the foe over the shoulder behind; code turns Brann after the release
    throw_back: {
      frames: 38, grip: 0,
      keys: [
        { f: 0, pose: torso({ pelvis: -10, yaw: 12, pitch: -10 }), hips: [0, -0.12, 0], ...ST_WIDE, wpn: W([0.04, -0.52, 0.44], dir(168, -34), [0, 0.3, 1]), handL: [0.74, 0.14, -0.06] },
        { f: 6, ease: 'out', pose: torso({ pelvis: 0, yaw: 6, pitch: -22 }), hips: [0.04, -0.24, 0], ...ST_WIDE, wpn: W([0.62, -0.05, 0.3], dir(170, -50), [0, 0, 1]), handL: [0.68, -0.02, -0.22] },
        { f: 12, ease: 'inOut', pose: torso({ pelvis: 0, pitch: 8, look: 0.4 }), hips: [0.0, -0.08, 0], wpn: W([0.3, 0.8, 0.26], dir(175, 0), [0, 0, 1]), handL: [0.3, 0.8, -0.24] },
        { f: 18, ease: 'in', pose: torso({ pelvis: -4, pitch: 34, look: 0 }), hips: [-0.14, -0.12, 0], ...feet([0.36, 0, -0.05, 0, 5], [-0.22, 0, 0.1, 0, 34]),
          wpn: W([-0.3, 0.86, 0.24], dir(180, -30), [0, 0, 1]), handL: [-0.3, 0.84, -0.24] },
        { f: 21, ease: 'out', pose: torso({ pelvis: 10, yaw: 6, pitch: -20 }), hips: [0.1, -0.16, 0], ...ST_WIDE, wpn: W([0.5, -0.2, 0.35], dir(40, -10), [0, 0, 1]), handL: [0.45, -0.25, -0.3] },
        { f: 30, ease: 'inOut', ...GUARD, grip: 1 },
        g(38, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 6, name: 'grab' }, { f: 18, name: 'impact' }],
    },

    // ------------------------------------------------------------------------------------------- air
    jump_up: {
      frames: 20,
      keys: [
        { f: 0, pose: torso({ pelvis: -10, yaw: 4, pitch: -20 }), hips: [0.02, -0.22, 0], ...ST_WIDE, wpn: W([0.42, -0.36, 0.14], dir(-10, 28), [0, 0.2, 1]), grip: 1 },
        { f: 4, ease: 'out', pose: torso({ pelvis: -8, yaw: 2, pitch: -4 }), hips: [0.03, 0.02, 0], ...feet([0.12, 0.02, -0.03, -42, 6], [-0.14, 0.06, 0.07, -55, 20]), wpn: W([0.4, 0.05, 0.14], dir(-5, 55), [0, 0.2, 1]) },
        { f: 20, ease: 'inOut', pose: torso({ pelvis: -8, yaw: 4, pitch: -10 }), hips: [0.02, 0.0, 0], ...feet([0.3, 0.38, -0.03, 10, 6], [-0.02, 0.22, 0.07, -20, 20]), wpn: W([0.36, 0.2, 0.14], dir(-10, 62), [0, 0.2, 1]) },
      ],
    },
    jump_fall: {
      frames: 36, loop: true,
      keys: [
        { f: 0, pose: torso({ pelvis: -8, yaw: 4, pitch: -6 }), ...feet([0.26, 0.16, -0.03, 12, 6], [-0.1, 0.06, 0.07, -6, 20]), wpn: W([0.38, 0.12, 0.14], dir(-10, 58), [0, 0.2, 1]), grip: 1 },
        { f: 18, pose: torso({ pelvis: -8, yaw: 4, pitch: -4 }), ...feet([0.24, 0.11, -0.03, 14, 6], [-0.12, 0.03, 0.07, -2, 20]), wpn: W([0.38, 0.16, 0.14], dir(-10, 62), [0, 0.2, 1]) },
      ],
    },
    land: {
      frames: 15, plant: 1,
      keys: [
        { f: 0, pose: torso({ pelvis: -12, yaw: 4, pitch: -24 }), hips: [0.05, -0.28, 0], ...ST_WIDE, wpn: W([0.46, -0.44, 0.14], dir(-10, 18), [0, 0.2, 1]), grip: 1 },
        { f: 3, ease: 'out', pose: torso({ pelvis: -12, yaw: 4, pitch: -27 }), hips: [0.06, -0.31, 0], ...ST_WIDE },
        g(15, { ease: 'inOut' }),
      ],
    },
    land_heavy: {
      frames: 15, plant: 1,
      keys: [
        { f: 0, pose: torso({ pelvis: -12, yaw: 4, pitch: -32 }), hips: [0.06, -0.36, 0], ...ST_WIDE, wpn: W([0.5, -0.5, 0.16], dir(-5, 5), [0, 0.2, 1]), grip: 1 },
        { f: 4, ease: 'out', pose: torso({ pelvis: -12, yaw: 4, pitch: -34 }), hips: [0.07, -0.4, 0], ...ST_WIDE },
        g(15, { ease: 'inOut' }),
      ],
    },
    // jump_attack: diagonal descending cleave from high-back, knees tucked; hold the low follow-through (4 / 40)
    jump_attack: {
      frames: 44,
      keys: [
        { f: 0, ease: 'out', pose: torso({ pelvis: -14, yaw: -18, pitch: 8, look: 1 }), ...feet([0.3, 0.36, -0.03, 10, 6], [-0.04, 0.22, 0.07, -20, 20]), wpn: W([0.0, 0.75, 0.34], dir(165, 44), [0, 0.3, 1]), grip: 1 },
        { f: 3, ease: 'in', pose: torso({ pelvis: -2, yaw: -4, pitch: -6 }), wpn: W([0.5, 0.55, 0.2], dir(20, 45), [0, 0, 1]) },
        { f: 4, ease: 'linear', pose: torso({ pelvis: 6, yaw: 6, pitch: -22 }), ...feet([0.4, 0.34, -0.03, 10, 6], [-0.12, 0.14, 0.07, -24, 20]), wpn: W([0.74, 0.02, 0.06], dir(0, -30), [0, 0, 1]) },
        { f: 8, ease: 'out', pose: torso({ pelvis: 10, yaw: 8, pitch: -28 }), wpn: W([0.58, -0.36, -0.06], dir(-12, -58), [0, 0, 1]) },
        { f: 44, pose: torso({ pelvis: 10, yaw: 8, pitch: -24 }), ...feet([0.36, 0.3, -0.03, 10, 6], [-0.1, 0.12, 0.07, -20, 20]), wpn: W([0.56, -0.32, -0.04], dir(-10, -54), [0, 0, 1]) },
      ],
      events: [{ f: 1, name: 'swing' }, { f: 4, name: 'impact' }],
    },
    air_light: { alias: 'jump_attack' },
    // run_jump_attack: leaping split-legged overhead meteor chop (3 / 40)
    run_jump_attack: {
      frames: 43,
      keys: [
        { f: 0, ease: 'out', pose: torso({ pelvis: -4, yaw: -4, pitch: 16, look: 1 }), ...feet([0.44, 0.2, -0.03, 16, 6], [-0.42, 0.3, 0.07, -40, 20]), wpn: W([-0.12, 0.98, 0.14], dir(180, 36), [0, 0, 1]), grip: 1 },
        { f: 2, ease: 'in', pose: torso({ pelvis: 2, pitch: 0 }), wpn: W([0.4, 0.8, 0.08], dir(0, 76), [0, 0, 1]) },
        { f: 3, ease: 'linear', pose: torso({ pelvis: 6, yaw: 2, pitch: -26 }), ...feet([0.56, 0.18, -0.03, 20, 6], [-0.5, 0.26, 0.07, -46, 20]), wpn: W([0.78, 0.1, 0.05], dir(0, -24), [0, 0, 1]) },
        { f: 8, ease: 'out', pose: torso({ pelvis: 8, yaw: 2, pitch: -32 }), wpn: W([0.62, -0.3, 0.05], dir(0, -52), [0, 0, 1]) },
        { f: 43, pose: torso({ pelvis: 8, yaw: 2, pitch: -28 }), ...feet([0.5, 0.16, -0.03, 16, 6], [-0.44, 0.22, 0.07, -40, 20]), wpn: W([0.6, -0.28, 0.05], dir(0, -50), [0, 0, 1]) },
      ],
      events: [{ f: 1, name: 'swing' }, { f: 3, name: 'impact' }],
    },
    // death_stab: hang at the apex with the blade reversed, then plunge point-first onto the downed foe (7 / 45)
    death_stab: {
      frames: 52,
      keys: [
        { f: 0, ease: 'out', pose: torso({ pelvis: -6, pitch: 6, look: 1 }), ...feet([0.3, 0.42, -0.05, 10, 6], [-0.06, 0.3, 0.08, -20, 20]), wpn: W([0.18, 0.82, 0.1], dir(0, -80), [0, 0, 1]), grip: 1 },
        { f: 6, ease: 'inOut', pose: torso({ pelvis: -4, pitch: 12, look: 1 }), ...feet([0.26, 0.48, -0.05, 10, 6], [-0.02, 0.36, 0.08, -20, 20]), wpn: W([0.14, 0.96, 0.1], dir(4, -86), [0, 0, 1]) },
        { f: 8, ease: 'in', pose: torso({ pelvis: 4, pitch: -20, look: 0.8 }), ...feet([0.34, 0.4, -0.05, 6, 6], [-0.16, 0.28, 0.08, -26, 20]), wpn: W([0.5, -0.28, 0.06], dir(8, -84), [0, 0, 1]) },
        { f: 52, pose: torso({ pelvis: 4, pitch: -22, look: 0.8 }), ...feet([0.32, 0.38, -0.05, 6, 6], [-0.16, 0.26, 0.08, -26, 20]), wpn: W([0.52, -0.32, 0.06], dir(8, -86), [0, 0, 1]) },
      ],
      events: [{ f: 7, name: 'swing' }],
    },
    // air_slam: rise with the blade overhead, then drive it straight down beneath (7 / 60) → air_slam_land
    air_slam: {
      frames: 67,
      keys: [
        { f: 0, ease: 'out', pose: torso({ pelvis: -4, pitch: 10, look: 1 }), ...feet([0.26, 0.4, -0.05, 10, 6], [-0.1, 0.3, 0.08, -24, 20]), wpn: W([-0.06, 0.92, 0.12], dir(180, 44), [0, 0, 1]), grip: 1 },
        { f: 6, ease: 'inOut', pose: torso({ pelvis: -4, pitch: 16, look: 1 }), ...feet([0.22, 0.46, -0.05, 10, 6], [-0.06, 0.36, 0.08, -24, 20]), wpn: W([-0.16, 1.0, 0.12], dir(180, 30), [0, 0, 1]) },
        { f: 7, ease: 'in', pose: torso({ pelvis: 2, pitch: -8 }), wpn: W([0.44, 0.7, 0.08], dir(0, 60), [0, 0, 1]) },
        { f: 9, ease: 'outCubic', pose: torso({ pelvis: 6, pitch: -26, look: 0.8 }), ...feet([0.2, 0.2, -0.05, 0, 6], [-0.24, 0.1, 0.08, -30, 20]), wpn: W([0.52, -0.3, 0.06], dir(4, -82), [0, 0, 1]) },
        { f: 67, pose: torso({ pelvis: 6, pitch: -24, look: 0.8 }), ...feet([0.18, 0.16, -0.05, 0, 6], [-0.26, 0.08, 0.08, -30, 20]), wpn: W([0.52, -0.34, 0.06], dir(4, -84), [0, 0, 1]) },
      ],
      events: [{ f: 7, name: 'swing' }],
    },
    air_heavy_slam: { alias: 'air_slam' },
    // air_slam_land: the blade bites the floor, shockwave crouch, heave it back out (0 / 3 / 18)
    air_slam_land: {
      frames: 21, plant: 1,
      keys: [
        { f: 0, pose: torso({ pelvis: 6, pitch: -38, look: 0.7 }), hips: [0.1, -0.4, 0], ...ST_WIDE, wpn: W([0.62, -0.62, 0.06], dir(4, -78), [0, 0, 1]), grip: 1 },
        { f: 4, ease: 'out', pose: torso({ pelvis: 6, pitch: -40, look: 0.7 }), hips: [0.1, -0.43, 0], wpn: W([0.62, -0.64, 0.06], dir(4, -80), [0, 0, 1]) },
        { f: 12, ease: 'inOut', pose: torso({ pelvis: -6, yaw: 4, pitch: -16 }), hips: [0.04, -0.18, 0], wpn: W([0.5, -0.3, 0.1], dir(-4, 12), [0, 0.2, 1]) },
        g(21, { ease: 'inOut' }),
      ],
      events: [{ f: 0, name: 'impact' }],
    },

    // ------------------------------------------------------------------------------------------- dash / back / evade
    // run_attack: lowered-shoulder barge, greatsword held back one-handed (5 / 7 / 17)
    run_attack: {
      frames: 29, grip: 0,
      keys: [
        { f: 0, pose: torso({ pelvis: 10, yaw: 12, pitch: -16 }), hips: [0.06, -0.12, 0], ...ST_WIDE, wpn: W([-0.05, -0.45, 0.44], dir(170, -26), [0, 0.3, 1]), handL: [0.4, -0.25, -0.3] },
        { f: 3, ease: 'out', pose: torso({ pelvis: 26, yaw: 30, pitch: -24, look: 0.9 }), hips: [0.1, -0.2, 0], ...feet([0.34, 0, -0.05, 0, 5], [-0.36, 0.04, 0.1, -22, 34]), wpn: W([-0.18, -0.4, 0.5], dir(175, -18), [0, 0.3, 1]), handL: [0.28, 0.0, -0.3] },
        { f: 5, ease: 'outCubic', pose: torso({ pelvis: 34, yaw: 38, pitch: -26, look: 0.9 }), hips: [0.2, -0.22, 0], ...feet([0.5, 0, -0.05, 0, 5], [-0.46, 0.06, 0.1, -30, 34]), handL: [0.22, 0.08, -0.26] },
        { f: 12, pose: torso({ pelvis: 32, yaw: 36, pitch: -24, look: 0.9 }), hips: [0.2, -0.21, 0] },
        { f: 20, ease: 'inOut', pose: torso({ pelvis: 0, yaw: 8, pitch: 4 }), hips: [-0.04, -0.12, 0], ...ST_WIDE, wpn: W([0.3, -0.3, 0.3], dir(20, 30), [0, 0.2, 1]), handL: [0.4, -0.3, -0.2] },
        g(29, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 3, name: 'swing' }],
    },
    // back_attack: whip the greatsword around behind at head height, pivoting on the lead foot (4 / 5 / 16)
    back_attack: {
      frames: 25,
      keys: [
        g(0),
        { f: 2, ease: 'out', pose: torso({ pelvis: 14, yaw: 18, pitch: -8, look: 0.3 }), hips: [0.02, -0.12, 0], wpn: W([0.4, 0.0, -0.4], dir(-40, 10), [0, 1, 0]) },
        { f: 4, ease: 'outCubic', pose: torso({ pelvis: -50, yaw: -48, pitch: -4, look: 0.2 }), hips: [-0.06, -0.12, 0], ...feet([0.2, 0, -0.03, 0, 6], [-0.3, 0.02, 0.12, -10, 60]),
          wpn: W([-0.1, 0.26, 0.62], dir(172, 6), [0, 1, 0]) },
        { f: 8, ease: 'out', pose: torso({ pelvis: -62, yaw: -58, pitch: -4, look: 0.2 }), hips: [-0.08, -0.12, 0], wpn: W([-0.3, 0.2, 0.3], dir(-150, 0), [0, 1, 0]) },
        { f: 15, ease: 'inOut', pose: torso({ pelvis: -30, yaw: -20, pitch: -6 }), hips: [-0.03, -0.1, 0], ...ST, wpn: W([0.2, -0.1, 0.4], dir(60, 30), [0, 0.2, 1]) },
        g(25, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 2, name: 'swing' }, { f: 4, name: 'impact' }],
    },
    // dodge_roll: tuck and roll forward, the blade hugged along the body (22 frames)
    dodge_roll: {
      frames: 22, goalSpace: 'chest', grip: 1,
      keys: [
        { f: 0, pose: torso({ pitch: -24 }), hips: [0.04, -0.26, 0], ...ST_WIDE, wpn: W([0.3, -0.3, 0.3], dir(175, -15), [0, 0, 1]) },
        { f: 4, ease: 'in', pose: { hips: [0, 0, -70], spine: [0, 0, -30], chest: [0, 0, -22], neck: [0, 0, -30], thigh_L: [0, 0, 80], shin_L: [0, 0, -100], thigh_R: [0, 0, 70], shin_R: [0, 0, -95] }, hips: [0.16, -0.32, 0] },
        { f: 10, pose: { hips: [0, 0, -185], spine: [0, 0, -34], chest: [0, 0, -24], neck: [0, 0, -30], thigh_L: [0, 0, 95], shin_L: [0, 0, -120], thigh_R: [0, 0, 88], shin_R: [0, 0, -115] }, hips: [0.2, -0.28, 0] }, // C1 r5: inverted-phase hips lifted (-0.5/-0.56 → -0.32/-0.28) so the head clears the floor
        { f: 16, pose: { hips: [0, 0, -300], spine: [0, 0, -26], chest: [0, 0, -16], neck: [0, 0, -12], thigh_L: [0, 0, 70], shin_L: [0, 0, -100], thigh_R: [0, 0, 50], shin_R: [0, 0, -95] }, hips: [0.12, -0.28, 0] },
        { f: 22, ease: 'out', pose: { hips: [0, 0, -360], spine: [0, 0, -10], chest: [0, 0, -6], neck: [0, 0, 0], thigh_L: [0, 0, 25], shin_L: [0, 0, -30], thigh_R: [0, 0, -10], shin_R: [0, 0, -25] }, hips: [0.02, -0.12, 0] },
      ],
    },
    // sidestep (depth evade): drop low under the swing and slip, blade kept between self and foe
    sidestep: {
      frames: 22, plant: 0.6,
      keys: [
        g(0),
        { f: 4, ease: 'out', pose: torso({ pelvis: -20, yaw: -8, pitch: -28, roll: 12 }), hips: [-0.06, -0.3, 0.08], ...ST_WIDE, wpn: W([0.4, -0.2, 0.2], dir(-20, 55), [0, 0.2, 1]) },
        { f: 12, pose: torso({ pelvis: -18, yaw: -6, pitch: -24, roll: 9 }), hips: [-0.05, -0.27, 0.06] },
        g(22, { ease: 'inOut' }),
      ],
    },

    // ------------------------------------------------------------------------------------------- show
    taunt: {
      frames: 60, plant: 1,
      keys: [
        g(0),
        { f: 10, ease: 'out', pose: torso({ pelvis: -6, yaw: 8, pitch: -14 }), hips: [0.05, -0.16, 0], ...ST_WIDE, wpn: W([0.55, -0.2, 0.1], dir(0, -82), [0, 0, 1]) },
        { f: 14, ease: 'in', pose: torso({ pelvis: -6, yaw: 8, pitch: -18 }), hips: [0.06, -0.2, 0], wpn: W([0.56, -0.34, 0.1], dir(0, -86), [0, 0, 1]) },
        { f: 24, ease: 'outBack', pose: torso({ pelvis: -10, yaw: 10, pitch: 10, look: 0.5, hp: 14 }), hips: [0.02, -0.08, 0], wpn: W([0.55, -0.32, 0.1], dir(0, -86), [0, 0, 1]), grip: 0,
          handL: [0.35, 0.55, -0.55] },
        { f: 44, pose: torso({ pelvis: -10, yaw: 10, pitch: 12, look: 0.5, hp: 16 }), hips: [0.02, -0.07, 0], wpn: W([0.55, -0.32, 0.1], dir(0, -86), [0, 0, 1]), handL: [0.4, 0.5, -0.5] },
        { f: 52, ease: 'inOut', pose: torso({ pelvis: -6, yaw: 8, pitch: -12 }), hips: [0.04, -0.14, 0], wpn: W([0.5, -0.2, 0.1], dir(0, -60), [0, 0, 1]), grip: 1 },
        g(60, { ease: 'inOut' }),
      ],
      events: [{ f: 14, name: 'impact' }, { f: 24, name: 'roar' }],
    },
    victory: {
      frames: 96, loop: true, grip: 0, breathe: 1,
      keys: [
        { f: 0, pose: torso({ pelvis: -12, yaw: -6, pitch: 8, look: 0.3, hp: 12 }), hips: [0, -0.04, 0], ...ST_WIDE, wpn: W([0.16, 1.02, 0.34], dir(4, 86), [0.7, 0, 0.7]), handL: [0.3, -0.25, -0.5] }, // C1 r5: flat at 45 deg (was edge-on to the select camera: a 2 px needle)
        { f: 48, pose: torso({ pelvis: -12, yaw: -8, pitch: 10, look: 0.3, hp: 14 }), hips: [0, -0.03, 0], ...ST_WIDE, wpn: W([0.18, 1.04, 0.32], dir(0, 88), [0.7, 0, 0.7]), handL: [0.3, -0.22, -0.52] },
      ],
    },
    // select_stand (C2 r2, hero-weapons; src/ui/select3d.js plays it when it exists, else idle): the select camera sits
    // almost on the character's forward axis (char-space dir ≈ [0.96, 0.17, 0.2]), so the idle guard showed Grudgebrand
    // as a thin diagonal. Here the greatsword is PRESENTED across the chest, both hands on the hilt, the flat to the camera.
    select_stand: {
      frames: 150, loop: true, plant: 1, breathe: 1, grip: 0, tags: ['idle'],
      keys: [
        // (across the chest the blade guard / two-hand lock pulled it vertical over the belly; one-handed at arm's length
        // on his right it stays put: a full 1 m slab, flat to the camera, the left fist on the hip)
        { f: 0, pose: torso({ pelvis: -8, yaw: 4, pitch: 3, look: 0.5 }), hips: [0, -0.06, 0], ...ST_WIDE, wpn: W([0.2, -0.34, 0.74], dir(-20, 78), [0.96, 0.17, 0.2]), handL: [0.18, -0.46, -0.32] },
        { f: 75, pose: torso({ pelvis: -8, yaw: 5, pitch: 2, look: 0.5 }), hips: [0, -0.075, 0], ...ST_WIDE, wpn: W([0.2, -0.36, 0.74], dir(-20, 79), [0.96, 0.17, 0.2]), handL: [0.18, -0.47, -0.32] },
        { f: 150, pose: torso({ pelvis: -8, yaw: 4, pitch: 3, look: 0.5 }), hips: [0, -0.06, 0], ...ST_WIDE, wpn: W([0.2, -0.34, 0.74], dir(-20, 78), [0.96, 0.17, 0.2]), handL: [0.18, -0.46, -0.32] },
      ],
    },
    // magic: Brann drives Grudgebrand into the earth (castPeak) — the spell erupts from the blade
    magic_cast: {
      frames: 50, grip: 1,
      keys: [
        g(0),
        { f: 10, ease: 'out', pose: torso({ pitch: 12, look: 0.5, hp: 10 }), hips: [0, -0.04, 0], ...ST_WIDE, wpn: W([0.3, 0.95, 0.1], dir(0, -84), [0, 0, 1]) },
        { f: 18, ease: 'inOut', pose: torso({ pitch: 16, look: 0.4, hp: 14 }), hips: [0, 0.0, 0], wpn: W([0.28, 1.02, 0.1], dir(0, -86), [0, 0, 1]) },
        { f: 22, ease: 'in', pose: torso({ pitch: -30, look: 0.8 }), hips: [0.06, -0.4, 0], ...feet([0.34, 0, -0.06, 0, 5], [-0.36, 0.04, 0.1, -50, 20]), wpn: W([0.6, -0.55, 0.06], dir(0, -86), [0, 0, 1]) },
        { f: 40, pose: torso({ pitch: -28, look: 0.8 }), hips: [0.06, -0.42, 0], wpn: W([0.6, -0.56, 0.06], dir(0, -86), [0, 0, 1]) },
        g(50, { ease: 'inOut' }),
      ],
      events: [{ f: 22, name: 'castPeak' }],
    },
  },
};
