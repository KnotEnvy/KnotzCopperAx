// Ruined village palisade: sharpened stakes (lean, height and radius variation, charred tops, a few snapped and
// glowing), back rails, burnt-out breaches with stumps and fallen logs, and a half-collapsed burning watchtower.
// All merged into one wood mesh (1 draw call + shadow).
import * as THREE from 'three';
import { timber, panel, merge, rngFrom, V3 } from './geo.js';
import { terrainH } from './terrain.js';

export const PALISADE_Z = (x) => -21.5 + Math.sin(x * 0.045) * 1.6 + Math.sin(x * 0.13) * 0.4;

export function buildPalisade(ctx, mats, fx, lightSpots) {
  const rng = rngFrom(31);
  const wood = [];
  const stake = (x, z, h, r, o = {}) => {
    const y0 = terrainH(x, z) - 0.3;
    const lx = (rng.next() - 0.5) * 0.08 + (o.lean || 0), lz = (rng.next() - 0.5) * 0.06;
    const top = V3(x + lx * h, y0 + h, z + lz * h);
    const broken = o.broken ?? (rng.next() < 0.1 || Math.sin(x * 1.4) + Math.sin(x * .6) > .9);
    if (broken) top.y -= h * (.12 + .2 * Math.abs(Math.sin(x * 1.7)));
    const charTop = o.char ?? (0.25 + rng.next() * 0.35);
    wood.push(timber(V3(x, y0, z), top, {
      r, r2: r * 0.9, rng, sides: 6, seg: 3, bow: 0.012, jitter: 0.14,
      sharpen: broken ? 0 : 0.3 + rng.next() * 0.15, broken: broken ? 0.18 : 0,
      mask: (t) => [Math.min(1, charTop + t * t * (broken ? 0.9 : 0.5)), broken ? t * t : 0, 0, 1],
    }));
    return { top, broken };
  };
  let x = -46;
  let segIndex = 0;
  while (x < 112) {
    const segLen = 7 + rng.next() * 9;
    const x1 = Math.min(112, x + segLen);
    const hBase = 3.2 + rng.next() * 0.8;
    for (let sx = x; sx < x1; sx += 0.36 + rng.next() * 0.08) {
      const z = PALISADE_Z(sx) + (rng.next() - 0.5) * 0.12;
      stake(sx, z, hBase + (rng.next() - 0.5) * 0.9 + Math.sin(sx * 0.9) * 0.2, 0.12 + rng.next() * 0.07, { lean: (rng.next() - 0.5) * 0.06 });
    }
    // back rails
    for (const ry of [1.0, 2.5]) {
      const za = PALISADE_Z(x) - 0.28, zb = PALISADE_Z(x1) - 0.28;
      wood.push(timber(V3(x, terrainH(x, za) + ry, za), V3(x1, terrainH(x1, zb) + ry, zb), { r: 0.08, rng, seg: 5, bow: 0.01, mask: () => [0.3, 0, 0, 1] }));
    }
    // breach: stumps, a few leaning survivors, fallen logs, smoulder
    const gap = 2.5 + rng.next() * 4.5;
    const g0 = x1, g1 = x1 + gap;
    for (let sx = g0 + 0.2; sx < g1 - 0.2; sx += 0.5 + rng.next() * 0.4) {
      const z = PALISADE_Z(sx);
      if (rng.next() < 0.7) {
        const s = stake(sx, z, 0.5 + rng.next() * 1.1, 0.14 + rng.next() * 0.05, { broken: true, char: 0.7 });
        if (rng.next() < 0.35) fx.smoke([s.top.x, s.top.y, s.top.z], { puffs: 6, rise: 4, size: [0.5, 2], opacity: 0.3, life: 5, warm: 0.4 });
        if (rng.next() < 0.3) fx.flame([s.top.x, s.top.y - 0.05, s.top.z], { height: 0.5 + rng.next() * 0.4, intensity: 3.5 });
      }
    }
    for (let i = 0; i < 2 + Math.floor(rng.next() * 3); i++) {
      const fxp = g0 + rng.next() * gap, z = PALISADE_Z(fxp) + 0.6 + rng.next() * 2.2;
      const len = 2 + rng.next() * 2.2, ang = (rng.next() - 0.5) * 1.6;
      const a = V3(fxp, terrainH(fxp, z) + 0.12, z), b = a.clone().add(V3(Math.cos(ang) * len, 0.05 + rng.next() * 0.4, Math.sin(ang) * len));
      wood.push(timber(a, b, { r: 0.15, rng, seg: 3, sharpen: rng.next() < 0.5 ? 0.3 : 0, mask: (t) => [0.6 + t * 0.3, rng.next() < 0.3 ? 0.8 : 0, 0, 1] }));
    }
    x = g1;
    segIndex++;
  }
  // ---- watchtower (half collapsed, burning) at x ≈ 31
  const tx = 31, tz = PALISADE_Z(31) + 0.9, ty = terrainH(tx, tz);
  const hw = 1.4, H = 7.4, plat = 5.2;
  const corners = [[-hw, -hw], [hw, -hw], [-hw, hw], [hw, hw]];
  corners.forEach(([cx, cz], i) => {
    const top = i === 3 ? plat + 0.6 : H;
    wood.push(timber(V3(tx + cx, ty - 0.3, tz + cz), V3(tx + cx * 0.85, ty + top, tz + cz * 0.85), { r: 0.2, r2: 0.17, rng, sides: 6, seg: 4, broken: i === 3 ? 0.3 : 0, mask: (t) => [0.3 + t * 0.5, i === 3 ? t * t : 0, 0, 1] }));
  });
  // cross bracing
  for (const [a, b] of [[0, 1], [2, 3], [0, 2], [1, 3]]) {
    const [ax, az] = corners[a], [bx, bz] = corners[b];
    wood.push(timber(V3(tx + ax, ty + 0.6, tz + az), V3(tx + bx * 0.9, ty + plat - 0.2, tz + bz * 0.9), { r: 0.08, rng, seg: 3, mask: () => [0.45, 0, 0, 1] }));
  }
  // platform planks (a couple missing/tilted)
  for (let i = 0; i < 9; i++) {
    if (i === 6 || i === 7) continue;
    const g = panel(0.3, 0.07, hw * 2.2, { mask: () => [0.55, i > 4 ? 0.4 : 0, 0, 1] });
    g.rotateZ((rng.next() - 0.5) * 0.08 + (i > 7 ? -0.35 : 0));
    g.translate(tx - hw + 0.18 + i * 0.32, ty + plat, tz);
    wood.push(g);
  }
  // railing + roof frame (collapsed on one side)
  wood.push(timber(V3(tx - hw, ty + plat + 1.0, tz + hw), V3(tx + hw * 0.4, ty + plat + 1.05, tz + hw), { r: 0.06, rng, broken: 0.1, mask: () => [0.6, 0.5, 0, 1] }));
  wood.push(timber(V3(tx - hw, ty + plat + 1.0, tz - hw), V3(tx + hw, ty + plat + 1.0, tz - hw), { r: 0.06, rng, mask: () => [0.5, 0, 0, 1] }));
  wood.push(timber(V3(tx - hw, ty + H, tz - hw), V3(tx, ty + H + 1.4, tz), { r: 0.07, rng, mask: () => [0.6, 0, 0, 1] }));
  wood.push(timber(V3(tx + hw * 0.85, ty + H, tz - hw * 0.85), V3(tx, ty + H + 1.4, tz), { r: 0.07, rng, mask: () => [0.6, 0, 0, 1] }));
  wood.push(timber(V3(tx - hw * 0.85, ty + H, tz + hw * 0.85), V3(tx + 0.4, ty + H + 0.7, tz + 0.3), { r: 0.07, rng, broken: 0.15, mask: (t) => [0.7, t, 0, 1] }));
  // fire on the platform + big smoke column
  for (let i = 0; i < 6; i++) fx.flame([tx - 0.8 + rng.next() * 1.8, ty + plat + 0.05, tz - 0.6 + rng.next() * 1.4], { height: 1.2 + rng.next() * 1.4, intensity: 4 });
  fx.glow([tx, ty + plat + 1.2, tz + 0.5], { size: 9, color: '#ff5a1a', intensity: 0.8 });
  fx.smoke([tx, ty + plat + 1.5, tz], { puffs: 16, rise: 16, size: [1.7, 8.8], opacity: 0.7, life: 11, drift: 0.9, warm: 0.7 });   // perf-1650 r3: smoke was 26 puffs @0.55
  fx.sparks([tx, ty + plat + 0.6, tz], { count: 40, rise: 3.5, spread: 1.6, radius: 1.6 });
  lightSpots.push(V3(tx, ty + plat + 0.8, tz + 2));
  const g = merge(wood);
  const m = new THREE.Mesh(g, mats.wood);
  // No shadow casting: with the key from the front-right its shadow falls behind the wall (hidden), and the merged
  // 150 m mesh would otherwise be drawn into the shadow map every frame.
  m.castShadow = false; m.receiveShadow = true; m.name = 'palisade';
  ctx.group.add(m);
  return m;
}
