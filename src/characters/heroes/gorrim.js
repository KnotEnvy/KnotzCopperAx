// Gorrim Knotbeard: dwarf axeman, power/grapples, the Copper Ax, STORM magic (3 levels). Small hurtbox.
export default {
  id: 'gorrim',
  name: 'Gorrim Knotbeard',
  title: 'Keeper of the Copper Ax',
  asset: 'hero_gorrim',
  moveset: 'gorrim',
  height: 1.38,
  weapon: 'copperax',
  proportions: {
    hipY: 0.62, pelvisW: 0.14, spineY: 0.72, chestY: 0.88, neckY: 1.09, headY: 1.13, headR: 0.13,
    shoulderW: 0.3, shoulderY: 1.03, upperArm: 0.26, foreArm: 0.23, hand: 0.16, ankleY: 0.07, footLen: 0.24,
    chestR: [0.31, 0.24], waistR: [0.28, 0.22], hipR: [0.25, 0.19],
    upperArmR: 0.092, foreArmR: 0.082, thighR: 0.115, shinR: 0.092, neckR: 0.095,
  },
  palette: { skin: '#c98a66', hair: '#b4461c', cloth: '#4a3a2c', armor: '#6c6f76', leather: '#3e2a1c', boots: '#2a1d14', metal: '#7d7f86', accent: '#d09a3a', eyes: '#16100c' },
  style: { hair: 'none', beard: true, helm: 'horned', armor: 'chain', bracers: 'metal', pants: true },
  stats: { hp: 48, defense: 0.85, speed: 0.85, jumpApex: 1.75, depthSpeed: 0.7, weight: 1.4, radius: 0.38, hurt: { h: 1.25 } },
  // 4 pots: T1 = 1, T2 = 2–3, T3 = 4.
  magic: { element: 'storm', spell: 'gorrim', pots: 4, tiers: [1, 2, 4], maxTier: 3, color: '#8fd0ff' },
  ui: { color: '#6fb0e0', initial: 'G', blurb: 'Raw power, throws and a tiny hurtbox. The Copper Ax. Storm magic (3 levels).' },
};
