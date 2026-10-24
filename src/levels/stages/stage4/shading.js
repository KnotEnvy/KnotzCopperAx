// Stage 4 shared surface shading: every env material (stone kit, flagstones, drawbridge timber, moat) is a stock
// MeshStandardMaterial patched with onBeforeCompile so fog, shadows, the PMREM env and the post chain keep working.
// The patch adds:
//   - TORCH POOLS: up to 16 analytic warm point lights (s4Torch[i] = xyz, intensity) with wrap diffuse + wet
//     Blinn specular + a glossy mirror term (torch reflections streak in puddles / on wet slate). Real point lights are
//     limited to 2 by the budget, so the stage re-seats those on the torches nearest the camera for the ACTORS only.
//   - WETNESS: up-facing surfaces darken + go glossy, vertical rain streaks run down walls (kit), puddles on the ground.
//   - LIGHTNING: s4Flash scales a cold sky reflection (fresnel) on wet surfaces (the real flash light is a
//     DirectionalLight the storm owns).
//   - KIT MASKS: vertex colour alpha = 0 stone, .25 iron, .5 wood, .75 slate, 1 glow (emissive, s4Glow per material).
import * as THREE from 'three';

export const MAX_TORCHES = 16;
export const S4 = {
  s4Torch: { value: Array.from({ length: MAX_TORCHES }, () => new THREE.Vector4(0, -100, 0, 0)) },
  s4TorchCol: { value: new THREE.Color('#ffa24c') },
  s4Flash: { value: 0 },
  s4FlashCol: { value: new THREE.Color('#b8c8ff') },
  s4Time: { value: 0 },
  s4Rain: { value: 1 },
};

export const GLSL_NOISE = /* glsl */`
float s4h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float s4n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(s4h(i), s4h(i + vec2(1, 0)), f.x), mix(s4h(i + vec2(0, 1)), s4h(i + vec2(1, 1)), f.x), f.y); }
float s4fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * s4n(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
`;

const VERT_PARS = /* glsl */`
varying vec3 vS4World;
`;
const VERT_MAIN = /* glsl */`
{ vec4 s4w = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  s4w = instanceMatrix * s4w;
#endif
  vS4World = (modelMatrix * s4w).xyz; }
`;

const FRAG_PARS = /* glsl */`
varying vec3 vS4World;
uniform vec4 s4Torch[${MAX_TORCHES}];
uniform vec3 s4TorchCol; uniform float s4Flash; uniform vec3 s4FlashCol; uniform float s4Time; uniform float s4Rain;
uniform float s4Glow; uniform float s4Wet; uniform float s4Gloss;
${GLSL_NOISE}
`;

// runs after normal_fragment_maps: world normal, wetness, per-mask PBR — BEFORE lights_physical_fragment reads them.
const FRAG_SURFACE = (surface) => /* glsl */`
vec3 s4N = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
vec3 s4V = normalize(cameraPosition - vS4World);
float s4WetM = 0.0;       // 0..1 how wet (glossy) this pixel is
float s4Mirror = 0.0;     // 0..1 mirror-like (puddles, wet slate)
vec3 s4Emit = vec3(0.0);
${surface}
roughnessFactor = clamp(roughnessFactor, 0.04, 1.0);
`;

const FRAG_LIGHT = /* glsl */`
{
  vec3 s4D = vec3(0.0), s4S = vec3(0.0);
  vec3 s4R = reflect(-s4V, s4N);
  float s4Shin = mix(6.0, 900.0, pow(1.0 - roughnessFactor, 3.0));
  for (int i = 0; i < ${MAX_TORCHES}; i++) {
    vec4 T = s4Torch[i];
    if (T.w <= 0.0) continue;
    vec3 L = T.xyz - vS4World; float d2 = dot(L, L);
    if (d2 > 110.0) continue;
    L *= inversesqrt(d2);
    float fall = pow(clamp(1.0 - d2 / 110.0, 0.0, 1.0), 2.0);
    float att = T.w * fall / (1.0 + d2 * 0.55);
    float nl = dot(s4N, L);
    s4D += att * clamp(nl * 0.8 + 0.2, 0.0, 1.0);
    vec3 H = normalize(L + s4V);
    float spec = pow(max(dot(s4N, H), 0.0), s4Shin) * (s4Shin + 8.0) / 25.0;
    float mir = pow(max(dot(s4R, L), 0.0), mix(60.0, 1400.0, s4Mirror)) * mix(2.0, 26.0, s4Mirror);
    s4S += T.w * fall / (1.0 + d2 * 0.12) * (spec * 0.25 * step(0.0, nl) + mir * s4Mirror) * (0.25 + 0.75 * s4WetM);
  }
  float s4F = 0.04 + 0.96 * pow(1.0 - clamp(dot(s4N, s4V), 0.0, 1.0), 5.0);
  reflectedLight.directDiffuse += material.diffuseColor * s4TorchCol * s4D;
  reflectedLight.directSpecular += s4TorchCol * s4S * (0.3 + s4F * 2.0);
  // storm sky in the wet: a faint cold sheen, blazing on lightning
  float sky = smoothstep(-0.2, 0.6, s4R.y);
  reflectedLight.indirectSpecular += s4FlashCol * (0.012 + s4Flash * 0.35) * sky * s4F * s4WetM * (1.0 + s4Mirror * 3.0);
  totalEmissiveRadiance += s4Emit;
}
`;

