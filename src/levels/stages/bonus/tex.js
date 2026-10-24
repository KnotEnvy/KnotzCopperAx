// Thieves' Night camp — procedural texture atlas (bonus-camp r10). One 1024² atlas (4×4 cells of 256²) painted with canvas 2D:
// albedo (neutral-ish luminance patterns — hue/AO come from vertex colours, multiplied) + a height map turned into a tangent
// normal map. Geometry carries UVs in unbounded *tile* units plus a per-vertex cell rect (aRect); the material wraps each tile
// inside its own cell (fract + textureGrad), so a 3 m log and a 0.3 m stump share one bark cell without seams or mip bleed.
// Cells: bark · grain (end-grain rings) · wool (plaid twill) · quilt (stitched diamonds) · rock · iron (hammered) · canvas weave ·
// leather · needles (pine frond, alpha) · white · wood (split face) · plank · fern (pinnate leaf, alpha) · burnt (charred bark).
import * as THREE from 'three';

const N = 1024, C = 256, GUT = 3;
export const CELL = { bark: 0, grain: 1, wool: 2, quilt: 3, rock: 4, iron: 5, canvas: 6, leather: 7, needles: 8, white: 9, wood: 10, plank: 11, fern: 12, burnt: 13 };
/** [u0, v0, du, dv] of a cell in atlas UV space (inset by GUT px against mip bleed; v is flipped: canvas y points down). */
export function cellRect(i) {
  const col = i % 4, row = Math.floor(i / 4);
  return [(col * C + GUT) / N, 1 - ((row + 1) * C - GUT) / N, (C - 2 * GUT) / N, (C - 2 * GUT) / N];
}

function mulberry(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const g255 = (l) => Math.max(0, Math.min(255, Math.round(l * 255)));
const gray = (l, a = 1) => `rgba(${g255(l)},${g255(l)},${g255(l)},${a})`;

/** One cell painter: every primitive paints luminance on the albedo canvas and height on the height canvas, wrapping across the
 *  cell edges (so tiles repeat seamlessly). */
class Cell {
  constructor(A, H, i, R) { this.A = A; this.H = H; this.i = i; this.R = R; this.x0 = (i % 4) * C; this.y0 = Math.floor(i / 4) * C; this.tint = null; }
  with(fn, x, y, w, h, wrap = true) {
    const offs = [0]; const ox = [0], oy = [0];
    if (wrap) { if (x - w < 0) ox.push(C); if (x + w > C) ox.push(-C); if (y - h < 0) oy.push(C); if (y + h > C) oy.push(-C); }
    for (const dx of ox) for (const dy of oy) for (const ctx of [this.A, this.H]) {
      ctx.save(); ctx.beginPath(); ctx.rect(this.x0, this.y0, C, C); ctx.clip(); ctx.translate(this.x0 + dx, this.y0 + dy); fn(ctx, ctx === this.A); ctx.restore();
    }
    return offs;
  }
  fill(a, h, alpha = 1) { for (const ctx of [this.A, this.H]) { ctx.save(); ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = gray(ctx === this.A ? a : h, ctx === this.A ? alpha : 1); ctx.fillRect(this.x0, this.y0, C, C); ctx.restore(); } }
  clear() { this.A.clearRect(this.x0, this.y0, C, C); this.H.fillStyle = gray(0.5); this.H.fillRect(this.x0, this.y0, C, C); }
  rect(x, y, w, h, a, hv, r = 0, alpha = 1) { this.with((ctx, isA) => { ctx.fillStyle = gray(isA ? a : hv, isA ? alpha : 1); ctx.beginPath(); if (r && ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); ctx.fill(); }, x, y, w, h); }
  circle(x, y, r, a, hv, soft = 0, alpha = 1) {
    this.with((ctx, isA) => {
      const v = isA ? a : hv;
      if (soft > 0) { const g = ctx.createRadialGradient(x, y, r * (1 - soft), x, y, r); g.addColorStop(0, gray(v, (isA ? alpha : 1))); g.addColorStop(1, gray(v, 0)); ctx.fillStyle = g; }
      else ctx.fillStyle = gray(v, isA ? alpha : 1);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }, x, y, r, r);
  }
  ellipse(x, y, rx, ry, rot, a, hv, soft = 0, alpha = 1) {
    this.with((ctx, isA) => {
      const v = isA ? a : hv;
      ctx.translate(x, y); ctx.rotate(rot); ctx.scale(1, ry / rx);
      if (soft > 0) { const g = ctx.createRadialGradient(0, 0, rx * (1 - soft), 0, 0, rx); g.addColorStop(0, gray(v, isA ? alpha : 1)); g.addColorStop(1, gray(v, 0)); ctx.fillStyle = g; }
      else ctx.fillStyle = gray(v, isA ? alpha : 1);
      ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill();
    }, x, y, Math.max(rx, ry), Math.max(rx, ry));
  }
  line(pts, w, a, hv, alpha = 1, cap = 'round') {
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    this.with((ctx, isA) => {
      ctx.strokeStyle = gray(isA ? a : hv, isA ? alpha : 1); ctx.lineWidth = w; ctx.lineCap = cap; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]); ctx.stroke();
    }, x0, y0, Math.max(x1 - x0, w), Math.max(y1 - y0, w), true);
  }
  speckle(n, a0, a1, h0, h1, rmax = 1.4) { const R = this.R; for (let k = 0; k < n; k++) this.circle(R() * C, R() * C, 0.4 + R() * rmax, a0 + R() * (a1 - a0), h0 + R() * (h1 - h0)); }
}

