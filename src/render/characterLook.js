// Character readability ("character light rig"): every hero/enemy/boss/mount material gets, on top of the scene
// lighting, (1) a pixel-width SILHOUETTE RIM — a sun-coloured edge whose width is measured in screen pixels
// (fwidth of N·V), so it stays a crisp 2–3 px line at game distance instead of vanishing like a plain Fresnel —
// only on the KEY side (tapers to 0 on the shadow side — r3), (2) a soft Fresnel glow, (3) an actor-only KEY light (unshadowed lambert, like a
// light-linked character key in film/games) so combatants can be lit brighter than the ground they stand on, and
// (4) a small ambient floor. Renderer applies it automatically to hero/enemy/boss/mount actors (their `modelRoot`).
// Opt out per material with material.userData.noCharacterLook = true.
// The emissive hit-flash in combat/Combatant.js keeps working (it drives material.emissive; this adds on top).
//
//   charUniforms.kRimColor / kRimParams (fresnel intensity, power, ambient floor, non-directional share) — Lighting.apply
//   charUniforms.kRimEdge  (edge intensity, width px, max N·V, DEBUG: w>0.5 shows lit rim red / suppressed blue)             — Lighting.apply
//   charUniforms.kRimNear  (edge fade by camera distance: 0 at x m -> full at y m; C1: the 2-3 px edge outlined every form
//                           like cut paper on the showcase face camera at 1.3 m; the game camera sits at ~13 m)      — Lighting.apply
//   charUniforms.kKeyColor (colour × intensity) / kKeyAmb (flat actor ambient, linear rgb)               — Lighting.apply
//   charUniforms.kRimDir / kKeyDir — view-space directions, refreshed every frame by Lighting.update
//   applyCharacterLook(root, { strength })  strength scales the rim (heroes/enemies/bosses 1, mounts 0.9)
//   boostRim(root, amount)                  transient per-actor rim boost (e.g. hit confirm, magic cast glow)
//   preset.character = { rim, intensity, power, floor, base, edge, width, maxNdv, edgeNear (1.5 m), edgeFar (4 m),
//                        key: { color, intensity, wrap (shadow-side share, 0.12), dir:[x,y,z] (world, toward the light) }, ambient: '#hex', ambientIntensity }
import * as THREE from 'three';
import { orderFreeKey } from './shaderlib.js';

export const charUniforms = {
  kRimColor: { value: new THREE.Color('#ffc090') },
  kRimParams: { value: new THREE.Vector4(0.8, 3.0, 0.05, 0.35) },
  kRimEdge: { value: new THREE.Vector4(1.2, 2.5, 0.5, 0.0) },
  kRimNear: { value: new THREE.Vector2(1.5, 4.0) },
  kRimDir: { value: new THREE.Vector3(0, 0.4, -1).normalize() },
  kKeyColor: { value: new THREE.Color(0, 0, 0) },
  kKeyDir: { value: new THREE.Vector3(0.5, 0.6, 0.6).normalize() },
  kKeyAmb: { value: new THREE.Color(0, 0, 0) },
  kKeyWrap: { value: 0.12 },
  kKeyTone: { value: new THREE.Vector4(0, 1, 2, 0.5) }, // albedo floor, max lift, spec cap, metal studio-ambient
  kClamp: { value: new THREE.Vector2(0.75, 1.1) },      // actor HDR shoulder: knee, max (below bloom threshold)
  // SCENE-light grade (bosses r6): rgb multiplies the scene-lit (non-emissive) colour, w desaturates it + the actor-key
  // albedo. Shared default = identity; a boss overrides it per material (enemies/bosses/_look.js bossGrade) so a
  // coloured arena light (S5 lime braziers) stops tinting him — a uniform-only "light link", no program change.
  kSceneGrade: { value: new THREE.Vector4(1, 1, 1, 0) },
};
/** World-space key direction (toward the light); Lighting.update converts it to view space each frame. */
export const charKeyWorldDir = new THREE.Vector3(0.5, 0.6, 0.6).normalize();

const LIT = (m) => m && (m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshToonMaterial);

