// Magic/VFX primitives as one registered effect with sub-types, plus named aliases (fx_slash.js etc. re-export).
//   vfx.spawn('fx', { type, ... })  or  vfx.spawn('fx_<type>', {...})
// types (all opts optional; pos = {x,y,z} ground point unless noted; element = earth|fire|storm tints):
//   slash      { pos (centre, world), dir:[x,y,z], length, width, element, life }        crescent smear
//   shockwave  { pos, radius, element, dust:true, debris:n }                            ground ring + dust wall + chips
//   embers     { pos, radius, count, rise, life, element }                              rising embers (area)
//   flame      { pos, height, width, count, life, element }                             cluster of fire tongues + embers
//   bolt       { from:{x,y,z}, to:{x,y,z}, width, element:'storm', impact:true }        jagged lightning + glow + impact
//   rock_burst { pos, count, speed, size, element }                                     lit rock debris + dust
//   smoke      { pos, count, size, dark (0..1), life }                                  lit smoke column
//   crack      { pos, radius, element }                                                 glowing ground crack decal
import * as THREE from 'three';
import { groundRing, dustRing, dustPuffs, debris, sparkSpray, crackDecal, smoke as smokeLib, embers as embersLib, coreGlow } from './_lib.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const P = (o) => o.pos || o.point || { x: 0, y: 0, z: 0 };

