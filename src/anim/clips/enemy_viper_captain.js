// Viper Maiden — CAPTAIN (the Wyrm Rider on foot): more upright and commanding — shallower crouch, chin up, the spear
// carried higher with the tip pointed at the heroes, a shorter, squarer stride (C2 r6 per-tier variation). Also bound
// to 'boss_wyrm_rider' (the id bosses/_stance.js switches her to): her ride_idle (boss_wyrm_rider.js, priority 6) has
// no idle/walk/run, so these fill the dismounted fight. Attacks come from enemy_viper.js.
import { viperSet } from './_viper.js';

const S = viperSet({ crouch: -0.13, lean: -9, blade: -4, headUp: 10, sway: 0.8, stride: 0.85, walkCrouch: -0.11, runLean: -20, spearHigh: 0.6 });

export default {
  rig: 'humanoid', character: ['viper_captain', 'boss_wyrm_rider'], priority: 6,
  clips: { idle: S.idle, walk: S.walk, run: S.run },
};
