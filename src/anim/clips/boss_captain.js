// Hollow Knight Captains — own stance (bosses C2 r1; the captains used the generic one-hander guard, halberd angled
// forward like every other boss). Ref docs/refs/c2/bosses/hollow_knight_captain.png: crested helm, planted DEFENSIVE
// stance. The boss bodies carry no shield yet (requested from Enemy Art, _coord-C2.md), so the guard is a sentinel's:
// halberd planted upright in front of the lead foot, both hands on the haft, body bladed behind it, knees bent.
// Walk: a measured march, halberd carried upright at the side, free arm swinging. Character 'boss_captain'
// (types/boss_captain.js); everything else falls through to the generic humanoid set exactly as before.
import { dir, W, torso, feet, gait, swingArm } from './_kit.js';
import { twoBeat, IDLE_R14 } from './_bossIdle.js';   // C2 r15: two-beat idle (&bossidle=r14 = old)

const ST = feet([0.3, 0, -0.08, 0, 6], [-0.28, 0, 0.12, 0, 32]);
const SHIELD_OFF = typeof location !== 'undefined' && /[?&]captainshield=0/.test(location.search);
// C2 r12 shield-forward guard (the tower shield landed — types/boss_captain.js): the shield arm forward and a little
// out on the lead side, the tower shield up before the chest/lead leg; the great-halberd couched ONE-handed over the
// shield rim, point forward-up, the crescent's flat to the camera. Bladed less than the sentinel (he leads with the
// shield). &captainshield=0 = the old sentinel (halberd planted upright, both hands).
const T = (p = 0) => (SHIELD_OFF ? torso({ pelvis: -20, yaw: 14, pitch: -3 + p, look: 0.9 }) : torso({ pelvis: -12, yaw: 6, pitch: -7 + p, look: 0.95 }));
const HAL = (x = 0, y = 0) => (SHIELD_OFF ? W([0.5 + x, -0.12 + y, 0.18], dir(4, 86), [0.998, -0.07, 0])
  : W([0.26 + x, 0.02 + y, 0.3], dir(-2, 22), [-0.37, 0.93, 0]));   // couched: blade forward-up, the axe bit up (flat → camera)
const SH = (x = 0, y = 0) => [0.56 + x, -0.06 + y, -0.2];   // shield fist: forward, chest height, out to the left
const k = (f, x = {}) => ({ f, pose: T(), hips: [0, -0.14, 0], ...ST, wpn: HAL(), handL: SHIELD_OFF ? [0.48, 0.14, 0.12] : SH(), grip: SHIELD_OFF ? undefined : 0, ...x });

const walk = gait({
  P: 0.76, v: 2.15, duty: 0.55, cx: 0.34, lift: 0.13, heel: 0.1, bob: 0.022, hipsY: -0.08, twist: 4, lean: -2, toeOut: 10,
  upper: (ph) => {
    const s = Math.sin(ph * Math.PI * 2);
    if (!SHIELD_OFF) return { wpn: W([0.36 + s * 0.04, -0.2, 0.32], dir(8, 84), [0.995, -0.1, 0]), handL: SH(-0.04 + s * 0.02, -0.04 + Math.abs(s) * 0.02) };   // shield carried up front on the march
    return { wpn: W([0.36 + s * 0.04, -0.2, 0.32], dir(8, 84), [0.995, -0.1, 0]), pose: swingArm('L', -20 * s, 24, 0.3) };
  },
});

// run (v = 6 / ~1.4 m hip ≈ 4.3): halberd at port arms (diagonal across the chest, both hands), upright charge.
const run = gait({
  P: 0.62, v: 4.3, duty: 0.4, cx: 0.4, lift: 0.22, heel: 0.1, bob: 0.04, hipsY: -0.09, twist: 6, lean: -10, flight: 0.06,
  upper: (ph) => {
    const s = Math.sin(ph * Math.PI * 2);
    if (!SHIELD_OFF) return { wpn: W([0.34, -0.12 + s * 0.02, 0.3], dir(2, 30), [-0.5, 0.866, 0]), handL: SH(-0.06, -0.06 + s * 0.02), grip: 0 };   // shield charge, halberd levelled
    return { wpn: W([0.32, -0.28 + s * 0.02, 0.22], dir(10, 52), [0.788, -0.606, 0]), handL: [0.48, 0.02, -0.02] };
  },
});

