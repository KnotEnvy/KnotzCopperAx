// Boss-lock FOREGROUND OCCLUDER FADE (bosses agent; critic r3: a turtle claw over the lower-right of the stage-2
// arena, a brazier covering ~30 % of the stage-4 frame through Varkhul's rally). Generic — no stage code involved:
// while a boss camera mode is live, every ~0.5 s the scene is scanned for STAGE geometry (not an actor's view) that
//   · sits on the camera side of the walkable band (bbox nearest-z beyond band.zMax + FRONT, or its centre beyond
//     band.zMax + 1 m), is taller than knee height, and
//   · covers ≥ MIN_AREA of the frame (projected bbox ∩ viewport) or overlaps a boss member's screen rect,
// and such meshes fade OUT over ~0.5 s, then stop drawing (a 20 % ghost still read as a dark slab; restored when the
// lock ends). Instanced props (braziers…) are split:
// the offending instance is zero-scaled in its InstancedMesh and a plain Mesh clone (same geometry, faded material)
// takes its place. Faded materials are CLONES (onBeforeCompile / program cache key / shared uniforms carried over)
// compiled with renderer.compileAsync (parallel shader compile) BEFORE the swap — no new-program stall on the frame.
// Small additive / point / sprite FX inside a faded prop's bbox (brazier flames, embers) are hidden meanwhile.
// Stage hook (documented, optional): mesh.userData.bossFade = false never fades; true always fades (when on screen).
//   const f = fadeOccluders(game, { members: () => [...] }) · f.update() each frame (boss camera does) · f.stop()
import * as THREE from 'three';

const OPACITY = 0, MIN_AREA = 0.03, FRONT = 0.25, SCAN = 30, FADE_T = 0.5, MAX_FADED = 12, MAX_INST = 64;
const _b = new THREE.Box3(), _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _zero = new THREE.Matrix4().makeScale(0, 0, 0);

