// Loudness plan: target PEAK (dBFS, pre-mixer, at volume 1) per sound. The engine measures every sound's raw peak once
// (calibrate(), offline) and stores meta.norm so the bank authors never hand-trim gains: weight = loudness.
// Order of weight: KO > heavy hit / heavy land / magic > light hit / whooshes > voices > UI > footsteps.
const EXACT = {
  hit_ko: -0.5, hit_heavy: -1.5, hit_otg: -2, body_impact: -2, hit_block: -3, body_fall: -3, hit_light: -4, hit_magic: -4.5, hit_slash: -9,
  grab: -8, throw: -4.5, charge: -10,
  whoosh_greatsword: -5, whoosh_greatsword_heavy: -3.5, whoosh_axe: -5, whoosh_axe_heavy: -3.5, whoosh_club: -5.5, whoosh_sabre: -7.5, whoosh_blade: -7, whoosh_fist: -9,
  magic_rise: -8, magic_earth: -1.5, magic_fire: -2, magic_storm: -1.5, impact_earth: -2, impact_fire: -2.5, impact_storm: -1.5,
  pickup_pot: -7, pickup_food: -7,
  step_dirt: -13, step_wood: -13, step_stone: -13, step_water: -12, jump: -12, land: -7, land_heavy: -3, dodge: -8, dodge_perfect: -2.5, splash: -2.5,
  ui_move: -13, ui_back: -13, ui_confirm: -7, ui_coin: -8, ui_ready: -4.5, go: -4.5, lock: -3.5, ui_tick: -11, ui_stamp: -4.5, boss_stinger: -2.5, player_down: -3, thief_cackle: -7,
  roar: -2, roar_cinderwyrm: -2.5, roar_emberdrake: -3.5, roar_stormroc: -3.5, roar_tusker: -4, roar_cluckhorn: -4.5,
};
const SUFFIX = { effort: -9, hurt: -7, death: -5, cry: -5 };

export function targetDb(name) {
  if (name in EXACT) return EXACT[name];
  const m = /^vo_[a-z]+_([a-z]+)$/.exec(name);
  if (m && m[1] in SUFFIX) return SUFFIX[m[1]];
  return -6;
}
