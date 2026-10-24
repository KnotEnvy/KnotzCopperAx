// Depth pre-pass for the opaque stage environment (perf-1650 r2d).
// Measured (tools/perfbench.mjs overdraw): opaque fragments shaded per pixel 2.6–3.1 in every stage — three sorts opaque
// objects front-to-back by object CENTRE, which does little for big floor / wall / kit pieces, so the heavy stage
// shaders (PBR + analytic torch/fire loops + fbm weathering) run ~3× per pixel. The pre-pass draws the eligible env
// meshes depth-only (trivial fragment shader) into the scene target first; the normal colour pass then early-z rejects
// every hidden env fragment, and actors / props behind env are rejected too.
//
// Eligibility (per mesh, rescanned by Renderer on scene changes): under the env group, opaque, depth-tested and
// depth-writing, FrontSide or DoubleSide, no alphaTest / alphaMap / displacement / morphs / skinning / clipping, no
// custom onBeforeRender, and either stock vertex code or a known stage patch that does not move vertices
// (userData.s4 / s5 — stage 4/5 patchMaterial; userData.prepassSafe for any other). Anything else simply draws as
// before. The pre-pass depth is pushed back by a polygon offset so the colour pass (LessEqual) never z-fights with it.
// Only FROZEN pieces (render/staticFreeze.js: matrixAutoUpdate off, parent frozen too) are flagged, so the pre-pass can
// skip three's scene-wide matrix update (scene.matrixWorldAutoUpdate off during it): their world matrices cannot have
// changed since the last frame, and a piece that starts moving is unflagged in the same frame (checked here, after
// StaticFreeze.update). &prepass=0 disables (A/B).
// perf-1650 C2: (1) the pre-pass is drawn INSIDE the colour pass's renderer.render() — right after its shadow map, in the
// same render-target binding as the colour draws (renderBufferDirect per flagged mesh; three's frustum / visibility /
// layer rules replicated) — instead of a separate renderer.render() before it: one scene-target binding per frame
// instead of two (the pre-pass used to count as a whole extra 1080p pass in perfbench passPx: 8.94 → 7.94), and no second
// scene traversal + render-list sort per frame. Depth-only, so drawing it after the shadow map instead of before is
// pixel-identical. (2) It never LINKS a program on screen: its materials are not scene materials (no prewarm scene compile,
// no ProgramGuard), so a new render state (the character-select set's fog / 12 lights) linked kca-prepass synchronously at
// its first draw (C2 wrap QA: a 158–182 ms frame ~0.8 s into the select screen). A variant whose program is not linked for
// the current state is compiled in the background (renderer.compile on proxies, parallel compile) and the pre-pass is
// skipped until it is ready — the colour pass alone renders the same image. &prepass=0 still disables it entirely.
import * as THREE from 'three';

export const PREPASS_LAYER = 7;
const DEFAULT_OBC = THREE.Material.prototype.onBeforeCompile;
const DEFAULT_OBR = THREE.Object3D.prototype.onBeforeRender;

function eligibleMaterial(m) {
  if (!m || m.transparent || !m.depthTest || !m.depthWrite || m.colorWrite === false) return false;
  if (m.side === THREE.BackSide) return false;
  if (m.alphaTest > 0 || m.alphaMap || m.alphaToCoverage || (m.displacementMap && m.displacementScale !== 0)) return false;
  if (m.clippingPlanes && m.clippingPlanes.length) return false;
  if (m.userData && m.userData.noPrepass) return false; // shaders that discard (e.g. S5 floor gallery break / pits)
  if (m.isShaderMaterial || m.isRawShaderMaterial) return !!(m.userData && m.userData.prepassSafe);
  if (m.onBeforeCompile !== DEFAULT_OBC) return !!(m.userData && (m.userData.s4 || m.userData.s5 || m.userData.prepassSafe));
  return true;
}

