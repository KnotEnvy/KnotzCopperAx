// Gorrim — STORM, 3 tiers (DESIGN §2), choreographed with SpellKit:
//   T1 Crackle        the Copper Ax is raised; forked bolts hammer each nearby foe in quick succession
//   T2 Chain Tempest  a storm cloud rolls in; lightning leaps ax → foe → foe (twice), then the cloud strikes all
//   T3 Thunder Anvil  the sky splits; a colossal hammer of lightning forms and slams the whole screen (cut-in)
// Damage stays canon (SpellKit ledger: exactly ctx.damage per foe per cast).
import { spellKit } from '../SpellKit.js';
import { emblem, EMBLEM_COLORS } from '../emblems.js';
import { energyHammer } from '../meshes.js';
import { groundRing, crackDecal, sparkSpray, dustRing, debris } from '../../vfx/effects/_lib.js';

function axUp(S) {
  const p = S.hand();
  S.fx.arcBetween(p, { x: p.x + S.r.range(-0.6, 0.6), y: p.y + 4, z: p.z - 0.3 }, { width: 0.7, life: 0.2 });
  S.vfx.shape.emit({ shape: 'glow', pos: [p.x, p.y, p.z + 0.1], size: [1.4, 1.4], life: 0.15, color: [S.pal.hot, S.pal.mid], intensity: 2, p0: [2.4, 0.25] });
}

async function crackle(S) {
  await S.intro({ charge: 18 });
  const foes = S.alive().sort((a, b) => Math.abs(a.pos.x - S.hero.pos.x) - Math.abs(b.pos.x - S.hero.pos.x));
  axUp(S);
  for (let i = 0; i < foes.length; i++) {
    const e = foes[i];
    S.fx.bolt(S.chest(e), { width: 1.1 });
    S.strike(e, 1, { final: true, launch: 5, hitstop: 7 });
    S.fx.shock(e, 0.6);
    S.g.cameraRig && S.g.cameraRig.shake(0.25);
    if (i % 2) axUp(S);
    await S.wait(6);
  }
  await S.outro(50);
}

async function chainTempest(S) {
  await S.intro({ charge: 22, dark: 0.45 });
  const g = S.g, h = S.hero;
  const rg = g.cameraRig ? g.cameraRig.visibleRange() : { xMin: h.pos.x - 9, xMax: h.pos.x + 9 };
  S.fx.cloud((rg.xMin + rg.xMax) / 2, 7.2, rg.xMax - rg.xMin, 2.4);
  const order = S.alive().sort((a, b) => Math.abs(a.pos.x - h.pos.x) - Math.abs(b.pos.x - h.pos.x));
  for (let round = 0; round < 2; round++) {
    let from = S.hand();
    axUp(S);
    for (const e of order) {
      if (e.removed) continue;
      const to = S.chest(e);
      S.fx.arcBetween(from, to, { width: 0.8, life: 0.22 });
      sparkSpray(S.vfx, to, { x: 0, y: 1, z: 0 }, { n: 10, speed: [3, 8], cone: 1.5, life: [0.1, 0.25], color: [S.pal.hot, S.pal.mid], intensity: 4, gravity: 8 });
      S.strike(e, 0.3, { hitstop: 4 });
      S.fx.shock(e, 0.5);
      from = to;
      await S.wait(4);
    }
    await S.wait(10);
  }
  // the cloud answers: a bolt onto every foe at once
  const post = g.renderer && g.renderer.post;
  // Local sky/target bolts carry the lightning flash; never mix white across the whole combat view.
  if (post) post.pulse({ ca: 0.004, duration: 0.3 });
  g.cameraRig && g.cameraRig.shake(0.55);
  for (const e of order) { S.fx.bolt(S.chest(e), { width: 1.4, height: 7 }); S.strike(e, 1, { final: true, launch: 7, hitstop: 9 }); }
  if (order[0]) S.cutIn(order[0], { seconds: 0.9 });
  await S.outro(55);
}

