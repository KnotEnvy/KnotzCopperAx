// Painted sky dome: multi-stop gradient (zenith → top → horizon, with the horizon warming toward the sun),
// a sun disc with a layered halo, perspective cloud bands lit from the sun (dark undersides, hot silver-lined
// edges near the sun), optional stars. Also the source of the PMREM environment (Lighting.buildEnv) so PBR
// ambient/specular matches the sky. HDR output: the sun disc and sun-side cloud rims exceed 1.0 and bloom.
//
// sky preset: { top, horizon, bottom, zenith, horizonSun, sunDir:[x,y,z], sunColor, sunDisc, sunSize (rad), sunGlow,
//               hazeHeight, intensity, stars (0..1),
//               clouds: { cover 0..1 (0 = none), color (shadow side), lit (sun side), scale, speed, opacity,
//                         band: [h0, h1, h2, h3] (elevation fade-in h0→h1, fade-out h2→h3), stretch: [x, z] } }
import * as THREE from 'three';
import { shared, noiseTexture } from './shaderlib.js';

const VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w * 0.99999; // always at the far plane
}`;

const FRAG = /* glsl */`
uniform vec3 zenith; uniform vec3 top; uniform vec3 horizon; uniform vec3 horizonSun; uniform vec3 bottom;
uniform vec3 sunDir; uniform vec3 sunColor; uniform vec3 sunDisc; uniform float sunSize; uniform float sunGlow; uniform float hazeHeight;
uniform float intensity; uniform float stars;
uniform vec3 cloudColor; uniform vec3 cloudLit; uniform float cloudCover; uniform float cloudScale; uniform float cloudSpeed;
uniform float cloudOpacity; uniform vec4 cloudBand; uniform vec2 cloudStretch;
uniform sampler2D kNoise; uniform float kTime;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 sd = normalize(sunDir);
  float s = dot(d, sd);
  float sp = max(s, 0.0);
  vec2 dh = normalize(d.xz + vec2(1e-5)); vec2 sh = normalize(sd.xz + vec2(1e-5));
  float az = dot(dh, sh) * 0.5 + 0.5;
  vec3 hor = mix(horizon, horizonSun, pow(az, 3.0));
  float e = max(h, 0.0);
  vec3 col = mix(hor, top, smoothstep(0.0, hazeHeight, pow(e, 0.85)));
  col = mix(col, zenith, smoothstep(hazeHeight * 0.7, 1.0, e));
  if (h < 0.0) col = mix(hor, bottom, smoothstep(0.0, 0.22, -h));
  col += sunColor * (pow(sp, 3.0) * 0.18 + pow(sp, 16.0) * 0.45 + pow(sp, 180.0) * 1.4) * sunGlow;
  float vis = 1.0;
  if (cloudCover > 0.001 && h > -0.03) {
    vec2 cuv = d.xz / (max(h, 0.0) + 0.09);
    cuv = cuv * cloudStretch * cloudScale + vec2(kTime * cloudSpeed, 0.0);
    float n = texture2D(kNoise, cuv * 0.045).r * 0.58 + texture2D(kNoise, cuv * 0.16 + 0.37).g * 0.3 + texture2D(kNoise, cuv * 0.55 + 0.11).b * 0.12;
    float band = smoothstep(cloudBand.x, cloudBand.y, h) * (1.0 - smoothstep(cloudBand.z, cloudBand.w, h));
    float dens = smoothstep(1.0 - cloudCover, 1.0 - cloudCover + 0.22, n) * band;
    float edge = 1.0 - smoothstep(0.05, 0.75, dens);
    float lit = pow(sp, 5.0) * (0.35 + edge * 1.3) + pow(az, 4.0) * 0.35 * (0.4 + edge);
    vec3 cc = mix(cloudColor, cloudLit, clamp(lit, 0.0, 1.0));
    cc += sunColor * pow(sp, 30.0) * edge * 2.4;
    cc = mix(cc, hor, (1.0 - smoothstep(0.0, 0.14, h)) * 0.55);
    float a = dens * cloudOpacity;
    col = mix(col, cc, a);
    vis = 1.0 - a * 0.9;
  }
  float disc = smoothstep(cos(sunSize), cos(sunSize * 0.8), s);
  float limb = smoothstep(cos(sunSize), cos(sunSize * 0.2), s);
  col += sunDisc * disc * (0.6 + 0.4 * limb) * vis;
  if (stars > 0.0 && h > 0.0) {
    vec2 g = floor(vec2(atan(d.z, d.x) * 180.0, h * 260.0));
    float r = fract(sin(dot(g, vec2(12.9898, 78.233))) * 43758.5453);
    col += vec3(0.9, 0.95, 1.0) * step(0.9965, r) * stars * smoothstep(0.05, 0.4, h) * (0.5 + 0.5 * sin(kTime * 2.0 + r * 60.0));
  }
  col = max(col * intensity, vec3(0.0));
  gl_FragColor = vec4(min(col, vec3(64.0)), 1.0);
}`;

export const DEFAULT_CLOUDS = { cover: 0, color: '#3a3050', lit: '#ff9a6a', scale: 1, speed: 0.004, opacity: 0.9, band: [0.0, 0.05, 0.35, 0.7], stretch: [0.35, 1.0] };

export class Sky {
  constructor() {
    const col = (c) => ({ value: new THREE.Color(c) });
    this.uniforms = {
      zenith: col('#1a2040'), top: col('#2a3350'), horizon: col('#d88a5a'), horizonSun: col('#ffb070'), bottom: col('#2a1c16'),
      sunDir: { value: new THREE.Vector3(-0.4, 0.25, -1).normalize() },
      sunColor: col('#ffb070'), sunDisc: { value: new THREE.Color(8, 5.5, 3) },
      sunSize: { value: 0.035 }, sunGlow: { value: 1 }, hazeHeight: { value: 0.55 }, intensity: { value: 1 }, stars: { value: 0 },
      cloudColor: col(DEFAULT_CLOUDS.color), cloudLit: col(DEFAULT_CLOUDS.lit), cloudCover: { value: 0 }, cloudScale: { value: 1 },
      cloudSpeed: { value: 0.004 }, cloudOpacity: { value: 0.9 }, cloudBand: { value: new THREE.Vector4(...DEFAULT_CLOUDS.band) },
      cloudStretch: { value: new THREE.Vector2(...DEFAULT_CLOUDS.stretch) },
      kNoise: shared.uNoise, kTime: shared.uTime,
    };
    noiseTexture();
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
      side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(450, 64, 32), this.material);
    this.mesh.name = 'sky';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.userData.farPlane = true; // drawn at the far plane: safe to draw AFTER the opaques (Renderer early-z)
  }

  /** sky preset (see header). Unspecified zenith/horizonSun derive from top/horizon + sunColor. */
  set(p = {}) {
    const u = this.uniforms;
    for (const k of ['top', 'horizon', 'bottom', 'sunColor']) if (p[k] !== undefined) u[k].value.set(p[k]);
    u.zenith.value.set(p.zenith !== undefined ? p.zenith : u.top.value.clone().multiplyScalar(0.6));
    u.horizonSun.value.set(p.horizonSun !== undefined ? p.horizonSun : u.horizon.value.clone().lerp(u.sunColor.value, 0.45));
    if (p.sunDisc !== undefined) u.sunDisc.value.set(p.sunDisc).multiplyScalar(p.sunDiscIntensity ?? 8);
    else u.sunDisc.value.copy(u.sunColor.value).lerp(new THREE.Color(1, 0.95, 0.85), 0.5).multiplyScalar(p.sunDiscIntensity ?? 8);
    if (p.sunDir) u.sunDir.value.fromArray(p.sunDir).normalize();
    // Legacy sunSize (≤ 0.01) was "1 - cos(radius)"; convert so old presets keep their disc size.
    if (p.sunSize !== undefined) u.sunSize.value = p.sunSize < 0.01 ? Math.acos(1 - p.sunSize) : p.sunSize;
    for (const k of ['sunGlow', 'hazeHeight', 'intensity', 'stars']) if (p[k] !== undefined) u[k].value = p[k];
    const c = { ...DEFAULT_CLOUDS, ...(p.clouds || {}) };
    u.cloudCover.value = c.cover; u.cloudColor.value.set(c.color); u.cloudLit.value.set(c.lit);
    u.cloudScale.value = c.scale; u.cloudSpeed.value = c.speed; u.cloudOpacity.value = c.opacity;
    u.cloudBand.value.set(...c.band); u.cloudStretch.value.set(...c.stretch);
  }
}
