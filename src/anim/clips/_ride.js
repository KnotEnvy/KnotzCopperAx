// Riding clip factory (private helper): per-hero ride_idle / ride_attack / mount / dismount with that hero's weapon
// carry. Rider origin = the saddle point; the pelvis sits on it, legs straddle the beast (same legs as humanoid_base).
//   rideSet({ carry, up, hit, follow, carryL?, handL? })  — W() goals for rest / wind-up / strike / follow-through;
//   carryL = left weapon goal for dual wielders (else the left fist holds the reins at handL).
import { pose, leg, torso, feet } from './_kit.js';

const SEAT = (d = 0) => pose(torso({ pitch: -10 - d }),
  leg('L', { thigh: [0.65, -0.45 - d * 0.01, -0.6], shin: [0.1 + d * 0.01, -1, -0.25], toe: [0.9, -0.3, -0.1] }),
  leg('R', { thigh: [0.65, -0.45 - d * 0.01, 0.6], shin: [0.1 + d * 0.01, -1, 0.25], toe: [0.9, -0.3, 0.1] }));

export function rideSet({ carry, up, hit, follow, carryL = null, handL = [0.55, -0.45, -0.1] }) {
  const left = carryL ? { wpnL: carryL } : { handL };
  const seat = (f, d = 0, x = {}) => ({ f, pose: SEAT(d), hips: [0, -0.9 - d * 0.005, 0], wpn: carry, ...left, ...x });
  return {
    ride_idle: { frames: 60, loop: true, grip: 0, keys: [seat(0), seat(30, 2), seat(60)] },
    ride_attack: {
      frames: 26, grip: 0,
      keys: [
        seat(0),
        { f: 5, ease: 'out', pose: pose(SEAT(), torso({ pitch: 8, yaw: -22, look: 1 })), wpn: up },
        { f: 8, ease: 'in', pose: pose(SEAT(), torso({ pitch: -24, yaw: 12, look: 0.9 })), wpn: hit },
        { f: 14, pose: pose(SEAT(), torso({ pitch: -26, yaw: 14, look: 0.9 })), wpn: follow },
        { ...seat(26), ease: 'inOut' },
      ],
      events: [{ f: 5, name: 'swing' }, { f: 8, name: 'impact' }],
    },
    mount: {
      frames: 24, grip: 0,
      keys: [
        { f: 0, pose: torso({ pitch: -6 }), hips: [0, -0.08, 0], ...feet([0.16, 0, -0.04, 0, 8], [-0.17, 0, 0.07, 0, 26]), wpn: carry, ...left },
        { f: 6, ease: 'out', pose: torso({ pitch: -24 }), hips: [0, -0.3, 0], ...feet([0.26, 0, -0.05, 0, 6], [-0.26, 0, 0.09, 0, 30]) },
        { f: 14, ease: 'out', pose: pose(torso({ pitch: -6 }), leg('L', { thigh: [0.4, -0.8, -0.3], shin: [-0.3, -1, -0.2] }), leg('R', { thigh: [0.1, 0.3, 0.9], shin: [0.2, -0.5, 0.9] })), hips: [0, -0.4, 0] },
        { ...seat(24), ease: 'inOut' },
      ],
    },
    dismount: {
      frames: 24, grip: 0,
      keys: [
        seat(0),
        { f: 8, ease: 'out', pose: pose(torso({ pitch: 4 }), leg('L', { thigh: [0.3, -0.9, -0.25], shin: [-0.3, -1, -0.2] }), leg('R', { thigh: [0.1, -0.9, 0.25], shin: [-0.4, -1, 0.2] })), hips: [0, -0.2, 0] },
        { f: 16, pose: torso({ pitch: -24 }), hips: [0.02, -0.28, 0], ...feet([0.26, 0, -0.05, 0, 6], [-0.26, 0, 0.09, 0, 30]) },
        { f: 24, ease: 'inOut', pose: torso({ pitch: -6 }), hips: [0, -0.08, 0], ...feet([0.16, 0, -0.04, 0, 8], [-0.17, 0, 0.07, 0, 26]), wpn: carry, ...left },
      ],
    },
  };
}
