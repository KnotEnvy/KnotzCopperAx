// Thieves' Night camp — procedural prop geometry (vertex-coloured × atlas texture, baked AO/grime, merged per material).
// Everything is built at game scale (1 unit = 1 m, Y up, +Z toward the camera, origin on the ground).
//   const b = new Geo();  tent(b, M(x,y,z,yaw), {...});  bedroll(b, ...);  …  b.build() → BufferGeometry
// r10: every surface carries tile-unit UVs + a cell rect into the camp atlas (./tex.js): bark with fissures, end-grain rings, wool
// plaid / quilt with stitching, faceted lichen rock, hammered iron, canvas weave, frond cards for the conifers. Normals are welded
// by position at build() so seams of wrapped surfaces light smoothly.
// Props: tent · bedroll · fireRing (rocks + charred teepee logs) · rock · logSeat · firewood · tripod (+ hammered cauldron on a chain)
// · potStash · sack · post · stump (+ axe) · conifer (4 species; instanced tree ring) · bush (ferns) · crate.
import * as THREE from 'three';
import { CELL, cellRect } from './tex.js';

const TAU = Math.PI * 2;
const _c = new THREE.Color();
export const col = (hex, k = 1) => { _c.set(hex); return [_c.r * k, _c.g * k, _c.b * k]; };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const sat = (x) => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** Seeded hash noise (value noise, 1D/2D/3D-ish) — deterministic geometry. */
export function rngFrom(seed) { let s = (seed * 9301 + 49297) % 233280; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); }
const hash = (x, y = 0, z = 0) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
export function vnoise(x, y = 0, z = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const L = (a, b, t) => a + (b - a) * t;
  const n = (i, j, k) => hash(xi + i, yi + j, zi + k);
  return L(L(L(n(0, 0, 0), n(1, 0, 0), u), L(n(0, 1, 0), n(1, 1, 0), u), v), L(L(n(0, 0, 1), n(1, 0, 1), u), L(n(0, 1, 1), n(1, 1, 1), u), v), w);
}
const fbm = (x, y, z, o = 3) => { let a = 0, f = 1, amp = 0.5; for (let i = 0; i < o; i++) { a += vnoise(x * f, y * f, z * f) * amp; f *= 2.03; amp *= 0.5; } return a / (1 - Math.pow(0.5, o)); };

/** Placement matrix: position + yaw (+ optional pitch/roll, scale). */
export function M(x = 0, y = 0, z = 0, yaw = 0, { pitch = 0, roll = 0, s = 1 } = {}) {
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ')), new THREE.Vector3(s, s, s));
  return m;
}
const mm = (a, b) => (a ? new THREE.Matrix4().multiplyMatrices(a, b) : b.clone());
const R_WHITE = cellRect(CELL.white);
/** Texture tile count for a circumference (≈ 1.28 m per atlas cell; whole numbers when ≥ 1 so the wrap seam is invisible). */
const tileAround = (circ) => (circ < 1.28 ? Math.max(0.25, circ / 1.28) : Math.round(circ / 1.28));

export class Geo {
  constructor() { this.P = []; this.C = []; this.I = []; this.U = []; this.Q = []; this.W = []; this.n = 0; }
  /** Raw add: pts [[x,y,z]…] (local), idx triangles, cols [[r,g,b]…], transform m, uvs [[s,t]…] (tile units), cell rect. */
  add(pts, idx, cols, m = null, uvs = null, rect = R_WHITE, smoothN = true) {
    const v = new THREE.Vector3();
    for (let i = 0; i < pts.length; i++) {
      v.set(pts[i][0], pts[i][1], pts[i][2]); if (m) v.applyMatrix4(m);
      this.P.push(v.x, v.y, v.z); const c = cols[i]; this.C.push(c[0], c[1], c[2]);
      if (uvs) this.U.push(uvs[i][0], uvs[i][1]); else this.U.push(0.5, 0.5);
      this.Q.push(rect[0], rect[1], rect[2], rect[3]); this.W.push(smoothN ? 1 : 0);
    }
    for (const k of idx) this.I.push(k + this.n);
    this.n += pts.length;
  }
  /** Parametric sheet: fn(u, v) → [x,y,z]; colFn(u, v, p, pw) → rgb (pw = point after the placement matrix). Seams duplicate their
   *  column (UVs wrap cleanly); build() welds the normals. opts: cell, tile [su, sv] (or uv(u,v,p) → [s,t]), flip, smoothN. */
  grid(nu, nv, fn, colFn, m = null, { flip = false, cell = CELL.white, tile = [1, 1], uv = null, smoothN = true } = {}) {
    const pts = [], cols = [], idx = [], uvs = [], cu = nu + 1, tmp = new THREE.Vector3();
    for (let j = 0; j <= nv; j++) for (let i = 0; i < cu; i++) {
      const u = i / nu, v = j / nv; const p = fn(u, v); pts.push(p);
      let pw = p; if (m) { tmp.set(p[0], p[1], p[2]).applyMatrix4(m); pw = [tmp.x, tmp.y, tmp.z]; }
      cols.push(colFn(u, v, p, pw)); uvs.push(uv ? uv(u, v, p) : [u * tile[0], v * tile[1]]);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = j * cu + i, b = j * cu + i + 1, c = (j + 1) * cu + i + 1, d = (j + 1) * cu + i;
      if (flip) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d);
    }
    this.add(pts, idx, cols, m, uvs, cellRect(cell), smoothN);
  }
  /** Surface of revolution around local +Y: prof [[r, y]…] bottom→top; rFn(a, t) radius multiplier; caps (planar disk UVs). */
  lathe(prof, seg, colFn, m = null, { rFn = null, capTop = false, capBot = false, cell = CELL.white, tile = [1, 1], capCell = null } = {}) {
    const nv = prof.length - 1;
    this.grid(seg, nv, (u, v) => {
      const k = Math.min(nv, Math.round(v * nv)); const [r, y] = prof[k]; const a = u * TAU;
      const rr = r * (rFn ? rFn(a, k / nv) : 1);
      return [Math.cos(a) * rr, y, -Math.sin(a) * rr];
    }, (u, v, p, pw) => colFn(u, v, p, pw), m, { cell, tile });
    const cap = (k, up) => {
      const [r, y] = prof[k]; if (r <= 1e-4) return;
      const pts = [[0, y, 0]], cols = [colFn(0.5, k / nv, [0, y, 0], m ? new THREE.Vector3(0, y, 0).applyMatrix4(m).toArray() : [0, y, 0], true)], uvs = [[0.5, 0.5]], idx = [];
      for (let i = 0; i < seg; i++) {
        const a = i / seg * TAU; const rr = r * (rFn ? rFn(a, k / nv) : 1); const p = [Math.cos(a) * rr, y, -Math.sin(a) * rr];
        pts.push(p); cols.push(colFn(i / seg, k / nv, p, m ? new THREE.Vector3(...p).applyMatrix4(m).toArray() : p, true)); uvs.push([0.5 + p[0] / (2 * r), 0.5 + p[2] / (2 * r)]);
      }
      for (let i = 0; i < seg; i++) { const a = 1 + i, b = 1 + (i + 1) % seg; if (up) idx.push(0, a, b); else idx.push(0, b, a); }
      this.add(pts, idx, cols, m, uvs, cellRect(capCell ?? cell));
    };
    if (capTop) cap(nv, true);
    if (capBot) cap(0, false);
  }
  /** Cylinder between two local points (sticks, poles, logs, ropes). ridge(a, t) multiplies the radius (bark ridges). */
  rod(a, b, r0, r1, seg, colFn, m = null, { rings = 1, noise = 0, seed = 0, caps = false, ridge = null, cell = CELL.white, capCell = null, tile = null } = {}) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), L = d.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    const m2 = new THREE.Matrix4().compose(A, q, new THREE.Vector3(1, 1, 1));
    if (m) m2.premultiply(m);
    const prof = []; for (let i = 0; i <= rings; i++) prof.push([r0 + (r1 - r0) * i / rings, L * i / rings]);
    const rm = Math.max(r0, r1);
    this.lathe(prof, seg, colFn, m2, {
      rFn: (noise || ridge) ? (ang, t) => (noise ? 1 + (vnoise(Math.cos(ang) * 2 + seed, Math.sin(ang) * 2, t * L * 3) - 0.5) * noise : 1) * (ridge ? ridge(ang, t) : 1) : null,
      capTop: caps, capBot: caps, cell, capCell, tile: tile || [tileAround(TAU * rm), Math.max(0.25, L / 1.28)],
    });
  }
  /** Rounded lumpy blob (sacks, bush clumps): radii rx, ry, rz; noise amplitude; flattened bottom. */
  blob(c, rx, ry, rz, colFn, m = null, { seg = 10, rings = 6, noise = 0.25, seed = 1, flatBottom = true, cell = CELL.white, tile = [2, 2] } = {}) {
    this.grid(seg, rings, (u, v) => {
      const th = u * TAU, ph = v * Math.PI;
      const nx = Math.sin(ph) * Math.cos(th), ny = -Math.cos(ph), nz = Math.sin(ph) * Math.sin(th);
      const k = 1 + (fbm(nx * 1.6 + seed, ny * 1.6, nz * 1.6, 3) - 0.5) * 2 * noise;
      let y = ny * ry * k; if (flatBottom && y < 0) y *= 0.25;
      return [c[0] + nx * rx * k, c[1] + y, c[2] - nz * rz * k];
    }, colFn, m, { flip: true, cell, tile });
  }
  /** Box (crates): centre, half sizes; planar UVs per face (0..1 per face). */
  box(c, h, colFn, m = null, { cell = CELL.white, tile = 1 } = {}) {
    const [x, y, z] = c, [a, b, d] = h;
    const F = [[[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]],
      [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]];
    const U = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const f of F) {
      const pts = f.map((s) => [x + s[0] * a, y + s[1] * b, z + s[2] * d]);
      this.add(pts, [0, 1, 2, 0, 2, 3], pts.map((p) => colFn(p)), m, U.map((q) => [q[0] * tile, q[1] * tile]), cellRect(cell), false);
    }
  }
  /** Flat disk facing local +Y at y=0 (log ends, stump tops): rFn(angle) radius multiplier, dip = how far the centre sinks, chamfered rim. */
  disk(r, seg, colFn, m = null, { rFn = null, dip = 0, cell = CELL.grain, rimCol = null, chamfer = 0.06 } = {}) {
    const pts = [[0, -dip, 0]], uvs = [[0.5, 0.5]], idx = [], cols = [colFn(0.5, 0.5, [0, 0, 0])];
    const rr = (a) => r * (rFn ? rFn(a) : 1);
    for (let i = 0; i < seg; i++) { const a = i / seg * TAU, q = rr(a) * (1 - chamfer); const p = [Math.cos(a) * q, 0, -Math.sin(a) * q]; pts.push(p); cols.push(colFn(0.5 + p[0] / (2 * r), 0.5 + p[2] / (2 * r), p)); uvs.push([0.5 + p[0] / (2 * r), 0.5 + p[2] / (2 * r)]); }
    for (let i = 0; i < seg; i++) { const a = i / seg * TAU, q = rr(a); const p = [Math.cos(a) * q, -chamfer * r * 0.5, -Math.sin(a) * q]; pts.push(p); cols.push(rimCol || mul(col('#3a2c22'), 0.8)); uvs.push([0.5 + p[0] / (2 * r), 0.5 + p[2] / (2 * r)]); }
    for (let i = 0; i < seg; i++) { const a = 1 + i, b = 1 + (i + 1) % seg; idx.push(0, a, b); }
    for (let i = 0; i < seg; i++) { const a = 1 + i, b = 1 + (i + 1) % seg, c = 1 + seg + i, d = 1 + seg + (i + 1) % seg; idx.push(a, c, d, a, d, b); }
    this.add(pts, idx, cols, m, uvs, cellRect(cell));
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.U, 2));
    g.setAttribute('aRect', new THREE.Float32BufferAttribute(this.Q, 4));
    g.setIndex(this.I);
    g.computeVertexNormals();
    weldNormals(g, this.W);
    g.computeBoundingSphere();
    return g;
  }
}