// C2 r13 entrance beat (board r12: "both captains stand idle for the whole card interval"): played once per captain
// under the name card (bosses/captains.js drives the root forward over f4-22 = one stride). The lead (left) foot lifts
// and re-plants a stride ahead while the trailing foot stays planted in the world (so it slides back in local space),
// the tower shield is hauled up and SLAMMED rim-first into the floor at f26 (dust burst + thud from the script), the
// head snaps back to toss the plume (f44), the trailing foot steps up and he settles into the shield guard.
const PL = (pitch, hp) => torso({ pelvis: -12, yaw: 6, pitch, look: 0.95, hp });
const pk = (f, o) => ({ f, pose: PL(-7, 0), hips: [0, -0.14, 0], footL: [0.3, 0, -0.08, 0, 6], footR: [-0.28, 0, 0.12, 0, 32], wpn: HAL(), handL: SH(), grip: 0, ...o });
const shieldPlant = [
  pk(0),
  pk(4, { pose: PL(-5, 4), handL: SH(0.02, 0.08) }),
  pk(12, { pose: PL(-3, 6), hips: [0.02, -0.1, 0], footL: [0.32, 0.15, -0.08, -10, 6], footR: [-0.43, 0, 0.12, 0, 32], handL: SH(0.04, 0.24), wpn: HAL(-0.02, 0.06) }),
  pk(20, { pose: PL(-6, 2), hips: [0.04, -0.16, 0], footL: [0.3, 0.02, -0.1, 0, 6], footR: [-0.55, 0, 0.13, 0, 32], handL: SH(0.06, 0.2), wpn: HAL(0, 0.04) }),
  pk(26, { pose: PL(-17, -6), hips: [0.07, -0.26, 0], footL: [0.3, 0, -0.1, 0, 6], footR: [-0.58, 0, 0.14, 0, 32], handL: SH(0.1, -0.44), wpn: HAL(0.04, -0.08) }),
  pk(32, { pose: PL(-15, -4), hips: [0.07, -0.25, 0], footL: [0.3, 0, -0.1, 0, 6], footR: [-0.58, 0, 0.14, 0, 32], handL: SH(0.1, -0.4), wpn: HAL(0.04, -0.06) }),
  pk(38, { pose: PL(-11, 6), hips: [0.05, -0.22, 0], footL: [0.3, 0, -0.1, 0, 6], footR: [-0.44, 0.11, 0.13, -8, 30], handL: SH(0.09, -0.38), wpn: HAL(0.02, -0.03) }),
  pk(44, { pose: PL(-8, 18), hips: [0.03, -0.18, 0], footL: [0.3, 0, -0.09, 0, 6], footR: [-0.3, 0, 0.12, 0, 32], handL: SH(0.08, -0.36), wpn: HAL(0, 0.02) }),
  pk(52, { pose: PL(-9, -4), hips: [0.02, -0.17, 0], handL: SH(0.06, -0.32) }),
  pk(62, { pose: PL(-8, 2), hips: [0.01, -0.15, 0], handL: SH(0.03, -0.12) }),
  pk(76),
];

export default {
  rig: 'humanoid', character: ['boss_captain'], priority: 6,
  clips: {
    idle: {
      frames: 150, loop: true, plant: 1, breathe: 1, tags: ['idle'], grip: SHIELD_OFF ? undefined : 0,
      keys: !IDLE_R14 ? twoBeat(150, k, { sway: 0.042, rise: 0.016, pitch: 4.5, roll: 3, yaw: 5, head: 14, lift: 0.028, handSwing: 0.028 }) : [k(0), k(75, { pose: T(-1.2), hips: [0, -0.15, 0], wpn: HAL(0, -0.01), handL: SHIELD_OFF ? [0.48, 0.13, 0.12] : SH(0, -0.012) }), k(150)],
    },
    run: { duration: 0.62, loop: true, keys: run, events: [{ n: 0.02, name: 'footstep', foot: 'L' }, { n: 0.52, name: 'footstep', foot: 'R' }] },
    shield_plant: { frames: 76, loop: false, grip: 0, keys: SHIELD_OFF ? [k(0), k(76)] : shieldPlant, events: [{ n: 0.16, name: 'footstep', foot: 'L' }, { n: 0.5, name: 'footstep', foot: 'R' }] },
    walk: { duration: 0.76, loop: true, keys: walk, events: [{ n: 0.02, name: 'footstep', foot: 'L' }, { n: 0.52, name: 'footstep', foot: 'R' }] },
  },
};