/**
 * Patch a MeshStandardMaterial with the stage-4 shading. `surface` = GLSL run after normals (may set roughnessFactor,
 * metalnessFactor, diffuseColor, s4WetM, s4Mirror, s4Emit, and may use s4N, s4V, vS4World). extraPars = GLSL decls.
 */
export function patchMaterial(mat, { surface = '', extraPars = '', vertPars = '', vertMain = '', uniforms = {}, glow = 0, wet = 1, key } = {}) {
  const own = { s4Glow: { value: glow }, s4Wet: { value: wet }, s4Gloss: { value: 1 }, ...uniforms };
  mat.userData.s4 = own;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, S4, own);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS + vertPars)
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + VERT_MAIN + vertMain);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS + extraPars)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + FRAG_SURFACE(surface))
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + FRAG_LIGHT);
  };
  mat.customProgramCacheKey = () => 's4:' + (key || surface.length + ':' + extraPars.length + ':' + vertMain.length);
  return mat;
}

// ---------------------------------------------------------------------------------------------- kit (GLB) material
const KIT_SURFACE = /* glsl */`
float m = vS4Mask;
diffuseColor.a = 1.0;
float up = smoothstep(0.35, 0.9, s4N.y);
// rain streaks down vertical faces (stretched noise, slowly crawling) + grime under ledges
float st = s4n(vec2((vS4World.x + vS4World.z) * 3.1, vS4World.y * 0.35 - s4Time * 0.05));
float streak = smoothstep(0.55, 0.85, st) * (1.0 - up) * step(abs(s4N.y), 0.6);
float grain = s4n(vS4World.xy * 2.7 + vS4World.zx * 1.9);
vec2 wp = vec2(vS4World.x + vS4World.z * 0.7, vS4World.y);
float blotch = s4fbm(wp * 0.45 + 3.0);                      // weathering / soot patches over many blocks
float drip = smoothstep(0.5, 0.8, s4n(vec2(wp.x * 1.3, wp.y * 0.12))) * (1.0 - up);
float lumK = dot(diffuseColor.rgb, vec3(0.3, 0.5, 0.2));
if (m < 0.12) diffuseColor.rgb = mix(vec3(lumK), diffuseColor.rgb, 0.55) * vec3(1.04, 1.0, 0.95);   // de-violet the stone
diffuseColor.rgb *= (0.86 + 0.28 * grain) * (0.62 + 0.7 * blotch) * (1.0 - drip * 0.35);
s4WetM = clamp(up * 0.9 + streak * 0.7 + 0.25, 0.0, 1.0) * s4Wet;
roughnessFactor = mix(0.9, 0.34, s4WetM);
metalnessFactor = 0.0;
if (abs(m - 0.25) < 0.12) { metalnessFactor = 0.8; roughnessFactor = mix(0.5, 0.28, s4WetM); diffuseColor.rgb = max(diffuseColor.rgb, vec3(0.05)) * 1.6; }
else if (abs(m - 0.5) < 0.12) { roughnessFactor = mix(0.85, 0.45, s4WetM); }
else if (abs(m - 0.75) < 0.12) { roughnessFactor = mix(0.55, 0.16, s4WetM); s4Mirror = 0.35 * s4WetM; }
else if (m > 0.88) { s4Emit = diffuseColor.rgb * s4Glow; roughnessFactor = 0.6; }
diffuseColor.rgb *= mix(1.0, 0.72, s4WetM * (1.0 - step(0.88, m)));
`;

export function kitMaterial({ glow = 2.5, key = 'kit' } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.FrontSide });
  return patchMaterial(m, {
    key,
    glow,
    vertPars: 'varying float vS4Mask;\n',
    vertMain: '#ifdef USE_COLOR_ALPHA\n vS4Mask = color.a;\n#else\n vS4Mask = 0.0;\n#endif\n',
    extraPars: 'varying float vS4Mask;\n',
    surface: KIT_SURFACE,
  });
}

/** CPU side: torch list → uniforms (flicker applied here). torches: [{ x, y, z, i, seed }] */
export function updateTorches(torches, t, camX = 0) {
  const arr = S4.s4Torch.value;
  // keep the 16 torches nearest the camera
  const list = torches.length > MAX_TORCHES ? [...torches].sort((a, b) => Math.abs(a.x - camX) - Math.abs(b.x - camX)).slice(0, MAX_TORCHES) : torches;
  for (let k = 0; k < MAX_TORCHES; k++) {
    const T = list[k];
    if (!T) { arr[k].set(0, -100, 0, 0); continue; }
    const s = T.seed || k;
    const fl = 0.82 + 0.1 * Math.sin(t * 9.1 + s * 3.7) + 0.08 * Math.sin(t * 23.3 + s * 1.3) + 0.05 * Math.sin(t * 4.2 + s);
    arr[k].set(T.x, T.y, T.z, (T.i ?? 1) * fl * (T.on ?? 1));
  }
  S4.s4Time.value = t;
}
