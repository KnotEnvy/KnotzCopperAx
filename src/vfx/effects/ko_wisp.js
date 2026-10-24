// KO: a pale soul-wisp rises from the fallen body after it lands, with a glint and a thin trail of motes.
// opts: { actor, delay (s, default 0.75) }
export default {
  id: 'ko_wisp',
  spawn(vfx, o = {}) {
    const a = o.actor; if (!a || (a.kind === 'hero' && !o.force)) return;
    const r = vfx.rng;
    vfx.delay(o.delay ?? 0.75, () => {
      const gy = vfx.groundY(a);
      const x0 = a.pos.x, z0 = a.pos.z + 0.1, y0 = gy + 0.35;
      const sway = r.range(0, 6.28), dirX = r.range(-0.3, 0.3);
      vfx.add.emit({ pos: [x0, y0, z0], life: 0.3, size: [0.5, 0.2], color: ['#e8f4ff', '#8ab4ff'], intensity: 1.4, shape: 'glint' });
      let acc = 0;
      vfx.emitter(1.3, (t, dt) => {
        const y = y0 + t * 2.1 + t * t * 0.6, x = x0 + Math.sin(sway + t * 7) * 0.18 * (1 - t) + dirX * t;
        const fade = t < 0.15 ? t / 0.15 : 1 - Math.max(0, (t - 0.55) / 0.45);
        acc += dt;
        if (acc >= 1 / 45) {
          acc = 0;
          vfx.add.emit({ pos: [x, y, z0], life: 0.12, size: [0.26 * fade + 0.02, 0.1], color: ['#f4faff', '#7aa8ff'], intensity: 1.3 * fade, shape: 'ember' });
          vfx.add.emit({ pos: [x + r.range(-0.03, 0.03), y - 0.05, z0], vel: [r.range(-0.2, 0.2), -0.5, 0], life: r.range(0.35, 0.6), size: [0.04, 0.01], color: ['#dcecff', '#4a6cff'], intensity: 2 * fade, shape: 'ember', drag: 2 });
        }
      });
    });
  },
};
