// GPU-instanced particle pool: one InstancedMesh (one draw call) per pool, camera-facing quads with
// procedural shapes, HDR colours (bloom), velocity-stretched streaks, gravity/drag/spin, colour+size over life.
// CPU integrates (cheap for a few thousand), the GPU billboards and shades.
//
//   pool.emit({ pos:[x,y,z]|Vector3, vel:[x,y,z], life:0.3, size:[s0,s1], color:[c0,c1] (hex|[r,g,b,a]),
//               intensity: 1 (HDR multiplier), shape: 'soft'|'streak'|'ring'|'spark'|'smoke'|'shard'|'glint'|'ember'|'puff',
//               stretch: 0 (streak length per m/s), gravity: 0 (m/s² down), drag: 0 (1/s), spin: 0 (rad/s), rot: 0,
//               floor: y (bounce plane), fadeIn: s (alpha ramp-in, default 0 additive / 0.08 lit pools),
//               delay: s (invisible + frozen until then) })
//
// Pools built with { lit: true } (vfx.alpha) shade 'smoke'/'puff'/'soft' as lit volumes: colour = ALBEDO, lit by
// the stage's real lights through a pseudo-sphere normal (see glsl.js), so dust sits in the grade instead of
// glowing. Additive pools (vfx.add) are emissive: colour × intensity = HDR radiance.
import * as THREE from 'three';
import { NOISE, LIT, FOG_ADDITIVE, litUniforms } from './glsl.js';

const SHAPES = { soft: 0, streak: 1, ring: 2, spark: 3, smoke: 4, shard: 5, glint: 6, ember: 7, puff: 8 };

const VERT = /* glsl */`
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iColor;
attribute vec4 iParams; // size, stretch, rotation, shape
varying vec2 vUv;
varying vec4 vColor;
varying float vShape;
varying float vSeed;
varying vec3 vViewPos;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vColor = iColor;
  vShape = iParams.w;
  vSeed = fract(iParams.w);
  vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
  vec2 c = position.xy;
  float size = iParams.x;
  if (iParams.y > 0.0) {
    vec3 vv = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
    float sp = length(vv.xy);
    vec2 dir = sp > 1e-4 ? vv.xy / sp : vec2(1.0, 0.0);
    vec2 perp = vec2(-dir.y, dir.x);
    float len = size * (1.0 + iParams.y * sp * 10.0);
    c = dir * c.x * len + perp * c.y * size;
  } else {
    float cs = cos(iParams.z), sn = sin(iParams.z);
    c = mat2(cs, sn, -sn, cs) * c * size;
  }
  mvPosition.xy += c;
  vViewPos = mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = (lit) => /* glsl */`
