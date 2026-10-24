// Named lighting/look presets (look-dev). A stage's `lighting` may say { base: '<name>', ...overrides } and
// Lighting.apply() deep-merges the overrides onto the named preset (which itself merges onto DEFAULT_LIGHTING).
// Art direction: Frazetta/Vallejo painted myth — warm key vs cool shadow, a hot rim from the sky side, luminous
// atmospheric distance, saturated but never monochrome. The red of a dusk lives in the SKY and FIRE, not in the grade.
export const PRESETS = {
  // Stage 1 — Ashen Wilds: blood-red dusk over a burned village. Sun low ahead-right; violet zenith; smoke haze.
  'ashen-dusk': {
    // Value structure (r2): SKY + FIRE carry the saturated warm; the fight belt is a dark, cool ash grey-violet;
    // combatants are lifted by an actor-only key + a pixel-width sun-gold silhouette rim, so every fighter reads as a
    // lit shape against a darker, cooler ground (≥ 3:1). Distance falls off into blue-violet haze (cool counter-colour).
    sky: {
      zenith: '#0a0a1e', top: '#2c1432', horizon: '#9a2222', horizonSun: '#ff5418', bottom: '#1a0c0e',
      sunDir: [0.3, 0.058, -1], sunColor: '#ff5e24', sunDisc: '#ffc27a', sunDiscIntensity: 11, sunSize: 0.017, sunGlow: 1.35, hazeHeight: 0.34,
      clouds: { cover: 0.62, color: '#1e0c16', lit: '#ff4a22', scale: 1, speed: 0.0025, opacity: 0.95, band: [0.0, 0.035, 0.28, 0.62], stretch: [0.28, 1] },
    },
    sun: { color: '#ffd6b4', intensity: 2.3, dir: [0.64, 0.66, 0.3], shadow: true, radius: 4, frustum: [-17, 17, 15, -11] },
    fill: { color: '#4a58d0', intensity: 0.42, dir: [-0.7, 0.3, 0.65] },
    hemi: { sky: '#464a92', ground: '#16121a', intensity: 0.5 },
    rim: { color: '#ff6a2a', intensity: 0.7, dir: [0.35, 0.06, -1] },
    fog: { color: '#2e3050', near: 30, far: 320,
      height: { density: 0.034, base: 0, falloff: 0.3, start: 22, max: 0.74, color: '#3c3a5c' },
      sun: { color: '#ff6a2e', strength: 0.4, power: 20 },
      depthGrade: { start: 2.5, end: 25, dim: 0.46, desat: 0.45, tint: '#4c4c86' } },
    env: { intensity: 0.1 },
    exposure: 1.0,
    tonemap: 'agx',
    grade: { saturation: 1.02, contrast: 1.2, vibrance: 0.1, lift: [0.0, 0.0, 0.01], gamma: [1, 1, 1.03], gain: [1.02, 1.0, 0.98],
      shadowTint: [0.38, 0.44, 0.7], highlightTint: [0.6, 0.5, 0.4], split: 0.34 },
    bloom: { intensity: 1.05, threshold: 1.2, smoothing: 0.35, radius: 0.75 },
    vignette: { offset: 0.3, darkness: 0.5 }, // r4: lighter corners so edge-of-screen fighters keep ≥3:1
    grain: 0.02,
    // r3: rim is DIRECTIONAL (key side only, no floor) and near-white-warm; the actor key is near-neutral so each
    // fighter keeps its local colour (red Brann / blue-violet Seraphine / tiered marauders) instead of all gilding.
    character: { rim: '#ffdcb0', intensity: 0.35, power: 3.0, floor: 0.08, base: 0.0, edge: 2.8, width: 2.6, maxNdv: 0.6,
      key: { color: '#fff3e8', intensity: 3.25, wrap: 0.35, dir: [0.78, 0.52, 0.36], albedoFloor: 0.3, albedoLiftMax: 4, specMax: 2, metalAmbient: 2.1 },
      ambient: '#a0a6d0', ambientIntensity: 0.5, clamp: { knee: 0.65, max: 1.0 } },
    wind: { dir: [1, 0.12], strength: 0.7, gust: 1 },
  },
  // Stage 2 — Shellback Crossing: misty lake morning, soft cool key, jade haze.
  'misty-lake': {
    sky: { zenith: '#3a5a7a', top: '#7a9ab0', horizon: '#c8d0c0', horizonSun: '#ffe0b0', bottom: '#3a4a44', sunDir: [-0.4, 0.25, -1], sunColor: '#ffe2b0', sunGlow: 0.8, hazeHeight: 0.5,
      clouds: { cover: 0.4, color: '#8a9aa8', lit: '#fff0d0', band: [0.02, 0.1, 0.4, 0.8] } },
    sun: { color: '#fff0d8', intensity: 2.4, dir: [-0.45, 0.75, 0.5] },
    fill: { color: '#8ab0c8', intensity: 0.5, dir: [0.6, 0.3, 0.7] },
    hemi: { sky: '#a0b8c8', ground: '#3a4a3a', intensity: 0.6 },
    rim: { color: '#ffe8c0', intensity: 2.0, dir: [-0.3, 0.4, -1] },
    fog: { color: '#9aaaa8', near: 20, far: 200, height: { density: 0.08, falloff: 0.35, start: 14, max: 0.9, color: '#b0c0b8' }, sun: { color: '#ffe8c0', strength: 0.6, power: 8 } },
    grade: { saturation: 1.1, contrast: 1.04, shadowTint: [0.44, 0.5, 0.54], highlightTint: [0.56, 0.52, 0.46], split: 0.14 },
    character: { rim: '#fff0d0', intensity: 0.7 },
  },
  // Stage 3 — Eaglespine Skies: high bright afternoon above clouds.
  'sky-high': {
    sky: { zenith: '#2a58a8', top: '#5a8ad0', horizon: '#d8e4f0', horizonSun: '#fff4d8', bottom: '#8aa0b8', sunDir: [0.5, 0.45, -1], sunColor: '#fff0d0', sunGlow: 0.9, hazeHeight: 0.6,
      clouds: { cover: 0.5, color: '#9aaccc', lit: '#ffffff', band: [-0.05, 0.02, 0.35, 0.8] } },
    sun: { color: '#fff4e0', intensity: 3.2, dir: [0.45, 0.8, 0.4] },
    fill: { color: '#9ab8e8', intensity: 0.5, dir: [-0.6, 0.3, 0.7] },
    hemi: { sky: '#a8c4f0', ground: '#6a6a78', intensity: 0.6 },
    rim: { color: '#fff0d8', intensity: 2.2, dir: [0.3, 0.4, -1] },
    fog: { color: '#b8c8e0', near: 40, far: 420, sun: { color: '#fff0d8', strength: 0.5, power: 8 } },
    grade: { saturation: 1.12, contrast: 1.06 },
  },
  // Stage 4 — Serpent Keep Gates: midnight storm, cold moon key, warm torch pools.
  'storm-night': {
    sky: { zenith: '#05070e', top: '#101828', horizon: '#2a3448', horizonSun: '#4a5a78', bottom: '#06080c', sunDir: [-0.3, 0.35, -1], sunColor: '#8aa0d0', sunDisc: '#c8d8ff', sunDiscIntensity: 3, sunSize: 0.02, sunGlow: 0.4, hazeHeight: 0.5,
      clouds: { cover: 0.75, color: '#0c1018', lit: '#3a4a6a', band: [-0.02, 0.05, 0.6, 1.0] }, stars: 0.3 },
    sun: { color: '#8aa4e0', intensity: 1.4, dir: [-0.4, 0.8, 0.45] },
    fill: { color: '#3a4a80', intensity: 0.35, dir: [0.6, 0.3, 0.7] },
    hemi: { sky: '#34406a', ground: '#1a1410', intensity: 0.4 },
    rim: { color: '#9ab4ff', intensity: 2.6, dir: [-0.3, 0.4, -1] },
    fog: { color: '#141a28', near: 18, far: 140, height: { density: 0.04, falloff: 0.3, start: 14, max: 0.8, color: '#1e2638' } },
    grade: { saturation: 1.05, contrast: 1.12, lift: [0.0, 0.006, 0.02], shadowTint: [0.4, 0.46, 0.62], highlightTint: [0.6, 0.52, 0.42], split: 0.22 },
    character: { rim: '#a8c0ff', intensity: 1.0 },
  },
  // Stage 5 — Throne of Coils: obsidian hall, green witchfire key, purple shadow.
  'witchfire-hall': {
    sky: { zenith: '#050408', top: '#0a0810', horizon: '#141018', bottom: '#050406', sunGlow: 0, sunDiscIntensity: 0 },
    sun: { color: '#8aff9a', intensity: 1.6, dir: [0.3, 0.9, 0.4] },
    fill: { color: '#6a3a9a', intensity: 0.5, dir: [-0.6, 0.3, 0.7] },
    hemi: { sky: '#3a2a4a', ground: '#0a120a', intensity: 0.35 },
    rim: { color: '#60ff80', intensity: 2.4, dir: [0.2, 0.5, -1] },
    fog: { color: '#0a0c10', near: 16, far: 90, height: { density: 0.06, falloff: 0.5, start: 10, max: 0.7, color: '#10201a' } },
    grade: { saturation: 1.1, contrast: 1.14, shadowTint: [0.46, 0.4, 0.6], highlightTint: [0.46, 0.6, 0.44], split: 0.2 },
    character: { rim: '#90ffa8', intensity: 0.9 },
  },
  // Thieves' Night camp: starry night, campfire key.
  'camp-night': {
    sky: { zenith: '#04060e', top: '#0e1630', horizon: '#26304e', horizonSun: '#3a4468', bottom: '#060608', sunDir: [0.2, 0.5, -1], sunColor: '#90a8e0', sunDisc: '#e0e8ff', sunDiscIntensity: 2.5, sunSize: 0.03, sunGlow: 0.3, stars: 1 },
    sun: { color: '#8aa0d8', intensity: 0.9, dir: [-0.3, 0.8, 0.4] },
    fill: { color: '#2a3460', intensity: 0.3, dir: [0.6, 0.3, 0.7] },
    hemi: { sky: '#26305a', ground: '#140e0a', intensity: 0.35 },
    rim: { color: '#7890d0', intensity: 1.6, dir: [0.2, 0.5, -1] },
    fog: { color: '#0e1220', near: 20, far: 120 },
    grade: { saturation: 1.02, contrast: 1.1, split: 0.22 },
  },
};
