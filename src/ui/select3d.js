// Character-select set (DESIGN §7, §10): the three heroes stand in GIANT SKELETAL HANDS rising from a dark
// barrow floor, lit by iron torches and a moving "chosen" spotlight per player cursor. Built from render/assets
// APIs only (fire kit, procedural textures, lighting.apply); lives in renderer.envGroup so levels.dispose() and
// resetStage() clean it up. The UI screen drives it:
//   const set = await buildSelectSet(game, heroIds) → { heroes: [Hero], hover(player, idx|null), confirm(idx, player),
//     update(dt), dispose() }
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createFireKit } from '../render/fire.js';
import { FirePool, preloadFireLibrary } from '../vfx/fireLib.js';
import { noiseTexture, normalFromNoise } from '../assets/proceduralTextures.js';
import { createHero } from '../characters/spawnHero.js';
import { flagstoneMaps, rockMaps, masonryMaps } from './selectTex.js';
import { bossGrade } from '../enemies/bosses/_look.js';   // C2 r15: generic per-actor light grade (scene tint / key / ambient / rim) - used here for the three select heroes
import { applySelectWeaponEnv } from '../render/weaponEnv.js';   // C2 r6 (hero-weapons, additive): hero weapon reflections on this set

// C2 r12 (board r11 "monochrome terracotta band"): the set is lit COOL (slate moon from behind-left, a cool back lamp that edges every
// hero / hand against the wall) and only the braziers + chosen-hand lamps are warm, so bone, floor, wall and plinths separate by hue + value.
export const SELECT_LIGHTING = {
  sky: { top: '#050508', horizon: '#10121a', bottom: '#050406', zenith: '#030306', sunDir: [0, 0.2, -1], sunColor: '#ff9a50', sunGlow: 0, hazeHeight: 0.4, stars: 0 },
  sun: { color: '#bccaf0', intensity: 3.3, dir: [-0.5, 0.8, 0.25], frustum: [-10, 10, 8, -4] },
  background: '#050407',
  hemi: { sky: '#4c6592', ground: '#1c1a22', intensity: 0.32 },   // C2 r16 0.5 -> 0.32 + fill 0.22 -> 0.12: the flat fill lit every hero's shadow side (board r15: flat, no modelling)
  rim: { color: '#86bcff', intensity: 2.0, dir: [-0.62, 0.4, -0.78] },
  fill: { color: '#6a7aa8', intensity: 0.12, dir: [0, 0.3, 1] },
  fog: { color: '#07060a', near: 22, far: 62 },
  env: { intensity: 0.22 },
  exposure: 1.05,
  character: { rim: '#a8d4ff', intensity: 0.7, power: 3.2, floor: 0.02, base: 0.0, edge: 1.7, width: 2.4, maxNdv: 0.5, key: { color: '#ffdcba', intensity: 1.7, wrap: 0.0, dir: [-0.86, 0.44, 0.26] }, ambient: '#6a7aa8', ambientIntensity: 0.13 },
  bloom: { intensity: 0.8, threshold: 0.85 },
};
export const HAND_X = [-3.9, 0, 3.9];
const HAND_SCALE = 1.25;
const PALM_Y = 1.18 * HAND_SCALE;
const HERO_Z = 0.12;
const BONE_TINT = '#ebe6da';   // C2: warm-neutral ivory (the baked vertex colours carry brown stains, moss, cracks and soot)
const HAND_DROP = -0.045;

/** A tapered bone between a and b (cylinder + knuckle sphere caps), as a non-indexed geometry for merging. */
function bone(a, b, r0, r1 = r0 * 0.8) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const g = new THREE.CylinderGeometry(r1, r0, len, 10, 3);
  // Slight waist in the shaft (bone reads as bone, not a pipe).
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i) / len + 0.5; const k = 1 - 0.22 * Math.sin(y * Math.PI); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  g.applyQuaternion(q); g.translate(A.x, A.y, A.z);
  const k0 = new THREE.SphereGeometry(r0 * 1.28, 10, 8); k0.translate(A.x, A.y, A.z);
  const k1 = new THREE.SphereGeometry(r1 * 1.22, 10, 8); k1.translate(B.x, B.y, B.z);
  return [g, k0, k1].map((x) => x.toNonIndexed());
}

