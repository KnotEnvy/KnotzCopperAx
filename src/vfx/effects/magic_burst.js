// Generic elemental burst used by the baseline spells (built from fx_prims). opts: { pos, element:'earth'|'fire'|'storm', power: 1..6 }
//   earth → shockwave + rock burst + crack      fire → flame tongues + embers + ring      storm → lightning bolt from above + ring
import { spawnPrim } from './fx_prims.js';
import { coreGlow } from './_lib.js';

export default {
  id: 'magic_burst',
  spawn(vfx, o = {}) {
    const p = o.pos || { x: 0, y: 0, z: 0 };
    const el = o.element || 'fire', pw = o.power ?? 1;
    const gy = vfx.groundY(p);
    const g = { x: p.x, y: gy, z: p.z };
    const pal = vfx.palette(el);
    coreGlow(vfx, { x: p.x, y: gy + 0.9, z: p.z + 0.1 }, { size: 0.8 + pw * 0.12, color: pal.core, tail: pal.mid, intensity: 1.6, life: 0.14 });
    if (el === 'earth') {
      spawnPrim(vfx, 'shockwave', { pos: g, element: el, radius: 1.8 + pw * 0.25, debris: 6 + pw * 2 });
      if (pw >= 3) spawnPrim(vfx, 'crack', { pos: g, element: el, radius: 0.9 + pw * 0.1 });
    } else if (el === 'storm') {
      spawnPrim(vfx, 'bolt', { from: { x: p.x + vfx.rng.range(-0.8, 0.8), y: gy + 7, z: p.z - 0.3 }, to: { x: p.x, y: gy + 0.05, z: p.z }, element: el });
      spawnPrim(vfx, 'shockwave', { pos: g, element: el, radius: 1.4 + pw * 0.2, debris: 0, dust: pw >= 3 });
    } else {
      spawnPrim(vfx, 'flame', { pos: g, element: el, height: 1.3 + pw * 0.15, width: 0.8 + pw * 0.08, count: 4 + Math.min(4, pw) });
      spawnPrim(vfx, 'shockwave', { pos: g, element: el, radius: 1.4 + pw * 0.2, debris: 0, dust: false });
      spawnPrim(vfx, 'smoke', { pos: { x: p.x, y: gy + 1.2, z: p.z - 0.2 }, count: 3 + pw, dark: 0.7 });
    }
  },
};
