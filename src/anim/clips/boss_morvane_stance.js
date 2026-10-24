// Morvane Deathcoil — own stance (bosses C2 r1; board C1 r9: "Morvane reads as another armoured captain — broader,
// forward-weighted torso and a low planted stance"; brief: axe on the shoulder, witchfire hand forward). Ref
// docs/refs/c2/bosses/morvane.png. Hunched, heavy and low: wide planted feet, pelvis dropped, chest pitched forward over
// the front foot; the great-axe rides on the right shoulder (haft up and back, the crescent above/behind the head —
// a silhouette none of the other bosses have); the left hand reaches forward, claw open (the witchfire hand).
// Walk: a slow, wide, rolling stomp, axe still shouldered. Attacks stay in boss_morvane.js (Brann grammar).
import { dir, W, torso, feet, gait } from './_kit.js';

const ST = feet([0.27, 0, -0.14, 0, 10], [-0.25, 0, 0.2, 0, 34]);
const T = (p = 0, y = 0) => torso({ pelvis: -16, yaw: 12 + y, pitch: -30 + p, look: 1, hp: 6, pelvisPitch: -6 });
// blade = dir(186, 50) (haft up and back over the shoulder); edge ⊥ blade in the side plane → the bit faces up-forward
const AXE = (b = 0) => W([0.3, 0.06 + b, 0.38], dir(186, 50), [0.766, 0.643, 0]);
const CLAW = (d = 0) => [0.8 + d, -0.08 + d * 0.5, -0.1];
const k = (f, x = {}) => ({ f, pose: T(), hips: [-0.07, -0.17, 0], ...ST, wpn: AXE(), handL: CLAW(), ...x });

const walk = gait({
  P: 0.95, v: 2.1, duty: 0.6, cx: 0.36, lift: 0.1, heel: 0.08, bob: 0.045, hipsY: -0.17, hipsX: -0.05, sway: 0.035,
  width: 0.09, toeOut: 14, twist: 9, lean: -28,
  upper: (ph) => {
    const s = Math.sin(ph * Math.PI * 2), b = Math.sin(ph * Math.PI * 4);
    return { wpn: AXE(b * 0.02), handL: [0.72 + s * 0.06, -0.14, -0.12] };
  },
});

// run: clip speed = ground speed / 6 → v = 6 / 1.5 m = 4.0. A hunched, charging lope — axe still on the shoulder.
const run = gait({
  P: 0.74, v: 4.0, duty: 0.44, cx: 0.42, lift: 0.18, heel: 0.08, bob: 0.05, hipsY: -0.2, hipsX: -0.05, sway: 0.03,
  width: 0.09, toeOut: 12, twist: 10, lean: -32, flight: 0.05,
  upper: (ph) => {
    const s = Math.sin(ph * Math.PI * 2);
    return { wpn: AXE(Math.sin(ph * Math.PI * 4) * 0.03), handL: [0.6 + s * 0.15, -0.2, -0.16] };
  },
});

export default {
  rig: 'humanoid', character: ['boss_morvane'], priority: 13,
  clips: {
    idle: {
      frames: 160, loop: true, plant: 1, breathe: 1, grip: 0, tags: ['idle'],
      keys: [
        k(0),
        k(80, { pose: T(2.5, -2), hips: [-0.07, -0.155, 0], wpn: AXE(0.02), handL: CLAW(0.04) }),
        k(160),
      ],
    },
    // C2 r12 reveal (board r11: "the reveal plays with his back/side to the camera, helmet face, witchfire hand and axe
    // never shown"). intro_rise: he comes up out of the bone pile from a deep crouch, the claw dragging off the floor,
    // into his stance. intro_reveal: chest and helm come UP (face to the heroes), the witchfire claw thrusts out at
    // head height on the camera side, the axe lifts off the shoulder so the crescent stands clear above the helm; a
    // tremor through the roar, then he sinks back into the hunched stance. _morvane.js turns him 3/4 to the camera.
    intro_rise: {
      frames: 66, plant: 1, grip: 0,
      keys: [
        k(0, { pose: T(-26, -8), hips: [-0.12, -0.46, 0], wpn: W([0.22, -0.1, 0.42], dir(186, 34), [0.766, 0.643, 0]), handL: [0.55, -0.95, -0.2] }),
        k(26, { ease: 'out', pose: T(-12, -4), hips: [-0.1, -0.32, 0], wpn: AXE(-0.06), handL: [0.66, -0.55, -0.16] }),
        k(66, { ease: 'inOut' }),
      ],
    },
    intro_reveal: {
      frames: 66, plant: 1, grip: 0,
      keys: [
        k(0),
        k(12, { ease: 'out', pose: torso({ pelvis: -10, yaw: 4, pitch: -6, look: 1, hp: 12, pelvisPitch: -2 }), hips: [-0.05, -0.12, 0],
          wpn: W([0.24, 0.3, 0.36], dir(184, 66), [0.766, 0.643, 0]), handL: [0.92, 0.32, -0.3] }),
        k(16, { pose: torso({ pelvis: -10, yaw: 4, pitch: -4, look: 1, hp: 14, pelvisPitch: -2 }), hips: [-0.05, -0.12, 0],
          wpn: W([0.24, 0.32, 0.36], dir(184, 68), [0.766, 0.643, 0]), handL: [0.95, 0.36, -0.32] }),
        k(22, { pose: torso({ pelvis: -10, yaw: 6, pitch: -7, look: 1, hp: 11, pelvisPitch: -2 }), hips: [-0.05, -0.13, 0],
          wpn: W([0.24, 0.29, 0.36], dir(184, 66), [0.766, 0.643, 0]), handL: [0.93, 0.31, -0.29] }),
        k(28, { pose: torso({ pelvis: -10, yaw: 3, pitch: -4, look: 1, hp: 14, pelvisPitch: -2 }), hips: [-0.05, -0.12, 0],
          wpn: W([0.24, 0.32, 0.36], dir(184, 68), [0.766, 0.643, 0]), handL: [0.96, 0.35, -0.32] }),
        k(40, { pose: torso({ pelvis: -10, yaw: 5, pitch: -6, look: 1, hp: 12, pelvisPitch: -2 }), hips: [-0.05, -0.12, 0],
          wpn: W([0.24, 0.3, 0.36], dir(184, 67), [0.766, 0.643, 0]), handL: [0.94, 0.33, -0.3] }),
        k(66, { ease: 'inOut' }),
      ],
      events: [{ f: 12, name: 'roar' }],
    },
    walk: { duration: 0.95, loop: true, grip: 0, keys: walk, events: [{ n: 0.02, name: 'footstep', foot: 'L' }, { n: 0.52, name: 'footstep', foot: 'R' }] },
    run: { duration: 0.74, loop: true, grip: 0, keys: run, events: [{ n: 0.02, name: 'footstep', foot: 'L' }, { n: 0.52, name: 'footstep', foot: 'R' }] },
  },
};