// ---------------------------------------------------------------------------------------------------------------- painters
function paintBark(c) {
  const R = c.R; c.fill(0.42, 0.45);
  // fissures run the length of the trunk (v along y): bright plates between dark furrows
  for (let i = 0; i < 90; i++) { const w = 7 + R() * 17, h = 36 + R() * 120, x = R() * C, y = R() * C; const l = 0.5 + R() * 0.4; c.rect(x, y, w, h, l, 0.62 + R() * 0.3, Math.min(w, h) * 0.45); }
  for (let i = 0; i < 80; i++) { const x = R() * C, y = R() * C, L = 30 + R() * 110, pts = []; for (let k = 0; k <= 6; k++) pts.push([x + Math.sin(k * 1.7 + i) * 3 + (R() - 0.5) * 2, y + L * k / 6]); c.line(pts, 1.2 + R() * 2.6, 0.1, 0.08, 0.9); }
  for (let i = 0; i < 40; i++) { const x = R() * C, y = R() * C, L = 18 + R() * 60; c.line([[x, y], [x + (R() - 0.5) * 4, y + L]], 1 + R(), 0.78, 0.9, 0.55); }
  c.speckle(500, 0.15, 0.7, 0.2, 0.8, 1.6);
}
function paintBurnt(c) {
  const R = c.R; c.fill(0.12, 0.5);
  // alligator-skin char: dark blocks separated by lighter (ashy / glowing) cracks
  for (let i = 0; i < 220; i++) { const x = R() * C, y = R() * C, w = 10 + R() * 26, h = 14 + R() * 40; c.rect(x, y, w, h, 0.06 + R() * 0.12, 0.7 + R() * 0.3, 5); }
  for (let i = 0; i < 110; i++) { const x = R() * C, y = R() * C, L = 20 + R() * 70, pts = []; for (let k = 0; k <= 5; k++) pts.push([x + (R() - 0.5) * 12, y + L * k / 5]); c.line(pts, 1 + R() * 2, 0.55 + R() * 0.3, 0.1, 0.9); }
  c.speckle(320, 0.3, 0.8, 0.3, 0.7, 1.2);
}
function paintGrain(c) {
  const R = c.R; c.fill(0.78, 0.55);
  const cx = C / 2, cy = C / 2;
  // concentric growth rings of uneven width, wobbling radius, a few radial checks, saw marks
  const rings = []; let r = 6; while (r < 126) { rings.push(r); r += 3 + R() * 6; }
  const ph = R() * 6;
  for (let k = rings.length - 1; k >= 0; k--) {
    const rr = rings[k], dark = k % 2 === 0;
    c.with((ctx, isA) => {
      ctx.beginPath();
      for (let a = 0; a <= 64; a++) { const t = a / 64 * Math.PI * 2, wob = 1 + 0.045 * Math.sin(t * 3 + ph + k * 0.3) + 0.03 * Math.sin(t * 7 + k); ctx.lineTo(cx + Math.cos(t) * rr * wob, cy + Math.sin(t) * rr * wob * 0.96); }
      ctx.closePath(); ctx.fillStyle = gray(isA ? (dark ? 0.62 : 0.8) : (dark ? 0.42 : 0.55), 1); ctx.fill();
      ctx.strokeStyle = gray(isA ? 0.42 : 0.3, 1); ctx.lineWidth = 0.8; ctx.stroke();
    }, cx, cy, 0, 0, false);
  }
  c.circle(cx + 3, cy - 2, 4, 0.35, 0.3);
  for (let i = 0; i < 6; i++) { const a = R() * 6.28, L = 40 + R() * 80; c.line([[cx + Math.cos(a) * 6, cy + Math.sin(a) * 6], [cx + Math.cos(a + 0.05) * L, cy + Math.sin(a + 0.05) * L]], 1.4, 0.2, 0.1, 0.9); }
  for (let i = 0; i < 20; i++) c.line([[R() * C, R() * C], [R() * C, R() * C]], 0.7, 0.62, 0.55, 0.12);
  c.speckle(160, 0.45, 0.9, 0.4, 0.7, 1);
}
function paintWool(c) {
  const R = c.R; c.fill(0.78, 0.5);
  // plaid: broad dark bands both ways, a thin light line, then a 2/2 twill over the top
  for (const hz of [true, false]) for (const [p, w, l] of [[0, 56, 0.55], [96, 22, 0.42], [150, 10, 0.95], [190, 40, 0.6]]) {
    if (hz) c.rect(0, p, C, w, l, 0.5, 0, 0.55); else c.rect(p, 0, w, C, l, 0.5, 0, 0.55);
  }
  for (let k = -C; k < C * 2; k += 3) c.line([[k, 0], [k + C, C]], 1.1, 0.42, 0.62, 0.35, 'butt');
  for (let k = 0; k < C; k += 4) { c.line([[k, 0], [k, C]], 0.8, 0.9, 0.56, 0.1, 'butt'); }
  c.speckle(900, 0.4, 1, 0.35, 0.7, 0.9); // fuzz
}
function paintQuilt(c) {
  const R = c.R; c.fill(0.8, 0.82);
  // stitched diamonds: each puffs up in the middle, thread dashes along the seams
  const s = 64;
  for (let gy = -1; gy <= 4; gy++) for (let gx = -1; gx <= 4; gx++) {
    const cx = gx * s + (gy & 1 ? 0 : 0), cy = gy * s;
    c.with((ctx, isA) => {
      const g = ctx.createRadialGradient(cx + s / 2, cy + s / 2, 2, cx + s / 2, cy + s / 2, s * 0.62);
      g.addColorStop(0, gray(1, 1)); g.addColorStop(1, gray(isA ? 0.42 : 0.12, 1));
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(cx + s / 2, cy); ctx.lineTo(cx + s, cy + s / 2); ctx.lineTo(cx + s / 2, cy + s); ctx.lineTo(cx, cy + s / 2); ctx.closePath(); ctx.fill();
    }, cx, cy, s, s);
  }
  for (let k = -C; k <= C * 2; k += s) for (const dir of [1, -1]) {
    c.with((ctx, isA) => {
      ctx.strokeStyle = gray(isA ? 0.98 : 0.1, 1); ctx.lineWidth = isA ? 1.6 : 3; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k + dir * C, C); ctx.stroke();
    }, 0, 0, 0, 0, false);
  }
  c.speckle(600, 0.55, 1, 0.5, 0.8, 0.9);
}
function paintRock(c) {
  const R = c.R; c.fill(0.5, 0.5);
  for (let i = 0; i < 70; i++) c.circle(R() * C, R() * C, 14 + R() * 46, 0.3 + R() * 0.55, 0.25 + R() * 0.6, 1, 0.5);
  for (let i = 0; i < 18; i++) { const x = R() * C, y = R() * C, pts = [[x, y]]; let px = x, py = y, a = R() * 6.28; for (let k = 0; k < 7; k++) { a += (R() - 0.5) * 1.2; px += Math.cos(a) * (8 + R() * 14); py += Math.sin(a) * (8 + R() * 14); pts.push([px, py]); } c.line(pts, 0.9 + R() * 1.4, 0.1, 0.06, 0.95); }
  for (let i = 0; i < 26; i++) c.ellipse(R() * C, R() * C, 4 + R() * 12, 3 + R() * 7, R() * 3, 0.92, 0.62, 0.7, 0.45); // pale lichen
  c.speckle(1200, 0.2, 0.9, 0.3, 0.8, 1.5);
}
function paintIron(c) {
  const R = c.R; c.fill(0.38, 0.5);
  // hand-hammered: hundreds of shallow dents (dark pit → bright lip) + faint forge streaks + a few rust blooms
  for (let i = 0; i < 520; i++) {
    const x = R() * C, y = R() * C, r = 3 + R() * 9;
    c.circle(x, y, r, 0.52 + R() * 0.2, 0.58 + R() * 0.15, 1, 0.6);
    c.circle(x + r * 0.15, y + r * 0.15, r * 0.7, 0.3 + R() * 0.1, 0.25 + R() * 0.12, 0.8, 0.8);
  }
  for (let i = 0; i < 60; i++) { const x = R() * C, y = R() * C; c.line([[x, y], [x + 70 + R() * 90, y + (R() - 0.5) * 6]], 1 + R() * 2, 0.2 + R() * 0.4, 0.5, 0.18); }
  for (let i = 0; i < 24; i++) c.circle(R() * C, R() * C, 6 + R() * 18, 0.64, 0.5, 1, 0.3);
  c.speckle(700, 0.2, 0.8, 0.4, 0.6, 1.1);
}
function paintCanvas(c) {
  const R = c.R; c.fill(0.78, 0.5);
  for (let k = 0; k < C; k += 4) { c.rect(k, 0, 2, C, 0.55 + R() * 0.4, 0.62 + R() * 0.2); c.rect(0, k, C, 2, 0.5 + R() * 0.45, 0.4 + R() * 0.2); }
  for (let i = 0; i < 70; i++) { const x = R() * C, y = R() * C; c.line([[x, y], [x + (R() < 0.5 ? 20 + R() * 40 : 0), y + (R() < 0.5 ? 0 : 20 + R() * 40)]], 1.6, 0.4 + R() * 0.5, 0.7, 0.4); }
  c.speckle(500, 0.35, 0.95, 0.4, 0.6, 1.2);
}
function paintLeather(c) {
  const R = c.R; c.fill(0.55, 0.5);
  for (let i = 0; i < 600; i++) c.circle(R() * C, R() * C, 1 + R() * 2.4, 0.38 + R() * 0.3, 0.38 + R() * 0.2, 0.5, 0.5); // pebbled grain
  for (let i = 0; i < 18; i++) { const x = R() * C, y = R() * C; c.line([[x, y], [x + 30 + R() * 60, y + (R() - 0.5) * 24], [x + 60 + R() * 70, y + (R() - 0.5) * 30]], 1.1, 0.2, 0.2, 0.7); }
  c.speckle(300, 0.3, 0.75, 0.4, 0.6, 1);
}
function paintNeedles(c) {
  const R = c.R; c.clear(); c.fill(0, 0.5, 0);
  // a pine frond: spine up the middle, needles sweeping out and tipward on both sides, shortest at the tip
  const cx = C / 2;
  c.line([[cx, C - 2], [cx + 1, 8]], 4.5, 0.62, 0.7, 1, 'round');
  for (let y = C - 6; y > 8; y -= 2.2) {
    const t = 1 - y / C, len = (70 * (1 - Math.pow(t, 1.5)) + 14) * (0.8 + R() * 0.4);
    for (const s of [-1, 1]) {
      const a = (36 + R() * 18) * Math.PI / 180, l = 0.5 + R() * 0.5, ex = cx + s * Math.sin(a) * len, ey = y - Math.cos(a) * len * 0.8;
      c.line([[cx + (R() - 0.5) * 1.5, y], [ex, ey]], 1.7 + R() * 0.9, l, 0.55 + R() * 0.3, 1, 'round');
    }
  }
}
function paintFern(c) {
  const R = c.R; c.clear(); c.fill(0, 0.5, 0);
  const cx = C / 2; c.line([[cx - 2, C - 2], [cx, 120], [cx + 3, 8]], 3.2, 0.55, 0.7, 1);
  for (let k = 0; k < 22; k++) {
    const t = k / 21, y = C - 12 - t * (C - 28), len = 62 * Math.sin(Math.PI * (0.12 + t * 0.78)) + 6;
    for (const s of [-1, 1]) {
      const x = cx + (t - 0.5) * 3, ex = x + s * len * 0.94, ey = y - len * 0.42;
      c.with((ctx, isA) => { ctx.strokeStyle = gray(isA ? 0.55 + R() * 0.45 : 0.6, 1); ctx.lineWidth = 2.5 + (1 - t) * 3.2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + s * len * 0.5, y - len * 0.45, ex, ey); ctx.stroke(); }, x, y, len, len, false);
    }
  }
}
function paintWood(c) {
  const R = c.R; c.fill(0.78, 0.5);
  for (let i = 0; i < 110; i++) { const x = R() * C, y = R() * C, L = 50 + R() * 160, w = 0.8 + R() * 2.4; const pts = []; for (let k = 0; k <= 5; k++) pts.push([x + Math.sin(k * 0.9 + i) * (1 + R() * 2.5), y + L * k / 5]); c.line(pts, w, 0.5 + R() * 0.3, 0.38, 0.4 + R() * 0.3); }
  for (let i = 0; i < 90; i++) { const x = R() * C, y = R() * C; c.line([[x, y], [x + (R() - 0.5) * 3, y + 20 + R() * 100]], 1, 0.92, 0.6, 0.3); }
  for (let i = 0; i < 3; i++) { const x = R() * C, y = R() * C; c.ellipse(x, y, 7 + R() * 5, 14 + R() * 8, 0, 0.45, 0.35, 0.5); c.ellipse(x, y, 3, 6, 0, 0.3, 0.3, 0.2); }
  c.speckle(200, 0.5, 0.95, 0.4, 0.6, 1);
}
function paintPlank(c) {
  const R = c.R; c.fill(0.72, 0.5);
  const bh = C / 4;
  for (let b = 0; b < 4; b++) {
    for (let i = 0; i < 26; i++) { const y = b * bh + R() * bh; c.line([[0, y], [C, y + (R() - 0.5) * 5]], 0.8 + R() * 1.6, 0.45 + R() * 0.4, 0.4, 0.5); }
    c.rect(0, b * bh, C, 3, 0.1, 0.05); // seam gap
    for (const nx of [10, C - 10]) { c.circle(nx, b * bh + bh / 2 + 4, 3.2, 0.2, 0.9); c.circle(nx - 0.8, b * bh + bh / 2 + 3.2, 1.3, 0.85, 0.95); }
  }
  c.speckle(300, 0.3, 0.9, 0.3, 0.7, 1.2);
}