export function fadeOccluders(game, { members = null } = {}) {
  const R = game.renderer, scene = game.scene || (R && R.scene);
  if (!R || !scene || !game.camera) return { update() {}, stop() {}, list: [] };
  const faded = new Map();   // key (mesh | mesh#i) → entry
  const fx = new Set();
  let tick = 0, stopped = false, pending = 0;
  const cam = () => game.camera;

  const actorOf = (o) => { for (let p = o; p; p = p.parent) if (p.userData && p.userData.actor) return p.userData.actor; return null; };
  const visibleChain = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  const isFx = (mt) => mt && (mt.blending === THREE.AdditiveBlending || mt.depthWrite === false || (mt.transparent && (mt.opacity ?? 1) < 0.95));

  function rectOf(box) {
    const W = R.width || 1, H = R.height || 1;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, behind = false;
    for (let i = 0; i < 8; i++) {
      _v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(cam());
      if (_v.z > 1) behind = true;
      const px = (_v.x + 1) / 2 * W, py = (1 - _v.y) / 2 * H;
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
    if (behind) return null;
    const cx0 = Math.max(0, x0), cx1 = Math.min(W, x1), cy0 = Math.max(0, y0), cy1 = Math.min(H, y1);
    if (cx1 <= cx0 || cy1 <= cy0) return null;
    return { x0: cx0, x1: cx1, y0: cy0, y1: cy1, area: (cx1 - cx0) * (cy1 - cy0) / (W * H) };
  }
  const overlap = (a, b) => a && b && a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

  function bossRects() {
    const out = [];
    const L = members ? (typeof members === 'function' ? members() : members) : [];
    for (const m of L) {
      if (!m || !m.alive || m.removed || !m.pos) continue;
      const h = (m.height || 2.5) + (m.mountedOn ? 1.4 : 0);
      _b.min.set(m.pos.x - 0.9, m.pos.y, m.pos.z - 0.4); _b.max.set(m.pos.x + 0.9, m.pos.y + h, m.pos.z + 0.4);
      const r = rectOf(_b); if (r) out.push(r);
    }
    return out;
  }

  function qualifies(box, force) {
    const band = game.world && game.world.band;
    if (!band) return false;
    if (force !== true) {
      if (box.max.y < 0.9) return false;                                      // ground strips / rims stay
      const cz = (box.min.z + box.max.z) / 2;
      if (!(box.min.z > band.zMax + FRONT || cz > band.zMax + 1.0)) return false;
      if (box.min.z < band.zMin) return false;                               // spans the whole band = scenery
    }
    return true;
  }

  function fadedMaterial(mt) {
    return Array.isArray(mt) ? mt.map(fadeClone) : fadeClone(mt);   // fadeClone: shared with fadeWarmProxies (same keys)
  }
  const eachMat = (mt, f) => { for (const m of Array.isArray(mt) ? mt : [mt]) if (m) f(m); };

  function hideFxIn(box) {
    const bx = box.clone().expandByScalar(0.6);
    scene.traverse((o) => {
      if (!o.visible || actorOf(o) || fx.has(o)) return;
      const mt = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!(o.isPoints || o.isSprite || (o.isMesh && isFx(mt)))) return;
      o.getWorldPosition(_v);
      if (bx.containsPoint(_v)) { fx.add(o); o.visible = false; }
    });
  }

  function add(key, mesh, inst) {
    const mat = fadedMaterial(mesh.material);
    const e = { key, mesh, inst, orig: mesh.material, mat, t: 0, ready: false, clone: null };
    faded.set(key, e);
    let tgt = mesh;
    if (inst !== undefined) {
      const c = new THREE.Mesh(mesh.geometry, mat);
      mesh.getMatrixAt(inst, _m); c.matrixAutoUpdate = false; c.matrix.multiplyMatrices(mesh.matrixWorld, _m);
      c.castShadow = mesh.castShadow; c.receiveShadow = mesh.receiveShadow; c.name = (mesh.name || 'inst') + '#fade';
      e.clone = c; e.instMatrix = _m.clone(); tgt = c;
    }
    const tmp = new THREE.Group(); const probe = new THREE.Mesh(mesh.geometry, mat); probe.matrixAutoUpdate = false;
    probe.matrix.copy(inst !== undefined ? e.clone.matrix : mesh.matrixWorld); tmp.add(probe);
    pending++;
    const done = () => {
      pending--;
      if (stopped || e.dead) return;
      e.ready = true;
      if (e.clone) { scene.add(e.clone); e.clone.updateMatrixWorld = () => {}; e.clone.matrixWorld.copy(e.clone.matrix); mesh.setMatrixAt(inst, _zero); mesh.instanceMatrix.needsUpdate = true; }
      else mesh.material = mat;
      hideFxIn(e.box);
    };
    e.box = (inst !== undefined ? instBox(mesh, inst) : _b.setFromObject(mesh)).clone();
    // perf-1650 r3: compile for the target the scene is really drawn into (PostFX's linear HDR buffer): a null target
    // linked an extra sRGB-output variant nobody draws (perfbench S2 boss "physical{4:srgb-linear>srgb}")
    const W = R.webgl, rt = R.post && R.postEnabled && R.post.composer ? R.post.composer.inputBuffer : null, prevRT = W ? W.getRenderTarget() : null;
    try { if (W) W.setRenderTarget(rt); const p = W && W.compileAsync ? W.compileAsync(tmp, cam(), scene) : null; if (p && p.then) p.then(done, done); else done(); } catch (err) { done(); } finally { if (W) W.setRenderTarget(prevRT); }
    return tgt;
  }

  function instBox(mesh, i) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    mesh.getMatrixAt(i, _m);
    return _b.copy(mesh.geometry.boundingBox).applyMatrix4(_m).applyMatrix4(mesh.matrixWorld);
  }

  function scan() {
    const rects = bossRects();
    scene.traverse((o) => {
      if (!(o.isMesh || o.isInstancedMesh) || o.isSkinnedMesh || !o.geometry) return;
      if (o.name && o.name.endsWith('#fade')) return;
      const force = o.userData && o.userData.bossFade;
      if (force === false || !visibleChain(o) || actorOf(o)) return;
      const mt = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!mt || isFx(mt) || mt.userData.bossFadeOf) return;
      const test = (box) => {
        if (!qualifies(box, force)) return false;
        const r = rectOf(box); if (!r) return false;
        return r.area >= MIN_AREA || rects.some((b) => overlap(r, b));
      };
      if (faded.size >= MAX_FADED) return;
      if (o.isInstancedMesh) {
        if (o.count > MAX_INST) return;
        for (let i = 0; i < o.count; i++) { const k = o.uuid + '#' + i; if (faded.has(k)) continue; if (test(instBox(o, i))) add(k, o, i); }
      } else if (!faded.has(o)) {
        o.updateWorldMatrix(true, false);
        if (test(_b.setFromObject(o))) add(o, o);
      }
    });
  }

  const api = {
    list: faded,
    update(dt = 1 / 60) {
      if (stopped) return;
      if (tick++ % SCAN === 0) { try { scan(); } catch (err) { /* never break the fight camera */ } }
      for (const e of faded.values()) {
        if (!e.ready) continue;
        e.t = Math.min(1, e.t + dt / FADE_T);
        const a = 1 + (OPACITY - 1) * e.t * e.t * (3 - 2 * e.t);
        eachMat(e.mat, (m) => { m.opacity = a; });
        if (e.t >= 1 && !e.hidden) { e.hidden = true; (e.clone || e.mesh).visible = false; }   // fully gone: skip the draw
      }
    },
    stop() {
      if (stopped) return; stopped = true;
      for (const e of faded.values()) {
        e.dead = true;
        if (!e.ready) continue;
        if (e.hidden && !e.clone) e.mesh.visible = true;
        if (e.clone) { scene.remove(e.clone); e.mesh.setMatrixAt(e.inst, e.instMatrix); e.mesh.instanceMatrix.needsUpdate = true; }
        else if (e.mesh.material === e.mat) e.mesh.material = e.orig;
        eachMat(e.mat, (m) => m.dispose());
      }
      for (const o of fx) o.visible = true;
      faded.clear(); fx.clear();
    },
  };
  return api;
}