function handGeometry(mirror = 1, seed = 0) {
  const parts = [];
  const add = (a, b, r0, r1) => parts.push(...bone(a.map((v, i) => (i === 0 ? v * mirror : v)), b.map((v, i) => (i === 0 ? v * mirror : v)), r0, r1));
  const j = (i, k) => Math.sin(seed * 12.9 + i * 3.1 + k * 1.7) * 0.04;
  // Forearm (radius + ulna) rising out of the ground toward the camera, into the wrist.
  add([-0.34, -0.7, 1.9], [-0.2, 1.02, 0.72], 0.16, 0.12);
  add([0.36, -0.7, 1.75], [0.2, 1.0, 0.7], 0.14, 0.11);
  // Carpals: a knot of small bones at the wrist.
  for (let i = 0; i < 7; i++) { const s = new THREE.SphereGeometry(0.1 + (i % 3) * 0.015, 9, 7); s.scale(1.2, 0.8, 1); s.translate(-0.3 + (i % 4) * 0.2, 1.06 + (i > 3 ? 0.03 : 0), 0.52 - Math.floor(i / 4) * 0.16); parts.push(s.toNonIndexed()); }
  // Metacarpals (the palm the hero stands on) → four fingers that rise behind/beside the hero and CURL FORWARD
  // over it (a cupped claw cradle, fingertips pointing at the viewer).
  const fx = [-0.56, -0.19, 0.18, 0.54];
  fx.forEach((x, i) => {
    const s = [0.82, 1, 0.96, 0.78][i];               // middle finger longest, little finger shortest
    const side = Math.sign(x) * (0.06 + Math.abs(x) * 0.1);
    const k = [x * 1.08, 1.06, -0.5];
    add([x * 0.5, 1.06, 0.36], k, 0.12, 0.1);
    const p1 = [x * 1.14 + side * 0.4 + j(i, 1), 1.12 + 0.56 * s, -0.98 + j(i, 2)];
    const p2 = [x * 1.16 + side * 0.9 + j(i, 3), 1.62 + 0.72 * s, -0.86];
    const p3 = [x * 0.98 + side * 0.4, 1.98 + 0.6 * s, -0.36 + j(i, 4)];
    const p4 = [x * 0.8, 1.84 + 0.42 * s, 0.06];                     // tips converge: a cupping claw
    add(k, p1, 0.1, 0.09); add(p1, p2, 0.09, 0.078); add(p2, p3, 0.078, 0.064); add(p3, p4, 0.064, 0.046);
    // Claw tip, hooking down toward the camera.
    const d = new THREE.Vector3(p4[0] - p3[0], p4[1] - p3[1] - 0.12, p4[2] - p3[2]).normalize();
    const tip = new THREE.ConeGeometry(0.05, 0.26, 8); tip.translate(0, 0.13, 0);
    tip.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d));
    tip.translate(p4[0] * mirror, p4[1], p4[2]); parts.push(tip.toNonIndexed());
  });
  // Thumb, splayed out to the side, rising and curling in front of the hero.
  add([0.46, 1.04, 0.46], [0.98, 1.22, 0.3], 0.12, 0.1);
  add([0.98, 1.22, 0.3], [1.3, 1.66, 0.34], 0.1, 0.082);
  add([1.3, 1.66, 0.34], [1.24, 2.0, 0.58], 0.082, 0.056);
  const geo = mergeGeometries(parts, false);
  geo.scale(HAND_SCALE, HAND_SCALE, HAND_SCALE);
  geo.computeVertexNormals();
  return geo;
}

/** Sculpted hand GLB (blender/build_ui_skeletal_hand.py; right hand, hand units, COLOR_0 age tint) → geometry
 *  pair [left (mirrored, winding flipped), right], already scaled. null when the asset is missing/broken. */
async function loadHandGLB() {
  try {
    // C2 r11 (hands, Opus sculpt): `?handglb=<url>` evidence/iteration hook loads a WIP hand instead of the shipped one.
    const alt = typeof location !== 'undefined' && new URLSearchParams(location.search).get('handglb');
    const gltf = await new GLTFLoader().loadAsync(alt || `${import.meta.env.BASE_URL || '/'}assets/models/ui_skeletal_hand.glb`);
    let src = null;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => { if (!src && o.isMesh) src = o; });
    if (!src) return null;
    const right = src.geometry.clone().applyMatrix4(src.matrixWorld);
    deepenGrime(right);
    right.scale(HAND_SCALE, HAND_SCALE, HAND_SCALE);
    const left = right.clone().scale(-1, 1, 1);
    if (left.index) { const a = left.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } left.index.needsUpdate = true; }
    const pair = [left, right];
    pair.mat = src.material && src.material.map ? src.material : null;   // C2 r11: baked albedo/normal/ORM sculpt
    return pair;
  } catch (e) { return null; }
}

/** Aged-bone surface (r8): matte ivory bone. The baked vertex colour carries the real detail (crevice AO in the joint gaps, cavity /
 *  ridge curvature); the shader only adds a fine grain, rare pitting specks and a hint of desaturation — NO large-scale blotches and
 *  NO ridged-noise "crack" lines (they read as topographic contour decals on the r7 palm). */
function agedBone(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vOP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vOP;
float h3(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float n3(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z); }
float boneNz;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  boneNz = n3(vOP*37.0)*0.6 + n3(vOP*83.0)*0.4;
  diffuseColor.rgb *= mix(0.92, 1.04, boneNz);
  float pit = smoothstep(0.80, 0.92, n3(vOP*91.0 + 5.0));
  diffuseColor.rgb *= 1.0 - 0.14 * pit;
  float lumB = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)); diffuseColor.rgb = mix(vec3(lumB), diffuseColor.rgb, 0.82);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  normal = normalize(normal + 0.075 * vec3(n3(vOP*57.0+1.0) - 0.5, n3(vOP*57.0+7.0) - 0.5, n3(vOP*57.0+13.0) - 0.5) + 0.03 * vec3(n3(vOP*23.0+3.0) - 0.5, n3(vOP*23.0+9.0) - 0.5, n3(vOP*23.0+17.0) - 0.5));`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = clamp(roughnessFactor * (0.9 + 0.2 * boneNz), 0.4, 1.0);\n  roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.74, smoothstep(0.20, 0.38, dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11))));');
  };
  return mat;
}
/** C2 r12 (board "bone, floor and wall merge in one terracotta band"): grade the baked albedo toward desaturated grey-green ivory and deepen the
 *  crevices (a power curve on the baked value + the baked occlusion map pushed harder) so bone separates from the warm-lit floor by hue AND value. */
function boneGrade(mat, hand = {}) {
  if (mat.aoMap) mat.aoMapIntensity = 1.9;
  // C2 r14: per-hand uniforms (one shared program): value (albedo gain), warmth (brazier-bounce / ivory push), soot (moss + soot mixed in over the AO cavities)
  const U = { uVal: { value: hand.val ?? 1 }, uWarm: { value: hand.warm ?? 1 }, uSoot: { value: hand.soot ?? 0 } };
  mat.userData.kcaBoneU = U;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
  uniform float uVal; uniform float uWarm; uniform float uSoot;`);
    // r14: keep ~0.58 of the bake's chroma (it carries warm aged ivory + per-bone tints; r12-r13 kept 5 % and tinted it green, so every hand read grey)
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
  { float lbG = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
    vec3 gG = mix(vec3(lbG), diffuseColor.rgb, 0.58) * vec3(1.0, 1.0, 0.97);
    gG = pow(max(gG, vec3(0.0)), vec3(1.25)) * 1.72 * uVal;
  #ifdef USE_AOMAP
    float cavS = clamp(1.0 - texture2D(aoMap, vAoMapUv).r, 0.0, 1.0);
    gG = mix(gG, vec3(0.030, 0.034, 0.020) * (0.6 + lbG), clamp(cavS * 1.6 * uSoot, 0.0, 0.85));   // moss / soot settled in the cavities
  #endif
    diffuseColor.rgb = gG; }`);
    // the warm braziers and the cool moon both land on the bone: grade the LIT result toward (warm) neutral so the hands never read as coloured clay
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `{ float lbO = dot(outgoingLight, vec3(0.3, 0.59, 0.11)); outgoingLight = mix(vec3(lbO), outgoingLight, 0.62) * mix(vec3(1.0), vec3(1.05, 1.0, 0.88), uWarm);
    // r14: a little warm brazier BOUNCE (floor-lit undersides + outer faces catch ember colour) so the bone is ivory, not grey
    vec3 nWb = inverseTransformDirection(normal, viewMatrix);
    float bnc = smoothstep(0.35, -0.55, nWb.y) * 0.85 + 0.15;
    outgoingLight += vec3(0.060, 0.028, 0.010) * bnc * uWarm * (0.35 + 0.65 * lbO / (lbO + 0.25)); }
  #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'kcaBoneGrade14b';
  mat.needsUpdate = true;
  return mat;
}
/** C2 r1b: the bake now carries the final aged-bone value structure (ivory-brown, cavity-darkened, stained, sooty), so this no longer
 *  re-normalises the luminance to white (that was what made the bones read as pale ceramic): the colours are used as baked. */