const PAINT = { [CELL.bark]: paintBark, [CELL.burnt]: paintBurnt, [CELL.grain]: paintGrain, [CELL.wool]: paintWool, [CELL.quilt]: paintQuilt, [CELL.rock]: paintRock, [CELL.iron]: paintIron,
  [CELL.canvas]: paintCanvas, [CELL.leather]: paintLeather, [CELL.needles]: paintNeedles, [CELL.fern]: paintFern, [CELL.wood]: paintWood, [CELL.plank]: paintPlank };
// normal-map strength per cell (height difference → slope)
const STRENGTH = { [CELL.bark]: 3.4, [CELL.burnt]: 2.6, [CELL.grain]: 2.0, [CELL.wool]: 1.6, [CELL.quilt]: 3.2, [CELL.rock]: 2.4, [CELL.iron]: 3.6, [CELL.canvas]: 1.8, [CELL.leather]: 1.6, [CELL.needles]: 1.0, [CELL.fern]: 1.0, [CELL.wood]: 1.6, [CELL.plank]: 2.4, [CELL.white]: 0 };

let cache = null;
/** Build (once) the camp atlas → { map, normal }. ~0.2–0.4 s of canvas work on first call (done at stage build, behind the curtain). */
export function buildCampAtlas() {
  if (cache) return cache;
  const mk = () => { const cv = document.createElement('canvas'); cv.width = N; cv.height = N; return cv; };
  const ca = mk(), ch = mk(), A = ca.getContext('2d'), H = ch.getContext('2d');
  for (let i = 0; i < 16; i++) {
    const cell = new Cell(A, H, i, mulberry(1000 + i * 77));
    if (i === CELL.white || !PAINT[i]) { cell.fill(1, 0.5); continue; }
    PAINT[i](cell);
  }
  // height → tangent-space normal map
  const hd = H.getImageData(0, 0, N, N).data, nd = new Uint8ClampedArray(N * N * 4);
  const hAt = (x, y) => hd[(((y + N) % N) * N + ((x + N) % N)) * 4] / 255;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const cell = Math.floor(y / C) * 4 + Math.floor(x / C), k = STRENGTH[cell] ?? 1.5;
    const lx = x % C, ly = y % C, wrap = (v, m) => (v + m) % m;
    const hx = (xx, yy) => hd[((Math.floor(y / C) * C + wrap(yy, C)) * N + (Math.floor(x / C) * C + wrap(xx, C))) * 4] / 255;
    const dx = (hx(lx + 1, ly) - hx(lx - 1, ly)) * k, dy = (hx(lx, ly + 1) - hx(lx, ly - 1)) * k;
    const il = 1 / Math.hypot(dx, dy, 1), o = (y * N + x) * 4;
    nd[o] = (-dx * il * 0.5 + 0.5) * 255; nd[o + 1] = (dy * il * 0.5 + 0.5) * 255; nd[o + 2] = (il * 0.5 + 0.5) * 255; nd[o + 3] = 255;
  }
  void hAt;
  const cn = mk(); cn.getContext('2d').putImageData(new ImageData(nd, N, N), 0, 0);
  const map = new THREE.CanvasTexture(ca); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4; map.generateMipmaps = true; map.minFilter = THREE.LinearMipmapLinearFilter; map.name = 'camp_atlas';
  const normal = new THREE.CanvasTexture(cn); normal.anisotropy = 4; normal.name = 'camp_atlas_n';
  cache = { map, normal };
  return cache;
}

