// Seraphine — FIRE, 6 tiers (DESIGN §2), choreographed with SpellKit:
//   T1 Flare Burst      a spinning nova of flame + a fireball flung at every foe
//   T2 Fire Serpents    twin homing flame serpents weave out of the sabres and bite each foe in turn
//   T3 Pillar Blaze     warning glyphs flare under each foe, then roaring fire pillars erupt (cut-in)
//   T4 Inferno Wave     two walls of fire sweep outward across the whole screen (cut-in)
//   T5 Drake of Cinders a serpentine fire dragon swoops across the screen breathing flame (cut-in)
//   T6 Phoenix Sun      a vast phoenix forms in the sky and dives; the screen goes white-gold (cut-in)
// Damage stays canon (SpellKit ledger: exactly ctx.damage per foe per cast).
import { spellKit } from '../SpellKit.js';
import { emblem, EMBLEM_COLORS } from '../emblems.js';
import { groundRing, embers, smoke, crackDecal, coreGlow } from '../../vfx/effects/_lib.js';

const FIRE_TINT = '#ffb050';

/** Flame "feather": one axial flame tongue from p along (dx,dy). */
function feather(vfx, pal, p, dx, dy, len, w, { life = 0.07, intensity = 2.6, hot = null, z = 0 } = {}) {
  const L = Math.hypot(dx, dy) || 1;
  vfx.shape.emit({ shape: 'flame', mode: 'axial', pos: [p.x + (dx / L) * len * 0.5, p.y + (dy / L) * len * 0.5, p.z + z], dir: [dx / L, dy / L, 0], size: [len, w], life,
    color: [hot || pal.hot, pal.tail], alpha: [1, 0.3], intensity, p0: [0.55, 0.5, 2.4, 0.8], seed: vfx.rng.range(0, 1), occ: 0 });
}

async function flareBurst(S) {
  await S.intro({ charge: 16 });
  const h = S.hero, vfx = S.vfx, gy = S.gy(h.pos.x, h.pos.z);
  // spinning nova
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * 6.28;
    vfx.shape.emit({ shape: 'flame', mode: 'axial', pos: [h.pos.x + Math.cos(a) * 0.9, gy + 0.7 + Math.sin(a) * 0.5, h.pos.z + 0.1], dir: [Math.cos(a), Math.sin(a) * 0.6 + 0.4, 0], size: [1.6, 0.55], grow: [0.4, 1.6], vel: [Math.cos(a) * 5, 1, 0], drag: 3,
      life: 0.4, color: [S.pal.hot, S.pal.tail], alpha: [0.8, 0], intensity: 0.5, p0: [0.6, 0.6, 2.4, 0.9], seed: S.r.range(0, 1), occ: 0 });
  }
  groundRing(vfx, h.pos.x, gy, h.pos.z, { radius: 4.5, color: [S.pal.hot, S.pal.tail], intensity: 1.3, life: 0.45 });
  for (const e of S.alive()) {
    const a = S.hand(), b = S.chest(e);
    const secs = 0.12 + Math.abs(b.x - a.x) / 18;
    S.fx.fireball(a, b, { secs, size: 0.6, arc: 0.5, onHit: () => { S.strike(e, 1, { final: true, launch: 5, hitstop: 7 }); S.fx.burn(e, 0.7); } });
  }
  await S.outro(60);
}

