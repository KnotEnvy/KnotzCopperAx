// Post chain (pmndrs postprocessing): Render → [Sharpen+CA → Exposure → Bloom → Tonemap (AgX) → Grade → Vignette] → SMAA.
// perf-1650 C2 folds (passPx 8.94/9.94 → 7.69): the CA pulse runs inside the main pass (was its own full-res pass whenever a
// pulse was active) and bloom's luminance threshold runs inside its first blur level (was a 960×540 pass) — see FOLDS below.
// &cafold=0 / &bloomfold=0 restore the separate passes (A/B; tools/scenarios/prepass_ab.mjs PA_MODES=new,nofold,pulse).
// perf C1: the chain's inputs are NaN/Inf-guarded (Exposure = main input, bloom luminance = bloom input; FINITE_GLSL) and
// the pulse flash is applied display-referred inside Grade (after tonemapping), not mixed into the linear HDR input.
// Quality presets from core/config QUALITY. Look-dev owns this file; the public knobs are:
//   post.exposure, post.bloom (BloomEffect), post.grade.set({ saturation, contrast, lift, gamma, gain, wb, vibrance,
//   shadowTint, highlightTint, split, grain }), post.vignette (VignetteEffect),
//   post.applyLook({ tonemap, grade, bloom: { intensity, threshold, smoothing, radius }, vignette: { offset, darkness }, grain })
//   (Lighting.apply() calls applyLook with the stage preset), post.pulse({ ca, flash, desat, duration }) for magic/boss hits.
// Grading happens in a perceptual (gamma 2.2) space after tonemapping, so lift/gamma/gain/contrast behave like a
// colourist's wheels. Bloom thresholds are in HDR scene luminance: only emissive fire/embers/magic and the sun exceed them.
import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode,
  VignetteEffect, SMAAEffect, SMAAPreset, Effect, EffectAttribute, BlendFunction, ChromaticAberrationEffect,
} from 'postprocessing';

// perf C1 — NaN/Inf guard at the post-chain inputs. ONE non-finite pixel in the HDR buffer (0/0 in a custom VFX shader,
// a degenerate normal, an additive stack past half-float's 65504 = +Inf) reached the bloom mip chain, whose 6×4-texel
// bottom levels smear it over most of the screen: a one-frame black canvas (NaN) or white-out (Inf). Seen in Wave C1
// (enemies-ai coop_crowd f50, bosses Morvane fight f3); repro: tools/scenarios/nan_inject.mjs (a 6-px NaN quad blacked
// 97 % of the frame). Bit test instead of isnan()/isinf(), which fast-math shader compilers may fold to false.
// NaN / ±Inf → 0 (as Renderer.installNanGuard does per material: a +Inf mapped to the cap still bloomed into a glow ball),
// then clamp to [0, cap]. A few ALU ops in passes that already run (no new pass, no new program).
const FINITE_GLSL = /* glsl */`
vec3 kcaFinite(highp vec3 c, const in float cap) {
  highp uvec3 b = floatBitsToUint(c);
  c = mix(c, vec3(0.0), equal(b & 0x7f800000u, uvec3(0x7f800000u)));
  return clamp(c, 0.0, cap);
}`;
/** Main-chain cap (same as the per-material guard in Renderer.installNanGuard) and the bloom-input cap: far above real
 *  content (tools/scenarios/hdr_scan.mjs, C1: p99.9 luminance 4–8, max 15 crowd / 700 a one-pixel firefly in the Morvane
 *  fight) — it stops a runaway pixel (out-of-range writes clamp to half-float 65504 on D3D12) blooming into a blob. */
const MAIN_CAP = '16384.0', BLOOM_CAP = '256.0';

const exposureFrag = (guard) => /* glsl */`
uniform float exposure;
${guard ? FINITE_GLSL : ''}
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = vec4(${guard ? `kcaFinite(inputColor.rgb, ${MAIN_CAP})` : 'inputColor.rgb'} * exposure, inputColor.a);
}`;

class ExposureEffect extends Effect {
  constructor(guard = true) {
    super('ExposureEffect', exposureFrag(guard), {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map([['exposure', new THREE.Uniform(1)]]),
    });
  }
}

