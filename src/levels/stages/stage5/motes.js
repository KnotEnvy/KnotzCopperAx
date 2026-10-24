// Stage 5 atmosphere: witchfire motes rising from the braziers and the abyss, plus slow drifting dust in the hall
// air. One instanced draw, animated entirely on the GPU (no per-frame CPU work).
import * as THREE from 'three';
import { S5 } from './shading.js';

const V = /* glsl */`
attribute vec4 iP;     // x, y0, z, seed
attribute vec2 iK;     // kind (0 dust, 1 witch mote), rise
uniform float s5Time;
varying float vA; varying float vK; varying vec2 vUv;
void main() {
  vUv = uv; vK = iK.x;
  float s = iP.w;
  float life = iK.x > 0.5 ? 4.0 + s * 3.0 : 18.0;
  float ph = fract(s5Time / life + s * 7.13);
  vec3 c = vec3(iP.x, iP.y, iP.z);
  c.y += ph * iK.y;
  c.x += sin(s5Time * 0.6 + s * 40.0) * 0.4 * ph + ph * 0.5;
  c.z += cos(s5Time * 0.5 + s * 23.0) * 0.3 * ph;
  vA = sin(ph * 3.14159) * (iK.x > 0.5 ? 1.0 : 0.35);
  float size = iK.x > 0.5 ? 0.045 + 0.03 * fract(s * 91.0) : 0.03;
  vec3 toCam = normalize(cameraPosition - c);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  vec3 up = cross(toCam, right);
  gl_Position = projectionMatrix * viewMatrix * vec4(c + (right * position.x + up * position.y) * size, 1.0);
}`;
const F = /* glsl */`
uniform float s5Pulse;
varying float vA; varying float vK; varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, r) * vA;
  if (a < 0.01) discard;
  vec3 col = vK > 0.5 ? vec3(0.4, 2.6, 0.9) * (1.0 + s5Pulse) : vec3(0.18, 0.22, 0.2);
  gl_FragColor = vec4(col * a, a);
}`;

export function createMotes(group, { sources = [], abyss = null, low = false } = {}) {
  const items = [];
  let seed = 4242;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const per = low ? 5 : 12;
  for (const s of sources) for (let i = 0; i < per; i++) items.push([s.x + (rnd() - 0.5) * 0.7, s.y, s.z + (rnd() - 0.5) * 0.5, rnd(), 1, 3 + rnd() * 3]);
  if (abyss) for (let i = 0; i < (low ? 40 : 110); i++) items.push([abyss.x0 + rnd() * (abyss.x1 - abyss.x0), -5 + rnd() * 2, abyss.z0 + rnd() * 5, rnd(), 1, 7 + rnd() * 4]);
  for (let i = 0; i < (low ? 60 : 160); i++) items.push([-10 + rnd() * 90, 0.3 + rnd() * 2, -7 + rnd() * 10, rnd(), 0, 3.5]);
  const geo = new THREE.PlaneGeometry(1, 1);
  const n = items.length;
  const iP = new Float32Array(n * 4), iK = new Float32Array(n * 2);
  items.forEach((it, i) => { iP.set(it.slice(0, 4), i * 4); iK.set(it.slice(4, 6), i * 2); });
  geo.setAttribute('iP', new THREE.InstancedBufferAttribute(iP, 4));
  geo.setAttribute('iK', new THREE.InstancedBufferAttribute(iK, 2));
  const mat = new THREE.ShaderMaterial({ vertexShader: V, fragmentShader: F, uniforms: { s5Time: S5.s5Time, s5Pulse: S5.s5Pulse },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const im = new THREE.InstancedMesh(geo, mat, n);
  im.frustumCulled = false; im.renderOrder = 6;
  group.add(im);
  return im;
}
