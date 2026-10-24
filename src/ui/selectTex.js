// Canvas-painted materials for the character-select barrow (ui-flow r7): irregular flagstones with mortar, chips and cracks,
// and a layered rock / ossuary wall. Each returns { map, normalMap } (tiling, anisotropic) built once per call from tileable
// fBm fields — no assets to ship. Normals are derived from a painted height canvas (domed stones, sunk mortar).
import * as THREE from 'three';
import { fbmField } from '../assets/proceduralTextures.js';

const rng = (seed) => { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const mk = (n) => { const c = document.createElement('canvas'); c.width = c.height = n; return c; };

function normalFrom(heightCanvas, n, strength) {
  const hc = heightCanvas.getContext('2d').getImageData(0, 0, n, n).data;
  const out = mk(n), ox = out.getContext('2d'), id = ox.createImageData(n, n), d = id.data;
  const H = (x, y) => hc[(((y + n) % n) * n + ((x + n) % n)) * 4] / 255;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), i = (y * n + x) * 4;
    d[i] = (-dx / l * 0.5 + 0.5) * 255; d[i + 1] = (dy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  ox.putImageData(id, 0, 0);
  return out;
}
function tex(canvas, srgb) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Irregular running-bond flagstones: dark mortar, per-stone tint + doming, hairline cracks, chips and grit. */
export function flagstoneMaps(n = 1024, seed = 5) {
  const R = rng(seed), col = mk(n), hgt = mk(n), c = col.getContext('2d'), h = hgt.getContext('2d');
  c.fillStyle = '#0b0c10'; c.fillRect(0, 0, n, n); h.fillStyle = '#000'; h.fillRect(0, 0, n, n);
  const pal = ['#646a73', '#555b64', '#6f7480', '#4a4f58', '#6a6e76', '#5c616a', '#414650'];
  const rows = 4, rh = n / rows;
  for (let r = 0; r < rows; r++) {
    const cnt = 3 + (r % 2), w = []; let tot = 0;
    for (let i = 0; i < cnt; i++) { w.push(0.7 + R() * 0.7); tot += w[i]; }
    let x = R() * 60;
    for (let i = 0; i < cnt; i++) {
      const sw = (w[i] / tot) * n, g = 5 + R() * 3;
      const x0 = x + g, x1 = x + sw - g, y0 = r * rh + g, y1 = (r + 1) * rh - g;
      for (const ox of [-n, 0, n]) {
        const j = () => (R() - 0.5) * 14, k = () => (R() - 0.5) * 8;
        const P = [[x0 + ox + k(), y0 + k()], [x1 + ox + k(), y0 + k()], [x1 + ox + j(), y1 + k()], [x0 + ox + j(), y1 + k()]];
        const cp = (ctx) => { ctx.beginPath(); P.forEach((p, q) => (q ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); };
        const base = pal[Math.floor(R() * pal.length)];
        const gr = c.createLinearGradient(x0 + ox, y0, x1 + ox, y1); gr.addColorStop(0, base); gr.addColorStop(1, '#1d2026');
        cp(c); c.fillStyle = base; c.fill(); c.globalAlpha = 0.45; c.fillStyle = gr; c.fill(); c.globalAlpha = 1;
        c.lineJoin = 'round'; c.lineWidth = 3; c.strokeStyle = 'rgba(150,160,176,.30)'; cp(c); c.stroke();
        const cxm = (x0 + x1) / 2 + ox, cym = (y0 + y1) / 2, rr = Math.hypot(sw, rh) * 0.5;
        const hg = h.createRadialGradient(cxm, cym, 0, cxm, cym, rr); hg.addColorStop(0, '#d0d0d0'); hg.addColorStop(1, '#707070');
        cp(h); h.fillStyle = hg; h.fill();
      }
      x += sw;
    }
  }
  // cracks + chips (both canvases, so they cut into the normal map)
  for (let i = 0; i < 26; i++) {
    let px = R() * n, py = R() * n; const len = 40 + R() * 120, a0 = R() * 6.28;
    for (const [ctx, st, lw] of [[c, 'rgba(14,10,8,.75)', 1.6], [h, '#000', 2.2]]) {
      ctx.strokeStyle = st; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(px, py);
      let qx = px, qy = py, a = a0; const R2 = rng(i * 31 + seed);
      for (let s = 0; s < len; s += 9) { a += (R2() - 0.5) * 1.1; qx += Math.cos(a) * 9; qy += Math.sin(a) * 9; ctx.lineTo(qx, qy); }
      ctx.stroke();
    }
  }
  // grit / grain through the albedo; same fields wobble the height
  const f1 = fbmField(n, 64, 4, seed + 1), f2 = fbmField(n, 16, 3, seed + 2), id = c.getImageData(0, 0, n, n), d = id.data;
  const hd = h.getImageData(0, 0, n, n), hdd = hd.data;
  for (let i = 0; i < n * n; i++) {
    const m = 0.72 + 0.56 * f1[i] * (0.8 + 0.4 * f2[i]), sp = R() < 0.012 ? 1.35 : 1;
    d[i * 4] *= m * sp; d[i * 4 + 1] *= m * sp; d[i * 4 + 2] *= m * sp;
    const v = Math.min(255, hdd[i * 4] * (0.82 + 0.36 * f1[i]));
    hdd[i * 4] = hdd[i * 4 + 1] = hdd[i * 4 + 2] = v;
  }
  c.putImageData(id, 0, 0); h.putImageData(hd, 0, 0);
  return { map: tex(col, true), normalMap: tex(normalFrom(hgt, n, 3.2), false) };
}

/** Layered cave / ossuary rock: wavy strata, vertical joints, darker pockets and moss-stained seams. */
export function rockMaps(n = 1024, seed = 9) {
  const R = rng(seed), col = mk(n), hgt = mk(n), c = col.getContext('2d'), h = hgt.getContext('2d');
  const f1 = fbmField(n, 8, 5, seed + 1), f2 = fbmField(n, 32, 4, seed + 2), f3 = fbmField(n, 4, 3, seed + 3);
  const id = c.createImageData(n, n), d = id.data, hd = h.createImageData(n, n), hh = hd.data;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    const strata = 0.5 + 0.5 * Math.sin((y / n) * Math.PI * 2 * 9 + f3[i] * 9 + f1[i] * 3);
    const crack = 1 - Math.min(1, Math.abs(f2[i] - 0.5) / 0.03);
    let t = 0.28 + 0.34 * f1[i] + 0.2 * strata * f2[i] - 0.22 * crack * crack;
    t = Math.max(0.05, t);
    d[i * 4] = 70 * t * 1.9; d[i * 4 + 1] = 76 * t * 1.9; d[i * 4 + 2] = 82 * t * 1.9; d[i * 4 + 3] = 255;
    const hv = Math.max(0, Math.min(1, 0.35 + 0.45 * f1[i] + 0.25 * strata * f2[i] - 0.3 * crack));
    hh[i * 4] = hh[i * 4 + 1] = hh[i * 4 + 2] = hv * 255; hh[i * 4 + 3] = 255;
  }
  c.putImageData(id, 0, 0); h.putImageData(hd, 0, 0);
  return { map: tex(col, true), normalMap: tex(normalFrom(hgt, n, 4.5), false) };
}

/** C2 r13 (board r12 "blue-black procedural cracked noise"): authored ashlar masonry for the vault — five courses per tile of large dressed
 *  blocks (running bond, 1.5-2.6 m on the vault), each with its own tint, a bevelled doming, chipped corners, water streaks off the lower
 *  edge and sunk dark mortar, so the wall reads as large quiet forms (a few big joints) instead of a busy crack network. Low contrast on purpose:
 *  the wall must stay darker and quieter than the heroes in front of it. */
export function masonryMaps(n = 1024, seed = 9) {
  const R = rng(seed), col = mk(n), hgt = mk(n), c = col.getContext('2d'), h = hgt.getContext('2d');
  c.fillStyle = '#06070a'; c.fillRect(0, 0, n, n); h.fillStyle = '#000'; h.fillRect(0, 0, n, n);
  const pal = ['#5b6068', '#50555e', '#666a72', '#474c55', '#5d6169', '#53585f', '#4a4e57', '#6a6963'];
  const rows = 5, rh = n / rows;
  for (let r = 0; r < rows; r++) {
    const cnt = 3, w = []; let tot = 0;
    for (let i = 0; i < cnt; i++) { w.push(0.75 + R() * 0.65); tot += w[i]; }
    let x = R() * n;
    for (let i = 0; i < cnt; i++) {
      const sw = (w[i] / tot) * n, g = 7 + R() * 3;
      const x0 = x + g, x1 = x + sw - g, y0 = r * rh + g, y1 = (r + 1) * rh - g;
      const base = pal[Math.floor(R() * pal.length)], lean = (R() - 0.5) * 10;
      for (const ox of [-n, 0, n]) {
        const j = () => (R() - 0.5) * 6;
        const P = [[x0 + ox + j(), y0 + j()], [x1 + ox + j(), y0 + j()], [x1 + ox + lean * 0.3 + j(), y1 + j()], [x0 + ox + lean * 0.3 + j(), y1 + j()]];
        const cp = (ctx) => { ctx.beginPath(); P.forEach((p, q) => (q ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); };
        const gr = c.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, '#9a9fa8'); gr.addColorStop(0.45, base); gr.addColorStop(1, '#23262d');
        cp(c); c.fillStyle = base; c.fill(); c.globalAlpha = 0.5; c.fillStyle = gr; c.fill(); c.globalAlpha = 1;
        // lit top bevel / dark bottom lip painted into the albedo so the course relief reads even where the normal map is flat
        c.lineJoin = 'miter'; c.lineWidth = 4; c.strokeStyle = 'rgba(190,196,206,.14)'; c.beginPath(); c.moveTo(P[3][0] + 3, P[0][1] + 3); c.lineTo(P[1][0] - 3, P[1][1] + 3); c.stroke();
        c.strokeStyle = 'rgba(0,0,0,.45)'; c.beginPath(); c.moveTo(P[3][0] + 3, P[3][1] - 3); c.lineTo(P[2][0] - 3, P[2][1] - 3); c.stroke();
        // chipped corners cut back to mortar
        for (let k = 0; k < 2; k++) if (R() < 0.55) {
          const q = [P[0], P[1], P[2], P[3]][Math.floor(R() * 4)], dx = (q[0] > (x0 + x1) / 2 + ox ? -1 : 1), dy = (q[1] > (y0 + y1) / 2 ? -1 : 1), s = 14 + R() * 26;
          c.fillStyle = '#07080b'; c.beginPath(); c.moveTo(q[0], q[1]); c.lineTo(q[0] + dx * s, q[1]); c.lineTo(q[0], q[1] + dy * s * (0.6 + R() * 0.6)); c.closePath(); c.fill();
          h.fillStyle = '#000'; h.beginPath(); h.moveTo(q[0], q[1]); h.lineTo(q[0] + dx * s, q[1]); h.lineTo(q[0], q[1] + dy * s); h.closePath(); h.fill();
        }
        const cxm = (x0 + x1) / 2 + ox, cym = (y0 + y1) / 2, rr = Math.hypot(sw, rh) * 0.55;
        const hg = h.createRadialGradient(cxm, cym, 0, cxm, cym, rr); hg.addColorStop(0, '#e0e0e0'); hg.addColorStop(1, '#8c8c8c');
        cp(h); h.fillStyle = hg; h.fill();
      }
      x += sw;
    }
  }
  // quiet weathering: low-frequency tone, a little grit, and water stains running down from the joints; no hairline crack network
  const f1 = fbmField(n, 6, 4, seed + 1), f2 = fbmField(n, 40, 3, seed + 2), f3 = fbmField(n, 3, 2, seed + 3);
  const id = c.getImageData(0, 0, n, n), d = id.data, hd = h.getImageData(0, 0, n, n), hdd = hd.data;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, m = 0.88 + 0.2 * f1[i] + 0.1 * (f2[i] - 0.5), stain = Math.max(0, f3[i] - 0.55) * (0.5 + 0.5 * Math.sin(x * 0.07 + f1[i] * 9));
    const k = m * (1 - 0.3 * stain);
    d[i * 4] *= k * 0.98; d[i * 4 + 1] *= k; d[i * 4 + 2] *= k * 1.02;
    const v = Math.min(255, hdd[i * 4] * (0.88 + 0.24 * f2[i]));
    hdd[i * 4] = hdd[i * 4 + 1] = hdd[i * 4 + 2] = v;
  }
  c.putImageData(id, 0, 0); h.putImageData(hd, 0, 0);
  return { map: tex(col, true), normalMap: tex(normalFrom(hgt, n, 3.4), false) };
}