async function fireSerpents(S) {
  await S.intro({ charge: 20 });
  const vfx = S.vfx, g = S.g, pal = S.pal;
  const foes = S.alive().sort((a, b) => Math.abs(a.pos.x - S.hero.pos.x) - Math.abs(b.pos.x - S.hero.pos.x));
  const lists = [[], []];
  foes.forEach((e, i) => lists[i % 2].push(e));
  const SEG = 0.34;
  lists.forEach((list, k) => {
    if (!list.length) return;
    const start = S.hand();
    const pts = [{ x: start.x, y: start.y + (k ? -0.2 : 0.3), z: start.z + (k ? 0.6 : -0.6) }];
    for (const e of list) pts.push(S.chest(e));
    const end = pts[pts.length - 1];
    pts.push({ x: end.x + S.F * 3, y: end.y + 4, z: end.z });            // flies off after its last bite
    const total = SEG * (pts.length - 1);
    const at = (t) => {
      const u = Math.min(pts.length - 1.001, t / SEG), i = Math.floor(u), f = u - i;
      const a = pts[i], b = pts[i + 1];
      const s = Math.sin(f * Math.PI) * (k ? -1 : 1) * 0.9, w = Math.sin(t * 22) * 0.12;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f + s * 0.8 + w, z: a.z + (b.z - a.z) * f + s * 0.3 };
    };
    let prev = at(0);
    vfx.emitter(total, (u, dt, age) => {
      const p = at(age), dx = p.x - prev.x, dy = p.y - prev.y;
      prev = p;
      // head: churning orb + jaw flames forward; body: flame segments left behind that shrink (the serpent's length)
      vfx.shape.emit({ shape: 'orb', pos: [p.x, p.y, p.z + 0.1], size: [0.55, 0.55], life: 0.05, color: [pal.core, pal.hot], intensity: 1.9, p0: [0.6, 0.6, 3, 0.8], occ: 0.1 });
      feather(vfx, pal, p, -dx, -dy, 1.2, 0.5, { life: 0.34, intensity: 2.6 });
      vfx.add.emit({ pos: [p.x, p.y, p.z], vel: [S.r.range(-0.6, 0.6), S.r.range(0.3, 1.5), 0], life: S.r.range(0.3, 0.6), size: [0.05, 0.02], color: [pal.hot, pal.tail], intensity: 3, shape: 'ember', drag: 1 });
    });
    list.forEach((e, i) => g.after(Math.round(SEG * (i + 1) * 60), () => { S.strike(e, 1, { final: true, launch: 5.5, hitstop: 7 }); S.fx.burn(e, 0.8); }));
  });
  await S.wait(Math.round(SEG * (Math.max(lists[0].length, lists[1].length) + 1) * 60));
  await S.outro(40);
}

async function pillarBlaze(S) {
  await S.intro({ charge: 24, dark: 0.45 });
  const g = S.g, vfx = S.vfx;
  const foes = S.alive().sort((a, b) => Math.abs(a.pos.x - S.hero.pos.x) - Math.abs(b.pos.x - S.hero.pos.x));
  foes.forEach((e, i) => {
    const x = e.pos.x, z = e.pos.z, y = S.gy(x, z);
    g.after(1 + i * 7, () => vfx.shape.emit({ shape: 'ring', mode: 'plane', pos: [x, y + 0.03, z], size: [2.4, 2.4], life: 0.3, color: [S.pal.hot, S.pal.tail], alpha: [1, 0.4], intensity: 1.2, grow: [1.2, 0.7], p0: [0.8, 0.12, 0.3, 1] }));
    g.after(16 + i * 7, () => {
      S.fx.flameColumn(x, z, { height: 5.5, width: 1.3, life: 0.9 });
      S.strike(e, 1, { final: true, launch: 9, hitstop: 9 });
      S.fx.burn(e, 1.1);
      if (i === 0) { S.cutIn(e); g.slowmo(0.35, 0.22); }
      g.cameraRig && g.cameraRig.shake(0.35);
    });
  });
  // a few extra pillars to fill the screen
  const rg = g.cameraRig ? g.cameraRig.visibleRange() : { xMin: -8, xMax: 8 };
  for (let i = 0; i < 4; i++) g.after(20 + i * 6, () => S.fx.flameColumn(S.r.range(rg.xMin + 1, rg.xMax - 1), S.r.range(-2, 2), { height: 4, width: 1, life: 0.7 }));
  await S.wait(24 + foes.length * 7);
  await S.outro(60);
}

