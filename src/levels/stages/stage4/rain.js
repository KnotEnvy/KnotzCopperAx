// Stage 4 rain: GPU-only instanced fields that wrap around the camera focus (no per-particle CPU).
//   streaks — two layers: a dense far/mid curtain of thin wind-slanted streaks and a sparse near layer of long, soft,
//             out-of-focus streaks between camera and belt (depth). Each streak picks up the warm torch pools it falls
//             through (same s4Torch uniforms as the surfaces) and blazes on lightning.
//   splashes — ground/water impacts: a flattened ring + a small crown of droplets, re-seeded every cycle.
import * as THREE from 'three';
import { S4, MAX_TORCHES } from './shading.js';
import { WATER_Y, BERM_Z0, BERM_Z1, COURT_X } from './layout.js';

const TORCH_TINT = /* glsl */`
uniform vec4 s4Torch[${MAX_TORCHES}]; uniform vec3 s4TorchCol; uniform float s4Flash; uniform vec3 s4FlashCol;
vec3 torchAt(vec3 w) {
  vec3 c = vec3(0.0);
  for (int i = 0; i < ${MAX_TORCHES}; i++) { vec4 T = s4Torch[i]; if (T.w <= 0.0) continue; vec3 d = T.xyz - w; float d2 = dot(d, d);
    c += T.w * pow(clamp(1.0 - d2 / 60.0, 0.0, 1.0), 2.0) / (1.0 + d2 * 0.6); }
  return c * s4TorchCol;
}
`;

const STREAK_V = /* glsl */`
attribute vec4 aSeed;
uniform float uTime; uniform vec3 uCenter; uniform vec3 uBox; uniform vec3 uVel; uniform float uLen; uniform float uWidth;
uniform float uNear; uniform float uFar;
varying vec2 vUv; varying vec3 vCol; varying float vA;
${TORCH_TINT}
void main() {
  vec3 vel = uVel * (0.85 + aSeed.w * 0.3);
  vec3 p = aSeed.xyz * uBox + vel * uTime;
  vec3 mn = uCenter - uBox * 0.5;
  p = mn + mod(p - mn, uBox);
  vec3 dir = normalize(vel);
  vec3 toCam = normalize(cameraPosition - p);
  vec3 side = normalize(cross(dir, toCam));
  float len = uLen * (0.7 + aSeed.w * 0.6);
  vec3 w = p + dir * (position.y * len) + side * (position.x * uWidth);
  vUv = position.xy + vec2(0.0, 0.5);
  float dist = length(cameraPosition - p);
  vec3 rel = (p - mn) / uBox;
  float edge = smoothstep(0.0, 0.1, rel.x) * smoothstep(1.0, 0.9, rel.x) * smoothstep(0.0, 0.12, rel.z) * smoothstep(1.0, 0.88, rel.z);
  vA = edge * smoothstep(uNear * 0.6, uNear, dist) * (1.0 - smoothstep(uFar * 0.6, uFar, dist)) * (p.y > ${(WATER_Y - 0.2).toFixed(2)} ? 1.0 : 0.0);
  vCol = vec3(0.34, 0.4, 0.52) + torchAt(p) * 0.55 + s4FlashCol * s4Flash * 2.2;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`;
const STREAK_F = /* glsl */`
uniform float uOpacity;
varying vec2 vUv; varying vec3 vCol; varying float vA;
void main() {
  float across = 1.0 - abs(vUv.x) * 2.0;
  float along = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.8, vUv.y);
  float a = across * across * along * vA * uOpacity;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vCol * a, a);
}
`;

