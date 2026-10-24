// Ambient particle fields that wrap around the camera (drifting embers, falling ash, dust motes, rain, snow).
// One Points draw call per field; motion is analytic in the vertex shader (no CPU cost per particle).
//
//   const f = createAmbient({ kind: 'ember'|'ash'|'dust', count, box: [w, h, d], offset: [x, y, z], color, size,
//                             velocity: [x, y, z], turbulence, intensity, quality });
//   group.add(f.object);  each frame: f.update(camera, focus)   // re-centres the wrap box on the camera focus
import * as THREE from 'three';
import { shared, noiseTexture } from './shaderlib.js';

const V = /* glsl */`
#include <common>
#include <fog_pars_vertex>
attribute vec4 aSeed;
uniform float kTime; uniform vec4 kWind;
uniform vec3 uBoxMin; uniform vec3 uBoxSize; uniform vec3 uVel; uniform float uTurb; uniform float uSize; uniform float uPx;
varying float vFlick; varying float vFade; varying float vSeed;
void main() {
  vSeed = aSeed.w;
  vec3 p = position * uBoxSize;
  float t = kTime * (0.7 + aSeed.x * 0.6);
  p += (uVel + vec3(kWind.x, 0.0, kWind.y) * kWind.z * 1.5) * t;
  p += vec3(sin(t * 1.3 + aSeed.y * 30.0), sin(t * 1.7 + aSeed.z * 20.0) * 0.6, cos(t * 1.1 + aSeed.x * 25.0)) * uTurb;
  p = uBoxMin + mod(p - uBoxMin, uBoxSize);
  vec3 rel = (p - uBoxMin) / uBoxSize;
  vFade = smoothstep(0.0, 0.08, rel.x) * smoothstep(1.0, 0.92, rel.x) * smoothstep(0.0, 0.1, rel.y) * smoothstep(1.0, 0.85, rel.y) * smoothstep(0.0, 0.1, rel.z) * smoothstep(1.0, 0.9, rel.z);
  vFlick = 0.5 + 0.5 * sin(kTime * (4.0 + aSeed.y * 9.0) + aSeed.z * 50.0);
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = uSize * (0.5 + aSeed.x) * uPx / max(-mvPosition.z, 0.5);
  #include <fog_vertex>
}`;

const F = /* glsl */`
#include <common>
#include <fog_pars_fragment>
uniform vec3 uColor; uniform vec3 uColor2; uniform float uIntensity; uniform float uKind;
varying float vFlick; varying float vFade; varying float vSeed;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  float a;
  vec3 col;
  if (uKind < 0.5) {            // ember: hot core, soft halo, flicker
    a = pow(max(1.0 - r, 0.0), 2.5);
    col = mix(uColor2, uColor, smoothstep(0.0, 0.6, r)) * uIntensity * (0.35 + vFlick * 0.9);
    gl_FragColor = vec4(col * a * vFade, a * vFade);
  } else {                      // ash / dust: tumbling flake (brightness flicker = rotation)
    float flake = 1.0 - smoothstep(0.55, 1.0, r * (1.0 + 0.6 * abs(c.x * c.y) * 8.0));
    a = flake * vFade * (0.35 + 0.65 * vFlick);
    col = mix(uColor2, uColor, vFlick) * uIntensity;
    gl_FragColor = vec4(col, a);
    #include <fog_fragment>
  }
}`;

const KIND = {
  ember: { color: '#ff7a2a', color2: '#fff0b0', size: 0.09, intensity: 5, velocity: [0.6, 0.9, 0], turb: 0.35, additive: true },
  ash: { color: '#b0a8a8', color2: '#5a5256', size: 0.07, intensity: 0.9, velocity: [0.5, -0.35, 0], turb: 0.5, additive: false },
  dust: { color: '#e0c8a0', color2: '#8a7a6a', size: 0.035, intensity: 1.2, velocity: [0.15, 0.02, 0], turb: 0.25, additive: false },
};

export function createAmbient(o = {}) {
  noiseTexture();
  const k = KIND[o.kind || 'ember'];
  const low = o.quality && o.quality.name === 'low';
  const count = Math.max(8, Math.round((o.count ?? 400) * (low ? 0.5 : 1)));
  const pos = new Float32Array(count * 3), seed = new Float32Array(count * 4);
  let s = (o.seed ?? 7) * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < count; i++) { pos.set([rnd(), rnd(), rnd()], i * 3); seed.set([rnd(), rnd(), rnd(), rnd()], i * 4); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const box = o.box || [30, 10, 16];
  const mat = new THREE.ShaderMaterial({
    vertexShader: V, fragmentShader: F,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uBoxMin: { value: new THREE.Vector3() }, uBoxSize: { value: new THREE.Vector3(...box) },
      uVel: { value: new THREE.Vector3(...(o.velocity || k.velocity)) }, uTurb: { value: o.turbulence ?? k.turb },
      uSize: { value: o.size ?? k.size }, uPx: { value: 900 },
      uColor: { value: new THREE.Color(o.color || k.color) }, uColor2: { value: new THREE.Color(o.color2 || k.color2) },
      uIntensity: { value: o.intensity ?? k.intensity }, uKind: { value: o.kind === 'ember' || !o.kind ? 0 : 1 },
    }]),
    transparent: true, depthWrite: false, fog: !k.additive, blending: k.additive ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: false,
  });
  mat.uniforms.kTime = shared.uTime; mat.uniforms.kWind = shared.uWind;
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false; pts.renderOrder = 6; pts.name = `ambient:${o.kind || 'ember'}`;
  const off = o.offset || [0, 0, 0];
  const bmin = mat.uniforms.uBoxMin.value;
  return {
    object: pts,
    update(camera, focus, viewportH = 900) {
      const fx = focus ? focus.x : camera.position.x, fz = focus ? focus.z : 0;
      bmin.set(fx + off[0] - box[0] / 2, off[1], fz + off[2] - box[2] / 2);
      mat.uniforms.uPx.value = viewportH / (2 * Math.tan((camera.fov * Math.PI) / 360));
    },
  };
}