async function infernoWave(S) {
  await S.intro({ charge: 26, dark: 0.5 });
  const g = S.g, vfx = S.vfx, pal = S.pal, h = S.hero;
  const rg = g.cameraRig ? g.cameraRig.visibleRange() : { xMin: h.pos.x - 9, xMax: h.pos.x + 9 };
  const speed = 10, x0 = h.pos.x;
  const reach = Math.max(rg.xMax - x0, x0 - rg.xMin) + 1.5;
  const secs = reach / speed;
  ctx_flash(S, 0.18, "#ff9040");
  // r3: the wave CREST is a rank of ink-rimmed pillar emblems (defined flame silhouettes) dropped every ~0.1 s at the
  // front; the additive tongues behind it are dimmed so the wave never blooms into a flat white smear
  const crest = { 1: -1, [-1]: -1 };
  vfx.emitter(secs, (u, dt, age) => {
    for (const dir of [1, -1]) {
      const fx = x0 + dir * (0.8 + age * speed);
      const step = Math.floor(age / 0.1);
      if (step !== crest[dir]) {
        crest[dir] = step;
        for (const z of [-1.6, 0.1, 1.7]) {
          const hh = S.r.range(2.6, 3.8) * (1 - u * 0.35);
          emblem(vfx, 'pillar', { pos: { x: fx + S.r.range(-0.25, 0.25), y: S.gy(fx, z) - 0.2, z: z + S.r.range(-0.3, 0.3) }, anchor: 'bottom', size: [hh * 0.42, hh],
            life: 0.42, rise: 0.08, burn: 0.55, wob: 1.6, intensity: 1.0, colors: EMBLEM_COLORS.fireDeep });
        }
      }
      for (let k = 0; k < 4; k++) {
        const z = -2.6 + (k + S.r.range(0, 1)) * (5.2 / 4), y = S.gy(fx, z), hgt = S.r.range(2.4, 4.4) * (1 - u * 0.3);
        vfx.shape.emit({ shape: 'flame', mode: 'axial', pos: [fx + S.r.range(-0.3, 0.3), y + hgt * 0.48, z], dir: [dir * 0.35, 1, 0], size: [hgt, hgt * 0.45], grow: [0.5, 1.1], life: S.r.range(0.3, 0.5),
          color: [pal.hot, pal.tail], alpha: [1, 0], intensity: 3, p0: [0.6, 0.6, 2.4, 0.9], seed: S.r.range(0, 1), occ: 0, vel: [dir * 2.5, 0.6, 0], drag: 2 });
      }
      if (S.r.range(0, 1) < 0.5) crackDecal(vfx, fx, S.gy(fx, 0), S.r.range(-2, 2), { radius: 0.9, glow: pal.tail, glowIntensity: 1.2, life: 1.8 });
      if (S.r.range(0, 1) < 0.35) smoke(vfx, { x: fx, y: 2.8, z: -0.8 }, { n: 1, color: [0.08, 0.06, 0.05], alpha: 0.5, size: [0.8, 2], rise: [1, 2], life: [1.2, 1.8] });
      embers(vfx, { x: fx, y: 1, z: S.r.range(-2, 2) }, { n: 2, dir, speed: [1, 3], up: [2, 5], color: [pal.hot, pal.tail], intensity: 3 });
    }
  });
  let first = true;
  for (const e of S.alive()) {
    const t = Math.max(0.02, (Math.abs(e.pos.x - x0) - 0.8) / speed);
    g.after(Math.max(1, Math.round(t * 60)), () => {
      S.strike(e, 1, { final: true, launch: 8, knockback: 6, hitstop: 8, from: h.pos });
      S.fx.burn(e, 1.2);
      if (first) { first = false; S.cutIn(e); }
    });
  }
  await S.wait(Math.round(secs * 60) + 10);
  await S.outro(50);
}

function ctx_flash(S, strength, color = '#ffc070') {
  const post = S.g.renderer && S.g.renderer.post;
  if (post) post.pulse({ flash: strength, flashColor: color, duration: 0.35 });
}