const SPLASH_V = /* glsl */`
attribute vec4 aSeed;
uniform float uTime; uniform vec3 uCenter; uniform vec2 uBox; uniform float uSize; uniform float uCourtX;
varying vec2 vUv; varying float vPh; varying vec3 vCol; varying float vA;
${TORCH_TINT}
float hh(float n) { return fract(sin(n * 91.345) * 47453.13); }
void main() {
  float period = 0.42 + aSeed.w * 0.3;
  float tt = uTime / period + aSeed.z * 7.0;
  float cyc = floor(tt); float ph = fract(tt);
  vec2 xz = vec2(hh(cyc * 1.37 + aSeed.x * 91.0), hh(cyc * 2.11 + aSeed.y * 57.0));
  vec3 p = vec3(uCenter.x + (xz.x - 0.5) * uBox.x, 0.0, uCenter.z + (xz.y - 0.5) * uBox.y);
  bool water = p.x < uCourtX && (p.z > ${BERM_Z1.toFixed(2)} || p.z < ${BERM_Z0.toFixed(2)});
  p.y = water ? ${WATER_Y.toFixed(3)} + 0.02 : 0.015;
  vec3 toCam = cameraPosition - p; toCam.y = 0.0; toCam = normalize(toCam);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  float s = uSize * (0.7 + aSeed.y * 0.6) * (water ? 1.3 : 1.0);
  vec3 w = p + right * position.x * s + vec3(0.0, 1.0, 0.0) * (position.y + 0.5) * s * 0.7;
  vUv = position.xy + 0.5; vPh = ph;
  float dist = length(cameraPosition - p);
  vA = (1.0 - smoothstep(26.0, 40.0, dist)) * smoothstep(3.0, 6.0, dist);
  vCol = vec3(0.4, 0.46, 0.58) + torchAt(p + vec3(0.0, 0.3, 0.0)) * 0.8 + s4FlashCol * s4Flash * 2.0;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`;
const SPLASH_F = /* glsl */`
uniform float uOpacity;
varying vec2 vUv; varying float vPh; varying vec3 vCol; varying float vA;
void main() {
  // ring on the ground (squashed ellipse at the bottom of the quad) + crown droplets rising and falling
  vec2 q = vec2((vUv.x - 0.5) * 2.0, (vUv.y - 0.06) * 7.0);
  float r = length(q);
  float rr = 0.15 + vPh * 0.8;
  float ring = exp(-pow((r - rr) * 9.0, 2.0)) * (1.0 - vPh);
  float crown = 0.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float ang = (fi - 2.0) * 0.38;
    float t = vPh * 1.6;
    vec2 dp = vec2(0.5 + sin(ang) * t * 0.45, 0.06 + (cos(ang) * t * 1.6 - t * t * 1.9) * 0.55);
    float d = length((vUv - dp) * vec2(1.0, 0.8));
    crown += smoothstep(0.05, 0.0, d) * step(vPh, 0.75);
  }
  float a = clamp(ring * 0.55 + crown * 0.8, 0.0, 1.0) * vA * uOpacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vCol * a, a);
}
`;

function field(count, vert, frag, uniforms, quad) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(quad), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  g.instanceCount = count;
  const m = new THREE.ShaderMaterial({
    vertexShader: vert, fragmentShader: frag,
    uniforms: { ...uniforms, s4Torch: S4.s4Torch, s4TorchCol: S4.s4TorchCol, s4Flash: S4.s4Flash, s4FlashCol: S4.s4FlashCol },
    transparent: true, depthWrite: false, blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return mesh;
}

export function createRain(ctx, { low = false } = {}) {
  const Q = [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0];
  const vel = new THREE.Vector3(-2.2, -17, 0.8);
  const mk = (count, box, len, width, opacity, near, far, zOff) => {
    const u = {
      uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(...box) }, uVel: { value: vel },
      uLen: { value: len }, uWidth: { value: width }, uOpacity: { value: opacity }, uNear: { value: near }, uFar: { value: far },
    };
    const m = field(count, STREAK_V, STREAK_F, u, Q);
    m.userData.zOff = zOff;
    return m;
  };
  const far = mk(low ? 2600 : 5200, [40, 16, 30], 0.62, 0.014, 0.5, 5, 46, -8);
  const near = mk(low ? 120 : 260, [18, 9, 5], 1.3, 0.045, 0.22, 2.5, 12, 7.5);
  const su = { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector2(34, 16) }, uSize: { value: 0.22 }, uOpacity: { value: 0.4 }, uCourtX: { value: COURT_X - 1.5 } };
  const splash = field(low ? 500 : 1100, SPLASH_V, SPLASH_F, su, Q);
  const group = new THREE.Group(); group.name = 's4_rain';
  group.add(far, near, splash);
  ctx.group.add(group);
  let t = 0;
  return {
    group,
    update(dt, focus) {
      t += dt;
      for (const m of [far, near]) {
        m.material.uniforms.uTime.value = t;
        m.material.uniforms.uCenter.value.set(focus.x, 6.5, focus.z + m.userData.zOff);
      }
      near.material.uniforms.uCenter.value.y = 3.2;
      su.uTime.value = t;
      su.uCenter.value.set(focus.x, 0, focus.z - 0.5);
    },
    setIntensity(k) { far.material.uniforms.uOpacity.value = 0.5 * k; near.material.uniforms.uOpacity.value = 0.22 * k; su.uOpacity.value = 0.9 * k; },
  };
}
