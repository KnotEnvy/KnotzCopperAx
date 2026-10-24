// Cinderwyrm fireball bodies (mounts agent; private helper of mount_fire.js — effect API lives in that file's header).
//   COMET  — the projectile in flight: closed hemispherical head + a licking, wobbling tail, shaped in the vertex shader.
//   BLAST  — ONE instanced draw: asymmetric ignition, 5..8 randomized textured combustion lobes,
//            five soft rising smoke wisps; lingering heat uses the existing independent embers.
//            Smoke, embers, scorch and light are layered around it by mount_fire.js (`ballBurst`).
// Both are premultiplied 'over' single meshes. Contact retires the entire comet on that tick.
// COLOUR: a smooth analytic heat ramp (exponential red channel, power-law green/blue: C1-continuous, no piecewise kinks
// = no Mach bands) + interleaved-gradient-noise dither on the heat, so there are no posterised contour bands.
import * as THREE from 'three';
import { NOISE, FOG_ADDITIVE } from '../glsl.js';

const RAMP = /* glsl */`
float vfxIGN(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
vec3 fireRamp(float h) {
  h = clamp(h, 0.0, 1.0);
  return vec3(1.0 - exp(-4.4 * h), pow(h, 1.85), pow(h, 4.3) * 0.9);   // black-red → orange → yellow → cream-white
}
`;

// ---------------------------------------------------------------- COMET (in flight)
const COMET_VERT = /* glsl */`
uniform float uTime, uLen, uR, uSeed;
varying vec2 vUv;
varying float vFacing, vT;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  float x = position.x, ang = uv.y * 6.2831853;
  vec2 rad = position.yz;
  float s = x * uLen;
  float t = clamp((s - uR) / max(0.01, uLen - uR), 0.0, 1.0);
  float r = s < uR ? sqrt(max(0.0, uR * uR - (uR - s) * (uR - s))) : uR * pow(1.0 - t, 1.1);
  r *= 1.0 + (0.06 + 0.4 * t) * sin(s * 5.5 - uTime * 19.0 + ang * 2.0 + uSeed) + 0.18 * t * sin(s * 9.0 - uTime * 27.0 - ang * 3.0);
  vec3 p = vec3(s, rad * r);
  p.y += t * t * uR * 1.1 + sin(s * 3.2 - uTime * 13.0 + uSeed) * 0.12 * t;
  p.z += cos(s * 2.7 - uTime * 11.0) * 0.1 * t;
  vec3 nc = s < uR ? vec3(s - uR, rad * r) / max(0.001, uR) : vec3(0.0, rad);
  vT = t;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec3 n = normalize(normalMatrix * normalize(nc));
  vFacing = abs(dot(n, normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
  vec4 mvPosition = mv;
  #include <fog_vertex>
}`;
const COMET_FRAG = /* glsl */`
uniform float uTime, uK, uSeed, uI, uLen;
varying vec2 vUv;
varying float vFacing, vT;
#include <common>
#include <fog_pars_fragment>
${NOISE}
${RAMP}
void main() {
  float u = vT, f = vFacing, sx = vUv.x * uLen;
  float n1 = vfxFbm(vec2(sx * 1.4 - uTime * 4.8, vUv.y * 7.0) + uSeed);
  float n2 = vfxFbm(vec2(sx * 3.6 - uTime * 9.5, vUv.y * 13.0 + 5.0) + uSeed * 1.7);
  float n = clamp((n1 * 0.6 + n2 * 0.4 - 0.5) * 1.8 + 0.5, 0.0, 1.0);
  float dens = smoothstep(0.0, 0.22, f * 1.75 - (1.0 - n) * (0.5 + u * 2.0));
  float a = dens * uK;
  if (a < 0.004) discard;
  float heat = f * f * f * (1.2 - u * 1.6) + (n - 0.5) * 0.75 - (1.0 - dens) * 0.35;
  heat = clamp(heat + (vfxIGN(gl_FragCoord.xy) - 0.5) * 0.04, 0.0, 1.0);
  vec3 col = fireRamp(heat) * mix(0.4, 1.4, heat * heat) * uI;
  col *= mix(0.45, 1.0, smoothstep(0.15, 0.55, f));          // dark-red smouldering rim
  float occ = mix(0.95, 0.35, heat);
  gl_FragColor = vec4(col * a, a * occ);
  ${FOG_ADDITIVE}
}`;
let _cometGeo = null;
function cometGeo() {
  if (_cometGeo) return _cometGeo;
  const SX = 26, SA = 20, pos = [], uv = [], idx = [];
  for (let i = 0; i <= SX; i++) for (let j = 0; j <= SA; j++) {
    const x = Math.pow(i / SX, 1.55), a = (j / SA) * Math.PI * 2;   // rings bunched at the head
    pos.push(x, Math.cos(a), Math.sin(a)); uv.push(x, j / SA);
  }
  for (let i = 0; i < SX; i++) for (let j = 0; j < SA; j++) {
    const a = i * (SA + 1) + j, b = a + SA + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(1, 0, 0), 3);
  return (_cometGeo = g);
}

