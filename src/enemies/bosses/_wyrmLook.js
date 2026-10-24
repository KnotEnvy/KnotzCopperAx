// Wyrm Rider boss look (bosses r9, board r8 "weakest boss: solid lime-green rider suit, flat saturated red wyrm, blue
// disc saddle, no material breakup"). Boss-instance only — the shared viper / cinderwyrm GLBs are untouched:
//   1. a recoloured COPY of each albedo atlas (CPU, chunked off the frame budget, ~1M px per atlas): hue-classified
//      remaps + two-octave value noise so scales, leather and metal separate and the values spread out —
//        rider : lime scale suit → deep bottle-green with dark scale seams; yellow panels → aged brass
//        wyrm  : red hide → darker crimson with mottling + jittered hue; salmon membranes → dusky rose; cream belly →
//                bone; BLUE saddle cloth → dark oxblood leather; gold tack → bronze; brown straps darker
//      The material keeps its program (it already samples `map`): only the texture object changes.
//   2. a per-material albedo floor override (kKeyTone.x × FLOOR): the shared character key lifts every albedo below
//      0.3 linear to 0.3 (×4), which flattened the dark scale seams into the "solid lime" read. Uniform only — the
//      program key is not touched (same idea as _look.js bossGrade), so no new program links.
import * as THREE from 'three';
import { applyCharacterLook, charUniforms } from '../../render/characterLook.js';
import { reportError } from '../../core/log.js';

const FLOOR = 0.3, LIFT = 1.7;

// ---------------------------------------------------------------- noise / colour helpers
function hash(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; h ^= h >>> 16; return (h >>> 0) / 4294967296; }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const out = [0, 0, 0];
function hsv2rgb(h, s, v) {
  h = ((h % 360) + 360) % 360 / 60; s = Math.max(0, Math.min(1, s)); v = Math.max(0, Math.min(1, v));
  const i = Math.floor(h), f = h - i, p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
  switch (i % 6) {
    case 0: out[0] = v; out[1] = t; out[2] = p; break;
    case 1: out[0] = q; out[1] = v; out[2] = p; break;
    case 2: out[0] = p; out[1] = v; out[2] = t; break;
    case 3: out[0] = p; out[1] = q; out[2] = v; break;
    case 4: out[0] = t; out[1] = p; out[2] = v; break;
    default: out[0] = v; out[1] = p; out[2] = q;
  }
  return out;
}
const inHue = (h, a, b) => (a <= b ? h >= a && h <= b : h >= a || h <= b);

/** Per-pixel remaps. (h deg, s, v in 0..1, n = coarse noise 0..1, f = fine noise 0..1) → [h, s, v] or null (keep). */
const REMAP = {
  rider(h, s, v, n, f) {
    if (inHue(h, 72, 178) && s > 0.2 && v > 0.1) {   // lime scale suit → deep bottle green, seams go dark
      return [h + (156 - h) * 0.5 + (n - 0.5) * 14, s * 0.74, Math.pow(v, 1.75) * (0.6 + 0.32 * n) * (0.9 + 0.2 * f)];
    }
    if (inHue(h, 30, 70) && s > 0.42 && v > 0.42) {  // yellow panels / trims → aged brass
      return [34 + (h - 34) * 0.4, s * 0.7, v * 0.64 * (0.84 + 0.26 * n)];
    }
    if (s < 0.18 && v > 0.7) return [h, s, v * 0.8];   // bone-white trophies, a step down
    return null;
  },
  wyrm(h, s, v, n, f) {
    if (inHue(h, 196, 258) && s > 0.22) {           // BLUE saddle cloth → dark oxblood leather with grain
      return [8 + (n - 0.5) * 10, 0.52, Math.max(0.05, v * 0.46 * (0.78 + 0.3 * n) * (0.88 + 0.24 * f))];
    }
    if (inHue(h, 38, 66) && s > 0.48 && v > 0.48) {  // gold tack rings / buckles → bronze
      return [32, s * 0.74, v * 0.6 * (0.86 + 0.24 * f)];
    }
    if (inHue(h, 340, 30) && s > 0.28 && s < 0.7 && v > 0.8) {   // salmon wing membranes → dusky rose
      return [354 + (n - 0.5) * 8, s * 1.05, v * 0.64 * (0.84 + 0.3 * n)];
    }
    if (inHue(h, 340, 30) && s >= 0.5) {             // red hide → darker crimson, mottled, hue drifting ember↔wine
      return [3 + (n - 0.5) * 22, Math.min(1, s * 1.03), Math.pow(v, 1.5) * (0.64 + 0.44 * n) * (0.9 + 0.2 * f)];
    }
    if (inHue(h, 16, 52) && s >= 0.12 && s < 0.55 && v > 0.55) {   // cream belly plates / horns → bone
      return [h, s * 0.78, v * 0.8 * (0.9 + 0.16 * f)];
    }
    if (inHue(h, 8, 45) && s > 0.28 && v < 0.5) return [h, s, v * 0.7];   // brown straps darker
    return null;
  },
};