/** Patch the bloom's luminance (first) pass: every bloom mip level is built from its output. */
function guardBloomInput(bloom) {
  const m = bloom && bloom.luminanceMaterial;
  const head = 'varying vec2 vUv;void main(){', fetch = 'vec4 texel=texture2D(inputBuffer,vUv);';
  if (!m || typeof m.fragmentShader !== 'string' || !m.fragmentShader.includes(head) || !m.fragmentShader.includes(fetch)) {
    console.warn('[post] bloom NaN guard: LuminanceMaterial layout changed — bloom input unguarded');
    return false;
  }
  m.fragmentShader = m.fragmentShader.replace(head, FINITE_GLSL + '\n' + head).replace(fetch, fetch + `texel.rgb=kcaFinite(texel.rgb,${BLOOM_CAP});`);
  m.needsUpdate = true;
  return true;
}

// perf-1650 r2: contrast-adaptive sharpen for reduced internal resolution (Low's 0.8 render scale, High's dynamic
// resolution under load). The browser upscales the canvas bilinearly; sharpening the low-res frame first keeps edges
// crisp. amount = 0 at native resolution (uniform branch: ~free, no program switch when DRS moves).
// perf-1650 C2 (FOLDS 1): the chromatic-aberration pulse lives here too — same maths as pmndrs ChromaticAberrationEffect
// with radialModulation (R / B fetched at uv ± offset·(1, aspect), mixed in by the radial weight d), applied to the HDR
// input before the sharpen (to its four neighbours as well when sharpening), i.e. exactly what the old separate CA pass
// wrote for this pass to read. caOffset = 0 → one uniform branch.
const SHARPEN_FRAG = /* glsl */`
uniform float amount;
uniform vec2 caOffset;
uniform float caMod;
vec3 kcaCA(const in vec2 p, const in vec3 c, const in vec2 shift) {
  float d = max(distance(p, vec2(0.5)) * 2.0 - caMod, 0.0);
  if (d <= 0.0) return c;
  return vec3(texture2D(inputBuffer, mix(p, p + shift, d)).r, c.g, texture2D(inputBuffer, mix(p, p - shift, d)).b);
}
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 shift = caOffset * vec2(1.0, aspect);
  bool ca = shift.x != 0.0 || shift.y != 0.0;
  if (amount <= 0.0) { outputColor = ca ? vec4(kcaCA(uv, inputColor.rgb, shift), inputColor.a) : inputColor; return; }
  vec2 tn = uv + vec2(0.0, texelSize.y), ts = uv - vec2(0.0, texelSize.y), te = uv + vec2(texelSize.x, 0.0), tw = uv - vec2(texelSize.x, 0.0);
  vec3 c = inputColor.rgb;
  vec3 n = texture2D(inputBuffer, tn).rgb;
  vec3 s = texture2D(inputBuffer, ts).rgb;
  vec3 e = texture2D(inputBuffer, te).rgb;
  vec3 w = texture2D(inputBuffer, tw).rgb;
  if (ca) { c = kcaCA(uv, c, shift); n = kcaCA(tn, n, shift); s = kcaCA(ts, s, shift); e = kcaCA(te, e, shift); w = kcaCA(tw, w, shift); }
  vec3 mn = min(c, min(min(n, s), min(e, w))), mx = max(c, max(max(n, s), max(e, w)));
  // CAS-style: sharpen less where the local contrast is already high (no halos on hard edges / HDR highlights)
  vec3 k = sqrt(clamp(min(mn, 2.0 - mx) / max(mx, vec3(1e-4)), 0.0, 1.0)) * amount;
  vec3 r = c + (4.0 * c - (n + s + e + w)) * k * 0.25;
  outputColor = vec4(clamp(r, mn, mx), inputColor.a);
}`;

class SharpenEffect extends Effect {
  constructor() {
    super('SharpenEffect', SHARPEN_FRAG, {
      blendFunction: BlendFunction.SRC, attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map([['amount', new THREE.Uniform(0)], ['caOffset', new THREE.Uniform(new THREE.Vector2())], ['caMod', new THREE.Uniform(0.3)]]),
    });
  }
}