const FRAG = /* glsl */`{
  {
    vec3 kse = min(totalEmissiveRadiance, outgoingLight);
    vec3 ksc = outgoingLight - kse;
    ksc = mix(ksc, vec3(dot(ksc, vec3(0.2126, 0.7152, 0.0722))), kSceneGrade.w) * kSceneGrade.rgb;
    outgoingLight = ksc + kse;
  }
  vec3 kcv = normalize(vViewPosition);
  float kndv = clamp(dot(normal, kcv), 0.0, 1.0);
  // r4: PBR-aware actor key. Metals get no diffuse key (it was painting iron/chainmail flat white); instead a
  // roughness-shaped, energy-normalised specular key + a mid-grey "studio" reflection so metal holds a mid-tone
  // with a crisp highlight. Dark albedos get a capped readability lift on the KEY only (not the scene lights).
#ifdef STANDARD
  // baked metal masks are often 0.5–0.85, not 1: gate the actor KEY by a steep metal mask so partially-metal texels
  // never take the diffuse key (the scene lights stay physically correct)
  float kMet = smoothstep(0.15, 0.6, metalnessFactor);
  float kRgh = clamp(roughnessFactor, 0.08, 1.0);
#else
  float kMet = 0.0;
  float kRgh = 0.7;
#endif
  vec3 kalb = diffuseColor.rgb;
  float kal = dot(kalb, vec3(0.2126, 0.7152, 0.0722));
  kalb = mix(kalb, vec3(kal), kSceneGrade.w);
  kalb *= clamp(kKeyTone.x / max(kal, 1e-3), 1.0, kKeyTone.y);
  float kkl = max(dot(normal, kKeyDir), 0.0);
  outgoingLight += kalb * (1.0 - kMet) * (kKeyColor * (kKeyWrap + (1.0 - kKeyWrap) * kkl) + kKeyAmb);
  vec3 kF0 = mix(vec3(0.04), diffuseColor.rgb, kMet);
  // dark baked metal (e.g. blackened chainmail, albedo ~0.1 lin) would read as a black hole under a key-only studio:
  // floor its reflectance for the ACTOR key terms only (same readability floor idea as the diffuse albedo lift)
  kF0 *= mix(1.0, clamp(kKeyTone.x * 1.4 / max(dot(kF0, vec3(0.2126, 0.7152, 0.0722)), 1e-3), 1.0, 3.0), kMet);
  vec3 kH = normalize(kKeyDir + kcv);
  float kA = kRgh * kRgh;
  float kSh = 2.0 / max(kA * kA, 1e-3) - 2.0;
  float kD = (kSh + 2.0) / 8.0 * pow(max(dot(normal, kH), 0.0), kSh);
  vec3 kFr = kF0 + (1.0 - kF0) * pow(1.0 - max(dot(kH, kcv), 0.0), 5.0);
  outgoingLight += kFr * kKeyColor * min(kD * kkl, kKeyTone.z);
  // metal "studio" reflection: a soft key-side gradient (not flat) so curved plate reads as form, at a mid-tone
  // r4b: a procedural 'studio' environment in the REFLECTION direction (bright soft-box on the key side, a faint sky
  // band above, dark floor below), neutral in hue (key colour, luminance-normalised) with a touch of ambient tint.
  // Rough metal blurs it toward its mean. Gives plate/chainmail FORM at a mid-tone instead of a flat tinted wash.
  vec3 kR = reflect(-kcv, normal);
  float kst = smoothstep(-0.35, 1.0, dot(kR, kKeyDir));
  float kstu = 0.05 + 0.62 * kst * kst + 0.14 * smoothstep(-0.1, 0.7, kR.y);
  kstu = mix(kstu, 0.24, kRgh * 0.55);
  vec3 kKn = kKeyColor / max(dot(kKeyColor, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
  outgoingLight += kF0 * kMet * kKeyTone.w * (kstu * mix(kKn, vec3(1.0), 0.5) + kKeyAmb * 0.35);
  // DIRECTIONAL (r3): the rim is sunlight catching the key side of the silhouette, not an outline. Weight by how much
  // the surface faces the key (3D, so interior creases facing away never light up) and by the key's screen-space side;
  // tapers to 0 on the shadow side. kRimParams.w = residual floor (0 = none).
  vec3 kkd = kKeyDir;
  vec2 kn2 = normal.xy / max(length(normal.xy), 1e-4);
  vec2 krd = normalize(kkd.xy + vec2(1e-4, 0.0));
  float kcd = smoothstep(0.1, 0.7, dot(normal, kkd)) * smoothstep(0.25, 0.85, dot(kn2, krd));
  kcd = mix(kRimParams.w, 1.0, kcd);
  // soft Fresnel glow
  float kcf = pow(1.0 - kndv, kRimParams.y);
  // pixel-width silhouette edge: N·V falls to 0 at the silhouette; fwidth(N·V) = its change per pixel
  float kfw = max(fwidth(kndv), 1e-4);
  float kedge = 1.0 - smoothstep(kRimEdge.y * kfw * 0.45, kRimEdge.y * kfw, kndv);
  kedge *= 1.0 - smoothstep(kRimEdge.z * 0.6, kRimEdge.z, kndv);
  // C1 (hero close-ups): the edge is a game-distance readability device; fade it out as the camera comes close so a
  // face/close camera (1.3-2.5 m) does not print a cut-paper outline round hair, circlets and plate borders
  kedge *= smoothstep(kRimNear.x, kRimNear.y, length(vViewPosition));
  // C2 r3 (hero-weapons, per-material opt-in: material.userData.kcaEdgeDark, uniform kEdgeDark = 0 elsewhere): a
  // pixel-width DARK rim just inside the silhouette on EVERY side (not key-gated), same distance fade as the lit edge,
  // so a thin blade / horn / ax bit keeps its outline against a bright flash core, pale skin and the ground.
  // (C2 r5: the dark rim multiplies BEFORE the hue lock below, so it survives on a metal texel too.)
  if (kEdgeDark > 0.0) {
    float kdk = (1.0 - smoothstep(kRimEdge.y * kfw * 1.0, kRimEdge.y * kfw * 2.4, kndv)) * (1.0 - smoothstep(0.25, 0.4, kndv));
    kdk *= smoothstep(kRimNear.x, kRimNear.y, length(vViewPosition));
    outgoingLight *= 1.0 - kEdgeDark * kdk;
  }
  outgoingLight += kRimColor * kcd * kRimK * (kcf * kRimParams.x + kedge * kRimEdge.x);
  outgoingLight = max(outgoingLight, diffuseColor.rgb * kRimParams.z);
  // C2 r5 (hero-weapons, per-material opt-in: material.userData.kcaMetalTint, uniform kMetalTint = 0 elsewhere): HUE-LOCKED
  // METAL. A real metal's reflection is F0-tinted at every angle, but Schlick's F90 = 1, the violet sky env and the blue
  // fill turned copper / gold / violet steel grey-blue at grazing angles and on the shadow side (board r4: "copper only
  // when the flat faces the key"). Re-tint the scene-lit (non-emissive) colour of metal texels to the ALBEDO's chroma,
  // keep its luminance (form and highlights survive), floor that luminance at y x the albedo (dark red-brown copper in
  // shadow, never a grey / black slab) and let hot highlights drift toward white (z) for a pinkish-white specular edge.
  //   kMetalTint = (strength, shadow floor, highlight desaturation, contrast)
  // C2 r6 (board r5 "painted ceramic: one mid value, no dark body tones, no highlight"): two VALUE-RANGE controls, both
  // per-material uniforms (1 / 0 = the r5 behaviour for every other material):
  //   kMetalEnv    scales the IBL (environment) specular on metal texels before the lock. A polished vertical flat seen
  //                from the game camera mirrors the SKY, a near-uniform violet wash that filled every weapon with the same
  //                mid value; scaling it down lets the key / sun / brazier highlights and the albedo's own darks show.
  //   kMetalTint.w contrast: the lit luminance is expanded about the albedo's own luminance (pow(lit / albedo, 1 + w)),
  //                so recesses and the shadow side go darker than the albedo and the specular streak goes hotter, while a
  //                texel lit exactly to its albedo value is unchanged. The floor (y) still applies after the expansion.
  //   The IBL energy taken away by kMetalEnv is handed to a POLISHED KEY STREAK: a soft lobe (exponent 16 at rough 0,
  //                5 at rough 1) where the reflection vector meets the actor key, so a turning bit / bevel sweeps a hot
  //                near-white streak across itself instead of mirroring a structureless sky. (0 when kMetalEnv = 1.)
  if (kMetalTint.x > 0.0) {
    vec3 kme = min(totalEmissiveRadiance, outgoingLight);
    vec3 kmc = max(outgoingLight - kme, 0.0);
    kmc = max(kmc - reflectedLight.indirectSpecular * (kMet * (1.0 - kMetalEnv)), 0.0);
    float kmh = pow(max(dot(kR, kKeyDir), 0.0), mix(16.0, 5.0, kRgh)) * (1.0 - 0.7 * kRgh);
    kmc += kF0 * kMet * mix(kKn, vec3(1.0), 0.5) * kmh * (1.0 - kMetalEnv) * 4.0 * dot(kKeyColor, vec3(0.2126, 0.7152, 0.0722));
    float kml = dot(kmc, vec3(0.2126, 0.7152, 0.0722));
    float kmal = max(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
    float kmr = pow(max(kml / kmal, 1e-4), 1.0 + kMetalTint.w);
    float kmlock = max(kmr * kmal, kmal * kMetalTint.y);
    vec3 kmt = diffuseColor.rgb * (kmlock / kmal);
    kmt = mix(kmt, vec3(kmlock), kMetalTint.z * smoothstep(0.35, 1.1, kmlock));
    outgoingLight = mix(kmc, kmt, kMet * kMetalTint.x) + kme;
  }
  // r4: actor highlight shoulder (max-channel, hue-preserving) on everything except emissive: combatants never exceed
  // kClamp.y in HDR, which sits under the bloom threshold -> only true emissives (hit flash, magic, fire) bloom, and
  // lit skin / polished metal keep a crisp un-clipped highlight after the tonemap + grade.
  {
    vec3 kem = min(totalEmissiveRadiance, outgoingLight);
    vec3 kc = max(outgoingLight - kem, 0.0);
    float km = max(max(kc.r, kc.g), kc.b);
    float kk = kClamp.x, kw = max(kClamp.y - kClamp.x, 1e-3);
    float kt = km <= kk ? km : kk + kw * (1.0 - exp(-(km - kk) / kw));
    outgoingLight = kc * (kt / max(km, 1e-5)) + kem;
  }
  // C2 r7 weapons: finite reflected strip light. The old angular key lobe misses most
  // bevel normals and the common actor shoulder flattens its rare peaks. Local position
  // bounds a small soft-box image; its centre follows the weapon's view-space axis,
  // never a clock, so it travels with the swing and stops during hitstop. Uniform opt-in.
  // A separate bounded shoulder lets a polished hotspot exceed the matte body's cap.
  if (kWeaponGlint.x > 0.0 && kMet > 0.0) {
    float kwAcross = mix(vKWeaponPos.x, vKWeaponPos.z, kWeaponGlint.w);
    float kwCentre = kWeaponGlint.y * (0.60 + 0.28 * vKWeaponPos.w);
    float kwWidth = kWeaponGlint.y * 0.038;
    float kwBand = 1.0 - smoothstep(0.0, kwWidth,
      abs(vKWeaponPos.y + kwAcross * 0.45 - kwCentre));
    float kwBlade = smoothstep(kWeaponGlint.z, kWeaponGlint.z + 0.035, vKWeaponPos.y);
    float kwPolish = 1.0 - smoothstep(0.24, 0.58, kRgh);
    float kwHot = kwBand * kwBlade * kwPolish * kwPolish * kwPolish * kMet * kWeaponGlint.x;
    vec3 kwWhite = mix(vec3(1.0), normalize(diffuseColor.rgb + vec3(0.001)), 0.08);
    outgoingLight += kwWhite * (1.35 * (1.0 - exp(-kwHot * 2.0)));
  }
  // C2 r7 contact fill: body-local warm lift plus a two-frame heavy rim, after the
  // actor shoulder. Per-material uniforms keep the existing program and texture detail.
  if (kContactPoint.w > 0.0 && kContactFill.a > 0.0) {
    vec3 kcp = (viewMatrix * vec4(kContactPoint.xyz, 1.0)).xyz;
    vec3 kdelta = kcp + vViewPosition;
    float kcf = 1.0 - smoothstep(kContactPoint.w * 0.18, kContactPoint.w, length(kdelta));
    float kface = 0.40 + 0.60 * max(0.0, dot(normal, normalize(kdelta + vec3(0.0, 0.0, 0.15))));
    outgoingLight += kContactFill.rgb * kContactFill.a * kcf * kface * (0.20 + diffuseColor.rgb * 0.80);
    outgoingLight += vec3(1.0, 0.98, 0.88) * kContactWhite * kcf * pow(1.0 - kndv, 1.25);
  }
  if (kRimEdge.w > 1.5) outgoingLight = vec3(0.0, 0.1 + step(0.5, kMet) * 0.6, 0.0); // debug 2: metalness mask (green)
  else if (kRimEdge.w > 0.5) outgoingLight = vec3(kcd * 10.0 * kedge, 0.0, kedge * 0.3); // debug: red = lit rim, blue = suppressed edge
}
`;