/** Recolour a copy of `tex` (ImageBitmap / canvas source) with REMAP[kind]; yields every ~5 ms. Resolves a texture. */
async function recolor(tex, kind) {
  const im = tex && tex.image; if (!im || !im.width) return null;
  const W = im.width, H = im.height, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(im, 0, 0);
  const img = ctx.getImageData(0, 0, W, H), px = img.data, fn = REMAP[kind], sc = W / 1024;
  let t0 = performance.now();
  for (let y = 0; y < H; y++) {
    for (let x = 0, i = y * W * 4; x < W; x++, i += 4) {
      const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      if (mx < 0.04) continue;
      let h = 0;
      if (d > 1e-5) h = mx === r ? 60 * (((g - b) / d) % 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
      if (h < 0) h += 360;
      const n = 0.62 * vnoise(x / (46 * sc), y / (46 * sc)) + 0.38 * vnoise(x / (15 * sc) + 31.7, y / (15 * sc) + 7.3);
      const f = vnoise(x / (4 * sc) + 101.3, y / (4 * sc) + 53.1);
      const o = fn(h, d / mx, mx, n, f);
      if (!o) continue;
      const rgb = hsv2rgb(o[0], o[1], o[2]);
      px[i] = rgb[0] * 255; px[i + 1] = rgb[1] * 255; px[i + 2] = rgb[2] * 255;
    }
    if ((y & 15) === 15 && performance.now() - t0 > 5) { await new Promise((r) => setTimeout(r, 0)); t0 = performance.now(); }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.flipY = tex.flipY; t.colorSpace = tex.colorSpace; t.wrapS = tex.wrapS; t.wrapT = tex.wrapT;
  t.minFilter = tex.minFilter; t.magFilter = tex.magFilter; t.anisotropy = tex.anisotropy; t.channel = tex.channel;
  t.generateMipmaps = tex.generateMipmaps !== false; t.name = (tex.name || 'map') + '_bossWyrm';
  t.needsUpdate = true;
  return t;
}

/** Albedo floor override on this actor's character materials (uniform only, program untouched). */
function floorOverride(game, root) {
  if (!root.userData.kcaLook) applyCharacterLook(root, { strength: 1 });
  const tone = new THREE.Vector4();
  const uTone = { get value() { const t = charUniforms.kKeyTone.value; return tone.set(t.x * FLOOR, Math.min(t.y, LIFT), t.z, t.w); } };
  const props = game.renderer && game.renderer.webgl && game.renderer.webgl.properties;
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m || !m.userData.kcaChar || m.userData.wyrmFloor) continue;
      m.userData.wyrmFloor = true;
      const prev = m.onBeforeCompile;
      m.onBeforeCompile = (sh, r) => { if (prev) prev.call(m, sh, r); sh.uniforms.kKeyTone = uTone; };
      // already linked (the rider can draw a few frames before the encounter finishes spawning): swap the live uniform
      const p = props && props.get(m);
      if (p && p.uniforms && p.uniforms.kKeyTone) p.uniforms.kKeyTone = uTone;
    }
  });
}

