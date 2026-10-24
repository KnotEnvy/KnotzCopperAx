// Crows: circling flocks and a few perched birds. One instanced draw call; flight paths, banking and wing flaps
// (with glide pauses) are computed in the vertex shader from the shared clock.
import * as THREE from 'three';
import { shared } from '../../../render/shaderlib.js';

const V = /* glsl */`
#include <common>
#include <fog_pars_vertex>
attribute float aWing;           // 0 body, 0..1 wing span weight
attribute vec4 iP;               // centre xyz, radius
attribute vec4 iQ;               // angular speed, phase, scale, perched
uniform float kTime;
varying float vShade;
void main() {
  vec3 p = position;
  float perched = iQ.w;
  float t = kTime * iQ.x + iQ.y;
  float glide = smoothstep(0.2, 0.8, sin(kTime * 0.35 + iQ.y * 3.0) * 0.5 + 0.5);
  float flap = perched > 0.5 ? -0.9 : sin(kTime * 11.0 + iQ.y * 7.0) * mix(0.9, 0.12, glide);
  if (aWing > 0.0) {
    float s = sign(p.z), az = abs(p.z);
    float a = flap * (0.5 + 0.5 * aWing) + (perched > 0.5 ? 0.0 : 0.15);
    if (perched > 0.5) az *= 0.35;
    p.y += az * sin(a);
    p.z = s * az * cos(a);
  }
  vec3 pos, vel;
  if (perched > 0.5) {
    pos = iP.xyz; vel = vec3(cos(iQ.y), 0.0, sin(iQ.y) * 0.3);
    p.y += sin(kTime * 1.3 + iQ.y * 5.0) * 0.01;
  } else {
    float R = iP.w;
    pos = iP.xyz + vec3(R * cos(t), sin(t * 2.0 + iQ.y) * 0.9, R * 0.35 * sin(t));
    vel = vec3(-R * sin(t), cos(t * 2.0 + iQ.y) * 1.8, R * 0.35 * cos(t)) * sign(iQ.x);
  }
  vec3 fwd = normalize(vel + vec3(1e-4));
  vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, fwd);
  float bank = perched > 0.5 ? 0.0 : -0.5 * sign(iQ.x);
  vec3 r2 = normalize(right * cos(bank) + up * sin(bank));
  vec3 u2 = cross(r2, fwd);
  vec3 wp = pos + (fwd * p.x + u2 * p.y + r2 * p.z) * iQ.z;
  vShade = aWing;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const F = /* glsl */`
#include <common>
#include <fog_pars_fragment>
uniform vec3 uColor;
varying float vShade;
void main() {
  vec3 col = uColor * (1.0 - vShade * 0.25);
  #ifdef USE_FOG
    vec3 vd = normalize(vFogWorld - cameraPosition);
    col += kFogC.rgb * pow(max(dot(vd, kFogB.xyz), 0.0), 10.0) * 0.12 * kFogC.w;
  #endif
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}`;

function crowGeometry() {
  const pos = [], wing = [];
  const tri = (a, b, c, w = [0, 0, 0]) => { pos.push(...a, ...b, ...c); wing.push(...w); };
  const N = [0.24, 0.0, 0], T = [-0.2, 0.01, 0], U = [0.02, 0.07, 0], D = [0.0, -0.05, 0], L = [0.02, 0.0, -0.065], R = [0.02, 0.0, 0.065];
  for (const [a, b] of [[U, L], [L, D], [D, R], [R, U]]) { tri(N, a, b); tri(T, b, a); }
  // tail fan
  tri([-0.18, 0.01, 0], [-0.36, 0.0, -0.08], [-0.36, 0.0, 0.08]);
  // beak
  tri([0.24, 0.0, 0], [0.31, -0.012, 0.0], [0.24, -0.02, 0.012]);
  for (const s of [-1, 1]) {
    const sh0 = [0.07, 0.02, 0.05 * s], sh1 = [-0.08, 0.02, 0.05 * s];
    const m0 = [0.05, 0.02, 0.26 * s], m1 = [-0.12, 0.02, 0.24 * s];
    const t0 = [-0.02, 0.02, 0.46 * s], t1 = [-0.16, 0.02, 0.38 * s];
    tri(sh0, m0, sh1, [0, 0.5, 0]); tri(sh1, m0, m1, [0, 0.5, 0.5]);
    tri(m0, t0, m1, [0.5, 1, 0.5]); tri(m1, t0, t1, [0.5, 1, 1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
  return g;
}

/** flocks: [{ x, y, z, r, n, speed }], perches: [[x, y, z, yaw]] */
export function buildCrows(ctx, flocks, perches) {
  const list = [];
  let k = 0;
  for (const f of flocks) for (let i = 0; i < f.n; i++, k++) {
    const ph = k * 2.399;
    list.push([f.x + Math.sin(ph) * 3, f.y + Math.cos(ph * 1.3) * 1.2, f.z + Math.cos(ph) * 2, f.r * (0.7 + (i % 3) * 0.15), (f.speed ?? 0.35) * (i % 2 ? 1 : 1.12), ph, 1.0 + (i % 3) * 0.1, 0]);
  }
  for (const [x, y, z, yaw] of perches) list.push([x, y, z, 0, 0, yaw, 1.05, 1]);
  const geo = crowGeometry();
  const iP = new Float32Array(list.length * 4), iQ = new Float32Array(list.length * 4);
  list.forEach((c, i) => { iP.set(c.slice(0, 4), i * 4); iQ.set(c.slice(4, 8), i * 4); });
  const ig = new THREE.InstancedBufferGeometry();
  ig.index = null;
  ig.setAttribute('position', geo.getAttribute('position'));
  ig.setAttribute('aWing', geo.getAttribute('aWing'));
  ig.setAttribute('iP', new THREE.InstancedBufferAttribute(iP, 4));
  ig.setAttribute('iQ', new THREE.InstancedBufferAttribute(iQ, 4));
  ig.instanceCount = list.length;
  const mat = new THREE.ShaderMaterial({
    vertexShader: V, fragmentShader: F,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: new THREE.Color('#0e0c10') } }]),
    fog: true, side: THREE.DoubleSide,
  });
  mat.uniforms.kTime = shared.uTime;
  const m = new THREE.Mesh(ig, mat);
  m.frustumCulled = false; m.name = 'crows';
  ctx.group.add(m);
  return m;
}