// perf-1650 C2 (FOLDS 2): bloom's luminance pass (threshold → a 960×540 target) fed a first blur level of the SAME size,
// whose 13 taps read that target at its own texel centres. This material renders that first level straight from the HDR
// input: each tap samples the input at the same half-res texel centre (bilinear = the luminance pass's own fetch) and
// applies the same NaN guard + threshold → the same values without the extra pass (−0.25 passPx, −8 MB of
// write+read per frame). During a CA pulse each tap takes the same R/B shift (the old luminance pass read the CA'd buffer).
const BLOOM_LUM0_FRAG = (guard) => /* glsl */`
#include <common>
uniform mediump sampler2D inputBuffer;
uniform float threshold;
uniform float smoothing;
uniform vec2 caShift;
uniform float caMod;
#define WEIGHT_INNER 0.125
#define WEIGHT_OUTER 0.05556
varying vec2 vUv;varying vec2 vUv00;varying vec2 vUv01;varying vec2 vUv02;varying vec2 vUv03;varying vec2 vUv04;varying vec2 vUv05;
varying vec2 vUv06;varying vec2 vUv07;varying vec2 vUv08;varying vec2 vUv09;varying vec2 vUv10;varying vec2 vUv11;
${guard ? FINITE_GLSL : ''}
float clampToBorder(const in vec2 uv) { return float(uv.s >= 0.0 && uv.s <= 1.0 && uv.t >= 0.0 && uv.t <= 1.0); }
vec4 lum(const in vec2 p) {
  vec4 t = texture2D(inputBuffer, p);
  if (caShift.x != 0.0 || caShift.y != 0.0) {
    float d = max(distance(p, vec2(0.5)) * 2.0 - caMod, 0.0);
    if (d > 0.0) { t.r = texture2D(inputBuffer, mix(p, p + caShift, d)).r; t.b = texture2D(inputBuffer, mix(p, p - caShift, d)).b; }
  }
  ${guard ? `t.rgb = kcaFinite(t.rgb, ${BLOOM_CAP});` : ''}
#ifdef THRESHOLD
  return t * smoothstep(threshold, threshold + smoothing, luminance(t.rgb));
#else
  return t;
#endif
}
void main() {
  vec4 c = vec4(0.0);
  vec4 w = WEIGHT_INNER * vec4(clampToBorder(vUv00), clampToBorder(vUv01), clampToBorder(vUv02), clampToBorder(vUv03));
  c += w.x * lum(vUv00); c += w.y * lum(vUv01); c += w.z * lum(vUv02); c += w.w * lum(vUv03);
  w = WEIGHT_OUTER * vec4(clampToBorder(vUv04), clampToBorder(vUv05), clampToBorder(vUv06), clampToBorder(vUv07));
  c += w.x * lum(vUv04); c += w.y * lum(vUv05); c += w.z * lum(vUv06); c += w.w * lum(vUv07);
  w = WEIGHT_OUTER * vec4(clampToBorder(vUv08), clampToBorder(vUv09), clampToBorder(vUv10), clampToBorder(vUv11));
  c += w.x * lum(vUv08); c += w.y * lum(vUv09); c += w.z * lum(vUv10); c += w.w * lum(vUv11);
  c += WEIGHT_OUTER * lum(vUv);
  gl_FragColor = c;
  #include <colorspace_fragment>
}`;