// perf-1650 C2: ONE recoloured copy per (source atlas, kind), shared by every instance. Each boss spawn used to build two
// new 1024² CanvasTextures and upload them mid-entrance → two ~435 ms GPU-process stalls (texImage2D + mip build) at the
// S3 boss arena, 4/4 runs. The stage prewarm now builds them at map time (wyrmLookMaps) and uploads + draws them behind
// the curtain, so this look only swaps in GPU-resident textures. Disposing one (boss removed) frees just its GPU copy;
// three re-uploads it from the kept canvas if it is drawn again (next prewarm).
const shared = new Map(); // `${source texture uuid}|${kind}` → Promise<Texture | null>
function recolorShared(tex, kind) {
  const k = `${tex.uuid}|${kind}`;
  let p = shared.get(k);
  if (!p) { p = recolor(tex, kind).catch((e) => { shared.delete(k); throw e; }); shared.set(k, p); }
  return p;
}

/** Albedo materials of a body that get the recolour (shared by wyrmRiderLook and wyrmLookMaps). */
function lookMaterials(root) {
  const out = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.material || o.name === 'contactShadow' || /weapon|fire/.test(o.name)) return;
    const m = o.material; if (Array.isArray(m) || !m.map) return;
    // C2 r12 (Enemy Art): the r12 Cinderwyrm GLB ships an AUTHORED atlas (ref palette + ember emissive map); the hue
    // remap would turn its amber belly / wing membranes crimson. Rider remap + the albedo floor are unchanged.
    if (m.emissiveMap && /cinderwyrm/.test(m.name)) return;
    out.push(m);
  });
  return out;
}

/**
 * perf-1650 C2 (assets/prewarm.js): build the boss-only recoloured atlases from the prewarm's WARM rider (viper captain)
 * and wyrm without touching them (their own maps stay — regular vipers / wyrms of the stage draw those). Resolves the
 * textures so the prewarm can upload + draw them under the curtain.
 */
export function wyrmLookMaps(actors) {
  if (typeof location !== 'undefined' && /[?&]wyrmlook=0/.test(location.search)) return Promise.resolve([]);
  const jobs = [];
  for (const a of actors || []) {
    const kind = a && a.kind === 'mount' && a.typeId === 'cinderwyrm' ? 'wyrm' : a && a.typeId === 'viper' && a.tier === 'captain' ? 'rider' : null;
    const root = kind && (a.modelRoot || a.view); if (!root) continue;
    for (const m of lookMaterials(root)) jobs.push(recolorShared(m.map, kind).catch((e) => { reportError('boss.wyrmLook.warm', e); return null; }));
  }
  return Promise.all(jobs).then((ts) => [...new Set(ts.filter(Boolean))]);
}

/** Apply the boss look to the rider (viper captain) and her wyrm. Textures arrive a few frames later (async). */
export function wyrmRiderLook(game, rider, mount) {
  if (typeof location !== 'undefined' && /[?&]wyrmlook=0/.test(location.search)) return;
  const jobs = [];
  for (const [a, kind] of [[rider, 'rider'], [mount, 'wyrm']]) {
    const root = a && (a.modelRoot || a.view); if (!root) continue;
    try { floorOverride(game, root); } catch (e) { reportError('boss.wyrmLook.floor', e); }
    const made = [];
    for (const m of lookMaterials(root)) {
      if (m.userData.wyrmMap) continue;
      m.userData.wyrmMap = true;
      jobs.push(recolorShared(m.map, kind).then((t) => { if (t && !a.removed) { m.map = t; made.push(t); } else if (t) t.dispose(); })
        .catch((e) => reportError('boss.wyrmLook.map', e)));
    }
    // free the copies with the actor
    const rm = a.onRemove ? a.onRemove.bind(a) : null;
    a.onRemove = () => { if (rm) rm(); for (const t of made) t.dispose(); made.length = 0; };
  }
  return Promise.all(jobs);
}