export function applyCharacterLook(root, { strength = 1 } = {}) {
  if (!root) return;
  root.userData.kcaLook = true;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of list) {
      if (!LIT(m) || m.userData.kcaChar || m.userData.noCharacterLook) continue;
      m.userData.kcaChar = true;
      // C2 r13 (hero-seraphine, additive): per-material rim scale from glTF material extras `kcaRimScale` (1 = unchanged).
      // The alpha-tested hair cards sit at grazing angles everywhere, so the full hero rim washed them pale.
      const rs = m.userData.kcaRimScale === undefined ? 1 : +m.userData.kcaRimScale;
      const k = { value: strength * rs };
      m.userData.kcaRimK = k;
      m.userData.kcaRimBase = strength * rs;
      // C2 r3 (hero-weapons): per-material dark-rim strength (0 = off; anim/retarget.js sets it on the hero weapons)
      const ed = m.userData.kcaEdgeDarkU || (m.userData.kcaEdgeDarkU = { value: +m.userData.kcaEdgeDark || 0 });
      // C2 r5 (hero-weapons): per-material hue-locked metal (vec4, 0 = off; anim/retarget.js sets it on the hero weapons)
      const mt = m.userData.kcaMetalTintU || (m.userData.kcaMetalTintU = { value: new THREE.Vector4().fromArray(m.userData.kcaMetalTint || [0, 0, 0, 0]) });
      // C2 r6 (hero-weapons): per-material IBL scale on metal texels (1 = unchanged; anim/retarget.js lowers it on the hero weapons)
      const menv = m.userData.kcaMetalEnvU || (m.userData.kcaMetalEnvU = { value: m.userData.kcaMetalEnv === undefined ? 1 : +m.userData.kcaMetalEnv });
      const wg = m.userData.kcaWeaponGlintU || (m.userData.kcaWeaponGlintU = {
        value: new THREE.Vector4().fromArray(m.userData.kcaWeaponGlint || [0, 1, 0, 0]),
      });
      const contact = m.userData.kcaContact || (m.userData.kcaContact = {
        point: { value: new THREE.Vector4() }, fill: { value: new THREE.Vector4() }, white: { value: 0 }, age: 0, life: 0,
      });
      const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
      m.onBeforeCompile = (shader, r) => {
        if (prev) prev.call(m, shader, r);
        for (const u in charUniforms) shader.uniforms[u] = charUniforms[u];
        shader.uniforms.kContactPoint = contact.point;
        shader.uniforms.kContactFill = contact.fill;
        shader.uniforms.kContactWhite = contact.white;
        shader.uniforms.kRimK = k;
        shader.uniforms.kEdgeDark = ed;
        shader.uniforms.kMetalTint = mt;
        shader.uniforms.kMetalEnv = menv;
        shader.uniforms.kWeaponGlint = wg;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec4 vKWeaponPos;\nuniform vec4 kWeaponGlint;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            vKWeaponPos = vec4(0.0);
            if (kWeaponGlint.x > 0.0) vKWeaponPos = vec4(position, dot(normalize(modelViewMatrix[1].xyz), normalize(vec3(0.8, 0.5, 0.35))));`);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec4 vKWeaponPos;\nuniform vec4 kWeaponGlint;\nuniform vec4 kContactPoint;\nuniform vec4 kContactFill;\nuniform float kContactWhite;\nuniform vec3 kRimColor;\nuniform vec4 kRimParams;\nuniform vec4 kRimEdge;\nuniform vec2 kRimNear;\nuniform vec3 kRimDir;\nuniform float kRimK;\nuniform float kEdgeDark;\nuniform vec4 kMetalTint;\nuniform float kMetalEnv;\nuniform vec3 kKeyColor;\nuniform vec3 kKeyDir;\nuniform vec3 kKeyAmb;\nuniform float kKeyWrap;\nuniform vec4 kKeyTone;\nuniform vec2 kClamp;\nuniform vec4 kSceneGrade;')
          .replace('#include <opaque_fragment>', FRAG + '#include <opaque_fragment>');
      };
      m.customProgramCacheKey = () => orderFreeKey(m, prevKey, prev, '|kcaChar8');
      m.needsUpdate = true;
    }
  });
}

/** Push preset.character into the shared uniforms (called by Lighting.apply). */
export function setCharacterLook(c = {}, { bloomThreshold = 1.1 } = {}) {
  charUniforms.kRimColor.value.set(c.rim || '#ffc090');
  charUniforms.kRimParams.value.set(c.intensity ?? 0.7, c.power ?? 3, c.floor ?? 0.04, c.base ?? 0.35);
  charUniforms.kRimEdge.value.set(c.edge ?? 1.2, c.width ?? 2.5, c.maxNdv ?? 0.5, 0);
  charUniforms.kRimNear.value.set(c.edgeNear ?? 1.5, c.edgeFar ?? 4.0);
  const key = c.key || {};
  charUniforms.kKeyColor.value.set(key.color || '#ffffff').multiplyScalar(key.intensity ?? 0);
  charKeyWorldDir.fromArray(key.dir || [0.5, 0.6, 0.6]).normalize();
  charUniforms.kKeyWrap.value = key.wrap ?? 0.12;
  charUniforms.kKeyTone.value.set(key.albedoFloor ?? 0, key.albedoLiftMax ?? 1, key.specMax ?? 2, key.metalAmbient ?? 0.5);
  // default shoulder sits under the stage's bloom threshold, so ANY GLB's metal/skin holds a highlight without blooming
  const cmax = c.clamp?.max ?? bloomThreshold * 0.85;
  charUniforms.kClamp.value.set(Math.min(c.clamp?.knee ?? cmax * 0.62, cmax * 0.95), cmax);
  charUniforms.kKeyAmb.value.set(c.ambient || '#ffffff').multiplyScalar(c.ambientIntensity ?? 0);
}

/** Multiply the rim of every character material under root (1 = normal). */
export function boostRim(root, amount = 1) {
  if (!root) return;
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m && m.userData.kcaRimK) m.userData.kcaRimK.value = m.userData.kcaRimBase * amount;
  });
}

const ROLE = { hero: 1, boss: 1, enemy: 1, mount: 0.9 };
/** Called by Renderer each frame: patch any new actor model (cheap flag check per actor). */
export function lookForActors(world) {
  if (!world || !world.actors) return;
  for (const a of world.actors) {
    const s = ROLE[a.kind];
    if (s === undefined) continue;
    const root = a.modelRoot || null;
    if (root && !root.userData.kcaLook) applyCharacterLook(root, { strength: s });
  }
}

// C2 r7: short render-clock fills, independent of simulation hitstop.
const contactMaterials = new Set();
export function contactFill(root, point, { radius = 1.05, strength = 1.8, life = .09, heavy = false } = {}) {
  root?.traverse(o => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      const u = m?.userData.kcaContact;
      if (!u) continue;
      u.point.value.set(point.x, point.y, point.z, radius);
      u.fill.value.set(1.0, .34, .055, strength);
      u.white.value = heavy ? .24 : 0;
      u.age = 0; u.life = life; u.strength = strength; u.heavy = heavy;
      contactMaterials.add(u);
    }
  });
}
export function updateContactFills(dt, clear = false) {
  for (const u of contactMaterials) {
    u.age += dt;
    if (clear || u.age >= u.life) {
      u.point.value.w = 0; u.fill.value.w = 0; u.white.value = 0; contactMaterials.delete(u); continue;
    }
    u.fill.value.w = u.strength * (1 - u.age / u.life);
    u.white.value = u.heavy && u.age < .028 ? .24 * (1 - u.age / .028) : 0;
  }
}