/** Replace bloom.update with the folded first level (FOLDS 2). Returns the fold state; state.on = false → pmndrs path. */
function foldBloomLuminance(bloom, guard) {
  const lp = bloom.luminancePass, mb = bloom.mipmapBlurPass, lm = bloom.luminanceMaterial;
  if (!lp || !mb || !lm || !mb.downsamplingMaterial || !mb.upsamplingMaterial || typeof mb.downsamplingMaterial.vertexShader !== 'string') return null;
  const mat = new THREE.ShaderMaterial({
    name: 'kca-bloom-lum0',
    uniforms: { inputBuffer: new THREE.Uniform(null), texelSize: new THREE.Uniform(new THREE.Vector2()), threshold: lm.uniforms.threshold, smoothing: lm.uniforms.smoothing, caShift: new THREE.Uniform(new THREE.Vector2()), caMod: new THREE.Uniform(0.3) },
    blending: THREE.NoBlending, toneMapped: false, depthWrite: false, depthTest: false,
    vertexShader: mb.downsamplingMaterial.vertexShader, fragmentShader: BLOOM_LUM0_FRAG(guard),
  });
  if (lm.defines.THRESHOLD) mat.defines.THRESHOLD = '1';
  const st = { on: true, mat, ran: 0, ca: new THREE.Vector2() }; // ca: the pulse's CA offset this frame (PostFX.render)
  const update0 = bloom.update.bind(bloom);
  bloom.update = function (renderer, inputBuffer, deltaTime) {
    const D = mb.downsamplingMipmaps, U = mb.upsamplingMipmaps, lt = lp.renderTarget;
    // exact only on the luminance target's own grid (= the first level's): anything else → the pmndrs passes
    if (!st.on || !lp.enabled || !mb.enabled || !D.length || lt.width !== D[0].width || lt.height !== D[0].height) return update0(renderer, inputBuffer, deltaTime);
    if (!!lm.defines.THRESHOLD !== !!mat.defines.THRESHOLD) { if (lm.defines.THRESHOLD) mat.defines.THRESHOLD = '1'; else delete mat.defines.THRESHOLD; mat.needsUpdate = true; }
    const dm = mb.downsamplingMaterial, um = mb.upsamplingMaterial;
    mat.uniforms.inputBuffer.value = inputBuffer.texture;
    mat.uniforms.texelSize.value.set(1 / lt.width, 1 / lt.height);
    mat.uniforms.caShift.value.set(st.ca.x, st.ca.y * (inputBuffer.width / Math.max(1, inputBuffer.height))); // × the effects' aspect
    mb.fullscreenMaterial = mat;
    renderer.setRenderTarget(D[0]); renderer.render(mb.scene, mb.camera);
    let prev = D[0];
    mb.fullscreenMaterial = dm;
    for (let i = 1; i < D.length; i++) { dm.setSize(prev.width, prev.height); dm.inputBuffer = prev.texture; renderer.setRenderTarget(D[i]); renderer.render(mb.scene, mb.camera); prev = D[i]; }
    mb.fullscreenMaterial = um;
    for (let i = U.length - 1; i >= 0; --i) { um.setSize(prev.width, prev.height); um.inputBuffer = prev.texture; um.supportBuffer = D[i].texture; renderer.setRenderTarget(U[i]); renderer.render(mb.scene, mb.camera); prev = U[i]; }
    st.ran++;
  };
  return st;
}

const GRADE_FRAG = /* glsl */`
uniform float saturation;
uniform float contrast;
uniform float vibrance;
uniform vec3 lift;
uniform vec3 gamma;
uniform vec3 gain;
uniform vec3 wb;
uniform vec3 shadowTint;
uniform vec3 highlightTint;
uniform float splitAmount;
uniform float desat;
uniform float flash;
uniform vec3 flashColor;
uniform float grain;
uniform float gtime;
float gLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = pow(max(inputColor.rgb * wb, vec3(0.0)), vec3(1.0 / 2.2));
  c = c * gain + lift * (1.0 - c);
  c = pow(max(c, vec3(0.0)), 1.0 / max(gamma, vec3(0.01)));
  float l = gLuma(c);
  vec3 split = mix(shadowTint, highlightTint, smoothstep(0.05, 0.8, l));
  c = mix(c, c * split * 2.0, splitAmount);
  c = (c - 0.45) * contrast + 0.45;
  l = gLuma(c);
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  float vib = 1.0 + vibrance * (1.0 - clamp((mx - mn) * 2.5, 0.0, 1.0));
  c = mix(vec3(l), c, saturation * vib * (1.0 - desat));
  // perf C1: pulse flash, DISPLAY-referred (after tonemap + grade, before grain). A screen blend toward flashColor
  // (gamma-encoded), weighted to mids/highlights: pure black lifts 0.3x as much as a highlight, so silhouettes and
  // dark armour keep their contrast. flash = pulse flash × FLASH_CAP (0.55): flash 1 moves a highlight 55 % of the way
  // to flashColor and black to ~0.165. Before C1 it was mixed into LINEAR HDR before tonemapping (flash 0.1 = +49 luma).
  if (flash > 0.0) {
    vec3 cc = clamp(c, 0.0, 1.0);
    float fw = flash * mix(0.3, 1.0, smoothstep(0.0, 0.75, gLuma(cc)));
    c = cc + flashColor * fw * (1.0 - cc);
  }
  float n = fract(sin(dot(floor(uv * vec2(1920.0, 1080.0)) + fract(gtime * 7.31) * 113.0, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  c += n * grain * (1.0 - abs(l - 0.45) * 1.3);
  c = clamp(c, 0.0, 1.0);
  outputColor = vec4(pow(c, vec3(2.2)), inputColor.a);
}`;