/** Average the normals of vertices that share a position (smooth wrapped seams); W[i] = 0 keeps a vertex hard (box corners). */
function weldNormals(g, W) {
  const P = g.attributes.position, N = g.attributes.normal, map = new Map();
  for (let i = 0; i < P.count; i++) {
    if (!W[i]) continue;
    const key = Math.round(P.getX(i) * 1500) + ',' + Math.round(P.getY(i) * 1500) + ',' + Math.round(P.getZ(i) * 1500);
    let e = map.get(key); if (!e) { e = [0, 0, 0, []]; map.set(key, e); }
    e[0] += N.getX(i); e[1] += N.getY(i); e[2] += N.getZ(i); e[3].push(i);
  }
  for (const e of map.values()) { if (e[3].length < 2) continue; const l = Math.hypot(e[0], e[1], e[2]) || 1; for (const i of e[3]) N.setXYZ(i, e[0] / l, e[1] / l, e[2] / l); }
}

// ------------------------------------------------------------------------------------------------ palettes
const CANVAS = col('#9c8a66'), CANVAS_D = col('#5e4e38'), MUD = col('#2e2418'), POLE = col('#5a4030'), ROPE = col('#8a7656');
const BARK = col('#3a2c22'), BARK_D = col('#1c1510'), HEART = col('#b08a5e'), RINGS = col('#7a5a3a');
const STONE = col('#5a5650'), STONE_D = col('#24221f'), SOOT = col('#141010'), ASH = col('#4a4440');
const CLAY = col('#a8603a'), CLAY_D = col('#5a2e1c'), GLAZE = col('#2a4e9a');
const IRON = col('#2a2828'), SACK = col('#8a7250'), SACK_D = col('#4a3a28'), LEATHER = col('#5a3a24');

/** Ground-contact AO: darker toward y=0 (grime, contact shadow baked into vertices). */
const ao = (c, y, h = 0.35, k = 0.45) => mul(c, 1 - k * (1 - smooth(0, h, y)));
const barkCol = (u, v, p, pw, seed = 1, tone = 1) => ao(mul(mix(BARK, BARK_D, fbm(p[0] * 4 + seed, p[1] * 4, p[2] * 4) * 0.7), tone), pw ? pw[1] : p[1], 0.22, 0.55);

