// Gorrim Knotbeard — stocky dwarf, two-handed Copper Ax. Short, brutally compact chops driven from a low, wide base:
// the pelvis snaps before the shoulders, the head bit buries itself in the follow-through and the whole body sinks
// into the ground on impact. Headbutt dash, grapple-heavy close game, INVULNERABLE backward roll-stab back attack.
// Frames match characters/movesets/gorrim.js (strike pose on the first ACTIVE tick). Both hands on the haft (profile
// grip lock, off hand 0.34 m toward the butt) except where a key sets grip: 0 (headbutt, grabs, throws, run).
// Axe goals: W(at, haft, bit) — `at` = right-hand grip point from the posed chest in arm lengths, haft = weapon +Y
// (toward the head), bit = which way the cutting edge faces. C(haft, n) computes the bit so it LEADS the swing,
// n = the swing's rotation axis: [0,0,-1] overhead chop, [0,1,0] right→left, [0,-1,0] left→right, [0,0,1] rising.
import { dir, W, torso, pose, gait, arm, leg, feet } from './_kit.js';
import { rideSet } from './_ride.js';

const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** Axe goal whose bit leads a swing about axis n. */
const C = (at, haft, n) => W(at, haft, norm(cross(norm(n), haft)));
const DOWN = [0, 0, -1], R2L = [0, 1, 0], L2R = [0, -1, 0], RISE = [0, 0, 1];
const DIAG = [0, 0.55, -0.83];   // high-right → low-left
const DIAG_UP = [0, -0.55, 0.83]; // low-left → high-right
const SEL_CAM = [0.96, 0.18, -0.21]; // select-screen camera direction in Gorrim's char space (tools/scenarios/select_camdir.mjs)

// ----------------------------------------------------------------------------------------------- stances
const ST = feet([0.24, 0, -0.06, 0, 10], [-0.22, 0, 0.1, 0, 32]);            // low, wide: left foot leads
const ST_WIDE = feet([0.32, 0, -0.08, 0, 8], [-0.3, 0, 0.13, 0, 36]);
const G_HIPS = [0, -0.12, 0];
const G_TORSO = torso({ pelvis: -16, yaw: 8, pitch: -9, look: 0.9 });
const G_WPN = C([0.42, -0.26, 0.14], dir(-8, 48), DOWN);   // haft up-forward across the body, bit to the foe
const GUARD = { pose: G_TORSO, hips: G_HIPS, ...ST, wpn: G_WPN, grip: 1 };
const g = (f, extra = {}) => ({ f, ...GUARD, ...extra });
// one-handed low carry (headbutt, grapples): axe hangs at the right hip, bit down/back
const LOW = C([0.08, -0.5, 0.46], dir(172, -30), DOWN);
const CLINCH = { pose: torso({ pelvis: -12, yaw: 12, pitch: -12, look: 1 }), hips: [0.02, -0.14, 0], ...ST_WIDE, wpn: LOW, handL: [0.72, 0.18, -0.06], grip: 0 };

// ----------------------------------------------------------------------------------------------- locomotion
// Short legs: quicker cadence. v in hip-heights/s at clip speed 1 (walk 2.72 m/s, hip 0.62 m, animator ×1.19).
const walk = gait({
  P: 0.5, v: 3.7, duty: 0.52, cx: 0.4, lift: 0.14, heel: 0.12, bob: 0.034, hipsY: -0.11, hipsX: 0.03, twist: 8, lean: -9,
  width: 0.06, toeOut: 14, sway: 0.03,
  upper: (ph) => {
    const b = Math.sin(ph * Math.PI * 4);
    return { wpn: C([0.42, -0.28 + b * 0.025, 0.14], dir(-8, 46 + b * 3), DOWN), grip: 1 };
  },
});
const run = gait({
  P: 0.42, v: 9.6, duty: 0.26, cx: 0.46, lift: 0.34, heel: 0.1, bob: 0.05, hipsY: -0.12, hipsX: 0.07, twist: 12, lean: -20,
  flight: 0.1, strike: 6, pushOff: 38, width: 0.06, toeOut: 12,
  upper: (ph) => {
    const s = Math.sin(ph * Math.PI * 2);
    return {  // axe carried on the shoulder like a lumberjack, off arm pumping hard
      wpn: C([0.12 - s * 0.05, 0.12, 0.42], dir(168, 34 + s * 5), DOWN), grip: 0,
      pose: arm('L', { upper: [0.6 * s, -0.8, -0.34], fore: [0.95 * s + 0.4, 0.5, -0.22] }),
    };
  },
});

// FK legs for the backward roll (tucked, ride with the pelvis)
const TUCK = pose(leg('L', { thigh: [0.92, -0.3, -0.15], shin: [-0.55, -0.85, -0.12], toe: [0.4, -0.9, 0] }),
  leg('R', { thigh: [0.85, -0.45, 0.15], shin: [-0.6, -0.8, 0.12], toe: [0.4, -0.9, 0] }));