const GRADE_DEFAULTS = {
  saturation: 1.06, contrast: 1.04, vibrance: 0.1, lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], wb: [1, 1, 1],
  shadowTint: [0.47, 0.49, 0.54], highlightTint: [0.54, 0.5, 0.46], split: 0.12, grain: 0.025,
};

class GradeEffect extends Effect {
  constructor() {
    const v3 = (a) => new THREE.Uniform(new THREE.Vector3(...a));
    const d = GRADE_DEFAULTS;
    super('GradeEffect', GRADE_FRAG, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map([
        ['saturation', new THREE.Uniform(d.saturation)], ['contrast', new THREE.Uniform(d.contrast)], ['vibrance', new THREE.Uniform(d.vibrance)],
        ['lift', v3(d.lift)], ['gamma', v3(d.gamma)], ['gain', v3(d.gain)], ['wb', v3(d.wb)],
        ['shadowTint', v3(d.shadowTint)], ['highlightTint', v3(d.highlightTint)],
        ['splitAmount', new THREE.Uniform(d.split)], ['desat', new THREE.Uniform(0)], ['grain', new THREE.Uniform(d.grain)], ['gtime', new THREE.Uniform(0)],
        ['flash', new THREE.Uniform(0)], ['flashColor', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
      ]),
    });
  }
  update(renderer, inputBuffer, dt) { this.uniforms.get('gtime').value += dt || 0.016; }
  /** Partial update; `reset: true` first restores the defaults. */
  set(o = {}) {
    const u = this.uniforms;
    const src = o.reset ? { ...GRADE_DEFAULTS, ...o } : o;
    for (const k of ['saturation', 'contrast', 'vibrance', 'grain']) if (src[k] !== undefined) u.get(k).value = src[k];
    for (const k of ['lift', 'gamma', 'gain', 'wb', 'shadowTint', 'highlightTint']) if (src[k]) u.get(k).value.fromArray(src[k]);
    if (src.split !== undefined) u.get('splitAmount').value = src.split;
  }
}

const TONEMAPS = { agx: ToneMappingMode.AGX, aces: ToneMappingMode.ACES_FILMIC, neutral: ToneMappingMode.NEUTRAL, reinhard: ToneMappingMode.REINHARD2, linear: ToneMappingMode.LINEAR };
/** Display-referred flash strength at pulse flash = 1 (see GRADE_FRAG). */
export const FLASH_CAP = 0.55;
const _fc = new THREE.Color();

export const LOOK_DEFAULTS = {
  tonemap: 'agx',
  bloom: { intensity: 0.9, threshold: 1.1, smoothing: 0.3, radius: 0.72 },
  vignette: { offset: 0.3, darkness: 0.5 },
};

