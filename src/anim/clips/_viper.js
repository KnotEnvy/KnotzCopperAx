// Viper Maiden clip-set BUILDER (private helper: '_' files are not registered). DESIGN §4: "whip-spear, leaping attacks,
// backflips away; Tyris-style silhouette". Board C2 r5 (all three seats): she walked like stiff polearm infantry —
// upright torso, the spear carried rigidly, a legs-only shuffle, one idle for all four tiers. This builder makes the
// serpent read: a low predatory idle (weight on the back leg, spear held low and coiling like a raised cobra head),
// a stalking walk / low run with hip ↔ shoulder counter-rotation, compressed weight-bearing poses and the spear
// trailing and swinging through the stride, and attack wind-ups that coil the body and draw the spear back along the
// side before the thrust. Only POSES change: every clip is keyed on the move's own frame count (types/viper.js: poke
// 8/4/16, poke_2 7/4/20, leap 12/14/16, jump_slash 10/10/12, backflip 2/0/30, dash 15/11/20), the strike pose lands on
// the first active tick, and translation stays in the move defs (the backflip's body roll is the viper brain's).
// Clips are named after the MOVE IDs (Animator.play prefers a clip named after the move), with light_1 / light_2 /
// run_attack / jump_attack aliases so the def.anim names resolve to the same poses. Reactions / land / getup / taunt
// still come from humanoid_base.js.
//
// viperSet(v): v tunes the per-tier read (enemy_viper.js jade+crimson, enemy_viper_dusk.js lower, enemy_viper_captain.js
// more upright / commanding). Hip height 1.01 m (enemy_viper_*.glb): walk v 3.1 = 3.2 m/s at clip speed 1 (the enemy FSM
// scales the walk by speed / 3.2), run v 5.9 = 6 m/s (run scaled by speed / 6).
import { dir, W, torso, feet, gait, swingArm, pose, leg } from './_kit.js';

const SPEAR_EDGE = [0, 0, 1];
/** Off hand on the shaft: `d` arm-lengths from the right grip along the blade (+ = toward the tip). */
const onShaft = (w, d, dz = -0.05) => [w.at[0] + w.blade[0] * d, w.at[1] + w.blade[1] * d, w.at[2] + w.blade[2] * d + dz];
/** Re-time a key list to another frame count (same shape, different move length). */
const retime = (keys, k) => keys.map((x) => ({ ...x, f: Math.round(x.f * k) }));

