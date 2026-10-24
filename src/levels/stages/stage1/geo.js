// Stage 1 geometry helpers: irregular timbers, tubes along curved paths, merging. Every builder returns an
// INDEXED BufferGeometry with position / normal / uv / kmask so pieces merge per material (one draw call each).
// uv convention for wood/bark: u around the circumference (0..1 × circumference in m), v along the length (m).
// kmask: r = char, g = ember glow, b/a free.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export function rngFrom(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  const next = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  return { next, range: (a, b) => a + next() * (b - a), pick: (arr) => arr[Math.floor(next() * arr.length)], sign: () => (next() < 0.5 ? -1 : 1) };
}

/** Tube through points with per-point radius; rings use parallel-transport frames. o: { sides, mask(t) → [r,g,b,a], jitter, rng, cap } */
export function tube(points, radii, o = {}) {
  const sides = o.sides ?? 6, rng = o.rng, jit = o.jitter ?? 0;
  const n = points.length;
  const pos = [], nor = [], uv = [], km = [], idx = [];
  const T = [], N = [], B = [];
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)];
    T.push(b.clone().sub(a).normalize());
  }
  let nrm = Math.abs(T[0].y) < 0.9 ? V3(0, 1, 0).cross(T[0]).normalize() : V3(1, 0, 0).cross(T[0]).normalize();
  for (let i = 0; i < n; i++) {
    if (i > 0) { const ax = T[i - 1].clone().cross(T[i]); const l = ax.length(); if (l > 1e-5) { ax.divideScalar(l); nrm.applyAxisAngle(ax, Math.acos(Math.min(1, Math.max(-1, T[i - 1].dot(T[i]))))); } }
    N.push(nrm.clone()); B.push(T[i].clone().cross(nrm).normalize());
  }
  let len = 0;
  const circ = 2 * Math.PI * (radii[0] || 0.1);
  for (let i = 0; i < n; i++) {
    if (i > 0) len += points[i].distanceTo(points[i - 1]);
    const r = radii[i], t = i / (n - 1);
    const mk = o.mask ? o.mask(t, len) : [0, 0, 0, 1];
    for (let s = 0; s <= sides; s++) {
      const ang = (s / sides) * Math.PI * 2;
      const j = rng && jit ? 1 + (rng.next() - 0.5) * jit : 1;
      const c = Math.cos(ang), sn = Math.sin(ang);
      const d = N[i].clone().multiplyScalar(c).add(B[i].clone().multiplyScalar(sn));
      const p = points[i].clone().addScaledVector(d, r * (s === sides ? 1 : j));
      pos.push(p.x, p.y, p.z); nor.push(d.x, d.y, d.z);
      uv.push((s / sides) * Math.max(circ, 0.3), len); km.push(...mk);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let s = 0; s < sides; s++) {
    const a = i * (sides + 1) + s, b = a + sides + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b); // CCW seen from outside (normals point outward)
  }
  if (o.cap !== false) {
    // tip cap (fan to the last centre)
    const base = pos.length / 3, last = points[n - 1];
    pos.push(last.x, last.y, last.z); nor.push(T[n - 1].x, T[n - 1].y, T[n - 1].z); uv.push(0, len); km.push(...(o.mask ? o.mask(1, len) : [0, 0, 0, 1]));
    const ring = (n - 1) * (sides + 1);
    for (let s = 0; s < sides; s++) idx.push(ring + s, ring + s + 1, base);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('kmask', new THREE.Float32BufferAttribute(km, 4));
  g.setIndex(idx);
  return g;
}