// ------------------------------------------------------------------------------------------------ props
/** A-frame canvas tent (ridge along local X, door facing +Z), sagging woven panels, open door flaps, poles, guys, stakes. */
export function tent(b, m, { L = 2.8, W = 2.5, H = 1.75, seed = 1, tint = null } = {}) {
  const cv = tint ? mix(CANVAS, col(tint), 0.35) : CANVAS;
  const hw = W / 2, hl = L / 2;
  const panel = (side) => b.grid(18, 11, (u, v) => {
    const x = -hl + u * L;
    const sag = Math.sin(Math.PI * u) * Math.sin(Math.PI * Math.min(1, v * 1.1)) * 0.11 + (vnoise(u * 6 + seed, v * 5) - 0.5) * 0.035;
    const flare = v > 0.9 ? (v - 0.9) * 0.9 : 0;                           // hem kicks out at the ground
    const zz = side * (v * hw + flare - sag * 0.8), y = H * (1 - v) - sag * 0.55 * (1 - v) + 0.02;
    return [x, Math.max(0.02, y), zz];
  }, (u, v, p, pw) => {
    let c = mix(cv, CANVAS_D, 0.25 + 0.35 * fbm(u * 5 + seed, v * 4, side, 3));
    c = mix(c, MUD, smooth(0.62, 1, v) * 0.75);                             // mud-splashed hem
    if (Math.abs(u - 0.5) < 0.012 || Math.abs(u - 0.25) < 0.008 || Math.abs(u - 0.75) < 0.008) c = mul(c, 0.72); // seams
    if (v < 0.04) c = mul(c, 0.8);
    return ao(c, pw[1], 0.3, 0.5);
  }, m, { flip: side < 0, cell: CELL.canvas, tile: [L / 0.9, hw / 0.9] });
  panel(1); panel(-1);
  // back wall + dark interior (door open at +Z)
  const back = [[-hl + 0.02, 0.02, -hw], [-hl + 0.02, 0.02, hw], [-hl + 0.02, H, 0]];
  const inCol = mul(CANVAS_D, 0.35);
  b.add(back, [0, 1, 2], back.map(() => inCol), m);
  const ground = [[-hl, 0.015, -hw], [hl, 0.015, -hw], [hl, 0.015, hw], [-hl, 0.015, hw]];
  b.add(ground, [0, 2, 1, 0, 3, 2], ground.map(() => mul(MUD, 0.5)), m);
  // front end: two door flaps tied back (triangular panels folded outward)
  for (const s of [-1, 1]) {
    const pts = [[hl, H, 0], [hl, 0.02, s * hw], [hl + 0.28, 0.02, s * (hw * 0.55)], [hl + 0.18, H * 0.55, s * 0.2]];
    const uvs = [[1.5, 3], [0, 0], [1, 0], [1, 2]];
    b.add(pts, s > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2], pts.map((p, i) => ao(mul(cv, i === 3 ? 0.62 : 0.8), p[1])), m, uvs, cellRect(CELL.canvas));
    b.add(pts, s > 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3], pts.map((p) => mul(CANVAS_D, 0.6)), m, uvs, cellRect(CELL.canvas));
  }
  const pc = (u, v, p, pw) => ao(mix(POLE, BARK_D, fbm(p[0] * 3, p[1] * 5, p[2] * 3) * 0.6), pw[1]);
  const bk = { cell: CELL.bark };
  b.rod([hl + 0.05, 0, 0], [hl + 0.05, H + 0.22, 0], 0.035, 0.028, 6, pc, m, bk);
  b.rod([-hl - 0.05, 0, 0], [-hl - 0.05, H + 0.22, 0], 0.035, 0.028, 6, pc, m, bk);
  b.rod([-hl - 0.2, H + 0.02, 0], [hl + 0.2, H + 0.02, 0], 0.03, 0.03, 6, pc, m, bk);
  const rc = () => ROPE;
  for (const s of [-1, 1]) {
    b.rod([s * (hl + 0.05), H + 0.15, 0], [s * (hl + 1.1), 0.05, 0], 0.008, 0.008, 4, rc, m);
    b.rod([s * (hl + 1.1), -0.05, 0], [s * (hl + 1.14), 0.22, 0], 0.025, 0.018, 5, pc, m, bk);
    for (const z of [-1, 1]) b.rod([s * (hl - 0.25), 0.05, z * (hw + 0.05)], [s * (hl - 0.25), 0.22, z * (hw + 0.2)], 0.02, 0.014, 4, pc, m, bk);
  }
}

/** Bedroll along local X (head at -X): oilcloth ground sheet, a puffy rounded pad (plaid wool or stitched quilt) with a bound edge and
 *  folds, a turned-back top sheet with a rolled fold, a stitched pillow, and a strapped cloak roll at the foot. */
export function bedroll(b, m, { L = 2.0, W = 0.95, color = '#6a2a22', stripe = '#c8a060', seed = 3, cloth = 'wool' } = {}) {
  const base = col(color), st = col(stripe), dark = mul(col(color), 0.45), oil = col('#3a3624'), linen = mix(st, col('#d8cfb4'), 0.55);
  // 1) oilcloth ground sheet, wavy hem, mud at the rim
  const TL = L + 0.34, TW = W + 0.3;
  b.grid(20, 10, (u, v) => {
    const edge = Math.min(u * TL, (1 - u) * TL, v * TW, (1 - v) * TW), rim = smooth(0, 0.07, edge);
    return [-TL / 2 + u * TL + (fbm(u * 6 + seed, v * 3, 1, 2) - 0.5) * 0.06 * (1 - rim), 0.01 + 0.014 * rim + (fbm(u * 5 + seed, v * 4, 2, 3) - 0.5) * 0.025 * rim, -TW / 2 + v * TW + (fbm(u * 3, v * 6 + seed, 3, 2) - 0.5) * 0.05 * (1 - rim)];
  }, (u, v, p) => mix(mul(oil, 0.5 + 0.5 * fbm(u * 7, v * 5, seed, 3)), MUD, 1 - smooth(0.0, 0.18, Math.min(u * TL, (1 - u) * TL, v * TW, (1 - v) * TW))), m, { cell: CELL.leather, tile: [TL / 0.7, TW / 0.7] });
  // 2) the pad: rounded cross-section (quarter circle at the rim), long drape folds, bound edge
  const PL = L - 0.1, PW = W - 0.06, rr = 0.075;
  b.grid(34, 14, (u, v) => {
    const edge = Math.min(u * PL, (1 - u) * PL, v * PW, (1 - v) * PW), k = sat(edge / rr);
    const h = 0.095 * Math.sqrt(Math.max(0, 1 - (1 - k) * (1 - k)));
    const x = -PL / 2 + u * PL, z = -PW / 2 + v * PW;
    const fold = Math.sin(u * PL * 9.5 + fbm(u * 3, v * 3, seed, 2) * 4) * 0.0055 * (0.3 + 0.7 * smooth(0.1, 0.5, v) * smooth(0.1, 0.5, 1 - v)) + (fbm(u * 3.2 + seed, v * 2.4, 4, 3) - 0.5) * 0.035 * k;
    const slump = -0.02 * Math.pow(Math.abs(v - 0.5) * 2, 2) * 0 + 0.012 * Math.sin(u * Math.PI) * Math.sin(v * Math.PI); // belly
    return [x - (1 - k) * Math.sign(u - 0.5) * 0, 0.035 + h + fold + slump, z];
  }, (u, v, p, pw) => {
    const edge = Math.min(u * PL, (1 - u) * PL, v * PW, (1 - v) * PW);
    let c = mix(base, dark, 0.3 * fbm(u * 8, v * 8, seed, 2));
    if (cloth === 'wool') { const band = Math.abs(((u * 7 + 0.5) % 1) - 0.5) < 0.055 || Math.abs(((v * 3 + 0.5) % 1) - 0.5) < 0.045; if (band) c = mix(c, st, 0.5); }
    if (edge < 0.022) c = mix(c, mix(st, dark, 0.35), 0.85);                       // bound edge
    return mul(ao(c, pw[1] - 0.03, 0.06, 0.55), 0.62 + 0.38 * smooth(0.0, 0.06, edge));
  }, m, { cell: cloth === 'wool' ? CELL.wool : CELL.quilt, tile: [PL / (cloth === 'wool' ? 0.9 : 1.0), PW / (cloth === 'wool' ? 0.9 : 1.0)] });
  // 3) turned-back top sheet: a rolled fold, then the flap lying toward the foot
  const fx = PL / 2 - 0.62, fz0 = -PW / 2 + 0.06, fw = PW - 0.12;
  b.rod([fx, 0.152, fz0], [fx, 0.152, fz0 + fw], 0.036, 0.036, 9, (u, v, p) => mix(linen, mul(linen, 0.7), 0.4 + 0.3 * vnoise(u * 5, v * 3)), m, { caps: true, noise: 0.16, seed, cell: CELL.wool, capCell: CELL.wool });
  b.grid(10, 8, (u, v) => {
    const x = fx + 0.03 + v * 0.46, z = fz0 + u * fw, w = fbm(u * 5 + seed, v * 3, 7, 2) - 0.5;
    return [x, 0.158 + 0.012 * Math.sin(v * 3.1) + w * 0.03 - 0.02 * smooth(0.6, 1, v), z + w * 0.03 * v];
  }, (u, v, p, pw) => mul(mix(linen, base, 0.12 * fbm(u * 4, v * 4, 2)), 0.78 + 0.22 * (1 - v * 0.4)), m, { cell: CELL.wool, tile: [fw / 0.9, 0.5 / 0.9] });
  // 4) pillow: plump, pinched corners, stitched seam ridge all round
  const pcx = -PL / 2 + 0.24, pcy = 0.13, pw_ = 0.4, pl_ = 0.62;
  b.grid(14, 12, (u, v) => {
    const x = pcx + (u - 0.5) * pw_, z = (v - 0.5) * pl_, e = Math.pow(Math.sin(Math.PI * u), 0.55) * Math.pow(Math.sin(Math.PI * v), 0.55);
    return [x + (fbm(u * 4, v * 4, seed + 3, 2) - 0.5) * 0.02, 0.012 + pcy + 0.105 * e - 0.02 * Math.pow(Math.abs(u - 0.5) * 2, 3) * 0 + (vnoise(u * 7, v * 6, seed) - 0.5) * 0.012, z];
  }, (u, v, p, pw) => mul(mix(linen, mul(linen, 0.8), 0.4 * fbm(u * 6, v * 6, 5, 2)), 0.62 + 0.38 * smooth(0, 0.3, pw[1] - 0.13)), m, { cell: CELL.canvas, tile: [pw_ / 0.7, pl_ / 0.7] });
  // 5) cloak roll across the foot with two leather straps + buckles
  const rx = L / 2 + 0.06, rz = 0.0;
  b.rod([rx, 0.1, rz - 0.36], [rx, 0.1, rz + 0.36], 0.095, 0.095, 12, (u, v, p) => mix(mul(base, 0.8), dark, 0.25 + 0.35 * vnoise(u * 8, v * 4, seed)), m, { caps: true, noise: 0.1, seed, cell: CELL.wool, capCell: CELL.wool });
  for (const dz of [-0.2, 0.2]) {
    b.rod([rx, 0.1, rz + dz - 0.026], [rx, 0.1, rz + dz + 0.026], 0.104, 0.104, 12, () => LEATHER, m, { cell: CELL.leather });
    b.box([rx - 0.0, 0.2, rz + dz], [0.014, 0.016, 0.024], () => mul(IRON, 1.5), m, { cell: CELL.iron });
  }
}

