// Pot Thief (loot enemy, DESIGN §4): gnome-imp with a huge sack. Visual fields by enemies-art-1 (asset, palette, style,
// proportions, tiers' asset/palette); behaviour + rules by enemies-ai (src/ai/behaviours/thief.js): runs in, cackles,
// keeps away, every kick spills loot, escapes off-screen. Camp/bonus mode: spawn with { steal: n } to pinch pots.
// Variants: tier 'blue' (default, magic pots) / 'green' (meat) select the sack GLB: spawnEnemy(game, 'thief', { tier: 'green' }).
export default {
  id: 'thief',
  name: 'Pot Thief',
  asset: 'enemy_thief',          // blue sack
  height: 1.0,
  hp: 14,
  speed: 3.4,
  radius: 0.28,
  weight: 0.55,
  weapon: 'none',
  behaviour: 'thief',
  passive: true,                 // not part of the crowd director's slots / tokens
  minHp: 1,                      // can't be killed, only robbed
  throwable: false,
  canRetreat: false,
  downTicks: 26, getupTicks: 18, getupInvuln: 14,
  enterSpeed: 1.6,
  loot: 'magic',                 // what a kick spills (data only; AI agent wires it)
  proportions: { shoulderW: 0.12, chestR: [0.11, 0.09], waistR: [0.11, 0.1], upperArmR: 0.03, foreArmR: 0.024, thighR: 0.05, headR: 0.13 },
  palette: { skin: '#dea280', hair: '#281e1a', cloth: '#b28432', leather: '#74502f', boots: '#46301f', accent: '#305cce', eyes: '#1a120c' },
  style: { hair: 'none', helm: 'hood', armor: 'rags', pants: true },
  ai: { sack: [2, 4], escapeAfter: 600, keep: [3.0, 4.4], stealBonus: 2 },
  moves: {},
  tiers: {
    blue: { asset: 'enemy_thief', loot: 'magic', palette: { accent: '#305cce' } },
    green: { asset: 'enemy_thief_green', loot: 'meat', palette: { accent: '#3e9634' } },
  },
  score: { hit: 20, ko: 100 },
};