export class DepthPrepass {
  constructor() {
    this.enabled = true;
    this.material = new THREE.MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 });
    this.material.name = 'kca-prepass';
    this.count = 0;
    this.list = [];
    this.armed = null;     // { scene, camera } of the colour render that draws the pre-pass (arm → shadowMap.render hook)
    this.skipped = 0;      // frames skipped while a variant program was linking (perf-1650 C2 guard)
    this.drawn = 0;        // meshes drawn by the last pre-pass
    this._sig = new WeakMap(); // variant material → render state its program was prepared for
  }

  /** Flag (layer PREPASS_LAYER) every eligible env mesh; unflag what stopped being eligible. */
  scan(envGroup, scene = null) {
    // the scene's lights must be visible to the pre-pass camera too: three shares ONE render state (light setup) per
    // scene between the pre-pass and the colour pass, and a pre-pass that collected no lights flipped the light hash
    // twice a frame → every lit material re-derived its program every frame (getParameters + cache key: the top JS
    // allocator in every stage, ~100 KB/frame)
    if (scene) { const Ls = this.lights = []; scene.traverse((o) => { if (o.isLight) Ls.push(o); }); }
    let n = 0;
    const list = [], cand = [];
    envGroup.traverse((o) => {
      if (!(o.isMesh) || o.isSkinnedMesh) return;
      const g = o.geometry;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      // DYNAMIC entries (userData.prepassMat: an owner-made depth twin with the same vertex code, e.g. S3's alpha-tested
      // eagle feathers): moving is fine (world matrix refreshed in _draw), material rules are the owner's
      if (o.userData.prepassMat && o.visible !== false) { o.layers.enable(PREPASS_LAYER); n++; list.push(o, o.material); return; }
      const elig = o.visible !== false && o.parent && g && !(g.morphAttributes && g.morphAttributes.position && g.morphAttributes.position.length)
        && o.onBeforeRender === DEFAULT_OBR && !o.morphTargetInfluences && ms.every(eligibleMaterial);
      const ok = elig && o.matrixAutoUpdate === false && o.parent.matrixAutoUpdate === false;
      if (ok) { o.layers.enable(PREPASS_LAYER); n++; list.push(o, o.material); } else o.layers.disable(PREPASS_LAYER);
      if (elig && !ok && cand.length < 64) cand.push(o, o.material); // not frozen YET (perf-1650 C2: prepare() links its variants early)
    });
    this.count = n; this.list = list; this.cand = cand; this._ver = (this._ver || 0) + 1;
    return n;
  }

  /**
   * Prewarm (assets/prewarm.js, behind the curtain): link every pre-pass program variant (plain / instanced / batched)
   * before play. Pieces are only flagged once StaticFreeze has frozen them (~60 frames in), so the warm frames alone
   * never drew the pre-pass → its instanced variant linked mid-combat (perfbench smoke1). Draws every eligible env
   * mesh once, frozen or not, into the current target; layers are restored to the scan state afterwards.
   */
  warm(renderer, scene, camera, envGroup) {
    if (!this.enabled || !envGroup) return 0;
    { const Ls = this.lights = []; scene.traverse((o) => { if (o.isLight) Ls.push(o); }); }
    const tmp = [];
    envGroup.traverse((o) => {
      if (!o.isMesh || o.isSkinnedMesh || o.layers.isEnabled(PREPASS_LAYER)) return;
      if (o.userData.prepassMat) { o.layers.enable(PREPASS_LAYER); tmp.push(o); return; }
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      if (o.onBeforeRender === DEFAULT_OBR && !o.morphTargetInfluences && ms.every(eligibleMaterial)) { o.layers.enable(PREPASS_LAYER); tmp.push(o); }
    });
    const all = [...tmp]; for (let i = 0; i < this.list.length; i += 2) all.push(this.list[i]);
    try { if (all.length) this._draw(renderer, scene, camera, all, 1); } finally { for (const o of tmp) o.layers.disable(PREPASS_LAYER); }
    return tmp.length;
  }

  /** Validate the flagged list for this frame (same-frame safety), → false when nothing is left to draw. */
  _validate() {
    if (!this.enabled || !this.count) return false;
    // same-frame safety: a flagged mesh whose material was swapped since the scan (boss occluder fades, dissolves…)
    // must not write pre-pass depth — it could hide what is behind a now-transparent wall
    const L = this.list;
    for (let i = 0; i < L.length; i += 2) {
      const o = L[i];
      const m = L[i + 1];
      if (o.material === m && o.parent && ((!o.matrixAutoUpdate && !o.parent.matrixAutoUpdate) || o.userData.prepassMat) && (Array.isArray(m) || (!m.transparent && m.depthWrite))) continue;
      o.layers.disable(PREPASS_LAYER); L[i] = L[L.length - 2]; L[i + 1] = L[L.length - 1]; L.length -= 2; i -= 2; this.count--; this._ver = (this._ver || 0) + 1;
    }
    return this.count > 0;
  }

  /**
   * Arm the NEXT renderer.render(scene, camera) — the colour pass (PostFX's RenderPass, which has cleared the target):
   * the flagged meshes are drawn depth-only right after its shadow map. → false (nothing armed: the colour pass simply
   * renders without a pre-pass) when there is nothing to draw or a variant program is still linking.
   */
  arm(renderer, scene, camera) {
    this.armed = null;
    if (!this._validate()) return false;
    if (!this._ready(renderer, scene, camera)) { this.skipped++; return false; }
    this._hook(renderer);
    this.armed = { scene, camera };
    return true;
  }

  disarm() { this.armed = null; }

  /** Nothing flagged yet but eligible env exists (a fresh stage / screen whose pieces StaticFreeze has not frozen yet,
   *  ~45 frames): start linking the variants NOW, while the new env's own programs are compiling (ProgramGuard still
   *  holding objects back), instead of 0.75 s later on a fully shown screen. On drivers that compile on the GPU process's
   *  main thread (the WSL2 dev box: ~0.3–0.5 s per program) that link was its own visible stall. */
  prepare(renderer, scene, camera) {
    if (!this.enabled || this.count || !this.cand || !this.cand.length) return;
    this._ready(renderer, scene, camera, this.cand);
  }

  /** Old entry point (a separate depth-only render into the current target, caller cleared it). Kept for tools. */
  render(renderer, scene, camera) {
    if (!this._validate()) return;
    this._draw(renderer, scene, camera, this.list, 2);
  }

  /** Wrap renderer.shadowMap.render (three calls it inside render(), after the render lists are built and before any
   *  colour draw). Re-wraps (outermost) if a tool wrapped it after us; `armed` makes the draw happen exactly once. */
  _hook(renderer) {
    const sm = renderer.shadowMap;
    if (sm.render === this._wrapped) return;
    const inner = sm.render, self = this;
    const w = function kcaPrepassAfterShadow(lights, scene, camera) {
      const r = inner.apply(this, arguments);
      const A = self.armed;
      if (A && A.scene === scene && A.camera === camera) { self.armed = null; try { self._drawDirect(renderer, scene, camera); } catch (e) { self.enabled = false; } }
      return r;
    };
    this._wrapped = w; sm.render = w;
  }

  /**
   * perf-1650 C2 — never link on screen: every variant material this pass will draw must have a ready program for the
   * current render state (fog, target; three re-derives a MeshBasicMaterial's program only on those or a material
   * version change — not on light changes). Stale/unknown variants are compiled for exactly this state with the real
   * scene's lights (renderer.compile on proxies sharing each mesh's geometry: KHR_parallel_shader_compile, no stall).
   */
  _ready(renderer, scene, camera, L = this.list) {
    const tgt = renderer.getRenderTarget();
    const fog = scene.fog || null;
    // fast path: same list, fog and target as the last frame on which every variant was ready (versions are re-checked
    // by the full path whenever the list changes — scan() / _validate() bump _ver)
    const F0 = this._fast;
    if (F0 && F0.ver === this._ver && F0.fog === fog && F0.tgt === tgt && F0.L === L) return true;
    const tk = tgt ? 'rt:' + (tgt.texture ? tgt.texture.type + ':' + tgt.texture.colorSpace : '') : 'screen';
    const props = renderer.properties, sig = this._sig;
    this._fast = null;
    const used = this._used || (this._used = new Map());
    used.clear();
    for (let i = 0; i < L.length; i += 2) { const o = L[i]; const m = this._matFor(o); if (!used.has(m)) used.set(m, o); }
    let stale = null;
    for (const [m, o] of used) {
      const s = sig.get(m);
      if (!s || s.fog !== fog || s.tk !== tk || s.v !== m.version || !props.get(m).currentProgram) (stale || (stale = [])).push([m, o]);
    }
    if (stale) {
      const px = this._proxy || (this._proxy = new THREE.Scene());
      for (const [m, o] of stale) {
        const p = o.isInstancedMesh ? new THREE.InstancedMesh(o.geometry, m, 1) : new THREE.Mesh(o.geometry, m);
        if (o.isInstancedMesh && o.instanceColor) p.instanceColor = o.instanceColor;
        px.add(p);
      }
      try { renderer.compile(px, camera, scene); } catch (e) { /* the draw links it instead (old behaviour) */ }
      for (const c of [...px.children]) px.remove(c);
      for (const [m] of stale) sig.set(m, { fog, tk, v: m.version });
    }
    for (const m of used.keys()) { const p = props.get(m).currentProgram; if (p && p.isReady && !p.isReady()) return false; }
    this._fast = { ver: this._ver, fog, tgt, L };
    return true;
  }

  /** The pre-pass draws (inside the colour render, after its shadow map): culled + sorted like three's opaque list. */
  _drawDirect(renderer, scene, camera) {
    const L = this.list, F = this._frustum || (this._frustum = new THREE.Frustum()), M = this._m4 || (this._m4 = new THREE.Matrix4());
    F.setFromProjectionMatrix(M.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), renderer.coordinateSystem);
    const V = camera.matrixWorldInverse.elements, bit = 1 << PREPASS_LAYER, c = this._c || (this._c = new THREE.Vector3());
    const order = this._order || (this._order = []), pool = this._pool || (this._pool = []);
    order.length = 0;
    for (let i = 0; i < L.length; i += 2) {
      const o = L[i];
      if (!(o.layers.mask & bit)) continue;                 // held back by ProgramGuard (layers = its hide mask) / unflagged
      let vis = true; for (let p = o; p; p = p.parent) if (!p.visible) { vis = false; break; }
      if (!vis || (o.frustumCulled && !F.intersectsObject(o))) continue;
      const g = o.geometry; if (!g) continue;
      if (!g.boundingSphere) g.computeBoundingSphere();
      c.copy(g.boundingSphere.center).applyMatrix4(o.matrixWorld);
      const z = V[2] * c.x + V[6] * c.y + V[10] * c.z + V[14]; // view-space z (negative in front of the camera)
      const it = pool[order.length] || (pool[order.length] = { o: null, m: null, z: 0 });
      it.o = o; it.m = this._matFor(o); it.z = z; order.push(it);
    }
    order.sort((a, b) => (a.m.id - b.m.id) || (b.z - a.z)); // per variant, front to back
    for (const it of order) {
      const o = it.o;
      o.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, o.matrixWorld);
      o.normalMatrix.getNormalMatrix(o.modelViewMatrix);
      renderer.renderBufferDirect(camera, scene, o.geometry, it.m, o, null);
    }
    this.drawn = order.length;
    for (const it of order) { it.o = null; it.m = null; }
  }

  /** Pre-pass material for a mesh: one per program variant (plain / instanced / instanced+colour / batched), so three
   *  never flips a shared material's instancing state per draw (that re-derives the program: getParameters + cache key
   *  join every draw = the #1 per-frame allocator in perfbench alloc, ~100–120 KB/frame with scene.overrideMaterial). */
  _matFor(o) {
    if (o.userData.prepassMat) return o.userData.prepassMat;
    const k = o.isBatchedMesh ? 'batched' : o.isInstancedMesh ? (o.instanceColor ? 'instColor' : 'inst') : 'plain';
    const V = this._variants || (this._variants = { plain: this.material });
    let m = V[k];
    if (!m) { m = V[k] = this.material.clone(); m.name = 'kca-prepass-' + k; }
    return m;
  }

  /** Draw objects list[i] (i += stride) depth-only: materials swapped for the pass, restored after. */
  _draw(renderer, scene, camera, list, stride) {
    const saved = this._saved || (this._saved = []);
    saved.length = 0;
    for (let i = 0; i < list.length; i += stride) { const o = list[i]; saved.push(o.material); o.material = this._matFor(o); if (o.userData.prepassMat) o.updateWorldMatrix(true, false); }
    const mask = camera.layers.mask, bg = scene.background, sau = renderer.shadowMap.autoUpdate, mwa = scene.matrixWorldAutoUpdate;
    camera.layers.set(PREPASS_LAYER);
    const Ls = this.lights || [], lOn = this._lOn || (this._lOn = []);
    lOn.length = 0;
    for (let i = 0; i < Ls.length; i++) { const l = Ls[i]; if (!l.layers.isEnabled(PREPASS_LAYER)) { l.layers.enable(PREPASS_LAYER); lOn.push(l); } }
    scene.background = null; renderer.shadowMap.autoUpdate = false; scene.matrixWorldAutoUpdate = false;
    try { renderer.render(scene, camera); } finally {
      for (let i = 0, j = 0; i < list.length; i += stride, j++) list[i].material = saved[j];
      saved.length = 0;
      for (let i = 0; i < lOn.length; i++) lOn[i].layers.disable(PREPASS_LAYER);
      lOn.length = 0;
      camera.layers.mask = mask; scene.background = bg; renderer.shadowMap.autoUpdate = sau; scene.matrixWorldAutoUpdate = mwa;
    }
  }
}
