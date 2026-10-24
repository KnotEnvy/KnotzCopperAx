// Thieves' Night pot/meat collect (bonus-camp r6): replaces the generic pickup_burst + 12-sparkle collect ring while
// the camp hunt runs (dozens of pots are scooped in a few seconds there). A small tick of light over the hero's
// shoulder, pushed behind the body, throttled per hero — never a ring over the fighter.
// opts: { hero, kind: 'pot'|'food' }
const last = new WeakMap();

export default {
  id: 'camp_collect',
  spawn(vfx, o = {}) {
    const h = o.hero; if (!h) return;
    const tick = (vfx.game && vfx.game.tick) || 0;
    const t0 = last.get(h);
    if (t0 != null && tick - t0 < 10 && tick >= t0) return;
    last.set(h, tick);
    const r = vfx.rng, gy = vfx.groundY(h), H = h.height || 1.8, f = vfx.camBasis().fwd;
    const pot = o.kind !== 'food';
    const c1 = pot ? '#6aa8ff' : '#7ad050', c0 = pot ? '#e4f4ff' : '#f0ffe0';
    const x = h.pos.x + f.x * 0.35 - (h.facing || 1) * 0.28, z = h.pos.z + f.z * 0.35, y = gy + H * 1.02;
    vfx.add.emit({ pos: [x, y, z], life: 0.22, size: [0.34, 0.07], color: [c0, c1], intensity: 1.3, shape: 'glint', rot: r.range(-0.2, 0.2) });
    for (let i = 0; i < 3; i++) {
      vfx.add.emit({ pos: [x + r.range(-0.12, 0.12), y - 0.1, z], vel: [r.range(-0.3, 0.3), r.range(0.9, 1.5), 0], life: r.range(0.3, 0.45), size: [0.035, 0.012],
        color: [c0, c1], intensity: 2.2, shape: 'ember', drag: 1.5, delay: i * 0.04 });
    }
  },
};
