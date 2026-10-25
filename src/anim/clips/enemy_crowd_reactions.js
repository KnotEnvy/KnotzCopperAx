// Crowd-only reactions, explicitly requested by CrowdDirector (no existing combat/art clips overridden).
// Reference: docs/refs/c2/ai/crowd_reaction_poses.png. +X forward, +Y up, +Z right.
// Strong held outlines at the game camera: shield above head / folded fear / overhead roar / low brace / lifted sidestep.
import { torso, feet, W, dir, pose, arm, leg } from './_kit.js';

const stance = feet([.19, 0, -.12, 0, 8], [-.22, 0, .12, 0, 26]);
const neutral = { pose: torso({ pitch: -9, yaw: 4 }), hips: [0, -.09, 0], ...stance,
  wpn: W([.34, -.3, .4], dir(8, 48)), handL: [.32, -.25, -.34] };
const recoil = { pose: torso({ pitch: 32, pelvisPitch: 8, yaw: -14, hp: 18, look: .3 }), hips: [-.16, -.17, 0],
  ...feet([.42, .19, -.12, -20, 14], [-.38, 0, .12, 0, 30]),
  wpn: W([-.26, -.34, .42], dir(130, -28)), handL: [.18, .64, -.25] };
const fear = { pose: torso({ pitch: -39, pelvisPitch: 14, yaw: -12, hp: -20, look: .3 }), hips: [-.18, -.29, 0],
  ...feet([.26, 0, -.1, 0, 12], [-.35, 0, .12, 0, 32]),
  wpn: W([.35, -.72, .35], dir(16, -43)), handL: [.38, -.02, -.23] };
const rally = { pose: torso({ pitch: 13, pelvisPitch: -5, yaw: 10, hp: 27, look: .2 }), hips: [0, -.025, 0],
  ...feet([.31, 0, -.16, 0, 10], [-.34, 0, .16, 0, 32]),
  wpn: W([.02, 1.04, .4], dir(7, 78)), handL: [.14, -.27, -.45] };
const brace = { pose: torso({ pitch: -34, pelvisPitch: -7, yaw: -16, hp: -9, look: .75 }), hips: [-.06, -.48, 0],
  ...feet([.4, 0, -.14, 0, 12], [-.43, 0, .17, 0, 36]),
  wpn: W([.33, -.38, .4], dir(-15, 5)), handL: [.57, .15, -.1] };
const circleL = { pose: torso({ pitch: -16, yaw: -16, pelvis: 10, roll: -7, hp: -4 }), hips: [-.03, -.15, -.055],
  ...feet([.29, .18, -.18, -20, 12], [-.26, 0, .16, 0, 28]),
  wpn: W([.48, -.19, .35], dir(-28, 20)), handL: [.44, -.05, -.28] };
const circleR = { ...circleL, hips: [-.03, -.15, .055], ...feet([.26, 0, -.16, 0, 12], [-.29, .18, .18, -20, 28]) };
const held = (p, frames = 42) => ({ frames, plant: 0, look: .2, breathe: .15, keys: [
  { f: 0, ...neutral }, { f: 5, ease: 'outCubic', ...p }, { f: frames - 8, ...p }, { f: frames, ease: 'inOut', ...neutral },
] });
export default {
  rig: 'humanoid', priority: 5,
  clips: {
    // Compact bent-knee airborne silhouette, explicitly used for living marauders/skeletons only. No flight/root change.
    crowd_tumble: { frames: 40, plant: 0, look: 0, grip: 0, keys: [
      { f: 0, pose: pose(torso({ pitch: 22, pelvisPitch: 24, yaw: -12, look: .2 }),
        leg('L', { thigh: [.85, .1, -.2], shin: [-.6, -.7, -.15], toe: [.8, -.2, -.1] }),
        leg('R', { thigh: [.6, -.25, .22], shin: [-.55, -.75, .16], toe: [.8, -.2, .1] }),
        arm('L', { upper: [.25, .65, -.55], fore: [-.25, .85, -.3] }),
        arm('R', { upper: [.15, .5, .65], fore: [-.35, .8, .3], blade: [-.5, .75, .3] })), hips: [-.04, -.14, 0] },
      { f: 40, pose: pose(torso({ pitch: 30, pelvisPitch: 30, yaw: 8, look: .2 }),
        leg('L', { thigh: [.7, -.15, -.2], shin: [-.7, -.6, -.15], toe: [.8, -.3, -.1] }),
        leg('R', { thigh: [.85, .05, .22], shin: [-.65, -.7, .16], toe: [.8, -.2, .1] }),
        arm('L', { upper: [.3, .45, -.65], fore: [-.15, .85, -.3] }),
        arm('R', { upper: [.2, .4, .65], fore: [-.3, .8, .3], blade: [-.5, .75, .3] })), hips: [-.04, -.17, 0] },
    ] },
    crowd_recoil: held(recoil, 40), crowd_fear: held(fear, 45), crowd_rally: held(rally, 45), crowd_brace: held(brace, 40),
    crowd_circle: { frames: 48, loop: true, plant: 0, look: .6, keys: [
      { f: 0, ...circleR }, { f: 12, ease: 'inOut', ...circleL }, { f: 24, ...circleL },
      { f: 36, ease: 'inOut', ...circleR }, { f: 48, ...circleR },
    ] },
  },
};
