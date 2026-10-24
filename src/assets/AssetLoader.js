// AssetLoader: GLB loading with cache + per-instance cloning (SkeletonUtils.clone for skinned models), with
// automatic procedural fallback when a GLB is missing or fails the rig check.
//
// Convention: asset id X → /assets/models/X.glb (override in src/assets/manifest.js).
//   await assets.gltf(id)                     cached GLTF or null (missing/invalid, never throws)
//   await assets.instance(id, { fallback })   { root, animations, source: 'glb'|'placeholder' }
//   await assets.character(def)               rigged humanoid for a hero/enemy def:
//        { root, rig:'humanoid', source, rigInfo, sockets: { R, L }, weapon, weaponL, hipHeight }
//   assets.exists(id)                         Promise<boolean>
// A Blender GLB appearing at /assets/models/hero_brann.glb is picked up automatically on the next load.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import manifest from './manifest.js';
import { buildHumanoid, proportionsFor, REQUIRED_BONES } from './placeholderRig.js';
import { buildWeapon } from './placeholderWeapons.js';
import { RigInfo, attachToSocket } from '../anim/retarget.js';
import { reportError, warnOnce } from '../core/log.js';

export class AssetLoader {
  constructor(game) {
    this.game = game;
    this.loader = new GLTFLoader();
    this.cache = new Map();      // id → Promise<gltf|null>
    this.loaded = new Map();     // id → resolved gltf (sync view of `cache`, for releaseGpu)
    this.placeholders = new Map(); // look key → built placeholder prototype
    this.manifest = manifest;
    this.bust = game && game.params && game.params.raw.has('nocache') ? `?v=${Date.now()}` : '';
    /** &placeholder=1 forces procedural characters (readable gameplay captures while a GLB is mid-production). */
    this.forcePlaceholder = !!(game && game.params && game.params.bool && game.params.bool('placeholder'));
  }

  url(id) { const m = this.manifest[id]; return (m && m.url) || `/assets/models/${id}.glb`; }

  /** Fetch + validate + parse a GLB. Missing files (Vite serves index.html → no 'glTF' magic) resolve null. */
  gltf(id) {
    if (!id) return Promise.resolve(null);
    if (this.cache.has(id)) return this.cache.get(id);
    const p = (async () => {
      try {
        const res = await fetch(this.url(id) + this.bust, { cache: 'no-cache' });
        if (!res.ok) return null;
        const buf = await res.arrayBuffer();
        if (buf.byteLength < 12) return null;
        const magic = new Uint32Array(buf, 0, 1)[0];
        if (magic !== 0x46546c67) return null; // 'glTF'
        const base = this.url(id).replace(/[^/]*$/, '');
        const gltf = await this.loader.parseAsync(buf, base);
        await fitTextures(gltf, textureCap(id, this.game && this.game.quality), id);
        prepSkinnedBounds(gltf.scene);
        this.loaded.set(id, gltf);
        return gltf;
      } catch (e) {
        reportError(`asset:${id}`, e);
        return null;
      }
    })();
    this.cache.set(id, p);
    return p;
  }

  exists(id) { return this.gltf(id).then((g) => !!g); }

  /**
   * Free the GPU copies of the cached GLBs' textures (perf-1650 r4). The cache keeps every GLB for the session (so a
   * retry / next stage never re-fetches), and three keeps a texture on the GPU until texture.dispose(): a 5-stage run
   * therefore piled up every hero / enemy tier / boss atlas it had ever drawn — ~1 GB of RGBA8 + mips (a boss is
   * 3 × 2048² = 64 MB, the Brute Brothers 128 MB), ~600 MB more than one stage needs, on a 4 GB card shared with the
   * desktop and other pages. That overcommit is what turns into multi-second WDDM paging stalls in the later stages of
   * a real-time run. A disposed texture keeps its image (ImageBitmap) and re-uploads by itself the next time a clone
   * draws, so this is safe at any time; call it while nothing is drawn (stage start, before prewarm re-uploads what the
   * stage needs). `keep`: Set of asset ids (or an id predicate) whose textures stay resident.
   * Returns { textures, mb } released.
   */
  releaseGpu({ keep = null } = {}) {
    let n = 0, bytes = 0;
    const seen = new Set();
    for (const [id, g] of this.loaded) {
      if (keep && (typeof keep === 'function' ? keep(id) : keep.has(id))) continue;
      g.scene.traverse((o) => {
        for (const m of o.material ? [].concat(o.material) : []) {
          for (const k in m) {
            const t = m[k];
            if (!t || !t.isTexture || t.isRenderTargetTexture || seen.has(t)) continue;
            seen.add(t);
            const im = t.image; if (im && im.width) bytes += im.width * im.height * 4 * (t.generateMipmaps !== false ? 4 / 3 : 1);
            t.dispose(); n++;
          }
        }
      });
    }
    return { textures: n, mb: Math.round(bytes / 1048576) };
  }

