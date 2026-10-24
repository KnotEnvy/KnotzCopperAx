// HitFlash: LOCALISED victim flash. Combatant.flash() drives material.emissive for the whole body; this patches every
// actor flash material (onBeforeCompile chain, same pattern as render/characterLook) so that, while a hit is active,
// the flash emissive is masked by a falloff sphere around the actual point of impact (tracked in the victim's
// model space, so it rides the body through hitstop / knockback). Hit confirms use a capped surface tint; charge
// glows retain their emissive. Outside the sphere the body keeps only its base
// emissive, never a white statue. With no active hit the patch is inert
// (kHitW.w = 0). Hero charge flashes are masked to the weapon hand via follow/until (VfxSystem EV.CHARGE).
//
//   vfx.hitFlash.hit(target, point, { radius, gain, color, ticks })   (ScreenFx calls this on EV.HIT)
//   radius = falloff radius (m) · gain = multiplier on the flash emissive inside the core (the spot may be hotter
//   than the old full-body value because it is small)
import * as THREE from 'three';
import { orderFreeKey } from '../render/shaderlib.js';

const _w = new THREE.Vector3();
const TAG = '|kcaHitFlash1';

const FRAG = /* glsl */`
#include <emissivemap_fragment>
if (kHitW.w > 0.0) {
  vec3 khp = (viewMatrix * vec4(kHitW.xyz, 1.0)).xyz;
  float khd = distance(-vViewPosition, khp);
  float khf = 1.0 - smoothstep(kHitW.w * 0.22, kHitW.w, khd);
  khf = khf * khf;                 // tight hot centre, soft skirt
  // heroes-anim C1 r4 (additive): the base emissive is restored THROUGH the material's emissive map. Without this,
  // any material with an emissive map + emissive strength (Seraphine's sabres: runes at 3.0) got a flat kHitBase
  // over its whole surface while a localised flash was active -> the blades rendered as blown-out white bars
  // (board anim-movesets r3, frame 489).
#ifdef USE_EMISSIVEMAP
  vec3 khBase = kHitBase * emissiveColor.rgb;
#else
  vec3 khBase = kHitBase;
#endif
  vec3 khx = max(totalEmissiveRadiance - khBase, vec3(0.0));
  // Hit confirms tint the already-lit surface below; charge glows retain their mapped emissive.
  totalEmissiveRadiance = khBase + khx * khf * kHitGain * (1.0 - kHitSurface.x);
  // Surface confirms do not add emissive, even while simulation is in hitstop.
  totalEmissiveRadiance += kHitTint.rgb * kHitTint.a * khf * (1.0 - kHitSurface.x);
}
`;

// Runs after characterLook's lighting/shoulder, independent of onBeforeCompile patch order.
// Blend toward a warm surface highlight, with Fresnel weighting and the albedo/normal detail intact.
// Max-channel cap below the live bloom threshold also bounds luminance. Existing authored emissives keep
// their idle brightness: the hit itself can never increase an already-bright texel beyond that baseline.
const SURFACE = /* glsl */`
if (kHitW.w > 0.0 && kHitSurface.x > 0.5) {
  vec3 khp = (viewMatrix * vec4(kHitW.xyz, 1.0)).xyz;
  float khf = 1.0 - smoothstep(kHitW.w * 0.22, kHitW.w, distance(-vViewPosition, khp));
  // Degenerate normals/view vectors stay finite; rounding can put the unit-vector dot above 1.
  vec3 khn = normal * inversesqrt(max(dot(normal, normal), 1e-12));
  vec3 khv = vViewPosition * inversesqrt(max(dot(vViewPosition, vViewPosition), 1e-12));
  float khr = pow(max(0.0, 1.0 - abs(dot(khn, khv))), 2.0);
  float kha = khf * khf * kHitTint.a * (0.22 + 0.78 * khr);
  vec3 khc = gl_FragColor.rgb;
  vec3 khhi = kHitTint.rgb * (0.28 + 0.72 * clamp(diffuseColor.rgb, 0.0, 1.0));
  vec3 kht = mix(khc, khhi * kHitSurface.y, kha);
  float khmax = max(kht.r, max(kht.g, kht.b));
  kht *= min(1.0, kHitSurface.y / max(khmax, 1e-5));
  // Never flatten an idle authored emissive just because it lies near a contact.
  gl_FragColor.rgb = mix(kht, khc, step(kHitSurface.y, max(khc.r, max(khc.g, khc.b))));
}
`;

function patchMaterial(m) {
  if (m.userData.kcaHitFlash) return m.userData.kcaHitFlash;
  const u = {
    kHitW: { value: new THREE.Vector4(0, 0, 0, 0) },
    kHitBase: { value: new THREE.Color(0, 0, 0) },
    kHitGain: { value: 1 },
    kHitSurface: { value: new THREE.Vector2(0, 0.85) },
    kHitTint: { value: new THREE.Vector4(1.0, 0.88, 0.65, 0) },
  };
  if (m.userData.baseEmissive) u.kHitBase.value.copy(m.userData.baseEmissive).multiplyScalar(m.userData.baseEmissiveIntensity ?? 1);
  m.userData.kcaHitFlash = u;
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (shader, r) => {
    if (prev) prev.call(m, shader, r);
    shader.uniforms.kHitSurface = u.kHitSurface;
    shader.uniforms.kHitW = u.kHitW; shader.uniforms.kHitBase = u.kHitBase; shader.uniforms.kHitGain = u.kHitGain; shader.uniforms.kHitTint = u.kHitTint;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 kHitW;\nuniform vec3 kHitBase;\nuniform float kHitGain; uniform vec4 kHitTint; uniform vec2 kHitSurface;')
      .replace('#include <emissivemap_fragment>', FRAG)
      .replace('#include <tonemapping_fragment>', SURFACE + '#include <tonemapping_fragment>');
  };
  m.customProgramCacheKey = () => orderFreeKey(m, prevKey, prev, TAG); // perf-1650: same program whichever patch ran first
  m.needsUpdate = true;
  return u;
}

