// Pot / meat pickup effects (bonus-camp r8; driven by src/game/pickups/{pot,food}.js — one effect file, several modes).
// Everything is small, shaped and brief (no domes, no lights, nothing that can sit over a fighter):
//   glint   { kind:'pot', pos, s }          a slow twinkle on the flask's shoulder + a drifting mote ("ready to grab")
//   steam   { kind:'food', pos, s, lite }   one soft steam wisp rising off the roast (lit alpha pool)
//   pop     { kind, pos }                   the spill: a short cross-flash + a few sparks as the loot leaves the sack
//   land    { kind, pos, power }            a tiny ground puff + two chips when a pickup hits the floor hard
//   collect { kind, pos, hero, lite }       the scoop: a crisp star flash + ring where the pickup was, motes that
//                                           streak to the hero's chest (lite = just the flash; the camp already has camp_collect)
const POT = { c0: '#f2fbff', c1: '#4b9bff', mid: '#9fd0ff' };
const FOOD = { c0: '#fff8d8', c1: '#86e05a', mid: '#d6f59a' };

export default {
  id: 'loot_fx',
  spawn(vfx, o = {}) {
    const p = o.pos; if (!p || !vfx.add) return;
    const r = vfx.rng, pot = o.kind !== 'food', C = pot ? POT : FOOD, s = o.s || 1;
    switch (o.mode) {
      case 'glint': {
        const x = p.x - 0.05 * s, y = p.y + 0.27 * s, z = p.z + 0.13 * s;
        vfx.add.emit({ pos: [x, y, z], life: 0.5, size: [0.05 * s, 0.36 * s], color: ['#ffffff', C.mid], intensity: 1.5, shape: 'glint', rot: r.range(-0.18, 0.18) });
        vfx.add.emit({ pos: [x + r.range(-0.04, 0.04) * s, y - 0.04 * s, z], vel: [r.range(-0.05, 0.05), 0.32, 0], life: 0.85, size: [0.03 * s, 0.008 * s], color: [C.c0, C.c1], intensity: 2.4, shape: 'ember', drag: 0.7, gravity: -0.05 });
        break;
      }
      case 'steam': {
        if (!vfx.alpha) break;
        const k = o.lite ? 0.75 : 1;
        vfx.alpha.emit({
          pos: [p.x + r.range(-0.04, 0.04), p.y, p.z + 0.03], vel: [r.range(-0.05, 0.05), r.range(0.28, 0.4), 0], life: r.range(1.0, 1.5),
          size: [0.07 * k, 0.3 * k], color: ['#f4eee4', '#dcd5c9'], alpha: [0.36 * k, 0], drag: 0.5, gravity: -0.03, rot: r.range(0, 6.28), spin: r.range(-0.5, 0.5), shape: 'puff',
        });
        break;
      }
      case 'pop': {
        const n = Math.round(4 * vfx.scale);
        vfx.add.emit({ pos: [p.x, p.y + 0.1, p.z + 0.1], life: 0.18, size: [0.1, 0.5], color: ['#ffffff', C.mid], intensity: 1.6, shape: 'glint', rot: r.range(-0.3, 0.3) });
        for (let i = 0; i < n; i++) {
          const a = r.range(0, Math.PI * 2), sp = r.range(0.9, 1.8);
          vfx.add.emit({ pos: [p.x, p.y + 0.1, p.z + 0.1], vel: [Math.cos(a) * sp, Math.sin(a) * sp * 0.8 + 0.5, 0], life: r.range(0.22, 0.38), size: [0.04, 0.012], color: [C.c0, C.c1], intensity: 2.4, shape: 'ember', drag: 2.2 });
        }
        break;
      }
      case 'land': {
        const power = Math.min(1, (o.power || 8) / 14);
        if (vfx.alpha) {
          const d = vfx.dustColor ? vfx.dustColor() : '#7a6a58';
          for (let i = 0; i < 2; i++) vfx.alpha.emit({ pos: [p.x, p.y + 0.03, p.z + 0.04], vel: [(i ? 1 : -1) * r.range(0.3, 0.7), 0.22, r.range(-0.1, 0.1)], life: 0.34, size: [0.05, 0.05 + 0.13 * power], color: [d, d], alpha: [0.42, 0], drag: 2.2, shape: 'puff', rot: r.range(0, 6) });
        }
        break;
      }
      case 'collect': {
        const h = o.hero, x = p.x, y = p.y, z = p.z;
        vfx.add.emit({ pos: [x, y, z + 0.12], life: 0.2, size: [0.12, o.lite ? 0.5 : 0.7], color: ['#ffffff', C.mid], intensity: 1.9, shape: 'glint', rot: r.range(-0.12, 0.12) });
        if (o.lite) break;
        vfx.shape.emit({ shape: 'ring', pos: [x, y, z + 0.1], size: [0.4, 0.4], life: 0.24, color: ['#ffffff', C.c1], intensity: 0.9, p0: [0.15, 0.2, 0, 1], p1: [0.95, 0.03, 0, 1] });
        const gy = h ? vfx.groundY(h) : 0, hx = h ? h.pos.x : x, hy = h ? gy + (h.height || 1.8) * 0.62 : y + 0.6, hz = h ? h.pos.z + 0.2 : z;
        const N = Math.round(8 * vfx.scale), T = 0.3;
        for (let i = 0; i < N; i++) {
          const j = 0.85 + r.range(0, 0.3);
          vfx.add.emit({ pos: [x + r.range(-0.06, 0.06), y + r.range(-0.05, 0.05), z], vel: [(hx - x) / T * j + r.range(-0.4, 0.4), (hy - y) / T * j + r.range(0.2, 1.0), (hz - z) / T * j], life: T * r.range(0.85, 1.1),
            size: [0.055, 0.014], color: [C.c0, C.c1], intensity: 2.8, shape: 'ember', delay: r.range(0, 0.06) });
        }
        break;
      }
      default: break;
    }
  },
};
