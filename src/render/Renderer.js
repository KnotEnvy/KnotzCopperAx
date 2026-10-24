// Renderer: WebGL2 + sRGB output + soft PCF shadows + post chain (AgX tonemapping inside PostFX).
// Owns the THREE.Scene, the Lighting rig and resize handling. Frame stats (all passes incl. shadow and post)
// are exposed as renderer.frameInfo = { calls, triangles } for __KCA.info().
import * as THREE from 'three';
import { PostFX } from './PostFX.js';
import { Lighting } from './Lighting.js';
import { installFog } from './fog.js';
import { shared, noiseTexture } from './shaderlib.js';
import { lookForActors } from './characterLook.js';
import { installPerfProbe } from './perfProbe.js';
import { ProgramGuard } from './programGuard.js';
import { StaticFreeze } from './staticFreeze.js';
import { DepthPrepass } from './depthPrepass.js';

/**
 * NaN/Inf guard for every built-in material: a single NaN pixel (degenerate normal, 0/0 in a light falloff)
 * gets smeared across the whole frame by the bloom mip chain and the screen flashes black. Clamp + scrub the
 * lit colour before it is written. Custom ShaderMaterials (sky, particles) must guard themselves — and PostFX guards
 * the whole post-chain input (FINITE_GLSL) as the last line of defence.
 * perf C1: (1) a bit test on the exponent instead of isnan()/isinf(), which fast-math shader compilers (FXC behind
 * ANGLE/D3D11 on the owner's laptop) may fold to false; (2) a second scrub at the very END of every built-in fragment
 * shader (start of dithering_fragment): code patched in AFTER opaque_fragment — vfx/HitFlash's surface highlight
 * (before tonemapping_fragment), fog — bypassed the first one. Wave C1: Morvane's axe wrote a NaN pixel during hit
 * flashes (tools/scenarios/nan_bisect.mjs) → whole black frames. A few ALU ops per fragment, no new programs.
 */
const FINITE_OUT = '{ uvec3 kcaB = floatBitsToUint( outgoingLight ); outgoingLight = mix( outgoingLight, vec3( 0.0 ), equal( kcaB & 0x7f800000u, uvec3( 0x7f800000u ) ) ); }\n';
const FINITE_END = '{ uvec4 kcaE = floatBitsToUint( gl_FragColor ); gl_FragColor = mix( gl_FragColor, vec4( 0.0 ), equal( kcaE & 0x7f800000u, uvec4( 0x7f800000u ) ) ); }\n';
let nanGuardInstalled = false;
export function installNanGuard() {
  if (nanGuardInstalled) return;
  nanGuardInstalled = true;
  THREE.ShaderChunk.opaque_fragment = THREE.ShaderChunk.opaque_fragment.replace(
    'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
    FINITE_OUT + 'outgoingLight = min( outgoingLight, vec3( 16384.0 ) );\n' +
    'gl_FragColor = vec4( outgoingLight, clamp( diffuseColor.a, 0.0, 1.0 ) );',
  );
  THREE.ShaderChunk.dithering_fragment = FINITE_END + THREE.ShaderChunk.dithering_fragment;
}

/**
 * Dark-light skip (perf-1650): three shades EVERY point/directional light for every lit fragment, even at intensity 0
 * or far outside a point light's cutoff distance. The game keeps many lights parked at 0 (vfx pop pool, the spell
 * light, stage fire lights between flickers, the program guard's light-budget pads) and its point lights are small
 * (≤ 2.6–14 m), so most of that work adds exactly 0. Skip a point light when its colour is black or the fragment is
 * beyond its cutoff (three's attenuation is exactly 0 there), and a directional light when its colour is black.
 * Output is identical; measured −2.2 ms GPU at 1080p in stage 1 for the pads alone. &lightskip=0 disables (A/B).
 */