// ---------------------------------------------------------------- BLAST (impact)
const BLAST_VERT = /* glsl */`
uniform float uAge, uSeed, uDir;
float rand12(float x) { return fract(sin(x * 91.3458 + uSeed * 17.17) * 47453.5453); }
uniform vec3 uOrigin;
attribute vec4 aBillow;  // fire: angle/travel/size/seed; soot: x/y/size/seed
attribute vec3 aPhase;  // kind (0 flame, 1 soot, 2 ignition), birth seconds, end seconds
varying vec2 vUv;
varying float vSeed, vKind, vAge, vFade;
#include <fog_pars_vertex>
void main() {
  vUv = uv; vSeed = aBillow.w + uSeed; vKind = aPhase.x;
  float age = uAge * 0.44;
  vAge = age;
  vec4 mvPosition = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float rnd = rand12(aBillow.w);
  if (vKind > 1.5) {
    mvPosition.xy += position.xy * vec2(1.16, 0.78);
    mvPosition.z += 0.60;
    vFade = 1.0 - smoothstep(0.012, 0.034, age);
  } else if (vKind > 0.5) {
    float s = max(0.0, age - aPhase.y);
    float t = clamp(s / (aPhase.z - aPhase.y), 0.0, 1.0);
    // Smoke lifts from the contact position while the chest falls away beneath it.
    mvPosition = viewMatrix * vec4(uOrigin, 1.0);
    vec2 offset = vec2(aBillow.x * uDir, aBillow.y);
    offset.x += uDir * s * (0.20 + rnd * 0.3);
    offset.y += s * 2.8;
    float angle = sin(vSeed) * 0.7 + s * 2.0;
    mat2 turn = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
    float size = aBillow.z * (0.95 + t * 0.30) * mix(1.0, 0.58, smoothstep(0.13, 0.29, age));
    mvPosition.xy += offset + turn * position.xy * vec2(size * 0.95, size * 1.15);
    mvPosition.z += 0.50;
    float tail = 0.28 * (1.0 - smoothstep(0.264, 0.315, age));
    vFade = smoothstep(0.0, 0.025, age - aPhase.y) * max(1.0 - smoothstep(0.28, 1.0, t), tail);
  } else {
    float grow = 1.0 - exp(-age * 38.0);
    float shrink = 1.0 - smoothstep(0.060, aPhase.z, age) * 0.30;
    // 5..8 lobes, fresh irregular placement/length per hit; forward-biased, no radial fan.
    float angle = mix(-0.72, 2.10, rand12(aBillow.w + 1.7)) + sin(vSeed + age * 19.0) * 0.16;
    vec2 axis = normalize(vec2(cos(angle) * uDir, sin(angle)));
    float len = (0.35 + grow * 0.95) * mix(0.60, 1.10, rnd) * shrink;
    float width = mix(0.65, 0.95, rand12(aBillow.w + 3.1));
    vec2 lobe = axis * ((position.x + 0.18) * len) + vec2(-axis.y, axis.x) * position.y * width;
    mvPosition.xy += vec2(0.12 * uDir, 0.04) + lobe;
    mvPosition.z -= 0.18 + rnd * 0.26;
    vFade = (1.0 - smoothstep(0.095, aPhase.z, age)) * step(aBillow.y, 5.0 + floor(rand12(13.1) * 4.0));
  }
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const BLAST_FRAG = /* glsl */`
uniform float uK, uI, uDir;
varying vec2 vUv;
varying float vSeed, vKind, vAge, vFade;
#include <common>
#include <fog_pars_fragment>
${NOISE}
${RAMP}
void main() {
  if (vFade < 0.002) discard;
  vec2 p = vUv * 2.0 - 1.0;
  float a, occ;
  vec3 col;
  if (vKind > 1.5) {
    // Filled asymmetric pressure kernel with broad forward and upward lobes at age zero.
    vec2 q = vec2(p.x * uDir, p.y) + vec2(0.08, -0.03);
    float n = vfxFbm(q * 6.0 + vSeed);
    float core = length(q / vec2(0.58, 0.57));
    float forward = length((q - vec2(0.39, 0.13)) / vec2(0.42, 0.32));
    float upper = length((q - vec2(-0.12, 0.35)) / vec2(0.27, 0.42));
    float angle = atan(q.y, q.x);
    float spikes = pow(max(0.0, sin(angle * 5.0 + vSeed)), 12.0) * 0.17;
    float dist = min(core, min(forward, upper)) + (n - 0.5) * 0.50 - spikes;
    a = (1.0 - smoothstep(0.62, 1.05, dist)) * vFade;
    float heat = clamp(0.90 - dist * 0.38 + (n - 0.5) * 0.45, 0.0, 1.0);
    col = mix(vec3(0.7, 0.10, 0.002), vec3(10.0, 7.0, 2.2), smoothstep(0.40, 0.92, heat)) * uI;
    col *= mix(0.22, 1.0, smoothstep(0.05, 0.80, a));
    occ = 0.07;
  } else if (vKind > 0.5) {
    vec2 q = p + vec2(sin(p.y * 4.0 + vSeed + vAge * 13.0), cos(p.x * 4.0 - vAge * 15.0 + vSeed)) * 0.18;
    vec2 flow = q * 4.2 + vec2(vSeed + vAge * 3.0, -vAge * 5.5);
    float n = vfxNoise(flow), fine = vfxNoise(flow * 2.2 + n * 1.7);
    float envelope = 1.0 - smoothstep(0.12, 0.92, length(q));
    float filaments = smoothstep(0.18, 0.72, n + fine * 0.12);
    a = envelope * filaments * vFade * 0.90 * uK;
    // Neutral dark grey, with no warm/tan underside.
    col = mix(vec3(0.022), vec3(0.065), n);
    occ = 1.0;
  } else {
    // Domain-warped round combustion lobes, with noise holes and scallops over the ENTIRE edge.
    // There is no analytic taper or straight-sided ribbon underneath the erosion.
    vec2 flow = p * 4.4 + vec2(vSeed - vAge * 10.0, vAge * 13.0);
    float n = vfxFbm(flow), fine = vfxNoise(flow * 2.9 + n * 2.5);
    vec2 q = p + vec2(sin(p.y * 5.0 + vSeed - vAge * 22.0), cos(p.x * 4.5 + vSeed + vAge * 26.0)) * 0.14;
    float lobes = min(length(q / vec2(0.85, 0.62)),
      min(length((q - vec2(0.36, 0.18)) / vec2(0.38, 0.46)), length((q + vec2(0.28, 0.24)) / vec2(0.46, 0.34))));
    float edge = lobes + (n - 0.5) * 1.10 + (fine - 0.5) * 0.42;
    float mask = 1.0 - smoothstep(0.58, 1.05, edge);
    mask *= 1.0 - smoothstep(0.78, 0.97, max(abs(p.x), abs(p.y)));
    float erosion = smoothstep(0.040, 0.14, vAge);
    float holes = smoothstep(0.24 + erosion * 0.24, 0.53 + erosion * 0.20, n + fine * 0.15);
    a = mask * holes * vFade * uK;
    float heat = clamp(0.40 + n * 0.48 + (fine - 0.5) * 0.55 - lobes * 0.20 - erosion * 0.15, 0.0, 1.0);
    vec3 fire = mix(vec3(0.30, 0.006, 0.001), vec3(3.7, 0.42, 0.005), smoothstep(0.18, 0.58, heat));
    fire = mix(fire, vec3(7.0, 3.0, 0.16), smoothstep(0.60, 0.82, heat));
    col = fire * uI;
    occ = 1.0 - smoothstep(0.55, 0.85, heat) * 0.88;
  }
  if (a < 0.004) discard;
  gl_FragColor = vec4(col * a, a * occ);
  ${FOG_ADDITIVE}
}`;
let _blastGeo = null;
function blastGeo() {
  if (_blastGeo) return _blastGeo;
  const quad = new THREE.PlaneGeometry(1, 1), g = new THREE.InstancedBufferGeometry();
  g.index = quad.index; g.attributes.position = quad.attributes.position; g.attributes.uv = quad.attributes.uv;
  const data = [], phases = [];
  // Smoke first, flames through its base, flash last. Still ONE instanced draw, no extra material/texture.
  const puffs = [[-0.12, 0.15, 0.75], [0.24, 0.32, 0.85], [0.48, 0.18, 0.70], [0.02, 0.54, 0.72], [0.38, 0.56, 0.78]];
  for (let i = 0; i < puffs.length; i++) {
    data.push(...puffs[i], i * 3.731 + 2.2);
    phases.push(1, 0.048 + i * 0.006, 0.285 + i * 0.006);
  }
  for (let i = 0; i < 8; i++) {
    data.push(0, i + 1, 1, i * 3.731 + 1.2);
    phases.push(0, 0, 0.152 + (i % 3) * 0.016);
  }
  data.push(0, 0, 1, 0); phases.push(2, 0, 0.034);
  g.setAttribute('aBillow', new THREE.InstancedBufferAttribute(new Float32Array(data), 4));
  g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(new Float32Array(phases), 3));
  g.instanceCount = phases.length / 3;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3);
  return (_blastGeo = g);
}

// ---------------------------------------------------------------- meshes + lifecycle
export const FIREBALL_R = 0.27, FIREBALL_LEN = 0.78, BLAST_LIFE = 0.44;
const shader = (vertexShader, fragmentShader, uniforms, side) => new THREE.ShaderMaterial({
  vertexShader, fragmentShader, fog: true, transparent: true, depthWrite: false, side,
  blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, uniforms]),
});
function makeBlast() {
  const m = new THREE.Mesh(blastGeo(), shader(BLAST_VERT, BLAST_FRAG, { uTime: { value: 0 }, uK: { value: 0 }, uSeed: { value: 0 }, uI: { value: 1 },
    uAge: { value: 0 }, uDir: { value: 1 }, uOrigin: { value: new THREE.Vector3() } }, THREE.FrontSide));
  m.name = 'mount_fireblast'; m.frustumCulled = false; m.renderOrder = 17; m.castShadow = false; m.receiveShadow = false;
  m.onAfterRender = () => { if (!m.userData.live) m.visible = false; };
  return m;
}
/** A beast's fireball body (one per Cinderwyrm: one fireball in flight). Add it under the beast's body so stage prewarm
 *  links its program (it hides itself after its first draw); Fireball actors borrow it via fireballAttach(). The
 *  impact BLAST rides along as its child (same prewarm) until an impact hands it to the VFX group. */
export function makeFireballMesh() {
  const m = new THREE.Mesh(cometGeo(), shader(COMET_VERT, COMET_FRAG, { uTime: { value: 0 }, uK: { value: 0 }, uSeed: { value: 0 }, uI: { value: 1 },
    uLen: { value: FIREBALL_LEN }, uR: { value: FIREBALL_R } }, THREE.FrontSide));
  m.name = 'mount_fireball'; m.frustumCulled = false; m.renderOrder = 16; m.castShadow = false; m.receiveShadow = false;
  m.onAfterRender = () => { if (!m.userData.live) m.visible = false; };
  m.userData.seed = Math.random() * 10;
  const blast = makeBlast();
  blast.userData.seed = Math.random() * 10;
  m.userData.blast = blast; m.add(blast);
  return m;
}
/** Put the fireball body on `parent` (the projectile's world-aligned view) flying toward dir (+-1): head centre at the
 *  parent origin, tail streaming behind. fireballTick(mesh, time) animates it in flight. */
export function fireballAttach(mesh, parent, dir) {
  if (mesh.userData.home === undefined) mesh.userData.home = mesh.parent || null;      // where to park it between shots
  if (mesh.parent !== parent) { if (mesh.parent) mesh.parent.remove(mesh); parent.add(mesh); }
  const d = dir >= 0 ? 1 : -1, U = mesh.material.uniforms;
  mesh.position.set(d * FIREBALL_R, 0, 0); mesh.rotation.set(0, d > 0 ? Math.PI : 0, 0);
  U.uK.value = 1; U.uI.value = 1; U.uLen.value = FIREBALL_LEN; U.uSeed.value = mesh.userData.seed;
  mesh.visible = true; mesh.userData.live = true;
  mesh.userData.token = (mesh.userData.token | 0) + 1;
}
export function fireballTick(mesh, time) {
  const U = mesh.material.uniforms;
  U.uTime.value = time; U.uI.value = 1 + 0.12 * Math.sin(time * 37);
}
/** Back to the beast's body (hidden) so the projectile's view can be discarded without taking the mesh with it. */
function park(mesh, home) {
  if (home) home.add(mesh); else if (mesh.parent) mesh.parent.remove(mesh);
}
/** Park the body (projectile expired without an impact). */
export function fireballHide(mesh) {
  mesh.visible = false; mesh.userData.live = false; mesh.userData.token = (mesh.userData.token | 0) + 1;
  park(mesh, mesh.userData.home);
}
/** Impact at `c`: retire head AND tail before the contact frame, then ignite directional, curling combustion. */
export function fireballExplode(vfx, comet, c, seed = 0, victim = null, dir = 1) {
  fireballHide(comet);
  comet.material.uniforms.uK.value = 0;
  const B = comet.userData.blast;
  if (!B) return;
  // Shared contact-rooted combustion. The old chest-following blast left its soot
  // at the standing pose while the launch reaction moved the victim away below it.
  B.visible = false; B.userData.live = false;
  park(B, comet);
  vfx.fire.emitCombustion({pos:[c.x,c.y,c.z+.18],target:victim,scale:1.2,dir});
}