function deepenGrime(geo) {
  const c = geo.attributes.color; if (!c) return;
  const n = c.count, out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { out[i * 3] = c.getX(i); out[i * 3 + 1] = c.getY(i); out[i * 3 + 2] = c.getZ(i); }
  geo.setAttribute('color', new THREE.BufferAttribute(out, 3));
}

/** Soft contact shadow (r8): a dark radial blob (alpha gradient) laid on the palm under each hero so the feet sit IN the hand. */
function contactShadowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(0,0,0,0.9)'); gr.addColorStop(0.45, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function puppet(a) {
  a.brain = null;
  if (a.input) a.input = { consume: () => false, buffered: () => false, isDown: () => false, pressed: () => false, moveX: () => 0, moveZ: () => 0, runDir: 0, virtual: a.input.virtual };
  a.fsm.define({ puppet: { update(x, dt) { x.friction(20, dt); } } });
  a.fsm.go('puppet');
  a.boundsMode = 'none';
  return a;
}


/** Curved cave-vault behind the hands: a displaced cylinder arc (rock relief), with an arched alcove dug behind each hand and
 *  a pilaster between them, plus iron-bound sconce brackets at both ends. Faces inward (BackSide material). */
function buildVault(mat) {
  const R0 = 14.5, CZ = 2.5, H = 15, TH = 2.3, seg = 120, vs = 40;
  const g = new THREE.CylinderGeometry(R0, R0, H, seg, vs, true, Math.PI - TH / 2, TH);
  const p = g.attributes.position, nrm = new THREE.Vector3();
  const nz = (x, y, z) => { const f = (a, b, c) => Math.sin(a * 1.7 + Math.sin(b * 1.3 + c * 0.7) * 2) * Math.cos(b * 1.1 + Math.sin(c * 1.9 + a * 0.5)); return 0.5 * f(x * 0.4, y * 0.5, z * 0.4) + 0.3 * f(x * 1.1, y * 1.3, z * 1.1) + 0.2 * f(x * 2.7, y * 3.1, z * 2.7); };
  const alcove = (x, y, cx) => { const w = 1.45, top = 6.4, dx = (x - cx) / w; if (Math.abs(dx) >= 1.25) return 0; const arch = top + Math.sqrt(Math.max(0, 1 - Math.min(1, dx * dx))) * 1.7 - 1.7; const edge = Math.min(1, Math.max(0, (1.25 - Math.abs(dx)) * 4)); const up = Math.min(1, Math.max(0, (arch - y) * 3)); return edge * up; };
  const pil = (x, cx) => { const d = Math.abs(x - cx); return d < 0.55 ? Math.sin((1 - d / 0.55) * Math.PI / 2) : 0; };
  for (let i = 0; i < p.count; i++) {
    const x0 = p.getX(i), y0 = p.getY(i) + H / 2, z0 = p.getZ(i);
    const ang = Math.atan2(x0, z0), px = Math.sin(ang) * R0;
    let r = R0 + nz(x0, y0, z0) * 0.9;
    for (const cx of [-3.9, 0, 3.9]) r += alcove(px, y0, cx) * 1.9;               // alcoves dug back
    for (const cx of [-5.9, -1.95, 1.95, 5.9, -9.2, 9.2]) r -= pil(px, cx) * 0.5 * Math.min(1, y0 / 2); // pilasters stand out
    r += Math.max(0, y0 - 9) * 0.04 * (y0 - 9);                                     // vault curves back at the top
    p.setX(i, Math.sin(ang) * r); p.setZ(i, Math.cos(ang) * r + CZ); p.setY(i, y0);
  }
  // C2 r12: macro mottling in vertex colour (value + hue drift, darker toward the vault top and the far ends) so the 6.7 m texture tile stops reading as a repeating stamp.
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i) - 2.5;
    const m1 = Math.sin(x * 0.37 + Math.sin(y * 0.21 + 1.3) * 1.7) * Math.cos(y * 0.33 - x * 0.11 + 0.6), m2 = Math.sin(x * 0.93 + 2.1) * Math.sin(y * 0.71 + x * 0.19);
    const v = 1.7 * (0.8 + 0.2 * m1 + 0.07 * m2) * (1 - 0.5 * Math.min(1, Math.max(0, (y - 5.5) / 9))) * (1 - 0.35 * Math.min(1, Math.abs(x) / 14));
    const hue = 0.5 + 0.5 * Math.sin(x * 0.22 + y * 0.15 + z * 0.1);
    // C2 r15: a darker value pocket behind each hero (centre deepest: Seraphine's teal / slate armour sat on the same mid-blue as the wall) so the figures part from it
    let pocket = 1;
    for (const [cx, amt] of [[-3.9, 0.34], [0, 0.46], [3.9, 0.42]]) pocket -= amt * Math.exp(-(((x - cx) / 2.0) ** 2)) * Math.exp(-(((y - 3.3) / 3.4) ** 2));   // r16: deeper + wider (board r15: Brann / Gorrim merged with the wall)
    col[i * 3] = v * pocket * (0.9 + 0.12 * hue); col[i * 3 + 1] = v * pocket * (0.97 + 0.04 * hue); col[i * 3 + 2] = v * pocket * (1.04 - 0.1 * hue);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true;
  return m;
}

