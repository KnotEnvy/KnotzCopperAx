// Program guard (perf-1650): the runtime safety net for shader-program hitches.
//
// three.js links a material's program on the frame the material is first drawn, and the first draw BLOCKS the main
// thread until the GPU process has compiled + linked it (WebGLProgram.getUniforms → getProgramInfoLog): 0.1–1.5 s
// per program on the GTX 1650 Ti (ANGLE/D3D11), which is where the 1–2 s boss-entrance and first-spell freezes came
// from. The stage prewarm (assets/prewarm.js) compiles everything it can predict behind the curtain; this guard
// catches whatever it missed:
//   every frame, before the scene is drawn, each visible drawable whose material has never been prepared (or whose
//   material.version changed: onBeforeCompile patches, defines) is prepared with renderer.compile() — which only
//   STARTS the compile (KHR_parallel_shader_compile) — and if its program is not linked yet the object is kept out of
//   the frame (layers mask) until program.isReady(). A cached program is ready at once, so known materials (every
//   ordinary spawn) never skip a frame; a genuinely new one appears a few frames late instead of freezing the game.
// &guard=0 disables it (A/B). Cost: one traverseVisible + a WeakMap lookup per material per frame (~0.1 ms).
import * as THREE from 'three';

const HIDE_MASK = 1 << 30; // a layer no camera renders

// Fresh subtrees: every Object3D.add records its children here, so between full walks the guard only inspects what
// was just added (VFX spawns, actors, props) instead of the whole scene. ~0.05 ms/frame instead of ~1–2 ms.
const fresh = [];
{
  const add0 = THREE.Object3D.prototype.add;
  if (!add0.__kcaFresh) {
    const add = function (...objs) { if (fresh.length < 4096) for (const o of objs) if (o && o.isObject3D) fresh.push(o); return add0.apply(this, objs); };
    add.__kcaFresh = true;
    THREE.Object3D.prototype.add = add;
  }
}
const FULL_EVERY = 30; // frames between full walks (material version / visibility / light-count changes)
const RECENT_FRAMES = 90; // freshly prepared drawables: version re-checked every frame for this long

/** Every lit program bakes the scene's light COUNTS in (numPointLights, numDirLights…): a light being hidden or added
 *  mid-fight (e.g. the cut-in hiding the vfx group's pop lights) used to relink EVERY lit material in view (1–5 s
 *  freezes). The guard pads the scene with zero-intensity lights up to the HIGHEST count seen since the stage started
 *  (reset when game.levels.stage changes), so counts never drop mid-stage, and never pads beyond what the stage uses
 *  (each extra light costs GPU time on every lit pixel — ~0.5 ms at 1080p before the Renderer's dark-light skip).
 *  Hard cap LIGHT_BUDGET: past it → one warning (then the count simply grows: correct, just a relink). */
export const LIGHT_BUDGET = { point: 8, dir: 4 };

export class ProgramGuard {
  constructor(renderer) {
    this.r = renderer;
    this.gl = renderer.webgl;
    this.seen = new WeakMap(); // material → material.version prepared
    this.pending = new Map();  // object → { mask, mats, t0 }
    this.stats = { prepared: 0, hidden: 0, maxWaitMs: 0 };
    this._list = [];
    this._fake = { traverse: (cb) => { for (const o of this._list) cb(o); }, traverseVisible: () => {} };
    this.enabled = true;
    this.pads = null;
    this.lightCounts = { point: 0, dir: 0 };
  }

  _makePads(scene) {
    const pads = { point: [], dir: [], group: new THREE.Group() };
    pads.group.name = 'lightBudgetPads';
    for (let i = 0; i < LIGHT_BUDGET.point; i++) { const l = new THREE.PointLight(0x000000, 0, 0.01, 2); l.position.set(0, -500, 0); l.userData.pad = true; pads.point.push(l); pads.group.add(l); }
    for (let i = 0; i < LIGHT_BUDGET.dir; i++) { const l = new THREE.DirectionalLight(0x000000, 0); l.position.set(0, -500, 0); l.userData.pad = true; pads.dir.push(l); pads.group.add(l); }
    for (const l of [...pads.point, ...pads.dir]) { l.castShadow = false; l.visible = false; }
    scene.add(pads.group);
    return pads;
  }

  /** Put every held-back object back in the frame (prewarm does this before its warm frames). */
  releaseAll() {
    for (const [o, p] of this.pending) if (o.layers.mask === HIDE_MASK) o.layers.mask = p.mask;
    this.pending.clear();
  }

  /** perf C1: after a WebGL context restore every program is gone — forget what was prepared (Renderer._onContextRestored). */
  reset() {
    this.releaseAll();
    this.seen = new WeakMap();
    if (this._recent) this._recent.clear();
    this._frame = FULL_EVERY - 1; // full walk on the next frame
  }

  _ready(m) {
    const p = this.gl.properties.get(m).currentProgram;
    return !p || !p.isReady || p.isReady();
  }

