// Landing / body-fall / slam ground impact. opts: { actor, speed, body (knocked-down body hits the floor), slam, bounce }
import { dustPuffs, dustRing, groundRing, sparkSpray } from './_lib.js';

export default {
  id: 'land_impact',
  spawn(vfx, o = {}) {
    const a = o.actor; if (!a) return;
    const gy = vfx.groundY(a), x = a.pos.x, z = a.pos.z;
    const sp = o.speed || 4;
    if (o.slam) {
      // air slam: ground shock + dust wall (hero element tint on the ring)
      const pal = vfx.palette(a);
      groundRing(vfx, x, gy, z, { radius: 2.2, color: [pal.hot, pal.tail], intensity: 1.2, life: 0.38 });
      groundRing(vfx, x, gy, z, { radius: 1.3, color: [pal.core, pal.mid], intensity: 0.9, life: 0.24, thick: [0.4, 0.08] });
      dustRing(vfx, x, gy, z, { radius: 2.0, alpha: 0.75, life: 0.95 });
      dustPuffs(vfx, x, gy, z, { n: 12, spread: 0.6, speed: [1.5, 4], up: [0.3, 1.2], size: [0.3, 1.0] });
      sparkSpray(vfx, { x, y: gy + 0.1, z: z + 0.1 }, { x: 0, y: 1, z: 0 }, { n: 10, speed: [4, 9], cone: 0.9, life: [0.15, 0.35], color: [pal.hot, pal.tail], gravity: 14, floor: gy + 0.02 });
      return;
    }
    if (o.body) {
      // knocked-down body: dust spread along the body (lying along X)
      const k = Math.min(1.4, sp / 7);
      const cx = x + (a.facing ? -a.facing * 0.35 : 0);
      dustRing(vfx, cx, gy, z, { radius: 0.8 + k * 0.45, alpha: 0.6, life: 0.8, stretchX: 1.6 });
      dustPuffs(vfx, cx, gy, z, { n: Math.round(6 + k * 5), spread: 0.5, speed: [0.6, 2.2 * k + 0.6], size: [0.25, 0.8], alpha: 0.55 });
      return;
    }
    // feet landing: puff ring (scaled by fall speed)
    const k = Math.min(1.3, sp / 8);
    dustRing(vfx, x, gy, z, { radius: 0.45 + k * 0.5, alpha: 0.5, life: 0.55 });
    dustPuffs(vfx, x, gy, z, { n: Math.round(3 + k * 5), spread: 0.2, speed: [0.8, 2.4 * k + 0.4], up: [0.1, 0.5], size: [0.16, 0.55], alpha: 0.5 });
  },
};
