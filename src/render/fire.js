// Stylized fire, smoke and glow (shared by every stage: burning huts, torches, braziers, campfires, distant fires).
// Each kind is ONE instanced draw call, animated entirely on the GPU from the shared kTime/kWind/kNoise uniforms.
//
//   const fx = createFireKit();                        // collect emitters first…
//   fx.flame([x, y, z], { height, width, intensity, seed, speed, layers, heat, soot })  // 3-layer billboard flame (envelope,
//                                                    tongue, core; HDR, blooms) + heat-haze column + soot plume (off with false)
//   fx.smoke([x, y, z], { puffs, rise, spread, size: [s0, s1], life, drift, opacity, warm, dark, seed })  // rising column
//   fx.glow([x, y, z], { size, color, intensity, flicker })             // additive light-on-air halo
//   const obj = fx.build();  group.add(obj);           // …then build (returns a Group, or null when empty)
// Smoke is fogged with the game-wide fog and catches the sun inscatter colour on its edges.
import * as THREE from 'three';
import { shared, noiseTexture } from './shaderlib.js';

const FLAME_V = /* glsl */`
attribute vec4 iSeed;   // seed, intensity, speed, lean
varying vec2 vUv; varying vec4 vSeed;
uniform float kTime; uniform vec4 kWind;
void main() {
  vUv = uv; vSeed = iSeed;
  vec3 c = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float sx = length(instanceMatrix[0].xyz), sy = length(instanceMatrix[1].xyz);
  vec3 toCam = cameraPosition - c; toCam.y = 0.0; toCam = normalize(toCam + vec3(1e-4, 0.0, 0.0));
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  float h = uv.y;
  float sway = sin(kTime * 3.0 * iSeed.z + iSeed.x * 20.0) * 0.08 + kWind.z * 0.18 + iSeed.w;
  vec3 wp = c + right * position.x * sx + vec3(0.0, 1.0, 0.0) * position.y * sy + vec3(kWind.x, 0.0, kWind.y) * sway * h * h * sy;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const FLAME_F = /* glsl */`
