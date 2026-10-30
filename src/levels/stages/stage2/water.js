// Stage 2 — the misty lake: a wave-displaced MeshStandardMaterial (sky/env reflection + sun glint for free, the
// game-wide fog + height haze apply), analytic Gerstner-ish swell flowing past the tortoise (it wades toward +X, so the
// water streams toward −X), foam where the water meets the shell outline and around the neck/legs, wake streaks.
// env-r33: the NEAR-RIM contact foam follows the real scalloped waterline (rimZ at WATER_Y, under the marginal
// overhang) and is PATCHY: surge zones form and fade along the rim (slow noise in shell-x and time, stronger when the
// shell dips); inside them porous foam (cellular bubble network) hugs the lip and sheds thin, fragmented strands that
// drift outward and downstream (−X) and die within ~1.5 m, so the gaps stay open blue-green water. Off-white (≤ 80 %),
// never emissive; no foam on the deck (it is drawn under the shell). The old continuous contact line is kept only on the
// far side and the rounded ends.
// Plus: shell-edge spray (one Points draw, analytic bursts that surge with the sway) and ring-out splashes (CPU pool).
import * as THREE from 'three';
import { patchStandard, shared } from '../../../render/shaderlib.js';
import { ZC, LIP_Z, FRONT, BACK, WATER_Y, CZ, OV, PM } from './shell.js';

const RIM_GLSL = /* glsl */`
uniform vec4 kWaRim;   // ZC, LIP_Z, FRONT.x0, FRONT.len
uniform vec4 kWaRim2;  // BACK.x0, BACK.len, flow speed, far waterline z
uniform vec4 kWaObs[4]; // extra foam circles: x, z, radius, strength (neck, legs)
uniform vec4 kWaLip;    // CZ, OV, PM, outward drift (m/s) of shed foam
uniform vec4 kWaRimF;   // birth threshold, age decay (s), surge (0..1, sway dip), density (High 1 / Low 0)
uniform vec3 kWaFoam2;  // near-rim contact foam colour (off-white)
// exact near waterline of the scalloped marginal rim (stage2/shell.js rimZ)
float kRimZ(float x) {
  float u = 0.0;
  if (x > kWaRim.z) u = min(1.0, (x - kWaRim.z) / kWaRim.w);
  if (x < kWaRim2.x) u = min(1.0, (kWaRim2.x - x) / kWaRim2.y);
  float k = sqrt(max(0.02, 1.0 - u * u * 0.85));
  float f = fract((x - kWaLip.y - kWaLip.z * 0.5) / kWaLip.z);
  return kWaLip.x + (3.66 + 0.36 * (1.0 - abs(f * 2.0 - 1.0)) - kWaLip.x) * k;
}
float kSq(float x) {
  float u = 0.0;
  if (x > kWaRim.z) u = min(1.0, (x - kWaRim.z) / kWaRim.w);
  if (x < kWaRim2.x) u = min(1.0, (kWaRim2.x - x) / kWaRim2.y);
  return sqrt(max(0.0, 1.0 - u * u));
}
// signed-ish distance (m) from a water point to the shell outline (positive outside)
float kShellDist(vec2 p) {
  float k = kSq(p.x);
  float hw = (kWaRim.y - kWaRim.x) * k;
  float farZ = kWaRim.x + (kWaRim2.w - kWaRim.x) * k;
  float d = max(p.y - (kWaRim.x + hw), farZ - p.y);
  // ends: distance along x past the tips
  float dx = max(p.x - (kWaRim.z + kWaRim.w), kWaRim2.x - kWaRim2.y - p.x);
  return max(d, dx);
}
`;

