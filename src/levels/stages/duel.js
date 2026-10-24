// Duel — endless gauntlet arena (the Genesis "Duel" analogue). Foundation baseline: ring arena + escalating waves.
const wave = (n) => ({ spawns: Array.from({ length: Math.min(4, 1 + Math.floor(n / 2)) }, (_, i) => ({ type: 'marauder', side: i % 2 ? 'left' : 'right', z: (i % 3 - 1) * 1.2, tier: ['straw', 'rust', 'violet', 'iron'][Math.min(3, Math.floor(n / 2))], delay: i * 25 })) });

export default {
  id: 'duel',
  number: 0,
  name: 'The Gauntlet',
  subtitle: 'DUEL',
  zBand: [-2.6, 2.6],
  extents: [-9, 9],
  playerStart: { x: -3, z: 0 },
  lighting: {
    sky: { top: '#140c10', horizon: '#6a3020', bottom: '#100808', sunDir: [0, 0.4, -1], sunColor: '#ff6a30', sunGlow: 0.8 },
    sun: { color: '#ffc090', intensity: 3.0, dir: [0.2, 0.9, 0.4] },
    hemi: { sky: '#6a4a50', ground: '#2a1410', intensity: 0.5 },
    rim: { color: '#ff8a50', intensity: 2.0, dir: [0, 0.5, -1] },
    fog: { color: '#2a1410', near: 20, far: 70 },
  },
  async build(ctx) {
    const { kit, THREE, group } = ctx;
    kit.ground(ctx, { x0: -30, x1: 30, z0: -30, z1: 12, colorA: '#3a2a1a', colorB: '#7a5a3a', seed: 51, scale: 8 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(10, 0.4, 8, 48), kit.mat('#5a4a3a'));
    ring.rotation.x = -Math.PI / 2; ring.scale.set(1, 0.4, 1); ring.position.y = 0.1; group.add(ring);
    return {};
  },
  screens: [{ x: [-9, 9], waves: Array.from({ length: 8 }, (_, n) => wave(n)) }],
  next: 'title',
};
