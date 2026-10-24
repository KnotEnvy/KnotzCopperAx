// Knot Surge (2P team spell, DESIGN §2/§10): both heroes cast within 0.5 s. Runs ALONGSIDE the two normal casts:
// a braided double helix of both elements rises between the heroes, ties a glowing knot in the sky, and the knot
// bursts over every foe for a bonus hit (SURGE_DAMAGE, on top of the two canon spells).
import { groundRing, coreGlow, embers } from '../vfx/effects/_lib.js';
import { PALETTES } from '../vfx/palette.js';

export const SURGE_DAMAGE = 8;

export default async function knotSurge(ctx, a, b) {
  const g = ctx.game, vfx = ctx.vfx, r = ctx.rng;
  const ea = (a.def.magic && a.def.magic.element) || 'fire', eb = (b.def.magic && b.def.magic.element) || 'storm';
  const A = PALETTES[ea] || PALETTES.fire, B = PALETTES[eb] || PALETTES.storm;
  const cx = (a.pos.x + b.pos.x) / 2, cz = (a.pos.z + b.pos.z) / 2, gy = vfx.groundY({ x: cx, z: cz });
  const RISE = 0.9, KY = gy + 6.5;
  // braid: two helices from each hero's position spiralling up into the knot point
  vfx.emitter(RISE, (u, dt, age) => {
    for (const [h, P, ph] of [[a, A, 0], [b, B, Math.PI]]) {
      for (let k = 0; k < 2; k++) {
        const t = Math.max(0, u - k * 0.04);
        const x = h.pos.x + (cx - h.pos.x) * t + Math.cos(age * 14 + ph) * 0.6 * (1 - t);
        const y = gy + 1.2 + (KY - gy - 1.2) * t;
        const z = h.pos.z + (cz - h.pos.z) * t + Math.sin(age * 14 + ph) * 0.6 * (1 - t);
        vfx.shape.emit({ shape: 'orb', pos: [x, y, z], size: [0.5, 0.5], life: 0.25, grow: [1, 0.2], color: [P.hot, P.tail], alpha: [1, 0], intensity: 2, p0: [0.6, 0.5, 3, 0.8], occ: 0.05 });
      }
    }
  });
  await ctx.wait(Math.round(RISE * 60));
  // the knot: two interlocked rings of the two elements + a burst
  const kp = { x: cx, y: KY, z: cz };
  for (const [P, rot] of [[A, 0.5], [B, -0.5]]) {
    vfx.shape.emit({ shape: 'ring', pos: [kp.x, kp.y, kp.z], size: [3.2, 3.2], rot, spin: rot * 4, life: 0.9, color: [P.hot, P.mid], alpha: [1, 0], intensity: 1.8, p0: [0.7, 0.08, 0.2, 1], p1: [0.9, 0.05, 0.5, 1] });
  }
  coreGlow(vfx, kp, { size: 2.4, color: A.core, tail: B.mid, intensity: 2, life: 0.3, core: 0.3 });
  const post = g.renderer && g.renderer.post;
  // The overhead knot/core supplies the local flash. A full-frame exposure mix erased fighters for one frame
  // when the next hit's CA pulse replaced it; keep only the optical accent here.
  if (post) post.pulse({ ca: 0.006, duration: 0.4 });
  g.cameraRig && g.cameraRig.shake(0.6);
  await ctx.wait(12);
  const foes = ctx.enemies();
  for (const [i, e] of foes.entries()) {
    const P = i % 2 ? B : A;
    const to = { x: e.pos.x, y: e.pos.y + (e.height || 1.8) * 0.6, z: e.pos.z };
    const dx = to.x - kp.x, dy = to.y - kp.y, L = Math.hypot(dx, dy) || 1;
    vfx.shape.emit({ shape: 'bolt', mode: 'axial', pos: [(kp.x + to.x) / 2, (kp.y + to.y) / 2, to.z + 0.1], dir: [dx / L, dy / L, 0], size: [L, 1.0], life: 0.25, color: [P.hot, P.mid], alpha: [1, 0], intensity: 2.2, ease: 'linear', seed: r.range(0, 1), p0: [0.25, 0.06, 0.12, 0.4] });
    groundRing(vfx, e.pos.x, vfx.groundY(e), e.pos.z, { radius: 1.6, color: [P.hot, P.tail], intensity: 0.9, life: 0.35 });
    embers(vfx, to, { n: 10, dir: 0, speed: [-2, 2], up: [1, 4], color: [P.hot, P.tail], intensity: 3 });
    ctx.hit(e, { damage: SURGE_DAMAGE, element: i % 2 ? eb : ea, knockdown: true, launch: 8, knockback: 3, hitstop: 8, hitstun: 40 });
  }
}