/** perf-1650 r3: PREWARM the faded-clone programs at stage load. On this ANGLE/D3D11 target a "parallel" link still
 *  blocks the next sync GL query (perfbench S2 boss: 1.7–3.9 s in getProgramParameter, 4–5 transparent variants of
 *  lanterns / ringoutPosts / tortoise_leg) — compileAsync at the boss is not enough. Returns one plain-Mesh proxy
 *  (same geometry, same faded clone as add() makes) per distinct material of every mesh that COULD qualify
 *  (camera-side z / height rule or userData.bossFade === true; screen tests skipped = a superset). prewarm.js adds
 *  them to its warm group, so the variants are linked AND first-drawn behind the curtain. Materials are never
 *  disposed (the programs stay cached for the boss-time clones, which share their cache keys). */
const ALWAYS_WARM = /^(ringoutPosts|tortoise_leg|lanterns?)$/;
export function fadeWarmProxies(game, { max = 48 } = {}) {
  const R = game.renderer, scene = game.scene || (R && R.scene), band = game.world && game.world.band;
  if (!scene || !band) return [];
  const isFx = (mt) => mt && (mt.blending === THREE.AdditiveBlending || mt.depthWrite === false || (mt.transparent && (mt.opacity ?? 1) < 0.95));
  const actorOf = (o) => { for (let p = o; p; p = p.parent) if (p.userData && p.userData.actor) return p.userData.actor; return null; };
  const ok = (box, force) => {
    if (force === true) return true;   // no knee-height test: animated props (S2 tortoise leg) rise later
    const cz = (box.min.z + box.max.z) / 2;
    if (!(box.min.z > band.zMax + FRONT || cz > band.zMax + 1.0)) return false;
    return !(box.min.z < band.zMin);
  };
  const seen = new Set(), out = [], box = new THREE.Box3(), m = new THREE.Matrix4();
  scene.updateMatrixWorld();
  scene.traverse((o) => {
    if (out.length >= max || !(o.isMesh || o.isInstancedMesh) || o.isSkinnedMesh || !o.geometry) return;
    if ((o.name && o.name.endsWith('#fade')) || o.name === 'prewarm' || actorOf(o)) return;
    // perf-1650 r4: the boss-time fade also takes these set pieces whatever the band test says (bench first-draw log: S2 "ringoutPosts"
    // and "tortoise_leg" transparent variants were still first drawn at the boss lock = 90–180 ms D3D compile frames)
    const force = o.userData && o.userData.bossFade !== undefined ? o.userData.bossFade : (ALWAYS_WARM.test(o.name || '') ? true : undefined);
    if (force === false) return;
    const mt = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!mt || isFx(mt) || (mt.userData && mt.userData.bossFadeOf)) return;
    const key = Array.isArray(o.material) ? o.material.map((x) => x && x.uuid).join('|') : mt.uuid;
    if (seen.has(key)) return;
    let hit = -1;
    if (o.isInstancedMesh) {
      if (o.count > MAX_INST) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      for (let i = 0; i < o.count && hit < 0; i++) { o.getMatrixAt(i, m); if (ok(box.copy(o.geometry.boundingBox).applyMatrix4(m).applyMatrix4(o.matrixWorld), force)) hit = i; }
    } else if (ok(box.setFromObject(o), force)) hit = 0;
    if (hit < 0) return;
    seen.add(key);
    const fm = Array.isArray(o.material) ? o.material.map(fadeClone) : fadeClone(o.material);
    for (const x of Array.isArray(fm) ? fm : [fm]) x.opacity = 0.5;
    const p = new THREE.Mesh(o.geometry, fm); p.matrixAutoUpdate = false; p.name = 'fadeWarm';
    if (o.isInstancedMesh) p.matrix.multiplyMatrices(o.matrixWorld, m); else p.matrix.copy(o.matrixWorld);
    out.push(p);
  });
  return out;
}
function fadeClone(m) {
  const c = m.clone();
  if (m.onBeforeCompile) c.onBeforeCompile = m.onBeforeCompile;
  if (m.customProgramCacheKey) c.customProgramCacheKey = m.customProgramCacheKey;
  if (m.uniforms) c.uniforms = m.uniforms;
  c.userData = { ...m.userData, bossFadeOf: m };
  c.transparent = true; c.depthWrite = false; c.opacity = 1;
  return c;
}
