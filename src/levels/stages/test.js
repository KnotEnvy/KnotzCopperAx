// Test stage: neutral lit grid for systems work (moveset/AI showcases fall back here). One screen, one wave.
export default {
  id: 'test',
  number: 0,
  name: 'Proving Grounds',
  subtitle: 'TEST',
  zBand: [-3, 3],
  extents: [-12, 24],
  playerStart: { x: -2, z: 0 },
  lighting: {
    sky: { top: '#2c3446', horizon: '#9a8a7a', bottom: '#2a2420', sunDir: [-0.4, 0.3, -1], sunColor: '#ffe0b0', sunGlow: 0.6 },
    sun: { color: '#fff0e0', intensity: 3.0, dir: [-0.4, 0.85, 0.5] },
    hemi: { sky: '#9aa8c0', ground: '#4a3a30', intensity: 0.6 },
    rim: { color: '#ffd0a0', intensity: 1.4, dir: [0.3, 0.5, -1] },
    fog: { color: '#6a625a', near: 40, far: 140 },
  },
  async build(ctx) {
    const { kit, THREE, group } = ctx;
    kit.ground(ctx, { x0: -40, x1: 60, z0: -40, z1: 14, colorA: '#4a4038', colorB: '#6a5e52', seed: 61, scale: 4 });
    const grid = new THREE.GridHelper(80, 80, 0x8a7a6a, 0x5a5048);
    grid.position.set(6, 0.01, 0); grid.material.opacity = 0.25; grid.material.transparent = true; group.add(grid);
    const band = new THREE.Mesh(new THREE.PlaneGeometry(36, 6), new THREE.MeshBasicMaterial({ color: '#c8a070', transparent: true, opacity: 0.06, depthWrite: false }));
    band.rotation.x = -Math.PI / 2; band.position.set(6, 0.012, 0); group.add(band);
    return {};
  },
  screens: [{ x: [-12, 24], waves: [{ spawns: [{ type: 'marauder', side: 'right', z: 0.5 }, { type: 'marauder', side: 'right', z: -0.7, delay: 40 }] }] }],
  next: 'title',
};
