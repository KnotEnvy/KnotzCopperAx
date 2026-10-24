// SpellKit: shared choreography + effect building blocks for the per-hero spell books (src/magic/spells/*.js).
//
//   const S = spellKit(ctx, hero, { element, maxTier })
//   await S.intro({ charge })      cast pose charge-up: camera pull-back (scales with tier), world darkening, hero
//                                  lit by the spell (MagicSystem spell light), sigil + converging motes, slow-mo beat
//   S.strike(foe, share, o)        per-enemy synced hit: pays `share` of the canon tier damage (ctx.damage) now;
//                                  o.final → pays the REMAINDER + knockdown/launch. Sum per foe is always ctx.damage.
//   S.finishAll(o)                 final hit for every foe not yet finished
//   S.cutIn(foe, o)                T3+ face close-up inset (MagicSystem.cutIn)
//   await S.outro(ticks)           dissipation hold, light/dark/camera release
//   S.fx.*                         effect blocks (bolt, arcBetween, flameColumn, fireball, crackRun, quake, cloud …)
import * as THREE from 'three';
import { groundRing, dustRing, dustPuffs, debris, crackDecal, smoke, embers, sparkSpray, coreGlow, impactBurst } from '../vfx/effects/_lib.js';
import { emblem, EMBLEM_COLORS } from './emblems.js';

const _v = new THREE.Vector3();

