// Heavy-charge level-up: glint star at the weapon tip + converging motes; level 3 adds a ground ring.
// opts: { actor, level }
export default {
  id: 'charge_glint',
  spawn(vfx, o = {}) {
    const h = o.actor; if (!h) return;
    const lv = o.level || 1, r = vfx.rng;
    const pal = vfx.palette(h);
    const gy = vfx.groundY(h);
    let p = { x: h.pos.x + h.facing * 0.35, y: gy + h.pos.y + (h.height || 1.8) * 0.72, z: h.pos.z + 0.15 };
    const tip = vfx.trails ? vfx.trails.tipOf(h, 'R') : null;
    if (tip) p = { x: tip.x, y: tip.y, z: tip.z + 0.1 };
    const s = 0.55 + lv * 0.25;
    vfx.shape.emit({ shape: 'star', pos: [p.x, p.y, p.z], size: [s, s], life: 0.22, rot: r.range(0, 0.4), spin: 2, color: ['#ffffff', pal.mid], intensity: 1.8 + lv * 0.3, p0: [4, 30, 1, 0.6], p1: [4, 50, 0.4, 0.2] });
    vfx.add.emit({ pos: [p.x, p.y, p.z], life: 0.25, size: [s * 0.9, s * 0.3], color: ['#ffffff', pal.glint], intensity: 1.5, shape: 'glint', rot: 0.785 });
    for (let i = 0; i < Math.round((6 + lv * 4) * vfx.scale); i++) {
      const a = r.range(0, Math.PI * 2), d = r.range(0.5, 0.9);
      vfx.add.emit({ pos: [p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, p.z], vel: [-Math.cos(a) * d * 4, -Math.sin(a) * d * 4, 0], life: 0.22, size: [0.045, 0.01], color: ['#ffffff', pal.mote], intensity: 3, shape: 'streak', stretch: 0.012, drag: 1 });
    }
    if (lv >= 3) vfx.shape.emit({ shape: 'ring', mode: 'plane', pos: [h.pos.x, gy + 0.03, h.pos.z], size: [2.2, 2.2], life: 0.35, color: [pal.hot, pal.tail], intensity: 0.8, p0: [0.1, 0.25, 0.4, 1], p1: [0.9, 0.03, 0.4, 1] });
    vfx.light(p, { color: pal.mid, intensity: 2 + lv, distance: 1.8, life: 0.15 });
  },
};
