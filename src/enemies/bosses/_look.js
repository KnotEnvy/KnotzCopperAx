// Per-boss "character look" tone override. The shared actor key (render/characterLook.js) lifts every albedo below
// preset key.albedoFloor (stage 1: 0.3 linear luminance, ×4 max) and wraps the key 35 % round the shadow side — right
// for small heroes, but on a 3 m boss filling a third of the screen it turns dark, textured hide + iron into flat
// pastel clay (critic r1). bossLook(root) applies the look NOW (so the renderer's lookForActors skips it) and gives
// this boss's materials their own derived uniforms: a lower albedo floor + lift cap, a slightly dimmer and less wrapped
// key. Everything else (rim, clamp, scene lights, hit flash) is untouched, and the values still follow the stage preset.
import * as THREE from 'three';
import { applyCharacterLook, charUniforms } from '../../render/characterLook.js';
import { orderFreeKey } from '../../render/shaderlib.js';

export function bossLook(root, { floor = 0.25, liftMax = 1.5, key = 0.72, wrap = 0.4, metal = 0.5 } = {}) {
  if (!root) return;
  applyCharacterLook(root, { strength: 1 });
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m || !m.userData.kcaChar || m.userData.bossLook) continue;
      m.userData.bossLook = true;
      const tone = new THREE.Vector4(), col = new THREE.Color();
      const uTone = { get value() { const t = charUniforms.kKeyTone.value; return tone.set(t.x * floor, Math.min(t.y, liftMax), t.z, t.w * metal); } };
      const uKey = { get value() { return col.copy(charUniforms.kKeyColor.value).multiplyScalar(key); } };
      const uWrap = { get value() { return charUniforms.kKeyWrap.value * wrap; } };
      const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
      m.onBeforeCompile = (sh, r) => {
        if (prev) prev.call(m, sh, r);
        sh.uniforms.kKeyTone = uTone; sh.uniforms.kKeyColor = uKey; sh.uniforms.kKeyWrap = uWrap;
      };
      // perf-1650 r3: order-free key (render/shaderlib COMMUTING_TAGS): the prewarm patches in another order than a
      // live spawn → '…|kcaHitFlash1|bossLook' vs '…|bossLook|kcaChar4c…' linked 2 brute programs at the S1 boss
      m.customProgramCacheKey = () => orderFreeKey(m, prevKey, prev, '|bossLook');
      m.needsUpdate = true;
    }
  });
}

/** Boss silhouette separation (critic r2: bosses got lost among heroes + hit VFX): a stronger character rim on this
 *  boss's own materials (boss-only GLBs — never call it on shared regular-enemy art). Hit-confirm boostRim() still
 *  works on top (it scales from the new base). */
export function bossRim(root, k = 1.4) {
  if (!root) return;
  root.userData.kcaBossFlash = true; // VFX: compact, bloom-safe hit confirms on group bosses too.
  if (!root.userData.kcaLook) applyCharacterLook(root, { strength: 1 });
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m && m.userData.kcaRimK) { m.userData.kcaRimBase = k; m.userData.kcaRimK.value = k; }
  });
}

/** Boss-size a regular-enemy body (group bosses built from shared art: captains, the wyrm rider). Per-instance
 *  modelRoot scale + hurtbox height; moves/reach are unchanged (≤ 1.2 keeps the swings honest). */
export function bossScale(actor, k = 1.15) {
  if (!actor || !(k > 0)) return;
  if (actor.modelRoot) actor.modelRoot.scale.multiplyScalar(k);
  if (actor.height) actor.height *= k;
  // C2 r1: the STANDING hurtbox (Actor.hurt.h = 0.95 × height, or def.hurtHeight) was left at the unscaled size
  // (Wyrm Rider captain ×1.28: 1.69 m box under a 2.28 m body). A seated rider's standing box is parked in _ride.hurt
  // (mounts/riding.js restores it on dismount) and her live box is the saddle box — the caller re-derives that one
  // after scaling the beast (wyrm_rider.js). The lying box already derives from `height`.
  const standing = actor._ride && actor._ride.hurt ? actor._ride.hurt : actor.hurt;
  if (standing && standing.h > 0) standing.h *= k;
}

