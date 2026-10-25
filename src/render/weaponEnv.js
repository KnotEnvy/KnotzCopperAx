// Hero-weapon reflection environment for the character-select set (owner: hero-weapons, Wave C2 r6).
//
// Board r5 (Opus): "all four select weapons are flat matte and catch no highlight from the braziers". Cause: the select set's
// sky is near-black (SELECT_LIGHTING.sky, env intensity 0.22), so a metal texel there reflects nothing — the hue-locked metal
// (characterLook.js kMetalTint) then floors the unlit result at the albedo and the blade reads as flat paint. The braziers
// sit BEHIND the heroes (z -1.7) and cannot mirror into a camera-facing flat anyway.
//
// Fix, scoped to the four hero weapon materials only (they are per-instance clones, AssetLoader.weapon → cloneMats): give
// each weapon material its own small reflection environment — a dark barrow with a cool slate band above, a warm brazier
// glow low on both sides, and two warm-white soft boxes high in front (where the chosen-hand spot sits) that a polished
// flat / bevel mirrors as a bright streak that moves with the stand pose. Nothing else in the set changes: no light, no
// camera, no hand / floor material. The PMREM is built at the set's env resolution so it shares the cube-UV program
// variant of the scene environment (no new shader program), one render at set build time, disposed with the set.
//
//   const off = applySelectWeaponEnv(game, heroes);   // after the heroes exist; returns a dispose function
import * as THREE from 'three';

const ENV_FRAG = /* glsl */`
  varying vec3 vDir;
  // soft-box lobe: gaussian-ish falloff on the angle to a direction
  float lobe(vec3 d, vec3 c, float k) { return pow(max(dot(d, c), 0.0), k); }
  void main() {
    vec3 d = normalize(vDir);
    vec3 col = vec3(0.012, 0.010, 0.014);                                        // barrow dark
    col += vec3(0.30, 0.38, 0.56) * smoothstep(0.15, 0.75, d.y) * 0.45;          // cool slate vault above
    col += vec3(0.26, 0.16, 0.08) * smoothstep(-0.05, -0.6, d.y) * 0.9;          // warm floor pools below
    col += vec3(1.0, 0.52, 0.18) * 1.4 * lobe(d, normalize(vec3( 0.85, -0.05, -0.50)), 7.0);   // brazier glow right-back
    col += vec3(1.0, 0.52, 0.18) * 1.4 * lobe(d, normalize(vec3(-0.85, -0.05, -0.50)), 7.0);   // brazier glow left-back
    col += vec3(1.0, 0.86, 0.68) * 2.8 * lobe(d, normalize(vec3( 0.20,  0.62,  0.76)), 22.0);  // soft box high front (chosen spot)
    col += vec3(1.0, 0.92, 0.80) * 3.6 * lobe(d, normalize(vec3(-0.34,  0.28,  0.90)), 70.0);  // tight hot streak front-left
    col += vec3(0.55, 0.70, 1.0) * 1.2 * lobe(d, normalize(vec3(-0.60,  0.45, -0.66)), 12.0);  // cool back lamp (rim)
    gl_FragColor = vec4(col, 1.0);
  }`;