  /** Call once per frame before rendering `scene` with `camera`. */
  update(scene, camera, target = null, stageKey = null) {
    if (!this.enabled || !camera) return;
    if (stageKey !== this._stageKey) { this._stageKey = stageKey; this.maxCounts = null; this._frame = FULL_EVERY - 1; } // full walk now
    // 1) release objects whose programs finished linking
    if (this.pending.size) {
      const now = performance.now();
      for (const [o, p] of this.pending) {
        let ok = true;
        for (const m of p.mats) if (!this._ready(m)) { ok = false; break; }
        if (ok || now - p.t0 > 8000 || !o.parent) { // give up after 8 s: draw it (and link synchronously) anyway
          if ((o.layers.mask & HIDE_MASK) && o.layers.mask === HIDE_MASK) o.layers.mask = p.mask;
          this.pending.delete(o);
          this.stats.maxWaitMs = Math.max(this.stats.maxWaitMs, Math.round(now - p.t0));
        }
      }
    }
    // 2) find drawables with unprepared materials: freshly added subtrees every frame, the whole scene every FULL_EVERY
    const t0 = performance.now();
    this._frame = (this._frame || 0) + 1;
    const full = this._frame % FULL_EVERY === 0 || !this.pads || this.pads.group.parent !== scene;
    // drawables prepared in the last RECENT_FRAMES frames are re-checked EVERY frame: a spawn's materials are often
    // patched a frame or two after it is added (vfx/HitFlash.scan → onBeforeCompile + needsUpdate), and before this
    // that new version was only seen by the next full walk — after it had already been drawn = a synchronous link
    // (perfbench S2 boss: renderer.render 4.5 s when the captains spawned)
    const rec = this._recent || (this._recent = new Map()); // drawable → last frame to watch
    if (!full && rec.size) {
      for (const [o, until] of rec) {
        if (this._frame > until || !o.parent) { rec.delete(o); continue; }
        const mat = o.material;
        if (Array.isArray(mat) ? mat.some((m) => m && this.seen.get(m) !== m.version) : (mat && this.seen.get(mat) !== mat.version)) fresh.push(o);
      }
    }
    if (!full && !fresh.length) return;
    const list = this._list; list.length = 0;
    const seen = this.seen;
    if (!this.pads || this.pads.group.parent !== scene) this.pads = this._makePads(scene);
    let np = 0, nd = 0, lightAdded = false;
    const visit = (o) => {
      if (o.isLight) { if (!o.userData.pad) { lightAdded = true; if (o.isPointLight) np++; else if (o.isDirectionalLight) nd++; } return; }
      if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
      const mat = o.material; if (!mat) return;
      if (Array.isArray(mat)) { for (const m of mat) if (m && seen.get(m) !== m.version) { list.push(o); return; } }
      else if (seen.get(mat) !== mat.version) list.push(o);
    };
    if (full) { fresh.length = 0; scene.traverseVisible(visit); this.stats.walks = (this.stats.walks || 0) + 1; }
    else {
      for (const r of fresh) {
        // only subtrees that are (still) attached to this scene and visible along the way
        let p = r, ok = true;
        while (p && p !== scene) { if (!p.visible) { ok = false; break; } p = p.parent; }
        if (ok && p === scene) r.traverseVisible(visit);
      }
      fresh.length = 0;
      if (lightAdded) { np = 0; nd = 0; scene.traverseVisible((o) => { if (o.isLight && !o.userData.pad) { if (o.isPointLight) np++; else if (o.isDirectionalLight) nd++; } }); }
      else { np = this.lightCounts.point; nd = this.lightCounts.dir; }
    }
    // light budget: pad up to the stage's high-water mark BEFORE anything is compiled or drawn this frame
    const pads = this.pads, mx = this.maxCounts || (this.maxCounts = { point: 0, dir: 0 });
    mx.point = Math.min(LIGHT_BUDGET.point, Math.max(mx.point, np)); mx.dir = Math.min(LIGHT_BUDGET.dir, Math.max(mx.dir, nd));
    for (let i = 0; i < pads.point.length; i++) pads.point[i].visible = i < mx.point - np;
    for (let i = 0; i < pads.dir.length; i++) pads.dir[i].visible = i < mx.dir - nd;
    // perf-1650 C2: once per stage / screen (was once per page — a later offender stayed silent), naming where it happened
    if (np > LIGHT_BUDGET.point || nd > LIGHT_BUDGET.dir) {
      const g = this.r.game, where = (stageKey && stageKey.id) || (g && g.flow && g.flow.state) || 'scene';
      const W = this._warnedAt || (this._warnedAt = new Set());
      if (!W.has(where)) { W.add(where); this._warned = true; console.warn(`[perf] light budget exceeded in ${where}: ${np} point / ${nd} dir (budget ${LIGHT_BUDGET.point}/${LIGHT_BUDGET.dir}) — lit shaders will relink`); }
    }
    this.lightCounts.point = np; this.lightCounts.dir = nd;
    if (!list.length) { this.stats.ms = (this.stats.ms || 0) + performance.now() - t0; return; }
    this.stats.compiles = (this.stats.compiles || 0) + 1;
    // compile for the target the scene is really drawn into (PostFX's linear HDR buffer, not the sRGB canvas)
    const prev = this.gl.getRenderTarget();
    try { this.gl.setRenderTarget(target); this.gl.compile(this._fake, camera, scene); } catch (e) { list.length = 0; return; } finally { this.gl.setRenderTarget(prev); }
    this.stats.prepared += list.length;
    for (const o of list) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      let ok = true;
      for (const m of mats) { if (!m) continue; seen.set(m, m.version); if (ok && !this._ready(m)) ok = false; }
      if (rec.size < 2048 && !rec.has(o)) rec.set(o, this._frame + RECENT_FRAMES);
      if (!ok && !this.pending.has(o) && o.layers.mask !== HIDE_MASK) {
        this.pending.set(o, { mask: o.layers.mask, mats: mats.filter(Boolean), t0: performance.now() });
        o.layers.mask = HIDE_MASK;
        this.stats.hidden++;
      }
    }
    list.length = 0;
    this.stats.ms = (this.stats.ms || 0) + performance.now() - t0;
  }
}