varying vec2 vUv;
varying vec4 vColor;
varying float vShape;
varying float vSeed;
varying vec3 vViewPos;
uniform float additive;
uniform float uOcc;
#include <common>
${lit ? '#include <lights_pars_begin>' : ''}
#include <fog_pars_fragment>
${NOISE}
${lit ? LIT : ''}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float d = length(p);
  float a;
  float hot = 0.0;
  int s = int(floor(vShape + 0.001));
  if (s == 0) { a = pow(max(0.0, 1.0 - d), 1.8); hot = pow(max(0.0, 1.0 - d * 1.6), 3.0); }
  else if (s == 1) { float w = 1.0 - abs(p.y); a = pow(max(0.0, w), 2.5) * smoothstep(1.0, 0.2, abs(p.x)) * (0.6 + 0.4 * smoothstep(-1.0, 0.6, p.x)); hot = a * smoothstep(0.0, 0.8, p.x) * step(0.55, w); }
  else if (s == 2) a = pow(max(0.0, 1.0 - abs(d - 0.78) / 0.2), 2.0);
  else if (s == 3) { float cross = max(pow(max(0.0, 1.0 - abs(p.x) * 8.0), 2.0) * (1.0 - abs(p.y)), pow(max(0.0, 1.0 - abs(p.y) * 8.0), 2.0) * (1.0 - abs(p.x))); a = max(cross, pow(max(0.0, 1.0 - d), 4.0)); hot = pow(max(0.0, 1.0 - d * 2.5), 2.0); }
  else if (s == 4 || s == 8) {
    // Puffy volume: noise-eroded blob (seeded per instance), soft rim.
    float n = vfxFbm(p * 1.7 + vSeed * 37.0);
    float edge = d + (n - 0.5) * (s == 8 ? 0.7 : 0.45);
    a = 1.0 - smoothstep(s == 8 ? 0.25 : 0.4, 1.0, edge);
    a *= 0.75 + 0.5 * n;
  }
  else if (s == 5) { a = step(abs(p.x) + abs(p.y) * 0.45, 0.9) * (1.0 - d * 0.4); }
  else if (s == 6) {
    // Glint: thin 4-point twinkle with a tight core (crisp, never a dome).
    float rx = pow(max(0.0, 1.0 - abs(p.y) * 14.0), 2.0) * pow(max(0.0, 1.0 - abs(p.x)), 2.0);
    float ry = pow(max(0.0, 1.0 - abs(p.x) * 14.0), 2.0) * pow(max(0.0, 1.0 - abs(p.y)), 2.0);
    float core = pow(max(0.0, 1.0 - d * 3.0), 2.0);
    a = max(max(rx, ry), core); hot = core;
  }
  else { a = pow(max(0.0, 1.0 - d), 3.0); hot = pow(max(0.0, 1.0 - d * 2.2), 2.0); } // ember
  a *= vColor.a;
  if (a < 0.002) discard;
  ${lit ? `
  vec3 n3 = normalize(vec3(p.x, p.y, 0.55 + 0.9 * sqrt(max(0.0, 1.0 - d * d))));
  vec3 col = vColor.rgb * vfxIrradiance(n3, vViewPos) * (0.82 + 0.18 * p.y);
  gl_FragColor = vec4(col, a);` : `
  float mx = max(vColor.r, max(vColor.g, vColor.b));
  vec3 col = mix(vColor.rgb, vec3(mx * 1.15), clamp(hot, 0.0, 1.0) * 0.12);
  gl_FragColor = additive > 0.5 ? vec4(col * a, a * uOcc) : vec4(col, a);`}
  ${lit ? '#include <fog_fragment>' : FOG_ADDITIVE}
}`;

export class ParticlePool {
  constructor({ capacity = 3000, additive = true, lit = false, name = 'particles' } = {}) {
    this.cap = capacity;
    this.n = 0;
    this.lit = lit && !additive;
    const N = capacity;
    this.pos = new Float32Array(N * 3); this.vel = new Float32Array(N * 3);
    this.age = new Float32Array(N); this.life = new Float32Array(N);
    this.s0 = new Float32Array(N); this.s1 = new Float32Array(N);
    this.c0 = new Float32Array(N * 4); this.c1 = new Float32Array(N * 4);
    this.grav = new Float32Array(N); this.drag = new Float32Array(N);
    this.rot = new Float32Array(N); this.spin = new Float32Array(N);
    this.stretch = new Float32Array(N); this.shape = new Float32Array(N);
    this.floorY = new Float32Array(N); this.fadeIn = new Float32Array(N); this.delay = new Float32Array(N);
    this.defaultFadeIn = this.lit ? 0.08 : 0;

    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    geo.setAttribute('uv', quad.attributes.uv);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aPar = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos); geo.setAttribute('iVel', this.aVel);
    geo.setAttribute('iColor', this.aCol); geo.setAttribute('iParams', this.aPar);
    geo.instanceCount = 0;
    this.geo = geo;
    const uniforms = this.lit ? litUniforms({ additive: { value: 0 }, uOcc: { value: 0 } }) : THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { additive: { value: additive ? 1 : 0 }, uOcc: { value: 0.3 } }]);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG(this.lit), uniforms, lights: this.lit,
      transparent: true, depthWrite: false, fog: true,
      blending: additive ? THREE.CustomBlending : THREE.NormalBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    // Additive pools are premultiplied: dst = src + dst·(1 − a·uOcc). uOcc 0 = pure additive; ~0.3 lets hot cores
    // partly cover what is behind them so sparks still read over pale bodies / bright skies.
    if (additive) { this.material.blendSrc = THREE.OneFactor; this.material.blendDst = THREE.OneMinusSrcAlphaFactor; }
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 20 : 10;
    this.mesh.name = name;
    this._c = new THREE.Color();
  }

  _color(v, out, o, intensity) {
    if (Array.isArray(v)) { out[o] = v[0] * intensity; out[o + 1] = v[1] * intensity; out[o + 2] = v[2] * intensity; out[o + 3] = v[3] ?? 1; return; }
    if (v && v.isColor) this._c.copy(v); else this._c.set(v ?? 0xffffff);
    out[o] = this._c.r * intensity; out[o + 1] = this._c.g * intensity; out[o + 2] = this._c.b * intensity; out[o + 3] = 1;
  }

  emit(p) {
    if (this.n >= this.cap) return -1;
    const i = this.n++;
    const P = p.pos, V = p.vel || [0, 0, 0];
    const px = P.x ?? P[0], py = P.y ?? P[1], pz = P.z ?? P[2];
    this.pos[i * 3] = px; this.pos[i * 3 + 1] = py; this.pos[i * 3 + 2] = pz;
    this.vel[i * 3] = V.x ?? V[0]; this.vel[i * 3 + 1] = V.y ?? V[1]; this.vel[i * 3 + 2] = V.z ?? V[2];
    this.age[i] = 0; this.life[i] = Math.max(0.01, p.life ?? 0.4);
    const sz = Array.isArray(p.size) ? p.size : [p.size ?? 0.2, p.size ?? 0.2];
    this.s0[i] = sz[0]; this.s1[i] = sz[1];
    const col = Array.isArray(p.color) && (typeof p.color[0] !== 'number' || p.color.length === 2) ? p.color : [p.color, p.color];
    const k = p.intensity ?? 1;
    this._color(col[0], this.c0, i * 4, k);
    this._color(col[1] ?? col[0], this.c1, i * 4, k);
    if (p.alpha) { this.c0[i * 4 + 3] = p.alpha[0]; this.c1[i * 4 + 3] = p.alpha[1]; }
    else if (!Array.isArray(col[1])) this.c1[i * 4 + 3] = 0; // fade out by default
    this.grav[i] = p.gravity ?? 0; this.drag[i] = p.drag ?? 0;
    this.rot[i] = p.rot ?? 0; this.spin[i] = p.spin ?? 0;
    this.stretch[i] = p.stretch ?? 0; this.shape[i] = (SHAPES[p.shape] ?? (typeof p.shape === 'number' ? p.shape : 0)) + ((i * 0.618034) % 1) * 0.9;
    this.floorY[i] = p.floor ?? -1e9;
    this.fadeIn[i] = p.fadeIn ?? this.defaultFadeIn;
    this.delay[i] = p.delay ?? 0;
    return i;
  }

  _kill(i) {
    const j = --this.n;
    if (i === j) return;
    const c3 = (a) => { a[i * 3] = a[j * 3]; a[i * 3 + 1] = a[j * 3 + 1]; a[i * 3 + 2] = a[j * 3 + 2]; };
    const c4 = (a) => { a[i * 4] = a[j * 4]; a[i * 4 + 1] = a[j * 4 + 1]; a[i * 4 + 2] = a[j * 4 + 2]; a[i * 4 + 3] = a[j * 4 + 3]; };
    c3(this.pos); c3(this.vel); c4(this.c0); c4(this.c1);
    for (const a of [this.age, this.life, this.s0, this.s1, this.grav, this.drag, this.rot, this.spin, this.stretch, this.shape, this.floorY, this.fadeIn, this.delay]) a[i] = a[j];
  }

  update(dt) {
    if (dt > 0) {
      for (let i = 0; i < this.n; i++) {
        if (this.delay[i] > 0) { this.delay[i] -= dt; continue; }
        this.age[i] += dt;
        if (this.age[i] >= this.life[i]) { this._kill(i); i--; continue; }
        const d = this.drag[i] > 0 ? Math.exp(-this.drag[i] * dt) : 1;
        const o = i * 3;
        this.vel[o] *= d; this.vel[o + 1] = this.vel[o + 1] * d - this.grav[i] * dt; this.vel[o + 2] *= d;
        this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
        if (this.pos[o + 1] < this.floorY[i]) { this.pos[o + 1] = this.floorY[i]; this.vel[o + 1] *= -0.35; this.vel[o] *= 0.6; this.vel[o + 2] *= 0.6; }
        this.rot[i] += this.spin[i] * dt;
      }
    }
    const P = this.aPos.array, V = this.aVel.array, C = this.aCol.array, R = this.aPar.array;
    let m = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.delay[i] > 0) continue;
      const t = this.age[i] / this.life[i];
      const o3 = i * 3, o4 = i * 4, w3 = m * 3, w4 = m * 4;
      P[w3] = this.pos[o3]; P[w3 + 1] = this.pos[o3 + 1]; P[w3 + 2] = this.pos[o3 + 2];
      V[w3] = this.vel[o3]; V[w3 + 1] = this.vel[o3 + 1]; V[w3 + 2] = this.vel[o3 + 2];
      for (let c = 0; c < 4; c++) C[w4 + c] = this.c0[o4 + c] + (this.c1[o4 + c] - this.c0[o4 + c]) * t;
      if (this.fadeIn[i] > 0) C[w4 + 3] *= Math.min(1, this.age[i] / this.fadeIn[i]);
      R[w4] = this.s0[i] + (this.s1[i] - this.s0[i]) * t; R[w4 + 1] = this.stretch[i]; R[w4 + 2] = this.rot[i]; R[w4 + 3] = this.shape[i];
      m++;
    }
    this.geo.instanceCount = m;
    for (const a of [this.aPos, this.aVel, this.aCol, this.aPar]) { a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(1, m) * a.itemSize); a.needsUpdate = true; }
  }

  clear() { this.n = 0; this.geo.instanceCount = 0; }
  dispose() { this.geo.dispose(); this.material.dispose(); }
}