/** Standard material over the atlas: vertex colour × cell texture (tile-wrapped per vertex rect). `o`: gain (colour multiplier —
 *  textures are mid-luminance), alphaTest (frond cards), transparent/opacity (fadeable props), ns (normal strength), rough, side. */
export function campMaterial(o = {}) {
  const at = buildCampAtlas();
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true, map: at.map, normalMap: at.normal, normalScale: new THREE.Vector2(o.ns ?? 0.9, o.ns ?? 0.9),
    roughness: o.rough ?? 0.92, metalness: o.metal ?? 0, side: o.side ?? THREE.FrontSide, alphaTest: o.alphaTest ?? 0, transparent: !!o.transparent, opacity: o.opacity ?? 1,
  });
  m.color.setScalar(o.gain ?? 1.8);
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aRect;\nvarying vec4 vKRect;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n  vKRect = aRect;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec4 vKRect;
vec4 kTex(sampler2D t, vec2 uv) { vec2 f = fract(uv); return textureGrad(t, vKRect.xy + f * vKRect.zw, dFdx(uv) * vKRect.zw, dFdy(uv) * vKRect.zw); }`)
      .replace('#include <map_fragment>', '#ifdef USE_MAP\n  vec4 sampledDiffuseColor = kTex(map, vMapUv);\n  diffuseColor *= sampledDiffuseColor;\n#endif')
      .replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', 'vec3 mapN = kTex(normalMap, vNormalMapUv).xyz * 2.0 - 1.0;');
  };
  m.customProgramCacheKey = () => 'campAtlas' + (o.alphaTest ? 'A' : '') + (o.transparent ? 'T' : '');
  return m;
}
