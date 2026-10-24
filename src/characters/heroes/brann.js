// Brann Stormhewn: barbarian swordsman, balanced (DESIGN.md §2).
// `proportions/palette/style` drive the procedural placeholder rig (used until public/assets/models/hero_brann.glb
// exists and passes the rig check). `asset` names the GLB. `moveset` names characters/movesets/<id>.js.
export default {
  id: 'brann',
  name: 'Brann Stormhewn',
  title: 'The Stormhewn Barbarian',
  asset: 'hero_brann',
  moveset: 'brann',
  height: 1.95,
  weapon: 'greatsword',
  proportions: {
    hipY: 1.0, pelvisW: 0.12, spineY: 1.12, chestY: 1.33, neckY: 1.6, headY: 1.67, headR: 0.125,
    shoulderW: 0.28, shoulderY: 1.52, upperArm: 0.34, foreArm: 0.3, hand: 0.19, ankleY: 0.09, footLen: 0.27,
    chestR: [0.27, 0.18], waistR: [0.19, 0.145], hipR: [0.2, 0.15],
    upperArmR: 0.08, foreArmR: 0.066, thighR: 0.11, shinR: 0.078, neckR: 0.08,
  },
  palette: { skin: '#a8683f', hair: '#15100d', cloth: '#5b3b26', fur: '#6e5a45', leather: '#3d2819', boots: '#2e2016', metal: '#8f8a84', accent: '#c28a3a', eyes: '#140c08' },
  style: { hair: 'mane', beard: false, helm: 'none', kilt: true, armor: 'harness', bracers: 'leather', pauldron: 'L', furShoulder: 'R' },
  // hp: 3 life bars × 16 (DESIGN §7). defense = incoming damage multiplier.
  stats: { hp: 48, defense: 1.0, speed: 1.0, jumpApex: 2.1, depthSpeed: 0.72, weight: 1.15, radius: 0.4 },
  // 6 pots; tiers[i] = pots needed for tier i+1 → T1 = 1–2, T2 = 3–4, T3 = 5, T4 = 6 (authentic GA thresholds).
  magic: { element: 'earth', spell: 'brann', pots: 6, tiers: [1, 3, 5, 6], maxTier: 4, color: '#e0a060' },
  ui: { color: '#d4814a', initial: 'B', blurb: 'Balanced power. Greatsword Grudgebrand. Earth magic (4 levels).' },
};
