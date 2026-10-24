// Cheap volumetric-looking light shafts: long additive ribbons aligned with the light direction, billboarded around
// their own axis, with soft edges, end fades, slow noise "dust" drift and a distance/fog fade. One draw call.
//
//   const s = createShafts([{ pos: [x, y, z], length, width, intensity }...], { dir: [x, y, z] (light TRAVEL dir),
//                          color, intensity, quality });  group.add(s)
import * as THREE from 'three';
import { shared, noiseTexture } from './shaderlib.js';

const V = /* glsl */`
attribute vec4 iS;   // length, width, intensity, seed
uniform vec3 uDir;
varying vec2 vUv; varying vec4 vS; varying float vDist;
void main() {
  vUv = uv; vS = iS;
  vec3 c = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 axis = normalize(uDir);
  vec3 toCam = normalize(cameraPosition - c);
  vec3 side = normalize(cross(axis, toCam) + vec3(1e-4));
  vec3 wp = c + axis * (position.y * iS.x) + side * (position.x * iS.y);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const F = /* glsl */`
uniform sampler2D kNoise; uniform float kTime; uniform vec3 uColor; uniform float uFade;
varying vec2 vUv; varying vec4 vS; varying float vDist;
void main() {
  float x = vUv.x * 2.0 - 1.0;
  float y = vUv.y;
  float n = texture2D(kNoise, vec2(vUv.x * 0.6 + vS.w, y * 0.25 - kTime * 0.01)).r;
  float n2 = texture2D(kNoise, vec2(vUv.x * 1.7 + kTime * 0.02 + vS.w * 3.0, y * 0.8)).g;
  float across = pow(max(1.0 - x * x, 0.0), 1.6) * (0.55 + 0.75 * n2);
  float along = (1.0 - smoothstep(0.7, 1.0, y)) * smoothstep(0.0, 0.45, y);
  float a = across * along * (0.6 + 0.8 * n) * vS.z;
  a *= smoothstep(2.0, 7.0, vDist) * exp(-vDist * uFade);
  gl_FragColor = vec4(uColor * a, a);
}`;

export function createShafts(list, o = {}) {
  if (!list || !list.length || (o.quality && o.quality.name === 'low' && o.lowQuality === false)) return null;
  noiseTexture();
  const geo = new THREE.PlaneGeometry(1, 1, 1, 1); geo.translate(0, -0.5, 0); // y: 0 at the source end → -1 downstream
  // Flip so uv.y = 1 at the source and the ribbon extends along +dir.
  geo.scale(1, -1, 1);
  const a = new Float32Array(list.length * 4);
  const mat = new THREE.ShaderMaterial({
    vertexShader: V, fragmentShader: F,
    uniforms: { kTime: shared.uTime, kNoise: shared.uNoise, uDir: { value: new THREE.Vector3(...(o.dir || [0.5, -0.8, 0.3])).normalize() },
      uColor: { value: new THREE.Color(o.color || '#ffb070').multiplyScalar(o.intensity ?? 0.35) }, uFade: { value: o.fade ?? 0.012 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false,
  });
  const im = new THREE.InstancedMesh(geo, mat, list.length);
  const m4 = new THREE.Matrix4();
  list.forEach((s, i) => { m4.makeTranslation(s.pos[0], s.pos[1], s.pos[2]); im.setMatrixAt(i, m4); a.set([s.length ?? 14, s.width ?? 1.5, s.intensity ?? 1, s.seed ?? i * 0.618], i * 4); });
  geo.setAttribute('iS', new THREE.InstancedBufferAttribute(a, 4));
  im.frustumCulled = false; im.renderOrder = 7; im.name = 'lightShafts';
  return im;
}