/** A rock: icosphere pushed through fbm noise, cut flat by random planes (angular, quarried-looking), flattened underneath, box-mapped
 *  with the lichen/rock cell. `at` = centre offset in the prop's space (so colFn sees ring-space coordinates). */
export function rock(b, m, { at = [0, 0, 0], r = 0.2, sx = 1, sy = 0.72, sz = 0.9, yaw = 0, seed = 1, cuts = 3, colFn = null, detail = 1, tone = 1 } = {}) {
  const Rn = rngFrom(seed * 31 + 7), ico = new THREE.IcosahedronGeometry(1, detail + 1), pos = ico.attributes.position;
  const planes = [];
  for (let k = 0; k < cuts; k++) { const a = Rn() * TAU, e = Rn() * 0.95 - 0.15, n = [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)]; planes.push({ n, d: 0.62 + Rn() * 0.2 }); }
  const cy = Math.cos(yaw), sn = Math.sin(yaw), P = [];
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = 1 + (fbm(x * 1.4 + seed, y * 1.4, z * 1.4, 3) - 0.5) * 0.55; x *= k; y *= k; z *= k;
    for (const pl of planes) { const t = x * pl.n[0] + y * pl.n[1] + z * pl.n[2] - pl.d; if (t > 0) { x -= pl.n[0] * t * 0.92; y -= pl.n[1] * t * 0.92; z -= pl.n[2] * t * 0.92; } }
    x *= sx * r; y *= sy * r; z *= sz * r;
    const yb = -0.2 * sy * r; if (y < yb) y = yb + (y - yb) * 0.15;
    P.push([at[0] + x * cy - z * sn, at[1] + y + sy * r * 0.18, at[2] + x * sn + z * cy]);
  }
  const pts = [], idx = [], cols = [], uvs = [], tmp = new THREE.Vector3(), off = Rn() * 3;
  for (let t = 0; t < P.length; t += 3) {
    const A = P[t], B = P[t + 1], Cc = P[t + 2];
    const nx = (B[1] - A[1]) * (Cc[2] - A[2]) - (B[2] - A[2]) * (Cc[1] - A[1]), ny = (B[2] - A[2]) * (Cc[0] - A[0]) - (B[0] - A[0]) * (Cc[2] - A[2]), nz = (B[0] - A[0]) * (Cc[1] - A[1]) - (B[1] - A[1]) * (Cc[0] - A[0]);
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz), up = ny / (Math.hypot(nx, ny, nz) || 1);
    for (let k = 0; k < 3; k++) {
      const p = P[t + k]; pts.push(p); idx.push(pts.length - 1);
      uvs.push(ay >= ax && ay >= az ? [p[0] / 0.7 + off, p[2] / 0.7] : ax >= az ? [p[2] / 0.7 + off, p[1] / 0.7] : [p[0] / 0.7 + off, p[1] / 0.7]);
      tmp.set(p[0], p[1], p[2]); if (m) tmp.applyMatrix4(m);
      let c;
      if (colFn) c = colFn(p, [tmp.x, tmp.y, tmp.z], up);
      else {
        c = mix(mix(STONE, STONE_D, fbm(p[0] * 5, p[1] * 5, p[2] * 5) * 0.8), col('#7a8266'), smooth(0.58, 0.75, fbm(p[0] * 9 + seed, p[1] * 7, p[2] * 9, 2)) * smooth(0.2, 0.8, up) * 0.5);
        c = ao(c, tmp.y - (m ? 0 : 0), 0.14, 0.5);
      }
      cols.push(mul(c, tone));
    }
  }
  b.add(pts, idx, cols, m, uvs, cellRect(CELL.rock));
}