const ENV_VERT = /* glsl */`
  varying vec3 vDir;
  void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/** Build the select weapon environment PMREM (caller disposes the returned render target). */
export function buildSelectWeaponEnv(renderer, lighting) {
  const pmrem = lighting && lighting.pmrem ? lighting.pmrem : new THREE.PMREMGenerator(renderer);
  const size = (lighting && lighting.quality && lighting.quality.envResolution) || 256;
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({ vertexShader: ENV_VERT, fragmentShader: ENV_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: false });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), mat);
  scene.add(dome);
  const rt = pmrem.fromScene(scene, 0, 0.1, 200, { size });
  dome.geometry.dispose(); mat.dispose();
  return rt;
}

/**
 * Give the hero weapons of `heroes` (select-set puppets) their own reflection environment. Only materials that opted into the
 * hue-locked metal (anim/retarget.js markEdgeDark: material.userData.kcaMetalTint) are touched. Returns a dispose function.
 */
export function applySelectWeaponEnv(game, heroes, { intensity = 1.0 } = {}) {
  const R = game && game.renderer;
  if (!R || !R.lighting || !R.lighting.pmrem) return () => {};
  if (typeof location !== 'undefined' && /[?&]wenv=0(&|$)/.test(location.search)) return () => {};   // A/B: off
  // A/B (r6 resume): `&wenv=<x>` scales the weapon env intensity (1 = shipped value; 0 = off above)
  const wq = typeof location !== 'undefined' && /[?&]wenv=([\d.]+)/.exec(location.search);
  if (wq && +wq[1] > 0) intensity *= +wq[1];
  const rt = buildSelectWeaponEnv(R.webgl || R.renderer, R.lighting);
  const mats = [];
  for (const h of heroes || []) {
    const model = h && h.model;
    if (!model) continue;
    for (const w of [model.weapon, model.weaponL]) {
      if (!w) continue;
      w.traverse((o) => {
        if (!o.isMesh) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (!m || !m.isMeshStandardMaterial || !m.userData.kcaMetalTint || mats.includes(m)) continue;
          // On the raised stand-pose blades, centre the finite key image on the
          // visible mid-blade. Dimensions/taper and angular response stay unchanged
          // (r15 select camera now includes the whole sword).
          const raisedSteel = !!w.getObjectByName('weapon_grudgebrand');
          if (raisedSteel || w.getObjectByName('weapon_dawn')) {
            const shape = [...m.userData.kcaWeaponShape];
            shape[3] = raisedSteel ? -0.18 : -0.08;
            // The nearly frontal steel flat needs a wider reflected-light image
            // across its width so its maximum falls on the polished bevel, not the fuller.
            if (raisedSteel) shape[0] = 0.12;   // C2 r9: 0.32 put the image 0.29 m off the 0.12 m half-width blade in the live pose
            m.userData.kcaWeaponShape = shape;
            if (m.userData.kcaWeaponShapeU) m.userData.kcaWeaponShapeU.value.fromArray(shape);
          }
          // The warm chosen-hand rig otherwise washes copper cheeks pale salmon.
          // Keep the recess/body energy below the independent polished reflection peak.
          if (w.getObjectByName('weapon_copperax')) m.color.setScalar(0.60);
          // C2 r9: the raised greatsword's whole flat read one mid grey (board r8: no visible bevel hotspot): darker body so the bevel streak carries.
          if (raisedSteel && w.getObjectByName('weapon_grudgebrand')) {
            const t = [0.85, 0.18, 0.5, 1.05];   // lower floor + stronger contrast: dark face, hot bevel (colour stays 1)
            m.userData.kcaMetalTint = t;
            if (m.userData.kcaMetalTintU) m.userData.kcaMetalTintU.value.fromArray(t);
          }
          // The raised READY pose and the r15 chosen-hand key otherwise put Dusk's
          // whole flat at its reflection ceiling. Keep its violet-steel body value
          // in the same family as play; the independent edge hotspot retains its peak.
          if (w.getObjectByName('weapon_dusk')) {
            // C2 r10 (board r9: select Dusk still pale lavender-grey / blue-white at the tip vs the richer violet in play): a more violet
            // body (green down, blue up; select reads brighter than play at the same colour, so luminance is set ~20% under the r8 value) and a violet-tinted glint (chroma share .32 -> .8), select only.
            // C2 r11 (board r10: select still ~20 % brighter / milkier than play, no dark side): darker body + the select's own
            // lower floor / stronger contrast, measured to the play median (violet pixels p50 .14 select vs .148 play).
            m.color.setRGB(0.075, 0.04, 0.13);
            const dt = [1.0, 0.10, 0.12, 1.0];
            m.userData.kcaMetalTint = dt;
            if (m.userData.kcaMetalTintU) m.userData.kcaMetalTintU.value.fromArray(dt);
            if (m.userData.kcaWeaponShape) {
              const sh = [...m.userData.kcaWeaponShape]; sh[2] = 0.8;
              m.userData.kcaWeaponShape = sh;
              if (m.userData.kcaWeaponShapeU) m.userData.kcaWeaponShapeU.value.fromArray(sh);
            }
          }
          if (raisedSteel && m.userData.kcaWeaponGlint) {
            const glint = [...m.userData.kcaWeaponGlint];
            // A grazing bevel needs higher source radiance in this frontal pose;
            // the shared hotspot shoulder still bounds its peak at 1.5.
            glint[0] = glint[0] > 0 ? 8.0 : 0;
            m.userData.kcaWeaponGlint = glint;
            if (m.userData.kcaWeaponGlintU) m.userData.kcaWeaponGlintU.value.fromArray(glint);
          }
          m.envMap = rt.texture;
          m.envMapIntensity = intensity;
          // C2 r7: keep dark recesses in this set too; the finite weapon soft-box supplies the localized peak.
          m.userData.kcaMetalEnv = 0.45;
          if (m.userData.kcaMetalEnvU) m.userData.kcaMetalEnvU.value = 0.45;
          m.needsUpdate = true;
          mats.push(m);
        }
      });
    }
  }
  return () => {
    for (const m of mats) { if (m.envMap === rt.texture) { m.envMap = null; m.needsUpdate = true; } }
    rt.dispose();
  };
}
