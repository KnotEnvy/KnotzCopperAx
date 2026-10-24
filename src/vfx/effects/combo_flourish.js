// Combo milestone flourish (10/20/30/50… hits): rising ring of glints + a ground ring in the hero's element.
// opts: { actor, count, rank }
export default {
  id: 'combo_flourish',
  spawn(vfx, o = {}) {
    const h = o.actor; if (!h) return;
    const r = vfx.rng, pal = vfx.palette(h), gy = vfx.groundY(h), H = h.height || 1.8;
    const big = (o.count || 0) >= 30;
    vfx.shape.emit({ shape: 'ring', mode: 'plane', pos: [h.pos.x, gy + 0.03, h.pos.z], size: [big ? 3 : 2.4, big ? 3 : 2.4], life: 0.5, color: [pal.hot, pal.tail], intensity: 0.9, p0: [0.1, 0.25, 0.5, 1], p1: [0.93, 0.02, 0.5, 1] });
    const N = Math.round((big ? 16 : 10) * vfx.scale);
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2, g = i % 3 === 0;
      vfx.add.emit({ pos: [h.pos.x + Math.cos(a) * 0.7, gy + 0.2, h.pos.z + Math.sin(a) * 0.35], vel: [-Math.sin(a) * 1.2, r.range(2.2, 3.2), Math.cos(a) * 0.6], life: 0.6, size: g ? [0.22, 0.05] : [0.06, 0.02], color: ['#ffffff', pal.mid], intensity: g ? 1.8 : 2.6, shape: g ? 'glint' : 'ember', drag: 1.8, delay: i * 0.01 });
    }
    vfx.add.emit({ pos: [h.pos.x, gy + H * 1.08, h.pos.z + 0.2], life: 0.4, delay: 0.18, size: [0.9, 0.2], color: ['#ffffff', pal.glint], intensity: 1.6, shape: 'glint' });
  },
};
