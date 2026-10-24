// Dodge roll / sidestep dust: puffs trailing the roll for its first ~0.25 s. opts: { actor }
import { dustPuffs } from './_lib.js';

export default {
  id: 'dodge_dust',
  spawn(vfx, o = {}) {
    const a = o.actor; if (!a) return;
    let n = 0;
    vfx.emitter(0.3, (t) => {
      if (!a.grounded || a.removed) return;
      const want = Math.floor(t * 4);
      while (n <= want && n < 4) {
        n++;
        const vx = a.vel ? a.vel.x : 0;
        dustPuffs(vfx, a.pos.x, vfx.groundY(a), a.pos.z, { n: 3, spread: 0.12, speed: [0.3, 1.2], up: [0.1, 0.5], size: [0.14, 0.5], life: [0.4, 0.7], dir: vx ? -Math.sign(vx) : null, bias: 0.7, alpha: 0.45 });
      }
    });
  },
};