/** Boss-only light rig + armour grade (bosses r6, critic r5: Morvane's jade armour under the lime braziers dissolved
 *  into the green throne hall). Per-material uniform overrides on THIS boss's materials only — no light is added and no
 *  program key changes (the source is the shared kcaChar program, so the prewarmed program is reused as-is):
 *    scene  : [r,g,b] multiplier on the scene-lit colour (darken / counter-tint the arena lights)   → kSceneGrade.rgb
 *    desat  : 0..1 desaturation of the scene-lit colour AND the actor-key albedo ("keeps lime off") → kSceneGrade.w
 *    rim    : the rim colour (stage rim is overridden: gold/ember on the finale boss)                → kRimColor
 *    rimMul : × fresnel + edge rim intensity                                                          → kRimParams.x / kRimEdge.x
 *    key    : actor key colour, keyMul × the stage key's luminance (a warm key that lights only him) → kKeyColor
 *    amb    : [hex, intensity] actor ambient                                                          → kKeyAmb
 *  Returns a handle: handle.k scales key + rim live (1 = authored; drive it for pulses, never 0-count lights).
 *  Call on a freshly cloned body BEFORE its first render (Boss create), after bossRim/applyCharacterLook. */
export function bossGrade(root, { scene = [1, 1, 1], desat = 0, rim = null, rimMul = 1, key = null, keyMul = 1, amb = null } = {}, handle = null) {
  const h = handle || { k: 1, shade: 1 };   // C2 r1: pass the body's handle to grade attachments (capes) with the same live k
  if (!root) return h;
  if (!root.userData.kcaLook) applyCharacterLook(root, { strength: 1 });
  const grade = { value: new THREE.Vector4(scene[0], scene[1], scene[2], desat) };
  (h.grades || (h.grades = [])).push({ u: grade, base: [scene[0], scene[1], scene[2]] });   // C2 r13: bossShade() dims every graded part (body + cape) together
  const rimC = rim ? new THREE.Color(rim) : null, keyC = key ? new THREE.Color(key) : null;
  const ambC = amb ? new THREE.Color(amb[0]).multiplyScalar(amb[1] ?? 1) : null;
  const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const rp = new THREE.Vector4(), re = new THREE.Vector4(), kc = new THREE.Color();
  const uRimC = rimC && { get value() { return rimC; } };
  const uRimP = { get value() { return rp.copy(charUniforms.kRimParams.value).setX(charUniforms.kRimParams.value.x * rimMul * h.k); } };
  const uRimE = { get value() { return re.copy(charUniforms.kRimEdge.value).setX(charUniforms.kRimEdge.value.x * rimMul * h.k); } };
  const uKey = keyC && { get value() { return kc.copy(keyC).multiplyScalar(lum(charUniforms.kKeyColor.value) * keyMul * h.k / Math.max(lum(keyC), 1e-3)); } };
  // C2 r13 shade (bossShade): the actor ambient and the hue-locked metal's shadow floor are added AFTER the scene grade,
  // so a "dark" boss stayed lit — both follow h.shade too (default 1 = untouched values)
  const ka = new THREE.Color();
  const uAmbS = { get value() { const sh = h.shade ?? 1; return sh >= 1 ? (ambC || charUniforms.kKeyAmb.value) : ka.copy(ambC || charUniforms.kKeyAmb.value).multiplyScalar(sh); } };
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m || !m.userData.kcaChar || m.userData.bossGrade) continue;
      m.userData.bossGrade = true;
      const prev = m.onBeforeCompile;
      m.onBeforeCompile = (sh, r) => {
        if (prev) prev.call(m, sh, r);
        sh.uniforms.kSceneGrade = grade; sh.uniforms.kRimParams = uRimP; sh.uniforms.kRimEdge = uRimE;
        if (uRimC) sh.uniforms.kRimColor = uRimC;
        if (uKey) sh.uniforms.kKeyColor = uKey;
        sh.uniforms.kKeyAmb = uAmbS;
        const mt = sh.uniforms.kMetalTint;
        if (mt && mt.value && mt.value.isVector4) { const v4 = new THREE.Vector4(); sh.uniforms.kMetalTint = { get value() { const s0 = h.shade ?? 1; return s0 >= 1 ? mt.value : v4.copy(mt.value).setY(mt.value.y * s0); } }; }
      };
      // program key untouched on purpose (same shader source as every kcaChar material → shared, prewarmed program)
    }
  });
  return h;
}

/** C2 r13 (board r12: Varkhul popped into the stage-4 reveal on the lightning frame): shade a graded boss into / out of
 *  darkness — d = 0 authored … 1 a near-black silhouette (scene-lit colour × 0.06, actor key + rim × 0). Uniform values
 *  only (same program); body and cape share the handle so they dim together. */
export function bossShade(h, d) {
  if (!h) return;
  const k = 1 - Math.max(0, Math.min(1, d));
  h.k = k; h.shade = k;
  if (h.grades) for (const g of h.grades) { const m = 0.06 + 0.94 * k; g.u.value.set(g.base[0] * m, g.base[1] * m, g.base[2] * m, g.u.value.w); }
}