let lightSkipInstalled = false;
export function installLightSkip() {
  if (lightSkipInstalled) return;
  lightSkipInstalled = true;
  let src = THREE.ShaderChunk.lights_fragment_begin;
  const cut = (hdr) => { const a = src.indexOf(hdr); const b = src.indexOf('#pragma unroll_loop_end', a); return a < 0 || b < 0 ? null : [a, b]; };
  const wrap = (hdr, head, cond) => {
    const r = cut(hdr); if (!r) return false;
    let sec = src.slice(r[0], r[1]);
    const h = sec.indexOf(head); const e = sec.lastIndexOf('RE_Direct(');
    if (h < 0 || e < 0) return false;
    const eEnd = sec.indexOf(';', e) + 1;
    sec = sec.slice(0, h) + `if ( ${cond} ) {\n\t\t` + sec.slice(h, eEnd) + '\n\t\t}' + sec.slice(eEnd);
    src = src.slice(0, r[0]) + sec + src.slice(r[1]);
    return true;
  };
  const okP = wrap('#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )', 'getPointLightInfo(',
    'dot( pointLight.color, vec3( 1.0 ) ) > 0.0 && ( pointLight.distance <= 0.0 || length( pointLight.position - geometryPosition ) < pointLight.distance )');
  const okD = wrap('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )', 'getDirectionalLightInfo(', 'dot( directionalLight.color, vec3( 1.0 ) ) > 0.0');
  if (okP || okD) THREE.ShaderChunk.lights_fragment_begin = src;
  if (!okP || !okD) console.warn('[perf] light-skip patch: chunk layout changed (point ' + okP + ', dir ' + okD + ')');
}

/**
 * Shadow-pass program churn fix (perf-1650 r2): three draws every shadow caster with ONE shared MeshDepthMaterial, so
 * each switch between a skinned and a static (or instanced) caster flips its skinning/instancing state and three
 * re-derives the program (getParameters + cache key: ~8 % of all main-thread JS in combat). Skinned and instanced
 * casters get their own shared depth materials instead — same shader variants, same output, no per-draw lookups.
 * Casters whose material needs three's per-material depth clone (alphaTest/alphaMap/displacement) are left alone.
 */
const _skinDepth = new THREE.MeshDepthMaterial(); _skinDepth.name = 'kca-depth-skinned';
const _instDepth = new THREE.MeshDepthMaterial(); _instDepth.name = 'kca-depth-instanced';
function assignCasterDepth(scene) {
  scene.traverse((o) => {
    if (!o.castShadow || o.customDepthMaterial !== undefined || !(o.isSkinnedMesh || o.isInstancedMesh)) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    if (ms.some((m) => !m || m.alphaTest > 0 || m.alphaMap || m.alphaToCoverage || (m.displacementMap && m.displacementScale !== 0) || (m.clippingPlanes && m.clippingPlanes.length))) return;
    if (o.isInstancedMesh && (o.morphTexture || o.isSkinnedMesh)) return;
    o.customDepthMaterial = o.isSkinnedMesh ? _skinDepth : _instDepth;
  });
}