uniform sampler2D kNoise; uniform float kTime;
uniform vec3 cRed; uniform vec3 cOrange; uniform vec3 cYellow; uniform vec3 cCore;
varying vec2 vUv; varying vec4 vSeed;
void main() {
  float sp = vSeed.z;
  float n1 = texture2D(kNoise, vec2(vUv.x * 0.7 + vSeed.x, vUv.y * 0.45 - kTime * 0.75 * sp)).r;
  float n2 = texture2D(kNoise, vec2(vUv.x * 1.6 + vSeed.x * 1.7, vUv.y * 0.9 - kTime * 1.5 * sp)).g;
  float x = (vUv.x - 0.5) * 2.0, y = vUv.y;
  float distort = (n1 - 0.5) * 1.1 * y + (n2 - 0.5) * 0.45 * y;
  float w = mix(0.9, 0.06, pow(y, 0.75));
  float d = abs(x + distort) / w;
  float body = (1.0 - smoothstep(0.35, 1.0, d)) * smoothstep(0.0, 0.1, y);
  float heat = body * (0.45 + n1 * 0.5 + n2 * 0.35) - y * 0.55;
  float a = smoothstep(0.02, 0.28, heat);
  vec3 col = mix(cRed, cOrange, smoothstep(0.05, 0.35, heat));
  col = mix(col, cYellow, smoothstep(0.3, 0.6, heat));
  col = mix(col, cCore, smoothstep(0.6, 0.95, heat));
  float I = vSeed.y * (0.85 + 0.3 * sin(kTime * 11.0 * sp + vSeed.x * 40.0));
  vec3 o = col * I * a;
  gl_FragColor = vec4(min(o, vec3(40.0)), a);
}`;

// Heat haze above flames: faint rising streaks of warm light that waver (reads as shimmering hot air).
const HEAT_F = /* glsl */`
uniform sampler2D kNoise; uniform float kTime; uniform vec3 cHeat;
varying vec2 vUv; varying vec4 vSeed;
void main() {
  float x = (vUv.x - 0.5) * 2.0, y = vUv.y;
  float wob = (texture2D(kNoise, vec2(y * 0.6 + vSeed.x, kTime * 0.35 + vSeed.x)).r - 0.5) * 0.5 * y;
  float st = texture2D(kNoise, vec2((x + wob) * 0.9 + vSeed.x * 3.0, y * 0.35 - kTime * 0.9)).b;
  float env = (1.0 - smoothstep(0.2, 1.0, abs(x + wob))) * smoothstep(0.0, 0.25, y) * (1.0 - smoothstep(0.45, 1.0, y));
  float a = env * smoothstep(0.45, 0.8, st) * vSeed.y;
  gl_FragColor = vec4(cHeat * a * 0.22, a * 0.22);
}`;

const SMOKE_V = /* glsl */`
#include <common>
#include <fog_pars_vertex>
attribute vec4 iA;   // phase, life, rise, spread
attribute vec4 iB;   // size0, size1, drift, opacity
attribute vec4 iC;   // warm, dark, seed, unused
uniform float kTime; uniform vec4 kWind; uniform sampler2D kNoise;
varying vec2 vUv; varying float vAge; varying float vAlpha; varying vec4 vC; varying float vRot;
void main() {
  vUv = uv; vC = iC;
  float age = fract(kTime / iA.y + iA.x);
  vAge = age;
  vec3 base = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float s = iC.z;
  vec2 wob = vec2(sin(age * 6.0 + s * 13.0), cos(age * 5.0 + s * 7.0)) * iA.w * age;
  vec3 c = base + vec3(kWind.x * iB.z * age * age * iA.z + wob.x, age * iA.z, kWind.y * iB.z * age * iA.z * 0.5 + wob.y);
  float size = mix(iB.x, iB.y, sqrt(age));
  vRot = s * 6.28 + age * (s - 0.5) * 3.0;
  vec4 mv = viewMatrix * vec4(c, 1.0);
  mv.xy += position.xy * size;
  vAlpha = smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.55, 1.0, age)) * iB.w;
  gl_Position = projectionMatrix * mv;
  vec4 mvPosition = mv;
  #include <fog_vertex>
}`;

const SMOKE_F = /* glsl */`
#include <common>
#include <fog_pars_fragment>
uniform sampler2D kNoise; uniform float kTime;
uniform vec3 cWarm; uniform vec3 cCool; uniform vec3 cDark;
varying vec2 vUv; varying float vAge; varying float vAlpha; varying vec4 vC; varying float vRot;
void main() {
  vec2 p = vUv - 0.5;
  float cs = cos(vRot), sn = sin(vRot);
  vec2 q = vec2(p.x * cs - p.y * sn, p.x * sn + p.y * cs);
  float n = texture2D(kNoise, q * 0.9 + vC.z * 3.1 + vec2(0.0, -vAge * 0.4)).r;
  float n2 = texture2D(kNoise, q * 2.3 + vC.z * 5.7).g;
  float r = length(p) * 2.0;
  float m = 1.0 - smoothstep(0.25, 1.0, r + (n - 0.5) * 0.7 + (n2 - 0.5) * 0.25);
  float a = m * vAlpha;
  if (a < 0.003) discard;
  vec3 cool = mix(cCool, cDark, vC.y);
  vec3 col = mix(cWarm * vC.x * 3.0 + cool * 0.5, cool, smoothstep(0.0, 0.45, vAge));
  col *= 0.7 + 0.5 * (0.5 - p.y) + (n2 - 0.5) * 0.3;
  #ifdef USE_FOG
    vec3 vd = normalize(vFogWorld - cameraPosition);
    float sunF = pow(max(dot(vd, kFogB.xyz), 0.0), 5.0) * kFogC.w;
    col += kFogC.rgb * sunF * (0.35 + smoothstep(0.3, 0.95, r) * 1.2) * 0.8;
  #endif
  gl_FragColor = vec4(max(col, vec3(0.0)), clamp(a, 0.0, 1.0));
  #include <fog_fragment>
}`;

const GLOW_V = /* glsl */`
attribute vec4 iG;   // r, g, b, flicker
varying vec2 vUv; varying vec3 vCol;
uniform float kTime;
void main() {
  vUv = uv;
  float s = length(instanceMatrix[0].xyz);
  vec3 c = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float f = 1.0 - iG.w * (0.5 + 0.5 * sin(kTime * 7.0 + c.x * 3.0) * sin(kTime * 4.3 + c.z));
  vCol = iG.rgb * f;
  vec4 mv = viewMatrix * vec4(c, 1.0);
  mv.xy += position.xy * s;
  gl_Position = projectionMatrix * mv;
}`;
const GLOW_F = /* glsl */`
varying vec2 vUv; varying vec3 vCol;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float g = pow(max(1.0 - r, 0.0), 2.2);
  gl_FragColor = vec4(min(vCol * g, vec3(20.0)), g);
}`;

const SPARK_V = /* glsl */`
attribute vec4 aA;   // phase, life, rise, spread
attribute vec4 aB;   // seed, size, unused, unused
uniform float kTime; uniform vec4 kWind; uniform float uPx;
varying float vA; varying float vS;
void main() {
  float age = fract(kTime / aA.y + aA.x);
  float s = aB.x;
  vec3 dir = vec3(sin(s * 91.0), 0.0, cos(s * 57.0)) * aA.w;
  vec3 p = position + vec3(0.0, aA.z * (age + age * age * 0.5), 0.0) + dir * age
         + vec3(kWind.x, 0.0, kWind.y) * kWind.z * age * age * 3.0
         + vec3(sin(age * 9.0 + s * 30.0), 0.0, cos(age * 7.0 + s * 20.0)) * 0.25 * age;
  vA = (1.0 - age) * smoothstep(0.0, 0.05, age);
  vS = s;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aB.y * uPx / max(-mv.z, 0.5) * (0.4 + vA * 0.8);
}`;
const SPARK_F = /* glsl */`
uniform float kTime;
varying float vA; varying float vS;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = pow(max(1.0 - r, 0.0), 2.0) * vA * (0.6 + 0.4 * sin(kTime * 20.0 + vS * 80.0));
  vec3 c = mix(vec3(1.0, 0.25, 0.04), vec3(1.0, 0.8, 0.4), vA) * 7.0;
  gl_FragColor = vec4(c * a, a);
}`;

export function createFireKit({ colors = {}, quality = null, fog = true } = {}) {
  noiseTexture();
  const flames = [], smokes = [], glows = [], sparks = [], heats = [], heatAt = [];
  const lowQ = quality && quality.name === 'low';
  let rs = 12345;
  const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
  let seedN = 0;
  const nextSeed = () => ((seedN++ * 0.6180339887) % 1);
  return {
    flame(pos, o = {}) {
      const h = o.height ?? 1.2, w = o.width ?? h * 0.55, I = o.intensity ?? 4, seed = o.seed ?? nextSeed(), sp = o.speed ?? 1, lean = o.lean ?? 0;
      const at = (dx, dy, dz) => [pos[0] + dx, pos[1] + dy, pos[2] + dz];
      // three interfering layers instead of one card: a wide dim red envelope behind, the tongue, a hot narrow core
      // in front (different seeds/speeds → the silhouette breaks up and the fire reads as a volume, not a sprite)
      if (o.layers !== false) flames.push({ pos: at(-w * 0.08, -h * 0.02, -0.06), h: h * 0.88, w: w * 1.45, I: I * 0.32, seed: (seed + 0.37) % 1, sp: sp * 0.7, lean });
      flames.push({ pos, h, w, I, seed, sp, lean });
      if (o.layers !== false) flames.push({ pos: at(w * 0.05, 0, 0.06), h: h * 0.52, w: w * 0.5, I: I * 1.35, seed: (seed + 0.71) % 1, sp: sp * 1.35, lean });
      // heat haze column above the tongue (faint additive shimmer) + a dark soot plume that catches the firelight
      // perf-1650 r3: clustered flames (a burning roof = 6–12 tongues) share their neighbours' heat column / soot plume —
      // one per ~1.3 flame widths (S1: heat + soot were 5.5 of the ≥ 9-layer hot spots' layers)
      const near = (list, p0, r) => list.some((q) => { const dx = q[0] - p0[0], dy = q[1] - p0[1], dz = q[2] - p0[2]; return dx * dx + dy * dy + dz * dz < r * r; });
      const hp = at(0, h * 0.55, 0.02), crowded = near(heatAt, hp, w * 1.3);
      if (!crowded) heatAt.push(hp);
      if (o.heat !== false && !lowQ && !crowded) heats.push({ pos: at(0, h * 0.55, 0.02), h: h * 2.2, w: w * 1.7, I: Math.min(1, I / 5) * (o.heatIntensity ?? 1), seed });
      if (o.soot !== false && !lowQ && h > 0.5 && !crowded) this.smoke(at(0, h * 0.75, -0.02), { puffs: o.sootPuffs ?? 3, rise: h * 3.2, spread: w * 0.9, size: [w * 0.5, w * 2.6], life: 2.4 + h * 0.4,   // perf-1650 r3: 5 → 3 puffs (S1 od p95)
        drift: 0.7, opacity: o.sootOpacity ?? 0.56, warm: 0.85, dark: 0.85, base: w * 0.15, seed: (seed + 0.53) % 1 });
    },
    smoke(pos, o = {}) {
      const n = o.puffs ?? 14;
      const seed = o.seed ?? nextSeed();
      for (let i = 0; i < n; i++) {
        smokes.push({ pos: [pos[0] + (Math.sin(i * 12.9 + seed * 40) * (o.base ?? 0.3)), pos[1], pos[2] + Math.cos(i * 7.3 + seed * 17) * (o.base ?? 0.3)],
          phase: (i / n + seed) % 1, life: o.life ?? 6, rise: o.rise ?? 7, spread: o.spread ?? 1.2, s0: (o.size || [0.8, 3])[0], s1: (o.size || [0.8, 3])[1],
          drift: o.drift ?? 0.6, opacity: o.opacity ?? 0.55, warm: o.warm ?? 0.6, dark: o.dark ?? 0.4, seed: (seed * 7.1 + i * 0.137) % 1 });
      }
    },
    glow(pos, o = {}) { const c = new THREE.Color(o.color || '#ff7a2a').multiplyScalar(o.intensity ?? 1.2); glows.push({ pos, s: o.size ?? 3, c, f: o.flicker ?? 0.25 }); },
    /** Rising ember sparks from a source: { count, life, rise, spread, size, radius } */
    sparks(pos, o = {}) {
      const n = Math.round((o.count ?? 20) * (lowQ ? 0.5 : 1));
      for (let i = 0; i < n; i++) sparks.push({ pos: [pos[0] + (rnd() - 0.5) * (o.radius ?? 1), pos[1], pos[2] + (rnd() - 0.5) * (o.radius ?? 1) * 0.6], phase: rnd(), life: (o.life ?? 2.6) * (0.6 + rnd() * 0.8), rise: o.rise ?? 2.2, spread: o.spread ?? 1.2, seed: rnd(), size: (o.size ?? 0.07) * (0.6 + rnd() * 0.8) });
    },
    counts: () => ({ flames: flames.length, smoke: smokes.length, glows: glows.length, sparks: sparks.length, heat: heats.length }),
    build() {
      if (!flames.length && !smokes.length && !glows.length && !sparks.length) return null;
      const g = new THREE.Group(); g.name = 'fireKit';
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
      if (sparks.length) {
        const geo = new THREE.BufferGeometry();
        const P = new Float32Array(sparks.length * 3), A = new Float32Array(sparks.length * 4), B = new Float32Array(sparks.length * 4);
        sparks.forEach((o, i) => { P.set(o.pos, i * 3); A.set([o.phase, o.life, o.rise, o.spread], i * 4); B.set([o.seed, o.size, 0, 0], i * 4); });
        geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
        geo.setAttribute('aA', new THREE.BufferAttribute(A, 4));
        geo.setAttribute('aB', new THREE.BufferAttribute(B, 4));
        const mat = new THREE.ShaderMaterial({ vertexShader: SPARK_V, fragmentShader: SPARK_F, uniforms: { kTime: shared.uTime, kWind: shared.uWind, uPx: { value: 900 } },
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false });
        const pts = new THREE.Points(geo, mat);
        pts.frustumCulled = false; pts.renderOrder = 6; pts.name = 'sparks';
        pts.onBeforeRender = (r, sc, cam) => { mat.uniforms.uPx.value = r.domElement.height / (2 * Math.tan((cam.fov * Math.PI) / 360)); };
        g.add(pts);
      }
      if (glows.length) {
        const geo = new THREE.PlaneGeometry(1, 1);
        const a = new Float32Array(glows.length * 4);
        const mat = new THREE.ShaderMaterial({ vertexShader: GLOW_V, fragmentShader: GLOW_F, uniforms: { kTime: shared.uTime },
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false });
        const im = new THREE.InstancedMesh(geo, mat, glows.length);
        glows.forEach((o, i) => { m4.compose(p.fromArray(o.pos), q, s.setScalar(o.s)); im.setMatrixAt(i, m4); a.set([o.c.r, o.c.g, o.c.b, o.f], i * 4); });
        geo.setAttribute('iG', new THREE.InstancedBufferAttribute(a, 4));
        im.frustumCulled = false; im.renderOrder = 5; im.name = 'fireGlow';
        g.add(im);
      }
      if (smokes.length) {
        const geo = new THREE.PlaneGeometry(1, 1);
        const A = new Float32Array(smokes.length * 4), B = new Float32Array(smokes.length * 4), C = new Float32Array(smokes.length * 4);
        const mat = new THREE.ShaderMaterial({
          vertexShader: SMOKE_V, fragmentShader: SMOKE_F,
          uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
            cWarm: { value: new THREE.Color(colors.smokeWarm || '#ff7a3a') }, cCool: { value: new THREE.Color(colors.smokeCool || '#6a5a66') },
            cDark: { value: new THREE.Color(colors.smokeDark || '#1e1a1e') },
          }]),
          transparent: true, depthWrite: false, fog,
        });
        mat.uniforms.kTime = shared.uTime; mat.uniforms.kWind = shared.uWind; mat.uniforms.kNoise = shared.uNoise;
        const im = new THREE.InstancedMesh(geo, mat, smokes.length);
        smokes.forEach((o, i) => {
          m4.makeTranslation(o.pos[0], o.pos[1], o.pos[2]); im.setMatrixAt(i, m4);
          A.set([o.phase, o.life, o.rise, o.spread], i * 4); B.set([o.s0, o.s1, o.drift, o.opacity], i * 4); C.set([o.warm, o.dark, o.seed, 0], i * 4);
        });
        geo.setAttribute('iA', new THREE.InstancedBufferAttribute(A, 4));
        geo.setAttribute('iB', new THREE.InstancedBufferAttribute(B, 4));
        geo.setAttribute('iC', new THREE.InstancedBufferAttribute(C, 4));
        im.frustumCulled = false; im.renderOrder = 3; im.name = 'smoke';
        g.add(im);
      }
      if (heats.length) {
        const geo = new THREE.PlaneGeometry(1, 1, 1, 4); geo.translate(0, 0.5, 0);
        const a = new Float32Array(heats.length * 4);
        const mat = new THREE.ShaderMaterial({ vertexShader: FLAME_V, fragmentShader: HEAT_F,
          uniforms: { kTime: shared.uTime, kWind: shared.uWind, kNoise: shared.uNoise, cHeat: { value: new THREE.Color(colors.heat || '#ff7a3a') } },
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false });
        const im = new THREE.InstancedMesh(geo, mat, heats.length);
        heats.forEach((o, i) => { m4.compose(p.fromArray(o.pos), q, s.set(o.w, o.h, 1)); im.setMatrixAt(i, m4); a.set([o.seed, o.I, 1, 0], i * 4); });
        geo.setAttribute('iSeed', new THREE.InstancedBufferAttribute(a, 4));
        im.frustumCulled = false; im.renderOrder = 4; im.name = 'fireHeat';
        g.add(im);
      }
      if (flames.length) {
        const geo = new THREE.PlaneGeometry(1, 1, 1, 6); geo.translate(0, 0.5, 0);
        const a = new Float32Array(flames.length * 4);
        const mat = new THREE.ShaderMaterial({
          vertexShader: FLAME_V, fragmentShader: FLAME_F,
          uniforms: {
            kTime: shared.uTime, kWind: shared.uWind, kNoise: shared.uNoise,
            cRed: { value: new THREE.Color(colors.red || '#c01a08') }, cOrange: { value: new THREE.Color(colors.orange || '#ff5a10') },
            cYellow: { value: new THREE.Color(colors.yellow || '#ffb030') }, cCore: { value: new THREE.Color(colors.core || '#fff0c0') },
          },
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false,
        });
        const im = new THREE.InstancedMesh(geo, mat, flames.length);
        flames.forEach((o, i) => { m4.compose(p.fromArray(o.pos), q, s.set(o.w, o.h, 1)); im.setMatrixAt(i, m4); a.set([o.seed, o.I, o.sp, o.lean], i * 4); });
        geo.setAttribute('iSeed', new THREE.InstancedBufferAttribute(a, 4));
        im.frustumCulled = false; im.renderOrder = 4; im.name = 'flames';
        g.add(im);
      }
      return g;
    },
  };
}
