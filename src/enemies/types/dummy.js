// Training dummy: straw-stuffed target for showcases/movesets. Never attacks, auto-refills HP, gets up.
export default {
  id: 'dummy',
  name: 'Training Dummy',
  asset: 'enemy_dummy',
  height: 1.8,
  hp: 60,
  minHp: 1, // never dies: showcases hit it forever
  speed: 0,
  radius: 0.34,
  weight: 1,
  behaviour: 'dummy',
  weapon: 'none',
  palette: { skin: '#b89a62', hair: '#8a6d3a', cloth: '#7a5b34', leather: '#5a4126', boots: '#4a3622', eyes: '#2a1d10', accent: '#9a7a40' },
  style: { hair: 'none', helm: 'hood', armor: 'rags', pants: true },
  ai: { refill: true },
  moves: {},
  score: { hit: 0, ko: 0 },
};
