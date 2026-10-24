// Perfect dodge: two floor-hugging elliptical rings and low motes, retired by 140ms.
// A restrained chromatic pulse accompanies the Hero's own slow-mo. opts: { actor } or { pos }
export default {
  id: 'time_ripple',
  spawn(vfx, o = {}) {
    const a = o.actor, r = vfx.rng;
    const gy = a ? vfx.groundY(a) : 0;
    const p = a ? { x: a.pos.x, y: gy + (a.height || 1.8) * 0.55, z: a.pos.z + 0.2 } : (o.pos || { x: 0, y: 1, z: 0 });
    const pos = [p.x, gy + .03, p.z];
    // Two low cyan/magenta rings cannot surround nearby contacts as a vertical dome.
    vfx.shape.emit({ shape: 'ring', mode: 'plane', pos, size: [2.2, 1.35], life: 0.14, color: ['#bff4ff', '#4a9cff'], intensity: 1.1, ease: 'out', p0: [0.06, 0.03, 0.09, 0.8], p1: [0.95, 0.012, 0.14, 0.4] });
    vfx.shape.emit({ shape: 'ring', mode: 'plane', pos, size: [2.45, 1.5], life: 0.11, delay: 0.025, color: ['#ffc8f4', '#a040ff'], intensity: 0.55, ease: 'out', p0: [0.05, 0.025, 0.09, 0.5], p1: [0.93, 0.01, 0.14, 0.2] });
    vfx.shape.emit({ shape: 'glow', pos, mode: 'plane', size: [.9, .6], life: .08, color: ['#e8fbff', '#6ab0ff'], intensity: 0.9, p0: [3, 0.6] });
    for (let i = 0; i < Math.round(14 * vfx.scale); i++) {
      const ang = r.range(0, Math.PI * 2), rad = r.range(0.35, 0.8);
      vfx.add.emit({ pos: [p.x + Math.cos(ang) * rad, gy + .07, p.z], vel: [-Math.sin(ang) * 1.6, .15, 0], life: r.range(.08,.14), size: [0.05, 0.015], color: ['#e8fbff', '#4a8cff'], intensity: 2.5, shape: 'ember', drag: 2 });
    }
    const post = vfx.game.renderer && vfx.game.renderer.post;
    if (post) post.pulse({ ca: .00045, desat: .18, duration: .14 });
  },
};
