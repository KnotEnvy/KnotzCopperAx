// Gnarled dead trees: recursive tapered tubes with noisy bends, upward-reaching crooked limbs, root flares and
// charred bark. A few seeded variants, each an InstancedMesh (1 draw call per variant; far LOD variants are lighter).
import * as THREE from 'three';
import { tube, merge, rngFrom, V3 } from './geo.js';

function randPerp(d, rng) {
  const a = Math.abs(d.y) < 0.9 ? V3(0, 1, 0) : V3(1, 0, 0);
  const p = a.cross(d).normalize();
  return p.applyAxisAngle(d, rng.next() * Math.PI * 2);
}

export function treeGeometry(seed, o = {}) {
  const rng = rngFrom(seed);
  const height = o.height ?? 7.5, r0 = o.radius ?? 0.3, levels = o.levels ?? 3, lod = o.lod ?? 0;
  const parts = [];
  const charBase = o.char ?? 0.55;
  const branch = (start, dir, len, rad, level) => {
    const segs = [9, 6, 4, 3][level] - (lod ? 2 : 0);
    const sides = lod ? [5, 4, 3, 3][level] : [8, 6, 4, 3][level];
    const pts = [start.clone()], radii = [rad];
    let d = dir.clone(), p = start.clone();
    const gnarl = [0.16, 0.22, 0.28, 0.3][level];
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      d.add(randPerp(d, rng).multiplyScalar(gnarl * (0.5 + rng.next()))).add(V3(0, level === 0 ? 0.06 : 0.12, 0)).normalize();
      p = p.clone().addScaledVector(d, len / segs);
      pts.push(p); radii.push(rad * Math.max(0.12, 1 - t * 0.82) * (level === 0 && i === 1 ? 0.92 : 1));
    }
    radii[radii.length - 1] = Math.max(0.01, rad * 0.08);
    const mk = (t) => [Math.min(1, charBase + (1 - t) * 0.2 + rng.next() * 0.1), 0, 0, 1];
    parts.push(tube(pts, radii, { sides, rng, jitter: level === 0 ? 0.22 : 0.12, mask: mk }));
    if (level >= levels) return;
    const nKids = level === 0 ? 4 + Math.floor(rng.next() * 2) : 2 + Math.floor(rng.next() * 2);
    for (let k = 0; k < nKids; k++) {
      const t = level === 0 ? 0.42 + (k / nKids) * 0.5 + rng.next() * 0.06 : 0.3 + rng.next() * 0.6;
      const idx = Math.min(pts.length - 2, Math.floor(t * (pts.length - 1)));
      const at = pts[idx], rAt = radii[idx];
      const pd = pts[idx + 1].clone().sub(at).normalize();
      const out = randPerp(pd, rng);
      const ang = 0.55 + rng.next() * 0.55;
      const cd = pd.clone().multiplyScalar(Math.cos(ang)).addScaledVector(out, Math.sin(ang)).add(V3(0, 0.15, 0)).normalize();
      branch(at, cd, len * (0.42 + rng.next() * 0.25), rAt * (0.55 + rng.next() * 0.15), level + 1);
    }
  };
  const lean = V3((rng.next() - 0.5) * 0.25, 1, (rng.next() - 0.5) * 0.15).normalize();
  branch(V3(0, -0.2, 0), lean, height * 0.62, r0, 0);
  // root flares
  if (!lod) for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rng.next() * 0.5;
    const pts = [V3(0, 0.55, 0), V3(Math.cos(a) * r0 * 1.6, 0.12, Math.sin(a) * r0 * 1.6), V3(Math.cos(a) * r0 * 3.2, -0.12, Math.sin(a) * r0 * 3.2)];
    parts.push(tube(pts, [r0 * 0.55, r0 * 0.35, r0 * 0.1], { sides: 5, rng, mask: () => [charBase + 0.2, 0, 0, 1] }));
  }
  return merge(parts);
}

/** placements: [{ x, y, z, s, yaw }] per variant index. */
export function plantTrees(ctx, mat, variants, placements, name = 'deadTrees') {
  const out = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  variants.forEach((geo, vi) => {
    const list = placements.filter((p) => p.v === vi);
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((p, i) => { e.set((p.tilt || 0), p.yaw || 0, (p.tilt2 || 0)); q.setFromEuler(e); m4.compose(V3(p.x, p.y, p.z), q, V3(p.s, p.s * (p.sy || 1), p.s)); im.setMatrixAt(i, m4); });
    im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere(); im.name = name;
    ctx.group.add(im);
    out.push(im);
  });
  return out;
}
