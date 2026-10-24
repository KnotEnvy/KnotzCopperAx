// Shared GLSL for the VFX pools: hash/value-noise/fbm and a cheap "lit by the stage" term so alpha-blended
// dust/smoke/decals pick up the stage's real lights (sun, fill, rim, hemisphere, point lights incl. fires)
// instead of glowing as unlit grey (the old white-puff problem). Used with ShaderMaterial({ lights: true }).
import * as THREE from 'three';

export const NOISE = /* glsl */`
float vfxH11(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float vfxH21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vfxNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = vfxH21(i), b = vfxH21(i + vec2(1.0, 0.0)), c = vfxH21(i + vec2(0.0, 1.0)), d = vfxH21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float vfxFbm(vec2 p) { return vfxNoise(p) * 0.55 + vfxNoise(p * 2.03 + 7.1) * 0.3 + vfxNoise(p * 4.1 + 3.7) * 0.15; }
`;

/**
 * Fog for ADDITIVE / premultiplied output. three's fog_fragment lerps rgb toward the fog colour, which on an additive
 * quad ADDS fog-coloured haze over its whole footprint (a big part of the old "white dome" look). This recovers
 * the fog factor from whatever fog chunk is installed (works with look-dev's custom fog as long as it is a lerp)
 * and only attenuates. Use in place of `#include <fog_fragment>`.
 */
export const FOG_ADDITIVE = /* glsl */`
#ifdef USE_FOG
  {
    vec4 vfxOut = gl_FragColor;
    vec3 vfxF0, vfxF1;
    { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      #include <fog_fragment>
      vfxF0 = gl_FragColor.rgb; }
    { gl_FragColor = vec4(1.0);
      #include <fog_fragment>
      vfxF1 = gl_FragColor.rgb; }
    float vfxFog = clamp(dot(vfxF0 + 1.0 - vfxF1, vec3(0.3333)), 0.0, 1.0);
    gl_FragColor = vfxOut * (1.0 - vfxFog);
  }
#endif
`;

/** Needs `#include <common>` + `#include <lights_pars_begin>` before it. n and vp are VIEW space. */
export const LIT = /* glsl */`
uniform float uLitGain;
uniform float uLitFloor;
vec3 vfxIrradiance(vec3 n, vec3 vp) {
  vec3 irr = ambientLightColor;
  #if NUM_HEMI_LIGHTS > 0
  for (int i = 0; i < NUM_HEMI_LIGHTS; i++) { irr += getHemisphereLightIrradiance(hemisphereLights[i], n); }
  #endif
  #if NUM_DIR_LIGHTS > 0
  for (int i = 0; i < NUM_DIR_LIGHTS; i++) { float w = dot(n, directionalLights[i].direction) * 0.5 + 0.5; irr += directionalLights[i].color * (w * w); }
  #endif
  #if NUM_POINT_LIGHTS > 0
  for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
    vec3 lv = pointLights[i].position - vp; float ld = length(lv);
    float att = getDistanceAttenuation(ld, pointLights[i].distance, pointLights[i].decay);
    float w = dot(n, lv / max(ld, 1e-4)) * 0.5 + 0.5;
    irr += pointLights[i].color * att * w;
  }
  #endif
  return irr * RECIPROCAL_PI * uLitGain + vec3(uLitFloor);
}
`;

export function litUniforms(extra = {}) {
  return THREE.UniformsUtils.merge([THREE.UniformsLib.fog, THREE.UniformsLib.lights, { uLitGain: { value: 2.1 }, uLitFloor: { value: 0.006 } }, extra]);
}