export function spellKit(ctx, hero, { element, maxTier }) {
  const g = ctx.game, vfx = ctx.vfx, magic = g.magic, r = ctx.rng, tier = ctx.tier;
  const pal = vfx.palette(element);
  const foes = ctx.enemies().filter((e) => e.alive !== false && !e.removed);
  const paid = new Map(), done = new Set();
  const F = hero.facing || 1;
  const top = tier >= maxTier;
  let drama = null, releaseDark = null;

  const gy = (x, z) => vfx.groundY({ x, z });
  // late arrivals (a foe still in its spawn entrance when the cast began) join the target list on the next query
  const alive = () => {
    for (const e of ctx.enemies()) if (!foes.includes(e) && e.alive !== false) foes.push(e);
    return foes.filter((e) => !e.removed && e.alive !== false);
  };
  const chest = (e) => ({ x: e.pos.x, y: e.pos.y + (e.height || 1.8) * 0.6, z: e.pos.z });
  const head = (e) => ({ x: e.pos.x, y: e.pos.y + (e.height || 1.8) * 0.9, z: e.pos.z });
  const hand = () => {
    const s = hero.model && hero.model.sockets && (hero.model.sockets.R || hero.model.sockets.L);
    if (s) { s.getWorldPosition(_v); return { x: _v.x, y: _v.y, z: _v.z }; }
    return { x: hero.pos.x + F * 0.3, y: hero.pos.y + 1.5, z: hero.pos.z };
  };

  const S = {
    g, vfx, r, pal, tier, element, foes, hero, F, top, gy, alive, chest, head, hand,
    wait: (t) => ctx.wait(t),

    strike(e, share = 1, o = {}) {
      if (!e || done.has(e) || e.removed || e.alive === false) return false;
      const total = ctx.damage, cur = paid.get(e) || 0;
      const d = o.final ? Math.max(0, total - cur) : Math.max(0, Math.min(total - cur, total * share));
      const dir = Math.sign(e.pos.x - (o.from ? o.from.x : hero.pos.x)) || F;
      const hd = {
        damage: d, element, dir,
        hitstun: o.hitstun ?? (o.final ? 42 : 30), knockback: o.knockback ?? (o.final ? 3 + tier * 0.3 : 0.4),
        knockdown: !!o.final, launch: o.final ? (o.launch ?? 4.5 + tier * 0.6) : 0, hitstop: o.hitstop ?? (o.final ? 6 + tier : 3),
      };
      if (o.shake != null) hd.shake = o.shake;
      const ok = ctx.hit(e, hd);
      if (ok) { paid.set(e, cur + d); if (o.final) done.add(e); }
      return ok;
    },
    finishAll(o = {}) { let n = 0; for (const e of alive()) if (S.strike(e, 1, { ...o, final: true })) n++; return n; },

    cutIn(e, o = {}) { if (magic && magic.cutIn && e) magic.cutIn.show(e, { element, seconds: 1.05, side: (e.pos.x > hero.pos.x ? -1 : 1), ...o }); },

    /** Cast pose + charge-up. charge = sim ticks of gathering before the release beat. */
    async intro({ charge = 18 + tier * 5, dark = 0.3 + tier * 0.08, dist = 14 + tier * 1.15, height = 5.2 + tier * 0.45, fov = 34, light = 1, lookHeight = 1.5 } = {}) {
      drama = ctx.drama({ distance: dist, height, fov, lookHeight, focus: hero, in: 0.4, hold: null, out: 0.7 });
      releaseDark = magic ? magic.darkHold(Math.min(0.62, dark)) : null;
      if (magic) magic.spellLight(hero, pal.mid, light * (8 + tier * 3));
      S.fx.sigil(hero, charge / 60);
      S.fx.gather(hero, charge / 60);
      await ctx.wait(charge);
      // release beat
      ctx.slowmo(0.4, 0.12 + tier * 0.04);
      S.fx.release(hero);
      ctx.shake(0.18 + tier * 0.04);
    },

    async outro(ticks = 30) {
      await ctx.wait(ticks);
      if (magic) magic.spellLight(hero, pal.mid, 0);
      if (releaseDark) releaseDark();
      if (drama) drama.release();
    },

    // ---------------------------------------------------------------- effect blocks
    fx: {
      /** Rune sigil under the caster: element ring + counter-rotating inner ring + rune ripple. */
      sigil(h, secs) {
        const y = gy(h.pos.x, h.pos.z) + 0.03, x = h.pos.x, z = h.pos.z, R = 1.6 + tier * 0.25;
        vfx.shape.emit({ shape: 'ring', mode: 'plane', pos: [x, y, z], size: [R * 2, R * 2], life: secs + 0.5, color: [pal.hot, pal.mid], alpha: [1, 0], intensity: 1.4, grow: [0.5, 1], ease: 'out', spin: 1.2, p0: [0.84, 0.05, 0.5, 1], p1: [0.9, 0.03, 0.4, 1] });
        vfx.shape.emit({ shape: 'crack', mode: 'plane', pos: [x, y + 0.005, z], size: [R * 1.6, R * 1.6], life: secs + 0.4, color: [pal.mid, pal.tail], alpha: [1, 0], intensity: 1.3, spin: -0.8, p0: [0.4, 0.04, 0, 9], p1: [0.95, 0.03, 0, 9] });
        vfx.shape.emit({ shape: 'ripple', mode: 'plane', pos: [x, y + 0.01, z], size: [R * 1.2, R * 1.2], life: secs + 0.3, color: [pal.hot, pal.tail], alpha: [0.8, 0], intensity: 1.0, p0: [0.2, 0.03, 0.1, 0.7], p1: [0.9, 0.02, 0.12, 0.7] });
      },
      /** Motes spiral INTO the caster's weapon hand (the charge). */
      gather(h, secs) {
        const n = Math.round((24 + tier * 10) * vfx.scale);
        for (let i = 0; i < n; i++) {
          const a = r.range(0, 6.28), rr = r.range(1.4, 2.6 + tier * 0.3), life = r.range(0.35, 0.6), dl = r.range(0, Math.max(0.05, secs - life * 0.6));
          const tp = hand();
          const sx = tp.x + Math.cos(a) * rr, sy = tp.y + r.range(-1.1, 1.3), sz = tp.z + Math.sin(a) * rr * 0.6;
          vfx.add.emit({ pos: [sx, sy, sz], vel: [(tp.x - sx) / life, (tp.y - sy) / life, (tp.z - sz) / life], life, delay: dl, size: [0.07, 0.02], color: [pal.mote, pal.hot], intensity: 3.2, shape: 'streak', stretch: 0.03, fadeIn: 0.1 });
        }
        vfx.emitter(secs, (u) => {
          const tp = hand();
          if (r.range(0, 1) < 0.5) vfx.shape.emit({ shape: 'glow', pos: [tp.x, tp.y, tp.z + 0.1], size: [0.4 + u * 0.8, 0.4 + u * 0.8], life: 0.08, color: [pal.hot, pal.mid], intensity: 1.2 + u, p0: [2.4, 0.2] });
        });
      },
      release(h) {
        const tp = hand(), x = h.pos.x, z = h.pos.z, y = gy(x, z);
        coreGlow(vfx, tp, { size: 1.2 + tier * 0.15, color: pal.hot, tail: pal.mid, intensity: 2.2, life: 0.16, core: 0.25 });
        vfx.shape.emit({ shape: 'ring', pos: [tp.x, tp.y, tp.z + 0.1], size: [3 + tier * 0.4, 3 + tier * 0.4], life: 0.3, color: [pal.hot, pal.tail], alpha: [1, 0], intensity: 1.2, p0: [0.1, 0.1, 0.4, 1], p1: [0.95, 0.02, 0.6, 1] });
        groundRing(vfx, x, y, z, { radius: 2.6 + tier * 0.4, color: [pal.hot, pal.tail], intensity: 0.8, life: 0.45 });
        if (element !== 'earth') dustRing(vfx, x, y, z, { radius: 2 + tier * 0.3, alpha: 0.6, life: 0.9 });
      },
      /** Lightning strike from the sky onto p (forked main bolt + glow bolt + ground flare + sparks). */
      bolt(p, { height = 9, width = 1.2, life = 0.22, delay = 0, branches = 2, ring = true, bg = false, accent = null } = {}) {
        // bg: a dim violet sky bolt that sits BEHIND the spell read · accent: [hot, mid] complementary halo colour
        const I = bg ? 0.35 : 1, cMain = bg ? [pal.mid, pal.tail] : [pal.core, pal.hot], cGlow = accent || (bg ? [pal.tail, pal.tail] : [pal.mid, pal.tail]);
        const y0 = gy(p.x, p.z);
        const top = { x: p.x + r.range(-1.2, 1.2), y: y0 + height, z: p.z - 0.3 };
        const L = Math.hypot(p.x - top.x, p.y - top.y), dx = (p.x - top.x) / L, dy = (p.y - top.y) / L;
        const mid = [(p.x + top.x) / 2, (p.y + top.y) / 2, (p.z + top.z) / 2 + 0.1];
        const seed = r.range(0, 1);
        vfx.shape.emit({ shape: 'bolt', mode: 'axial', pos: mid, dir: [dx, dy, 0], size: [L, width], life, delay, color: cMain, alpha: [1, 0.2], intensity: 2.6 * I, ease: 'linear', seed, p0: [0.3, 0.05, 0.1, 0.6], occ: 0.3 });
        vfx.shape.emit({ shape: 'bolt', mode: 'axial', pos: mid, dir: [dx, dy, 0], size: [L, width * 2.4], life: life * 1.2, delay, color: cGlow, alpha: [0.7, 0], intensity: (accent ? 0.9 : 1.2) * I, ease: 'linear', seed, p0: [0.3, 0.02, 0.25, 0.8] });
        for (let b = 0; b < branches; b++) {
          const t0 = r.range(0.3, 0.7), bx = top.x + (p.x - top.x) * t0, by = top.y + (p.y - top.y) * t0;
          const a = Math.atan2(dy, dx) + r.range(0.4, 0.9) * (r.range(0, 1) < 0.5 ? -1 : 1), bl = r.range(1.2, 2.6);
          vfx.shape.emit({ shape: 'bolt', mode: 'axial', pos: [bx + Math.cos(a) * bl / 2, by + Math.sin(a) * bl / 2, p.z], dir: [Math.cos(a), Math.sin(a), 0], size: [bl, width * 0.6], life: life * 0.8, delay: delay + 0.02,
            color: [pal.hot, pal.mid], alpha: [0.9, 0], intensity: 1.8, ease: 'linear', seed: r.range(0, 1), p0: [0.45, 0.04, 0.08, 0.7] });
        }
        if (bg) return;
        vfx.delay(delay, () => {
          vfx.shape.emit({ shape: 'flare', pos: [p.x, y0 + 0.4, p.z + 0.2], size: [4, 0.5], life: 0.18, color: [pal.hot, pal.mid], intensity: 1.6, p0: [0.07, 0.2] });
          if (ring) groundRing(vfx, p.x, y0, p.z, { radius: 1.6, color: [pal.hot, pal.tail], intensity: 0.8, life: 0.3 });
          sparkSpray(vfx, { x: p.x, y: y0 + 0.1, z: p.z }, { x: 0, y: 1, z: 0 }, { n: 16, speed: [4, 10], cone: 1.4, life: [0.12, 0.3], color: [pal.hot, pal.mid], intensity: 4, gravity: 12, floor: y0 + 0.02 });
          crackDecal(vfx, p.x, y0, p.z, { radius: 0.9, glow: pal.mid, glowIntensity: 1.6, life: 1.1 });
          vfx.light({ x: p.x, y: y0 + 1, z: p.z }, { color: pal.mid, intensity: 6, distance: 2.6, life: 0.15 });
        });
      },
      /** A crackling arc between two points (chain lightning hop). */
      arcBetween(a, b, { width = 0.6, life = 0.2, delay = 0 } = {}) {
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, L = Math.hypot(dx, dy, dz) || 1;
        const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2 + 0.1];
        for (let k = 0; k < 2; k++) {
          vfx.shape.emit({ shape: 'bolt', mode: 'axial', pos: mid, dir: [dx / L, dy / L, dz / L], size: [L, width * (k ? 2.2 : 1)], life: life * (k ? 1.2 : 1), delay: delay + k * 0.02,
            color: k ? [pal.mid, pal.tail] : [pal.hot, pal.mid], alpha: [k ? 0.6 : 1, 0], intensity: k ? 1.1 : 2.4, ease: 'linear', seed: r.range(0, 1), p0: [0.5, k ? 0.02 : 0.05, k ? 0.22 : 0.1, 0.7], occ: k ? 0 : 0.3 });
        }
      },
      /** Fire column erupting at (x,z): stacked flame tongues + base ring + embers + smoke. */
      flameColumn(x, z, { height = 4, width = 1.2, life = 0.8, delay = 0 } = {}) {
        const y = gy(x, z);
        // the column's BODY is a hard-edged, ink-rimmed flame emblem (a defined silhouette that never blows to
        // white); a few thin additive licks + embers around it keep it alive
        emblem(vfx, 'pillar', { pos: { x, y: y - 0.25, z: z + 0.05 }, anchor: 'bottom', size: [width * 1.35, height], life: life * 0.95, rise: 0.12, burn: 0.6, wob: 1.4,
          delay, intensity: 1.05, colors: element === 'fire' ? EMBLEM_COLORS.fireDeep : EMBLEM_COLORS.storm });
        const n = Math.round(4 * Math.min(1.5, height / 4));
        for (let i = 0; i < n; i++) {
          const h = height * r.range(0.35, 0.8), w = width * r.range(0.25, 0.45), sx = (i % 2 ? 1 : -1) * r.range(0.35, 0.6) * width;
          vfx.shape.emit({ shape: 'flame', mode: 'axial', pos: [x + sx, y + h * 0.48, z + 0.1], dir: [sx * 0.08, 1, 0], size: [h, w], grow: [0.3, 1.05], growY: [0.7, 0.4],
            life: life * r.range(0.5, 0.8), delay: delay + r.range(0.03, 0.15), color: [pal.hot, pal.tail], alpha: [0.8, 0], intensity: 1.2, p0: [0.6, 0.6, 2.2, 0.9], seed: r.range(0, 1), occ: 0, vel: [0, r.range(0.5, 2), 0], drag: 1 });
        }
        vfx.delay(delay, () => {
          vfx.shape.emit({ shape: 'orb', pos: [x, y + 0.4, z + 0.1], size: [width * 1.4, width * 0.8], grow: [0.4, 1.3], life: 0.2, color: [pal.hot, pal.mid], alpha: [0.7, 0], intensity: 0.8, p0: [0.6, 0.5, 3, 0.6], p1: [0.9, 0.9, 3, 0] });
          groundRing(vfx, x, y, z, { radius: width * 1.4, color: [pal.hot, pal.tail], intensity: 0.9, life: 0.4 });
          crackDecal(vfx, x, y, z, { radius: width * 0.9, glow: pal.mid, glowIntensity: 1.2, life: 1.8 });
          embers(vfx, { x, y: y + 0.5, z }, { n: 14, dir: 0, speed: [-1, 1], up: [2, 6], color: [pal.hot, pal.tail], intensity: 3.4, life: [0.6, 1.4], gravity: -1, spread: 1 });
          smoke(vfx, { x, y: y + height * 0.8, z: z - 0.2 }, { n: 3, color: [0.08, 0.06, 0.05], alpha: 0.5, size: [0.6, 1.6], rise: [0.8, 1.6], spread: 0.3, life: [1.2, 2] });
        });
      },
      /** Burning at a body (the lingering "on fire" read after a fire hit). */
      burn(e, secs = 0.8) {
        vfx.emitter(secs, (u) => {
          if (e.removed || r.range(0, 1) > 0.55) return;
          const c = chest(e);
          const hgt = r.range(0.4, 0.8) * (1 - u * 0.5);
          vfx.shape.emit({ shape: 'flame', mode: 'axial', pos: [c.x + r.range(-0.3, 0.3), c.y + r.range(-0.6, 0.3) + hgt * 0.5, c.z + 0.15], dir: [0, 1, 0], size: [hgt, hgt * 0.35], grow: [0.4, 1], life: 0.3, color: [pal.hot, pal.tail], alpha: [1, 0], intensity: 2.6, p0: [0.6, 0.6, 2.4, 0.9], seed: r.range(0, 1), occ: 0 });
        });
      },
      /** Crackling shock around a body (storm reaction). */
      shock(e, secs = 0.6) {
        vfx.emitter(secs, () => {
          if (e.removed || r.range(0, 1) > 0.35) return;
          const c = chest(e), a = r.range(0, 6.28), L = r.range(0.5, 1.1);
          vfx.shape.emit({ shape: 'bolt', mode: 'axial', pos: [c.x + Math.cos(a) * L * 0.3, c.y + Math.sin(a) * L * 0.4, c.z + 0.2], dir: [Math.cos(a), Math.sin(a), 0], size: [L, 0.35], life: 0.08, color: [pal.hot, pal.mid], intensity: 2.2, ease: 'linear', seed: r.range(0, 1), p0: [0.5, 0.05, 0.08, 0.6] });
        });
      },
      /** A travelling ground fissure from a to b (earth): crack decals + chip spurts every step; onArrive at b. */
      crackRun(a, b, { secs = 0.35, step = 0.55, onArrive } = {}) {
        const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1, n = Math.max(2, Math.round(L / step));
        for (let i = 1; i <= n; i++) {
          const k = i / n, x = a.x + dx * k, z = a.z + dz * k, dl = secs * k;
          vfx.delay(dl, () => {
            const y = gy(x, z);
            crackDecal(vfx, x, y, z, { radius: 0.55, glow: pal.tail, glowIntensity: 1.6, life: 1.4 });
            debris(vfx, x, y, z, { n: 3, speed: [0.6, 1.6], up: [2, 3.5], size: [0.05, 0.1] });
            if (i % 2) dustPuffs(vfx, x, y, z, { n: 2, speed: [0.3, 0.9], size: [0.2, 0.55], alpha: 0.5 });
          });
        }
        if (onArrive) g.after(Math.max(1, Math.round(secs * 60)), onArrive);
      },
      /** Screen-wide quake: shake + ground dust puffs across the view. */
      quake(amount = 0.5, { dust = 10 } = {}) {
        ctx.shake(amount);
        const cam = g.cameraRig, rg = cam ? cam.visibleRange() : { xMin: hero.pos.x - 8, xMax: hero.pos.x + 8 };
        for (let i = 0; i < dust; i++) {
          const x = r.range(rg.xMin, rg.xMax), z = r.range(-2.2, 2.2);
          dustPuffs(vfx, x, gy(x, z), z, { n: 2, speed: [0.3, 1.2], up: [0.3, 1.2], size: [0.3, 0.9], alpha: 0.45 });
        }
      },
      /** Dark storm cloud: lit smoke bank overhead with internal flashes. */
      cloud(cx, cy, w, secs) {
        const n = Math.round(22 * vfx.scale);
        for (let i = 0; i < n; i++) {
          vfx.alpha.emit({ pos: [cx + r.range(-w / 2, w / 2), cy + r.range(-0.5, 0.8), r.range(-2.5, -0.5)], vel: [r.range(-0.3, 0.3), r.range(-0.05, 0.1), 0], life: secs * r.range(0.8, 1.1),
            size: [r.range(1.8, 3), r.range(2.6, 4)], color: [[0.13, 0.14, 0.2, 0.85], [0.1, 0.1, 0.16, 0]], shape: 'smoke', drag: 0.4, rot: r.range(0, 6.28), spin: r.range(-0.2, 0.2), fadeIn: 0.35 });
        }
        vfx.emitter(secs, () => {
          if (r.range(0, 1) > 0.12) return;
          vfx.shape.emit({ shape: 'glow', pos: [cx + r.range(-w / 2, w / 2), cy + r.range(-0.3, 0.6), -1.4], size: [r.range(2, 4), r.range(1.5, 3)], life: 0.12, color: [pal.tail, pal.tail], intensity: 0.45, p0: [1.6, 0.2], occ: 0 });
        });
      },
      /** Fireball flying from a → b over secs (orb + trailing flame/embers), onHit at arrival. arc = height bow. */
      fireball(a, b, { secs = 0.4, size = 0.7, arc = 0.6, onHit, delay = 0 } = {}) {
        vfx.delay(delay, () => {
          vfx.emitter(secs, (u) => {
            const x = a.x + (b.x - a.x) * u, y = a.y + (b.y - a.y) * u + Math.sin(u * Math.PI) * arc, z = a.z + (b.z - a.z) * u;
            vfx.shape.emit({ shape: 'orb', pos: [x, y, z + 0.1], size: [size, size], life: 0.06, color: [pal.hot, pal.mid], intensity: 1.8, p0: [0.55, 0.6, 3, 0.7], occ: 0.1 });
            vfx.shape.emit({ shape: 'flame', mode: 'axial', pos: [x - (b.x - a.x) * 0.04, y, z], dir: [-(b.x - a.x), 0.2, 0], size: [size * 2.2, size * 0.8], life: 0.16, color: [pal.hot, pal.tail], alpha: [0.9, 0], intensity: 2.2, p0: [0.6, 0.5, 2, 0.8], seed: r.range(0, 1), occ: 0 });
            if (r.range(0, 1) < 0.6) vfx.add.emit({ pos: [x, y, z], vel: [r.range(-1, 1), r.range(0, 2), r.range(-0.5, 0.5)], life: r.range(0.3, 0.6), size: [0.05, 0.02], color: [pal.hot, pal.tail], intensity: 3, shape: 'ember', gravity: -0.5, drag: 1 });
          });
        });
        if (onHit) g.after(Math.max(1, Math.round((delay + secs) * 60)), onHit);
      },
      /** Generic impact at a body (element-agnostic big pop used on finals). */
      pop(p, s = 1) {
        coreGlow(vfx, p, { size: 1.0 * s, color: pal.hot, tail: pal.mid, intensity: 2, life: 0.14, core: 0.25 });
        impactBurst(vfx, p, { size: 2.2 * s, spikes: 9, valley: 0.4, color: [pal.mid, pal.tail], intensity: 1.0, life: 0.2, occ: 0.35 });
      },
    },
  };
  return S;
}
