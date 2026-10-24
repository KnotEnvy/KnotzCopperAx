// Seraphine Vey — dual sabres (Dawn right, Dusk left). Blade-dance: light on the balls of the feet, quick
// alternating cuts, full-body spins (pelvis yaw through 360° with chest-space weapon goals), flips, long leaps and
// the flying kick. Frames match characters/movesets/seraphine.js (strike pose on the first ACTIVE tick).
// Weapon goals: W(at, blade, flat) for Dawn, WL(...) for Dusk; `at` from the posed chest in arm lengths.
// C2 r4 (hero-weapons; board r3: "in the swing Dawn turns edge-on and shrinks to a 1-2 px line"): the flat of a sabre whose
// blade is not along +-Z now faces the CAMERA side ([0, 0.3, +-1], the belt-scroll read) through the cuts, the run carry and
// the kick, instead of up ([0, 1, x] = the edge toward the camera). Measured in stage 1 (tools/scenarios/weapon_read_probe.mjs):
// Dawn flat-to-camera over the attack frames 0.32 -> 0.95. Spin keys (blades out along chest +-Z while the pelvis turns
// through 360 deg) use a chest-FORWARD flat ([1, 0, 0]): when the turning chest brings a blade into the screen plane, its flat
// faces the camera (an up-flat there was a 7-10 px edge-on line at light_3's own contact frames).
import { dir, W, torso, pose, gait, leg, feet } from './_kit.js';
import { rideSet } from './_ride.js';

const WL = W;
// ----------------------------------------------------------------------------------------------- stances
const ST = feet([0.2, 0.03, -0.02, -10, 4], [-0.2, 0.02, 0.06, -8, 36]);           // on the balls of the feet
const ST_W = feet([0.3, 0, -0.04, 0, 4], [-0.28, 0.02, 0.08, -10, 40]);
const G_T = torso({ pelvis: -24, yaw: 8, pitch: -9, look: 0.95 });
const G_R = W([0.55, 0.04, 0.24], dir(-8, 20), [0, 0.3, 1]);
// C2 r2 (board r1: "Dusk hides behind her body in idle"): Dusk is carried low and FORWARD (blade ahead of the front
// thigh, flat to the camera) instead of trailing behind the left hip where the body covered it from the game camera.
const G_L = WL([0.34, -0.4, -0.3], dir(-26, -22), [0, 0.3, -1]);
const GUARD = { pose: G_T, hips: [0, -0.09, 0], ...ST, wpn: G_R, wpnL: G_L };
const g = (f, x = {}) => ({ f, ...GUARD, ...x });
// FK legs for spins (they ride with the pelvis)
const SPIN_LEGS = pose(leg('L', { thigh: [0.05, -1, -0.1], shin: [0.02, -1, -0.1], toe: [1, -0.45, -0.1] }),
  leg('R', { thigh: [0.35, -0.85, 0.35], shin: [-0.35, -0.95, 0.3], toe: [0.6, -0.8, 0.1] }));
const TUCK_LEGS = pose(leg('L', { thigh: [0.9, -0.3, -0.12], shin: [-0.5, -0.9, -0.1], toe: [0.5, -0.85, 0] }),
  leg('R', { thigh: [0.75, -0.55, 0.12], shin: [-0.6, -0.8, 0.1], toe: [0.4, -0.9, 0] }));

// ----------------------------------------------------------------------------------------------- locomotion
const walk = gait({
  P: 0.56, v: 3.85, duty: 0.48, cx: 0.38, lift: 0.12, heel: 0.12, bob: 0.03, hipsY: -0.08, twist: 10, lean: -7, width: 0.0,
  upper: (ph) => {
    const s = Math.sin(ph * Math.PI * 2);
    return {
      wpn: W([0.28 + s * 0.1, -0.5, 0.42], dir(30 + s * 10, -30), [0, 0.3, 1]),
      wpnL: WL([0.28 - s * 0.1, -0.5, -0.42], dir(-30 + s * 10, -30), [0, 0.3, -1]),
    };
  },
});
const run = gait({
  P: 0.5, v: 8.84, duty: 0.22, cx: 0.44, lift: 0.36, heel: 0.1, bob: 0.05, hipsY: -0.1, hipsX: 0.08, twist: 9, lean: -24,
  flight: 0.15, strike: 4, pushOff: 42, width: 0.0,
  upper: (ph) => {
    const s = Math.sin(ph * Math.PI * 2);
    return {  // blades trailing: the dancer's sprint
      wpn: W([-0.3 - s * 0.06, -0.34, 0.42], dir(172, -8 + s * 4), [0, 0.3, 1]),
      wpnL: WL([-0.3 + s * 0.06, -0.34, -0.42], dir(-172, -8 - s * 4), [0, 0.3, -1]),
    };
  },
});

