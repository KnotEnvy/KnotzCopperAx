// Asset manifest (ADDITIVE EDITS ONLY — art agents append entries; never remove others').
// Convention: an asset id X with no entry here loads /assets/models/X.glb. Entries override the URL or
// add metadata. If the GLB is missing or invalid, AssetLoader falls back to the procedural placeholder.
//
//   id: { url?, kind?: 'character'|'weapon'|'prop'|'mount'|'env', scale?, yaw? (deg, extra model yaw),
//         weapon?: '<asset id of weapon GLB>' | null, weaponL?: '<asset id>', notes? }
export default {
  hero_brann: { kind: 'character', weapon: 'weapon_grudgebrand' },
  hero_seraphine: { kind: 'character', weapon: 'weapon_dawn', weaponL: 'weapon_dusk' },
  hero_gorrim: { kind: 'character', weapon: 'weapon_copperax' },
  enemy_marauder: { kind: 'character', weapon: 'weapon_club', scale: 0.94 },
  enemy_dummy: { kind: 'character', weapon: null },
  // enemies-art-1: marauder tier GLBs (gear + palette per tier) and the Pot Thief sack variants
  // C2 r7: ranks differ in SIZE too (one shared rig/body; root scale, weapon scales with the hand socket) -- straw
  // lean grunt 0.94, rust 1.0, violet 1.05, iron 1.11; tier `height` in src/enemies/types/marauder.js matches
  enemy_marauder_straw: { kind: 'character', weapon: 'weapon_club', scale: 0.94 },
  enemy_marauder_rust: { kind: 'character', weapon: 'weapon_mace' },
  enemy_marauder_violet: { kind: 'character', weapon: 'weapon_mace_flanged', scale: 1.05 },
  enemy_marauder_iron: { kind: 'character', weapon: 'weapon_mace_spiked', scale: 1.11 },
  enemy_thief: { kind: 'character', weapon: null, notes: 'blue sack (magic pots)' },
  enemy_thief_green: { kind: 'character', weapon: null, notes: 'green sack (meat)' },
  // enemies-art-2: Grave Skeleton tiers (shield embedded in the mesh) + Hollow Knight ranks
  enemy_skeleton: { kind: 'character', weapon: 'weapon_sword_bone', notes: 'white' },
  enemy_skeleton_white: { kind: 'character', weapon: 'weapon_sword_bone' },
  enemy_skeleton_purple: { kind: 'character', weapon: 'weapon_sword_bone', notes: 'elite' },
  enemy_knight: { kind: 'character', weapon: 'weapon_halberd', notes: 'silver / Lt.' },
  enemy_knight_silver: { kind: 'character', weapon: 'weapon_halberd', notes: 'Lt.' },
  enemy_knight_red: { kind: 'character', weapon: 'weapon_halberd_red', notes: 'Col.' },
  enemy_knight_gold: { kind: 'character', weapon: 'weapon_halberd_gold', notes: 'Gen.' },
  weapon_halberd_red: { kind: 'weapon', notes: 'r23 crimson Colonel pennant' },
  weapon_halberd_gold: { kind: 'weapon', notes: 'r23 purple-gold General pennant' },
  // enemies-art-3: Ogre Brute hide tiers (Brute Brothers = green + red) + Viper Maiden tiers (+ Wyrm Rider captain)
  enemy_ogre: { kind: 'character', weapon: 'weapon_ogre_hammer', notes: 'green' },
  enemy_ogre_green: { kind: 'character', weapon: 'weapon_ogre_hammer' },
  enemy_ogre_red: { kind: 'character', weapon: 'weapon_ogre_hammer' },
  enemy_ogre_silver: { kind: 'character', weapon: 'weapon_ogre_hammer' },
  enemy_viper: { kind: 'character', weapon: 'weapon_whip_spear', notes: 'jade' },
  enemy_viper_jade: { kind: 'character', weapon: 'weapon_whip_spear' },
  enemy_viper_crimson: { kind: 'character', weapon: 'weapon_whip_spear' },
  enemy_viper_dusk: { kind: 'character', weapon: 'weapon_whip_spear' },
  enemy_viper_captain: { kind: 'character', weapon: 'weapon_whip_spear', notes: 'Wyrm Rider boss' },
  // bosses: knight-kit boss armour (blender/build_boss_armor.py, 2 m reference rig; the game scales it) + boss weapons
  boss_morvane: { kind: 'character', weapon: 'boss_morvane_axe', notes: 'Adder King, scaled to 3.0 m in game' },
  boss_varkhul: { kind: 'character', weapon: 'boss_varkhul_flail', notes: 'Iron Chancellor, 2.6 m; ball + chain at runtime' },
  boss_brute_gor: { kind: 'character', weapon: 'boss_brute_hammer_gor', notes: 'Brute Brothers: Gor the Anvil, 3.1 m native' },
  boss_brute_mog: { kind: 'character', weapon: 'boss_brute_hammer_mog', notes: 'Brute Brothers: Mog the Butcher, 3.0 m native' },
  boss_captain_patina: { kind: 'character', weapon: 'boss_captain_halberd_patina', notes: 'Hollow Knight Captains: Col. Patina, 3.0 m native' },
  boss_captain_oxide: { kind: 'character', weapon: 'boss_captain_halberd_oxide', notes: 'Hollow Knight Captains: Gen. Oxide, 3.1 m native' },
  // env: Stage 4 structural supplement (env-r33, blender/build_env_stage4_r33_structure.py), overlaid by name on env_stage4_kit
  env_stage4_r33_structure: { kind: 'env', url: '/assets/models/env_stage4_r33_structure.glb', notes: 'nine coursed-ashlar module replacements; donor kit keeps the rest' },
};
