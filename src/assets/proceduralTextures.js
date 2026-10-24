// Procedural texture helpers (canvas based, cached by key). Use for placeholders, masks, gradients,
// particle sprites and detail maps until authored textures exist.
//   noiseTexture({ size, scale, octaves, seed, contrast, colorA, colorB })   fBm value noise, tiling
//   normalFromNoise({ size, scale, strength, seed })                           tiling normal map
//   gradientTexture(stops, { vertical })                                        1D LUT-ish gradient
//   radialTexture({ size, inner, outer, power })                               soft round sprite/blob
//   canvasTexture(key, w, h, drawFn)                                            anything else
import * as THREE from 'three';

const cache = new Map();

function hash2(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Tileable value noise in [0,1]. `period` cells per tile. */
function valueNoise(x, y, period, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const w = (i) => ((i % period) + period) % period;
  const a = hash2(w(x0), w(y0), seed), b = hash2(w(x0 + 1), w(y0), seed);
  const c = hash2(w(x0), w(y0 + 1), seed), d = hash2(w(x0 + 1), w(y0 + 1), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Tileable fBm field as Float32Array (size×size) in ~[0,1]. */
export function fbmField(size = 256, scale = 8, octaves = 4, seed = 1) {
  // perf-1650 fast path (bit-identical): per octave, hash the p×p lattice once into a table instead of 4 hash2()
  // calls + 4 wrap closures per pixel (a 512² 5-octave ground map took ~0.9 s on the main thread; now ~0.1 s).
  let integral = true;
  for (let o = 0, f = 1; o < octaves; o++, f *= 2) { const pp = scale * f; if (pp !== Math.floor(pp) || pp < 1 || pp > 4096) integral = false; }
  if (integral) return fbmFieldFast(size, scale, octaves, seed);
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let amp = 0.5, f = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      const p = scale * f;
      sum += amp * valueNoise((x / size) * p, (y / size) * p, p, seed + o * 17);
      norm += amp; amp *= 0.5; f *= 2;
    }
    out[y * size + x] = sum / norm;
  }
  return out;
}

function fbmFieldFast(size, scale, octaves, seed) {
  const out = new Float32Array(size * size);
  const acc = new Float64Array(size * size);
  let amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const p = scale * f, sd = seed + o * 17;
    const T = new Float64Array(p * p);
    for (let iy = 0; iy < p; iy++) for (let ix = 0; ix < p; ix++) T[iy * p + ix] = hash2(ix, iy, sd);
    // per-column lattice x, fraction and smoothstep (same float expressions as valueNoise)
    const X0 = new Int32Array(size), X1 = new Int32Array(size), U = new Float64Array(size);
    for (let x = 0; x < size; x++) {
      const px = (x / size) * p, x0 = Math.floor(px), fx = px - x0;
      X0[x] = ((x0 % p) + p) % p; X1[x] = (((x0 + 1) % p) + p) % p; U[x] = fx * fx * (3 - 2 * fx);
    }
    for (let y = 0; y < size; y++) {
      const py = (y / size) * p, y0 = Math.floor(py), fy = py - y0, v = fy * fy * (3 - 2 * fy);
      const r0 = (((y0 % p) + p) % p) * p, r1 = ((((y0 + 1) % p) + p) % p) * p, row = y * size;
      for (let x = 0; x < size; x++) {
        const a = T[r0 + X0[x]], b = T[r0 + X1[x]], c = T[r1 + X0[x]], d = T[r1 + X1[x]], u = U[x];
        acc[row + x] += amp * (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v);
      }
    }
    norm += amp; amp *= 0.5; f *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] = acc[i] / norm;
  return out;
}

export function canvasTexture(key, w, h, draw, { srgb = true, repeat = false } = {}) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  t.needsUpdate = true;
  cache.set(key, t);
  return t;
}

const hex = (c) => new THREE.Color(c);

export function noiseTexture({ size = 256, scale = 8, octaves = 4, seed = 1, contrast = 1, colorA = '#808080', colorB = '#ffffff', srgb = true } = {}) {
  const key = `noise:${size}:${scale}:${octaves}:${seed}:${contrast}:${colorA}:${colorB}:${srgb}`;
  return canvasTexture(key, size, size, (g) => {
    const f = fbmField(size, scale, octaves, seed);
    const img = g.createImageData(size, size);
    const A = hex(colorA), B = hex(colorB);
    for (let i = 0; i < f.length; i++) {
      const v = Math.min(1, Math.max(0, (f[i] - 0.5) * contrast + 0.5));
      img.data[i * 4] = (A.r + (B.r - A.r) * v) * 255;
      img.data[i * 4 + 1] = (A.g + (B.g - A.g) * v) * 255;
      img.data[i * 4 + 2] = (A.b + (B.b - A.b) * v) * 255;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, { srgb, repeat: true });
}

/** Tileable normal map derived from fBm height. */
export function normalFromNoise({ size = 256, scale = 8, octaves = 4, seed = 7, strength = 2 } = {}) {
  const key = `nrm:${size}:${scale}:${octaves}:${seed}:${strength}`;
  return canvasTexture(key, size, size, (g) => {
    const f = fbmField(size, scale, octaves, seed);
    const img = g.createImageData(size, size);
    const at = (x, y) => f[((y + size) % size) * size + ((x + size) % size)];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength * size / 64;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength * size / 64;
      const l = Math.sqrt(dx * dx + dy * dy + 1); // (Math.hypot is ~10× slower; same value to the last ulp or so)
      const i = (y * size + x) * 4;
      img.data[i] = (-dx / l * 0.5 + 0.5) * 255;
      img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, { srgb: false, repeat: true });
}

/** stops: [[0,'#000'],[1,'#fff']] */
export function gradientTexture(stops, { vertical = true, size = 256 } = {}) {
  const key = `grad:${JSON.stringify(stops)}:${vertical}:${size}`;
  return canvasTexture(key, vertical ? 4 : size, vertical ? size : 4, (g, w, h) => {
    const gr = vertical ? g.createLinearGradient(0, 0, 0, h) : g.createLinearGradient(0, 0, w, 0);
    for (const [t, c] of stops) gr.addColorStop(t, c);
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
}

/** Soft radial sprite: white center fading to transparent (alpha channel). */
export function radialTexture({ size = 128, inner = 0, outer = 1, power = 1.6, color = '255,255,255' } = {}) {
  const key = `radial:${size}:${inner}:${outer}:${power}:${color}`;
  return canvasTexture(key, size, size, (g) => {
    const img = g.createImageData(size, size);
    const [r, gg, b] = color.split(',').map(Number);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size * 2 - 1, dy = (y + 0.5) / size * 2 - 1;
      const d = Math.hypot(dx, dy);
      let a = 1 - Math.min(1, Math.max(0, (d - inner) / (outer - inner)));
      a = Math.pow(a, power);
      const i = (y * size + x) * 4;
      img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b; img.data[i + 3] = a * 255;
    }
    g.putImageData(img, 0, 0);
  }, { srgb: false });
}