const TYPES = {
  slash(vfx, o) {
    const pal = vfx.palette(o.element || 'fire'), p = o.point || { ...P(o), y: (P(o).y || 0) + 1 };
    const d = typeof o.dir === 'number' ? [o.dir, 0.2, 0] : (o.dir || [1, 0.2, 0]);
    vfx.shape.emit({ shape: 'slash', mode: 'axial', pos: [p.x, p.y, p.z], dir: d, size: [o.length ?? 2.2, (o.width ?? 0.5) * (o.flip ? -1 : 1)], grow: [0.95, 1.1],
      life: o.life ?? 0.22, color: [pal.core, pal.mid], intensity: o.intensity ?? 1.6, alpha: [1, 0.6], p0: [o.bow ?? 0.4, 0.32, 0.6, 1] });
    vfx.shape.emit({ shape: 'slash', mode: 'axial', pos: [p.x, p.y - 0.02, p.z - 0.02], dir: d, size: [(o.length ?? 2.2) * 1.08, (o.width ?? 0.5) * 1.6 * (o.flip ? -1 : 1)], grow: [0.95, 1.12],
      life: (o.life ?? 0.22) * 1.2, color: [pal.mid, pal.tail], intensity: 0.6, alpha: [0.8, 0.3], p0: [(o.bow ?? 0.4) * 1.1, 0.5, 0.8, 0] });
  },
  shockwave(vfx, o) {
    const pal = vfx.palette(o.element || 'earth'), p = P(o), R = o.radius ?? 2.4, gy = o.groundY ?? vfx.groundY(p);
    groundRing(vfx, p.x, gy, p.z, { radius: R, color: [pal.hot, pal.tail], intensity: 1.0, life: 0.42, thick: [0.12, 0.02] });
    groundRing(vfx, p.x, gy, p.z, { radius: R * 0.7, color: [pal.core, pal.mid], intensity: 0.7, life: 0.3, delay: 0.04, thick: [0.18, 0.03] });
    if (o.dust !== false) { dustRing(vfx, p.x, gy, p.z, { radius: R * 0.9, alpha: 0.75, life: 1.0 }); dustPuffs(vfx, p.x, gy, p.z, { n: 12, spread: R * 0.3, speed: [1.5, 4], size: [0.3, 1.1] }); }
    if (o.debris !== 0) debris(vfx, p.x, gy, p.z, { n: o.debris ?? 10, speed: [2, 5], up: [3, 6.5] });
  },
  embers(vfx, o) {
    const pal = vfx.palette(o.element || 'fire'), p = P(o), r = vfx.rng, R = o.radius ?? 0.8;
    for (let i = 0, N = Math.round((o.count ?? 24) * vfx.scale); i < N; i++) {
      vfx.add.emit({ pos: [p.x + r.range(-R, R), (p.y ?? 0) + r.range(0, 0.4), p.z + r.range(-R, R) * 0.5], vel: [r.range(-0.4, 0.4), r.range(0.8, 2.4) * (o.rise ?? 1), r.range(-0.2, 0.2)],
        life: r.range(0.6, 1.4) * (o.life ?? 1), size: [r.range(0.03, 0.06), 0.01], color: [pal.hot, pal.tail], intensity: 3, shape: 'ember', gravity: -0.6, drag: 0.8, delay: r.range(0, 0.3) });
    }
  },
  flame(vfx, o) {
    const pal = vfx.palette(o.element || 'fire'), p = P(o), r = vfx.rng, H = o.height ?? 1.6, W = o.width ?? 0.9;
    const N = Math.round((o.count ?? 5) * Math.max(0.6, vfx.scale));
    for (let i = 0; i < N; i++) {
      const h = H * r.range(0.6, 1.05), w = W * r.range(0.45, 0.8), x = p.x + r.range(-W, W) * 0.45, z = p.z + r.range(-0.1, 0.1);
      vfx.shape.emit({ shape: 'flame', mode: 'axial', pos: [x, (p.y ?? 0) + h * 0.5 - 0.05, z], dir: [r.range(-0.12, 0.12), 1, 0], size: [h, w], grow: [0.5, 1.05], growY: [0.8, 0.7], ease: 'out',
        life: (o.life ?? 0.7) * r.range(0.8, 1.2), delay: i * 0.03, color: [[1.0, 0.5, 0.1, 1], [0.7, 0.1, 0.02, 0]], intensity: 1.15, p0: [0.5, 0.8, 1.8, 0.45], seed: r.range(0, 1) });
    }
    coreGlow(vfx, { x: p.x, y: (p.y ?? 0) + H * 0.25, z: p.z + 0.05 }, { size: W * 1.3, color: pal.mid, tail: pal.tail, intensity: 0.5, life: o.life ?? 0.6 });
    TYPES.embers(vfx, { ...o, count: 10, radius: W * 0.4, rise: 1.4 });
  },
  bolt(vfx, o) {
    const pal = vfx.palette(o.element || 'storm');
    const f = o.from || { x: 0, y: 7, z: 0 }, t = o.to || P(o);
    _a.set(f.x, f.y, f.z); _b.set(t.x, t.y, t.z);
    const len = _a.distanceTo(_b); const mid = _a.clone().add(_b).multiplyScalar(0.5); const d = _b.clone().sub(_a).normalize();
    const W = o.width ?? Math.min(1.6, len * 0.22);
    const seed = vfx.rng.range(0, 1);
    vfx.shape.emit({ shape: 'bolt', mode: 'axial', pos: [mid.x, mid.y, mid.z], dir: [d.x, d.y, d.z], size: [len, W], life: o.life ?? 0.28, color: [pal.core, pal.mid], intensity: 2.4, alpha: [1, 0.2], ease: 'linear', seed, p0: [0.4, 0.035, 0.1, 0.6] });
    vfx.shape.emit({ shape: 'bolt', mode: 'axial', pos: [mid.x + 0.05, mid.y, mid.z - 0.05], dir: [d.x, d.y, d.z], size: [len, W * 1.3], life: (o.life ?? 0.28) * 0.7, delay: 0.03, color: [pal.mid, pal.tail], intensity: 1.2, alpha: [0.8, 0], ease: 'linear', seed: seed + 0.37, p0: [0.55, 0.02, 0.06, 0.8] });
    if (o.impact !== false) {
      const gy = o.groundY ?? vfx.groundY(t);
      coreGlow(vfx, { x: t.x, y: t.y + 0.15, z: t.z + 0.1 }, { size: 0.9, color: pal.core, tail: pal.mid, intensity: 2, life: 0.12 });
      groundRing(vfx, t.x, gy, t.z, { radius: 1.3, color: [pal.hot, pal.tail], intensity: 0.9, life: 0.3 });
      sparkSpray(vfx, { x: t.x, y: gy + 0.1, z: t.z + 0.1 }, { x: 0, y: 1, z: 0 }, { n: 14, speed: [4, 10], cone: 1.1, life: [0.15, 0.35], color: [pal.hot, pal.tail], intensity: 4, gravity: 12, floor: gy + 0.02 });
      crackDecal(vfx, t.x, gy, t.z, { radius: 0.6, glow: pal.mid, life: 1.0 });
      vfx.light({ x: t.x, y: gy + 0.6, z: t.z }, { color: pal.mid, intensity: 5, distance: 2.4, life: 0.15 });
    }
  },
  rock_burst(vfx, o) {
    const p = P(o), gy = o.groundY ?? vfx.groundY(p);
    debris(vfx, p.x, gy, p.z, { n: o.count ?? 14, speed: o.speed || [1.5, 4.5], up: o.up || [3, 7], size: o.size || [0.06, 0.16], kind: 'rock' });
    dustPuffs(vfx, p.x, gy, p.z, { n: 8, spread: 0.3, speed: [1, 3], size: [0.3, 1.0], alpha: 0.65 });
    dustRing(vfx, p.x, gy, p.z, { radius: 1.2, alpha: 0.6, life: 0.8 });
  },
  smoke(vfx, o) {
    const p = P(o), k = o.dark ?? 0.5;
    const c = [0.3 - k * 0.2, 0.27 - k * 0.18, 0.25 - k * 0.16];
    smokeLib(vfx, { x: p.x, y: p.y ?? 0.2, z: p.z }, { n: o.count ?? 7, color: c, alpha: o.alpha ?? 0.6, size: o.size || [0.45, 1.5], life: o.life || [1.3, 2.4] });
  },
  crack(vfx, o) {
    const pal = vfx.palette(o.element || 'earth'), p = P(o), gy = o.groundY ?? vfx.groundY(p);
    crackDecal(vfx, p.x, gy, p.z, { radius: o.radius ?? 1.1, glow: pal.mid, life: o.life ?? 2.2 });
    dustRing(vfx, p.x, gy, p.z, { radius: (o.radius ?? 1.1) * 1.1, alpha: 0.55, life: 0.8 });
  },
};

export const FX_TYPES = Object.keys(TYPES);

export function spawnPrim(vfx, type, o = {}) {
  const fn = TYPES[type];
  if (!fn) throw new Error(`fx: unknown type '${type}' (${FX_TYPES.join(', ')})`);
  return fn(vfx, o);
}

export default {
  id: 'fx_prims',
  spawn(vfx, o = {}) {
    if (o.type) return spawnPrim(vfx, o.type, o);
    // showcase cycle: one of each
    const n = (vfx._primN = (vfx._primN || 0) + 1);
    const type = FX_TYPES[(n - 1) % FX_TYPES.length];
    return spawnPrim(vfx, type, { ...o, element: o.element });
  },
};
