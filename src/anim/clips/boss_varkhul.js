// Iron Chancellor Varkhul — own stance (bosses C2 r1; board C1 r9: "every boss idles and carries its weapon the same
// way" — he used Brann's two-handed greatsword guard). Ref docs/refs/c2/bosses/varkhul.png: a towering knight-lord,
// the flail hanging at arm's length, the spiked ball by his feet. Everything else (attacks, reactions) is still the
// boss_morvane.js set (Brann grammar), which this set out-prioritises only for these clips.
// C2 r13 (board r12: "the flail hangs behind the body so the weapon drops out of the silhouette"; "upright posture reads
// as an elongated regular knight"): a PLANTED, threatening stance — wide base (feet well apart, knees softly bent, hips
// dropped), shoulders rolled forward over the lead leg, chin down — and the flail CARRIED FORWARD: the flail fist forward
// of the hip on the camera side, haft pointing ahead and a little down, so the chain falls in front of the lead foot and
// the ball (driven by _varkhul.js carryTarget) rests ahead of him, outside the body outline. The free fist hangs low and
// ready instead of the imperious fist-on-hip. Walk: a heavy, forward-leaning stalk with the ball swinging ahead of the
// lead foot. `&varkhulcarry=0` = the r12 upright stance (A/B).
import { dir, W, torso, feet, gait } from './_kit.js';
import { twoBeat, IDLE_R14 } from './_bossIdle.js';   // C2 r15: two-beat idle (&bossidle=r14 = old)

const OLD = typeof location !== 'undefined' && /[?&]varkhulcarry=0/.test(location.search);

// ---- r12 (A/B only)
const ST0 = feet([0.13, 0, -0.04, 0, 10], [-0.16, 0, 0.08, 0, 24]);
const T0 = (p = 0, hp = 0) => torso({ pelvis: -8, yaw: 6, pitch: 1 + p, look: 0.5, hp: 9 + hp });
const FL0 = (s = 0, e = 0) => W([0.36 + s, -0.56, 0.44], dir(24, -34 + e), [0, 0, 1]);
const AKIMBO = [0.0, -0.44, -0.46];

// ---- r13 planted carry
const ST1 = feet([0.22, 0, -0.17, 0, 16], [-0.24, 0, 0.2, 0, 30]);
const T1 = (p = 0, hp = 0) => torso({ pelvis: -12, yaw: 5, pitch: -9 + p, look: 0.55, hp: -3 + hp });
const FL1 = (s = 0, e = 0) => W([0.5 + s, -0.5, 0.3], dir(12, -16 + e), [0, 0, 1]);   // fist ahead of the hip, haft forward
const FIST = [0.2, -0.5, -0.42];                                                       // free gauntlet low, out, clenched

const ST = OLD ? ST0 : ST1, T = OLD ? T0 : T1, FL = OLD ? FL0 : FL1, HL = OLD ? AKIMBO : FIST;
const HIPS = OLD ? [0, -0.03, 0] : [0, -0.075, 0];
const k = (f, x = {}) => ({ f, pose: T(), hips: HIPS, ...ST, wpn: FL(), handL: HL, ...x });

const walk = OLD ? gait({
  P: 0.84, v: 2.1, duty: 0.57, cx: 0.32, lift: 0.11, heel: 0.1, bob: 0.02, hipsY: -0.045, hipsX: 0, sway: 0.012,
  width: 0.04, toeOut: 12, twist: 4, lean: 3,
  upper: (ph) => {
    const s = Math.sin(ph * Math.PI * 2);
    return { wpn: FL0(-s * 0.07, s * 6), handL: AKIMBO, pose: { head: [0, 0, 8] } };
  },
}) : gait({
  // a heavy stalk: wide track, knees bent, shoulders over the lead leg; the flail fist rides forward, swinging a little
  P: 0.88, v: 2.0, duty: 0.6, cx: 0.34, lift: 0.1, heel: 0.1, bob: 0.024, hipsY: -0.085, hipsX: 0.02, sway: 0.02,
  width: 0.11, toeOut: 14, twist: 6, lean: -8,
  upper: (ph) => {
    const s = Math.sin(ph * Math.PI * 2);
    return { wpn: FL1(0.04 - s * 0.06, s * 5), handL: [FIST[0] + s * 0.08, FIST[1], FIST[2]], pose: { head: [0, 0, -2] } };
  },
});

// run: Enemy plays 'run' at clip speed = ground speed / 6 → v = 6 / hip height (1.5 m) = 4.0 to keep the feet planted.
// A heavy armoured jog — flail low ahead of the hand.
const run = gait({
  P: 0.7, v: 4.0, duty: 0.42, cx: 0.4, lift: 0.2, heel: 0.1, bob: 0.04, hipsY: -0.07, sway: 0.015, width: OLD ? 0.05 : 0.09,
  toeOut: 10, twist: 7, lean: OLD ? -6 : -12, flight: 0.05,
  upper: (ph) => {
    const s = Math.sin(ph * Math.PI * 2);
    if (!OLD) return { wpn: W([0.42 - s * 0.1, -0.46, 0.34], dir(18, -22 + s * 6), [0, 0, 1]), handL: [0.3 + s * 0.12, -0.34, -0.38], pose: { head: [0, 0, -2] } };
    return { wpn: W([0.12 - s * 0.12, -0.6, 0.44], dir(150, -40 + s * 8), [0, 0, 1]), handL: [0.3 + s * 0.12, -0.3, -0.36], pose: { head: [0, 0, 5] } };
  },
});

export default {
  rig: 'humanoid', character: ['boss_varkhul'], priority: 13,
  clips: {
    idle: {
      frames: 180, loop: true, plant: 1, breathe: 1, grip: 0, tags: ['idle'],
      keys: OLD ? [
        k(0),
        k(90, { pose: T(1.6, 2), hips: [-0.01, -0.025, 0], wpn: FL(0.05, 5) }),
        k(180),
      ] : !IDLE_R14 ? twoBeat(180, k, { sway: 0.05, rise: 0.018, pitch: 6, roll: 3.2, yaw: 5, head: 13, lift: 0.04 }) : [
        k(0),
        // a slow, heavy breath: shoulders rise and roll back a touch, the flail fist lifts, then he settles forward again
        k(90, { pose: T(2.2, 2), hips: [-0.012, -0.068, 0], wpn: FL(-0.03, 6), handL: [FIST[0] - 0.03, FIST[1] + 0.03, FIST[2]] }),
        k(180),
      ],
    },
    walk: { duration: OLD ? 0.84 : 0.88, loop: true, grip: 0, keys: walk, events: [{ n: 0.02, name: 'footstep', foot: 'L' }, { n: 0.52, name: 'footstep', foot: 'R' }] },
    run: { duration: 0.7, loop: true, grip: 0, keys: run, events: [{ n: 0.02, name: 'footstep', foot: 'L' }, { n: 0.52, name: 'footstep', foot: 'R' }] },
  },
};