// C2 r15 (board r14 'Brann's flank = a flat orange wash; Seraphine separates poorly from the blue wall and her legs read glossy; in the greyscale the centre hero
// competes with the flames'): a per-hero light grade for this set only (enemies/bosses/_look.js bossGrade: scene-light tint, actor key colour / strength, ambient;
// the heroes' materials are per-instance clones, so nothing leaks into play). Brann's key goes from flat orange toward a pale warm and his shadow side takes a
// cool ambient (form instead of one orange plane); Seraphine's key is lifted and her scene light is pushed warm / slightly desaturated so she parts from the
// blue-slate wall by hue AND value; Gorrim is lifted a touch. Seraphine's non-metal texels also get a roughness floor (cloth, not patent leather).
const SELECT_GRADE = {
  // C2 r16 (board r15 'Brann and Gorrim barely separate from the wall in greyscale; Seraphine flat, no cheek / jaw shadow'): every hero's rim is
  // pushed (rimMul) so each reads as a bright edge against the darkened wall pocket; Seraphine's scene-lit share (hemi / fill / spot: flat light)
  // drops and her directional key carries her, so she gets a lit side and a real shadow side.
  brann: { key: '#ffe2c8', keyMul: 0.95, amb: ['#7f93c8', 0.09], scene: [0.95, 0.98, 1.03], rimMul: 1.7 },
  seraphine: { key: '#ffe8d2', keyMul: 1.15, amb: ['#b4bdd6', 0.13], scene: [0.86, 0.83, 0.78], desat: 0.07, rough: 0.62, rimMul: 0.8 },
  gorrim: { key: '#ffe6cc', keyMul: 1.18, amb: ['#7f93c8', 0.09], rimMul: 1.8 },
};
function gradeSelectHero(h, id) {
  const g = SELECT_GRADE[id];
  const root = h && h.modelRoot;
  if (!g || !root) return;
  bossGrade(root, { scene: g.scene || [1, 1, 1], desat: g.desat || 0, key: g.key, keyMul: g.keyMul, amb: g.amb, rimMul: g.rimMul || 1 });
  if (!g.rough) return;
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m || !m.isMeshStandardMaterial || m.userData.kcaSelRough) continue;
      m.userData.kcaSelRough = true;
      const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
      m.onBeforeCompile = (sh, r) => {
        if (prev) prev.call(m, sh, r);
        // metalnessmap_fragment follows roughnessmap_fragment in the physical shader, so the floor goes after it (metalnessFactor is declared there)
        sh.fragmentShader = sh.fragmentShader.replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
  roughnessFactor = mix(max(roughnessFactor, ${g.rough.toFixed(2)}), roughnessFactor, smoothstep(0.25, 0.7, metalnessFactor));`);
      };
      m.customProgramCacheKey = () => (prevKey ? prevKey.call(m) : '') + '|kcaSelRough15';
      m.needsUpdate = true;
    }
  });
}

// C2 r2 (hero-weapons, additive): the stand pose is the hero's `select_stand` clip when its clip set defines one
// (weapon presented flat to this set's near-frontal camera), else the plain idle. Clips live in src/anim/clips/hero_*.js.
const standClip = (h) => (h.animator && h.animator.has && h.animator.has('select_stand') ? 'select_stand' : 'idle');

export async function buildSelectSet(game, heroIds) {
  const R = game.renderer;
  R.lighting.apply(SELECT_LIGHTING);
  const group = new THREE.Group(); group.name = 'selectSet';
  const q = game.quality;
  // Bone material: aged ivory with grime in the crevices (noise map + normal).
  const boneMap = noiseTexture({ size: 256, scale: 10, octaves: 5, seed: 31, colorA: '#8a7a60', colorB: '#efe2c4' });
  const boneN = normalFromNoise({ size: 256, scale: 14, octaves: 4, seed: 9, strength: 2.5 });
  const boneMat = agedBone(new THREE.MeshStandardMaterial({ color: '#cdbd98', map: boneMap, normalMap: boneN, roughness: 0.78, metalness: 0.0 }));
  const glb = await loadHandGLB();
  // C2 r11: a textured sculpt (build_ui_hand_sculpt.py) is used as baked — no tint, grain or desaturation on top (the bake carries
  // the aged-bone value structure); the vertex-colour hands keep the r9 aged-bone recipe.
  // C2 r14 (board r13 "all three hands identical grey"): one material per hand - Brann's older / darker and warmer, the centre hand the base look,
  // Gorrim's mossier with soot in the cavities
  const HAND_LOOK = [{ val: 0.86, warm: 1.25, soot: 0.12 }, { val: 1.0, warm: 1.0, soot: 0.0 }, { val: 0.93, warm: 0.8, soot: 0.38 }];
  const sculptMats = glb && glb.mat ? HAND_X.map((_, i) => boneGrade(i === 0 ? Object.assign(glb.mat, { envMapIntensity: 0.3, vertexColors: false }) : Object.assign(glb.mat.clone(), { envMapIntensity: 0.3, vertexColors: false }), HAND_LOOK[i])) : null;
  const sculptMat = glb && (glb.mat ? sculptMats[1]
    : agedBone(new THREE.MeshStandardMaterial({ color: BONE_TINT, vertexColors: true, roughness: 0.88, metalness: 0.0, envMapIntensity: 0.35 })));
  const heapRock = rockMaps(512, 4);
  for (const t of [heapRock.map, heapRock.normalMap]) t.repeat.set(2.2, 1.4);
  const heapMat = new THREE.MeshStandardMaterial({ color: '#6c675f', map: heapRock.map, normalMap: heapRock.normalMap, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.95 });
  HAND_X.forEach((x, i) => {
    const m = glb ? new THREE.Mesh(glb[i === 0 ? 0 : 1], sculptMats ? sculptMats[i] : sculptMat) : new THREE.Mesh(handGeometry(i === 0 ? -1 : 1, i), boneMat);
    // Turned 3/4 so palm, curled fingers and thumb overlap like a real hand (a flat front view reads as a candelabrum).
    m.position.set(x, 0, 0); m.rotation.y = [0.55, 0.38, -0.55][i] ?? 0;
    m.castShadow = true; m.receiveShadow = true;
    if (glb) m.position.y = HAND_DROP;                // sit the palm bones' top surface on the heroes' PALM_Y
    // The arm rises out of a heap of barrow earth + bone dust (hides where the forearm bones sink into the floor). r9: a smooth,
    // finely displaced mound with the same layered-rock texture as the vault (it used to be a flat-shaded faceted boulder).
    const heap = new THREE.SphereGeometry(1, 56, 36), hp = heap.attributes.position;
    for (let k = 0; k < hp.count; k++) {
      const a = hp.getX(k), b = hp.getY(k), c = hp.getZ(k);
      const n = 1 + 0.14 * Math.sin(a * 3.1 + b * 2.3 + i) * Math.cos(c * 2.7 - a * 1.9) + 0.06 * Math.sin(a * 6.3 + c * 5.1 + i * 2) + 0.025 * Math.sin(a * 13 + b * 11 + c * 9);
      hp.setXYZ(k, a * n, Math.max(b, -0.2) * n, c * n);
    }
    heap.computeVertexNormals();
    const hm = new THREE.Mesh(heap, heapMat);
    hm.scale.set(1.25, 0.74, 1.2); hm.position.set(0.04, -0.12, 2.15); hm.receiveShadow = true; m.add(hm);
    group.add(m);
  });
  // Barrow floor: real flagstones (mortar, chips, cracks, domed normals) lit in warm pools; bones and rubble scattered on it.
  const flag = flagstoneMaps(1024, 5);
  for (const t of [flag.map, flag.normalMap]) t.repeat.set(11, 11);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshStandardMaterial({ color: '#8d96a4', map: flag.map, normalMap: flag.normalMap, normalScale: new THREE.Vector2(1.1, 1.1), roughness: 0.88 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; group.add(floor);
  // C2 r12: no loose pebbles / gravel on the floor at all (board: "pebble spheres on floor"); the flagstones + the dark contact pools carry it.
  // Back wall (r7): a curved ossuary vault — layered rock with a vaulted alcove behind each hand and pilasters between them,
  // washed by the braziers (the r6 wall was a row of flat black slabs beyond the torch light).
  const rock = masonryMaps(1024, 9);
  for (const t of [rock.map, rock.normalMap]) t.repeat.set(5, 2);
  const wallMat = new THREE.MeshStandardMaterial({ color: '#7a8795', map: rock.map, normalMap: rock.normalMap, normalScale: new THREE.Vector2(1.4, 1.4), roughness: 0.93, side: THREE.BackSide, vertexColors: true });
  // Second, rotated + rescaled sample of the normal map blended in: the wall's relief no longer repeats on a visible grid.
  wallMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', `vec2 nuvB = mat2(0.80, -0.60, 0.60, 0.80) * vNormalMapUv * 0.41 + vec2(0.31, 0.17);
    vec3 mapN = mix(texture2D( normalMap, vNormalMapUv ).xyz, texture2D( normalMap, nuvB ).xyz, 0.5) * 2.0 - 1.0; mapN.xy *= 1.3;`);
  };
  wallMat.customProgramCacheKey = () => 'kcaVaultBomb12';
  group.add(buildVault(wallMat));
  // Braziers: carved stone pedestal, riveted iron bowl on a banded stem, a bed of coals — between the hands.
  const fx = createFireKit({ quality: q });
  // C2 r11: brazier / sconce flames are layered authored flipbook cards (front / mid / back planes at different depths, a hot additive core
  // and slow dark smoke) from the shared fire library instead of the flat kit cards; the old sootPuffs read as orange cotton balls.
  await preloadFireLibrary();
  const firePool = new FirePool({ capacity: 56, name: 'select_authored_fire' }); group.add(firePool.mesh);
  const smokers = [];
  const brazierFire = (x, y, z, k, ph) => {
    const FL = 0.60;   // C2 r16 0.74 -> 0.60 + cooler cores (board r15: the flames clip to white and out-value the heroes in greyscale). C2 r15 (board r14 'in the greyscale the centre hero and hand compete with the brazier flames'): flame cards ~26 % dimmer, so the heroes are the brightest read
    const L = [[-0.07, 0.95, 1.0, 0.0, 0.00, 0.78 * FL], [0.0, 1.0, 0.92, 0.33, 0.31, 1.0 * FL], [0.08, 0.8, 0.8, 0.66, 0.62, 0.9 * FL]];
    for (const [dz, w, h, phase, , a] of L) firePool.emit({ clip: 'flame', pos: [x + dz * 0.6 * k, y + 0.5 * h * k, z + dz * k], size: [0.9 * w * k, 1.15 * h * k], life: 0.95, loop: true, phase: (phase + ph) % 1, core: 0.14, radiance: 0.64, tint: '#ffa860', soft: 0.1, floor: y - 0.02, alpha: a });
    firePool.emit({ clip: 'flame', pos: [x, y + 0.34 * k, z + 0.02 * k], size: [0.46 * k, 0.72 * k], life: 0.7, loop: true, phase: (ph * 1.7) % 1, core: 0.2, radiance: 0.6, additive: true, alpha: 0.2 });   // r16: radiance ceilings keep the white roots below the heroes' highlights
    firePool.emit({ clip: 'embers', pos: [x, y + 0.8 * k, z], size: [0.8 * k, 1.4 * k], life: 1.6, loop: true, phase: ph, alpha: 0.8, additive: true });
    smokers.push({ x, y: y + 1.0 * k, z, k, t: ph * 3.2 });
  };
  const ironMat = new THREE.MeshStandardMaterial({ color: '#2f2a26', roughness: 0.5, metalness: 0.85 });
  const pedMat = new THREE.MeshStandardMaterial({ color: '#7c8088', map: flag.map, normalMap: flag.normalMap, roughness: 0.9 });
  const coalMat = new THREE.MeshStandardMaterial({ color: '#2a0e04', emissive: '#ff4a10', emissiveIntensity: 1.25, roughness: 1 });   // r16 2.4 -> 1.25: the coals clipped to peach and were the brightest value in each bay
  const poolGlowTex = glowTexture();   // the braziers' warm pool on the flagstones is painted (additive); the real light is kept low so the bone stays neutral
  const torchX = [-5.9, -1.95, 1.95, 5.9];
  const torches = [];
  const ped = [], iron = [], coals = [];
  const BS = 0.8; // brazier scale: low enough to sit below the heroes' hips, never in front of their feet
  const at = (g, x, z, y = 0) => { g.scale(BS, BS, BS); g.translate(x, y * BS, z); return g.index ? g.toNonIndexed() : g; };
  for (const x of torchX) {
    const z = -1.7;
    ped.push(at(new THREE.LatheGeometry([[0.001, 0], [0.5, 0], [0.5, 0.12], [0.4, 0.2], [0.3, 0.32], [0.26, 0.74], [0.34, 0.86], [0.42, 0.96], [0.001, 0.96]].map((p) => new THREE.Vector2(p[0], p[1])), 10), x, z));
    iron.push(at(new THREE.LatheGeometry([[0.001, 0.98], [0.2, 1.0], [0.46, 1.22], [0.58, 1.5], [0.52, 1.52], [0.42, 1.32], [0.18, 1.12], [0.001, 1.1]].map((p) => new THREE.Vector2(p[0], p[1])), 12), x, z));
    for (const [y, rr] of [[1.14, 0.34], [1.34, 0.5]]) { const band = new THREE.TorusGeometry(rr, 0.035, 6, 14); band.rotateX(Math.PI / 2); iron.push(at(band, x, z, y)); }
    const rim = new THREE.TorusGeometry(0.56, 0.05, 6, 16); rim.rotateX(Math.PI / 2); iron.push(at(rim, x, z, 1.51));
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.4, rv = new THREE.SphereGeometry(0.045, 5, 4); rv.translate(Math.cos(a) * 0.46, 0, Math.sin(a) * 0.46); iron.push(at(rv, x, z, 1.36)); }
    for (let k = 0; k < 7; k++) { const cg = new THREE.DodecahedronGeometry(0.1 + 0.04 * ((k * 3) % 3), 0); cg.translate(Math.cos(k * 1.9) * 0.22, 0, Math.sin(k * 1.9) * 0.22); coals.push(at(cg, x, z, 1.48 + 0.05 * (k % 2))); }
    brazierFire(x, 1.5 * BS, z, 1.0, (x + 6) * 0.137);
    { const gm = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 4.4), new THREE.MeshBasicMaterial({ map: poolGlowTex, color: '#ff8a3c', transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      gm.rotation.x = -Math.PI / 2; gm.position.set(x, 0.02, z + 0.9); gm.renderOrder = 3; group.add(gm); }
    fx.glow([x, 1.85 * BS, z], { size: 2.6, color: '#ff7a2a', intensity: 0.42 });
    fx.sparks([x, 1.7 * BS, z], { count: 10, radius: 0.3, rise: 2.4 });
    // C2 r14 (board r13 "Brann's flank still washes warm from the brazier, flattening his shadow side"): the two INNER braziers sit between the heroes
    // and rim the neighbours' inner flanks; their real lights are cut hard (the warm pool is the painted floor decal above) and pulled behind the hero line
    const inner = Math.abs(x) < 3;
    // C2 r15 (board r14 'Brann's right flank / hip still a flat orange brazier wash'): the OUTER braziers stood 2 m beside Brann / Gorrim at the hero's own depth,
    // so their point light flooded the near flank flat. Pulled back behind the hero line (z -1.7 -> -3.4) and lowered in power, the light grazes the far edge
    // (a rim) and leaves the flank to the cool fill + key.
    // C2 r16: the two INNER point lights (0.5) are gone - they only filled Brann's and Seraphine's shadow sides (board r15: 'flat, no shadow-side
    // modelling') and cost a light-loop iteration on every lit pixel (perf: the r16 hands' true cost is 1.58 ms, select must win time back);
    // `&selinner=1` restores them for an A/B. The inner braziers keep their painted floor pool + glow sprite.
    if (inner && !/[?&]selinner=1/.test(typeof location !== 'undefined' ? location.search : '')) continue;
    const base = inner ? 0.5 : 1.35;
    const L = new THREE.PointLight(inner ? '#ff9a58' : '#ffb070', base, inner ? 7 : 9, 1.7); L.position.set(x + (inner ? 0 : Math.sign(x) * 0.6), 2.2, z + (inner ? -0.9 : -1.7)); group.add(L);
    torches.push({ L, base, phase: x });
  }
  const pm = new THREE.Mesh(mergeGeometries(ped), pedMat); pm.castShadow = true; pm.receiveShadow = true; group.add(pm);
  const im = new THREE.Mesh(mergeGeometries(iron), ironMat); im.castShadow = true; group.add(im);
  group.add(new THREE.Mesh(mergeGeometries(coals), coalMat));
  fx.sparks([0, 0.2, 0], { count: 36, radius: 12, rise: 3.5, life: 4 });
  // wall sconces on the two outer pilasters (glow only — the brazier lights wash the vault)
  for (const x of [-9.2, 9.2]) { brazierFire(x, 3.15, -10.6, 0.8, x * 0.11); fx.glow([x, 3.5, -10.6], { size: 2.6, color: '#ff7a2a', intensity: 0.8 }); }
  const fxObj = fx.build(); if (fxObj) group.add(fxObj);
  // C2 r16: the warm centre wash lamp (6, behind the centre hand) also back-lit Brann's and Seraphine's SHADOW-side edges (board r15: flat heroes)
  // and cost a light-loop slot on every lit pixel; the vault's centre glow is now carried by the wall's vertex colour. `&selwash=1` = old.
  if (/[?&]selwash=1/.test(typeof location !== 'undefined' ? location.search : '')) { const wash = new THREE.PointLight('#d29468', 6, 15, 1.2); wash.position.set(0, 4.6, -6.5); group.add(wash); }
  // Chosen spotlights (P1 warm amber, P2 cool blue) that glide between hands.
  const spots = [['#ffb060', 0], ['#7ab8ff', 1]].map(([c]) => {
    const S = new THREE.SpotLight(c, 0, 16, 0.42, 0.9, 1.2);
    S.position.set(0, 8.5, 3.5); S.target.position.set(0, PALM_Y, 0); group.add(S, S.target);
    return { S, x: 0, tx: 0, on: 0, ton: 0 };
  });
  // Selection = firelight, not a whitened material (r6): a warm (P1) / cool (P2) rim lamp behind each hand's fingers that fades up
  // when a cursor is on it; the chosen-hand spot is a soft low wash (it used to frost the whole hand pale).
  const rims = HAND_X.map((x) => {
    // C2 r13: high + back, so it lights the hand's fingers and the hero's crown, not the neighbour hero's flank. C2 r14: a SPOT aimed at its own hero (cone
    // 0.5 rad, soft penumbra) - the centre hand's point lamp still rimmed Brann's right (shadow) edge from behind-right; the spot cannot reach him.
    const L = new THREE.SpotLight('#ff8a3a', 0, 8.5, 0.5, 0.75, 1.4); L.position.set(x * 1.04 - 1.7, 4.3, -3.2); L.target.position.set(x, PALM_Y + 1.3, HERO_Z); group.add(L, L.target);
    return { L, a: 0, b: 0 };
  });
  // Contact shadows under the heroes' feet: a wide soft one + a tight dark core per hero.
  const shTex = contactShadowTexture();
  const shMat = new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  HAND_X.forEach((x) => {
    for (const [w, d, a] of [[1.9, 1.2, 0.9], [1.05, 0.62, 1]]) {
      const mt = shMat.clone(); mt.opacity = a;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mt);
      m.rotation.x = -Math.PI / 2; m.position.set(x, PALM_Y + 0.02, HERO_Z); m.renderOrder = 4;
      group.add(m);
    }
  });
  // C2 r12: dark occlusion pools where each palm / forearm / barrow heap meets the floor (the bone no longer floats on terracotta tiles).
  HAND_X.forEach((x, i) => {
    const rot = [0.55, 0.38, -0.55][i] ?? 0;
    for (const [w, d, a, px, pz] of [[5.0, 4.0, 1, 0.1, 2.1], [3.6, 5.2, 0.85, 0.1, 1.1], [6.0, 3.6, 0.7, 0, 0.2]]) {
      const mt = shMat.clone(); mt.opacity = a;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mt);
      m.rotation.set(-Math.PI / 2, 0, rot); m.position.set(x + px * Math.cos(rot) + pz * Math.sin(rot), 0.012, pz * Math.cos(rot) - px * Math.sin(rot)); m.renderOrder = 2;
      group.add(m);
    }
  });
  R.envGroup.add(group);
  // perf-1650 C2: the engine's always-present lights (3 vfx pop lights + the spell light) are dark on this screen but still
  // count: these 8 set lights + 4 = 12 point lights > ProgramGuard's 8-light budget ("[perf] light budget exceeded: 12 point
  // / 3 dir" in every C2 playthrough) and 4 more light-loop iterations per lit pixel. Park them while the set is up;
  // restored by dispose() and whenever the set leaves the scene (envGroup teardown), so a stage never inherits them hidden.
  const parked = [];
  for (const l of [...((game.vfx && game.vfx.lights) || []).map((x) => x && x.light), game.magic && game.magic.light]) {
    if (l && l.isLight && l.visible && !(l.intensity > 0)) { l.visible = false; parked.push(l); }
  }
  const unpark = () => { for (const l of parked) l.visible = true; parked.length = 0; };
  group.addEventListener('removed', () => { unpark(); firePool.dispose(); });

  // Heroes, puppeted on the palms, turned 3/4 toward the camera.
  game.world.groundAt = (x, z) => (HAND_X.some((hx) => Math.abs(x - hx) < 1.2) && Math.abs(z) < 1.2 ? PALM_Y : 0);
  const heroes = [];
  for (let i = 0; i < heroIds.length; i++) {
    const hx = HAND_X[i] ?? i * 3;
    try {
      const h = await createHero(game, heroIds[i], { x: hx, z: HERO_Z, facing: hx > 0.1 ? -1 : 1, playerIndex: 0 });
      // A fast confirm can leave 'select' while these load: never add display puppets into the next stage's world.
      if (game.flow && game.flow.state !== 'select' && game.flow.state !== 'boot') { heroes.push(null); continue; }
      game.world.add(h); puppet(h);
      h.cheatYaw = hx === 0 ? 1.2 : 1.0;
      h.visualYaw = h.targetYaw();
      // C2 r3 (hero-weapons, additive): no crossfade from the spawn idle — a single-frame capture of this screen (the
      // board's) otherwise shows the last-created hero mid-fade, i.e. in his gameplay guard instead of the stand pose
      if (h.play) h.play(standClip(h), { fade: 0, restart: true });
      gradeSelectHero(h, heroIds[i]);
      heroes.push(h);
    } catch (e) { heroes.push(null); }
  }
  // C2 r6 (hero-weapons, additive; board r5 "select weapons flat, no highlight"): the four hero WEAPON materials only get a
  // small reflection environment of this set (render/weaponEnv.js) — the near-black sky gave the metals nothing to mirror.
  // No light / camera / hand / floor change; `&wenv=0` = off (A/B); released in dispose().
  const weaponEnvOff = applySelectWeaponEnv(game, heroes);
  // Camera: fixed, low and slightly heroic.
  const cam = game.cameraRig;
  cam.manual = true;
  const focus = new THREE.Vector3(0, 2.1, 0);
  cam.manualFocus = focus;
  const camera = cam.camera;
  let t = 0, punch = 0;
  const hov = [null, null];
  const place = () => {
    const dbg = typeof window !== 'undefined' && window.__KCA_SELECT_CAM; // evidence hook: {pos:[x,y,z], look:[x,y,z], fov}
    if (dbg) { camera.position.set(...dbg.pos); camera.lookAt(...dbg.look); if (dbg.fov && camera.fov !== dbg.fov) { camera.fov = dbg.fov; camera.updateProjectionMatrix(); } return; }
    const sway = Math.sin(t * 0.35) * 0.25;
    camera.position.set(sway, 3.4 + Math.sin(t * 0.5) * 0.05, 10.4 - punch * 0.6);
    // C2 r15 (hero-weapons' framing note: 'Grudgebrand's tip is clipped above the canvas'): the raised greatsword reached ~70 px above the top edge at fov 32 / look-y 1.5.
    // fov 35 + look-y 1.82 brings the tip ~28 px inside (heroes sit ~40 px lower, feet still clear of the cards' plaques) with no pose / weapon change.
    camera.lookAt(sway * 0.4, 1.82, 0);
    if (camera.fov !== 35) { camera.fov = 35; camera.updateProjectionMatrix(); }
  };
  place();
  return {
    heroes, group,
    hover(player, idx) {
      hov[player] = idx;
      const s = spots[player]; if (!s) return;
      s.ton = idx == null ? 0 : 1; if (idx != null) s.tx = HAND_X[idx];
      rims.forEach((r, k) => { if (player === 0) r.ta = idx === k ? 1 : 0; else r.tb = idx === k ? 1 : 0; });
    },
    confirm(idx, player) {
      const h = heroes[idx];
      if (h && h.play) { h.play(h.animator?.has?.('select_ready') ? 'select_ready' : 'victory', { restart: true }); }
      punch = 1;
      const s = spots[player]; if (s) s.S.intensity *= 1.25;
      if (game.cameraRig.shake) game.cameraRig.shake(0.25);
    },
    idle(idx) { const h = heroes[idx]; if (h && h.play) h.play(standClip(h)); },
    taunt(idx) { const h = heroes[idx]; if (h && h.play) h.play('taunt', { restart: true }); },
    update(dt) {
      t += dt; punch = Math.max(0, punch - dt * 2.5);
      for (const sm of smokers) {      // thin, dark, slow smoke curling up off the coals (never a lit orange puff)
        sm.t -= dt;
        if (sm.t <= 0) { sm.t = 2.4 + ((sm.x * 7.1) % 1 + 1) % 1 * 1.2; firePool.emit({ clip: 'smoke', pos: [sm.x + 0.05, sm.y, sm.z], size: [0.55 * sm.k, 0.7 * sm.k], life: 3.4, tint: '#4a3a34', alpha: 0.26, vel: [0.04, 0.55, 0], grow: 1.5, growY: 1.2, rot: sm.x }); }
      }
      firePool.update(dt);
      for (const T of torches) T.L.intensity = T.base * (0.8 + 0.14 * Math.sin(t * 9.3 + T.phase) * Math.sin(t * 5.1 + T.phase * 2) + 0.06 * Math.sin(t * 23 + T.phase));
      const WARM = new THREE.Color('#ff8a3a'), COOL = new THREE.Color('#6aaeff'), tmp = new THREE.Color();
      rims.forEach((r) => {
        r.a += ((r.ta || 0) - r.a) * Math.min(1, dt * 7); r.b += ((r.tb || 0) - r.b) * Math.min(1, dt * 7);
        const tot = r.a + r.b; r.L.intensity = tot * 80 * (Math.abs(r.L.position.x) < 1 ? 0.55 : 0.9) * (0.93 + 0.07 * Math.sin(t * 7 + r.L.position.x));
        if (tot > 0.001) r.L.color.copy(tmp.copy(WARM).lerp(COOL, r.b / tot));
      });
      spots.forEach((s, i) => {
        s.x += (s.tx - s.x) * Math.min(1, dt * 9); s.on += (s.ton - s.on) * Math.min(1, dt * 6);
        const both = hov[0] != null && hov[0] === hov[1];
        s.S.position.set(s.x - 2.4 + (both ? (i ? 0.5 : -0.5) : 0), 8.5, 3.5); s.S.target.position.set(s.x, PALM_Y + 1.1, 0);   // C2 r13: aimed up at the hero so the chosen hand sits in the penumbra, not the hot centre
        // C2 r11: Seraphine (light armour, pale skin) clipped to near-white under the centre key while Brann/Gorrim held their values -> the
        // centre spot is held to ~55 % (smooth in x, so the glide between hands stays continuous).
        const keyK = 1 - 0.45 * Math.max(0, 1 - Math.abs(s.x) / 1.8);
        s.S.intensity += (s.on * 42 * keyK - s.S.intensity) * Math.min(1, dt * 6);
      });
      place();
    },
    dispose() {
      game.world.groundAt = () => 0;
      cam.manual = false;
      unpark(); firePool.dispose(); weaponEnvOff();
    },
  };
}