/** Campfire: varied rocks (a stacked course at the back, flat hearth stones), an ash bed, a teepee of charred split logs + fallen ones. */
export function fireRing(b, m, { r = 0.62, seed = 7 } = {}) {
  const Rn = rngFrom(seed);
  const n = 13;
  const soot = (cr) => (p, pw, up) => {
    const d = Math.hypot(p[0], p[2]), inner = smooth(cr + 0.08, cr - 0.14, d);
    let c = mix(mix(STONE, STONE_D, fbm(p[0] * 6, p[1] * 6, p[2] * 6) * 0.7), SOOT, inner * 0.78 + smooth(0.12, 0.3, p[1]) * 0.12);
    c = mix(c, col('#c8682a'), inner * smooth(0.0, 0.16, 0.16 - p[1]) * 0.16);     // coal-lit lower inner faces
    return ao(c, pw[1], 0.12, 0.5);
  };
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU + (Rn() - 0.5) * 0.28, rr = r + (Rn() - 0.5) * 0.1, big = i % 4 === 1;
    const s = (big ? 0.26 : 0.16 + Rn() * 0.07), back = Math.sin(a) < -0.3;
    const at = [Math.cos(a) * rr, 0, Math.sin(a) * rr];
    rock(b, m, { at, r: s, sx: 1.05 + Rn() * 0.25, sy: back ? 0.95 : 0.68 + Rn() * 0.2, sz: 0.85 + Rn() * 0.2, yaw: Rn() * TAU, seed: seed + i * 3, cuts: 3 + (big ? 1 : 0), colFn: soot(r) });
    if (back && i % 2 === 0) rock(b, m, { at: [at[0] * 0.98, s * 0.95, at[2] * 0.98], r: s * 0.62, sy: 0.7, yaw: Rn() * TAU, seed: seed + i * 5, cuts: 3, colFn: soot(r) });
  }
  for (let i = 0; i < 9; i++) {                                                  // loose pebbles + two flat hearth stones outside the ring
    const a = Rn() * TAU, rr = r + 0.3 + Rn() * 0.5;
    rock(b, m, { at: [Math.cos(a) * rr, 0, Math.sin(a) * rr * 0.9], r: 0.045 + Rn() * 0.05, sy: 0.6, yaw: Rn() * TAU, seed: seed + 40 + i, cuts: 2, detail: 0, colFn: soot(r + 0.4) });
  }
  rock(b, m, { at: [0.55, 0, 0.98], r: 0.3, sx: 1.2, sy: 0.3, sz: 0.95, yaw: 0.4, seed: seed + 70, cuts: 2, colFn: soot(r + 0.6) });
  rock(b, m, { at: [-0.78, 0, 0.74], r: 0.22, sx: 1.1, sy: 0.32, sz: 0.9, yaw: -0.7, seed: seed + 71, cuts: 2, colFn: soot(r + 0.6) });
  b.grid(14, 4, (u, v) => { const a = u * TAU, rr = v * (r - 0.02); return [Math.cos(a) * rr, 0.025 + (1 - v) * 0.03 + (vnoise(a * 2, v * 3) - 0.5) * 0.02, -Math.sin(a) * rr]; },
    (u, v) => mix(mul(ASH, 0.4), ASH, v * 0.8 + 0.2 * vnoise(u * 9, v * 5)), m, { flip: true, cell: CELL.rock, tile: [1.4, 1.4] });
  // charred logs: black blocky char with glowing cracks bleeding orange near the heart of the fire
  const logC = (u, v, p, pw) => {
    const heat = smooth(0.55, 0.0, v) * 0.55 + smooth(0.0, 0.35, 0.35 - Math.abs(v - 0.5)) * 0.0;
    const crack = fbm(u * 14 + seed, v * 6, 3, 2);
    let c = mix(mix(BARK, BARK_D, fbm(p[0] * 5, p[1] * 8, p[2] * 5)), SOOT, 0.7);
    return mul(mix(c, [1.7, 0.42, 0.08], smooth(0.58, 0.72, crack) * heat * 0.85), 0.6);
  };
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * TAU + 0.3;
    b.rod([Math.cos(a) * 0.44, 0.03, Math.sin(a) * 0.44], [Math.cos(a + 0.5) * 0.05, 0.74, Math.sin(a + 0.5) * 0.05], 0.065, 0.034, 9, logC, m, { noise: 0.26, seed: seed + i, caps: true, rings: 3, cell: CELL.burnt, capCell: CELL.burnt, tile: [1, 0.55] });
  }
  b.rod([-0.58, 0.07, 0.2], [0.38, 0.1, 0.44], 0.068, 0.062, 9, logC, m, { noise: 0.22, seed: 11, caps: true, rings: 3, cell: CELL.burnt, capCell: CELL.burnt, tile: [1, 0.8] });
  b.rod([0.5, 0.06, -0.3], [-0.3, 0.075, -0.5], 0.058, 0.05, 9, logC, m, { noise: 0.22, seed: 13, caps: true, rings: 3, cell: CELL.burnt, capCell: CELL.burnt, tile: [1, 0.7] });
}

/** Wood-ridge function for bark: lengthwise ridges + a gentle waist. */
const barkRidge = (seed, k = 0.07) => (a, t) => 1 + k * Math.sin(a * 7 + vnoise(a * 1.3 + seed, t * 4) * 5) * 0.8 + k * 0.5 * Math.sin(a * 13 + seed);

/** Seat log along local X: ridged bark with worn top, knot stubs, moss, saw-cut end-grain discs. */
export function logSeat(b, m, { L = 2.2, r = 0.2, seed = 5 } = {}) {
  const worn = col('#6a5238'), moss = col('#2a3a1c');
  b.rod([-L / 2, r * 0.9, 0], [L / 2, r * 0.9, 0], r, r * 0.9, 14, (u, v, p, pw) => {
    const up = Math.cos(u * TAU), ny = pw[1] > r * 1.2 ? 1 : 0;                  // u around the log; u=0 faces +X of the rod's frame
    let c = barkCol(u, v, p, pw, seed);
    c = mix(c, worn, 0.5 * smooth(0.55, 1.0, Math.sin(u * TAU)) * smooth(0.15, 0.4, v) * smooth(0.85, 0.6, v)); // seat wear
    c = mix(c, moss, 0.55 * smooth(0.6, 0.75, fbm(u * 6 + seed, v * 5, 1, 3)) * (0.3 + 0.7 * (ny ? 1 : 0.4)));
    void up; return c;
  }, m, { rings: 8, noise: 0.14, seed, ridge: barkRidge(seed), cell: CELL.bark });
  const endRim = mul(BARK, 0.8);
  for (const s of [-1, 1]) b.disk(s < 0 ? r : r * 0.9, 18, (u, v) => mix(mul(HEART, 0.85), RINGS, 0.15 * vnoise(u * 8, v * 8)), mm(m, M(s * L / 2, r * 0.9, 0, 0, { roll: s < 0 ? Math.PI / 2 : -Math.PI / 2 })), { rFn: (a) => 1 + 0.05 * Math.sin(a * 5 + seed), dip: 0.012, rimCol: endRim });
  const R2 = rngFrom(seed + 99);
  for (let i = 0; i < 3; i++) {                                                  // knot stubs
    const x = -L * 0.35 + R2() * L * 0.7, a = 0.5 + R2() * 2.1;
    b.rod([x, r * 0.9 + Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9], [x + 0.03, r * 0.9 + Math.cos(a) * (r + 0.08), Math.sin(a) * (r + 0.08)], 0.035, 0.022, 7, (u, v, p, pw) => barkCol(u, v, p, pw, seed + i, 1.15), m, { caps: true, capCell: CELL.grain, cell: CELL.bark });
  }
}

/** One split piece of firewood along local X: bark arc, two pale split faces, two end-grain wedges. */
function split(b, m, { L = 0.5, r = 0.09, span = 1.9, a0 = 0, seed = 1 } = {}) {
  const Rn = rngFrom(seed * 17 + 3), nA = 5, nX = 3;
  const pt = (x, a, rr) => [x, Math.cos(a) * rr, Math.sin(a) * rr];
  const bc = (u, v, p, pw) => barkCol(u, v, p, pw, seed, 1.2);
  b.grid(nA, nX, (u, v) => pt(-L / 2 + v * L, a0 + u * span, r * (1 + (vnoise(u * 3 + seed, v * 2) - 0.5) * 0.12)), bc, m, { cell: CELL.bark, tile: [Math.max(0.3, span * r / 1.28), L / 1.28], flip: true });
  for (const e of [0, 1]) {
    const a = a0 + e * span, dir = e ? -1 : 1;
    b.grid(1, 4, (u, v) => pt(-L / 2 + v * L, a, r * (1 - u)), (u, v, p, pw) => mul(mix(HEART, col('#d8b98a'), 0.4 * vnoise(u * 5, v * 6, seed)), 0.8 - 0.25 * u), m, { cell: CELL.wood, tile: [r / 1.28, L / 1.28], flip: dir > 0 });
  }
  for (const x of [-L / 2, L / 2]) {
    const pts = [[x, 0, 0]], uvs = [[0.5, 0.5]], idx = [], cols = [mul(HEART, 0.9)], N = 6;
    for (let i = 0; i <= N; i++) { const a = a0 + span * i / N, p = pt(x, a, r); pts.push(p); uvs.push([0.5 + p[1] / (2 * r), 0.5 + p[2] / (2 * r)]); cols.push(mul(mix(HEART, RINGS, 0.2 + 0.2 * Rn()), 0.9)); }
    for (let i = 0; i < N; i++) idx.push(...(x < 0 ? [0, i + 2, i + 1] : [0, i + 1, i + 2]));
    b.add(pts, idx, cols, m, uvs, cellRect(CELL.grain));
  }
}