async function drakeOfCinders(S) {
  await S.intro({ charge: 28, dark: 0.55, dist: 20.5, height: 7 });
  const g = S.g, vfx = S.vfx, pal = S.pal, h = S.hero;
  const rg = g.cameraRig ? g.cameraRig.visibleRange() : { xMin: h.pos.x - 10, xMax: h.pos.x + 10 };
  const D = S.F, xs = D > 0 ? rg.xMin - 4 : rg.xMax + 4, xe = D > 0 ? rg.xMax + 5 : rg.xMin - 5;
  const T = 1.7, SEGS = 16, LAG = 0.045;
  const path = (t) => {
    const u = Math.max(0, Math.min(1, t / T));
    return { x: xs + (xe - xs) * u, y: 5.2 - Math.sin(u * Math.PI) * 3.2 + Math.sin(u * 14) * 0.25, z: -0.8 + Math.sin(u * 5) * 0.8 };
  };
  // a real dragon HEAD silhouette leads the body (horns, open jaw, fangs), ink-rimmed so it reads at distance
  emblem(vfx, 'drake', { size: [4.6, 2.9], life: T + 0.05, rise: 0.2, burn: 0.06, intensity: 1.0, wob: 0.35, flick: 1.6, flipX: D < 0, colors: EMBLEM_COLORS.fire, renderOrder: 18,
    follow: (age) => { const t = Math.min(T, age), p = path(t + 0.05), q = path(t - 0.05);
      const rot = D > 0 ? Math.atan2(p.y - q.y, p.x - q.x) : Math.atan2(q.y - p.y, q.x - p.x);
      return { x: p.x + D * 0.9, y: p.y + 0.25, z: p.z + 0.4, rot: Math.max(-0.6, Math.min(0.6, rot)) }; } });
  vfx.emitter(T + SEGS * LAG, (u, dt, age) => {
    for (let i = 0; i < SEGS; i++) {
      const t = age - i * LAG;
      if (t < 0 || t > T) continue;
      const p = path(t), q = path(t - 0.03), s = 1 - i / SEGS;
      vfx.shape.emit({ shape: 'orb', pos: [p.x, p.y, p.z], size: [0.5 + s * 1.7, 0.5 + s * 1.7], life: 0.05, color: [pal.hot, pal.mid], intensity: i < 2 ? 0.5 : 0.9 + s * 0.6, p0: [0.6, 0.7, 3, 0.6], occ: 0.1 });
      if (i % 2 === 0) feather(vfx, pal, p, q.x - p.x, q.y - p.y + 0.02, 1.2 + s * 2.2, 0.5 + s * 0.9, { life: 0.22, intensity: 2.4 });
      if (i === 3) {
        // wings: fans of flame feathers that flap
        const flap = Math.sin(age * 10);
        for (let w = 0; w < 5; w++) {
          const a = 0.35 + w * 0.26 + flap * 0.35;
          for (const side of [1, -1]) feather(vfx, pal, p, -D * Math.cos(a) * 0.6, Math.sin(a) * side * 0.9 + 0.2, 5 - w * 0.5, 1.0, { life: 0.06, intensity: 2.2, z: side * 0.2 });
        }
      }
      if (i === 0) {
        // breath: a cone of fire poured ahead and down
        for (let b = 0; b < 3; b++) {
          const bx = D * S.r.range(0.6, 1.2), by = -S.r.range(0.8, 1.4);
          vfx.shape.emit({ shape: 'flame', mode: 'axial', pos: [p.x + bx * 1.2, p.y + by * 1.2, p.z + 0.2], dir: [bx, by, 0], size: [2.8, 1.0], grow: [0.4, 1.3], vel: [bx * 4, by * 4, 0], drag: 2, life: 0.3,
            color: [pal.hot, pal.tail], alpha: [1, 0], intensity: 3, p0: [0.6, 0.7, 2.4, 0.8], seed: S.r.range(0, 1), occ: 0 });
        }
      }
    }
  });
  let first = true;
  for (const e of S.alive()) {
    const u = (e.pos.x - xs) / (xe - xs), t = Math.max(0.05, u * T);
    g.after(Math.round(t * 60), () => {
      S.strike(e, 0.4, { hitstop: 4 });
      S.fx.flameColumn(e.pos.x, e.pos.z, { height: 3, width: 1.1, life: 0.6 });
      S.fx.burn(e, 1.4);
      if (first) { first = false; S.cutIn(e, { seconds: 1.1 }); g.slowmo(0.4, 0.2); }
    });
  }
  await S.wait(Math.round(T * 60) + 8);
  // the drake's wake detonates
  ctx_flash(S, 0.35);
  g.cameraRig && g.cameraRig.shake(0.6);
  for (const e of S.alive()) { S.fx.pop(S.chest(e), 0.9); S.strike(e, 1, { final: true, launch: 9, hitstop: 9 }); }
  await S.outro(60);
}