/** Straight irregular timber from a to b (hewn: 5-6 sides, slight bow and radius wobble). o: { r, r2, sides, bow, seg, mask, sharpen, broken } */
export function timber(a, b, o = {}) {
  const rng = o.rng || rngFrom(7);
  const seg = o.seg ?? 4, r0 = o.r ?? 0.1, r1 = o.r2 ?? r0 * 0.9;
  const dir = b.clone().sub(a), L = dir.length(); dir.normalize();
  const side = Math.abs(dir.y) < 0.9 ? V3(0, 1, 0).cross(dir).normalize() : V3(1, 0, 0).cross(dir).normalize();
  const up = dir.clone().cross(side).normalize();
  const bow = (o.bow ?? 0.02) * L, pts = [], rad = [];
  const ph = rng.next() * 6;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const off = Math.sin(t * Math.PI) * bow;
    const p = a.clone().addScaledVector(dir, L * t).addScaledVector(side, off * Math.cos(ph)).addScaledVector(up, off * Math.sin(ph));
    pts.push(p); rad.push((r0 + (r1 - r0) * t) * (1 + (rng.next() - 0.5) * 0.12));
  }
  if (o.sharpen) { // pointed stake tip
    const tip = b.clone().addScaledVector(dir, o.sharpen);
    pts.push(tip); rad.push(0.012);
  } else if (o.broken) { // jagged broken end: short extra ring slightly offset
    const tip = b.clone().addScaledVector(dir, o.broken).addScaledVector(side, (rng.next() - 0.5) * r0);
    pts.push(tip); rad.push(r1 * 0.35);
  }
  return tube(pts, rad, { sides: o.sides ?? 6, rng, jitter: o.jitter ?? 0.18, mask: o.mask, cap: true });
}

/** Box with metre-scaled uvs and kmask (for boards / wall panels). */
export function panel(w, h, d, o = {}) {
  const g = new THREE.BoxGeometry(w, h, d, o.sx ?? 1, o.sy ?? 1, 1);
  const uv = g.getAttribute('uv'), p = g.getAttribute('position'), n = g.getAttribute('normal');
  for (let i = 0; i < uv.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    const u = ax > 0.5 ? p.getZ(i) : p.getX(i), v = ay > 0.5 ? p.getZ(i) : p.getY(i);
    uv.setXY(i, u + w / 2, v + h / 2);
  }
  const km = new Float32Array(p.count * 4);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / h + 0.5;
    const m = o.mask ? o.mask(y, p.getX(i), p.getZ(i)) : [0, 0, 0, 1];
    km.set(m, i * 4);
  }
  g.setAttribute('kmask', new THREE.BufferAttribute(km, 4));
  return g;
}

export function xform(g, { pos = [0, 0, 0], rot = [0, 0, 0], scale = 1 } = {}) {
  const m = new THREE.Matrix4().compose(V3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), typeof scale === 'number' ? V3(scale, scale, scale) : V3(...scale));
  g.applyMatrix4(m);
  return g;
}

/** Merge geometries that all carry position/normal/uv/kmask (non-matching extras are dropped). */
export function merge(list) {
  const clean = list.filter(Boolean).map((g) => {
    const out = g.index ? g : g.toNonIndexed ? g : g;
    if (!out.index) { const n = out.getAttribute('position').count; out.setIndex([...Array(n).keys()]); }
    for (const k of Object.keys(out.attributes)) if (!['position', 'normal', 'uv', 'kmask'].includes(k)) out.deleteAttribute(k);
    if (!out.getAttribute('kmask')) {
      const n = out.getAttribute('position').count, a = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) a[i * 4 + 3] = 1;
      out.setAttribute('kmask', new THREE.BufferAttribute(a, 4));
    }
    if (!out.getAttribute('normal')) out.computeVertexNormals();
    return out;
  });
  if (!clean.length) return null;
  const g = mergeGeometries(clean, false);
  for (const c of clean) c.dispose();
  return g;
}

export const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Cheap 2D value noise (deterministic) for JS-side terrain/placement. */
export function vnoise(x, y, seed = 0) {
  const h = (i, j) => { let n = (i * 374761393 + j * 668265263 + seed * 982451653) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export const fbm2 = (x, y, seed = 0, oct = 4) => { let s = 0, a = 0.5, f = 1, n = 0; for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f, seed + i * 13); n += a; a *= 0.5; f *= 2; } return s / n; };