  /** Generic instance of a GLB (props, env pieces, weapons). */
  async instance(id, { fallback = null, cloneMaterials = true } = {}) {
    const g = await this.gltf(id);
    if (g) {
      const root = skeletonClone(g.scene);
      if (cloneMaterials) cloneMats(root);
      root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      return { root, animations: g.animations || [], source: 'glb', gltf: g };
    }
    const root = fallback ? fallback() : new THREE.Group();
    return { root, animations: [], source: 'placeholder' };
  }

  /**
   * Rigged humanoid for a hero/enemy definition:
   *   def = { id, asset, height, proportions, palette, style, weapon, weaponL }
   */
  async character(def) {
    const assetId = def.asset || `char_${def.id}`;
    const g = this.forcePlaceholder ? null : await this.gltf(assetId);
    let root = null, source = 'placeholder', hipHeight = 1;
    if (g) {
      const missing = REQUIRED_BONES.filter((b) => !g.scene.getObjectByName(b));
      if (missing.length) {
        warnOnce(`rig:${assetId}`, `${assetId}.glb is missing bones [${missing.join(', ')}] — using placeholder rig`);
      } else {
        root = skeletonClone(g.scene);
        cloneMats(root);
        root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
        const m = this.manifest[assetId] || {};
        if (m.scale) root.scale.setScalar(m.scale);
        if (m.yaw) root.rotation.y = (m.yaw * Math.PI) / 180;
        source = 'glb';
      }
    }
    if (!root) {
      // Placeholder builds are cached per look; instances share geometry and get their own materials (hit flash).
      const key = `${assetId}|${def.height}|${JSON.stringify(def.proportions || {})}|${JSON.stringify(def.palette || {})}|${JSON.stringify(def.style || {})}`;
      let proto = this.placeholders.get(key);
      if (!proto) {
        proto = buildHumanoid({
          proportions: proportionsFor(def.height || 1.8, def.proportions || {}),
          palette: def.palette, style: def.style, name: assetId,
        });
        prepSkinnedBounds(proto.root);
        this.placeholders.set(key, proto);
      }
      root = skeletonClone(proto.root);
      cloneMats(root);
      root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; o.userData.sharedGeometry = true; } });
      hipHeight = proto.hipHeight;
    }
    // Rest info must be captured before any animation touches the bones (it is relative to `root`).
    root.userData.rigKey = `${source}:${assetId}`;
    const rigInfo = RigInfo.of(root);
    if (source === 'glb') hipHeight = rigInfo.hipHeight;

    // Weapons: GLB named in the manifest if present, else the procedural placeholder.
    const man = this.manifest[assetId] || {};
    const weapon = await this.weapon(man.weapon !== undefined ? man.weapon : null, def.weapon);
    const weaponL = def.weaponL ? await this.weapon(man.weaponL || null, def.weaponL) : null;
    const hasEmbeddedWeapon = source === 'glb' && !!root.getObjectByName('weapon');
    if (weapon && !hasEmbeddedWeapon) attachToSocket(rigInfo, 'socket_hand_R', weapon);
    if (weaponL) attachToSocket(rigInfo, 'socket_hand_L', weaponL);
    return {
      root, rig: 'humanoid', source, rigInfo, hipHeight, weapon, weaponL,
      sockets: { R: rigInfo.bones.get('socket_hand_R')?.node || null, L: rigInfo.bones.get('socket_hand_L')?.node || null },
      animations: g ? g.animations : [],
    };
  }

  /** Weapon GLB (grip at origin, blade +Y) or the procedural kind as fallback. */
  async weapon(assetId, kind) {
    if (assetId) {
      const g = await this.gltf(assetId);
      if (g) { const r = skeletonClone(g.scene); cloneMats(r); r.traverse((o) => { if (o.isMesh) o.castShadow = true; }); return r; }
    }
    if (!kind || kind === 'none') return null;
    if (!this.weaponProtos) this.weaponProtos = new Map();
    if (!this.weaponProtos.has(kind)) this.weaponProtos.set(kind, buildWeapon(kind, {}));
    const w = this.weaponProtos.get(kind).clone(true);
    cloneMats(w);
    w.traverse((o) => { if (o.isMesh) o.userData.sharedGeometry = true; });
    return w;
  }
}