export default {
  rig: 'humanoid', character: 'gorrim', priority: 10,
  clips: {
    // riding: axe on the shoulder, reins in the left fist; one-armed overhead chop
    ...rideSet({ carry: C([0.14, 0.12, 0.42], dir(168, 36), DOWN), up: C([-0.04, 0.9, 0.34], dir(172, 40), DOWN), hit: C([0.76, 0.0, 0.3], dir(8, -30), DOWN), follow: C([0.6, -0.4, 0.28], dir(0, -62), DOWN) }),
    idle: {  // heavy-chested breathing, the axe bobbing, a shrug of the shoulders
      frames: 140, loop: true, plant: 1, breathe: 1.2, tags: ['idle'],
      keys: [
        g(0),
        g(46, { pose: torso({ pelvis: -17, yaw: 9, pitch: -10.5, look: 0.9 }), hips: [0.01, -0.13, 0], wpn: C([0.43, -0.27, 0.14], dir(-8, 45), DOWN) }),
        g(94, { pose: torso({ pelvis: -15, yaw: 7, pitch: -8, look: 0.9, hy: -5 }), hips: [-0.005, -0.11, 0], wpn: C([0.42, -0.24, 0.15], dir(-10, 51), DOWN) }),
        g(140),
      ],
    },
    walk: { duration: 0.5, loop: true, keys: walk, events: [{ n: 0.02, name: 'footstep', foot: 'L' }, { n: 0.52, name: 'footstep', foot: 'R' }] },
    run: { duration: 0.42, loop: true, grip: 0, keys: run, events: [{ n: 0.02, name: 'footstep', foot: 'L' }, { n: 0.52, name: 'footstep', foot: 'R' }] },

    // ------------------------------------------------------------------------------------------- the string
    // light_1: diagonal forehand chop, high-right → low-left, the bit ends near the floor (8 / 4 / 15)
    light_1: {
      frames: 27,
      keys: [
        g(0),
        { f: 4, ease: 'out', pose: torso({ pelvis: -26, yaw: -24, pitch: -2 }), hips: [-0.04, -0.12, 0], wpn: C([0.06, 0.46, 0.4], dir(160, 38), DIAG),
          ...feet([0.22, 0, -0.06, 0, 10], [-0.24, 0, 0.1, 0, 32]) },
        { f: 6, ease: 'in', pose: torso({ pelvis: -12, yaw: -14, pitch: -4 }), hips: [0.0, -0.13, 0], wpn: C([0.2, 0.52, 0.34], dir(150, 58), DIAG) },
        { f: 7, ease: 'in', pose: torso({ pelvis: 0, yaw: -2, pitch: -10 }), hips: [0.07, -0.15, 0], wpn: C([0.5, 0.44, 0.2], dir(20, 62), DIAG),
          ...feet([0.34, 0.02, -0.06, 0, 10], [-0.3, 0, 0.1, 0, 32]) },
        { f: 8, ease: 'linear', pose: torso({ pelvis: 16, yaw: 14, pitch: -18 }), hips: [0.13, -0.18, 0], wpn: C([0.7, 0.02, 0.04], dir(-18, -14), DIAG),
          ...feet([0.4, 0, -0.06, 0, 10], [-0.36, 0, 0.1, 0, 32]) },
        { f: 11, ease: 'outCubic', pose: torso({ pelvis: 26, yaw: 22, pitch: -24 }), hips: [0.15, -0.2, 0], wpn: C([0.48, -0.3, -0.26], dir(-70, -40), DIAG),
          ...feet([0.4, 0, -0.06, 0, 10], [-0.4, 0.03, 0.1, -10, 32]) },
        { f: 15, pose: torso({ pelvis: 28, yaw: 24, pitch: -23 }), hips: [0.145, -0.2, 0], wpn: C([0.42, -0.36, -0.32], dir(-86, -46), DIAG) },
        { f: 21, ease: 'inOut', pose: torso({ pelvis: 2, yaw: 12, pitch: -12 }), hips: [0.05, -0.14, 0], wpn: C([0.44, -0.28, 0.02], dir(-30, 30), DOWN),
          ...feet([0.28, 0, -0.06, 0, 10], [-0.26, 0.05, 0.1, 0, 32]) },
        g(27, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 5, name: 'swing' }, { f: 8, name: 'impact' }],
    },
    // light_2: backhand rising chop, low-left → high-right, hips whipping back through (7 / 4 / 16)
    light_2: {
      frames: 27,
      keys: [
        { f: 0, pose: torso({ pelvis: 28, yaw: 24, pitch: -22 }), hips: [0.12, -0.19, 0], wpn: C([0.42, -0.36, -0.32], dir(-86, -46), DIAG), grip: 1, ...ST },
        { f: 4, ease: 'out', pose: torso({ pelvis: 32, yaw: 30, pitch: -20 }), hips: [0.05, -0.2, 0], wpn: C([0.22, -0.36, -0.46], dir(-150, -26), DIAG_UP),
          ...feet([0.24, 0, -0.06, 0, 10], [-0.24, 0, 0.1, 0, 32]) },
        { f: 6, ease: 'in', pose: torso({ pelvis: 12, yaw: 10, pitch: -16 }), hips: [0.1, -0.18, 0], wpn: C([0.5, -0.24, -0.3], dir(-60, -20), DIAG_UP),
          ...feet([0.34, 0, -0.06, 0, 10], [-0.32, 0, 0.1, 0, 32]) },
        { f: 7, ease: 'linear', pose: torso({ pelvis: -4, yaw: -6, pitch: -10 }), hips: [0.14, -0.15, 0], wpn: C([0.7, 0.02, 0.0], dir(10, 14), DIAG_UP),
          ...feet([0.4, 0, -0.06, 0, 10], [-0.38, 0.02, 0.1, -8, 32]) },
        { f: 10, ease: 'outCubic', pose: torso({ pelvis: -20, yaw: -22, pitch: -2 }), hips: [0.14, -0.11, 0], wpn: C([0.44, 0.42, 0.36], dir(70, 50), DIAG_UP) },
        { f: 14, pose: torso({ pelvis: -24, yaw: -26, pitch: 0 }), hips: [0.12, -0.11, 0], wpn: C([0.3, 0.5, 0.42], dir(110, 58), DIAG_UP) },
        { f: 21, ease: 'inOut', pose: torso({ pelvis: -18, yaw: -2, pitch: -7 }), hips: [0.05, -0.12, 0], wpn: C([0.42, -0.1, 0.2], dir(10, 56), DOWN),
          ...feet([0.28, 0, -0.06, 0, 10], [-0.26, 0.05, 0.1, 0, 32]) },
        g(27, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 4, name: 'swing' }, { f: 7, name: 'impact' }],
    },
    // light_3: hop and bury the Copper Ax straight down into the floor (10 / 5 / 24) — knockdown finisher
    light_3: {
      frames: 39,
      keys: [
        g(0),
        { f: 4, ease: 'out', pose: torso({ pelvis: -10, yaw: -4, pitch: -16 }), hips: [0.0, -0.22, 0], wpn: C([0.34, 0.2, 0.2], dir(120, 70), DOWN), grip: 1, ...ST_WIDE },
        { f: 8, ease: 'out', pose: torso({ pelvis: -4, yaw: -2, pitch: 14, look: 1 }), hips: [0.02, -0.02, 0], wpn: C([-0.12, 0.96, 0.12], dir(180, 34), DOWN),
          ...feet([0.3, 0.12, -0.06, 12, 10], [-0.22, 0.08, 0.1, -20, 32]) },
        { f: 9, ease: 'in', pose: torso({ pelvis: 2, yaw: 0, pitch: 2 }), hips: [0.08, -0.06, 0], wpn: C([0.4, 0.86, 0.08], dir(0, 80), DOWN),
          ...feet([0.42, 0.06, -0.06, 8, 10], [-0.28, 0.03, 0.1, -10, 32]) },
        { f: 10, ease: 'linear', pose: torso({ pelvis: 8, yaw: 4, pitch: -30, look: 0.8 }), hips: [0.18, -0.24, 0], wpn: C([0.76, 0.06, 0.05], dir(0, -26), DOWN),
          ...feet([0.46, 0, -0.06, 0, 10], [-0.42, 0, 0.1, 0, 32]) },
        { f: 13, ease: 'outCubic', pose: torso({ pelvis: 8, yaw: 4, pitch: -38, look: 0.8 }), hips: [0.2, -0.3, 0], wpn: C([0.62, -0.32, 0.05], dir(0, -54), DOWN),
          ...feet([0.46, 0, -0.06, 0, 10], [-0.46, 0.04, 0.1, -18, 32]) },
        { f: 21, pose: torso({ pelvis: 8, yaw: 5, pitch: -36, look: 0.85 }), hips: [0.19, -0.295, 0], wpn: C([0.6, -0.36, 0.06], dir(0, -58), DOWN) },
        { f: 30, ease: 'inOut', pose: torso({ pelvis: -8, yaw: 6, pitch: -14 }), hips: [0.08, -0.15, 0], wpn: C([0.44, -0.26, 0.12], dir(-6, 26), DOWN),
          ...feet([0.32, 0, -0.06, 0, 10], [-0.26, 0.08, 0.1, 0, 32]) },
        g(39, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 7, name: 'swing' }, { f: 10, name: 'impact' }],
    },

    // ------------------------------------------------------------------------------------------- heavy (hold = charge)
    // Mountain-splitter: coil the axe up over the right shoulder, step in and cleave diagonally down through the foe
    // into the floor (16 / 5 / 26). Frame 9 is the charge hold (heavy_charge overlays a deeper coil + tremble).
    heavy: {
      frames: 47,
      keys: [
        g(0),
        { f: 5, ease: 'out', pose: torso({ pelvis: -28, yaw: -32, pitch: -4, look: 1 }), hips: [-0.05, -0.16, 0], wpn: C([0.06, 0.5, 0.44], dir(160, 40), DIAG), grip: 1, ...ST_WIDE },
        { f: 9, ease: 'out', pose: torso({ pelvis: -36, yaw: -42, pitch: 2, look: 1 }), hips: [-0.08, -0.19, 0], wpn: C([-0.14, 0.62, 0.5], dir(168, 34), DIAG), ...ST_WIDE },
        { f: 13, ease: 'in', pose: torso({ pelvis: -30, yaw: -38, pitch: 0, look: 1 }), hips: [-0.02, -0.17, 0], wpn: C([-0.1, 0.62, 0.52], dir(162, 36), DIAG),
          ...feet([0.44, 0.1, -0.08, 10, 8], [-0.3, 0, 0.13, 0, 36]) },
        { f: 15, ease: 'in', pose: torso({ pelvis: -6, yaw: -12, pitch: -8, look: 0.9 }), hips: [0.12, -0.18, 0], wpn: C([0.34, 0.7, 0.46], dir(40, 62), DIAG), // C1 r5: z 0.3 → 0.46: the overhead pass runs beside the helm, not over it (trail near-head frames)
          ...feet([0.54, 0.02, -0.08, 0, 8], [-0.36, 0, 0.13, 0, 36]) },
        { f: 16, ease: 'linear', pose: torso({ pelvis: 20, yaw: 16, pitch: -22 }), hips: [0.22, -0.26, 0], wpn: C([0.78, 0.04, 0.06], dir(-14, -20), DIAG),
          ...feet([0.56, 0, -0.08, 0, 8], [-0.44, 0, 0.13, 0, 36]) },
        { f: 19, ease: 'outCubic', pose: torso({ pelvis: 34, yaw: 30, pitch: -32 }), hips: [0.24, -0.32, 0], wpn: C([0.54, -0.36, -0.22], dir(-54, -52), DIAG),
          ...feet([0.56, 0, -0.08, 0, 8], [-0.48, 0.07, 0.13, -24, 26]) },
        { f: 28, pose: torso({ pelvis: 36, yaw: 32, pitch: -31 }), hips: [0.235, -0.315, 0], wpn: C([0.5, -0.4, -0.26], dir(-60, -56), DIAG) },
        { f: 37, ease: 'inOut', pose: torso({ pelvis: 12, yaw: 16, pitch: -14 }), hips: [0.12, -0.16, 0], wpn: C([0.42, -0.28, -0.04], dir(-40, 20), DOWN),
          ...feet([0.36, 0, -0.08, 0, 8], [-0.26, 0.08, 0.1, 0, 32]) },
        g(47, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 13, name: 'swing' }, { f: 16, name: 'impact' }],
    },
    heavy_charge: {
      frames: 36, loop: true, grip: 1,
      keys: [
        { f: 0, pose: torso({ pelvis: -38, yaw: -45, pitch: 4, look: 1 }), hips: [-0.09, -0.22, 0], wpn: C([-0.18, 0.64, 0.5], dir(170, 32), DIAG), ...ST_WIDE },
        { f: 18, pose: torso({ pelvis: -40, yaw: -48, pitch: 6, look: 1 }), hips: [-0.1, -0.24, 0], wpn: C([-0.22, 0.68, 0.48], dir(174, 30), DIAG), ...ST_WIDE },
        { f: 36, pose: torso({ pelvis: -38, yaw: -45, pitch: 4, look: 1 }), hips: [-0.09, -0.22, 0], wpn: C([-0.18, 0.64, 0.5], dir(170, 32), DIAG), ...ST_WIDE },
      ],
    },
    // launcher: squat under the foe and rip the axe straight up through it, rising onto the toes (11 / 5 / 24)
    launcher: {
      frames: 40,
      keys: [
        g(0),
        { f: 6, ease: 'out', pose: torso({ pelvis: -22, yaw: -26, pitch: -22, look: 1 }), hips: [-0.02, -0.3, 0], wpn: C([0.1, -0.56, 0.46], dir(165, -30), RISE), grip: 1, ...ST_WIDE },
        { f: 10, ease: 'in', pose: torso({ pelvis: -6, yaw: -8, pitch: -16 }), hips: [0.06, -0.26, 0], wpn: C([0.56, -0.4, 0.24], dir(20, -24), RISE), ...ST_WIDE },
        { f: 11, ease: 'linear', pose: torso({ pelvis: 4, yaw: 2, pitch: -4 }), hips: [0.12, -0.1, 0], wpn: C([0.72, 0.08, 0.1], dir(0, 40), RISE),
          ...feet([0.36, 0, -0.08, 0, 8], [-0.3, 0.02, 0.13, -8, 36]) },
        { f: 14, ease: 'out', pose: torso({ pelvis: 4, yaw: 0, pitch: 16 }), hips: [0.14, 0.02, 0], wpn: C([0.3, 0.92, 0.14], dir(8, 86), RISE),
          ...feet([0.36, 0.03, -0.08, -24, 8], [-0.3, 0.13, 0.13, -40, 36]) },
        { f: 21, pose: torso({ pelvis: 2, yaw: 0, pitch: 14 }), hips: [0.13, 0.0, 0], wpn: C([0.24, 0.94, 0.12], dir(-8, 82), RISE),
          ...feet([0.36, 0.02, -0.08, -20, 8], [-0.3, 0.1, 0.13, -34, 36]) },
        { f: 31, ease: 'inOut', pose: torso({ pelvis: -10, yaw: 6, pitch: -8 }), hips: [0.06, -0.12, 0], wpn: C([0.42, -0.1, 0.12], dir(-6, 50), DOWN), ...ST },
        g(40, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 8, name: 'swing' }, { f: 11, name: 'impact' }],
    },

    // ------------------------------------------------------------------------------------------- close string
    // pommel_1: short straight jab with the haft butt to the face, both hands driving (5 / 2 / 13)
    pommel_1: {
      frames: 20,
      keys: [
        g(0),
        { f: 3, ease: 'out', pose: torso({ pelvis: -20, yaw: -18, pitch: -6 }), hips: [-0.03, -0.13, 0], wpn: C([0.14, 0.2, 0.3], dir(165, 42), DOWN), grip: 1 },
        { f: 5, ease: 'outCubic', pose: torso({ pelvis: 12, yaw: 12, pitch: -14 }), hips: [0.11, -0.15, 0], wpn: C([0.66, 0.26, 0.02], dir(168, 30), DOWN),
          ...feet([0.34, 0, -0.06, 0, 10], [-0.3, 0, 0.1, 0, 32]) },
        { f: 8, pose: torso({ pelvis: 10, yaw: 10, pitch: -13 }), hips: [0.1, -0.15, 0], wpn: C([0.58, 0.22, 0.05], dir(164, 34), DOWN) },
        { f: 14, ease: 'inOut', pose: torso({ pelvis: -6, yaw: 6, pitch: -10 }), hips: [0.04, -0.12, 0], wpn: C([0.42, -0.1, 0.12], dir(30, 54), DOWN),
          ...feet([0.28, 0, -0.06, 0, 10], [-0.24, 0.05, 0.1, 0, 32]) },
        g(20, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 3, name: 'swing' }, { f: 5, name: 'impact' }],
    },
    // pommel_2: rising cross-check — the haft held flat across the chest, shoved up under the chin (5 / 2 / 13)
    pommel_2: {
      frames: 20,
      keys: [
        { f: 0, pose: torso({ pelvis: 10, yaw: 10, pitch: -13 }), hips: [0.07, -0.15, 0], wpn: C([0.58, 0.22, 0.05], dir(164, 34), DOWN), grip: 1, ...ST },
        { f: 3, ease: 'out', pose: torso({ pelvis: -8, yaw: -4, pitch: -20 }), hips: [0.02, -0.22, 0], wpn: C([0.36, -0.2, 0.32], dir(96, 6), [-1, 0, 0]), ...ST_WIDE },
        { f: 5, ease: 'outCubic', pose: torso({ pelvis: 4, yaw: 2, pitch: 6 }), hips: [0.12, -0.06, 0], wpn: C([0.64, 0.4, 0.3], dir(100, 16), [-1, 0, 0]),
          ...feet([0.34, 0, -0.08, 0, 8], [-0.34, 0.06, 0.13, -18, 36]) },
        { f: 9, pose: torso({ pelvis: 4, yaw: 2, pitch: 8 }), hips: [0.12, -0.06, 0], wpn: C([0.58, 0.44, 0.32], dir(102, 18), [-1, 0, 0]) },
        { f: 15, ease: 'inOut', pose: torso({ pelvis: -10, yaw: 8, pitch: -9 }), hips: [0.04, -0.12, 0], wpn: C([0.42, -0.14, 0.12], dir(-10, 48), DOWN), ...ST },
        g(20, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 3, name: 'swing' }, { f: 5, name: 'impact' }],
    },
    // close finisher (moves: close_finisher → 'kick'): grab the collar, rear back, HEADBUTT with the horned helm,
    // then heave the dazed foe away with both hands (8 / 4 / 22)
    kick: {
      frames: 34, grip: 0,
      keys: [
        { f: 0, ...GUARD },
        { f: 3, ease: 'out', pose: torso({ pelvis: -8, yaw: 8, pitch: -10, look: 1 }), hips: [0.04, -0.14, 0], wpn: LOW, handL: [0.74, 0.2, -0.08], ...ST_WIDE },
        { f: 6, ease: 'out', pose: torso({ pelvis: 0, yaw: 2, pitch: 16, look: 0.2, hp: 18 }), hips: [-0.08, -0.08, 0], handL: [0.68, 0.16, -0.08],
          ...feet([0.3, 0, -0.08, 0, 8], [-0.3, 0.02, 0.13, -8, 36]) },
        { f: 8, ease: 'outCubic', pose: torso({ pelvis: 8, yaw: 0, pitch: -30, look: 0, hp: -14 }), hips: [0.16, -0.16, 0], handL: [0.4, 0.06, -0.16],
          ...feet([0.42, 0, -0.08, 0, 8], [-0.38, 0.06, 0.13, -22, 36]) },
        { f: 12, pose: torso({ pelvis: 8, yaw: 0, pitch: -27, look: 0, hp: -12 }), hips: [0.15, -0.16, 0] },
        { f: 16, ease: 'out', pose: torso({ pelvis: 6, yaw: 2, pitch: -6, look: 0.8 }), hips: [0.12, -0.12, 0], handL: [0.8, 0.12, -0.12] },
        { f: 25, ease: 'inOut', ...GUARD, hips: [0.05, -0.12, 0], grip: 1 },
        g(34, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 5, name: 'swing' }, { f: 8, name: 'impact' }],
    },
    // clinch: fist in the foe's collar, the axe hanging low, shoulders hunched
    grab: {
      frames: 40, loop: true, grip: 0, plant: 1,
      keys: [
        { f: 0, ...CLINCH },
        { f: 20, ...CLINCH, pose: torso({ pelvis: -14, yaw: 10, pitch: -14, look: 1 }), hips: [0.03, -0.15, 0], handL: [0.7, 0.14, -0.06] },
      ],
    },
    knee: {  // short dwarf knee to the gut, yanking the collar down onto it
      frames: 17, grip: 0,
      keys: [
        { f: 0, ...CLINCH },
        { f: 3, ease: 'out', pose: torso({ pelvis: -16, yaw: 8, pitch: -6, look: 1 }), hips: [-0.03, -0.12, 0], ...feet([0.3, 0, -0.08, 0, 8], [-0.2, 0.12, 0.1, -30, 20]), handL: [0.76, 0.26, -0.06] },
        { f: 5, ease: 'outCubic', pose: torso({ pelvis: 8, yaw: 2, pitch: -22, look: 1 }), hips: [0.08, -0.08, 0], ...feet([0.3, 0, -0.08, 0, 8], [0.46, 0.6, 0.04, -34, 0]), handL: [0.6, -0.14, -0.06] },
        { f: 9, pose: torso({ pelvis: 6, yaw: 2, pitch: -20, look: 1 }), hips: [0.07, -0.09, 0], ...feet([0.3, 0, -0.08, 0, 8], [0.4, 0.48, 0.05, -28, 0]) },
        { f: 17, ease: 'inOut', ...CLINCH },
      ],
      events: [{ f: 5, name: 'impact' }],
    },
    grab_hit: { alias: 'knee' },
    // throw: heave the foe up overhead like a keg and hurl it forward (grab 7, release 20, total 42)
    throw: {
      frames: 42, grip: 0,
      keys: [
        { f: 0, ...CLINCH },
        { f: 7, ease: 'out', pose: torso({ pelvis: 0, yaw: 4, pitch: -26 }), hips: [0.04, -0.3, 0], ...ST_WIDE, wpn: C([0.62, -0.08, 0.3], dir(170, -50), DOWN), handL: [0.66, -0.06, -0.24] },
        { f: 13, ease: 'inOut', pose: torso({ pelvis: 0, yaw: 2, pitch: 4 }), hips: [0.0, -0.1, 0], wpn: C([0.34, 0.74, 0.26], dir(175, -10), DOWN), handL: [0.34, 0.74, -0.26] },
        { f: 18, ease: 'inOut', pose: torso({ pelvis: 0, yaw: 0, pitch: 20, look: 0.6 }), hips: [-0.08, -0.08, 0], ...feet([0.36, 0.02, -0.08, 10, 8], [-0.3, 0, 0.13, 0, 36]),
          wpn: C([0.08, 1.02, 0.26], dir(178, 20), DOWN), handL: [0.08, 1.02, -0.26] },
        { f: 20, ease: 'in', pose: torso({ pelvis: 10, yaw: 6, pitch: -26 }), hips: [0.14, -0.2, 0], ...feet([0.48, 0, -0.08, 0, 8], [-0.42, 0.05, 0.13, -22, 36]),
          wpn: C([0.72, 0.5, 0.24], dir(30, 30), DOWN), handL: [0.72, 0.48, -0.24] },
        { f: 26, ease: 'out', pose: torso({ pelvis: 12, yaw: 8, pitch: -30 }), hips: [0.15, -0.22, 0], wpn: C([0.6, -0.12, 0.3], dir(20, 0), DOWN), handL: [0.55, -0.22, -0.3] },
        { f: 34, ease: 'inOut', ...GUARD, hips: [0.06, -0.13, 0], grip: 1 },
        g(42, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 7, name: 'grab' }, { f: 20, name: 'impact' }],
    },
    // throw_back: hoist overhead, arch and slam the foe down behind (code turns Gorrim after the release)
    throw_back: {
      frames: 42, grip: 0,
      keys: [
        { f: 0, ...CLINCH },
        { f: 7, ease: 'out', pose: torso({ pelvis: 0, yaw: 4, pitch: -26 }), hips: [0.04, -0.3, 0], ...ST_WIDE, wpn: C([0.62, -0.08, 0.3], dir(170, -50), DOWN), handL: [0.66, -0.06, -0.24] },
        { f: 13, ease: 'inOut', pose: torso({ pelvis: 0, pitch: 8, look: 0.4 }), hips: [0.0, -0.08, 0], wpn: C([0.3, 0.84, 0.26], dir(175, 0), DOWN), handL: [0.3, 0.84, -0.26] },
        { f: 20, ease: 'in', pose: torso({ pelvis: -4, pitch: 36, look: 0 }), hips: [-0.14, -0.14, 0], ...feet([0.36, 0, -0.08, 0, 8], [-0.22, 0, 0.13, 0, 36]),
          wpn: C([-0.32, 0.86, 0.26], dir(180, -30), DOWN), handL: [-0.32, 0.84, -0.26] },
        { f: 23, ease: 'out', pose: torso({ pelvis: 10, yaw: 6, pitch: -22 }), hips: [0.1, -0.2, 0], ...ST_WIDE, wpn: C([0.5, -0.22, 0.35], dir(40, -10), DOWN), handL: [0.45, -0.26, -0.3] },
        { f: 33, ease: 'inOut', ...GUARD, grip: 1 },
        g(42, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 7, name: 'grab' }, { f: 20, name: 'impact' }],
    },

    // ------------------------------------------------------------------------------------------- air
    jump_up: {
      frames: 20,
      keys: [
        { f: 0, pose: torso({ pelvis: -10, yaw: 4, pitch: -22 }), hips: [0.02, -0.26, 0], ...ST_WIDE, wpn: C([0.42, -0.34, 0.14], dir(-10, 30), DOWN), grip: 1 },
        { f: 4, ease: 'out', pose: torso({ pelvis: -8, yaw: 2, pitch: -4 }), hips: [0.03, 0.02, 0], ...feet([0.12, 0.02, -0.06, -42, 10], [-0.14, 0.06, 0.1, -55, 20]), wpn: C([0.4, 0.08, 0.14], dir(-5, 58), DOWN) },
        { f: 20, ease: 'inOut', pose: torso({ pelvis: -8, yaw: 4, pitch: -10 }), hips: [0.02, 0.0, 0], ...feet([0.32, 0.42, -0.06, 10, 10], [-0.02, 0.26, 0.1, -20, 20]), wpn: C([0.34, 0.24, 0.14], dir(-10, 64), DOWN) },
      ],
    },
    jump_fall: {
      frames: 36, loop: true,
      keys: [
        { f: 0, pose: torso({ pelvis: -8, yaw: 4, pitch: -6 }), ...feet([0.26, 0.18, -0.06, 12, 10], [-0.1, 0.07, 0.1, -6, 20]), wpn: C([0.36, 0.16, 0.14], dir(-10, 60), DOWN), grip: 1 },
        { f: 18, pose: torso({ pelvis: -8, yaw: 4, pitch: -4 }), ...feet([0.24, 0.12, -0.06, 14, 10], [-0.12, 0.03, 0.1, -2, 20]), wpn: C([0.36, 0.2, 0.14], dir(-10, 64), DOWN) },
      ],
    },
    land: {
      frames: 15, plant: 1,
      keys: [
        { f: 0, pose: torso({ pelvis: -12, yaw: 4, pitch: -26 }), hips: [0.05, -0.3, 0], ...ST_WIDE, wpn: C([0.46, -0.42, 0.14], dir(-10, 20), DOWN), grip: 1 },
        { f: 3, ease: 'out', pose: torso({ pelvis: -12, yaw: 4, pitch: -29 }), hips: [0.06, -0.34, 0], ...ST_WIDE },
        g(15, { ease: 'inOut' }),
      ],
    },
    land_heavy: {
      frames: 15, plant: 1,
      keys: [
        { f: 0, pose: torso({ pelvis: -12, yaw: 4, pitch: -34 }), hips: [0.06, -0.4, 0], ...ST_WIDE, wpn: C([0.5, -0.48, 0.16], dir(-5, 6), DOWN), grip: 1 },
        { f: 4, ease: 'out', pose: torso({ pelvis: -12, yaw: 4, pitch: -36 }), hips: [0.07, -0.44, 0], ...ST_WIDE },
        g(15, { ease: 'inOut' }),
      ],
    },
    // jump_attack: knees tucked, a tight overhead chop at the foe below; holds the low follow-through (5 / 40)
    jump_attack: {
      frames: 45,
      keys: [
        { f: 0, ease: 'out', pose: torso({ pelvis: -10, yaw: -12, pitch: 10, look: 1 }), ...feet([0.3, 0.4, -0.06, 10, 10], [-0.04, 0.26, 0.1, -20, 20]), wpn: C([-0.04, 0.84, 0.3], dir(170, 40), DOWN), grip: 1 },
        { f: 4, ease: 'in', pose: torso({ pelvis: -2, yaw: -2, pitch: -4 }), wpn: C([0.44, 0.66, 0.2], dir(10, 60), DOWN) },
        { f: 5, ease: 'linear', pose: torso({ pelvis: 6, yaw: 4, pitch: -24 }), ...feet([0.4, 0.38, -0.06, 10, 10], [-0.1, 0.18, 0.1, -24, 20]), wpn: C([0.74, 0.04, 0.06], dir(0, -30), DOWN) },
        { f: 9, ease: 'out', pose: torso({ pelvis: 8, yaw: 6, pitch: -32 }), wpn: C([0.58, -0.36, -0.04], dir(-8, -62), DOWN) },
        { f: 45, pose: torso({ pelvis: 8, yaw: 6, pitch: -28 }), ...feet([0.36, 0.34, -0.06, 10, 10], [-0.1, 0.16, 0.1, -20, 20]), wpn: C([0.56, -0.32, -0.04], dir(-8, -58), DOWN) },
      ],
      events: [{ f: 2, name: 'swing' }, { f: 5, name: 'impact' }],
    },
    air_light: { alias: 'jump_attack' },
    // run_jump_attack: dwarven cannonball — dives helm-first with the Copper Ax thrust out ahead, legs trailing (4 / 40)
    run_jump_attack: {
      frames: 44,
      keys: [
        { f: 0, ease: 'out', pose: torso({ pelvis: -6, pitch: 12, look: 1 }), ...feet([0.34, 0.3, -0.06, 16, 10], [-0.3, 0.26, 0.1, -30, 20]), wpn: C([0.1, 0.8, 0.2], dir(170, 50), DOWN), grip: 1 },
        { f: 3, ease: 'in', pose: torso({ pelvis: 0, pitch: -14, look: 0.9 }), wpn: C([0.5, 0.56, 0.1], dir(10, 40), DOWN) },
        { f: 4, ease: 'linear', pose: torso({ pelvis: 2, yaw: 2, pitch: -40, look: 0.9 }), hips: [0.08, 0.04, 0], ...feet([0.0, 0.46, -0.06, -30, 10], [-0.46, 0.52, 0.1, -60, 20]),
          wpn: C([0.82, 0.12, 0.05], dir(0, -12), DOWN) },
        { f: 10, ease: 'out', pose: torso({ pelvis: 2, yaw: 2, pitch: -44, look: 0.9 }), hips: [0.1, 0.04, 0], wpn: C([0.8, 0.02, 0.05], dir(0, -22), DOWN) },
        { f: 44, pose: torso({ pelvis: 2, yaw: 2, pitch: -40, look: 0.9 }), hips: [0.08, 0.02, 0], ...feet([0.06, 0.4, -0.06, -26, 10], [-0.4, 0.44, 0.1, -54, 20]),
          wpn: C([0.78, -0.02, 0.05], dir(0, -26), DOWN) },
      ],
      events: [{ f: 1, name: 'swing' }, { f: 4, name: 'impact' }],
    },
    // death_stab: hang at the apex, axe reversed with the top spike down, then plunge onto the downed foe (8 / 45)
    death_stab: {
      frames: 53,
      keys: [
        { f: 0, ease: 'out', pose: torso({ pelvis: -6, pitch: 6, look: 1 }), ...feet([0.3, 0.44, -0.06, 10, 10], [-0.06, 0.32, 0.1, -20, 20]), wpn: C([0.2, 0.8, 0.1], dir(0, -80), RISE), grip: 1 },
        { f: 7, ease: 'inOut', pose: torso({ pelvis: -4, pitch: 12, look: 1 }), ...feet([0.26, 0.5, -0.06, 10, 10], [-0.02, 0.38, 0.1, -20, 20]), wpn: C([0.16, 0.96, 0.1], dir(4, -86), RISE) },
        { f: 9, ease: 'in', pose: torso({ pelvis: 4, pitch: -22, look: 0.8 }), ...feet([0.34, 0.42, -0.06, 6, 10], [-0.16, 0.3, 0.1, -26, 20]), wpn: C([0.52, -0.26, 0.06], dir(8, -84), RISE) },
        { f: 53, pose: torso({ pelvis: 4, pitch: -24, look: 0.8 }), ...feet([0.32, 0.4, -0.06, 6, 10], [-0.16, 0.28, 0.1, -26, 20]), wpn: C([0.54, -0.3, 0.06], dir(8, -86), RISE) },
      ],
      events: [{ f: 8, name: 'swing' }],
    },
    // air_slam: Copper Ax meteor — rise with the axe high behind, then drive it straight down beneath (8 / 60)
    air_slam: {
      frames: 68,
      keys: [
        { f: 0, ease: 'out', pose: torso({ pelvis: -4, pitch: 10, look: 1 }), ...feet([0.26, 0.42, -0.06, 10, 10], [-0.1, 0.32, 0.1, -24, 20]), wpn: C([-0.06, 0.9, 0.3], dir(180, 44), DOWN), grip: 1 }, // C1 r5: hang/dive keys z 0.12/0.08 → 0.3/0.28 (axe beside the helm, not over it)
        { f: 7, ease: 'inOut', pose: torso({ pelvis: -4, pitch: 18, look: 1 }), ...feet([0.22, 0.48, -0.06, 10, 10], [-0.06, 0.38, 0.1, -24, 20]), wpn: C([-0.16, 0.98, 0.3], dir(180, 28), DOWN) },
        { f: 8, ease: 'in', pose: torso({ pelvis: 2, pitch: -8 }), wpn: C([0.44, 0.7, 0.28], dir(0, 60), DOWN) },
        { f: 10, ease: 'outCubic', pose: torso({ pelvis: 6, pitch: -30, look: 0.8 }), ...feet([0.22, 0.22, -0.06, 0, 10], [-0.24, 0.12, 0.1, -30, 20]), wpn: C([0.52, -0.3, 0.06], dir(4, -82), DOWN) },
        { f: 68, pose: torso({ pelvis: 6, pitch: -28, look: 0.8 }), ...feet([0.2, 0.18, -0.06, 0, 10], [-0.26, 0.1, 0.1, -30, 20]), wpn: C([0.52, -0.34, 0.06], dir(4, -84), DOWN) },
      ],
      events: [{ f: 8, name: 'swing' }],
    },
    air_heavy_slam: { alias: 'air_slam' },
    // air_slam_land: the axe splits the floor, deep shockwave squat, wrench it free (0 / 4 / 22)
    air_slam_land: {
      frames: 26, plant: 1,
      keys: [
        { f: 0, pose: torso({ pelvis: 6, pitch: -40, look: 0.7 }), hips: [0.1, -0.44, 0], ...ST_WIDE, wpn: C([0.62, -0.62, 0.06], dir(4, -78), DOWN), grip: 1 },
        { f: 5, ease: 'out', pose: torso({ pelvis: 6, pitch: -42, look: 0.7 }), hips: [0.1, -0.47, 0], wpn: C([0.62, -0.64, 0.06], dir(4, -80), DOWN) },
        { f: 12, ease: 'inOut', pose: torso({ pelvis: 2, pitch: -30, look: 0.8 }), hips: [0.08, -0.34, 0], wpn: C([0.56, -0.5, 0.08], dir(4, -60), DOWN) },
        { f: 17, ease: 'out', pose: torso({ pelvis: -8, yaw: 4, pitch: -14 }), hips: [0.04, -0.18, 0], wpn: C([0.46, -0.1, 0.12], dir(-4, 40), DOWN) },
        g(26, { ease: 'inOut' }),
      ],
      events: [{ f: 0, name: 'impact' }],
    },

    // ------------------------------------------------------------------------------------------- dash / back / evade
    // run_attack: HEADBUTT CHARGE — horned helm lowered like a battering ram, axe trailing one-handed (6 / 8 / 20)
    run_attack: {
      frames: 34, grip: 0,
      keys: [
        { f: 0, pose: torso({ pelvis: 6, yaw: 6, pitch: -20, look: 0.3 }), hips: [0.06, -0.14, 0], ...ST_WIDE, wpn: C([-0.04, -0.4, 0.46], dir(172, -24), DOWN),
          handL: [0.3, -0.2, -0.36] },
        { f: 4, ease: 'out', pose: torso({ pelvis: 8, yaw: 8, pitch: -38, look: 0, hp: -10 }), hips: [0.12, -0.24, 0], ...feet([0.36, 0, -0.08, 0, 8], [-0.38, 0.05, 0.13, -24, 36]),
          wpn: C([-0.2, -0.34, 0.5], dir(176, -14), DOWN), handL: [0.16, -0.1, -0.38] },
        { f: 6, ease: 'outCubic', pose: torso({ pelvis: 10, yaw: 8, pitch: -46, look: 0, hp: -14 }), hips: [0.22, -0.26, 0], ...feet([0.52, 0, -0.08, 0, 8], [-0.5, 0.07, 0.13, -32, 36]),
          handL: [0.1, -0.04, -0.36] },
        { f: 14, pose: torso({ pelvis: 10, yaw: 8, pitch: -44, look: 0, hp: -12 }), hips: [0.21, -0.25, 0] },
        { f: 24, ease: 'inOut', pose: torso({ pelvis: -4, yaw: 8, pitch: -4 }), hips: [0.0, -0.14, 0], ...ST_WIDE, wpn: C([0.34, -0.26, 0.3], dir(20, 36), DOWN), handL: [0.4, -0.3, -0.24] },
        g(34, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 3, name: 'swing' }, { f: 6, name: 'impact' }],
    },
    // back_attack: INVULNERABLE backward roll-stab — tuck, roll back over the shoulders with the axe wheeling
    // overhead-behind, land crouched and spear the haft spike back into the foe (6 / 12 / 14). Goals ride the chest.
    back_attack: {
      frames: 32, goalSpace: 'chest', grip: 1,
      keys: [
        { f: 0, pose: torso({ pelvis: -10, pitch: -10 }), hips: [0, -0.12, 0], ...ST, wpn: C([0.44, -0.2, 0.16], dir(-8, 52), DOWN) },
        { f: 3, ease: 'in', pose: pose(torso({ pitch: -30 }), { hips: [0, 0, 20] }), hips: [-0.06, -0.4, 0], ...ST_WIDE, wpn: C([0.3, 0.5, 0.2], dir(10, 88), DOWN) },
        { f: 6, pose: pose({ hips: [0, 0, 100], spine: [0, 0, -24], chest: [0, 0, -18], neck: [0, 0, -26] }, TUCK), hips: [-0.2, -0.46, 0], wpn: C([0.2, 0.86, 0.2], dir(0, 90), DOWN) },
        { f: 10, pose: pose({ hips: [0, 0, 205], spine: [0, 0, -28], chest: [0, 0, -20], neck: [0, 0, -24] }, TUCK), hips: [-0.26, -0.28, 0], wpn: C([0.22, 0.9, 0.2], dir(0, 90), DOWN) },
        { f: 14, pose: pose({ hips: [0, 0, 300], spine: [0, 0, -20], chest: [0, 0, -14], neck: [0, 0, -12] }, TUCK), hips: [-0.2, -0.36, 0], wpn: C([0.2, 0.7, 0.24], dir(20, 60), DOWN) },
        { f: 18, ease: 'outCubic', pose: pose(torso({ pelvis: 30, yaw: 34, pitch: -18, look: 0.2 }), { hips: [0, 30, 360] }), hips: [-0.06, -0.3, 0], ...feet([0.3, 0, -0.08, 0, 8], [-0.36, 0.1, 0.13, -40, 40]),
          wpn: C([-0.5, -0.02, 0.3], dir(180, -12), [0, -1, 0]) },
        { f: 23, pose: pose(torso({ pelvis: 30, yaw: 34, pitch: -16, look: 0.2 }), { hips: [0, 30, 360] }), hips: [-0.06, -0.29, 0], wpn: C([-0.46, 0.0, 0.3], dir(180, -10), [0, -1, 0]) },
        { f: 32, ease: 'inOut', pose: pose(G_TORSO, { hips: [0, -16, 360] }), hips: G_HIPS, ...ST, wpn: G_WPN, plant: 1 },
      ],
      events: [{ f: 3, name: 'swing' }, { f: 6, name: 'impact' }, { f: 18, name: 'impact' }],
    },
    // dodge_roll: compact forward roll over the shoulder, axe hugged to the chest (22 frames)
    dodge_roll: {
      frames: 22, goalSpace: 'chest', grip: 1,
      keys: [
        { f: 0, pose: torso({ pitch: -26 }), hips: [0.04, -0.3, 0], ...ST_WIDE, wpn: C([0.3, -0.26, 0.3], dir(175, -15), DOWN) },
        { f: 4, ease: 'in', pose: pose({ hips: [0, 0, -70], spine: [0, 0, -30], chest: [0, 0, -22], neck: [0, 0, -30] }, leg('L', { thigh: [0.9, -0.35, -0.12], shin: [-0.5, -0.9, -0.1] }), leg('R', { thigh: [0.8, -0.5, 0.12], shin: [-0.55, -0.85, 0.1] })), hips: [0.16, -0.32, 0] },
        { f: 10, pose: pose({ hips: [0, 0, -185], spine: [0, 0, -34], chest: [0, 0, -24], neck: [0, 0, -30] }, TUCK), hips: [0.2, -0.28, 0] }, // C1 r5: inverted-phase hips lifted (-0.52/-0.58 → -0.32/-0.28) so the head clears the floor
        { f: 16, pose: pose({ hips: [0, 0, -300], spine: [0, 0, -26], chest: [0, 0, -16], neck: [0, 0, -12] }, TUCK), hips: [0.12, -0.28, 0] },
        { f: 22, ease: 'out', pose: pose({ hips: [0, 0, -360], spine: [0, 0, -10], chest: [0, 0, -6], neck: [0, 0, 0] }), hips: [0.02, -0.16, 0], ...ST_WIDE, wpn: C([0.4, -0.22, 0.16], dir(-8, 40), DOWN) },
      ],
    },
    // sidestep: duck the swing low and shuffle, axe haft raised as a bar between self and the foe
    sidestep: {
      frames: 22, plant: 0.6,
      keys: [
        g(0),
        { f: 4, ease: 'out', pose: torso({ pelvis: -18, yaw: -6, pitch: -30, roll: 12 }), hips: [-0.06, -0.32, 0.08], ...ST_WIDE, wpn: C([0.46, 0.0, 0.24], dir(-60, 20), DOWN) },
        { f: 12, pose: torso({ pelvis: -16, yaw: -4, pitch: -26, roll: 9 }), hips: [-0.05, -0.3, 0.06] },
        g(22, { ease: 'inOut' }),
      ],
    },

    // ------------------------------------------------------------------------------------------- show
    // taunt: slam the axe head-down beside him, lean on it and thump his chest twice
    taunt: {
      frames: 64, plant: 1,
      keys: [
        g(0),
        { f: 8, ease: 'out', pose: torso({ pelvis: -6, yaw: 6, pitch: -4 }), hips: [0.02, -0.08, 0], ...ST_WIDE, wpn: C([0.46, 0.2, 0.22], dir(10, 70), DOWN) },
        { f: 12, ease: 'in', pose: torso({ pelvis: -6, yaw: 6, pitch: -20 }), hips: [0.05, -0.18, 0], wpn: C([0.56, -0.3, 0.16], dir(0, -82), [1, 0, 0]) },
        { f: 18, ease: 'out', pose: torso({ pelvis: -8, yaw: 10, pitch: 6, look: 0.5, hp: 10 }), hips: [0.02, -0.1, 0], wpn: C([0.56, -0.3, 0.16], dir(0, -84), [1, 0, 0]), grip: 0,
          handL: [0.3, 0.18, -0.1] },
        { f: 22, ease: 'in', handL: [0.12, 0.2, -0.06] },
        { f: 28, ease: 'out', handL: [0.34, 0.2, -0.12] },
        { f: 32, ease: 'in', handL: [0.12, 0.18, -0.06] },
        { f: 36, ease: 'outBack', pose: torso({ pelvis: -10, yaw: 12, pitch: 12, look: 0.4, hp: 18 }), hips: [0.0, -0.08, 0], handL: [0.3, 0.36, -0.5] },
        { f: 52, pose: torso({ pelvis: -10, yaw: 12, pitch: 13, look: 0.4, hp: 18 }), hips: [0.0, -0.075, 0], wpn: C([0.56, -0.3, 0.16], dir(0, -84), [1, 0, 0]), handL: [0.32, 0.34, -0.52] },
        { f: 57, ease: 'inOut', pose: torso({ pelvis: -8, yaw: 6, pitch: -10 }), hips: [0.02, -0.12, 0], wpn: C([0.48, -0.1, 0.16], dir(0, 40), DOWN), grip: 1 },
        g(64, { ease: 'inOut' }),
      ],
      events: [{ f: 12, name: 'impact' }, { f: 22, name: 'impact' }, { f: 32, name: 'impact' }, { f: 36, name: 'roar' }],
    },
    victory: {  // the Copper Ax thrust at the sky, fist pumping, beard to the wind
      frames: 60, loop: true, grip: 0, breathe: 1,
      keys: [
        { f: 0, pose: torso({ pelvis: -12, yaw: -6, pitch: 10, look: 0.3, hp: 14 }), hips: [0, -0.06, 0], ...ST_WIDE, wpn: C([0.16, 1.02, 0.3], dir(4, 86), DOWN), handL: [0.36, 0.1, -0.5] },
        { f: 15, ease: 'out', pose: torso({ pelvis: -12, yaw: -8, pitch: 12, look: 0.3, hp: 16 }), hips: [0, -0.04, 0], handL: [0.3, 0.7, -0.5] },
        { f: 30, ease: 'in', pose: torso({ pelvis: -12, yaw: -6, pitch: 10, look: 0.3, hp: 14 }), hips: [0, -0.07, 0], wpn: C([0.18, 1.04, 0.3], dir(0, 88), DOWN), handL: [0.36, 0.08, -0.5] },
        { f: 45, ease: 'out', pose: torso({ pelvis: -12, yaw: -8, pitch: 12, look: 0.3, hp: 16 }), hips: [0, -0.04, 0], handL: [0.3, 0.7, -0.5] },
        { f: 60, ease: 'in', pose: torso({ pelvis: -12, yaw: -6, pitch: 10, look: 0.3, hp: 14 }), hips: [0, -0.06, 0], wpn: C([0.16, 1.02, 0.3], dir(4, 86), DOWN), handL: [0.36, 0.1, -0.5] },
      ],
    },
    // select_stand (C2 r2, hero-weapons; src/ui/select3d.js plays it when it exists, else idle): the select camera is
    // ~33 deg off his forward axis (char-space dir ≈ [0.96, 0.18, -0.21]); the idle/victory bits point forward = the head
    // edge-on to that camera. Here the Copper Ax stands haft-up beside his head with the bits LEFT-RIGHT (flats to camera).
    // C2 r3 (board r2: "Gorrim's select pose turns the ax head edge-on behind the haft across his chest"): the r2 one-handed
    // haft-up stand asked the short arm for 0.9 arm lengths of reach; the IK fell short and laid the haft across the chest.
    // Now the haft is held LEVEL in both hands in front of the belt (0.45 arm lengths: easy reach), the head out to his
    // RIGHT clear of the body, bits up / down, the haft perpendicular to the camera ray so the double-bit's BROAD FACE
    // squares to the select camera (char-space camera dir [0.96, 0.18, -0.21]: dir(80, 14) · cam = 0).
    select_stand: {
      // guard: 0 — the runtime blade guard (RigPost step 5, torso capsule) swung the level haft back to vertical over the
      // chest in the select set; the pose is static and authored clear of the body, so the guard is off for this clip.
      frames: 140, loop: true, plant: 1, breathe: 1.2, grip: 1, guard: 0, tags: ['idle'],
      keys: [
        { f: 0, pose: torso({ pelvis: -10, yaw: 6, pitch: 4, look: 0.5 }), hips: [0, -0.1, 0], ...ST_WIDE, wpn: C([0.44, -0.30, 0.20], dir(80, 14), SEL_CAM) },
        { f: 70, pose: torso({ pelvis: -10, yaw: 7, pitch: 2, look: 0.5 }), hips: [0, -0.12, 0], ...ST_WIDE, wpn: C([0.44, -0.32, 0.20], dir(80, 15), SEL_CAM) },
        { f: 140, pose: torso({ pelvis: -10, yaw: 6, pitch: 4, look: 0.5 }), hips: [0, -0.1, 0], ...ST_WIDE, wpn: C([0.44, -0.30, 0.20], dir(80, 14), SEL_CAM) },
      ],
    },
    // magic: storm — the Copper Ax raised two-handed to call the lightning (castPeak), then brought down
    magic_cast: {
      frames: 50, grip: 1,
      keys: [
        g(0),
        { f: 8, ease: 'out', pose: torso({ pitch: -22 }), hips: [0, -0.26, 0], ...ST_WIDE, wpn: C([0.4, -0.3, 0.12], dir(0, 20), DOWN) },
        { f: 20, ease: 'outCubic', pose: torso({ pitch: 16, look: 0.3, hp: 16 }), hips: [0, 0.0, 0], ...feet([0.2, 0, -0.08, 0, 8], [-0.2, 0.02, 0.13, -10, 36]), wpn: C([0.14, 1.04, 0.12], dir(0, 88), [1, 0, 0]) },
        { f: 22, pose: torso({ pitch: 18, look: 0.3, hp: 18 }), hips: [0, 0.01, 0], wpn: C([0.14, 1.06, 0.12], dir(0, 89), [1, 0, 0]) },
        { f: 38, pose: torso({ pitch: 15, look: 0.3, hp: 16 }), hips: [0, -0.01, 0], wpn: C([0.15, 1.03, 0.12], dir(0, 87), [1, 0, 0]) },
        g(50, { ease: 'inOut' }),
      ],
      events: [{ f: 22, name: 'castPeak' }],
    },
  },
};