export class HitFlash {
  constructor(game) {
    this.game = game;
    this.active = [];     // { actor, local: Vector3, radius, gain, t }
  }

  /** Patch any actor whose model is new (cheap flag check). Runs every render frame. */
  scan() {
    const w = this.game.world;
    if (!w || !w.actors) return;
    for (const a of w.actors) {
      const root = a.modelRoot;
      if (!root || !a.flashMaterials || root.userData.kcaHitFlash) continue;
      root.userData.kcaHitFlash = true;
      for (const m of a.flashMaterials) if (m && (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshToonMaterial)) patchMaterial(m);
    }
  }

  /**
   * Localise a flash around a point. `follow()` (optional) returns a fresh world point every frame (e.g. a weapon
   * socket) and `until()` keeps the mask on past the flash (sustained charge glow pulses stay local too).
   */
  hit(target, point, { radius = 0.45, gain = 1, ticks = 6, color, strength, tint = false, follow = null, until = null } = {}) {
    if (!target || !target.modelRoot || !point) return;
    this.scan();
    if (color && target.flash) target.flash(color, ticks, strength ?? 0.3);
    const root = target.modelRoot;
    root.updateWorldMatrix(true, false);
    const local = root.worldToLocal(_w.set(point.x, point.y, point.z).clone());
    let e = this.active.find((x) => x.actor === target);
    if (!e) { e = { actor: target }; this.active.push(e); }
    tint = tint || !(follow || until); // blocks are surface confirms too; sustained weapon charge keeps emissive
    e.boss = target.kind === 'boss' || !!root.userData.kcaBossFlash;
    e.local = local; e.radius = tint ? Math.min(radius, e.boss ? 0.48 : 0.65) : radius; e.gain = gain; e.t = 0; e.follow = follow; e.until = until; e.tint = tint;
    this._write(e);
  }

  _write(e) {
    const a = e.actor, root = a.modelRoot;
    const f = a._flash;
    let hold = false;
    if (e.until) { try { hold = !!e.until(); } catch { hold = false; } }
    const on = (f && f.t > 0) || hold;
    if (on && e.follow) { const pt = e.follow(); if (pt) _w.copy(pt); else { root.updateWorldMatrix(true, false); _w.copy(e.local); root.localToWorld(_w); } }
    else if (on && root) { root.updateWorldMatrix(true, false); _w.copy(e.local); root.localToWorld(_w); }
    const cap = Math.max(0, (this.game.renderer?.post?.bloom?.luminanceMaterial.threshold ?? 1) * 0.85);
    for (const m of a.flashMaterials || []) {
      const u = m.userData.kcaHitFlash;
      if (!u) continue;
      u.kHitSurface.value.set(e.tint ? 1 : 0, cap);
      if (on) {
        u.kHitW.value.set(_w.x, _w.y, _w.z, e.radius); u.kHitGain.value = e.gain;
        // Respect caller strength: small-victim contacts must not become a full pale silhouette.
        const strength = Math.min(1, Math.max(0, (f?.strength ?? .5) / .5));
        const alpha = e.tint ? (e.boss ? 0.65 : 0.70) * strength * Math.max(0, 1 - e.t / 0.075) : 0;
        const col = e.tint && f ? f.color : null;
        if (col) u.kHitTint.value.set(col.r, col.g, col.b, alpha);
        else u.kHitTint.value.w = alpha;
      } else { u.kHitW.value.w = 0; u.kHitTint.value.w = 0; }
    }
    return on;
  }

  render(dt) {
    this.scan();
    // Boss phase/poise flashes may bypass ScreenFx. Give those the same safe surface treatment.
    for (const a of this.game.world?.actors || []) {
      if (!(a.kind === 'boss' || a.modelRoot?.userData.kcaBossFlash) || !a.modelRoot || !(a._flash?.t > 0) || this.active.some(e => e.actor === a)) continue;
      this.hit(a, { x: a.pos.x, y: a.pos.y + (a.height || 2) * 0.55, z: a.pos.z }, { tint: true, radius: 0.48 });
    }
    for (let i = 0; i < this.active.length; i++) {
      const e = this.active[i];
      e.t += dt;
      const alive = e.actor.modelRoot && (e.actor.alive !== false || e.t < 2);
      if (!this._write(e) || !alive) { e.local && (e.actor.flashMaterials || []).forEach((m) => { const u = m.userData.kcaHitFlash; if (u) u.kHitW.value.w = 0; }); this.active.splice(i--, 1); }
    }
  }

  clear() { for (const e of this.active) for (const m of e.actor.flashMaterials || []) { const u = m.userData.kcaHitFlash; if (u) u.kHitW.value.w = 0; } this.active.length = 0; }
}
