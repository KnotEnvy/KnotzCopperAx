// Ground dust (terrain-tinted, LIT by the stage lights — sits in the grade, never white).
// opts: { pos:{x,y,z}, amount: 0..1.5, groundY, dir: ±1 (kick direction, e.g. behind a runner), kind: 'step'|'getup'|..., color }
import { dustPuffs, dustRing } from './_lib.js';

export default {
  id: 'dust',
  spawn(vfx, o = {}) {
    const p = o.pos || { x: 0, y: 0, z: 0 };
    const amt = o.amount ?? 1;
    const gy = o.groundY ?? vfx.groundY(p);
    const color = o.color ? vfx.dustColor().clone().set(o.color) : undefined;
    if (o.kind === 'step') {
      // run step: a low, small kick behind the foot
      dustPuffs(vfx, p.x - (o.dir || 0) * -0.05, gy, p.z, { n: Math.max(1, Math.round(4 * amt + 0.5)), spread: 0.08, speed: [0.4, 1.4], up: [0.1, 0.5], size: [0.12, 0.34 + amt * 0.5],
        life: [0.35, 0.6], dir: o.dir || null, bias: 0.75, alpha: 0.4 + amt * 0.3, color });
      return;
    }
    if (o.kind === 'getup') {
      dustRing(vfx, p.x, gy, p.z, { radius: 0.75, alpha: 0.45, life: 0.55, stretchX: 1.3, color });
      dustPuffs(vfx, p.x, gy, p.z, { n: 4, spread: 0.3, speed: [0.4, 1.2], size: [0.18, 0.5], alpha: 0.4, color });
      return;
    }
    dustPuffs(vfx, p.x, gy, p.z, { n: Math.max(2, Math.round(9 * amt)), spread: 0.18, speed: [0.6, 2.2].map((v) => v * (0.5 + amt * 0.6)), size: [0.2 * (0.6 + amt * 0.4), 0.8 * (0.6 + amt * 0.5)], alpha: 0.55, color });
    if (amt >= 0.8) dustRing(vfx, p.x, gy, p.z, { radius: 0.6 + amt * 0.5, alpha: 0.5, life: 0.6, color });
  },
};
