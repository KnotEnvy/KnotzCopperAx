// Viper Maiden (jade / crimson; also the base for every viper tier and the dismounted Wyrm Rider): the predatory
// serpent clip set from _viper.js — low coiled idle, stalking walk with hip/shoulder counter-rotation and the spear
// swinging through, low sprint, coil-and-thrust pokes, dive, tucked backflip, two-handed dash lunge. Heroes & Animation,
// C2 r6 (board r5: "stiff polearm infantry"). Tier variants: enemy_viper_dusk.js (lower), enemy_viper_captain.js
// (more upright / commanding) override idle + locomotion at priority 6; types/viper.js maps those tiers to the
// 'viper_dusk' / 'viper_captain' anim characters. 'boss_wyrm_rider' (bosses/_stance.js useClipSet) is listed so the
// boss falls through to these instead of the generic one-hander once she is off the wyrm (her ride_idle set wins at 6).
import { viperSet } from './_viper.js';

export default {
  rig: 'humanoid', character: ['viper', 'viper_dusk', 'viper_captain', 'boss_wyrm_rider'], priority: 5,
  clips: viperSet(),
};
