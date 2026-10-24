// Taunt for every humanoid — also the worked example in docs/ENGINE_API.md §6 (drop-in clip file, no index edits).
import { arm, leg, pose } from '../poseKit.js';

const PLANT = pose(leg('L', { thigh: [0.3, -1, -0.15], shin: [0, -1, -0.1] }), leg('R', { thigh: [-0.2, -1, 0.15], shin: [-0.3, -1, 0.1] }));

export default {
  rig: 'humanoid', priority: 5,                  // character: 'gorrim' → only Gorrim; higher priority wins
  clips: {
    taunt: {
      frames: 48, loop: false,                   // or duration: seconds; keys use f (frames) or t (seconds)
      keys: [
        { f: 0, pose: pose(PLANT, { spine: [0, 0, -5] }), hips: [0, -0.03, 0] },
        { f: 14, ease: 'outBack', pose: pose(PLANT,
            { spine: [0, 10, 8], chest: [0, 8, 6], head: [0, -10, 12] },                 // chest opens, chin up
            arm('R', { upper: [0.2, 1, 0.4], fore: [0.1, 1, 0.1], blade: [0, 1, 0], edge: [1, 0, 0] }),   // weapon to the sky
            arm('L', { upper: [0.3, -0.6, -0.8], fore: [0.9, 0.3, -0.3] })), hips: [0, 0.02, 0] },
        { f: 48, ease: 'inOut', pose: pose(PLANT, { spine: [0, 0, -5] }), hips: [0, -0.03, 0] },
      ],
      events: [{ f: 14, name: 'roar' }],         // → Animator listeners; 'footstep' and 'bodyfall' are forwarded to the bus
    },
  },
};