// ------------------------------------------------------------------ perf-1650: texture budget
// Blender exports 2048² albedo/normal/ORM atlases for every character and 1024² for weapons: ~64 MB of VRAM per
// enemy/tier GLB (RGBA8 + mips) and ~1 GB per stage on a 4 GB GTX 1650 Ti, with multi-second driver stalls once VRAM
// overcommits, plus a 60–80 ms upload per atlas on first draw. At game distance a character is ≤ ~350 px tall and
// samples mip 1–2 of a 2K atlas anyway, so capping enemy/mount atlases at 1024 and weapons at 512 is invisible.
// Heroes and bosses keep 2K on High (select-screen / cut-in / boss-intro close-ups). Low halves everything.
// Override per asset with manifest[id].maxTexture.
export function textureCap(id, quality) {
  const low = quality && quality.name === 'low';
  const m = manifest[id];
  if (m && m.maxTexture) return low ? Math.max(256, m.maxTexture >> 1) : m.maxTexture;
  const s = String(id || '');
  let cap = 4096;
  if (/^(hero_|boss_)/.test(s) && !/_(axe|flail|hammer|ball|weapon)/.test(s)) cap = 2048;
  else if (/^(enemy_|mount_)/.test(s)) cap = 1024;
  else if (/^weapon_|^boss_.*_(axe|flail|hammer|ball)/.test(s)) cap = 512;
  if (low) cap = cap >= 4096 ? 2048 : Math.max(256, cap >> 1);
  return cap;
}

// Off-main-thread resize (texResize.worker.js); null when workers are unavailable → main-thread fallback.
let _tw = null, _twSeq = 0; const _twJobs = new Map();
function resizeWorker() {
  if (_tw !== null) return _tw || null;
  try {
    _tw = new Worker(new URL('./texResize.worker.js', import.meta.url), { type: 'module' });
    _tw.onmessage = (e) => { const j = _twJobs.get(e.data.id); if (!j) return; _twJobs.delete(e.data.id); if (e.data.out) j.res(e.data.out); else j.rej(Object.assign(new Error(e.data.error || 'resize failed'), { bmp: e.data.bmp })); };
    _tw.onerror = () => { for (const j of _twJobs.values()) j.rej(new Error('worker error')); _twJobs.clear(); _tw = false; };
  } catch (e) { _tw = false; }
  return _tw || null;
}
function resizeOff(im, w, h) {
  const W = typeof ImageBitmap !== 'undefined' && im instanceof ImageBitmap ? resizeWorker() : null;
  if (!W) return createImageBitmap(im, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  return new Promise((res, rej) => { const id = ++_twSeq; _twJobs.set(id, { res, rej }); W.postMessage({ id, bmp: im, w, h }, [im]); });
}

async function fitTextures(gltf, cap, id) {
  if (!cap || typeof createImageBitmap === 'undefined' || !gltf.textures && !gltf.parser) return;
  const texs = new Set();
  gltf.scene.traverse((o) => { for (const m of o.material ? [].concat(o.material) : []) for (const k in m) { const t = m[k]; if (t && t.isTexture) texs.add(t); } });
  const bySource = new Map();
  for (const t of texs) { const im = t.image; if (!im || !(im.width > cap || im.height > cap)) continue; if (!bySource.has(t.source)) bySource.set(t.source, []); bySource.get(t.source).push(t); }
  await Promise.all([...bySource.entries()].map(async ([src, ts]) => {
    const im = src.data, k = cap / Math.max(im.width, im.height);
    try {
      const off = typeof ImageBitmap !== 'undefined' && im instanceof ImageBitmap && resizeWorker();
      const bmp = await resizeOff(im, Math.max(1, Math.round(im.width * k)), Math.max(1, Math.round(im.height * k)));
      src.data = bmp; src.needsUpdate = true;
      if (!off && im.close) im.close(); // (the worker path transferred + closed the original)
    } catch (e) { if (e && e.bmp) src.data = e.bmp; warnOnce(`texfit:${id}`, `texture downscale failed for ${id}: ${e && e.message}`); }
  }));
}

/** SkinnedMesh.computeBoundingSphere CPU-skins every vertex (5–15 ms per character mesh, on the first frame each
 *  new actor is drawn — three needs it for depth sorting). Characters are never frustum-culled, so a padded
 *  bind-pose sphere is all that is needed; clones inherit it (SkinnedMesh.copy). */
function prepSkinnedBounds(root) {
  root.traverse((o) => {
    if (!o.isSkinnedMesh || o.boundingSphere) return;
    const g = o.geometry; if (!g) return;
    if (!g.boundingSphere) g.computeBoundingSphere();
    if (g.boundingSphere) { o.boundingSphere = g.boundingSphere.clone(); o.boundingSphere.radius *= 1.5; }
  });
}

function cloneMats(root) {
  const map = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const conv = (m) => { if (!map.has(m)) map.set(m, m.clone()); return map.get(m); };
    o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
    o.userData.ownsMaterial = true;
  });
}
