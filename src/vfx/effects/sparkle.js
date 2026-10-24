// Small glint/sparkle (pickup glints, UI anchors). opts: { pos, color, count }. count ≥ 10 = a collect burst.
export default {
  id: 'sparkle',
  spawn(vfx, o = {}) {
    const r = vfx.rng, p = o.pos || { x: 0, y: 1, z: 0 };
    const c = o.color || '#9fd8ff';
    const n = o.count ?? 8;
    const burst = n >= 10;
    vfx.add.emit({ pos: [p.x + r.range(-0.08, 0.08), p.y + r.range(-0.05, 0.1), p.z + 0.12], life: burst ? 0.3 : 0.45, size: burst ? [0.8, 0.2] : [0.05, 0.42], color: ['#ffffff', c], intensity: burst ? 2 : 1.6, shape: 'glint', rot: r.range(-0.15, 0.15), spin: burst ? 0 : 0.6 });
    if (burst) vfx.shape.emit({ shape: 'ring', pos: [p.x, p.y, p.z + 0.1], size: [1.1, 1.1], life: 0.3, color: ['#ffffff', c], intensity: 0.9, p0: [0.15, 0.2, 0, 1], p1: [0.95, 0.03, 0, 1] });
    for (let i = 0; i < Math.round(n * vfx.scale); i++) {
      const a = r.range(0, Math.PI * 2), sp = burst ? r.range(1, 2.6) : r.range(0.2, 0.7);
      vfx.add.emit({ pos: [p.x, p.y, p.z + 0.1], vel: [Math.cos(a) * sp, Math.sin(a) * sp * 0.8 + (burst ? 0.8 : 0.4), 0], life: r.range(0.35, 0.7), size: [0.045, 0.012], color: ['#ffffff', c], intensity: 2.6, shape: 'ember', gravity: burst ? 2.5 : -0.4, drag: 2 });
    }
  },
};