export class PostFX {
  constructor(renderer, scene, camera, quality, opts = {}) {
    this.renderer = renderer;
    this.quality = quality;
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    // perf-1650 r2d: optional env depth pre-pass (render/depthPrepass.js), depth-only env into the same HDR target before
    // the colour draws. perf-1650 C2: ARMED here and drawn by the colour pass's own renderer.render() right after its shadow
    // map (one scene-target binding; was a separate render before it = an extra full-res "pass" + a second scene
    // traversal per frame). arm() returns false (no pre-pass this frame, same image) while a variant program links.
    const pre = this.prepass = opts.prepass || null;
    if (pre) {
      const rp = this.renderPass, orig = rp.render.bind(rp);
      rp.render = (renderer, inputBuffer, outputBuffer, dt, st) => {
        if (!pre.enabled || rp.renderToScreen || !rp.clearPass.enabled) return orig(renderer, inputBuffer, outputBuffer, dt, st);
        if (!pre.count) { // nothing flagged yet: link the variants early if eligible env exists (depthPrepass.prepare)
          if (pre.cand && pre.cand.length && !pre.legacy) { renderer.setRenderTarget(inputBuffer); pre.prepare(renderer, rp.scene, rp.camera); }
          return orig(renderer, inputBuffer, outputBuffer, dt, st);
        }
        if (pre.legacy) { // &prepassold=1 (A/B): the pre-C2 path — clear, separate depth-only render, colour render
          rp.clearPass.render(renderer, inputBuffer);
          renderer.setRenderTarget(inputBuffer);
          pre.render(renderer, rp.scene, rp.camera);
          rp.clearPass.enabled = false;
          try { return orig(renderer, inputBuffer, outputBuffer, dt, st); } finally { rp.clearPass.enabled = true; }
        }
        renderer.setRenderTarget(inputBuffer); // the target the pre-pass variants are prepared for (arm → _ready)
        pre.arm(renderer, rp.scene, rp.camera);
        try { return orig(renderer, inputBuffer, outputBuffer, dt, st); } finally { pre.disarm(); }
      };
    }

    const b = LOOK_DEFAULTS.bloom;
    // &nanguard=0 (Renderer) builds the chain without the NaN/Inf guard (A/B, repro)
    this.nanGuard = opts.nanGuard !== false;
    this.exposureFx = new ExposureEffect(this.nanGuard);
    this.bloom = new BloomEffect({ mipmapBlur: true, intensity: b.intensity, luminanceThreshold: b.threshold, luminanceSmoothing: b.smoothing, radius: b.radius, resolutionScale: quality.bloomResolution });
    if (this.nanGuard) this.nanGuard = guardBloomInput(this.bloom) ? 'main+bloom' : 'main';
    // perf-1650 r2d: the bloom LUMINANCE pass ran at full resolution (a whole extra 1080p pass) although the mip blur
    // chain starts at half res anyway → half-res luminance (&bloomlum=1 restores full res for A/B).
    if (this.bloom.luminancePass && this.bloom.luminancePass.resolution) this.bloom.luminancePass.resolution.scale = opts.lumScale ?? 0.5;
    // perf-1650 C2 FOLDS (see the header): runtime-switchable for A/B (post.fold.ca / post.fold.bloom)
    this.fold = { ca: opts.caFold !== false, bloom: opts.bloomFold !== false };
    this._bloomFold = foldBloomLuminance(this.bloom, !!this.nanGuard);
    if (!this._bloomFold) this.fold.bloom = false;
    this.tonemap = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    this.grade = new GradeEffect();
    this.vignette = new VignetteEffect({ offset: LOOK_DEFAULTS.vignette.offset, darkness: LOOK_DEFAULTS.vignette.darkness });
    this.ca = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0, 0), radialModulation: true, modulationOffset: 0.3 });
    this.sharpen = new SharpenEffect();
    const fx = [this.sharpen, this.exposureFx];
    if (quality.bloom) fx.push(this.bloom);
    fx.push(this.tonemap, this.grade, this.vignette);
    // The CA pulse pass sits BEFORE the main pass (it works fine on HDR input) so the pass that renders to screen
    // (main or SMAA) is always enabled. pmndrs only routes the LAST added pass to the screen; toggling a final
    // pass off would leave the canvas black (this bit quality=low, which has no SMAA pass).
    this.caPass = new EffectPass(camera, this.ca);
    this.caPass.enabled = false;
    this.composer.addPass(this.caPass);
    this.mainPass = new EffectPass(camera, ...fx);
    this.composer.addPass(this.mainPass);
    if (quality.smaa) {
      // Low renders at 0.8× (upscaled): keep AA against shimmer, but the cheap preset (perf-1650)
      this.smaa = new SMAAEffect({ preset: quality.smaaPreset === 'low' ? SMAAPreset.LOW : SMAAPreset.HIGH });
      this.composer.addPass(new EffectPass(camera, this.smaa));
    }
    this._pulse = null;
  }

  /** Sharpen strength for the current internal resolution scale (1 = native → off). */
  setUpscale(scale) { this.sharpen.uniforms.get('amount').value = scale >= 0.99 ? 0 : Math.min(0.7, (1 - scale) * 2.6); }

  get exposure() { return this.exposureFx.uniforms.get('exposure').value; }
  set exposure(v) { this.exposureFx.uniforms.get('exposure').value = v; }

  /** Stage look (from the lighting preset). Missing parts fall back to LOOK_DEFAULTS / grade defaults. */
  applyLook(look = {}) {
    this.tonemap.mode = TONEMAPS[look.tonemap || LOOK_DEFAULTS.tonemap] ?? ToneMappingMode.AGX;
    const g = { ...(look.grade || {}), reset: true };
    if (look.grain !== undefined) g.grain = look.grain;
    if (this.quality.name === 'low') g.grain = 0;
    this.grade.set(g);
    const b = { ...LOOK_DEFAULTS.bloom, ...(look.bloom || {}) };
    this.bloom.intensity = b.intensity;
    this.bloom.luminanceMaterial.threshold = b.threshold;
    this.bloom.luminanceMaterial.smoothing = b.smoothing;
    if (this.bloom.mipmapBlurPass) this.bloom.mipmapBlurPass.radius = b.radius;
    const v = { ...LOOK_DEFAULTS.vignette, ...(look.vignette || {}) };
    this.vignette.offset = v.offset; this.vignette.darkness = v.darkness;
  }

  /** Short screen pulse for impacts / magic: { ca: 0..0.01, flash: 0..1, flashColor, desat: 0..1, duration: s }.
   *  flash is display-referred since C1 (screen blend after tonemapping, × FLASH_CAP): 0.1 ≈ +5 mean luma (a tick),
   *  0.3 ≈ +15 (a clear pop), 0.6 ≈ +30 (a big spell beat) on a stage-1 fight frame; it decays as (1 − t/duration)². */
  pulse({ ca = 0.004, flash = 0, flashColor = null, desat = 0, duration = 0.25 } = {}) {
    // Defensive clamp: CA offset is in UV units — anything past ~0.012 smears the whole frame into RGB ghosts
    // (boss pulses once passed 0.35–0.8). Flash/desat are 0..1 mixes.
    ca = Math.min(Math.max(+ca || 0, 0), 0.012);
    flash = Math.min(Math.max(+flash || 0, 0), 1);
    desat = Math.min(Math.max(+desat || 0, 0), 1);
    this._pulse = { ca, flash, desat, duration: Math.max(+duration || 0, 0.01), t: 0 };
    if (flashColor) { _fc.set(flashColor); this.grade.uniforms.get('flashColor').value.set(_fc.r ** (1 / 2.2), _fc.g ** (1 / 2.2), _fc.b ** (1 / 2.2)); }
  }

  setCamera(camera) {
    this.renderPass.mainCamera = camera;
    for (const p of this.composer.passes) if (p.mainCamera !== undefined) p.mainCamera = camera;
  }

  setSize(w, h) { this.composer.setSize(w, h); }

  render(frameDt) {
    const p = this._pulse, fold = this.fold;
    let cx = 0, cy = 0;
    if (p) {
      p.t += frameDt;
      const k = Math.max(0, 1 - p.t / p.duration);
      const e = k * k;
      if (p.ca > 0 && e > 0.001) { cx = p.ca * e; cy = p.ca * e * 0.6; }
      if (!fold.ca) { this.ca.offset.set(p.ca * e, p.ca * e * 0.6); this.caPass.enabled = p.ca > 0 && e > 0.001; }
      this.grade.uniforms.get('flash').value = p.flash * e * FLASH_CAP;
      this.grade.uniforms.get('desat').value = p.desat * e;
      if (k <= 0) { this._pulse = null; if (!fold.ca) this.caPass.enabled = false; }
    }
    // FOLDS 1: the pulse's CA inside the main pass (no separate CA pass) — and the same shift on bloom's input taps
    const caOff = this.sharpen.uniforms.get('caOffset').value;
    if (fold.ca) { caOff.set(cx, cy); this.caPass.enabled = false; } else caOff.set(0, 0);
    const bf = this._bloomFold;
    if (bf) { bf.on = fold.bloom; bf.ca.set(fold.ca ? cx : 0, fold.ca ? cy : 0); }
    this.composer.render(frameDt);
  }

  dispose() { this.composer.dispose(); }
}
