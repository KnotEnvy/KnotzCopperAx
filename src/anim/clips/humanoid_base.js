// Base humanoid clip set (generic one-handed fighter + the SHARED reaction set every humanoid uses).
// Heroes override locomotion/attacks in hero_<id>.js (priority 10); enemy archetypes in enemy_<style>.js.
// Convention: anim/retarget.js (character space +X fwd, +Y up, +Z right; Euler XYZ degrees); authoring kit: _kit.js.
// Reactions are keyed so they read from the side (the belt-scroller camera): big, clear silhouettes, snap on
// frame 2, weight through the legs, and airborne poses that hold until the combat code lands the body.
import { arm, leg, pose, dir, W, torso, feet, gait, swingArm } from './_kit.js';

// ------------------------------------------------------------------ shared poses (generic one-hander)
const ST = feet([0.16, 0, -0.04, 0, 8], [-0.17, 0, 0.07, 0, 26]);
const ST_W = feet([0.26, 0, -0.05, 0, 6], [-0.26, 0, 0.09, 0, 30]);
const G_T = torso({ pelvis: -10, yaw: 4, pitch: -8, look: 0.9 });
const G_W = W([0.34, -0.32, 0.44], dir(8, 52), [0, 0, 1]);
const G_HL = [0.34, -0.36, -0.32];
const GUARD = { pose: G_T, hips: [0, -0.08, 0], ...ST, wpn: G_W, handL: G_HL };
const g = (f, x = {}) => ({ f, ...GUARD, ...x });
const NEUTRAL = { pose: torso({ pitch: -4 }), hips: [0, -0.06, 0], ...ST, wpn: W([0.25, -0.5, 0.45], dir(20, 10), [0, 0, 1]), handL: [0.2, -0.55, -0.35] };

// Lying on the back (hips tipped back ~86°, feet toward facing). FK limbs: they ride with the body.
const LY_LEGS = pose(
  leg('L', { thigh: [0.32, -1, -0.2], shin: [-0.06, -1, -0.13], toe: [0.95, -0.2, -0.25] }),
  leg('R', { thigh: [0.12, -1, 0.24], shin: [0.08, -1, 0.2], toe: [0.95, -0.25, 0.3] }),
);
const LY_ARMS = pose(arm('L', { upper: [-0.25, -0.4, -0.88], fore: [0.05, -0.2, -0.98] }), arm('R', { upper: [-0.3, -0.3, 0.9], fore: [0.2, -0.1, 0.97], blade: [0.3, -0.2, 0.93] }));
const LYING = { pose: pose({ hips: [0, 0, 86], spine: [0, 0, 3], chest: [0, 0, 2], neck: [0, 0, -12], head: [0, 14, -8] }, LY_LEGS, LY_ARMS), hips: [-0.1, -0.84, 0] };
const FLY_BACK = pose({ hips: [0, 0, 74], spine: [0, 0, 8], chest: [0, 0, 8], neck: [0, 0, 10], head: [0, 0, 14] },
  leg('L', { thigh: [0.75, -0.65, -0.15], shin: [0.2, -1, -0.12], toe: [0.9, 0.3, -0.1] }), leg('R', { thigh: [0.45, -0.9, 0.18], shin: [-0.2, -1, 0.15], toe: [0.8, 0.4, 0.1] }),
  arm('L', { upper: [0.1, 0.55, -0.83], fore: [-0.3, 0.8, -0.5] }), arm('R', { upper: [0.1, 0.6, 0.8], fore: [-0.3, 0.85, 0.45], blade: [-0.5, 0.8, 0.3] }));

// ------------------------------------------------------------------ locomotion
const walkKeys = gait({ P: 0.72, v: 2.4, duty: 0.56, cx: 0.34, lift: 0.12, heel: 0.1, bob: 0.025, hipsY: -0.07, twist: 7, lean: -6,
  upper: (ph) => { const s = Math.sin(ph * Math.PI * 2); return { wpn: W([0.3 + s * 0.08, -0.36, 0.44], dir(12 + s * 6, 48), [0, 0, 1]), pose: swingArm('L', -22 * s, 28, 0.3) }; } });
const runKeys = gait({ P: 0.56, v: 5.6, duty: 0.3, cx: 0.4, lift: 0.28, heel: 0.1, bob: 0.045, hipsY: -0.1, twist: 11, lean: -15, flight: 0.1,
  upper: (ph) => { const s = Math.sin(ph * Math.PI * 2); return { wpn: W([0.2 + s * 0.22, -0.3, 0.44], dir(40 + s * 30, 30), [0, 0, 1]), pose: swingArm('L', -48 * s, 80, 0.25) }; } });

