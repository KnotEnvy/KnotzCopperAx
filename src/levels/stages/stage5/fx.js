// Stage 5 pooled particle bursts (one draw; pattern from stage 4): dust, stone chips, witchfire flares (kind 1).

import * as THREE from 'three';
import { S5 } from './shading.js';

const V = /* glsl */`
attribute vec4 iA;   // size, alpha, kind (0 dust 1 water 2 chip), seed
attribute vec3 iC;
varying vec2 vUv; varying vec4 vA; varying vec3 vC;
void main() {
  vUv = uv; vA = iA; vC = iC;
  vec3 c = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 toCam = normalize(cameraPosition - c);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  vec3 up = cross(toCam, right);
  vec3 w = c + (right * position.x + up * position.y) * iA.x;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`;
const F = /* glsl */`
uniform float s5Pulse; uniform vec3 s5FireCol;
varying vec2 vUv; varying vec4 vA; varying vec3 vC;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
void main() {
  vec2 q = vUv - 0.5; float r = length(q) * 2.0;
  float a;
  if (vA.z < 0.5) a = smoothstep(1.0, 0.2, r) * (0.55 + 0.45 * n(vUv * 5.0 + vA.w * 10.0));
  else if (vA.z < 1.5) a = smoothstep(1.0, 0.5, r) * (0.6 + 0.4 * n(vUv * 7.0 + vA.w * 13.0));
  else a = step(r, 0.8);
  a *= vA.y;
  if (a < 0.004) discard;
  vec3 col = vC * (1.0 + s5Pulse * 3.0);
  gl_FragColor = vec4(col * a, a * (vA.z > 0.5 && vA.z < 1.5 ? 0.6 : 1.0));
}
`;

export function createBursts(group, max = 160) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const iA = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
  const iC = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  geo.setAttribute('iA', iA); geo.setAttribute('iC', iC);
  const mat = new THREE.ShaderMaterial({ vertexShader: V, fragmentShader: F, uniforms: { s5Pulse: S5.s5Pulse, s5FireCol: S5.s5FireCol },
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
  const im = new THREE.InstancedMesh(geo, mat, max);
  im.frustumCulled = false; im.renderOrder = 7; im.count = 0;
  group.add(im);
  const P = [];
  let seed = 777;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const m4 = new THREE.Matrix4();
  const add = (o) => { if (P.length < max) P.push(o); };
  return {
    dust(x, y, z, n = 10, spread = 1, col = [0.16, 0.15, 0.16]) {
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2, s = (0.6 + rnd()) * spread;
        add({ x: x + Math.cos(a) * 0.3 * spread, y: y + rnd() * 0.3, z: z + Math.sin(a) * 0.2 * spread, vx: Math.cos(a) * s * 1.6, vy: 0.5 + rnd() * 1.2, vz: Math.sin(a) * s * 0.9,
          life: 0, max: 1.2 + rnd() * 0.9, s0: 0.5 * spread, s1: 1.8 * spread, a: 0.55, kind: 0, drag: 2.2, g: -0.3, c: col, seed: rnd() });
      }
    },
    splash(x, y, z, k = 1) {
      for (let i = 0; i < 14 * k; i++) {
        const a = rnd() * Math.PI * 2, s = rnd();
        add({ x, y, z, vx: Math.cos(a) * s * 2.5, vy: 4 + rnd() * 5 * k, vz: Math.sin(a) * s * 1.6, life: 0, max: 0.9 + rnd() * 0.5, s0: 0.25, s1: 0.5, a: 0.7, kind: 1, drag: 0.4, g: -14, c: [0.3, 0.36, 0.46], seed: rnd() });
      }
      for (let i = 0; i < 5; i++) add({ x: x + (rnd() - 0.5), y: y + 0.2, z: z + (rnd() - 0.5) * 0.6, vx: 0, vy: 1.5 + rnd(), vz: 0, life: 0, max: 0.8, s0: 0.8, s1: 2.4 * k, a: 0.35, kind: 1, drag: 1.5, g: -2, c: [0.22, 0.26, 0.34], seed: rnd() });
    },
    chips(x, y, z, n = 8) {
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2;
        add({ x, y, z, vx: Math.cos(a) * (2 + rnd() * 3), vy: 2 + rnd() * 4, vz: Math.sin(a) * 2, life: 0, max: 0.9, s0: 0.07, s1: 0.05, a: 1, kind: 2, drag: 0.2, g: -16, c: [0.12, 0.12, 0.13], seed: rnd() });
      }
    },
    /** witchfire flare: green sparks + soft glow puffs (ring-out plunge, pits opening, statues waking) */
    flare(x, y, z, k = 1) {
      for (let i = 0; i < 12 * k; i++) {
        const a = rnd() * Math.PI * 2, s = rnd();
        add({ x, y, z, vx: Math.cos(a) * s * 2.2, vy: 2 + rnd() * 4 * k, vz: Math.sin(a) * s * 1.4, life: 0, max: 0.8 + rnd() * 0.6, s0: 0.12, s1: 0.04, a: 1, kind: 2, drag: 0.8, g: -3, c: [0.5, 2.4, 0.9], seed: rnd() });
      }
      for (let i = 0; i < 4; i++) add({ x: x + (rnd() - 0.5), y: y + 0.3, z: z + (rnd() - 0.5) * 0.6, vx: 0, vy: 1.2 + rnd(), vz: 0, life: 0, max: 1.0, s0: 0.8, s1: 2.6 * k, a: 0.3, kind: 1, drag: 1.5, g: 0, c: [0.08, 0.5, 0.2], seed: rnd() });
    },
    update(dt) {
      let k = 0;
      for (let i = P.length - 1; i >= 0; i--) {
        const p = P[i]; p.life += dt;
        if (p.life >= p.max) { P.splice(i, 1); continue; }
        const d = Math.exp(-p.drag * dt);
        p.vx *= d; p.vz *= d; p.vy = p.vy * d + p.g * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      }
      for (const p of P) {
        const t = p.life / p.max;
        m4.makeTranslation(p.x, p.y, p.z); im.setMatrixAt(k, m4);
        iA.setXYZW(k, p.s0 + (p.s1 - p.s0) * t, p.a * (1 - t) * Math.min(1, p.life * 12), p.kind, p.seed);
        iC.setXYZ(k, p.c[0], p.c[1], p.c[2]);
        k++;
      }
      im.count = k;
      im.instanceMatrix.needsUpdate = true; iA.needsUpdate = true; iC.needsUpdate = true;
    },
  };
}