export default {
  rig: 'humanoid', character: 'seraphine', priority: 10,
  clips: {
    // riding: Dawn raised, Dusk held low along the flank (no reins — knees steer); a falling cut from the saddle
    ...rideSet({ carry: W([0.46, -0.02, 0.36], dir(10, 40), [0, 0.3, 1]), carryL: W([0.3, -0.36, -0.42], dir(160, -30), [0, 0.3, -1]), up: W([0.0, 0.86, 0.36], dir(170, 40), [0, 0, 1]), hit: W([0.8, 0.02, 0.3], dir(10, -24), [0, 0, 1]), follow: W([0.56, -0.42, -0.1], dir(-40, -50), [0, 0, 1]) }),
    idle: {  // fencer's bounce, two per second
      frames: 60, loop: true, plant: 1, breathe: 0.8, tags: ['idle'],
      keys: [
        g(0), g(15, { hips: [0, -0.075, 0], wpn: W([0.56, 0.06, 0.24], dir(-8, 22), [0, 0.3, 1]) }),
        g(30, { hips: [0, -0.095, 0] }), g(45, { hips: [0, -0.078, 0], wpnL: WL([0.36, -0.42, -0.3], dir(-24, -20), [0, 0.3, -1]) }), g(60),
      ],
    },
    walk: { duration: 0.56, loop: true, keys: walk, events: [{ n: 0.02, name: 'footstep', foot: 'L' }, { n: 0.52, name: 'footstep', foot: 'R' }] },
    run: { duration: 0.5, loop: true, keys: run, events: [{ n: 0.02, name: 'footstep', foot: 'L' }, { n: 0.52, name: 'footstep', foot: 'R' }] },

    // ------------------------------------------------------------------------------------------- string
    // light_1: Dawn (right) flat forehand cut right → left (4 / 3 / 12)
    light_1: {
      frames: 19,
      keys: [
        g(0),
        // C1 r5 (board r4: "arm-led cuts, little torso compression"): the cut is driven hip-to-shoulder. f2 coils
        // pelvis AND shoulders away with the weight on the rear foot; f3 the pelvis has already turned while the
        // shoulders still lag (hips lead); f4 the shoulders whip through past the hips, the front foot is planted
        // forward and the rear heel lifts (weight transfer), hips dropped; f7 overshoots; the recovery keeps a little.
        { f: 2, ease: 'out', pose: torso({ pelvis: -44, yaw: -24, pitch: -4, roll: -4 }), hips: [-0.05, -0.1, 0], ...feet([0.2, 0.03, -0.02, -10, 4], [-0.24, 0.0, 0.06, 0, 36]), wpn: W([0.2, 0.22, 0.56], dir(122, 12), [0, 0.3, 1]) },
        { f: 3, ease: 'outCubic', pose: torso({ pelvis: -6, yaw: -10, pitch: -14 }), hips: [0.1, -0.13, 0], ...feet([0.34, 0, -0.02, 0, 4], [-0.26, 0.03, 0.06, -10, 36]) },
        { f: 4, ease: 'outCubic', pose: torso({ pelvis: 10, yaw: 18, pitch: -24, roll: 4 }), hips: [0.2, -0.16, 0], ...feet([0.38, 0, -0.02, 0, 4], [-0.26, 0.07, 0.06, -24, 36]),
          wpn: W([0.76, 0.08, 0.02], dir(0, -2), [0, 0.3, 1]), wpnL: WL([0.0, -0.34, -0.44], dir(170, -20), [0, 0.3, -1]) },
        { f: 7, ease: 'out', pose: torso({ pelvis: 20, yaw: 30, pitch: -26 }), hips: [0.22, -0.16, 0], ...feet([0.38, 0, -0.02, 0, 4], [-0.24, 0.09, 0.06, -30, 36]), wpn: W([0.5, -0.04, -0.36], dir(-58, -18), [0, 0, -1]) },
        { f: 12, ease: 'inOut', pose: torso({ pelvis: -6, yaw: 14, pitch: -14 }), hips: [0.1, -0.11, 0], wpn: W([0.5, 0.0, 0.0], dir(-30, 10), [0, 0.3, 1]), ...ST },
        g(19, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 2, name: 'swing' }, { f: 4, name: 'impact' }],
    },
    // light_2: Dusk (left) answers left → right, hips whipping back (4 / 3 / 12)
    light_2: {
      frames: 19,
      keys: [
        // C1 r5: same hip-to-shoulder drive as light_1, mirrored (coil right → pelvis leads → shoulders whip left)
        { f: 0, pose: torso({ pelvis: 10, yaw: 20, pitch: -14 }), hips: [0.1, -0.11, 0], ...ST, wpn: W([0.46, 0.0, -0.3], dir(-60, -5), [0, 0.3, -1]), wpnL: G_L },
        { f: 2, ease: 'out', pose: torso({ pelvis: 24, yaw: 34, pitch: -6, roll: 4 }), hips: [0.04, -0.1, 0], ...feet([0.2, 0.03, -0.02, -10, 4], [-0.24, 0.0, 0.06, 0, 36]), wpnL: WL([0.2, 0.22, -0.56], dir(-122, 12), [0, 0.3, -1]), wpn: W([0.3, -0.2, 0.3], dir(60, -20), [0, 0.3, 1]) },
        { f: 3, ease: 'outCubic', pose: torso({ pelvis: -8, yaw: 12, pitch: -14 }), hips: [0.1, -0.13, 0], ...feet([0.34, 0, -0.02, 0, 4], [-0.26, 0.03, 0.06, -10, 36]) },
        { f: 4, ease: 'outCubic', pose: torso({ pelvis: -36, yaw: -20, pitch: -24, roll: -4 }), hips: [0.2, -0.16, 0], ...feet([0.38, 0, -0.02, 0, 4], [-0.26, 0.07, 0.06, -24, 36]),
          wpnL: WL([0.76, 0.1, -0.02], dir(0, 0), [0, 0.3, -1]), wpn: W([0.05, -0.3, 0.46], dir(170, -20), [0, 0.3, 1]) },
        { f: 7, ease: 'out', pose: torso({ pelvis: -50, yaw: -30, pitch: -26 }), hips: [0.22, -0.16, 0], ...feet([0.38, 0, -0.02, 0, 4], [-0.24, 0.09, 0.06, -30, 36]), wpnL: WL([0.5, -0.02, 0.36], dir(58, -18), [0, 0, 1]) },
        { f: 12, ease: 'inOut', pose: torso({ pelvis: -28, yaw: -4, pitch: -12 }), hips: [0.08, -0.11, 0], wpnL: WL([0.4, -0.2, -0.1], dir(40, -20), [0, 0.3, -1]), ...ST },
        g(19, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 2, name: 'swing' }, { f: 4, name: 'impact' }],
    },
    // light_3: whirlwind — a full counter-clockwise pirouette, both blades out; Dawn crosses the front on the first
    // window (f6–9), Dusk on the second (f10–14) (6 / 8 / 18)
    light_3: {
      frames: 32, goalSpace: 'chest', look: 0,
      keys: [
        { f: 0, pose: torso({ pelvis: -30, yaw: -2, pitch: -10 }), hips: [0.08, -0.12, 0], ...ST, wpn: W([0.4, 0.0, 0.2], dir(-40, 0), [0, 0.3, 1]), wpnL: WL([0.4, 0.0, -0.3], dir(60, -10), [0, 0.3, -1]) },
        // C1 r5: the spin is loaded from a crouch (hips -0.24) and lands compressed (f15 -0.18) instead of staying tall
        { f: 3, ease: 'out', pose: pose(SPIN_LEGS, torso({ pelvis: -50, yaw: -10, pitch: -24, look: 0 })), hips: [0.06, -0.24, 0],
          wpn: W([0.35, -0.05, -0.2], dir(-60, -10), [0, 0.3, 1]), wpnL: WL([0.3, -0.05, -0.45], dir(-100, -10), [0, 1, 0]) },
        { f: 6, ease: 'in', pose: pose(SPIN_LEGS, torso({ pelvis: 70, pitch: -8, look: 0 })), hips: [0.1, -0.08, 0],
          wpn: W([0.05, 0.1, 0.92], dir(90, 4), [1, 0, 0]), wpnL: WL([0.05, 0.1, -0.92], dir(-90, 4), [1, 0, 0]) },
        { f: 8, ease: 'linear', pose: pose(SPIN_LEGS, torso({ pelvis: 150, pitch: -6, look: 0 })), hips: [0.12, -0.06, 0] },
        { f: 10, ease: 'linear', pose: pose(SPIN_LEGS, torso({ pelvis: 230, pitch: -6, look: 0 })), hips: [0.13, -0.06, 0] },
        { f: 12, ease: 'linear', pose: pose(SPIN_LEGS, torso({ pelvis: 300, pitch: -8, look: 0 })), hips: [0.14, -0.07, 0],
          wpn: W([0.1, 0.05, 0.9], dir(90, -4), [1, 0, 0]), wpnL: WL([0.1, 0.05, -0.9], dir(-90, -4), [1, 0, 0]) },
        { f: 15, ease: 'out', pose: pose(SPIN_LEGS, torso({ pelvis: 350, yaw: 6, pitch: -20, look: 0 })), hips: [0.15, -0.18, 0] },
        { f: 22, ease: 'inOut', pose: pose(torso({ pelvis: 336, yaw: 8, pitch: -10 }), leg('L', { thigh: [0.3, -1, -0.1], shin: [0.1, -1, -0.1] }), leg('R', { thigh: [-0.25, -1, 0.1], shin: [-0.4, -1, 0.1] })), hips: [0.08, -0.1, 0],
          wpn: W([0.5, 0.0, 0.3], dir(0, 10), [0, 0.3, 1]), wpnL: WL([0.2, -0.3, -0.35], dir(160, -30), [0, 0.3, -1]) },
        { f: 32, ease: 'inOut', pose: torso({ pelvis: 336, yaw: 8, pitch: -9, look: 0.95 }), hips: [0, -0.09, 0], ...ST, wpn: G_R, wpnL: G_L, plant: 1 },
      ],
      events: [{ f: 4, name: 'swing' }, { f: 6, name: 'impact' }, { f: 10, name: 'impact' }],
    },
    // pommel_1: Dawn's hilt to the face, blade laid back over the shoulder (3 / 2 / 10)
    pommel_1: {
      frames: 15,
      keys: [
        g(0),
        { f: 1, ease: 'out', pose: torso({ pelvis: -34, yaw: -12, pitch: -6 }), hips: [-0.02, -0.1, 0], wpn: W([0.18, 0.14, 0.42], dir(165, 40), [0, 0, 1]) },
        { f: 3, ease: 'outCubic', pose: torso({ pelvis: 0, yaw: 10, pitch: -12 }), hips: [0.1, -0.1, 0], ...feet([0.32, 0, -0.02, 0, 4], [-0.24, 0.04, 0.06, -12, 36]), wpn: W([0.66, 0.26, 0.06], dir(168, 36), [0, 0, 1]) },
        { f: 7, pose: torso({ pelvis: -4, yaw: 8, pitch: -11 }), hips: [0.09, -0.1, 0], wpn: W([0.58, 0.22, 0.1], dir(162, 40), [0, 0, 1]) },
        g(15, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 1, name: 'swing' }, { f: 3, name: 'impact' }],
    },
    // pommel_2: Dusk's hilt answers from the other side (3 / 2 / 10)
    pommel_2: {
      frames: 15,
      keys: [
        { f: 0, pose: torso({ pelvis: -4, yaw: 8, pitch: -11 }), hips: [0.06, -0.1, 0], ...ST, wpn: W([0.58, 0.22, 0.1], dir(162, 40), [0, 0, 1]), wpnL: G_L },
        { f: 1, ease: 'out', pose: torso({ pelvis: 12, yaw: 20, pitch: -8 }), hips: [0.02, -0.1, 0], wpnL: WL([0.2, 0.14, -0.42], dir(-165, 40), [0, 0, -1]), wpn: W([0.3, -0.2, 0.4], dir(60, -20), [0, 0.3, 1]) },
        { f: 3, ease: 'outCubic', pose: torso({ pelvis: -32, yaw: -14, pitch: -12 }), hips: [0.12, -0.1, 0], ...feet([0.34, 0, -0.02, 0, 4], [-0.24, 0.04, 0.06, -12, 36]), wpnL: WL([0.66, 0.26, -0.06], dir(-168, 36), [0, 0, -1]) },
        { f: 7, pose: torso({ pelvis: -30, yaw: -12, pitch: -11 }), hips: [0.1, -0.1, 0], wpnL: WL([0.58, 0.22, -0.1], dir(-162, 40), [0, 0, -1]) },
        g(15, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 1, name: 'swing' }, { f: 3, name: 'impact' }],
    },
    // close finisher: spinning back kick (pivot right on the left foot, heel to the chest) (6 / 4 / 18)
    kick: {
      frames: 28, goalSpace: 'chest', look: 0,
      keys: [
        g(0),
        { f: 3, ease: 'out', pose: pose(torso({ pelvis: -100, yaw: -10, pitch: -12, look: 0, hy: -50 }),
          leg('L', { thigh: [0.05, -1, -0.1], shin: [0.05, -1, -0.1], toe: [1, -0.4, 0] }), leg('R', { thigh: [0.5, -0.5, 0.25], shin: [-0.6, -0.7, 0.2], toe: [0.3, -0.9, 0] })),
          hips: [0, -0.08, 0], wpn: W([0.2, -0.1, 0.8], dir(80, -30), [0, 1, 0]), wpnL: WL([0.3, 0.1, -0.8], dir(-80, 10), [0, 1, 0]) },
        { f: 6, ease: 'outCubic', pose: pose(torso({ pelvis: -176, yaw: -4, pitch: -30, look: 0, hy: -60, hp: 10 }),
          leg('L', { thigh: [0.1, -1, -0.12], shin: [0.1, -1, -0.12], toe: [1, -0.4, 0] }), leg('R', { thigh: [-1, 0.12, 0.08], shin: [-1, 0.16, 0.06], toe: [-0.2, -1, 0] })),
          hips: [0.05, -0.05, 0], wpn: W([0.3, -0.3, 0.75], dir(40, -50), [0, 0.2, 1]), wpnL: WL([0.3, 0.0, -0.8], dir(-40, -10), [0, 0.2, -1]) },
        { f: 10, pose: pose(torso({ pelvis: -178, yaw: -4, pitch: -28, look: 0, hy: -60, hp: 10 }),
          leg('L', { thigh: [0.1, -1, -0.12], shin: [0.1, -1, -0.12], toe: [1, -0.4, 0] }), leg('R', { thigh: [-1, 0.08, 0.08], shin: [-1, 0.1, 0.06], toe: [-0.2, -1, 0] })), hips: [0.05, -0.05, 0] },
        { f: 15, ease: 'inOut', pose: pose(torso({ pelvis: -220, yaw: -4, pitch: -16, look: 0, hy: -30 }),
          leg('L', { thigh: [0.1, -1, -0.12], shin: [0.05, -1, -0.12], toe: [1, -0.4, 0] }), leg('R', { thigh: [-0.3, -0.6, 0.2], shin: [-0.6, -0.8, 0.15], toe: [0.3, -0.9, 0] })), hips: [0.03, -0.08, 0] },
        { f: 21, ease: 'inOut', pose: pose(torso({ pelvis: -330, yaw: 6, pitch: -10, look: 0.5 }), leg('L', { thigh: [0.25, -1, -0.1], shin: [0.1, -1, -0.1] }), leg('R', { thigh: [-0.25, -1, 0.1], shin: [-0.4, -1, 0.1] })), hips: [0.02, -0.1, 0],
          wpn: W([0.5, 0.0, 0.3], dir(0, 10), [0, 0.3, 1]), wpnL: WL([0.2, -0.3, -0.35], dir(160, -30), [0, 0.3, -1]) },
        { f: 28, ease: 'inOut', pose: torso({ pelvis: -384, yaw: 8, pitch: -9, look: 0.95 }), hips: [0, -0.09, 0], ...ST, wpn: G_R, wpnL: G_L, plant: 1 },
      ],
      events: [{ f: 3, name: 'swing' }, { f: 6, name: 'impact' }],
    },
    grab: {
      frames: 36, loop: true, plant: 1,
      keys: [
        { f: 0, pose: torso({ pelvis: -14, yaw: 14, pitch: -10, look: 1 }), hips: [0, -0.12, 0], ...ST_W, wpn: W([0.1, 0.14, 0.5], dir(165, 20), [0, 0, 1]), wpnL: WL([0.74, 0.12, -0.04], dir(170, -55), [0, 0, -1]) },
        { f: 18, pose: torso({ pelvis: -16, yaw: 12, pitch: -12, look: 1 }), hips: [0.01, -0.13, 0], ...ST_W, wpn: W([0.1, 0.18, 0.5], dir(165, 24), [0, 0, 1]), wpnL: WL([0.72, 0.08, -0.04], dir(170, -58), [0, 0, -1]) },
      ],
    },
    knee: {
      frames: 17,
      keys: [
        { f: 0, pose: torso({ pelvis: -14, yaw: 14, pitch: -10, look: 1 }), hips: [0, -0.12, 0], ...ST_W, wpn: W([0.1, 0.14, 0.5], dir(165, 20), [0, 0, 1]), wpnL: WL([0.74, 0.12, -0.04], dir(170, -55), [0, 0, -1]) },
        { f: 3, ease: 'out', pose: torso({ pelvis: -20, yaw: 10, pitch: -2, look: 1 }), hips: [-0.03, -0.08, 0], ...feet([0.3, 0, -0.04, 0, 4], [-0.2, 0.14, 0.08, -30, 20]) },
        { f: 5, ease: 'outCubic', pose: torso({ pelvis: 4, yaw: 4, pitch: -20, look: 1 }), hips: [0.08, -0.04, 0], ...feet([0.3, 0.04, -0.04, -10, 4], [0.46, 0.6, 0.03, -36, 0]), wpnL: WL([0.6, -0.12, -0.04], dir(170, -60), [0, 0, -1]) },
        { f: 9, pose: torso({ pelvis: 2, yaw: 4, pitch: -18, look: 1 }), hips: [0.07, -0.05, 0], ...feet([0.3, 0.03, -0.04, -8, 4], [0.4, 0.48, 0.04, -30, 0]) },
        { f: 17, ease: 'inOut', pose: torso({ pelvis: -14, yaw: 14, pitch: -10, look: 1 }), hips: [0, -0.12, 0], ...ST_W, wpnL: WL([0.74, 0.12, -0.04], dir(170, -55), [0, 0, -1]) },
      ],
      events: [{ f: 5, name: 'impact' }],
    },
    grab_hit: { alias: 'knee' },
    // throw: duck under, heave the foe up and over (grab 5, release 14), flourish spin to recover (32)
    throw: {
      frames: 32, goalSpace: 'chest',
      keys: [
        { f: 0, pose: torso({ pelvis: -14, yaw: 14, pitch: -10 }), hips: [0, -0.12, 0], ...ST_W, wpn: W([0.1, 0.14, 0.5], dir(165, 20), [0, 0, 1]), wpnL: WL([0.74, 0.12, -0.04], dir(170, -55), [0, 0, -1]) },
        { f: 5, ease: 'out', pose: torso({ pelvis: 0, pitch: -26 }), hips: [0.06, -0.3, 0], ...ST_W, wpn: W([0.7, 0.0, 0.2], dir(170, -60), [0, 0, 1]), wpnL: WL([0.7, 0.0, -0.2], dir(-170, -60), [0, 0, -1]) },
        { f: 11, ease: 'inOut', pose: torso({ pelvis: 0, pitch: 10, look: 0.5 }), hips: [0.02, -0.06, 0], ...feet([0.3, 0.05, -0.04, -20, 4], [-0.26, 0.06, 0.08, -30, 40]),
          wpn: W([0.35, 0.92, 0.2], dir(170, 0), [0, 0, 1]), wpnL: WL([0.35, 0.92, -0.2], dir(-170, 0), [0, 0, -1]) },
        { f: 14, ease: 'in', pose: torso({ pelvis: 4, pitch: -22 }), hips: [0.12, -0.12, 0], ...feet([0.42, 0, -0.04, 0, 4], [-0.34, 0.06, 0.08, -24, 40]),
          wpn: W([0.75, 0.45, 0.2], dir(20, 30), [0, 0, 1]), wpnL: WL([0.75, 0.45, -0.2], dir(-20, 30), [0, 0, -1]) },
        { f: 19, ease: 'out', pose: pose(SPIN_LEGS, torso({ pelvis: 150, pitch: -10, look: 0 })), hips: [0.1, -0.08, 0], wpn: W([0.05, 0.1, 0.9], dir(90, 0), [1, 0, 0]), wpnL: WL([0.05, 0.1, -0.9], dir(-90, 0), [1, 0, 0]) },
        { f: 24, ease: 'linear', pose: pose(SPIN_LEGS, torso({ pelvis: 300, pitch: -10, look: 0 })), hips: [0.08, -0.08, 0] },
        { f: 32, ease: 'out', pose: torso({ pelvis: 336, yaw: 8, pitch: -9, look: 0.95 }), hips: [0, -0.09, 0], ...ST, wpn: G_R, wpnL: G_L, plant: 1 },
      ],
      events: [{ f: 5, name: 'grab' }, { f: 14, name: 'impact' }],
    },
    // throw_back: pivot with the foe across the hip and release behind; the pelvis unwinds as the code turns her
    throw_back: {
      frames: 32, goalSpace: 'chest',
      keys: [
        { f: 0, pose: torso({ pelvis: -14, yaw: 14, pitch: -10 }), hips: [0, -0.12, 0], ...ST_W, wpn: W([0.1, 0.14, 0.5], dir(165, 20), [0, 0, 1]), wpnL: WL([0.74, 0.12, -0.04], dir(170, -55), [0, 0, -1]) },
        { f: 5, ease: 'out', pose: torso({ pelvis: 0, pitch: -24 }), hips: [0.04, -0.28, 0], ...ST_W, wpn: W([0.7, 0.0, 0.2], dir(170, -60), [0, 0, 1]), wpnL: WL([0.7, 0.0, -0.2], dir(-170, -60), [0, 0, -1]) },
        { f: 10, ease: 'inOut', pose: pose(SPIN_LEGS, torso({ pelvis: 90, pitch: 4, look: 0 })), hips: [0.0, -0.1, 0], wpn: W([0.6, 0.6, 0.2], dir(170, 10), [0, 0, 1]), wpnL: WL([0.6, 0.6, -0.2], dir(-170, 10), [0, 0, -1]) },
        { f: 14, ease: 'in', pose: pose(SPIN_LEGS, torso({ pelvis: 178, pitch: -20, look: 0 })), hips: [0.06, -0.12, 0], wpn: W([0.75, 0.3, 0.2], dir(20, 20), [0, 0, 1]), wpnL: WL([0.75, 0.3, -0.2], dir(-20, 20), [0, 0, -1]) },
        { f: 20, ease: 'inOut', pose: torso({ pelvis: 20, pitch: -12, look: 0.5 }), hips: [0.04, -0.12, 0], ...ST_W, wpn: W([0.5, 0.0, 0.3], dir(0, 10), [0, 0.3, 1]), wpnL: WL([0.2, -0.3, -0.35], dir(160, -30), [0, 0.3, -1]) },
        g(32, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 5, name: 'grab' }, { f: 14, name: 'impact' }],
    },

    // ------------------------------------------------------------------------------------------- heavy
    // Ember Cross: blades crossed high behind the head (f7 = charge hold), then an X-cut through a deep lunge (11 / 5 / 20)
    heavy: {
      frames: 36,
      keys: [
        g(0),
        { f: 4, ease: 'out', pose: torso({ pelvis: -10, pitch: 12, look: 1 }), hips: [-0.03, -0.14, 0], ...ST_W,
          wpn: W([0.24, 0.76, 0.18], dir(170, 48), [0, 0, 1]), wpnL: WL([0.24, 0.76, -0.18], dir(-170, 48), [0, 0, -1]) },
        { f: 7, ease: 'out', pose: torso({ pelvis: -10, pitch: 16, look: 1 }), hips: [-0.06, -0.2, 0], ...ST_W,
          wpn: W([0.16, 0.8, 0.16], dir(176, 38), [0, 0, 1]), wpnL: WL([0.16, 0.8, -0.16], dir(-176, 38), [0, 0, -1]) },
        { f: 10, ease: 'in', pose: torso({ pelvis: -4, pitch: 0 }), hips: [0.1, -0.18, 0], ...feet([0.46, 0.06, -0.04, 10, 4], [-0.34, 0.02, 0.08, -10, 40]),
          wpn: W([0.6, 0.55, 0.14], dir(10, 62), [0, 0, 1]), wpnL: WL([0.6, 0.55, -0.14], dir(-10, 62), [0, 0, -1]) },
        { f: 11, ease: 'linear', pose: torso({ pelvis: 0, pitch: -24 }), hips: [0.26, -0.24, 0], ...feet([0.58, 0, -0.04, 0, 4], [-0.44, 0.02, 0.08, -18, 40]),
          wpn: W([0.78, 0.06, 0.18], dir(18, -24), [0, 0, 1]), wpnL: WL([0.78, 0.06, -0.18], dir(-18, -24), [0, 0, -1]) },
        { f: 15, ease: 'out', pose: torso({ pelvis: 0, pitch: -28 }), hips: [0.28, -0.26, 0],
          wpn: W([0.48, -0.3, 0.56], dir(72, -40), [0, 1, 0]), wpnL: WL([0.48, -0.3, -0.56], dir(-72, -40), [0, 1, 0]) },
        { f: 22, pose: torso({ pelvis: 0, pitch: -26 }), hips: [0.27, -0.25, 0] },
        { f: 29, ease: 'inOut', pose: torso({ pelvis: -16, yaw: 6, pitch: -12 }), hips: [0.12, -0.14, 0], ...feet([0.34, 0, -0.04, 0, 4], [-0.24, 0.08, 0.08, 0, 36]) },
        g(36, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 8, name: 'swing' }, { f: 11, name: 'impact' }],
    },
    heavy_charge: {
      frames: 30, loop: true,
      keys: [
        { f: 0, pose: torso({ pelvis: -12, pitch: 18, look: 1 }), hips: [-0.07, -0.23, 0], ...ST_W, wpn: W([0.14, 0.82, 0.16], dir(178, 36), [0, 0, 1]), wpnL: WL([0.14, 0.82, -0.16], dir(-178, 36), [0, 0, -1]) },
        { f: 15, pose: torso({ pelvis: -12, pitch: 20, look: 1 }), hips: [-0.08, -0.25, 0], ...ST_W, wpn: W([0.12, 0.84, 0.17], dir(179, 32), [0, 0, 1]), wpnL: WL([0.12, 0.84, -0.17], dir(-179, 32), [0, 0, -1]) },
      ],
    },
    // launcher: coil low, both blades rip upward together, rising onto the toes into a hop (7 / 4 / 18)
    launcher: {
      frames: 29,
      keys: [
        g(0),
        { f: 4, ease: 'out', pose: torso({ pelvis: -10, pitch: -26, look: 1 }), hips: [0.0, -0.3, 0], ...ST_W,
          wpn: W([0.1, -0.56, 0.42], dir(170, -30), [0, 0, 1]), wpnL: WL([0.1, -0.56, -0.42], dir(-170, -30), [0, 0, -1]) },
        { f: 7, ease: 'outCubic', pose: torso({ pelvis: 0, pitch: -4 }), hips: [0.12, 0.0, 0], ...feet([0.36, 0.06, -0.04, -30, 4], [-0.2, 0.1, 0.08, -40, 36]),
          wpn: W([0.7, 0.24, 0.14], dir(8, 52), [0, 0, 1]), wpnL: WL([0.7, 0.24, -0.14], dir(-8, 52), [0, 0, -1]) },
        { f: 10, ease: 'out', pose: torso({ pelvis: 0, pitch: 14 }), hips: [0.14, 0.08, 0], ...feet([0.34, 0.16, -0.04, -30, 4], [-0.18, 0.2, 0.08, -40, 36]),
          wpn: W([0.3, 0.92, 0.2], dir(4, 86), [0, 0, 1]), wpnL: WL([0.3, 0.92, -0.2], dir(-4, 86), [0, 0, -1]) },
        { f: 15, ease: 'in', pose: torso({ pelvis: -6, pitch: -10 }), hips: [0.1, -0.16, 0], ...ST_W },
        g(29, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 4, name: 'swing' }, { f: 7, name: 'impact' }],
    },

    // ------------------------------------------------------------------------------------------- air
    jump_up: {
      frames: 20,
      keys: [
        { f: 0, pose: torso({ pelvis: -20, pitch: -24 }), hips: [0.02, -0.24, 0], ...ST_W, wpn: W([0.3, -0.5, 0.42], dir(150, -30), [0, 0.3, 1]), wpnL: WL([0.3, -0.5, -0.42], dir(-150, -30), [0, 0.3, -1]) },
        { f: 4, ease: 'out', pose: torso({ pelvis: -14, pitch: 4 }), hips: [0.02, 0.03, 0], ...feet([0.1, 0.04, -0.03, -50, 4], [-0.14, 0.08, 0.06, -60, 30]),
          wpn: W([-0.1, -0.4, 0.45], dir(175, -40), [0, 0.3, 1]), wpnL: WL([-0.1, -0.4, -0.45], dir(-175, -40), [0, 0.3, -1]) },
        { f: 20, ease: 'inOut', pose: pose(torso({ pelvis: -14, pitch: -10 })), hips: [0.02, 0.0, 0], ...feet([0.3, 0.46, -0.03, 20, 4], [0.04, 0.3, 0.06, -10, 30]),
          wpn: W([0.3, 0.1, 0.62], dir(60, 20), [0, 1, 0.3]), wpnL: WL([0.3, 0.1, -0.62], dir(-60, 20), [0, 1, -0.3]) },
      ],
    },
    jump_fall: {
      frames: 36, loop: true,
      keys: [
        { f: 0, pose: torso({ pelvis: -14, pitch: -6 }), ...feet([0.28, 0.18, -0.03, 10, 4], [-0.12, 0.08, 0.06, -10, 30]), wpn: W([0.3, 0.12, 0.66], dir(70, 20), [0, 1, 0.3]), wpnL: WL([0.3, 0.12, -0.66], dir(-70, 20), [0, 1, -0.3]) },
        { f: 18, pose: torso({ pelvis: -14, pitch: -4 }), ...feet([0.26, 0.12, -0.03, 12, 4], [-0.14, 0.04, 0.06, -6, 30]), wpn: W([0.3, 0.16, 0.68], dir(70, 24), [0, 1, 0.3]), wpnL: WL([0.3, 0.16, -0.68], dir(-70, 24), [0, 1, -0.3]) },
      ],
    },
    land: {
      frames: 14, plant: 1,
      keys: [
        { f: 0, pose: torso({ pelvis: -20, pitch: -22 }), hips: [0.04, -0.26, 0], ...ST_W, wpn: W([0.35, -0.2, 0.62], dir(70, -10), [0, 1, 0.3]), wpnL: WL([0.35, -0.2, -0.62], dir(-70, -10), [0, 1, -0.3]) },
        { f: 3, ease: 'out', pose: torso({ pelvis: -20, pitch: -25 }), hips: [0.05, -0.29, 0] },
        g(14, { ease: 'inOut' }),
      ],
    },
    land_heavy: { alias: 'land' },
    // jump_attack: aerial pirouette — a full spin in the air, both blades out, then the blades held low (3 / 40)
    jump_attack: {
      frames: 43, goalSpace: 'chest', look: 0,
      keys: [
        { f: 0, ease: 'out', pose: pose(TUCK_LEGS, torso({ pelvis: -40, pitch: -6, look: 0 })), wpn: W([0.3, 0.2, 0.7], dir(60, 20), [0, 1, 0]), wpnL: WL([0.3, 0.2, -0.7], dir(-60, 20), [0, 1, 0]) },
        { f: 3, ease: 'linear', pose: pose(TUCK_LEGS, torso({ pelvis: 70, pitch: -10, look: 0 })), wpn: W([0.05, 0.05, 0.92], dir(90, -10), [1, 0, 0]), wpnL: WL([0.05, 0.05, -0.92], dir(-90, -10), [1, 0, 0]) },
        { f: 6, ease: 'linear', pose: pose(TUCK_LEGS, torso({ pelvis: 190, pitch: -10, look: 0 })) },
        { f: 9, ease: 'linear', pose: pose(TUCK_LEGS, torso({ pelvis: 300, pitch: -14, look: 0 })) },
        { f: 13, ease: 'out', pose: pose(TUCK_LEGS, torso({ pelvis: 340, pitch: -22, look: 0.6 })), wpn: W([0.6, -0.3, 0.3], dir(20, -50), [0, 0, 1]), wpnL: WL([0.6, -0.3, -0.3], dir(-20, -50), [0, 0, -1]) },
        { f: 43, pose: pose(TUCK_LEGS, torso({ pelvis: 340, pitch: -20, look: 0.6 })), wpn: W([0.58, -0.28, 0.3], dir(20, -48), [0, 0, 1]), wpnL: WL([0.58, -0.28, -0.3], dir(-20, -48), [0, 0, -1]) },
      ],
      events: [{ f: 1, name: 'swing' }, { f: 3, name: 'impact' }],
    },
    air_light: { alias: 'jump_attack' },
    // run_jump_attack: the long leap — split legs, body stretched forward, scissor cut with both blades (3 / 40)
    run_jump_attack: {
      frames: 43,
      keys: [
        { f: 0, ease: 'out', pose: torso({ pelvis: -10, pitch: 8, look: 1 }), ...feet([0.5, 0.2, -0.03, 20, 4], [-0.5, 0.32, 0.06, -50, 30]),
          wpn: W([0.0, 0.62, 0.36], dir(165, 40), [0, 0, 1]), wpnL: WL([0.0, 0.62, -0.36], dir(-165, 40), [0, 0, -1]) },
        { f: 3, ease: 'outCubic', pose: torso({ pelvis: 0, pitch: -28 }), ...feet([0.64, 0.2, -0.03, 24, 4], [-0.6, 0.34, 0.06, -56, 30]),
          wpn: W([0.8, 0.0, 0.1], dir(-20, -20), [0, 0.3, 1]), wpnL: WL([0.8, 0.02, -0.1], dir(20, -20), [0, 0.3, -1]) },
        { f: 8, ease: 'out', pose: torso({ pelvis: 0, pitch: -30 }), wpn: W([0.62, -0.2, -0.3], dir(-60, -35), [0, 1, 0]), wpnL: WL([0.62, -0.2, 0.3], dir(60, -35), [0, 1, 0]) },
        { f: 43, pose: torso({ pelvis: 0, pitch: -26 }), ...feet([0.56, 0.18, -0.03, 20, 4], [-0.52, 0.28, 0.06, -50, 30]) },
      ],
      events: [{ f: 1, name: 'swing' }, { f: 3, name: 'impact' }],
    },
    // death_stab: flip the blades point-down at the apex and drop onto the foe (6 / 45)
    death_stab: {
      frames: 51,
      keys: [
        { f: 0, ease: 'out', pose: torso({ pelvis: -8, pitch: 8, look: 1 }), ...feet([0.26, 0.46, -0.04, 10, 4], [-0.06, 0.34, 0.06, -20, 30]),
          wpn: W([0.3, 0.8, 0.2], dir(10, 80), [0, 0, 1]), wpnL: WL([0.3, 0.8, -0.2], dir(-10, 80), [0, 0, -1]) },
        { f: 5, ease: 'inOut', pose: torso({ pelvis: -6, pitch: 12, look: 1 }), wpn: W([0.26, 0.9, 0.16], dir(6, -84), [0, 0, 1]), wpnL: WL([0.26, 0.9, -0.16], dir(-6, -84), [0, 0, -1]) },
        // C2 r1: grips driven 0.42 arm-lengths lower with a deeper lean — the sabre tips sat 0.56 m above her feet, so a
        // lying body (0.4 m) was unreachable; now ≈ 0.3 m (the hit box in movesets/seraphine.js is the tip)
        { f: 7, ease: 'in', pose: torso({ pelvis: 0, pitch: -32, look: 0.8 }), ...feet([0.3, 0.4, -0.04, 6, 4], [-0.14, 0.3, 0.06, -26, 30]),
          wpn: W([0.52, -0.72, 0.14], dir(8, -84), [0, 0, 1]), wpnL: WL([0.52, -0.72, -0.14], dir(-8, -84), [0, 0, -1]) },
        { f: 51, pose: torso({ pelvis: 0, pitch: -34, look: 0.8 }), wpn: W([0.54, -0.74, 0.14], dir(8, -86), [0, 0, 1]), wpnL: WL([0.54, -0.74, -0.14], dir(-8, -86), [0, 0, -1]) },
      ],
      events: [{ f: 6, name: 'swing' }],
    },
    // air_slam: falcon dive — tuck, then drop blades-first, both sabres reversed beneath her (5 / 60)
    air_slam: {
      frames: 65,
      keys: [
        { f: 0, ease: 'out', pose: torso({ pelvis: -8, pitch: 10, look: 1 }), ...feet([0.3, 0.46, -0.04, 10, 4], [0.0, 0.36, 0.06, -20, 30]),
          wpn: W([0.1, 0.7, 0.4], dir(150, 40), [0, 0, 1]), wpnL: WL([0.1, 0.7, -0.4], dir(-150, 40), [0, 0, -1]) },
        { f: 5, ease: 'in', pose: torso({ pelvis: 0, pitch: -30, look: 0.8 }), ...feet([0.14, 0.34, -0.04, 0, 4], [-0.2, 0.22, 0.06, -30, 30]),
          wpn: W([0.46, -0.32, 0.14], dir(8, -80), [0, 0, 1]), wpnL: WL([0.46, -0.32, -0.14], dir(-8, -80), [0, 0, -1]) },
        { f: 65, pose: torso({ pelvis: 0, pitch: -28, look: 0.8 }) },
      ],
      events: [{ f: 4, name: 'swing' }],
    },
    air_heavy_slam: { alias: 'air_slam' },
    air_slam_land: {
      frames: 17, plant: 1,
      keys: [
        { f: 0, pose: torso({ pelvis: -10, pitch: -36, look: 0.7 }), hips: [0.06, -0.42, 0], ...ST_W,
          wpn: W([0.5, -0.66, 0.34], dir(10, -76), [0, 0, 1]), wpnL: WL([0.5, -0.66, -0.34], dir(-10, -76), [0, 0, -1]) },
        { f: 3, ease: 'out', pose: torso({ pelvis: -10, pitch: -38, look: 0.7 }), hips: [0.06, -0.45, 0] },
        { f: 9, ease: 'outCubic', pose: torso({ pelvis: -20, pitch: -10 }), hips: [0.02, -0.12, 0], wpn: W([0.5, 0.1, 0.5], dir(60, 30), [0, 1, 0.3]), wpnL: WL([0.3, -0.2, -0.5], dir(-120, -10), [0, 1, -0.3]) },
        g(17, { ease: 'inOut' }),
      ],
      events: [{ f: 0, name: 'impact' }],
    },

    // ------------------------------------------------------------------------------------------- dash / back / evade
    // run_attack: FLYING KICK — leap (the move adds vy), right heel driven forward, blades swept back (4 / 9 / 16)
    run_attack: {
      frames: 29,
      keys: [
        { f: 0, pose: torso({ pelvis: -10, pitch: -20 }), hips: [0.06, -0.16, 0], ...ST_W, wpn: W([-0.3, -0.34, 0.42], dir(172, -8), [0, 0.3, 1]), wpnL: WL([-0.3, -0.34, -0.42], dir(-172, -8), [0, 0.3, -1]) },
        // C1 r5 (board r4: "a low seated hop, then a sideways ground swing"): the kick now reads as a leap — the move's
        // vy is 4.0 (was 2.5), the torso stays nearer upright (pitch 6, not 16 reclined), the right heel drives
        // forward at hip height with the left shin tucked under, the blades sweep back-and-up; the landing (f17-f22)
        // is a deep absorbed crouch with both blades driven down-forward, then the guard recovers.
        { f: 2, ease: 'out', pose: torso({ pelvis: -20, pitch: -4, look: 1 }), hips: [0.0, 0.02, 0], ...feet([0.1, 0.44, -0.04, 0, 10], [0.3, 0.38, 0.04, 30, 0]) },
        { f: 4, ease: 'outCubic', pose: torso({ pelvis: -32, yaw: -6, pitch: 6, look: 1 }), hips: [-0.06, 0.04, 0], ...feet([-0.12, 0.42, -0.06, -24, 10], [1.04, 0.5, 0.0, 74, 0]),
          wpn: W([-0.36, 0.14, 0.5], dir(176, 26), [0, 0.3, 1]), wpnL: WL([-0.36, 0.14, -0.5], dir(-176, 26), [0, 0.3, -1]) },
        { f: 13, pose: torso({ pelvis: -32, yaw: -6, pitch: 4, look: 1 }), hips: [-0.06, 0.02, 0], ...feet([-0.1, 0.4, -0.06, -20, 10], [1.0, 0.46, 0.0, 70, 0]) },
        { f: 17, ease: 'in', pose: torso({ pelvis: -20, pitch: -30, look: 0.8 }), hips: [0.06, -0.32, 0], ...feet([0.34, 0, -0.04, 0, 4], [-0.26, 0.02, 0.08, -8, 40]),
          wpn: W([0.5, -0.34, 0.5], dir(30, -52), [0, 0.3, 1]), wpnL: WL([0.5, -0.34, -0.5], dir(-30, -52), [0, 0.3, -1]) },
        { f: 22, ease: 'out', pose: torso({ pelvis: -22, pitch: -18 }), hips: [0.03, -0.2, 0], wpn: W([0.44, -0.16, 0.5], dir(50, -24), [0, 0.3, 1]), wpnL: WL([0.44, -0.16, -0.5], dir(-50, -24), [0, 0.3, -1]) },
        g(29, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 2, name: 'swing' }, { f: 4, name: 'impact' }],
    },
    // back_attack: reverse pivot, Dawn whips around behind at head height, Dusk trailing (3 / 5 / 14)
    back_attack: {
      frames: 22,
      keys: [
        g(0),
        { f: 1, ease: 'out', pose: torso({ pelvis: 0, yaw: 16, pitch: -8, look: 0.2 }), hips: [0.02, -0.12, 0], wpn: W([0.5, 0.1, -0.3], dir(-50, 0), [0, 0.3, -1]) },
        { f: 3, ease: 'outCubic', pose: torso({ pelvis: -70, yaw: -40, pitch: -6, look: 0.2 }), hips: [-0.06, -0.12, 0], ...feet([0.2, 0.02, -0.02, -10, 4], [-0.28, 0.02, 0.1, -10, 70]),
          wpn: W([-0.36, 0.2, 0.56], dir(170, 4), [0, 0.3, 1]), wpnL: WL([0.3, 0.1, -0.6], dir(-40, 0), [0, 0.3, -1]) },
        { f: 7, ease: 'out', pose: torso({ pelvis: -86, yaw: -50, pitch: -6, look: 0.2 }), hips: [-0.08, -0.12, 0], wpn: W([-0.4, 0.14, 0.1], dir(-160, 0), [0, 0.3, 1]), wpnL: WL([-0.1, 0.1, -0.6], dir(-150, 0), [0, 0.3, -1]) },
        { f: 14, ease: 'inOut', pose: torso({ pelvis: -40, yaw: -10, pitch: -8 }), hips: [-0.03, -0.1, 0], ...ST, wpn: W([0.3, 0.0, 0.4], dir(40, 10), [0, 0.3, 1]), wpnL: G_L },
        g(22, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 1, name: 'swing' }, { f: 3, name: 'impact' }],
    },
    // dodge_roll: quick tucked forward roll, blades hugged along the forearms (22)
    dodge_roll: {
      frames: 22, goalSpace: 'chest',
      keys: [
        { f: 0, pose: torso({ pitch: -26 }), hips: [0.04, -0.26, 0], ...ST_W, wpn: W([0.3, -0.25, 0.3], dir(175, -10), [0, 0, 1]), wpnL: WL([0.3, -0.25, -0.3], dir(-175, -10), [0, 0, -1]) },
        // C1 r5 (board r4: "head planting into the ground line" at f4-f12): hips were -0.5..-0.55 m while inverted, which
        // put the head below the floor; now -0.3/-0.26 with a tighter chin-to-chest tuck (neck -42 / head -24)
        { f: 4, ease: 'in', pose: pose(TUCK_LEGS, { hips: [0, 0, -80], spine: [0, 0, -34], chest: [0, 0, -26], neck: [0, 0, -42], head: [0, 0, -24] }), hips: [0.14, -0.3, 0] },
        { f: 10, pose: pose(TUCK_LEGS, { hips: [0, 0, -190], spine: [0, 0, -36], chest: [0, 0, -26], neck: [0, 0, -42], head: [0, 0, -24] }), hips: [0.2, -0.26, 0] },
        { f: 16, pose: pose(TUCK_LEGS, { hips: [0, 0, -300], spine: [0, 0, -24], chest: [0, 0, -14], neck: [0, 0, -14], head: [0, 0, -6] }), hips: [0.12, -0.26, 0] },
        { f: 22, ease: 'out', pose: pose({ hips: [0, 0, -360] }, torso({ pelvis: 0, pitch: -14 }), leg('L', { thigh: [0.3, -1, -0.1], shin: [0, -1, -0.1] }), leg('R', { thigh: [-0.2, -1, 0.1], shin: [-0.4, -1, 0.1] })), hips: [0.02, -0.12, 0] },
      ],
    },
    // sidestep: a half-twirl slip, low and quick
    sidestep: {
      frames: 22, goalSpace: 'chest',
      keys: [
        g(0),
        { f: 4, ease: 'out', pose: pose(SPIN_LEGS, torso({ pelvis: -80, pitch: -24, roll: 10, look: 0.5 })), hips: [-0.04, -0.26, 0.06] },
        { f: 10, pose: pose(SPIN_LEGS, torso({ pelvis: -200, pitch: -18, roll: 6, look: 0 })), hips: [-0.03, -0.2, 0.04] },
        { f: 16, ease: 'inOut', pose: pose(SPIN_LEGS, torso({ pelvis: -330, pitch: -12, look: 0.5 })), hips: [0, -0.14, 0] },
        { f: 22, ease: 'inOut', pose: torso({ pelvis: -384, yaw: 8, pitch: -9, look: 0.95 }), hips: [0, -0.09, 0], ...ST, wpn: G_R, wpnL: G_L },
      ],
    },

    // ------------------------------------------------------------------------------------------- show
    taunt: {
      frames: 60, plant: 1,
      keys: [
        g(0),
        { f: 12, ease: 'out', pose: torso({ pelvis: -30, yaw: 10, pitch: 6, look: 0.6, hp: 8 }), hips: [0, -0.05, 0], ...feet([0.14, 0.04, -0.06, -12, 4], [-0.16, 0, 0.1, 0, 40]),
          wpn: W([0.2, 1.0, 0.3], dir(0, 88), [0.7, 0, 0.7]), wpnL: WL([0.3, -0.2, -0.62], dir(-90, -30), [0, 1, 0]) }, // C1 r5: flat at 45 deg
        { f: 30, ease: 'inOut', pose: torso({ pelvis: -34, yaw: 14, pitch: 2, look: 0.9, hr: 8 }), hips: [0, -0.06, 0],
          wpn: W([0.5, 0.4, 0.14], dir(-30, 50), [0, 0, 1]), wpnL: WL([0.5, 0.4, -0.14], dir(30, 50), [0, 0, -1]) },
        { f: 46, pose: torso({ pelvis: -34, yaw: 14, pitch: 3, look: 0.9, hr: 8 }), hips: [0, -0.06, 0] },
        g(60, { ease: 'inOut' }),
      ],
      events: [{ f: 30, name: 'roar' }],
    },
    victory: {
      frames: 96, loop: true, breathe: 1,
      keys: [
        { f: 0, pose: torso({ pelvis: -30, yaw: -4, pitch: 4, roll: -6, look: 0.4, hp: 8 }), hips: [0, -0.04, 0.03], ...feet([0.14, 0.03, -0.08, -10, 10], [-0.1, 0, 0.1, 0, 30]),
          wpn: W([0.2, 1.0, 0.36], dir(10, 84), [0.7, 0, 0.7]), wpnL: WL([0.0, 0.2, -0.36], dir(170, 50), [-0.7, 0, -0.7]) }, // C1 r5: flats at 45 deg (select-camera needle)
        { f: 48, pose: torso({ pelvis: -30, yaw: -6, pitch: 6, roll: -7, look: 0.4, hp: 10 }), hips: [0, -0.035, 0.03], ...feet([0.14, 0.03, -0.08, -10, 10], [-0.1, 0, 0.1, 0, 30]),
          wpn: W([0.22, 1.02, 0.34], dir(6, 86), [0.7, 0, 0.7]), wpnL: WL([0.0, 0.22, -0.36], dir(170, 52), [-0.7, 0, -0.7]) },
      ],
    },
    // select_stand (C2 r2, hero-weapons; src/ui/select3d.js plays it when it exists, else idle): the select camera is
    // ~20 deg off her forward axis (char-space dir ≈ [0.92, 0.19, 0.35]); Dawn raised on the right, Dusk low on the left,
    // both flats to the camera so the gold / violet PAIR reads.
    select_stand: {
      frames: 120, loop: true, plant: 1, breathe: 0.8, tags: ['idle'],
      keys: [
        { f: 0, pose: torso({ pelvis: -14, yaw: 6, pitch: 2, look: 0.6 }), hips: [0, -0.07, 0], ...ST_W, wpn: W([0.3, 0.02, 0.42], dir(-30, 76), [0.92, 0.19, 0.35]), wpnL: WL([0.32, -0.46, -0.44], dir(-45, -34), [0.92, 0.19, 0.35]) },
        { f: 60, pose: torso({ pelvis: -14, yaw: 7, pitch: 1, look: 0.6 }), hips: [0, -0.085, 0], ...ST_W, wpn: W([0.3, 0.0, 0.42], dir(-30, 75), [0.92, 0.19, 0.35]), wpnL: WL([0.33, -0.47, -0.44], dir(-45, -35), [0.92, 0.19, 0.35]) },
        { f: 120, pose: torso({ pelvis: -14, yaw: 6, pitch: 2, look: 0.6 }), hips: [0, -0.07, 0], ...ST_W, wpn: W([0.3, 0.02, 0.42], dir(-30, 76), [0.92, 0.19, 0.35]), wpnL: WL([0.32, -0.46, -0.44], dir(-45, -34), [0.92, 0.19, 0.35]) },
      ],
    },
    // magic: blades crossed low, then flung up into a burning V (castPeak)
    magic_cast: {
      frames: 50,
      keys: [
        g(0),
        { f: 12, ease: 'out', pose: torso({ pitch: -22, look: 0.6 }), hips: [0, -0.22, 0], ...ST_W, wpn: W([0.5, -0.4, 0.1], dir(-40, -30), [0, 0, 1]), wpnL: WL([0.5, -0.4, -0.1], dir(40, -30), [0, 0, -1]) },
        { f: 22, ease: 'outCubic', pose: torso({ pitch: 16, look: 0.3, hp: 12 }), hips: [0, 0.03, 0], ...feet([0.1, 0.05, -0.08, -20, 8], [-0.1, 0.05, 0.1, -20, 20]),
          wpn: W([0.2, 1.0, 0.44], dir(20, 72), [0, 0, 1]), wpnL: WL([0.2, 1.0, -0.44], dir(-20, 72), [0, 0, -1]) },
        { f: 40, pose: torso({ pitch: 13, look: 0.3, hp: 10 }), hips: [0, 0.02, 0] },
        g(50, { ease: 'inOut' }),
      ],
      events: [{ f: 22, name: 'castPeak' }],
    },
  },
};
