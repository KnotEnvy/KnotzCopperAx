// HUD portraits: render-to-texture of the LIVE hero model (head-and-shoulders, 3/4 view) with the stage's own
// lighting, stage geometry hidden, on a dark ground. Rendered once per hero type per page (cached), converted to a
// data URL, then painted into the HUD medallion via hud.setPortrait(). Linear RT → sRGB + a soft filmic curve by
// hand (the post chain is bypassed). Falls back silently to the heraldic crest.
//   capturePortrait(game, hero) → dataURL | null
import * as THREE from 'three';

const cache = new Map();
const SIZE = 384, OUT = 160;
const GUARD_HIDE = 1 << 30;   // programGuard.js HIDE_MASK

function findHead(root) {
  let head = null;
  root.traverse((o) => { if (!head && (o.name === 'head' || /(^|[_:.])head$/i.test(o.name))) head = o; });
  return head;
}

export function capturePortrait(game, hero) {
  const id = hero.typeId || (hero.def && hero.def.id);
  if (cache.has(id)) return cache.get(id);
  const R = game.renderer; if (!R || !R.webgl || !hero.view) return null;
  const gl = R.webgl, scene = R.scene;
  // r9: the P1 portrait came out EMPTY BLACK (cached forever) while P2's rendered, because the first capture can land on a frame
  // where the hero view is hidden / has zero-opacity materials (spawn invulnerability flicker, entry fade) or stale matrices.
  // Force the view visible + opaque for the capture, refresh matrices, and only cache an image that really contains the hero.
  // The program guard (render/programGuard.js) parks an actor on HIDE_MASK (layer 30) until its shader programs are linked; a
  // camera on layer 0 then draws NOTHING of it - that was the actual cause of the black P1 medallion. Not ready yet → null (the
  // HUD retries shortly) rather than caching an empty frame.
  let guardHidden = false; hero.view.traverse((o) => { if (o.layers && (o.layers.mask & GUARD_HIDE) && !(o.layers.mask & 1)) guardHidden = true; });
  if (guardHidden) { (globalThis.__KCA_PORTRAIT_LOG = globalThis.__KCA_PORTRAIT_LOG || []).push({ id, ok: false, guardHidden: true }); return null; }
  const wasVisible = hero.view.visible; hero.view.visible = true;
  const restoreMats = [];
  hero.view.traverse((o) => {
    if (o.isMesh && o.material) for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (m.opacity < 0.999 && m.transparent) { restoreMats.push([m, m.opacity]); m.opacity = 1; }
  });
  hero.view.updateMatrixWorld(true);
  const head = findHead(hero.body || hero.view);
  const hp = new THREE.Vector3();
  if (head) head.getWorldPosition(hp); else hp.set(hero.pos.x, (hero.height || 1.8) * 0.9, hero.pos.z);
  const bb = new THREE.Box3().setFromObject(hero.view);
  // a head bone that is not near the top of the body box (stale / wrong node) → frame the top of the box instead
  if (!bb.isEmpty() && (hp.y < bb.min.y + (bb.max.y - bb.min.y) * 0.6 || hp.y > bb.max.y + 0.2)) hp.set((bb.min.x + bb.max.x) / 2, bb.max.y - 0.2, (bb.min.z + bb.max.z) / 2);
  const cam = new THREE.PerspectiveCamera(24, 1, 0.05, 20);
  const yaw = (hero.visualYaw ?? 0);
  // Camera in front of the face (model forward = +Z rotated by yaw), a little to the side and above.
  const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
  // The head bone sits at the skull base: frame ~12 cm above it (face centre), a touch of chin/shoulder below.
  hp.y += 0.1;
  cam.position.copy(hp).addScaledVector(fwd, 1.3).addScaledVector(side, 0.45).add(new THREE.Vector3(0, 0.08, 0));
  cam.lookAt(hp.x, hp.y - 0.06, hp.z);
  cam.layers.mask = 1;   // layer 0 only (the actors' normal layer): never the guard / pre-pass layers
  // Hide everything except this hero (and lights).
  const hidden = [];
  for (const o of scene.children) { if (o === hero.view || o.isLight || (o.name === 'lighting')) continue; if (o.visible) { hidden.push(o); o.visible = false; } }
  const bg = scene.background, fog = scene.fog;
  scene.background = new THREE.Color('#0a0605'); scene.fog = null;
  const rt = new THREE.WebGLRenderTarget(SIZE, SIZE, { type: THREE.FloatType });
  let url = null, lit = 0, mean = 0;
  try {
    const prev = gl.getRenderTarget();
    const px = new Float32Array(SIZE * SIZE * 4);
    // r9: the very first render of a freshly built hero (new materials / shadow + light-budget state) can come back empty, so
    // render up to 3 times (warming programs + textures) and keep the first pass that actually contains the hero.
    for (let pass = 0; pass < 3; pass++) {
      gl.setRenderTarget(rt); gl.clear(); gl.render(scene, cam);
      gl.readRenderTargetPixels(rt, 0, 0, SIZE, SIZE, px);
      let n = 0; for (let i = 0; i < px.length; i += 16) if (px[i] + px[i + 1] + px[i + 2] > 0.12) n++;
      if (n > px.length / 16 * 0.06) break;
    }
    gl.setRenderTarget(prev);
    const c = document.createElement('canvas'); c.width = SIZE; c.height = SIZE;
    const g2 = c.getContext('2d'); const img = g2.createImageData(SIZE, SIZE);
    // Flip Y, linear → sRGB with a gentle shoulder (exposure-matched to the in-game AgX look).
    // HDR linear → exposure → Reinhard-style shoulder (luminance-preserving) → sRGB.
    const EXPO = 1.5;
    const tm = (v) => 255 * Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2);
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const s = ((SIZE - 1 - y) * SIZE + x) * 4, d = (y * SIZE + x) * 4;
      const r = px[s] * EXPO, g = px[s + 1] * EXPO, b = px[s + 2] * EXPO;
      const L = 0.2126 * r + 0.7152 * g + 0.0722 * b, k = 1 / (1 + L * 0.9);
      img.data[d] = tm(r * k); img.data[d + 1] = tm(g * k); img.data[d + 2] = tm(b * k); img.data[d + 3] = 255;
    }
    g2.putImageData(img, 0, 0);
    // fraction of pixels clearly brighter than the clear colour (#0a0605 ≈ 7/255) = how much of the frame is actually hero
    let nlit = 0, sum = 0;
    for (let i = 0; i < img.data.length; i += 4) { const l = (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3; sum += l; if (l > 22) nlit++; }
    lit = nlit / (SIZE * SIZE); mean = sum / (SIZE * SIZE);
    const o = document.createElement('canvas'); o.width = OUT; o.height = OUT;
    const g3 = o.getContext('2d'); g3.imageSmoothingQuality = 'high';
    g3.filter = 'contrast(1.12) saturate(1.1)';
    g3.drawImage(c, 0, 0, OUT, OUT);
    url = o.toDataURL('image/png');
  } catch { url = null; }
  rt.dispose();
  for (const o of hidden) o.visible = true;
  hero.view.visible = wasVisible;
  for (const [m, op] of restoreMats) m.opacity = op;
  scene.background = bg; scene.fog = fog;
  // Validate the PIXELS: the portrait must hold more than the clear colour (a black medallion must never be cached)
  const log = (globalThis.__KCA_PORTRAIT_LOG = globalThis.__KCA_PORTRAIT_LOG || []);
  log.push({ id, ok: !!url && lit >= 0.06, lit: +lit.toFixed(3), mean: +mean.toFixed(1), guardHidden });
  if (url && lit >= 0.06) { cache.set(id, url); return url; }
  return null;
}
