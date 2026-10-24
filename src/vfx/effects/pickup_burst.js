// Pickup collect burst. opts: { hero, kind: 'pot'|'food', amount }
//   pot  → blue magic motes spiral INTO the hero + ground ring + chest glint
//   food → warm green-gold motes and plus-glints rising around the body (heal)
export default {
  id: 'pickup_burst',
  spawn(vfx, o = {}) {
    const h = o.hero; if (!h) return;
    const r = vfx.rng, gy = vfx.groundY(h);
    const H = h.height || 1.8;
    const pot = o.kind !== 'food';
    const c0 = pot ? '#e4f4ff' : '#f4ffe0', c1 = pot ? '#3a8cff' : '#6ad040', mid = pot ? '#8fc8ff' : '#c8f080';
    vfx.shape.emit({ shape: 'ring', mode: 'plane', pos: [h.pos.x, gy + 0.03, h.pos.z], size: [2, 2], life: 0.45, color: [mid, c1], intensity: 0.9, p0: [0.12, 0.2, 0.3, 1], p1: [0.9, 0.03, 0.3, 1] });
    const chest = [h.pos.x, gy + H * 0.62, h.pos.z + 0.2];
    vfx.add.emit({ pos: chest, life: 0.3, delay: 0.32, size: [0.7, 0.2], color: ['#ffffff', mid], intensity: 1.6, shape: 'glint' });
    vfx.shape.emit({ shape: 'glow', pos: chest, size: [0.8, 0.8], life: 0.3, delay: 0.3, color: [c0, c1], intensity: 0.7, p0: [3, 0.5] });
    const N = Math.round(18 * vfx.scale);
    for (let i = 0; i < N; i++) {
      if (pot) {
        const a = (i / N) * Math.PI * 2, rad = r.range(0.7, 1.0), y = gy + r.range(0.1, 1.2);
        vfx.add.emit({ pos: [h.pos.x + Math.cos(a) * rad, y, h.pos.z + Math.sin(a) * rad * 0.5], vel: [-Math.cos(a) * 2.4 - Math.sin(a) * 1.6, 1.6, (-Math.sin(a) * 2.4 + Math.cos(a) * 1.6) * 0.5], life: 0.38, size: [0.06, 0.02], color: [c0, c1], intensity: 3, shape: 'ember', drag: 1.5, delay: r.range(0, 0.08) });
      } else {
        const a = r.range(0, Math.PI * 2), plus = i % 4 === 0;
        vfx.add.emit({ pos: [h.pos.x + Math.cos(a) * 0.4, gy + r.range(0.1, H * 0.8), h.pos.z + Math.sin(a) * 0.2 + 0.1], vel: [r.range(-0.2, 0.2), r.range(0.8, 1.8), 0], life: r.range(0.5, 0.9), size: plus ? [0.16, 0.04] : [0.05, 0.02], color: [c0, c1], intensity: plus ? 1.8 : 2.6, shape: plus ? 'glint' : 'ember', drag: 1.2, delay: r.range(0, 0.2) });
      }
    }
  },
};