// Early-z for backdrops (perf-1650 r2d): the sky (renderOrder −1000) and other backdrop layers drew FIRST, shading
// every pixel they cover even where the stage geometry later covers them (measured overdraw +~1 layer indoors). The
// opaque backdrop block (renderOrder < 0, depth-tested) is drawn AFTER the other opaques instead, same relative order
// (renderOrder + 100000). Depth-writing layers are order-independent; a depthWrite=false layer is only safe to move
// when it sits at the far plane (userData.farPlane, render/Sky.js) — otherwise the stage is left untouched.
const _ezOrig = new WeakMap();
function applyEarlyZ(scene) {
  const block = [];
  let ok = true;
  scene.traverse((o) => {
    if (!o.material || !(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
    const r = _ezOrig.has(o) ? _ezOrig.get(o) : o.renderOrder;
    if (r >= 0) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    if (ms.some((m) => !m || m.transparent)) return;
    if (ms.some((m) => !m.depthTest || (!m.depthWrite && !o.userData.farPlane))) ok = false;
    block.push([o, r]);
  });
  for (const [o, r] of block) {
    if (ok) { _ezOrig.set(o, r); o.renderOrder = 100000 + r; } else if (_ezOrig.has(o)) { o.renderOrder = r; _ezOrig.delete(o); }
  }
}

export class Renderer {
  constructor(game, container) {
    installNanGuard();
    if (!(game.params && game.params.get && game.params.get('lightskip') === '0')) installLightSkip();
    installFog();
    noiseTexture();
    this._noDepthFix = !!(game.params && game.params.get && game.params.get('depthfix') === '0');
    this._noEarlyZ = !!(game.params && game.params.get && game.params.get('earlyz') === '0');
    /** Env depth pre-pass (render/depthPrepass.js); &prepass=0 off. */
    this.prepass = game.params && game.params.get && game.params.get('prepass') === '0' ? null : new DepthPrepass();
    if (this.prepass && game.params && game.params.get && game.params.get('prepassold') === '1') this.prepass.legacy = true; // perf-1650 C2 A/B: pre-C2 separate pre-pass render
    this.game = game;
    this.container = container;
    this.quality = game.quality;
    const webgl = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false, preserveDrawingBuffer: false });
    webgl.setPixelRatio(1); // real ratio set by resize() (pixel budget × render scale × DRS)
    webgl.outputColorSpace = THREE.SRGBColorSpace;
    webgl.toneMapping = THREE.NoToneMapping; // AgX is applied in PostFX (HDR half-float chain)
    webgl.shadowMap.enabled = true;
    webgl.shadowMap.type = THREE.PCFShadowMap;
    webgl.info.autoReset = false;
    // perf-1650: three's shader-error check does 3–4 synchronous GL round trips (getProgramInfoLog…) on the first use
    // of every program, each one draining the GPU process queue on the main thread. Keep it for &debug=1 only.
    webgl.debug.checkShaderErrors = !!(game.params && game.params.debug);
    webgl.domElement.id = 'game-canvas';
    container.appendChild(webgl.domElement);
    this.webgl = webgl;
    // perf C1: WebGL context loss (GPU reset / driver timeout / an overloaded GPU process — one Wave C1 capture got
    // CONTEXT_LOST_WEBGL, then only "program not valid" warnings and a black canvas). three preventDefault()s the loss
    // (so the browser may restore) and rebuilds its own GL state on restore; _onContextLost / _onContextRestored handle
    // the game side: pause, a status line, and relinking every program in the background before drawing again.
    // renderer.context = { state: 'ok' | 'lost' | 'restoring', losses, restores, restoreMs } (tools/scenarios/context_loss.mjs)
    this.context = { state: 'ok', losses: 0, restores: 0, restoreMs: 0 };
    webgl.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this._onContextLost(); }, false);
    webgl.domElement.addEventListener('webglcontextrestored', () => { this._onContextRestored(); }, false);

    this.scene = new THREE.Scene();
    this.scene.name = 'world';
    /** Environment/stage geometry lives here so a stage can be torn down in one call. */
    this.envGroup = new THREE.Group(); this.envGroup.name = 'env';
    this.scene.add(this.envGroup);

    this.camera = null; // set by setCamera (CameraRig)
    this.lighting = new Lighting(webgl, this.scene, this.quality);
    this.post = null;
    this.postEnabled = !game.params.raw.has('nopost');
    this.frameInfo = { calls: 0, triangles: 0 };
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    try { this.perf = installPerfProbe(game, this); } catch (e) { this.perf = null; }
    // Dynamic resolution (High: ≥ 0.72, Low: ≥ 0.75 × its 0.8 render scale). r2: steps down within ~0.4 s when
    // ≥ 6 of the last 24 gameplay frames miss 60 Hz (0.05, or 0.1 when ≥ 14 miss; hitches > 80 ms, loads and menus are
    // ignored), recovers 0.05 per 3 s of clean play (backing off ×2 when a step up doesn't hold). Below native, the
    // post chain's adaptive sharpen (PostFX.setUpscale) keeps edges crisp through the browser's bilinear upscale.
    // Off in manual-clock captures and with &drs=0. renderer.drs.scale is readable (__KCA.game.renderer.drs).
    this.drs = { scale: 1, min: this.quality.drsMin ?? 1, win: [], lastChange: 0, lastUp: 0, lastDown: 0, upWait: 3000, changes: 0, gpuHi: -1, gpuAt: 0, off: !!(game.params.capture || (game.params.get && game.params.get('drs') === '0')) };
    // perf C1: DRS needs to know whether a missed frame was the GPU's fault. The probe's frame timer, reduced to ONE
    // TIME_ELAPSED query per frame (read back a few frames later, never stalls), feeds _updateDRS. Without it a busy
    // machine (other GPU processes, compositor stalls) read as "GPU overload": the realtime bench stepped an RTX 5070 at
    // 0.7 ms GPU down to 85 % and every step is a canvas + render-target resize (setSize 55 ms JS + a 200 ms frame).
    // Only when DRS can act (realtime play); &perf=1 / the bench keep their own probe settings. &drsgpu=0 off (A/B).
    if (this.perf && this.perf.gpuAvailable && !this.drs.off && !this.perf.gpuOn && !(game.params.get && game.params.get('drsgpu') === '0')) { this.perf.gpuOn = true; this.perf.gpuSegs = false; }
    /** Late shader programs link in the background instead of freezing the frame (render/programGuard.js). */
    this.guard = game.params.get && game.params.get('guard') === '0' ? null : new ProgramGuard(this);
    /** Static env pieces skip the per-frame matrix recompose (render/staticFreeze.js). */
    this.freeze = game.params.get && game.params.get('freeze') === '0' ? null : new StaticFreeze(this.envGroup, { extra: game.params.get('freeze') === 'noroot' ? [] : [this.scene] });
  }

  setCamera(camera) {
    this.camera = camera;
    if (!this.post) {
      const lum = this.game.params && this.game.params.get ? Number(this.game.params.get('bloomlum')) : NaN;
      const nanGuard = !(this.game.params && this.game.params.get && this.game.params.get('nanguard') === '0'); // &nanguard=0: A/B / repro
      const P = this.game.params && this.game.params.get ? (k) => this.game.params.get(k) : () => null;
      // perf-1650 C2 post folds (PostFX FOLDS): &cafold=0 / &bloomfold=0 restore the separate CA / bloom-luminance passes
      this.post = new PostFX(this.webgl, this.scene, camera, this.quality, { lumScale: lum > 0 && lum <= 1 ? lum : 0.5, prepass: this.prepass, nanGuard, caFold: P('cafold') !== '0', bloomFold: P('bloomfold') !== '0' });
      this.lighting.post = this.post;
      this.post.applyLook(this.lighting.look || {});
      if (this.perf) this.perf.wrapPasses();
    } else this.post.setCamera(camera);
    this.resize();
  }

  get exposure() { return this.post ? this.post.exposure : 1; }
  set exposure(v) { if (this.post) this.post.exposure = v; }

  /** Drawing-buffer pixel ratio: DPR (capped by the preset) → ≤ quality.pixelBudget pixels → × renderScale × DRS. */
  pixelRatioFor(w, h) {
    const q = this.quality;
    let pr = q.pixelRatio || 1;
    if (q.pixelBudget && w * h * pr * pr > q.pixelBudget) pr = Math.sqrt(q.pixelBudget / (w * h));
    return pr * (q.renderScale || 1) * (this.drs ? this.drs.scale : 1);
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
    const pr = this.pixelRatioFor(w, h);
    if (Math.abs(this.webgl.getPixelRatio() - pr) > 1e-4) this.webgl.setPixelRatio(pr);
    this.webgl.setSize(w, h, false);
    this.webgl.domElement.style.width = '100%';
    this.webgl.domElement.style.height = '100%';
    if (this.post) { this.post.setSize(w, h); if (this.post.setUpscale) this.post.setUpscale((this.quality.renderScale || 1) * (this.drs ? this.drs.scale : 1)); }
    if (this.camera) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
    this.width = w; this.height = h;
  }

  /** Remove and dispose everything in envGroup (stage teardown). */
  clearEnv() {
    const g = this.envGroup;
    for (const c of [...g.children]) {
      g.remove(c);
      c.traverse((o) => {
        if (o.geometry && !o.userData.sharedGeometry) o.geometry.dispose();
        if (o.material && !o.userData.sharedMaterial) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      });
    }
  }

  /** Compile all shaders for the current scene (call before __KCA.ready). */
  async compile() {
    if (!this.camera) return;
    try { await this.webgl.compileAsync(this.scene, this.camera); } catch { this.webgl.compile(this.scene, this.camera); }
  }

  _updateDRS() {
    const d = this.drs, g = this.game;
    if (d.off || g.manual || !g.perf) return;
    const ms = g.perf.dt * 1000;
    if (!(ms > 0) || ms > 80) return; // hitches (loads, tab switches) are not a throughput signal
    // only gameplay frames count: never scale down because of the map/title/tally screens or a stage load
    if (g.warming || (g.flow && g.flow.state && g.flow.state !== 'stage') || (g.levels && g.levels.phase && g.levels.phase !== 'fight' && g.levels.phase !== 'go')) return;
    const now = performance.now();
    // A frame that missed 60 Hz because the MAIN THREAD was slow (sim + game-side render JS, excluding this renderer's
    // own call, > 9 ms — e.g. a heat-throttled laptop CPU) is not a GPU/fill problem: lowering the resolution would only
    // blur the image. Only misses with a light main thread count toward stepping down.
    const cpuOther = (g.perf.sim || 0) + Math.max(0, (g.perf.render || 0) - (this._rwPrev || 0));
    // perf C1: …and with a frame timer, only misses while the GPU was actually loaded count (decaying max of the recent GPU
    // frame times ≥ 11 ms, i.e. ≥ 2/3 of the 60 Hz frame). A miss with an idle GPU is contention / compositor / OS
    // scheduling; a lower resolution cannot fix it and the resize itself is a hitch. No reading (no timer, disjoint, or
    // stale > 0.5 s) → old behaviour. Drivers whose frame query includes vsync waits read ~16 ms → old behaviour too.
    const pg = this.perf && this.perf.gpuOn ? this.perf.gpu : null;
    if (pg && pg.at && pg.at !== d.gpuAt) { d.gpuAt = pg.at; d.gpuHi = Math.max(pg.total, d.gpuHi * 0.92); }
    const gpuIdle = !!(pg && pg.at && now - pg.at < 500 && d.gpuHi >= 0 && d.gpuHi < 11);
    d.win.push(ms > 20.5 && cpuOther < 9 && !gpuIdle ? 1 : 0);
    if (d.win.length > 600) d.win.shift();
    const n = d.win.length;
    const missed = (k) => { let s = 0; for (let i = n - k; i < n; i++) s += d.win[i]; return s; };
    // r2: react within ~0.4 s (6 of the last 24 frames missed 60 Hz; big step when badly behind) — spells, boss
    // entrances and the laptop GPU's thermal clock dips are short, sharp load spikes
    if (n >= 24 && now - d.lastChange > 400 && d.scale > d.min + 1e-3) {
      const m = missed(24);
      if (m >= 6) {
        if (now - d.lastUp < 5000) d.upWait = Math.min(30000, d.upWait * 2); // the last step up didn't hold: back off
        d.scale = Math.max(d.min, d.scale - (m >= 14 ? 0.1 : 0.05)); d.lastDown = now; this._drsApply(now); return;
      }
    }
    // recover in small steps after upWait (3 s, doubling on oscillation) of < 2 % missed frames
    if (d.scale < 1 && n >= 180 && now - d.lastChange > d.upWait && missed(180) <= 3) {
      if (now - d.lastDown > 15000) d.upWait = Math.max(3000, d.upWait / 2);
      d.scale = Math.min(1, d.scale + 0.05); d.lastUp = now; this._drsApply(now);
    }
  }

  _drsApply(now) { const d = this.drs; d.lastChange = now; d.win.length = 0; d.changes++; this.resize(); }

  _onContextLost() {
    const c = this.context;
    c.state = 'lost'; c.losses++; c.lostAt = performance.now();
    console.warn('[render] WebGL context lost — waiting for the browser to restore it');
    // don't let the fight run on behind a black screen: open the stage pause menu (the player resumes when the picture
    // is back). Not in manual-clock captures (the harness drives the clock) and not outside a stage.
    try { const f = this.game.flow; if (f && f.pause && f.state === 'stage' && !f.paused && !this.game.manual) f.pause(); } catch (e) { /* ignore */ }
    this._ctxNote('Restoring graphics…');
    clearTimeout(this._ctxTimer);
    this._ctxTimer = setTimeout(() => { if (c.state === 'lost') this._ctxNote('The graphics device was reset and has not come back — reload the page (F5) to continue.'); }, 15000);
  }

  async _onContextRestored() {
    const c = this.context, W = this.webgl, t0 = performance.now();
    c.state = 'restoring'; clearTimeout(this._ctxTimer);
    try {
      if (this.perf && this.perf.onContextRestored) this.perf.onContextRestored(); // fresh timer-query extension + pool
      if (this.guard && this.guard.reset) this.guard.reset(); // every program is gone: nothing is "prepared" any more
      if (this.prepass) this.prepass._fast = null; // perf-1650 C2: its readiness fast path too
      W.shadowMap.needsUpdate = true;
      // relink every program the scene uses NOW, in the background (KHR_parallel_shader_compile), while frames are
      // skipped — instead of ~100 synchronous links on the first restored frame. Compiled for the HDR target the
      // scene is really drawn into. A stuck driver never holds the game: 60 s cap.
      if (this.camera) {
        const prev = W.getRenderTarget();
        let p = null;
        try { W.setRenderTarget(this.post && this.postEnabled && this.post.composer ? this.post.composer.inputBuffer : null); p = W.compileAsync(this.scene, this.camera); } finally { W.setRenderTarget(prev); }
        if (p) await Promise.race([p, new Promise((r) => setTimeout(r, 60000))]);
        // …but the post chain, shadow-depth and depth-prepass programs are not scene materials: two real frames behind
        // the note link them (as the stage prewarm does) — measured 12 s for the first visible frame without this
        for (let i = 0; i < 2 && c.state === 'restoring'; i++) {
          this._ctxWarm = true;
          try { this.render(0); } finally { this._ctxWarm = false; }
          await new Promise((r) => setTimeout(r, 0));
        }
      }
    } catch (e) { console.warn('[render] context restore warm-up failed: ' + (e && e.message)); }
    if (c.state !== 'restoring') return; // lost again meanwhile
    c.restoreMs = Math.round(performance.now() - t0); c.restores++; c.state = 'ok';
    this._ctxNote(null);
    console.warn(`[render] WebGL context restored (programs relinked in ${c.restoreMs} ms)`);
  }

  /** Black cover + status line over the canvas while the GL context is gone (a lost canvas paints white in Chromium,
   *  whatever its CSS background); null removes it. Under the HUD's own layers, input passes through. */
  _ctxNote(text) {
    let el = this._ctxEl;
    if (!text) { if (el) { el.remove(); this._ctxEl = null; } return; }
    if (!el) {
      el = this._ctxEl = document.createElement('div');
      el.className = 'kca-context-note';
      el.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;'
        + 'background:#000;pointer-events:none;padding:0 10%;'
        + 'font:600 15px/1.5 Georgia,serif;letter-spacing:.14em;color:#e9dcc0;text-shadow:0 1px 3px #000';
      this.webgl.domElement.after(el); // right after the canvas: the HUD / pause menu (later in the DOM) stay on top
    }
    el.textContent = text;
  }

  render(frameDt) {
    if (!this.camera || this.game.warmHold) return; // stage prewarm compiling behind the curtain (assets/prewarm.js)
    if (this.context.state !== 'ok' && !this._ctxWarm) return; // GL context lost / relinking after a restore (_onContextRestored)
    const _rw0 = performance.now();
    this._updateDRS();
    shared.uTime.value = this.game.realTime ?? this.game.time ?? 0;
    // hit-flash patch BEFORE the character look, always: an actor spawned after vfx's own scan this frame used to get
    // the look first → the patches chained in the other order → a program variant the prewarm never linked (perfbench
    // S2/S3 boss: M_boss_captain_halberd / M_enemy_viper_captain "|kcaChar4c…|kcaHitFlash1" compiled mid-fight)
    try { const hf = this.game.vfx && this.game.vfx.hitFlash; if (hf && hf.scan) hf.scan(); } catch (e) { /* cosmetic only */ }
    try { lookForActors(this.game.world); } catch (e) { /* cosmetic only */ }
    const _rw1 = performance.now();
    // Stage exposure × transient multiplier (magic darkening, flashes).
    if (this.post) this.post.exposure = (this.lighting.exposure ?? 1) * (this.exposureMul ?? 1);
    if (this.freeze) { try { this.freeze.update(); } catch (e) { try { this.freeze.releaseAll(); } catch (e2) { /* ignore */ } this.freeze = null; } }
    const _rw2 = performance.now();
    if (this.guard) { try { this.guard.update(this.scene, this.camera, this.post && this.postEnabled && this.post.composer ? this.post.composer.inputBuffer : null, this.game.levels ? this.game.levels.stage : null); } catch (e) { /* never block a frame */ } }
    // every 20 frames, and on the SAME frame a new actor / scene child appears (r2d: a caster drawn once with three's
    // default skinned depth variant before the 20-frame scan linked that program mid-combat)
    const _rw3 = performance.now();
    const w = this.game.world, dk = (w && w.actors ? (w.actors.size ?? w.actors.length) : 0) * 4096 + this.scene.children.length;
    const tick = (this._depthTick = (this._depthTick || 0) + 1), changed = dk !== this._depthKey;
    this._depthKey = dk;
    if (this.prepass && (tick % 30 === 3 || changed || this._prepassEnv !== this.envGroup.children.length)) { this._prepassEnv = this.envGroup.children.length; try { this.prepass.scan(this.envGroup, this.scene); } catch (e) { this.prepass.enabled = false; } }
    if (!this._noEarlyZ && (tick % 30 === 2 || changed)) { try { applyEarlyZ(this.scene); } catch (e) { this._noEarlyZ = true; } }
    if (!this._noDepthFix && (tick % 20 === 1 || changed)) { try { assignCasterDepth(this.scene); } catch (e) { this._noDepthFix = true; } }
    const _rw4 = performance.now();
    this.webgl.info.reset();
    const pf = this.perf;
    if (pf) pf.frameBegin();
    if (this.post && this.postEnabled) this.post.render(frameDt);
    else this.webgl.render(this.scene, this.camera);
    if (pf) pf.frameEnd();
    this._rwPrev = performance.now() - _rw0;
    // sub-timings of this frame (perfbench slices.big): patch+look, freeze, guard, scans (prepass/earlyZ/casters), draw
    const sb = this._sub || (this._sub = [0, 0, 0, 0, 0]);
    sb[0] = _rw1 - _rw0; sb[1] = _rw2 - _rw1; sb[2] = _rw3 - _rw2; sb[3] = _rw4 - _rw3; sb[4] = performance.now() - _rw4;
    this.frameInfo.calls = this.webgl.info.render.calls;
    this.frameInfo.triangles = this.webgl.info.render.triangles;
  }
}