/** Stacked firewood: two courses of split quarters + a couple of round logs, tilted a little, with stakes at each end. */
export function firewood(b, m, { seed = 20 } = {}) {
  const Rn = rngFrom(seed);
  for (let layer = 0; layer < 3; layer++) {
    const n = layer === 0 ? 5 : layer === 1 ? 4 : 2;
    for (let i = 0; i < n; i++) {
      const z = (i - (n - 1) / 2) * 0.17 + (Rn() - 0.5) * 0.03, y = 0.085 + layer * 0.145 + (Rn() - 0.5) * 0.01, x = (Rn() - 0.5) * 0.08, L = 0.78 + Rn() * 0.18;
      const mmx = mm(m, M(x, y, z, (Rn() - 0.5) * 0.14, { roll: Rn() * TAU }));
      if (Rn() < 0.28) b.rod([-L / 2, 0, 0], [L / 2, 0, 0], 0.085, 0.08, 9, (u, v, p, pw) => barkCol(u, v, p, pw, seed + i, 1.2), mm(mmx, M(0, 0, 0)), { caps: true, capCell: CELL.grain, cell: CELL.bark, noise: 0.1, seed: i });
      else split(b, mmx, { L, r: 0.098, span: 1.7 + Rn() * 0.5, a0: Rn() * 0.4, seed: seed + layer * 7 + i });
    }
  }
  for (const sx of [-0.46, 0.46]) for (const sz of [-0.46, 0.46]) b.rod([sx, 0, sz * 0.62 * 0.5], [sx, 0.52, sz * 0.62 * 0.5], 0.03, 0.026, 6, (u, v, p, pw) => barkCol(u, v, p, pw, seed + 3), m, { cell: CELL.bark });
}

/** Clay magic pot (lathe) — blue-glazed shoulders, rope-tied neck. */
export function pot(b, m, { h = 0.34, seed = 1 } = {}) {
  const prof = [[0.0, 0], [0.09, 0.005], [0.14, 0.06], [0.16, 0.14], [0.14, 0.22], [0.08, 0.27], [0.06, 0.3], [0.075, 0.34]].map(([r, y]) => [r * h / 0.34, y * h / 0.34]);
  b.lathe(prof, 14, (u, v, p, pw) => {
    let c = mix(CLAY, CLAY_D, fbm(u * 8 + seed, v * 4, 0, 2) * 0.6);
    if (v > 0.45 && v < 0.8) c = mix(c, GLAZE, 0.7);
    if (v > 0.78 && v < 0.88) c = ROPE;
    return ao(c, pw[1], 0.08, 0.5);
  }, m, { capTop: true });
}

/** Grain sack / pack (burlap weave). */
export function sack(b, m, { h = 0.55, seed = 2, tie = true } = {}) {
  b.blob([0, 0, 0], 0.26, h * 0.62, 0.22, (u, v, p, pw) => ao(mix(SACK, SACK_D, fbm(p[0] * 7 + seed, p[1] * 7, p[2] * 7) * 0.7), pw[1], 0.15, 0.5), m, { seg: 12, rings: 8, noise: 0.18, seed, cell: CELL.canvas, tile: [2.4, 2.4] });
  if (tie) b.rod([0, h * 0.58, 0], [0.02, h * 0.82, 0], 0.07, 0.03, 8, () => mul(SACK, 0.75), m, { cell: CELL.canvas });
}

/** Pot stash: basket with 3 pots (the heroes' magic stock) — thieves go for this. */
export function potStash(b, m, { seed = 4 } = {}) {
  b.lathe([[0.02, 0], [0.3, 0.02], [0.33, 0.12], [0.34, 0.2]], 16, (u, v, p) => {
    const weave = (Math.sin(u * TAU * 22) * Math.sin(p[1] * 90) > 0) ? 1 : 0.72;
    return mul(col('#7a5a34'), weave * (0.55 + 0.45 * v));
  }, m, { capBot: true });
  pot(b, mm(m, M(-0.1, 0.05, 0.05)), { h: 0.34, seed });
  pot(b, mm(m, M(0.13, 0.05, -0.02, 0.4)), { h: 0.3, seed: seed + 1 });
  pot(b, mm(m, M(0.0, 0.05, -0.15, 1.2)), { h: 0.26, seed: seed + 2 });
}

/** Torus link/ring (chain links, hooks): R major, r minor, lying in the XZ plane of m. */
function torus(b, m, R, r, colFn, { seg = 10, tube = 6, cell = CELL.iron } = {}) {
  b.grid(seg, tube, (u, v) => { const a = u * TAU, t = v * TAU, rr = R + r * Math.cos(t); return [rr * Math.cos(a), r * Math.sin(t), -rr * Math.sin(a)]; }, colFn, m, { cell, tile: [2, 1] });
}

/** Cooking tripod over the fire: lashed poles, a hand-chain of iron links and a hammered-iron cauldron on a bail handle. */
export function tripod(b, m, { H = 1.5 } = {}) {
  const pc = (u, v, p, pw) => mix(mix(POLE, BARK_D, fbm(p[0] * 4, p[1] * 4, p[2] * 4) * 0.5), SOOT, smooth(1.1, 0.0, pw[1]) * 0.65);
  const top = [0, H + 0.1, 0];
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * TAU + 0.5;
    b.rod([Math.cos(a) * 0.92, 0, Math.sin(a) * 0.92], [Math.cos(a) * -0.07, H + 0.1, Math.sin(a) * -0.07], 0.034, 0.024, 8, pc, m, { rings: 4, noise: 0.18, seed: i, cell: CELL.bark, caps: true, capCell: CELL.grain });
  }
  for (const [y, rr] of [[H - 0.02, 0.115], [H - 0.1, 0.1]]) b.rod([0, y, 0], [0, y + 0.075, 0], rr, rr, 12, (u, v) => mul(ROPE, 0.42 + 0.3 * ((Math.floor(v * 4) & 1) ? 1 : 0.7)), m, { cell: CELL.leather, noise: 0.06, seed: 1, caps: true });
  // chain from the lashing down to the bail
  const links = 9, y0 = H - 0.12, y1 = 1.08, dy = (y0 - y1) / links, lc = () => mul(IRON, 1.6);
  for (let i = 0; i < links; i++) {
    const y = y0 - dy * (i + 0.5);
    torus(b, mm(m, mm(M(0, y, 0, i % 2 ? Math.PI / 2 : 0), M(0, 0, 0, 0, { pitch: Math.PI / 2 }))), dy * 0.52, 0.0085, lc, { seg: 8, tube: 5 });
  }
  b.rod([0, y1 + 0.01, 0], [0, 0.97, 0], 0.012, 0.012, 6, lc, m, { cell: CELL.iron });
  // the cauldron: belly, flanged rim, three stubby feet, bail handle; hammered, sooted below, warm-lit underneath
  const cy = 0.66, S = 1.0;
  const ic = (u, v, p, pw) => {
    const dent = fbm(u * 18, v * 9, 1, 2);
    let c = mix(mul(IRON, 1.55), mul(IRON, 0.8), dent * 0.7);
    c = mix(c, SOOT, smooth(0.5, 0.0, v) * 0.7);                                  // soot toward the bottom
    c = mix(c, [1.4, 0.45, 0.12], smooth(0.35, 0.0, v) * 0.18);                   // flame-lit belly
    return mul(c, 0.8 + 0.4 * smooth(0.9, 1.0, v));
  };
  b.lathe([[0.0, cy + 0.0], [0.11 * S, cy + 0.008], [0.19 * S, cy + 0.05], [0.235 * S, cy + 0.13], [0.24 * S, cy + 0.2], [0.22 * S, cy + 0.27], [0.19 * S, cy + 0.31], [0.205 * S, cy + 0.32], [0.215 * S, cy + 0.33], [0.2 * S, cy + 0.335]], 26, ic, mm(m, M(0, 0, 0)), { cell: CELL.iron, tile: [3, 1.5], rFn: (a, t) => 1 + 0.012 * Math.sin(a * 5 + 1) });
  b.lathe([[0.19 * S, cy + 0.335], [0.185 * S, cy + 0.31], [0.17 * S, cy + 0.2], [0.0, cy + 0.2]], 22, (u, v) => mix([0.015, 0.012, 0.01], [0.16, 0.05, 0.02], smooth(0.3, 1, v) * 0.2), m, { cell: CELL.iron });   // dark inside
  for (let i = 0; i < 3; i++) { const a = i / 3 * TAU + 0.3; b.rod([Math.cos(a) * 0.09, cy + 0.0, Math.sin(a) * 0.09], [Math.cos(a) * 0.14, cy - 0.055, Math.sin(a) * 0.14], 0.022, 0.016, 6, ic, m, { caps: true, cell: CELL.iron }); }
  for (const s of [-1, 1]) b.box([s * 0.215, cy + 0.3, 0], [0.012, 0.018, 0.018], () => mul(IRON, 1.4), m, { cell: CELL.iron });   // handle lugs
  const N = 12;                                                                   // bail handle arc
  for (let i = 0; i < N; i++) {
    const a0 = Math.PI * i / N, a1 = Math.PI * (i + 1) / N, R = 0.215 * S;
    b.rod([-Math.cos(a0) * R, cy + 0.3 + Math.sin(a0) * 0.2, 0], [-Math.cos(a1) * R, cy + 0.3 + Math.sin(a1) * 0.2, 0], 0.01, 0.01, 5, lc, m, { cell: CELL.iron });
  }
  void top;
}

