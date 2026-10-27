// The Brute Brothers — own stance (bosses C2 r1; they used the generic one-hander guard, maul angled up-forward).
// Ref docs/refs/c2/enemies/ogre_brutes.png: hulking, low, apish. Forward head with a moderate hunch (face clear of the shoulders),
// wide toed-out feet, the maul hanging from a straight arm with its head on the ground behind (dragged), the free arm
// dangling forward, knuckles low. Walk: a lumbering side-to-side roll, the maul dragging behind. Character 'boss_brute'
// (types/boss_brute.js); every other clip still falls through to the generic set (grab, pound, toss...).
import { dir, W, torso, feet, gait, swingArm } from './_kit.js';
import { twoBeat, IDLE_R14 } from './_bossIdle.js';   // C2 r15: two-beat idle (&bossidle=r14 = old)

const ST = feet([0.15, 0, -0.16, 0, 20], [-0.16, 0, 0.18, 0, 30]);
const T = (p = 0) => torso({ pelvis: -6, yaw: 8, pitch: -16 + p, look: 1, hp: -3, pelvisPitch: -4 });
const DRAG = (x = 0, e = 0) => W([0.04 + x, -0.86, 0.46], dir(165, -36 + e), [0, 0, 1]);
const HANG = [0.3, -0.84, -0.4];
const k = (f, x = {}) => ({ f, pose: T(), hips: [-0.09, -0.15, 0], ...ST, wpn: DRAG(), handL: HANG, ...x });

const walk = gait({
  P: 1.0, v: 2.2, duty: 0.6, cx: 0.34, lift: 0.1, heel: 0.06, bob: 0.05, hipsY: -0.15, hipsX: -0.07, sway: 0.07, width: 0.12,
  toeOut: 22, twist: 10, lean: -17,
  upper: (ph) => {
    const s = Math.sin(ph * Math.PI * 2);
    return { wpn: DRAG(-s * 0.08, s * 4), pose: swingArm('L', -26 * s, 18, 0.42) };
  },
});

// run (clip speed = ground speed / 6 → v = 6 / ~1.45 m hip ≈ 4.1): a bent-over lumbering charge, maul trailing.
const run = gait({
  P: 0.78, v: 4.1, duty: 0.45, cx: 0.38, lift: 0.17, heel: 0.06, bob: 0.06, hipsY: -0.17, hipsX: -0.06, sway: 0.06,
  width: 0.12, toeOut: 20, twist: 12, lean: -23, flight: 0.04,
  upper: (ph) => {
    const s = Math.sin(ph * Math.PI * 2);
    return { wpn: DRAG(-0.06 - s * 0.1, 8 + s * 5), pose: swingArm('L', -40 * s, 30, 0.42) };
  },
});

export default {
  rig: 'humanoid', character: ['boss_brute'], priority: 6,
  clips: {
    idle: {
      frames: 140, loop: true, plant: 1, breathe: 1, tags: ['idle'],
      keys: !IDLE_R14 ? twoBeat(140, k, { sway: 0.06, rock: 0.02, rise: 0.026, pitch: 4.5, roll: 3.5, yaw: 6, head: 12, lift: 0.045, handSwing: 0.07, wpnSwing: 0.03 }) : [k(0), k(70, { pose: T(4), hips: [-0.09, -0.135, 0], wpn: DRAG(0.02, 3), handL: [0.32, -0.8, -0.41] }), k(140)],
    },
    run: { duration: 0.78, loop: true, keys: run, events: [{ n: 0.02, name: 'footstep', foot: 'L' }, { n: 0.52, name: 'footstep', foot: 'R' }] },
    walk: { duration: 1.0, loop: true, keys: walk, events: [{ n: 0.02, name: 'footstep', foot: 'L' }, { n: 0.52, name: 'footstep', foot: 'R' }] },
  },
};