async function phoenixSun(S) {
  await S.intro({ charge: 32, dark: 0.6, dist: 21.5, height: 7.5, lookHeight: 2.6 });
  const g = S.g, vfx = S.vfx, pal = S.pal, h = S.hero;
  const foes = S.alive();
  const cx = foes.length ? foes.reduce((a, e) => a + e.pos.x, 0) / foes.length : h.pos.x + S.F * 4;
  const FORM = 0.75, DIVE = 0.32;
  const body = (age) => {
    if (age < FORM) return { x: cx, y: 5.4 + Math.sin(age * 6) * 0.15, z: -1.2 };
    const k = Math.min(1, (age - FORM) / DIVE);
    return { x: cx, y: 5.4 - 4.6 * k * k, z: -1.2 + 1.2 * k };
  };
  // the bird itself is a defined heraldic silhouette (ink-rimmed toon flame), the feathers are licks around it
  emblem(vfx, 'phoenix', { size: [9.5, 9.5], life: FORM + DIVE + 0.04, rise: 0.4, burn: 0.08, intensity: 1.3, wob: 0.6, colors: EMBLEM_COLORS.fire,
    follow: (age) => { const p = body(age), dive = age > FORM, k = dive ? Math.min(1, (age - FORM) / DIVE) : 0;
      return { x: p.x, y: p.y + 0.4, z: p.z + 0.3, sx: 1 - 0.45 * k + Math.sin(age * 7) * 0.04, sy: 1 + 0.15 * k }; } });
  vfx.emitter(FORM + DIVE, (u, dt, age) => {
    const p = body(age), grow = Math.min(1, age / 0.45), dive = age > FORM;
    const spread = dive ? 1 - Math.min(1, (age - FORM) / DIVE) * 0.55 : 1;
    const flap = Math.sin(age * 7) * 0.18;
    vfx.shape.emit({ shape: 'orb', pos: [p.x, p.y, p.z - 0.3], size: [2.0 * grow, 2.4 * grow], life: 0.05, color: [pal.hot, pal.mid], intensity: 0.6, p0: [0.6, 0.6, 3, 0.9], occ: 0.1 });
    // wings: 9 primaries per side sweeping out and up (fold as it dives)
    for (const side of [1, -1]) {
      for (let w = 0; w < 9; w++) {
        const a = (0.1 + w * 0.13 + flap) * spread;
        const root = { x: p.x + side * (0.8 + w * 0.8) * grow * spread, y: p.y + Math.sin(a) * w * 0.5 * grow, z: p.z };
        if (w % 2) feather(vfx, pal, { x: root.x * 1.08 - p.x * 0.08, y: root.y, z: p.z - 0.4 }, side * Math.cos(a + 0.5), Math.sin(a + 0.5) + 0.3, (2.4 + w * 0.4) * grow, 0.6, { life: 0.05, intensity: 0.9 });
      }
    }
    // tail streamers
    for (let t = 0; t < 4; t++) feather(vfx, pal, { x: p.x, y: p.y - 3.4 * grow, z: p.z - 0.3 }, (t - 1.5) * 0.35, dive ? 1.2 : -1, 3.0 * grow, 0.6, { life: 0.07, intensity: 1.0 });
    if (S.r.range(0, 1) < 0.8) vfx.add.emit({ pos: [p.x + S.r.range(-4, 4) * grow, p.y + S.r.range(-1, 1), p.z], vel: [0, -S.r.range(0.5, 2), 0], life: S.r.range(0.5, 1), size: [0.06, 0.02], color: [pal.hot, pal.tail], intensity: 3, shape: 'ember', drag: 0.8 });
  });
  await S.wait(Math.round(FORM * 60));
  g.slowmo(0.5, 0.25);
  await S.wait(Math.round(DIVE * 60));
  // SUN: white-gold screen, a blazing sun sphere, pillars of fire under every foe
  const gy = S.gy(cx, 0);
  const post = g.renderer && g.renderer.post;
  if (post) post.pulse({ flash: 0.4, flashColor: '#ffd890', ca: 0.007, desat: 0.1, duration: 0.45 });
  g.slowmo(0.25, 0.4, { out: 0.4 });
  g.cameraRig && g.cameraRig.shake(1.0);
  g.cameraRig && g.cameraRig.punch(0.1, 14);
  // PAYOFF: a flame-corona SUN with the phoenix emblem rising out of it: hard silhouettes, ink rims, toon bands
  // (the r1 additive orb + core glow + 0.85 flash flattened this exact frame to a white smear)
  emblem(vfx, 'sun', { pos: { x: cx, y: gy + 2.4, z: -0.6 }, size: [8.5, 8.5], grow: 0.35, life: 0.9, rise: 0.1, burn: 0.55, intensity: 1.2, colors: EMBLEM_COLORS.fireDeep, rot: 0 });
  emblem(vfx, 'phoenix', { size: [8.5, 8.5], life: 1.0, rise: 0.14, burn: 0.55, intensity: 1.35, wob: 0.7, colors: EMBLEM_COLORS.fire, renderOrder: 18,
    follow: (age) => ({ x: cx, y: gy + 3.0 + age * 2.2, z: 0.2, sx: 1 + age * 0.25, sy: 1 + age * 0.25 }) });
  vfx.shape.emit({ shape: 'flare', pos: [cx, gy + 1.5, 0.6], size: [24, 1.0], life: 0.35, color: [pal.hot, pal.mid], intensity: 1.2, p0: [0.06, 0.12] });
  for (let k = 0; k < 3; k++) groundRing(vfx, cx, gy, 0, { radius: 6 + k * 3.5, color: [pal.hot, pal.tail], intensity: 1.2 - k * 0.3, life: 0.6 + k * 0.15, delay: k * 0.08 });
  crackDecal(vfx, cx, gy, 0, { radius: 5, glow: pal.mid, glowIntensity: 2.2, life: 3 });
  for (const e of foes) {
    S.fx.flameColumn(e.pos.x, e.pos.z, { height: 6.5, width: 1.5, life: 1.1, delay: S.r.range(0, 0.08) });
    S.strike(e, 1, { final: true, launch: 11, knockback: 5, hitstop: 12, from: { x: cx } });
    S.fx.burn(e, 1.6);
  }
  if (foes[0]) S.cutIn(foes[0], { seconds: 1.2 });
  await S.wait(30);
  // embers rain down as the sun fades
  const rg = g.cameraRig ? g.cameraRig.visibleRange() : { xMin: cx - 10, xMax: cx + 10 };
  vfx.emitter(1.6, () => {
    for (let i = 0; i < 3; i++) vfx.add.emit({ pos: [S.r.range(rg.xMin, rg.xMax), S.r.range(5, 8), S.r.range(-2.5, 1.5)], vel: [S.r.range(-0.4, 0.4), -S.r.range(1, 2.2), 0], life: S.r.range(1.2, 2.2), size: [0.06, 0.02], color: [pal.hot, pal.tail], intensity: 3, shape: 'ember', drag: 0.4 });
  });
  await S.outro(70);
}

export default {
  id: 'seraphine',
  element: 'fire',
  maxTier: 6,
  tiers: { 1: { name: 'Flare Burst' }, 2: { name: 'Fire Serpents' }, 3: { name: 'Pillar Blaze' }, 4: { name: 'Inferno Wave' }, 5: { name: 'Drake of Cinders' }, 6: { name: 'Phoenix Sun' } },
  async cast(ctx, hero, tier) {
    const S = spellKit(ctx, hero, { element: 'fire', maxTier: 6 });
    const fn = [null, flareBurst, fireSerpents, pillarBlaze, infernoWave, drakeOfCinders, phoenixSun][tier] || flareBurst;
    try { await fn(S); } finally { S.finishAll(); }
  },
  FIRE_TINT,
};