/** Tether post (beasts are tied here). */
export function post(b, m) {
  b.rod([0, -0.1, 0], [0, 1.2, 0], 0.08, 0.065, 9, (u, v, p, pw) => barkCol(u, v, p, pw, 2, 1.1), m, { noise: 0.15, caps: true, ridge: barkRidge(3), cell: CELL.bark, capCell: CELL.grain, rings: 3 });
  b.rod([0, 0.95, 0.07], [0.02, 0.9, 0.09], 0.09, 0.09, 10, () => ROPE, m, { cell: CELL.leather });
}

/** A hand axe: ash handle, iron head (poll + wedge blade). Handle along +Y in its own frame. */
export function axe(b, m) {
  b.rod([0, 0, 0], [0, 0.55, 0], 0.017, 0.022, 7, (u, v) => mix(col('#b08a5e'), col('#6a4a2a'), v * 0.5), m, { cell: CELL.wood, caps: true });
  b.box([0.0, 0.54, 0], [0.032, 0.036, 0.02], () => mul(IRON, 1.7), m, { cell: CELL.iron });
  const pts = [[0.03, 0.585, 0.015], [0.03, 0.495, 0.015], [0.12, 0.47, 0.012], [0.12, 0.61, 0.012]], pb = pts.map((p) => [p[0], p[1], -p[2]]);
  b.add(pts, [0, 1, 2, 0, 2, 3], pts.map(() => mul(IRON, 1.9)), m, [[0, 0], [0, 1], [1, 1], [1, 0]], cellRect(CELL.iron));
  b.add(pb, [0, 2, 1, 0, 3, 2], pb.map(() => mul(IRON, 1.9)), m, [[0, 0], [0, 1], [1, 1], [1, 0]], cellRect(CELL.iron));
}

/** Chopping stump: root flares, ridged bark, a worn end-grain top with an axe stuck in it. */
export function stump(b, m, { r = 0.32, h = 0.45, seed = 9, withAxe = false } = {}) {
  b.lathe([[r * 1.5, 0], [r * 1.2, 0.07], [r * 1.02, 0.2], [r * 0.97, h * 0.8], [r * 0.95, h]], 18, (u, v, p, pw) => barkCol(u, v, p, pw, seed), m,
    { rFn: (a, t) => (1 + (vnoise(a * 2 + seed, t) - 0.5) * 0.2) * (1 + 0.32 * Math.pow(Math.max(0, Math.sin(a * 5 + seed)), 2) * Math.max(0, 1 - t * 3)) * (1 + 0.05 * Math.sin(a * 11 + seed) * (1 - t)), cell: CELL.bark, tile: [Math.max(1, Math.round(TAU * r / 1.28)), 0.5] });
  b.disk(r * 0.95, 20, (u, v) => mix(mul(HEART, 0.85), RINGS, 0.15 * vnoise(u * 9, v * 9)), mm(m, M(0, h, 0)), { rFn: (a) => 1 + (vnoise(a * 2 + seed, 0.5) - 0.5) * 0.1, dip: 0.012 });
  if (withAxe) axe(b, mm(m, M(0.04, h + 0.012, 0.0, 0.5, { roll: -0.38 })));
}

export function crate(b, m, { s = 0.5 } = {}) {
  const wd = col('#6a4e34');
  b.box([0, s / 2, 0], [s / 2, s / 2, s / 2], (p) => ao(mix(wd, BARK_D, 0.3 + 0.4 * vnoise(p[0] * 9, p[1] * 9, p[2] * 9)), p[1], 0.2, 0.5), m, { cell: CELL.plank });
  for (const y of [0.07, s - 0.07]) b.box([0, y, s / 2 + 0.01], [s / 2 + 0.01, 0.04, 0.012], () => mul(wd, 0.55), m, { cell: CELL.wood });
}

// ------------------------------------------------------------------------------------------------ conifers
/** One drooping needle frond card along local +X (width in Z, droop/rise in Y), alpha-textured with the needles cell. */
function frond(b, m, { len = 1.2, wid = 0.7, droop = 0.3, rise = 0.12, tint = 0, v0 = 0, vt = 1, deep, mid, tip, steps = 3, seed = 1 }) {
  b.grid(2, steps, (u, v) => {
    const t = v, taper = 0.22 + 0.78 * Math.sin(Math.PI * (0.16 + 0.72 * t)), lat = (u - 0.5) * wid * taper;
    return [len * t, rise * len * t - droop * len * t * t - Math.abs(lat) * 0.18 * (1 - t), lat];
  }, (u, v, p, pw) => {
    const n = fbm(u * 3 + seed, v * 4, 0, 2);
    let c = mix(mix(deep, mid, smooth(0.0, 0.5, v) * (0.5 + n * 0.6)), tip, smooth(0.45, 1.0, v) * (0.35 + n * 0.5));
    return mul(c, tint ? 1 + tint * (n - 0.5) : 1);
  }, m, { cell: CELL.needles, tile: [1, 1], smoothN: false });
}

const CONIFER = {
  // spruce: dense, strongly drooping skirts
  spruce: { H: 8.6, R: 1.75, tiers: 12, start: 0.12, n0: 11, droop: 0.34, rise: 0.1, taper: 0.8, core: 0.44, lean: 0.015, pal: ['#07110d', '#14281c', '#3a5640'] },
  // fir: narrow and tall, upswept boughs
  fir: { H: 9.6, R: 1.2, tiers: 14, start: 0.1, n0: 9, droop: 0.2, rise: 0.22, taper: 0.9, core: 0.4, lean: 0.02, pal: ['#08120f', '#183024', '#3e5d48'] },
  // scots pine: bare lower trunk, ragged flat-topped crown pads
  pine: { H: 9.2, R: 1.5, tiers: 6, start: 0.52, n0: 8, droop: 0.12, rise: 0.12, taper: 0.55, core: 0.32, lean: 0.06, pal: ['#0a140e', '#1d3524', '#50704a'], pads: true },
  // young spruce / sapling
  young: { H: 4.6, R: 1.05, tiers: 8, start: 0.06, n0: 8, droop: 0.3, rise: 0.12, taper: 0.8, core: 0.42, lean: 0.03, pal: ['#09130e', '#193020', '#44634a'] },
  // dead snag: bare trunk with broken branch stubs
  snag: { H: 6.2, R: 0.0, tiers: 0, start: 0, n0: 0, droop: 0, rise: 0, taper: 1, core: 0, lean: 0.05, pal: ['#09130e', '#193020', '#44634a'], snag: true },
};