export function buildWater(ctx, o = {}) {
  const q = ctx.quality || {};
  const low = q.name === 'low';
  // custom grid: x ∈ [-230, 290], z rows dense near the shell (z ∈ [-40, 30]) and sparse toward the far shore
  const nx = low ? 110 : 220, rows = [];
  for (let z = 40; z > -40; z -= low ? 1.4 : 0.8) rows.push(z);
  for (let z = -40; z > -420; z *= 1.07) rows.push(z);
  const vx = [], ix = [];
  for (let j = 0; j < rows.length; j++) for (let i = 0; i <= nx; i++) vx.push(-230 + (i / nx) * 520, 0, rows[j]);
  for (let j = 0; j < rows.length - 1; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + nx + 1; ix.push(a, a + 1, b, a + 1, b + 1, b); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vx, 3));
  const nrm = new Float32Array(vx.length); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(ix);
  g.computeBoundingSphere();

  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.48, metalness: 0.0, envMapIntensity: o.env ?? 0.18, transparent: false });
  const U = {
    kWaDeep: { value: new THREE.Color(o.deep || '#0d2a2c') }, kWaShallow: { value: new THREE.Color(o.shallow || '#2a5a52') },
    kWaFoam: { value: new THREE.Color(o.foam || '#7d9690') },
    kWaRim: { value: new THREE.Vector4(ZC, LIP_Z + 0.05, FRONT.x0, FRONT.len) },
    kWaRim2: { value: new THREE.Vector4(BACK.x0, BACK.len, o.flow ?? 1.1, -11.4) },
    kWaObs: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    kWaAmp: { value: o.amp ?? 1 },
    kWaLip: { value: new THREE.Vector4(CZ, OV, PM, o.foamDrift ?? 0.55) },
    kWaRimF: { value: new THREE.Vector4(o.foamBirth ?? 0.52, o.foamLife ?? 2.8, 0, low ? 0 : 1) },
    kWaFoam2: { value: new THREE.Color(o.foam2 || '#cdd6d0') },
  };
  patchStandard(m, {
    key: 'kcaLake2', uniforms: U,
    vertHead: /* glsl */`
uniform vec4 kWaRim2; uniform float kWaAmp;
varying float vWaCrest;
vec3 kWave(vec2 p, float t) {
  // few directional swells flowing −X (the tortoise wades +X) + cross chop; returns (height, dh/dx, dh/dz)
  vec3 r = vec3(0.0);
  vec4 A = vec4(0.16, 0.09, 0.05, 0.035) * kWaAmp;
  vec2 d0 = normalize(vec2(-1.0, 0.25)), d1 = normalize(vec2(-0.7, -0.7)), d2 = normalize(vec2(-0.2, 1.0)), d3 = normalize(vec2(-1.0, -0.1));
  vec4 k = vec4(0.28, 0.46, 0.8, 1.35);
  vec4 w = sqrt(9.8 * k) * 0.8;
  float f;
  f = dot(d0, p) * k.x - w.x * t; r += vec3(sin(f), cos(f) * k.x * d0) * A.x;
  f = dot(d1, p) * k.y - w.y * t + 1.3; r += vec3(sin(f), cos(f) * k.y * d1) * A.y;
  f = dot(d2, p) * k.z - w.z * t + 2.1; r += vec3(sin(f), cos(f) * k.z * d2) * A.z;
  f = dot(d3, p) * k.w - w.w * t + 0.4; r += vec3(sin(f), cos(f) * k.w * d3) * A.w;
  return r;
}
`,
    vertMain: /* glsl */`
  {
    vec3 wv = kWave(vKW.xz + vec2(kWaRim2.z * kTime, 0.0), kTime);
    float fade = 1.0 - smoothstep(120.0, 260.0, length(vKW.xz - cameraPosition.xz));
    transformed.y += wv.x * fade;
    vWaCrest = wv.x * fade;
  }
`,
    fragHead: /* glsl */`
uniform vec3 kWaDeep, kWaShallow, kWaFoam;
${RIM_GLSL}
varying float vWaCrest;
float kWaFoamAmt; float kWaDist;
vec3 kWaveN(vec2 p, float t) {
  vec2 d0 = normalize(vec2(-1.0, 0.25)), d1 = normalize(vec2(-0.7, -0.7)), d2 = normalize(vec2(-0.2, 1.0)), d3 = normalize(vec2(-1.0, -0.1));
  vec4 k = vec4(0.28, 0.46, 0.8, 1.35); vec4 w = sqrt(9.8 * k) * 0.8; vec4 A = vec4(0.16, 0.09, 0.05, 0.035);
  vec2 g = vec2(0.0); float f;
  f = dot(d0, p) * k.x - w.x * t; g += cos(f) * k.x * d0 * A.x;
  f = dot(d1, p) * k.y - w.y * t + 1.3; g += cos(f) * k.y * d1 * A.y;
  f = dot(d2, p) * k.z - w.z * t + 2.1; g += cos(f) * k.z * d2 * A.z;
  f = dot(d3, p) * k.w - w.w * t + 0.4; g += cos(f) * k.w * d3 * A.w;
  return normalize(vec3(-g.x, 1.0, -g.y));
}
`,
    albedo: /* glsl */`
  vec2 wp = vKW.xz;
  float t = kTime;
  vec2 flow = vec2(kWaRim2.z * t, 0.0);
  float dist = kShellDist(wp);
  for (int i = 0; i < 4; i++) { vec4 ob = kWaObs[i]; if (ob.w > 0.0) dist = min(dist, (length((wp - ob.xy) * vec2(0.7, 1.0)) - ob.z) / max(ob.w, 0.2)); }
  kWaDist = dist;
  vec4 n1 = kN((wp + flow) * 0.09), n2 = kN((wp + flow * 1.6) * 0.37 + 0.5), n3 = kN((wp + flow * 1.2) * vec2(0.05, 0.18));
  // contact foam (far side + rounded ends only; the near rim along the belt gets the patchy model below)
  float beltK = smoothstep(kWaRim2.x - 3.0, kWaRim2.x + 2.0, wp.x) * (1.0 - smoothstep(kWaRim.z - 2.0, kWaRim.z + 3.0, wp.x));
  float nearSide = beltK * step(kWaRim.x, wp.y);
  float contact = (1.0 - smoothstep(0.0, 0.35 + n1.r * 0.9, dist)) * smoothstep(-0.6, 0.0, dist) * (0.55 + 0.45 * smoothstep(0.35, 0.6, n2.b)) * (1.0 - nearSide);
  // NEAR-RIM patchy contact foam + short trailing wakes. Integration correction (env-r33): the first build's broad
  // birth zones saturated into flat white sheets, and its per-vertex crest term (interpolated across 2.4 m water
  // triangles) cut straight-edged shards when thresholded. Now: contact foam hugs the scalloped lip only inside the
  // active surge stretches, a cellular bubble network keeps every island porous (holes, no flat interior), and the wake
  // is thin, fragmented strands along the drift streamlines that die within ~1.5 m. Blue-green water between and through.
  float rimFoam = 0.0;
  float dn = wp.y - kRimZ(wp.x);                                // metres outside the scalloped waterline
  if (beltK > 0.0 && dn > -0.6 && dn < 2.4) {
    float tau = max(dn + 0.15, 0.0) / kWaLip.w;                 // age of foam that has drifted out to dn
    float xs = wp.x + kWaRim2.z * tau;                          // streamline: rim x where it was shed (drifted −X since)
    float ts = t - tau;
    float b = kN(vec2(xs * 0.031, ts * 0.012 + 0.37)).r * 0.6 + kN(vec2(xs * 0.083 + 0.5, ts * 0.029 + 0.13)).g * 0.4;
    float birth = smoothstep(kWaRimF.x - 0.1 * kWaRimF.z, kWaRimF.x + 0.15, b) * beltK;
    float hug = smoothstep(-0.6, -0.2, dn) * (1.0 - smoothstep(0.1, 0.62, dn + 0.3 * (kN(vec2(wp.x * 0.37, t * 0.05)).g - 0.5)));
    float strand = smoothstep(0.52, 0.8, kN(vec2(xs * 0.42 + 0.3, ts * 0.065 + 0.71)).g);   // ~0.2-0.3 m strands, broken in time
    float wake = strand * exp(-tau / kWaRimF.y) * smoothstep(0.15, 0.8, dn);
    vec2 a = vec2(wp.x + kWaRim2.z * t, wp.y);                  // water frame: the bubbles ride the flow
    vec2 aw = a + (kN(a * 0.09 + 0.33).rg - 0.5) * 2.2;         // domain warp: irregular, unequal bubble cells
    float pore = smoothstep(0.14 + 0.2 * kN(a * 0.17 + 0.8).g, 0.56, kN(aw * vec2(0.3, 0.36) + 0.21).a);   // cellular F1 holes
    if (kWaRimF.w > 0.5) pore *= 0.6 + 0.4 * smoothstep(0.3, 0.62, kN(aw * 0.55 + 0.6).g);   // second scale (High only)
    float amt = birth * (hug * (0.25 + 0.75 * pore) + wake * pore * 0.85);
    rimFoam = smoothstep(0.12, 0.55, amt) * (0.62 + 0.18 * kN(aw * 0.5 + 0.47).g);   // ≤ 0.8, never a flat white sheet
  }
  float lace = smoothstep(0.6, 0.78, n2.r * 0.7 + n1.g * 0.5) * (1.0 - smoothstep(0.5, 6.0 + n3.b * 5.0, dist)) * smoothstep(-0.2, 0.3, dist);
  float streak = smoothstep(0.62, 0.8, n3.r) * (1.0 - smoothstep(2.0, 18.0, dist)) * 0.6;
  float crest = smoothstep(0.12, 0.24, vWaCrest + n2.g * 0.06) * 0.35;
  // near the near rim the old dull mottle (lace / streak / crest) gives way to clean blue-green water, so the gaps
  // between the contact-foam islands read as open water and the islands read as foam
  float quiet = 1.0 - 0.75 * beltK * step(kWaRim.x, wp.y) * (1.0 - smoothstep(2.5, 7.0, wp.y - kRimZ(wp.x)));
  float foam = clamp(contact * 0.95 + (lace * 0.55 + streak * 0.45 + crest) * quiet, 0.0, 1.0);
  kWaFoamAmt = max(foam, rimFoam);
  // colour: jade shallows near the shell (light scattering through the swell), deep teal-slate further out
  float sh = 1.0 - smoothstep(0.0, 22.0, dist);
  vec3 c = mix(kWaDeep, kWaShallow, sh * 0.8 + clamp(vWaCrest * 1.6, 0.0, 0.3));
  diffuseColor.rgb = mix(mix(c, kWaFoam, foam), kWaFoam2, rimFoam);
`,
    rough: /* glsl */`
  roughnessFactor = mix(0.48, 0.9, kWaFoamAmt);
`,
    bump: /* glsl */`
  {
    vec2 wp = vKW.xz + vec2(kWaRim2.z * kTime, 0.0);
    float fade = 1.0 - smoothstep(60.0, 220.0, length(vKW.xz - cameraPosition.xz));
    vec3 nw = kWaveN(wp, kTime);
    vec4 r1 = kN(wp * 0.55 + kTime * vec2(0.02, 0.05)), r2 = kN(wp * 1.3 - kTime * vec2(0.04, -0.03));
    nw.xz += ((r1.rg - 0.5) * 0.35 + (r2.gb - 0.5) * 0.22) * fade;
    nw = normalize(mix(vec3(0.0, 1.0, 0.0), nw, 0.35 + 0.65 * fade));
    normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
  }
`,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.position.y = WATER_Y;
  mesh.receiveShadow = true; mesh.name = 'lake';
  mesh.frustumCulled = false;
  return { mesh, uniforms: U };
}

// ---------------------------------------------------------------- spray (edge bursts)
const SPRAY_V = /* glsl */`
#include <common>
#include <fog_pars_vertex>
attribute vec4 aE;      // emitter x, y, z, phase
attribute vec4 aP;      // dir x, dir z, size, speed
uniform float kTime, uSurge, uScale;
varying float vA; varying vec2 vSeed;
void main() {
  float period = 2.6 + fract(aE.w * 7.13) * 1.8;
  float t = mod(kTime + aE.w * period, period);
  float life = 1.25 + aP.w * 0.35;
  float u = clamp(t / life, 0.0, 1.0);
  float live = step(t, life);
  vec3 v0 = vec3(aP.x * 1.4 - 1.1, 0.9 + aP.w * 1.2, aP.y * 1.1);
  vec3 p = aE.xyz + v0 * t + vec3(0.0, -4.9 * t * t, 0.0);
  // gust: per-emitter burst strength follows the sway surge (bigger over the lip when the shell dips)
  float gate = smoothstep(0.25, 0.75, sin(aE.x * 0.21 + kTime * 0.35 + aE.w * 3.0) * 0.5 + 0.5 + uSurge * 0.4);
  vA = live * gate * (1.0 - u) * smoothstep(0.0, 0.08, u);
  vSeed = vec2(aE.w, aP.z);
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = aP.z * (0.65 + u * 0.25) * uScale / max(1.0, -mvPosition.z);
  #include <fog_vertex>
}`;
const SPRAY_F = /* glsl */`
#include <common>
#include <fog_pars_fragment>
uniform vec3 uColor;
varying float vA; varying vec2 vSeed;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  float a = smoothstep(1.0, 0.2, r);
  float a2 = exp(-r * r * 3.5);
  a = a2 * vA * (0.75 + 0.25 * sin(vSeed.x * 91.0));
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a * 0.2);
  #include <fog_fragment>
}`;

/** emitters: [[x, y, z, dirX, dirZ]] */
export function buildSpray(ctx, emitters, o = {}) {
  const q = ctx.quality || {};
  const per = q.name === 'low' ? 4 : 8;
  const n = emitters.length * per;
  const aE = new Float32Array(n * 4), aP = new Float32Array(n * 4);
  let k = 0;
  const r = (i) => { const s = Math.sin(i * 12.9898) * 43758.5453; return s - Math.floor(s); };
  emitters.forEach((e, ei) => {
    for (let j = 0; j < per; j++, k++) {
      const s = r(k + 1), s2 = r(k * 3.1 + 7), s3 = r(k * 5.7 + 2);
      aE.set([e[0] + (s - 0.5) * 1.4, e[1], e[2] + (s2 - 0.5) * 0.3, ei * 0.137 + j * 0.019 + s3 * 0.05], k * 4);
      aP.set([(e[3] || 0) + (s2 - 0.5) * 0.8, (e[4] ?? 1) * (0.4 + s * 0.6), 0.045 + s3 * 0.08, s], k * 4);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('aE', new THREE.BufferAttribute(aE, 4));
  g.setAttribute('aP', new THREE.BufferAttribute(aP, 4));
  const mat = new THREE.ShaderMaterial({
    vertexShader: SPRAY_V, fragmentShader: SPRAY_F, transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uSurge: { value: 0 }, uScale: { value: 1500 }, uColor: { value: new THREE.Color(o.color || '#9eb6af') } }]),
  });
  mat.uniforms.kTime = shared.uTime;
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false; pts.name = 'spray'; pts.renderOrder = 2;
  return { object: pts, uniforms: mat.uniforms };
}

// ---------------------------------------------------------------- splashes (ring-outs): small CPU particle pool
export function buildSplashes(o = {}) {
  const N = 220;
  const pos = new Float32Array(N * 3), size = new Float32Array(N), alpha = new Float32Array(N);
  const vel = new Float32Array(N * 3), life = new Float32Array(N), age = new Float32Array(N).fill(9);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 1500 }, uColor: { value: new THREE.Color("#a2bbb2") } }]),
    vertexShader: /* glsl */`
#include <common>
#include <fog_pars_vertex>
attribute float aSize; attribute float aAlpha; uniform float uScale; varying float vA;
void main() { vA = aAlpha; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = aSize * uScale / max(1.0, -mvPosition.z);
  #include <fog_vertex>
}`,
    fragmentShader: /* glsl */`
#include <common>
#include <fog_pars_fragment>
uniform vec3 uColor; varying float vA;
void main() { float r = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.25, r) * vA; if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a * 0.48);
  #include <fog_fragment>
}`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false; pts.name = 'splashes'; pts.renderOrder = 3;
  let head = 0;
  return {
    object: pts,
    burst(x, y, z, power = 1, rng = Math.random) {
      const n = Math.round(60 * power);
      for (let i = 0; i < n; i++) {
        const k = head; head = (head + 1) % N;
        const a = rng() * Math.PI * 2, rr = rng();
        const col = i < n * 0.35;                         // central column vs ring crown
        pos.set([x + Math.cos(a) * rr * 0.5, y, z + Math.sin(a) * rr * 0.4], k * 3);
        const up = col ? 5 + rng() * 4.5 : 2.2 + rng() * 2.6;
        const out = col ? 0.6 : 2 + rng() * 2.2;
        vel.set([Math.cos(a) * out - 0.8, up * power, Math.sin(a) * out * 0.8], k * 3);
        life[k] = 0.7 + rng() * 0.7; age[k] = 0; size[k] = (col ? 0.06 : 0.04) + rng() * 0.09;
      }
    },
    update(dt) {
      let any = false;
      for (let k = 0; k < N; k++) {
        if (age[k] >= life[k]) { alpha[k] = 0; continue; }
        any = true;
        age[k] += dt;
        vel[k * 3 + 1] -= 9.8 * dt;
        pos[k * 3] += vel[k * 3] * dt; pos[k * 3 + 1] += vel[k * 3 + 1] * dt; pos[k * 3 + 2] += vel[k * 3 + 2] * dt;
        const u = age[k] / life[k];
        alpha[k] = (1 - u) * Math.min(1, u * 12);
        size[k] += dt * 0.035;
      }
      if (any || this._was) { g.attributes.position.needsUpdate = true; g.attributes.aSize.needsUpdate = true; g.attributes.aAlpha.needsUpdate = true; }
      this._was = any;
    },
  };
}