async function thunderAnvil(S) {
  await S.intro({ charge: 30, dark: 0.6, dist: 21, height: 8 });
  const g = S.g, vfx = S.vfx, h = S.hero, pal = S.pal;
  const foes = S.alive();
  const cx = foes.length ? foes.reduce((a, e) => a + e.pos.x, 0) / foes.length : h.pos.x + S.F * 4;
  const rg = g.cameraRig ? g.cameraRig.visibleRange() : { xMin: cx - 10, xMax: cx + 10 };
  S.fx.cloud((rg.xMin + rg.xMax) / 2, 8, rg.xMax - rg.xMin + 4, 3.2);
  // sky splits: a few bolts rake the clouds
  for (let i = 0; i < 3; i++) S.fx.bolt({ x: S.r.range(rg.xMin, rg.xMax), y: 5, z: -3.5 }, { width: 0.6, delay: i * 0.1, ring: false, bg: true, height: 5 });
  axUp(S);
  // the hammer forms high above
  const { mesh, material } = energyHammer();
  const gy = S.gy(cx, 0), yTop = gy + 10.5, yHit = gy + 1.4;
  mesh.position.set(cx, yTop, -0.4);
  mesh.rotation.set(0, 0.25, 0.05);
  mesh.scale.setScalar(0.4);
  material.uniforms.uCol.value.set(pal.tail); material.uniforms.uHot.value.set(pal.hot);
  const FORM = 0.6, SLAM = 0.14, HOLD = 0.35;
  vfx.track(mesh, FORM + SLAM + HOLD + 0.5, (m, t01, dt) => {
    const age = t01 * (FORM + SLAM + HOLD + 0.5);
    material.uniforms.uT.value = age;
    if (age < FORM) { const k = age / FORM; m.scale.setScalar(0.6 + 1.2 * (1 - (1 - k) ** 3)); m.rotation.z = 0.05 - k * 0.5; material.uniforms.uA.value = Math.min(1, k * 1.6); }
    else if (age < FORM + SLAM) { const k = (age - FORM) / SLAM; m.position.y = yTop - (yTop - yHit) * k * k; m.rotation.z = -0.45 + 0.5 * k; m.scale.setScalar(1.8); }
    else { m.position.y = yHit; m.rotation.z = 0.05; material.uniforms.uA.value = Math.max(0, 1 - (age - FORM - SLAM) / (HOLD + 0.5)); }
    // storm cage while it forms: short vertical bolts flicker on a ring around the head (a lattice, not a solid)
    if (age < FORM + SLAM && S.r.range(0, 1) < 0.45) {
      const a = S.r.range(0, 6.28), R = 1.7 * m.scale.x;
      vfx.shape.emit({ shape: 'bolt', mode: 'axial', pos: [m.position.x + Math.cos(a) * R, m.position.y - 0.9 * m.scale.x, m.position.z + Math.sin(a) * R * 0.5], dir: [0, 1, 0], size: [1.2 * m.scale.x, 0.45], life: 0.07,
        color: [pal.hot, pal.tail], intensity: 1.8, ease: 'linear', seed: S.r.range(0, 1), p0: [0.5, 0.05, 0.1, 0.6] });
    }
    if (S.r.range(0, 1) < 0.5) {
      const a = S.r.range(0, 6.28), L = S.r.range(1, 2.4);
      vfx.shape.emit({ shape: 'bolt', mode: 'axial', pos: [m.position.x + Math.cos(a) * 1.2, m.position.y + Math.sin(a) * 1.2, m.position.z + 0.6], dir: [Math.cos(a), Math.sin(a), 0], size: [L, 0.5], life: 0.08,
        color: [pal.hot, pal.mid], intensity: 2.2, ease: 'linear', seed: S.r.range(0, 1), p0: [0.5, 0.05, 0.1, 0.6] });
    }
  }, { dispose: true });
  await S.wait(Math.round(FORM * 60));
  g.slowmo(0.5, 0.15);
  await S.wait(Math.round(SLAM * 60));
  // SLAM: local lightning, shockwave, the storm grounds through every foe
  const post = g.renderer && g.renderer.post;
  if (post) post.pulse({ ca: 0.008, desat: 0.1, duration: 0.4 });
  g.slowmo(0.25, 0.35, { out: 0.35 });
  g.cameraRig && g.cameraRig.shake(1.0);
  g.cameraRig && g.cameraRig.punch(0.12, 14);
  // PAYOFF core: an angular storm-star with a bolt rune punched through it (hard silhouette, ink rim) instead of
  // the r1 additive pop that blew to a white smear; gold-halo bolts (complementary) cage every foe
  emblem(vfx, 'star', { pos: { x: cx, y: gy + 2.2, z: 0.2 }, size: [6.5, 6.5], grow: 0.3, life: 0.75, rise: 0.08, burn: 0.5, intensity: 1.0, wob: 0.25, colors: EMBLEM_COLORS.storm, renderOrder: 19 });
  S.fx.pop({ x: cx, y: gy + 0.8, z: -0.4 }, 1.0);
  vfx.shape.emit({ shape: 'flare', pos: [cx, gy + 0.8, 0.6], size: [22, 0.8], life: 0.3, color: [pal.hot, pal.mid], intensity: 1.2, p0: [0.05, 0.12] });
  for (let k = 0; k < 3; k++) groundRing(vfx, cx, gy, 0, { radius: 5 + k * 3.5, color: [pal.hot, pal.tail], intensity: 1.2 - k * 0.3, life: 0.5 + k * 0.15, delay: k * 0.07 });
  crackDecal(vfx, cx, gy, 0, { radius: 5.5, glow: pal.mid, glowIntensity: 2.6, life: 2.6 });
  dustRing(vfx, cx, gy, 0, { radius: 6, alpha: 0.8, life: 1.4, n: 24, size: [0.5, 1.5], stretchX: 1.5 });
  debris(vfx, cx, gy, 0, { n: 26, speed: [3, 8], up: [4, 9] });
  // ground arcs racing out from the anvil to every foe
  for (const e of foes) {
    S.fx.arcBetween({ x: cx, y: gy + 0.3, z: 0.3 }, S.chest(e), { width: 1.0, life: 0.3 });
    S.fx.bolt(S.chest(e), { width: 1.5, height: 8, delay: 0.04, accent: ['#ffe070', '#ff9a20'] });
    S.strike(e, 1, { final: true, launch: 11, knockback: 5, hitstop: 12, from: { x: cx } });
    S.fx.shock(e, 1.2);
  }
  if (foes[0]) S.cutIn(foes[0], { seconds: 1.2 });
  await S.wait(24);
  // residual crackle over the scorched ground
  vfx.emitter(1.2, () => {
    if (S.r.range(0, 1) > 0.3) return;
    const x = S.r.range(cx - 5, cx + 5), z = S.r.range(-2, 2), y = S.gy(x, z);
    S.fx.arcBetween({ x, y: y + 0.05, z }, { x: x + S.r.range(-1.2, 1.2), y: y + S.r.range(0.2, 0.8), z }, { width: 0.4, life: 0.1 });
  });
  await S.outro(60);
}

export default {
  id: 'gorrim',
  element: 'storm',
  maxTier: 3,
  tiers: { 1: { name: 'Crackle' }, 2: { name: 'Chain Tempest' }, 3: { name: 'Thunder Anvil' } },
  async cast(ctx, hero, tier) {
    const S = spellKit(ctx, hero, { element: 'storm', maxTier: 3 });
    const fn = [null, crackle, chainTempest, thunderAnvil][tier] || crackle;
    try { await fn(S); } finally { S.finishAll(); }
  },
};
