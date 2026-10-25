// The Wyrm Rider (Captain Sskara) — own riding posture (bosses C2 r1; she sat in the generic forward-hunched ride_idle
// with the spear angled up like every mounted marauder). Ref docs/refs/c2/bosses/wyrm_rider.png: a proud cavalry
// captain — back straight, chin up, the spear couched forward over the wyrm's head, left fist on the reins. Applied to
// the boss rider instance only (bosses/_stance.js useClipSet → character 'boss_wyrm_rider'); every other clip falls
// through to the generic set as before.
import { dir, W, torso, pose, leg } from './_kit.js';
import { twoBeat, IDLE_R14 } from './_bossIdle.js';   // C2 r15: two-beat idle (&bossidle=r14 = old)

const LEGS = (d = 0) => pose(
  leg('L', { thigh: [0.65, -0.45 - d * 0.01, -0.6], shin: [0.1 + d * 0.01, -1, -0.25], toe: [0.9, -0.3, -0.1] }),
  leg('R', { thigh: [0.65, -0.45 - d * 0.01, 0.6], shin: [0.1 + d * 0.01, -1, 0.25], toe: [0.9, -0.3, 0.1] }));
const SEAT = (p = 0, d = 0) => pose(torso({ pitch: 4 + p, yaw: -6, look: 0.5, hp: 9 }), LEGS(d));
const LANCE = (e = 0) => W([0.44, -0.16, 0.42], dir(6, 22 + e), [0, 1, 0]);

export default {
  rig: 'humanoid', character: ['boss_wyrm_rider'], priority: 6,
  clips: {
    ride_idle: {
      frames: IDLE_R14 ? 90 : 180, loop: true, grip: 0,
      keys: !IDLE_R14 ? twoBeat(180, () => ({ pose: SEAT(), hips: [0, -0.9, 0], wpn: LANCE(), handL: [0.6, -0.38, -0.1] }), { sway: 0.012, rock: 0.01, rise: 0.008, pitch: 4, roll: 3, yaw: 5, head: 12, lift: 0.03, wpnSwing: 0.03 }) : [
        { f: 0, pose: SEAT(), hips: [0, -0.9, 0], wpn: LANCE(), handL: [0.6, -0.38, -0.1] },
        { f: 45, pose: SEAT(-1.5, 2), hips: [0, -0.905, 0], wpn: LANCE(-3), handL: [0.6, -0.4, -0.1] },
        { f: 90, pose: SEAT(), hips: [0, -0.9, 0], wpn: LANCE(), handL: [0.6, -0.38, -0.1] },
      ],
    },
  },
};