/** Conifer for the instanced tree ring: tapered ridged trunk, tiers of frond cards (jagged needle silhouettes with alpha), a dark inner
 *  core so no sky shows through, a leader spike. `variant`: spruce | fir | pine | young | snag; `lod` 0 = full, 1 = far (fewer/larger cards). */
export function conifer(b, m, { variant = 'spruce', seed = 1, lod = 0 } = {}) {
  const V = CONIFER[variant] || CONIFER.spruce, Rn = rngFrom(seed * 53 + 11);
  const [cDeep, cMid, cTip] = V.pal.map((h) => col(h));
  const H = V.H, lean = V.lean * H;
  const trunkX = (y) => lean * Math.pow(y / H, 2) * (seed % 2 ? 1 : -1);
  const trunkR = (y) => 0.26 * (1 - 0.92 * Math.pow(Math.max(0, y) / H, 0.8)) + 0.025;
  const nSeg = 6;
  const tc = (u, v, p, pw) => mix(mix(BARK, BARK_D, 0.45 + 0.4 * fbm(p[0] * 3, p[1] * 3, p[2] * 3)), col('#07110d'), smooth(0.2, 0.9, v) * 0.0);
  for (let i = 0; i < nSeg; i++) {
    const y0 = H * i / nSeg * 0.97 - (i ? 0 : 0.3), y1 = H * (i + 1) / nSeg * 0.97;
    b.rod([trunkX(y0), y0, 0], [trunkX(y1), y1, 0], trunkR(y0), trunkR(y1), 7, tc, m, { cell: CELL.bark, noise: 0.18, seed: seed + i, ridge: barkRidge(seed, 0.09), tile: [1, Math.max(0.4, (y1 - y0) / 1.28)] });
  }
  if (V.snag) {                                                                  // broken branch stubs, no foliage
    for (let k = 0; k < 9; k++) {
      const y = 1.4 + Rn() * (H * 0.75), a = Rn() * TAU, l = 0.35 + Rn() * 0.7;
      b.rod([trunkX(y), y, 0], [trunkX(y) + Math.cos(a) * l, y + 0.1 + Rn() * 0.25 - l * 0.15, Math.sin(a) * l], trunkR(y) * 0.5, 0.012, 5, tc, m, { cell: CELL.bark });
    }
    return;
  }
  const nA = (n) => Math.max(5, Math.round(n * (lod ? 0.65 : 1)));
  const steps = lod ? 2 : 3;
  const upTop = V.pads ? 0.0 : 0.04;
  for (let k = 0; k < V.tiers; k++) {
    const t = k / (V.tiers - 1), y = H * (V.start + (0.97 - V.start) * t) - (V.pads ? 0 : 0);
    const R = V.R * (1 - t * V.taper) * (V.pads ? (0.7 + 0.5 * Rn()) : (0.9 + 0.2 * Rn()));
    const n = nA(V.n0 * (1 - t * 0.5) + 2);
    const ph = Rn() * TAU, tx = trunkX(y);
    for (let i = 0; i < n; i++) {
      const a = ph + i / n * TAU + (Rn() - 0.5) * 0.4, len = R * (0.8 + Rn() * 0.45), wid = len * (0.52 + Rn() * 0.16);
      const mmx = mm(m, M(tx, y + (Rn() - 0.5) * 0.25 * (H / 9), 0, a, { roll: V.pads ? (Rn() - 0.5) * 0.25 : 0 }));
      frond(b, mmx, { len, wid, droop: V.droop * (1 - t * 0.55) * (0.75 + Rn() * 0.5), rise: V.rise + upTop * t, deep: cDeep, mid: cMid, tip: cTip, steps, seed: seed * 7 + k * 3 + i });
    }
    if (!lod) {                                                                  // a second, shorter, upper layer fills gaps between the long boughs
      const n2 = Math.max(4, Math.round(n * 0.7));
      for (let i = 0; i < n2; i++) {
        const a = ph + (i + 0.5) / n2 * TAU + (Rn() - 0.5) * 0.5, len = R * (0.45 + Rn() * 0.3);
        frond(b, mm(m, M(tx, y + 0.18 * (H / 9), 0, a)), { len, wid: len * 0.85, droop: V.droop * 0.5, rise: V.rise * 1.8, deep: cDeep, mid: cMid, tip: cTip, steps: 2, seed: seed * 5 + k * 3 + i });
      }
    }
    // dark inner skirt: hides the sky between boughs and sells depth (a cone under each tier)
    b.lathe([[R * V.core * 1.5, y - 0.45 * (H / 9)], [R * V.core, y - 0.05], [R * V.core * 0.45, y + 0.25 * (H / 9)], [0.02, y + 0.55 * (H / 9)]], lod ? 8 : 10, (u, v) => mul(cDeep, 0.65 + 0.3 * v), mm(m, M(tx, 0, 0)), { cell: CELL.needles, rFn: (a) => 0.85 + 0.3 * vnoise(a * 2.4 + seed + k, k) });
  }
  for (let i = 0; i < 4; i++) frond(b, mm(m, M(trunkX(H * 0.96), H * 0.95, 0, i / 4 * TAU, { roll: 0 })), { len: 0.55, wid: 0.28, droop: -0.4, rise: 1.3, deep: cDeep, mid: cMid, tip: cTip, steps: 2, seed: i });   // leader
}
/** Back-compat: the original single pine. */
export function pine(b, m, o = {}) { conifer(b, m, { variant: 'spruce', seed: o.seed || 1 }); }

/** Foreground fern / bracken clump: arching pinnate fronds (alpha cards), near-black with a faint warm rim from the fire. */
export function bush(b, m, { r = 0.9, h = 0.8, seed = 2 } = {}) {
  const Rn = rngFrom(seed);
  const deep = col('#050805'), mid = col('#0f1a0f'), tip = col('#2c3d24');
  const n = Math.round(10 + r * 8);
  for (let i = 0; i < n; i++) {
    const a = Rn() * TAU, rad = Rn() * r * 0.45, up = 0.45 + Rn() * 0.6;
    const len = h * (0.85 + Rn() * 0.8), x = Math.cos(a) * rad, z = Math.sin(a) * rad * 0.6;
    b.grid(2, 5, (u, v) => {
      const lat = (u - 0.5) * len * 0.32 * (0.35 + 0.65 * Math.sin(Math.PI * (0.1 + 0.8 * v)));
      return [len * v * up * 1.2, len * (v * (1 - 0.0) * 0.9 - 0.55 * v * v) + 0.05, lat];
    }, (u, v) => mix(mix(deep, mid, v * 0.8), tip, smooth(0.5, 1, v) * 0.5), mm(m, M(x, 0, z, a)), { cell: CELL.fern, tile: [1, 1], smoothN: false });
  }
  for (let i = 0; i < 3; i++) b.blob([(Rn() - 0.5) * r * 0.4, 0, (Rn() - 0.5) * r * 0.2], r * 0.28, h * 0.32, r * 0.2, () => mul(deep, 0.8), m, { seg: 8, rings: 4, noise: 0.3, seed: seed + i });
}
