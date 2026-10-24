// Thieves' Night sack burst (bonus-camp r6): a kicked thief's sack tears open.
//   burlap tear  a ragged lit cloth flash behind the sack
//   loot         a couple of coin catch-lights; actual loot uses the pickup models
//   dust         a small ground puff under the thief
// No rings, no big additive glow, no sparkle cloud: the pots themselves (real pickups) are the spectacle. Everything
// sits a little BEHIND the thief (pushed along the camera forward) so fighters in front stay in front, and when bursts
// overlap (several kicks in a second, 2P) the extras thin out instead of piling up.
// opts: { pos:{x,y,z} (sack height), groundY, kind: 'pot'|'food', dir: ±1 (kick direction) }
import { cnt, dustPuffs } from './_lib.js';

const recent = []; // { x, z, tick } of the last bursts (overlap thinning)

export default {
  id: 'camp_sack_burst',
  spawn(vfx, o = {}) {
    const r = vfx.rng, p = o.pos || { x: 0, y: 1, z: 0 };
    const gy = o.groundY ?? vfx.groundY(p);
    const dir = o.dir || 1, food = o.kind === 'food';
    const tick = (vfx.game && vfx.game.tick) || 0;
    for (let i = recent.length - 1; i >= 0; i--) if (tick - recent[i].tick > 45 || tick < recent[i].tick) recent.splice(i, 1);
    const busy = recent.filter((b) => Math.abs(b.x - p.x) < 2.6 && Math.abs(b.z - p.z) < 1.6).length;
    recent.push({ x: p.x, z: p.z, tick });
    const k = 1 / (1 + busy);             // 1 → ½ → ⅓ …
    const f = vfx.camBasis().fwd;          // push away from the camera (behind the thief's body)
    const back = 0.4;
    const c = { x: p.x + f.x * back, y: p.y, z: p.z + f.z * back };

    // burlap tear: ragged cloth silhouette (lit, not additive — it's fabric, not light), short and small
    if (busy < 2) {
      vfx.shapeLit.emit({ shape: 'burst', pos: [c.x, c.y, c.z], size: [0.95, 0.8], grow: [0.55, 1.1], ease: 'out', life: 0.16, rot: r.range(0, Math.PI),
        color: ['#d8b078', '#7a5430'], intensity: 1, alpha: [1, 0], p0: [9, 0.55, 0.1, 0], p1: [9, 0.4, 0.05, 0.85], seed: r.range(0, 1) });
    }
    // coin catch-lights: a few tiny glints, only on a lone burst
    if (!food && busy === 0) {
      for (let i = 0, N = cnt(vfx, 3); i < N; i++) {
        vfx.add.emit({ pos: [c.x, c.y + 0.1, c.z], vel: [dir * r.range(0.8, 2.2), r.range(2.6, 4), r.range(-0.4, 0.4)], life: r.range(0.28, 0.42), size: [0.16, 0.035],
          color: ['#fff2c0', '#e8a830'], intensity: 1.4, shape: 'glint', gravity: 7, drag: 1.2, delay: i * 0.03 });
      }
    }
    // small dust puff at the thief's feet (lit, terrain-tinted)
    dustPuffs(vfx, p.x + f.x * 0.2, gy, p.z + f.z * 0.2, { n: Math.max(2, Math.round(4 * k)), spread: 0.2, speed: [0.4, 1.2], up: [0.15, 0.5], size: [0.16, 0.42], life: [0.4, 0.7], alpha: 0.42, dir, bias: 0.4 });
  },
};