export function viperSet({
  crouch = -0.2,      // idle hips drop (hip-height units; the generic guard is -0.08)
  lean = -16,         // idle torso pitch (− = forward)
  blade = -12,        // idle spear tip elevation (− = the tip toward the floor ahead)
  headUp = 6,         // head pitch up (the eyes stay on the target from the low stance)
  sway = 1,           // idle sway / spear-coil amplitude
  stride = 1,         // walk stride / counter-rotation amplitude
  walkCrouch = -0.16, // walk hips drop
  runLean = -24,
  spearHigh = 0,      // 0..1: carry the spear tip higher (captain: a commanding point)
} = {}) {
  // ---------------------------------------------------------------------------------------------- stance
  // bladed: left foot leads, weight back over the right (spear-side) leg, torso turned so the spear side trails
  const ST = feet([0.3, 0, -0.06, 0, 6], [-0.28, 0, 0.1, 0, 34]);
  const ST_W = feet([0.42, 0, -0.06, 0, 4], [-0.36, 0, 0.1, 0, 36]);
  const T = (o = {}) => torso({ pelvis: -24, yaw: 10, pitch: lean, look: 0.95, hp: headUp, ...o });
  // the spear held LOW at the right hip, the tip ahead and a little down (a cobra's raised head, coiled to strike)
  const SP = (az = 0, el = 0, x = 0, y = 0) => W([0.12 + x, -0.52 + y + spearHigh * 0.14, 0.42], dir(-8 + az, blade + el + spearHigh * 34), SPEAR_EDGE);
  const HL = [0.52, -0.3, -0.28];   // free hand forward, low, open: the other coil
  const GUARD = { pose: T(), hips: [-0.06, crouch, 0], ...ST, wpn: SP(), handL: HL };
  const g = (f, x = {}) => ({ f, ...GUARD, ...x });

  // ---------------------------------------------------------------------------------------------- idle
  // weight rolling slowly over the back leg, the spear tip drawing a slow figure (az/el), the head weaving with it
  const idle = {
    frames: 150, loop: true, plant: 1, breathe: 0.9, tags: ['idle'],
    keys: [
      g(0),
      g(30, { pose: T({ pelvis: -27, yaw: 13, pitch: lean - 2.5, hy: 8 * sway, roll: 2.5 * sway, hr: 3 * sway }), hips: [-0.09, crouch - 0.02, 0.02], wpn: SP(12 * sway, 8 * sway, 0.03, 0.03), handL: [0.48, -0.34, -0.24] }),
      g(60, { pose: T({ pelvis: -21, yaw: 7, pitch: lean + 1.5, hy: -3 * sway }), hips: [-0.04, crouch + 0.012, -0.012], wpn: SP(-8 * sway, 11 * sway, -0.03, 0.06) }),
      g(90, { pose: T({ pelvis: -26, yaw: 12, pitch: lean - 1.5, hy: -9 * sway, roll: -2.5 * sway, hr: -3 * sway }), hips: [-0.085, crouch - 0.01, -0.02], wpn: SP(-14 * sway, -5 * sway, 0, -0.02), handL: [0.56, -0.27, -0.32] }),
      g(120, { pose: T({ pelvis: -22, yaw: 8, pitch: lean + 0.5, hy: 3 * sway }), hips: [-0.05, crouch + 0.006, 0.012], wpn: SP(8 * sway, 3 * sway, 0.04, 0.015) }),
      g(150),
    ],
  };

  // ---------------------------------------------------------------------------------------------- locomotion
  // stalk: long low strides, hips and shoulders counter-rotating, the spear swinging with the right arm and its tip
  // lagging the grip (follow-through), the free arm wide
  const walk = gait({
    P: 0.62, v: 3.1, duty: 0.54, cx: 0.38, lift: 0.13, heel: 0.11, bob: 0.035, hipsY: walkCrouch, hipsX: 0.02, sway: 0.03,
    twist: 14 * stride, lean: lean + 2, toeOut: 10, width: 0.02,
    upper: (ph, k) => {
      const s = Math.sin(ph * Math.PI * 2), c = Math.cos(ph * Math.PI * 2);
      const b = Math.sin(ph * Math.PI * 4);
      const twist = 14 * stride * s;
      return {
        // shoulders counter the pelvis harder than the gait default and roll with the weight-bearing leg
        pose: { ...torso({ pelvis: -twist, yaw: twist * 1.6, pitch: lean + 2 + b * 1.5, roll: -2.5 * s, pelvisRoll: -3.5 * s, look: 0.92, hp: headUp }), ...swingArm('L', -34 * stride * s, 36, 0.34) },
        // grip swings with the right arm (opposite the right leg: −s), the tip trails by a quarter cycle (c)
        wpn: W([0.12 - s * 0.18 * stride, -0.5 + b * 0.02 + spearHigh * 0.12, 0.42], dir(-8 + c * 9 * stride, blade + 2 - c * 8 * stride + spearHigh * 30), SPEAR_EDGE),
      };
    },
  });
  // low sprint: deeper lean, the spear levelled at the hip and pumping, the free arm driving
  const run = gait({
    P: 0.5, v: 5.9, duty: 0.3, cx: 0.42, lift: 0.3, heel: 0.1, bob: 0.045, hipsY: walkCrouch + 0.02, hipsX: 0.06, sway: 0.02,
    twist: 13 * stride, lean: runLean, flight: 0.12, strike: 6, pushOff: 38, width: 0.02,
    upper: (ph) => {
      const s = Math.sin(ph * Math.PI * 2);
      return {
        pose: swingArm('L', -52 * s, 78, 0.26),
        wpn: W([0.26 - s * 0.16, -0.44, 0.42], dir(2 + s * 5, -6 + s * 7 + spearHigh * 16), SPEAR_EDGE),
      };
    },
  });

  // ---------------------------------------------------------------------------------------------- attacks
  // poke (8 / 4 / 16 = 28): coil — the spear drawn back along the side, weight sunk onto the back leg, shoulders
  // turned away — then the thrust: the hips drive forward, shoulders snap square, the tip flies out at waist height.
  const COIL = (k = 1) => ({
    pose: T({ pelvis: -24 - 10 * k, yaw: 10 - 34 * k, pitch: lean - 4 * k, hp: headUp + 2 }), hips: [-0.06 - 0.1 * k, crouch - 0.05 * k, 0],
    ...ST_W, wpn: W([0.12 - 0.36 * k, -0.42, 0.5], dir(-4, 6), SPEAR_EDGE),
  });
  const coilKey = (f, k = 1, x = {}) => { const c = COIL(k); return { f, ...c, handL: onShaft(c.wpn, 0.55, -0.1), ...x }; };
  const THRUST = (reach = 0.86, drop = -0.18) => W([reach, drop, 0.12], dir(0, -4), SPEAR_EDGE);
  const lungeFeet = (fx = 0.5, bx = -0.32) => feet([fx, 0, -0.06, 0, 4], [bx, 0.05, 0.1, -28, 36]);
  const poke = {
    frames: 28,
    keys: [
      g(0),
      coilKey(5, 1, { ease: 'out' }),
      { f: 8, ease: 'in', pose: T({ pelvis: 14, yaw: 22, pitch: lean - 6, hp: headUp - 2 }), hips: [0.18, crouch, 0], ...lungeFeet(), wpn: THRUST(0.86, -0.16), handL: [0.3, -0.42, 0.02] },
      { f: 12, ease: 'out', pose: T({ pelvis: 16, yaw: 24, pitch: lean - 7, hp: headUp - 2 }), hips: [0.2, crouch - 0.01, 0], wpn: THRUST(0.9, -0.17) },
      { f: 17, pose: T({ pelvis: 10, yaw: 16, pitch: lean - 4 }), hips: [0.14, crouch, 0], wpn: W([0.7, -0.26, 0.2], dir(-6, -10), SPEAR_EDGE), handL: [0.36, -0.4, -0.12] },
      g(28, { ease: 'inOut', plant: 1 }),
    ],
    events: [{ f: 6, name: 'swing' }, { f: 8, name: 'impact' }],
  };
  // poke_2 (7 / 4 / 20 = 31): from the extended poke, the tip whips down and back, then a rising hook that
  // launches (hit box y 0.5..1.4): the body unwinds the other way and rises with the spear.
  const poke_2 = {
    frames: 31,
    keys: [
      { f: 0, pose: T({ pelvis: 12, yaw: 18, pitch: lean - 4 }), hips: [0.14, crouch, 0], ...lungeFeet(0.46, -0.3), wpn: W([0.7, -0.26, 0.2], dir(-6, -10), SPEAR_EDGE), handL: [0.36, -0.4, -0.12] },
      { f: 3, ease: 'out', pose: T({ pelvis: 26, yaw: 30, pitch: lean - 2, roll: 4 }), hips: [0.06, crouch - 0.06, 0], wpn: W([0.1, -0.56, 0.46], dir(-24, -34), SPEAR_EDGE), handL: [0.4, -0.3, -0.22] },
      { f: 7, ease: 'in', pose: T({ pelvis: -12, yaw: -16, pitch: lean - 2, roll: -3, hp: headUp + 4 }), hips: [0.16, crouch + 0.02, 0], ...lungeFeet(0.5, -0.34), wpn: W([0.74, 0.08, 0.14], dir(2, 26), SPEAR_EDGE), handL: [0.2, -0.3, -0.3] },
      { f: 11, ease: 'out', pose: T({ pelvis: -18, yaw: -22, pitch: lean + 6, hp: headUp + 6 }), hips: [0.16, crouch + 0.06, 0], wpn: W([0.5, 0.42, 0.2], dir(-8, 62), SPEAR_EDGE), handL: [0.22, -0.2, -0.3] },
      { f: 18, pose: T({ pelvis: -14, yaw: -14, pitch: lean + 2 }), hips: [0.1, crouch + 0.02, 0], wpn: W([0.3, 0.2, 0.36], dir(-14, 40), SPEAR_EDGE), handL: [0.36, -0.26, -0.3] },
      g(31, { ease: 'inOut', plant: 1 }),
    ],
    events: [{ f: 4, name: 'swing' }, { f: 7, name: 'impact' }],
  };
  // dive (leap 12/14/16 = 42, jump_slash 10/10/12 = 32): a crouched load, the body opens upward with the spear drawn
  // overhead, then folds into a plunging thrust with the legs trailing; the strike pose is reached on the first hit tick.
  const DIVE_LEGS = pose(leg('L', { thigh: [-0.5, -0.85, -0.12], shin: [-0.9, -0.45, -0.1], toe: [0.3, -0.95, -0.05] }),
    leg('R', { thigh: [-0.7, -0.7, 0.14], shin: [-0.95, -0.3, 0.1], toe: [0.2, -0.98, 0.05] }));
  const dive = (n) => ({
    frames: n,
    keys: retime([
      { f: 0, pose: T({ pelvis: -16, yaw: 4, pitch: lean - 6 }), hips: [-0.04, crouch - 0.08, 0], ...ST_W, wpn: SP(0, 6), handL: HL },
      { f: 8, ease: 'out', pose: torso({ pelvis: -6, yaw: -8, pitch: 10, look: 0.9, hp: 8 }), hips: [0.04, 0.02, 0], ...feet([0.2, 0.3, -0.06, -30, 6], [-0.3, 0.42, 0.1, -46, 30]), wpn: W([-0.1, 0.82, 0.42], dir(168, 42), SPEAR_EDGE), handL: [0.44, 0.34, -0.3] },
      { f: 14, ease: 'in', pose: pose(torso({ pelvis: 10, yaw: 12, pitch: -38, look: 0.8, hp: 10 }), DIVE_LEGS), hips: [0.08, 0.04, 0], wpn: W([0.8, -0.3, 0.12], dir(0, -46), SPEAR_EDGE), handL: [0.14, -0.3, -0.42] },
      { f: 30, pose: pose(torso({ pelvis: 10, yaw: 12, pitch: -40, look: 0.8, hp: 10 }), DIVE_LEGS), hips: [0.08, 0.04, 0], wpn: W([0.76, -0.36, 0.12], dir(0, -50), SPEAR_EDGE), handL: [0.16, -0.32, -0.42] },
      { f: 42, pose: pose(torso({ pelvis: 6, yaw: 8, pitch: -30, look: 0.8, hp: 8 }), DIVE_LEGS), hips: [0.06, 0.02, 0], wpn: W([0.7, -0.34, 0.14], dir(-4, -44), SPEAR_EDGE), handL: [0.2, -0.3, -0.4] },
    ], n / 42),
    events: [{ f: Math.round(6 * n / 42), name: 'swing' }],
  });
  // backflip (2 / 0 / 30 = 32; the viper brain rolls the whole body 360° over frames 0..26): sink, spring, tuck
  // with the spear pulled in vertical along the body (a compact spinning silhouette), open out to land.
  const TUCK = pose(leg('L', { thigh: [0.92, -0.3, -0.12], shin: [-0.55, -0.85, -0.1], toe: [0.5, -0.86, -0.05] }),
    leg('R', { thigh: [0.86, -0.42, 0.14], shin: [-0.6, -0.8, 0.1], toe: [0.4, -0.9, 0.05] }));
  const OPEN = pose(leg('L', { thigh: [0.25, -1, -0.1], shin: [-0.1, -1, -0.1], toe: [0.9, -0.42, -0.05] }),
    leg('R', { thigh: [0.1, -1, 0.14], shin: [-0.2, -1, 0.1], toe: [0.9, -0.42, 0.05] }));
  const backflip = {
    frames: 32, plant: 0,
    keys: [
      { f: 0, pose: T({ pelvis: -10, yaw: 2, pitch: lean - 8 }), hips: [-0.02, crouch - 0.1, 0], ...ST_W, wpn: SP(0, 10), handL: HL },
      { f: 3, ease: 'out', pose: pose(torso({ pelvis: -4, yaw: 0, pitch: 6, look: 0.7 }), OPEN), hips: [0, 0.02, 0], wpn: W([0.08, 0.3, 0.44], dir(10, 84), SPEAR_EDGE), handL: [0.1, 0.5, -0.42] },
      { f: 10, ease: 'inOut', pose: pose(torso({ pelvis: 0, yaw: 0, pitch: -16, look: 0.4, hp: -16 }), TUCK), hips: [0, 0.0, 0], wpn: W([0.3, 0.2, 0.44], dir(20, 80), SPEAR_EDGE), handL: [0.32, 0.1, -0.4] },
      { f: 20, pose: pose(torso({ pelvis: 0, yaw: 0, pitch: -14, look: 0.4, hp: -14 }), TUCK), hips: [0, 0.0, 0], wpn: W([0.3, 0.22, 0.44], dir(20, 80), SPEAR_EDGE), handL: [0.32, 0.12, -0.4] },
      { f: 27, ease: 'out', pose: pose(torso({ pelvis: -6, yaw: 4, pitch: -6, look: 0.8 }), OPEN), hips: [0, 0.0, 0], wpn: W([0.14, -0.1, 0.44], dir(0, 50), SPEAR_EDGE), handL: [0.3, -0.1, -0.38] },
      { f: 32, ease: 'inOut', pose: T({ pelvis: -20, yaw: 8, pitch: lean - 4 }), hips: [-0.04, crouch - 0.06, 0], ...ST, wpn: SP(0, 4), handL: HL },
    ],
  };
  // dash (15 / 11 / 20 = 46; root motion 13..26 at 9 m/s): the long unblockable lunge. A deep two-handed coil held
  // through the red telegraph (frames 4..14), then the whole body uncoils into a flat, low, fully extended thrust.
  const dash = {
    frames: 46,
    keys: [
      g(0),
      coilKey(6, 1.4, { ease: 'out' }),
      coilKey(13, 1.5, { pose: T({ pelvis: -40, yaw: -42, pitch: lean - 8, hp: headUp + 4 }) }),
      { f: 15, ease: 'in', pose: T({ pelvis: 22, yaw: 28, pitch: lean - 12, hp: headUp - 4 }), hips: [0.26, crouch - 0.1, 0], ...lungeFeet(0.7, -0.44), wpn: THRUST(0.96, -0.2), handL: [0.26, -0.4, 0.0] },
      { f: 26, pose: T({ pelvis: 24, yaw: 30, pitch: lean - 12, hp: headUp - 4 }), hips: [0.28, crouch - 0.12, 0], wpn: THRUST(0.98, -0.22), handL: [0.26, -0.4, 0.0] },
      { f: 36, ease: 'inOut', pose: T({ pelvis: 8, yaw: 14, pitch: lean - 4 }), hips: [0.1, crouch - 0.02, 0], ...ST_W, wpn: W([0.5, -0.36, 0.3], dir(-6, -8), SPEAR_EDGE), handL: [0.4, -0.36, -0.2] },
      g(46, { ease: 'inOut', plant: 1 }),
    ],
    events: [{ f: 13, name: 'swing' }],
  };

  const foot = [{ n: 0.02, name: 'footstep', foot: 'L' }, { n: 0.52, name: 'footstep', foot: 'R' }];
  return {
    idle,
    walk: { duration: 0.62, loop: true, keys: walk, events: foot },
    run: { duration: 0.5, loop: true, keys: run, events: foot },
    poke, poke_2, leap: dive(42), jump_slash: dive(32), backflip, dash,
    light_1: { alias: 'poke' }, light_2: { alias: 'poke_2' }, run_attack: { alias: 'dash' }, jump_attack: { alias: 'leap' },
    // heavy charge hold (not used by the viper's moves; keeps any future charge on-model)
    heavy_charge: { frames: 40, loop: true, keys: [coilKey(0, 1.3)] },
  };
}
