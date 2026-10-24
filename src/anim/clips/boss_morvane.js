// Boss clip set (bosses agent): Morvane Deathcoil + Iron Chancellor Varkhul reuse Brann's two-handed heavy-weapon
// grammar (big wind-ups, pelvis-driven arcs — hero_brann.js) re-timed by the boss move data, plus boss-only clips:
//   crouch_plant  deep crouch, off hand slams the floor (plants the homing spark; the vulnerable window)
//   summon        great weapon raised overhead in both hands (skeleton / knight summons)
//   cast          off hand thrust forward, weapon low (shadow magic, stolen spell)
//   flail_spin    one-handed overhead flail wind (Varkhul)
// and 'captive_hang' for the chained captives (character 'boss_captive').
import brann from './hero_brann.js';
import { dir, W, torso, feet, arm, leg, pose } from './_kit.js';

const ST = feet([0.26, 0, -0.04, 0, 6], [-0.26, 0, 0.09, 0, 30]);
const ST_WIDE = feet([0.36, 0, -0.08, 0, 5], [-0.3, 0, 0.14, 0, 36]);
const G = { pose: torso({ pelvis: -14, yaw: 6, pitch: -8, look: 0.9 }), hips: [0, -0.1, 0], ...ST, wpn: W([0.45, -0.3, 0.1], dir(-12, 38), [0, 0.2, 1]), grip: 1 };
const g = (f, extra = {}) => ({ f, ...G, ...extra });

const CROUCH = {
  pose: pose(torso({ pelvis: -6, yaw: -10, pitch: -38, look: 1.0 }), arm('L', { upper: [0.75, -0.62, -0.18], fore: [0.55, -0.83, -0.05] })),
  hips: [0, -0.4, 0], ...ST_WIDE, wpn: W([-0.05, -0.55, 0.4], dir(172, -18), [0, 1, 0]), grip: 0,
};
const RAISE = { pose: torso({ pelvis: 4, yaw: 0, pitch: 14, look: 0.6 }), hips: [0, -0.06, 0], ...ST_WIDE, wpn: W([0.12, 0.62, 0.02], dir(0, 86), [1, 0, 0]), grip: 1 };
const CAST = {
  pose: pose(torso({ pelvis: -10, yaw: 24, pitch: -6, look: 1.0 }), arm('L', { upper: [1, 0.12, -0.1], fore: [1, 0.2, 0.02] })),
  hips: [0, -0.14, 0], ...ST_WIDE, wpn: W([0.1, -0.55, 0.32], dir(-25, -52), [0, 0, 1]), grip: 0,
};

const HANG = pose(
  { spine: [0, 0, 4], chest: [0, 0, 6], head: [0, 0, -28] },
  arm('L', { upper: [0.05, 1, -0.18], fore: [0.02, 1, -0.05] }), arm('R', { upper: [0.05, 1, 0.18], fore: [0.02, 1, 0.05] }),
  leg('L', { thigh: [0.12, -1, -0.04], shin: [-0.08, -1, 0] }), leg('R', { thigh: [0.02, -1, 0.05], shin: [-0.12, -1, 0] }),
);

export default {
  rig: 'humanoid', character: ['boss_morvane', 'boss_varkhul', 'boss_captive'], priority: 12,
  clips: {
    ...brann.clips,
    crouch_plant: {
      frames: 100, loop: false,
      keys: [g(0), { f: 16, ease: 'in', ...CROUCH, hips: [0, -0.3, 0] }, { f: 22, ease: 'outExpo', ...CROUCH }, { f: 72, ...CROUCH, hips: [0, -0.38, 0] },
        { f: 100, ease: 'inOut', ...G }],
      events: [{ f: 22, name: 'plant' }],
    },
    summon: {
      frames: 81, loop: false,
      keys: [g(0), { f: 12, ease: 'in', ...G, hips: [0, -0.18, 0] }, { f: 26, ease: 'outBack', ...RAISE }, { f: 56, ...RAISE, hips: [0, -0.04, 0] }, { f: 81, ease: 'inOut', ...G }],
    },
    cast: {
      frames: 69, loop: false,
      keys: [g(0), { f: 14, ease: 'in', ...CAST, pose: pose(torso({ pelvis: -14, yaw: -10, pitch: -10 }), arm('L', { upper: [0.2, -0.5, -0.8], fore: [0.5, 0.4, -0.6] })) },
        { f: 24, ease: 'outExpo', ...CAST }, { f: 48, ...CAST }, { f: 69, ease: 'inOut', ...G }],
    },
    flail_spin: {
      frames: 60, loop: false,
      keys: [g(0), { f: 20, ease: 'inOut', ...G, grip: 0, pose: torso({ pelvis: -20, yaw: -30, pitch: 4 }), wpn: W([0.1, 0.5, 0.3], dir(-60, 70), [0, 1, 0]) },
        { f: 40, ease: 'inOut', ...G, grip: 0, pose: torso({ pelvis: 10, yaw: 30, pitch: 4 }), wpn: W([0.3, 0.55, -0.2], dir(60, 70), [0, 1, 0]) },
        { f: 60, ease: 'inOut', ...G }],
    },
    captive_hang: {
      frames: 160, loop: true,
      keys: [{ f: 0, pose: HANG }, { f: 80, ease: 'inOut', pose: pose(HANG, { spine: [3, 0, 2], head: [0, 8, -24] }) }, { f: 160, ease: 'inOut', pose: HANG }],
    },
  },
};
