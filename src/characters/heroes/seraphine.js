// Seraphine Vey: agile blade-dancer, speed/air, twin sabres Dawn & Dusk, FIRE magic (6 levels).
export default {
  id: 'seraphine',
  name: 'Seraphine Vey',
  title: 'The Ember Blade-Dancer',
  asset: 'hero_seraphine',
  moveset: 'seraphine',
  height: 1.76,
  weapon: 'sabre',
  weaponL: 'sabre',
  proportions: {
    hipY: 0.95, pelvisW: 0.1, spineY: 1.05, chestY: 1.22, neckY: 1.44, headY: 1.51, headR: 0.108,
    shoulderW: 0.19, shoulderY: 1.38, upperArm: 0.29, foreArm: 0.26, hand: 0.16, ankleY: 0.08, footLen: 0.23,
    chestR: [0.165, 0.12], waistR: [0.125, 0.1], hipR: [0.16, 0.12],
    upperArmR: 0.047, foreArmR: 0.04, thighR: 0.078, shinR: 0.054, neckR: 0.048,
  },
  palette: { skin: '#e2b08c', hair: '#8a2e17', cloth: '#3a2a22', cloth2: '#b3202a', armor: '#2c5a50', leather: '#4a2e1e', boots: '#3b2418', metal: '#b6a77c', accent: '#e0b44a', eyes: '#1e3a2a' },
  style: { hair: 'braid', helm: 'circlet', armor: 'scale', sash: true, bracers: 'leather', pants: false },
  stats: { hp: 48, defense: 1.1, speed: 1.2, jumpApex: 2.45, depthSpeed: 0.78, weight: 0.85, radius: 0.32, airControl: 6 },
  // 9 pots: T1 = 1–4, T2 = 5, T3 = 6, T4 = 7, T5 = 8, T6 = 9.
  magic: { element: 'fire', spell: 'seraphine', pots: 9, tiers: [1, 5, 6, 7, 8, 9], maxTier: 6, color: '#ff7a30' },
  ui: { color: '#e0503a', initial: 'S', blurb: 'Speed and air combos. Twin sabres. Fire magic (6 levels).' },
};