export default {
  rig: 'humanoid',
  priority: 0,
  clips: {
    idle: {
      frames: 120, loop: true, plant: 1, breathe: 1, tags: ['idle'],
      keys: [g(0), g(60, { pose: torso({ pelvis: -11, yaw: 5, pitch: -9.5, look: 0.9 }), hips: [0.01, -0.09, 0], handL: [0.33, -0.38, -0.33] }), g(120)],
    },
    walk: { duration: 0.72, loop: true, keys: walkKeys, events: [{ n: 0.02, name: 'footstep', foot: 'L' }, { n: 0.52, name: 'footstep', foot: 'R' }] },
    run: { duration: 0.56, loop: true, keys: runKeys, events: [{ n: 0.02, name: 'footstep', foot: 'L' }, { n: 0.52, name: 'footstep', foot: 'R' }] },
    jump_up: {
      frames: 20,
      keys: [
        { f: 0, pose: torso({ pitch: -18 }), hips: [0, -0.2, 0], ...ST_W, wpn: G_W, handL: G_HL },
        { f: 4, ease: 'out', pose: torso({ pitch: -4 }), hips: [0.02, 0.02, 0], ...feet([0.1, 0.02, -0.04, -40, 8], [-0.12, 0.04, 0.07, -50, 20]), wpn: W([0.3, 0.1, 0.44], dir(20, 70), [0, 0, 1]), handL: [0.3, 0.25, -0.4] },
        { f: 20, ease: 'inOut', pose: torso({ pitch: -10 }), hips: [0.02, 0.0, 0], ...feet([0.26, 0.36, -0.04, 10, 8], [-0.04, 0.2, 0.07, -20, 20]), wpn: W([0.3, 0.2, 0.44], dir(10, 72), [0, 0, 1]), handL: [0.36, 0.05, -0.38] },
      ],
    },
    jump_fall: {
      frames: 36, loop: true,
      keys: [
        { f: 0, pose: torso({ pitch: -6 }), hips: [0, 0, 0], ...feet([0.24, 0.14, -0.04, 12, 8], [-0.1, 0.06, 0.07, -8, 20]), wpn: W([0.32, 0.12, 0.44], dir(15, 62), [0, 0, 1]), handL: [0.3, 0.2, -0.45] },
        { f: 18, pose: torso({ pitch: -4 }), hips: [0, 0, 0], ...feet([0.22, 0.1, -0.04, 14, 8], [-0.12, 0.03, 0.07, -4, 20]), wpn: W([0.33, 0.16, 0.45], dir(15, 66), [0, 0, 1]), handL: [0.3, 0.26, -0.47] },
      ],
    },
    land: {
      frames: 16, plant: 1,
      keys: [
        { f: 0, pose: torso({ pitch: -24 }), hips: [0.04, -0.26, 0], ...ST_W, wpn: W([0.4, -0.42, 0.44], dir(20, 20), [0, 0, 1]), handL: [0.35, -0.5, -0.4] },
        { f: 3, ease: 'out', pose: torso({ pitch: -26 }), hips: [0.05, -0.28, 0], ...ST_W },
        g(16, { ease: 'inOut' }),
      ],
    },

    // ------------------------------------------------------------------ generic one-handed attacks
    light_1: {
      frames: 23,
      keys: [
        g(0),
        { f: 4, ease: 'out', pose: torso({ pelvis: -24, yaw: -22, pitch: -2 }), hips: [-0.03, -0.1, 0], wpn: W([0.02, 0.35, 0.55], dir(150, 50), [0, 0, 1]), handL: [0.45, -0.2, -0.2] },
        { f: 6, ease: 'in', pose: torso({ pelvis: 6, yaw: 8, pitch: -12 }), hips: [0.1, -0.12, 0], wpn: W([0.7, 0.05, 0.18], dir(0, -8), [0, 0.7, 0.7]), handL: [0.1, -0.45, -0.4], ...feet([0.3, 0, -0.04, 0, 8], [-0.25, 0, 0.07, 0, 26]) },
        { f: 10, ease: 'out', pose: torso({ pelvis: 18, yaw: 18, pitch: -14 }), hips: [0.12, -0.13, 0], wpn: W([0.55, -0.25, -0.2], dir(-50, -40), [0, 0.7, -0.7]) },
        { f: 16, pose: torso({ pelvis: 12, yaw: 12, pitch: -12 }), hips: [0.1, -0.12, 0], wpn: W([0.5, -0.3, -0.1], dir(-40, -30), [0, 0.7, -0.7]) },
        g(23, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 4, name: 'swing' }, { f: 6, name: 'impact' }],
    },
    light_2: {
      frames: 23,
      keys: [
        { f: 0, pose: torso({ pelvis: 14, yaw: 12, pitch: -12 }), hips: [0.08, -0.12, 0], ...ST, wpn: W([0.5, -0.3, -0.1], dir(-40, -30), [0, 0.7, -0.7]), handL: G_HL },
        { f: 3, ease: 'out', pose: torso({ pelvis: 22, yaw: 24, pitch: -10 }), hips: [0.04, -0.12, 0], wpn: W([0.2, -0.1, -0.5], dir(-150, 10), [0, 0.7, -0.7]) },
        { f: 5, ease: 'in', pose: torso({ pelvis: -4, yaw: -8, pitch: -10 }), hips: [0.1, -0.11, 0], wpn: W([0.7, 0.1, 0.1], dir(10, 10), [0, -0.7, 0.7]), ...feet([0.28, 0, -0.04, 0, 8], [-0.25, 0, 0.07, 0, 26]) },
        { f: 9, ease: 'out', pose: torso({ pelvis: -18, yaw: -20, pitch: -8 }), hips: [0.1, -0.1, 0], wpn: W([0.4, 0.2, 0.55], dir(80, 25), [0, -0.7, 0.7]) },
        g(23, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 3, name: 'swing' }, { f: 5, name: 'impact' }],
    },
    light_3: {
      frames: 34,
      keys: [
        g(0),
        { f: 6, ease: 'out', pose: torso({ pelvis: -8, yaw: -8, pitch: 12, look: 1 }), hips: [-0.04, -0.05, 0], wpn: W([0.0, 0.95, 0.3], dir(175, 40), [0, 0, 1]), handL: [0.4, 0.3, -0.3], ...feet([0.24, 0.08, -0.04, 10, 8], [-0.2, 0.02, 0.07, -12, 26]) },
        { f: 8, ease: 'in', pose: torso({ pelvis: 6, yaw: 4, pitch: -26 }), hips: [0.16, -0.2, 0], wpn: W([0.72, 0.1, 0.15], dir(0, -25), [0, 0, 1]), handL: [0.2, -0.4, -0.45], ...feet([0.42, 0, -0.04, 0, 8], [-0.36, 0, 0.07, 0, 26]) },
        { f: 12, ease: 'out', pose: torso({ pelvis: 8, yaw: 4, pitch: -34 }), hips: [0.18, -0.25, 0], wpn: W([0.6, -0.3, 0.15], dir(0, -55), [0, 0, 1]) },
        { f: 20, pose: torso({ pelvis: 8, yaw: 4, pitch: -30 }), hips: [0.17, -0.23, 0], wpn: W([0.58, -0.32, 0.18], dir(0, -52), [0, 0, 1]) },
        g(34, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 6, name: 'swing' }, { f: 8, name: 'impact' }],
    },
    heavy: { alias: 'light_3', frames: 42 },
    run_attack: {
      frames: 29,
      keys: [
        { f: 0, pose: torso({ pelvis: -10, yaw: -14, pitch: -18 }), hips: [0.06, -0.14, 0], ...ST_W, wpn: W([0.0, 0.2, 0.55], dir(160, 30), [0, 0, 1]), handL: [0.4, -0.2, -0.3] },
        { f: 5, ease: 'in', pose: torso({ pelvis: 12, yaw: 14, pitch: -22 }), hips: [0.2, -0.16, 0], wpn: W([0.78, 0.0, 0.15], dir(0, -5), [0, 0.7, 0.7]), handL: [0.1, -0.4, -0.45], ...feet([0.4, 0, -0.04, 0, 8], [-0.4, 0.05, 0.07, -20, 26]) },
        { f: 13, pose: torso({ pelvis: 16, yaw: 16, pitch: -20 }), hips: [0.2, -0.16, 0], wpn: W([0.7, -0.1, -0.1], dir(-30, -15), [0, 0.7, 0.7]) },
        g(29, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 3, name: 'swing' }],
    },
    jump_attack: {
      frames: 44,
      keys: [
        { f: 0, pose: torso({ pitch: 6 }), hips: [0, 0, 0], ...feet([0.3, 0.35, -0.04, 10, 8], [-0.05, 0.2, 0.07, -20, 20]), wpn: W([0.05, 0.8, 0.35], dir(170, 40), [0, 0, 1]), handL: [0.4, 0.2, -0.35] },
        { f: 4, ease: 'in', pose: torso({ pitch: -24 }), hips: [0.05, 0, 0], ...feet([0.36, 0.32, -0.04, 10, 8], [-0.12, 0.12, 0.07, -20, 20]), wpn: W([0.7, -0.05, 0.12], dir(0, -40), [0, 0, 1]), handL: [0.1, -0.2, -0.5] },
        { f: 9, ease: 'out', pose: torso({ pitch: -26 }), hips: [0.05, 0, 0], wpn: W([0.55, -0.35, 0.1], dir(0, -62), [0, 0, 1]) },
        { f: 44, pose: torso({ pitch: -22 }), hips: [0.05, 0, 0], wpn: W([0.55, -0.3, 0.1], dir(0, -58), [0, 0, 1]) },
      ],
      events: [{ f: 2, name: 'swing' }],
    },
    air_light: { alias: 'jump_attack' },
    run_jump_attack: { alias: 'jump_attack' },
    death_stab: { alias: 'jump_attack' },
    air_slam: { alias: 'jump_attack' },
    air_heavy_slam: { alias: 'jump_attack' },
    air_slam_land: { alias: 'land', frames: 21 },
    launcher: { alias: 'light_2' },
    back_attack: { alias: 'light_2' },
    pommel: { alias: 'light_2' },
    heavy_charge: { frames: 40, loop: true, keys: [{ f: 0, pose: torso({ pelvis: -24, yaw: -22, pitch: -2 }), hips: [-0.05, -0.14, 0], ...ST_W, wpn: W([0.02, 0.4, 0.55], dir(155, 50), [0, 0, 1]), handL: [0.45, -0.15, -0.2] }] },
    kick: {
      frames: 31,
      keys: [
        g(0),
        { f: 4, ease: 'out', pose: torso({ pitch: 6 }), hips: [-0.04, -0.06, 0], ...feet([0.12, 0, -0.04, 0, 10], [0.2, 0.45, 0.05, 20, 0]), wpn: W([0.1, -0.2, 0.55], dir(160, 20), [0, 0, 1]), handL: [0.45, -0.1, -0.3] },
        { f: 7, ease: 'outCubic', pose: torso({ pitch: 18 }), hips: [-0.1, -0.06, 0], ...feet([0.1, 0, -0.04, 0, 10], [0.86, 0.5, 0.03, 70, 0]), wpn: W([0.0, -0.3, 0.55], dir(170, 10), [0, 0, 1]), handL: [0.5, 0.0, -0.3] },
        { f: 11, pose: torso({ pitch: 16 }), hips: [-0.1, -0.06, 0], ...feet([0.1, 0, -0.04, 0, 10], [0.8, 0.46, 0.03, 60, 0]) },
        { f: 18, ease: 'inOut', pose: torso({ pitch: 2 }), hips: [0, -0.07, 0], ...feet([0.12, 0, -0.04, 0, 10], [0.25, 0.25, 0.06, 10, 10]) },
        g(31, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 4, name: 'swing' }],
    },
    grab: {
      frames: 40, loop: true,
      keys: [
        { f: 0, pose: torso({ pitch: -8, yaw: 6 }), hips: [0, -0.1, 0], ...ST_W, wpn: W([0.1, -0.5, 0.45], dir(170, -30), [0, 0, 1]), handL: [0.72, 0.1, -0.05] },
        { f: 20, pose: torso({ pitch: -10, yaw: 4 }), hips: [0.01, -0.11, 0], ...ST_W, wpn: W([0.1, -0.52, 0.45], dir(170, -32), [0, 0, 1]), handL: [0.7, 0.05, -0.05] },
      ],
    },
    knee: {
      frames: 17,
      keys: [
        { f: 0, pose: torso({ pitch: -8, yaw: 6 }), hips: [0, -0.1, 0], ...ST_W, wpn: W([0.1, -0.5, 0.45], dir(170, -30), [0, 0, 1]), handL: [0.72, 0.1, -0.05] },
        { f: 5, ease: 'outCubic', pose: torso({ pitch: -16, yaw: 2 }), hips: [0.06, -0.06, 0], ...feet([0.26, 0, -0.05, 0, 6], [0.42, 0.55, 0.04, -30, 0]), handL: [0.62, -0.1, -0.05] },
        { f: 9, pose: torso({ pitch: -14 }), hips: [0.05, -0.07, 0], ...feet([0.26, 0, -0.05, 0, 6], [0.36, 0.45, 0.05, -25, 0]) },
        { f: 17, ease: 'inOut', pose: torso({ pitch: -8, yaw: 6 }), hips: [0, -0.1, 0], ...ST_W, handL: [0.72, 0.1, -0.05] },
      ],
      events: [{ f: 5, name: 'impact' }],
    },
    grab_hit: { alias: 'knee' },
    throw: {
      frames: 38,
      keys: [
        { f: 0, ...NEUTRAL },
        { f: 6, ease: 'out', pose: torso({ pitch: -18 }), hips: [0.02, -0.2, 0], ...ST_W, wpn: W([0.6, 0.0, 0.3], dir(160, -40), [0, 0, 1]), handL: [0.65, 0.0, -0.2] },
        { f: 14, ease: 'inOut', pose: torso({ pitch: 14 }), hips: [-0.02, -0.06, 0], wpn: W([0.25, 0.95, 0.2], dir(170, 10), [0, 0, 1]), handL: [0.25, 0.95, -0.2] },
        { f: 18, ease: 'in', pose: torso({ pitch: -22 }), hips: [0.1, -0.14, 0], ...feet([0.36, 0, -0.05, 0, 6], [-0.3, 0.04, 0.09, -20, 30]), wpn: W([0.7, 0.4, 0.25], dir(20, 30), [0, 0, 1]), handL: [0.7, 0.4, -0.2] },
        { f: 26, pose: torso({ pitch: -18 }), hips: [0.1, -0.13, 0], wpn: W([0.55, -0.1, 0.3], dir(10, 0), [0, 0, 1]), handL: [0.55, -0.1, -0.3] },
        g(38, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 18, name: 'impact' }],
    },
    throw_back: { alias: 'throw' },
    dodge_roll: {
      frames: 22, goalSpace: 'chest', grip: 0,
      keys: [
        { f: 0, pose: torso({ pitch: -20 }), hips: [0.02, -0.25, 0], ...ST_W, wpn: W([0.3, -0.3, 0.45], dir(170, -10), [0, 0, 1]), handL: [0.35, -0.3, -0.4] },
        { f: 4, ease: 'in', pose: pose({ hips: [0, 0, -70], spine: [0, 0, -30], chest: [0, 0, -20], neck: [0, 0, -30] }, leg('L', { thigh: [1, 0.1, -0.12], shin: [-0.5, -0.9, -0.1] }), leg('R', { thigh: [0.9, -0.2, 0.12], shin: [-0.6, -0.8, 0.1] })), hips: [0.15, -0.5, 0] },
        { f: 10, pose: pose({ hips: [0, 0, -185], spine: [0, 0, -32], chest: [0, 0, -22], neck: [0, 0, -30] }, leg('L', { thigh: [1, 0.25, -0.12], shin: [-0.7, -0.7, -0.1] }), leg('R', { thigh: [1, 0.15, 0.12], shin: [-0.7, -0.7, 0.1] })), hips: [0.2, -0.56, 0] },
        { f: 16, pose: pose({ hips: [0, 0, -300], spine: [0, 0, -26], chest: [0, 0, -16], neck: [0, 0, -12] }, leg('L', { thigh: [0.9, -0.4, -0.12], shin: [-0.6, -0.8, -0.1] }), leg('R', { thigh: [0.7, -0.7, 0.12], shin: [-0.7, -0.7, 0.1] })), hips: [0.12, -0.36, 0] },
        { f: 22, ease: 'out', pose: pose({ hips: [0, 0, -360] }, torso({ pitch: -14 }), leg('L', { thigh: [0.3, -1, -0.1], shin: [-0.1, -1, -0.1] }), leg('R', { thigh: [-0.2, -1, 0.1], shin: [-0.4, -1, 0.1] })), hips: [0.02, -0.12, 0] },
      ],
    },
    sidestep: {
      frames: 22, plant: 0.6,
      keys: [
        g(0),
        { f: 5, ease: 'out', pose: torso({ pitch: -22, roll: 14, yaw: -10 }), hips: [-0.06, -0.3, 0.1], ...ST_W },
        { f: 12, pose: torso({ pitch: -18, roll: 10, yaw: -8 }), hips: [-0.05, -0.26, 0.08] },
        g(22, { ease: 'inOut' }),
      ],
    },

    // ------------------------------------------------------------------ SHARED REACTIONS (grip released)
    hit_high: {
      frames: 22, grip: 0, look: 0, plant: 0.8,
      keys: [
        { f: 0, ...NEUTRAL },
        { f: 2, ease: 'outExpo', pose: pose(torso({ pitch: 18, yaw: -9, roll: -4, look: 0 }), { head: [6, -6, 22], neck: [0, 0, 10] }), hips: [-0.07, -0.1, 0],
          wpn: W([0.32, -0.12, 0.66], dir(85, -8), [0, 1, 0]), handL: [0.28, -0.1, -0.66] },
        { f: 7, pose: pose(torso({ pitch: 12, yaw: -6, roll: -3, look: 0 }), { head: [4, -4, 14] }), hips: [-0.08, -0.11, 0], wpn: W([0.3, -0.28, 0.6], dir(60, -5), [0, 1, 0]), handL: [0.3, -0.3, -0.6] },
        { f: 14, ease: 'inOut', pose: torso({ pitch: 4, yaw: -3 }), hips: [-0.04, -0.09, 0], wpn: W([0.3, -0.35, 0.5], dir(20, 30), [0, 0, 1]), handL: [0.3, -0.35, -0.45] },
        { f: 22, ease: 'inOut', ...NEUTRAL },
      ],
    },
    hit_high_alt: {  // gut punch: fold forward
      frames: 22, grip: 0, look: 0, plant: 0.8,
      keys: [
        { f: 0, ...NEUTRAL },
        { f: 2, ease: 'outExpo', pose: pose(torso({ pitch: -26, yaw: 6, look: 0.3 }), { head: [0, 4, -14] }), hips: [-0.1, -0.16, 0], wpn: W([0.3, -0.3, 0.3], dir(60, -20), [0, 0, 1]), handL: [0.32, -0.35, -0.1] },
        { f: 8, pose: pose(torso({ pitch: -22, yaw: 4, look: 0.3 }), { head: [0, 2, -10] }), hips: [-0.1, -0.15, 0] },
        { f: 15, ease: 'inOut', pose: torso({ pitch: -8 }), hips: [-0.05, -0.1, 0] },
        { f: 22, ease: 'inOut', ...NEUTRAL },
      ],
    },
    hit_low: {
      frames: 22, grip: 0, look: 0, plant: 0.8,
      keys: [
        { f: 0, ...NEUTRAL },
        { f: 2, ease: 'outExpo', pose: pose(torso({ pitch: -12, roll: 10, yaw: 12, look: 0.3 }), { head: [-6, 0, 6] }), hips: [-0.04, -0.2, 0.03], ...feet([0.2, 0, -0.02, 0, 8], [-0.14, 0.04, 0.05, -20, 10]),
          wpn: W([0.3, -0.1, 0.6], dir(60, 30), [0, 0, 1]), handL: [0.3, -0.4, -0.5] },
        { f: 9, pose: torso({ pitch: -10, roll: 7, yaw: 8, look: 0.3 }), hips: [-0.05, -0.18, 0.02] },
        { f: 22, ease: 'inOut', ...NEUTRAL },
      ],
    },
    knockdown: {
      frames: 30, grip: 0, look: 0, springs: 1,
      keys: [
        { f: 0, pose: pose(torso({ pitch: 22, look: 0 }), { head: [0, 0, 24] }), hips: [-0.08, -0.08, 0], ...ST, wpn: W([0.35, 0.1, 0.62], dir(60, 60), [0, 0, 1]), handL: [0.35, 0.1, -0.62] },
        { f: 7, ease: 'out', pose: pose({ hips: [0, 0, 34], spine: [0, 0, 12], chest: [0, 0, 10], neck: [0, 0, 8], head: [0, 0, 16] },
          leg('L', { thigh: [0.55, -0.9, -0.15], shin: [0.1, -1, -0.12], toe: [0.8, -0.5, 0] }), leg('R', { thigh: [0.3, -1, 0.15], shin: [-0.2, -1, 0.12], toe: [0.8, -0.5, 0] }),
          arm('L', { upper: [0.3, 0.5, -0.8], fore: [-0.1, 0.9, -0.4] }), arm('R', { upper: [0.3, 0.55, 0.78], fore: [-0.1, 0.9, 0.4], blade: [-0.4, 0.8, 0.4] })), hips: [-0.06, -0.3, 0] },
        { f: 16, ease: 'inOut', pose: FLY_BACK, hips: [-0.08, -0.72, 0] },
        { f: 30, pose: pose(FLY_BACK, { hips: [0, 0, 80], head: [0, 6, 10] }), hips: [-0.09, -0.78, 0] },
      ],
    },
    launched: {  // vertical pop-up (launcher): chest to the sky, limbs trailing, juggle-ready
      frames: 30, grip: 0, look: 0,
      keys: [
        { f: 0, pose: pose(torso({ pitch: 20, look: 0 }), { head: [0, 0, 26] }), hips: [-0.03, -0.1, 0], ...ST, wpn: W([0.3, 0.2, 0.6], dir(40, 70), [0, 0, 1]), handL: [0.3, 0.2, -0.6] },
        { f: 6, ease: 'out', pose: pose({ hips: [0, 0, 28], spine: [0, 0, 16], chest: [0, 0, 14], neck: [0, 0, 12], head: [0, 0, 22] },
          leg('L', { thigh: [0.1, -1, -0.2], shin: [-0.6, -0.8, -0.15], toe: [0.3, -0.9, 0] }), leg('R', { thigh: [-0.2, -1, 0.2], shin: [-0.7, -0.7, 0.15], toe: [0.2, -0.9, 0] }),
          arm('L', { upper: [-0.1, 0.7, -0.7], fore: [-0.3, 0.9, -0.3] }), arm('R', { upper: [-0.1, 0.75, 0.65], fore: [-0.3, 0.9, 0.3], blade: [-0.6, 0.7, 0.2] })), hips: [-0.03, -0.2, 0] },
        { f: 30, pose: pose({ hips: [0, 0, 52], spine: [0, 0, 14], chest: [0, 0, 12], neck: [0, 0, 8], head: [0, 0, 14] },
          leg('L', { thigh: [0.4, -0.9, -0.2], shin: [-0.3, -1, -0.15], toe: [0.6, -0.7, 0] }), leg('R', { thigh: [0.1, -1, 0.2], shin: [-0.5, -0.9, 0.15], toe: [0.5, -0.8, 0] }),
          arm('L', { upper: [0.0, 0.6, -0.8], fore: [-0.2, 0.9, -0.4] }), arm('R', { upper: [0.0, 0.65, 0.76], fore: [-0.2, 0.9, 0.4], blade: [-0.5, 0.8, 0.3] })), hips: [-0.05, -0.4, 0] },
      ],
    },
    spiked: {  // ground-bounce: slammed face-down, then flipping onto the back on the rebound
      frames: 34, grip: 0, look: 0,
      keys: [
        { f: 0, pose: pose({ hips: [0, 0, -70], spine: [0, 0, -12], chest: [0, 0, -10], neck: [0, 0, 20], head: [0, 0, 18] },
          leg('L', { thigh: [-0.2, -1, -0.3], shin: [-0.5, -0.9, -0.2] }), leg('R', { thigh: [-0.3, -1, 0.3], shin: [-0.6, -0.8, 0.2] }),
          arm('L', { upper: [0.3, 0.3, -0.9], fore: [0.6, 0.2, -0.8] }), arm('R', { upper: [0.3, 0.3, 0.9], fore: [0.6, 0.2, 0.8] })), hips: [0.05, -0.7, 0] },
        { f: 8, pose: pose({ hips: [0, 0, -84], spine: [0, 0, -6], chest: [0, 0, -4], neck: [0, 0, 16], head: [0, 0, 10] },
          leg('L', { thigh: [-0.25, -1, -0.35], shin: [-0.4, -0.9, -0.25] }), leg('R', { thigh: [-0.35, -1, 0.35], shin: [-0.5, -0.9, 0.25] }),
          arm('L', { upper: [0.4, 0.1, -0.9], fore: [0.8, 0.1, -0.6] }), arm('R', { upper: [0.4, 0.1, 0.9], fore: [0.8, 0.1, 0.6] })), hips: [0.05, -0.8, 0] },
        { f: 22, ease: 'inOut', pose: pose(FLY_BACK, { hips: [0, 0, -200] }), hips: [0, -0.5, 0] },
        { f: 34, ease: 'out', pose: pose(FLY_BACK, { hips: [0, 0, -280] }), hips: [-0.08, -0.72, 0] },
      ],
    },
    thrown: {  // flung head-first (the combat code also rolls the whole body): starfish flail
      frames: 40, loop: true, grip: 0, look: 0,
      keys: [
        { f: 0, pose: pose({ spine: [0, 0, 12], chest: [0, 0, 10], neck: [0, 0, 14], head: [0, 0, 16] },
          leg('L', { thigh: [0.4, -0.9, -0.45], shin: [0.1, -1, -0.4], toe: [0.7, -0.6, -0.2] }), leg('R', { thigh: [-0.2, -0.9, 0.45], shin: [-0.6, -0.8, 0.35], toe: [0.4, -0.9, 0.2] }),
          arm('L', { upper: [0.2, 0.5, -0.85], fore: [0.5, 0.7, -0.5] }), arm('R', { upper: [-0.2, 0.6, 0.8], fore: [-0.5, 0.8, 0.3], blade: [-0.7, 0.7, 0] })), hips: [0, -0.35, 0] },
        { f: 20, pose: pose({ spine: [0, 0, 16], chest: [0, 0, 12], neck: [0, 0, 18], head: [0, 0, 20] },
          leg('L', { thigh: [-0.2, -0.9, -0.45], shin: [-0.6, -0.8, -0.35], toe: [0.4, -0.9, -0.2] }), leg('R', { thigh: [0.4, -0.9, 0.45], shin: [0.1, -1, 0.4], toe: [0.7, -0.6, 0.2] }),
          arm('L', { upper: [-0.2, 0.6, -0.8], fore: [-0.5, 0.8, -0.3] }), arm('R', { upper: [0.2, 0.5, 0.85], fore: [0.5, 0.7, 0.5], blade: [0.7, 0.6, 0.2] })), hips: [0, -0.35, 0] },
      ],
    },
    grabbed: {  // held by a grappler: claw at the arm, legs dangling and kicking
      frames: 36, loop: true, grip: 0, look: 0, flinch: 1.4,
      keys: [
        { f: 0, pose: pose(torso({ pitch: 10, yaw: 6, look: 0 }), { head: [0, 8, 16] },
          leg('L', { thigh: [0.25, -1, -0.15], shin: [-0.3, -1, -0.12], toe: [0.4, -0.9, 0] }), leg('R', { thigh: [0.05, -1, 0.15], shin: [-0.1, -1, 0.12], toe: [0.4, -0.9, 0] }),
          arm('L', { upper: [0.75, 0.25, -0.3], fore: [0.8, 0.55, 0.15] }), arm('R', { upper: [0.7, 0.2, 0.4], fore: [0.85, 0.5, -0.1], blade: [0.3, -0.9, 0.2] })), hips: [-0.03, -0.04, 0] },
        { f: 18, pose: pose(torso({ pitch: 13, yaw: -4, look: 0 }), { head: [0, -6, 20] },
          leg('L', { thigh: [0.0, -1, -0.15], shin: [-0.1, -1, -0.12], toe: [0.4, -0.9, 0] }), leg('R', { thigh: [0.3, -1, 0.15], shin: [-0.35, -1, 0.12], toe: [0.4, -0.9, 0] }),
          arm('L', { upper: [0.7, 0.35, -0.35], fore: [0.75, 0.6, 0.1] }), arm('R', { upper: [0.75, 0.3, 0.35], fore: [0.8, 0.55, -0.15], blade: [0.3, -0.9, 0.2] })), hips: [-0.03, -0.03, 0] },
      ],
    },
    down_loop: {
      duration: 2.2, loop: true, grip: 0, look: 0, plant: 0, breathe: 1,
      keys: [{ t: 0, ...LYING }, { t: 1.1, pose: pose(LYING.pose, { chest: [0, 0, -1], neck: [0, 2, -14] }), hips: [-0.1, -0.835, 0] }],
    },
    getup: {
      frames: 30, grip: 0, look: 0.5,
      keys: [
        { f: 0, ...LYING },
        { f: 8, ease: 'out', pose: pose({ hips: [0, 0, 48], spine: [0, 0, -26], chest: [0, 0, -18], neck: [0, 0, -12], head: [0, 0, -4] },
          leg('L', { thigh: [0.95, -0.3, -0.2], shin: [-0.2, -1, -0.12], toe: [1, 0.1, 0] }), leg('R', { thigh: [0.6, -0.8, 0.22], shin: [-0.1, -1, 0.15], toe: [1, 0, 0] }),
          arm('L', { upper: [-0.55, -0.8, -0.3], fore: [-0.2, -1, -0.1] }), arm('R', { upper: [-0.55, -0.8, 0.3], fore: [-0.2, -1, 0.1], blade: [0.4, 0.1, 0.9] })), hips: [-0.06, -0.66, 0] },
        { f: 16, ease: 'inOut', pose: torso({ pitch: -30 }), hips: [0.02, -0.42, 0], ...feet([0.3, 0, -0.06, 0, 8], [-0.34, 0.02, 0.08, -55, 20]), wpn: W([0.35, -0.6, 0.5], dir(20, 0), [0, 0, 1]), handL: [0.45, -0.5, -0.3] },
        { f: 23, ease: 'inOut', pose: torso({ pitch: -16 }), hips: [0.01, -0.2, 0], ...ST_W },
        { f: 30, ease: 'inOut', ...NEUTRAL, plant: 1 },
      ],
    },
    death: {
      frames: 60, grip: 0, look: 0, breathe: 0,
      keys: [
        { f: 0, pose: pose(torso({ pitch: 24, yaw: -10, look: 0 }), { head: [8, -10, 28] }), hips: [-0.08, -0.09, 0], ...ST, wpn: W([0.35, 0.1, 0.62], dir(60, 60), [0, 0, 1]), handL: [0.35, 0.1, -0.62] },
        { f: 10, ease: 'out', pose: pose({ hips: [0, 0, 30], spine: [4, 0, 10], chest: [4, 0, 10], neck: [0, 0, 6], head: [0, 12, 20] },
          leg('L', { thigh: [0.5, -0.9, -0.15], shin: [0.1, -1, -0.12], toe: [0.8, -0.5, 0] }), leg('R', { thigh: [0.3, -1, 0.15], shin: [-0.3, -1, 0.12], toe: [0.8, -0.5, 0] }),
          arm('L', { upper: [0.2, 0.5, -0.84], fore: [-0.1, 0.9, -0.4] }), arm('R', { upper: [0.2, 0.55, 0.8], fore: [-0.1, 0.9, 0.4], blade: [-0.4, 0.8, 0.4] })), hips: [-0.06, -0.3, 0] },
        { f: 22, ease: 'in', pose: FLY_BACK, hips: [-0.08, -0.74, 0] },
        { f: 34, ease: 'outCubic', pose: pose(LYING.pose, { hips: [0, 0, 92] }), hips: [-0.1, -0.86, 0] },
        { f: 42, pose: pose(LYING.pose, { hips: [0, 0, 85] }), hips: [-0.1, -0.82, 0] },
        { f: 60, ease: 'inOut', pose: pose(LYING.pose, { neck: [0, 20, -6], head: [0, 24, -2] }), hips: LYING.hips },
      ],
    },

    // blocked / clanked: the attack bounces off a guard or armour — weapon kicked up and away, body rocked back
    // onto the rear foot, a stagger step, then a shake-off back to guard.
    blocked: {
      frames: 24, grip: 0, look: 0.6, plant: 0.6,
      keys: [
        { f: 0, ...NEUTRAL },
        { f: 2, ease: 'outExpo', pose: pose(torso({ pitch: 14, yaw: 14, roll: -3, look: 0.4 }), { head: [0, 6, 10] }), hips: [-0.08, -0.08, 0],
          ...feet([0.18, 0.02, -0.04, 6, 8], [-0.26, 0, 0.08, 0, 26]), wpn: W([0.2, 0.46, 0.6], dir(150, 58), [0, 0, 1]), handL: [0.26, -0.1, -0.56] },
        { f: 7, pose: pose(torso({ pitch: 10, yaw: 10, roll: -2, look: 0.5 }), { head: [0, 4, 6] }), hips: [-0.1, -0.1, 0],
          ...feet([0.1, 0, -0.04, 0, 8], [-0.3, 0, 0.08, 0, 26]), wpn: W([0.16, 0.36, 0.6], dir(160, 50), [0, 0, 1]), handL: [0.24, -0.2, -0.54] },
        { f: 15, ease: 'inOut', pose: torso({ pitch: -2, yaw: 4, look: 0.8 }), hips: [-0.03, -0.09, 0], ...ST, wpn: W([0.3, -0.1, 0.5], dir(30, 40), [0, 0, 1]), handL: [0.32, -0.3, -0.4] },
        { f: 24, ease: 'inOut', ...NEUTRAL },
      ],
    },
    tumble: { alias: 'thrown' },

    // ------------------------------------------------------------------ magic / taunt / victory / riding
    magic_cast: {
      frames: 50, grip: 0,
      keys: [
        g(0),
        { f: 12, ease: 'out', pose: torso({ pitch: -20 }), hips: [0, -0.2, 0], ...ST_W, wpn: W([0.3, -0.3, 0.3], dir(0, 80), [0, 0, 1]), handL: [0.3, -0.3, -0.25] },
        { f: 22, ease: 'outCubic', pose: torso({ pitch: 14, look: 0.3 }), hips: [0, 0.03, 0], ...feet([0.1, 0, -0.08, 0, 10], [-0.1, 0, 0.1, 0, 20]), wpn: W([0.1, 1.0, 0.4], dir(0, 88), [0, 0, 1]), handL: [0.1, 1.0, -0.4] },
        { f: 40, pose: torso({ pitch: 11, look: 0.3 }), hips: [0, 0.02, 0], wpn: W([0.12, 0.98, 0.42], dir(0, 86), [0, 0, 1]), handL: [0.12, 0.98, -0.42] },
        g(50, { ease: 'inOut' }),
      ],
      events: [{ f: 22, name: 'castPeak' }],
    },
    victory: {
      frames: 96, loop: true, grip: 0, breathe: 1,
      keys: [
        { f: 0, pose: torso({ pitch: 8, yaw: -10, look: 0.4, hp: 10 }), hips: [0, -0.02, 0], ...feet([0.12, 0, -0.1, 0, 12], [-0.1, 0, 0.12, 0, 20]), wpn: W([0.2, 1.0, 0.3], dir(5, 85), [0, 0, 1]), handL: [0.25, -0.35, -0.45] },
        { f: 48, pose: torso({ pitch: 10, yaw: -12, look: 0.4, hp: 12 }), hips: [0, -0.01, 0], ...feet([0.12, 0, -0.1, 0, 12], [-0.1, 0, 0.12, 0, 20]), wpn: W([0.22, 1.02, 0.28], dir(0, 86), [0, 0, 1]), handL: [0.25, -0.33, -0.47] },
      ],
    },
    // Riding: rider origin = the saddle point; pelvis sits on it, legs straddle the beast.
    ride_idle: {
      frames: 60, loop: true, grip: 0,
      keys: [
        { f: 0, pose: pose(torso({ pitch: -10 }), leg('L', { thigh: [0.65, -0.45, -0.6], shin: [0.1, -1, -0.25], toe: [0.9, -0.3, -0.1] }), leg('R', { thigh: [0.65, -0.45, 0.6], shin: [0.1, -1, 0.25], toe: [0.9, -0.3, 0.1] })),
          hips: [0, -0.9, 0], wpn: W([0.4, -0.25, 0.4], dir(10, 55), [0, 0, 1]), handL: [0.55, -0.45, -0.1] },
        { f: 30, pose: pose(torso({ pitch: -12 }), leg('L', { thigh: [0.65, -0.47, -0.6], shin: [0.12, -1, -0.25], toe: [0.9, -0.3, -0.1] }), leg('R', { thigh: [0.65, -0.47, 0.6], shin: [0.12, -1, 0.25], toe: [0.9, -0.3, 0.1] })),
          hips: [0, -0.91, 0], wpn: W([0.42, -0.27, 0.4], dir(10, 52), [0, 0, 1]), handL: [0.55, -0.47, -0.1] },
      ],
    },
    ride_attack: {
      frames: 26, grip: 0,
      keys: [
        { f: 0, pose: pose(torso({ pitch: -10 }), leg('L', { thigh: [0.65, -0.45, -0.6], shin: [0.1, -1, -0.25] }), leg('R', { thigh: [0.65, -0.45, 0.6], shin: [0.1, -1, 0.25] })), hips: [0, -0.9, 0], wpn: W([0.4, -0.25, 0.4], dir(10, 55), [0, 0, 1]), handL: [0.55, -0.45, -0.1] },
        { f: 5, ease: 'out', pose: torso({ pitch: 8, yaw: -20 }), wpn: W([0.0, 0.9, 0.4], dir(170, 40), [0, 0, 1]) },
        { f: 8, ease: 'in', pose: torso({ pitch: -24, yaw: 10 }), wpn: W([0.75, -0.1, 0.35], dir(10, -35), [0, 0, 1]) },
        { f: 14, pose: torso({ pitch: -26, yaw: 12 }), wpn: W([0.6, -0.45, 0.3], dir(0, -60), [0, 0, 1]) },
        { f: 26, ease: 'inOut', pose: torso({ pitch: -10 }), wpn: W([0.4, -0.25, 0.4], dir(10, 55), [0, 0, 1]) },
      ],
      events: [{ f: 5, name: 'swing' }],
    },
    mount: {
      frames: 24, grip: 0,
      keys: [
        { f: 0, ...NEUTRAL },
        { f: 6, ease: 'out', pose: torso({ pitch: -24 }), hips: [0, -0.3, 0], ...ST_W },
        { f: 14, ease: 'out', pose: pose(torso({ pitch: -6 }), leg('L', { thigh: [0.4, -0.8, -0.3], shin: [-0.3, -1, -0.2] }), leg('R', { thigh: [0.1, 0.3, 0.9], shin: [0.2, -0.5, 0.9] })), hips: [0, -0.4, 0], wpn: W([0.4, 0.1, 0.4], dir(10, 70), [0, 0, 1]), handL: [0.5, -0.2, -0.2] },
        { f: 24, ease: 'inOut', pose: pose(torso({ pitch: -10 }), leg('L', { thigh: [0.65, -0.45, -0.6], shin: [0.1, -1, -0.25] }), leg('R', { thigh: [0.65, -0.45, 0.6], shin: [0.1, -1, 0.25] })), hips: [0, -0.9, 0], wpn: W([0.4, -0.25, 0.4], dir(10, 55), [0, 0, 1]), handL: [0.55, -0.45, -0.1] },
      ],
    },
    dismount: {
      frames: 24, grip: 0,
      keys: [
        { f: 0, pose: pose(torso({ pitch: -10 }), leg('L', { thigh: [0.65, -0.45, -0.6], shin: [0.1, -1, -0.25] }), leg('R', { thigh: [0.65, -0.45, 0.6], shin: [0.1, -1, 0.25] })), hips: [0, -0.9, 0], wpn: W([0.4, -0.25, 0.4], dir(10, 55), [0, 0, 1]), handL: [0.55, -0.45, -0.1] },
        { f: 8, ease: 'out', pose: pose(torso({ pitch: 4 }), leg('L', { thigh: [0.3, -0.9, -0.25], shin: [-0.3, -1, -0.2] }), leg('R', { thigh: [0.1, -0.9, 0.25], shin: [-0.4, -1, 0.2] })), hips: [0, -0.2, 0], wpn: W([0.4, 0.3, 0.45], dir(10, 70), [0, 0, 1]), handL: [0.3, 0.3, -0.5] },
        { f: 16, pose: torso({ pitch: -24 }), hips: [0.02, -0.28, 0], ...ST_W },
        { f: 24, ease: 'inOut', ...NEUTRAL },
      ],
    },
  },
};
