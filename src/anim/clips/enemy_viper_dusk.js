// Viper Maiden — DUSK tier (the deadliest regular): lower, slower coil, longer stalk (C2 r6 per-tier variation).
// Only idle / walk / run differ; attacks come from enemy_viper.js (same frames).
import { viperSet } from './_viper.js';

const S = viperSet({ crouch: -0.26, lean: -21, blade: -16, headUp: 9, sway: 0.75, stride: 1.12, walkCrouch: -0.2, runLean: -27 });

export default {
  rig: 'humanoid', character: ['viper_dusk'], priority: 6,
  clips: { idle: S.idle, walk: S.walk, run: S.run },
};
