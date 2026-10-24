// Stage 5 shared surface shading (pattern from stage 4): stock MeshStandardMaterials patched with onBeforeCompile so
// fog, shadows, env and the post chain keep working. The patch adds:
//   - WITCHFIRE POOLS: up to 16 analytic emerald point lights (s5Fire[i] = xyz, intensity) — the dominant light —
//     with wrap diffuse, Blinn specular and a mirror term (brazier flames streak across the polished obsidian).
//   - RELIC: one analytic warm-gold light (s5Relic) — the only warm source in the hall.
//   - SHEEN: a violet→green fresnel sheen on polished obsidian (reads the black glass without a real reflection pass).
//   - KIT MASKS (vertex colour a): 0 basalt, .25 metal, .5 matte, .75 polished obsidian, 1 glow.
import * as THREE from 'three';

export const MAX_FIRES = 16;
export const S5 = {
  s5Fire: { value: Array.from({ length: MAX_FIRES }, () => new THREE.Vector4(0, -100, 0, 0)) },
  s5FireCol: { value: new THREE.Color('#3cff78') },
  s5Relic: { value: new THREE.Vector4(52, 5.5, -9.9, 0) },
  s5RelicCol: { value: new THREE.Color('#ffb44a') },
  s5Time: { value: 0 },
  s5Pulse: { value: 0 },                 // global witchfire surge (boss phases, magic)
};

export const GLSL_NOISE = /* glsl */`
float s5h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float s5n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(s5h(i), s5h(i + vec2(1, 0)), f.x), mix(s5h(i + vec2(0, 1)), s5h(i + vec2(1, 1)), f.x), f.y); }
float s5fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * s5n(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
`;

const VERT_PARS = 'varying vec3 vS5World;\n';
const VERT_MAIN = /* glsl */`
{ vec4 s5w = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  s5w = instanceMatrix * s5w;
#endif
  vS5World = (modelMatrix * s5w).xyz; }
`;

const FRAG_PARS = /* glsl */`
varying vec3 vS5World;
uniform vec4 s5Fire[${MAX_FIRES}];
uniform vec3 s5FireCol; uniform vec4 s5Relic; uniform vec3 s5RelicCol; uniform float s5Time; uniform float s5Pulse;
uniform float s5Glow; uniform float s5Gloss;
${GLSL_NOISE}
`;

const FRAG_SURFACE = (surface) => /* glsl */`
vec3 s5N = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
vec3 s5V = normalize(cameraPosition - vS5World);
float s5Wet = 0.0;       // 0..1 glossy
float s5Mirror = 0.0;    // 0..1 mirror-like (polished obsidian)
vec3 s5Emit = vec3(0.0);
float s5SpecK = 1.0;     // scales ALL direct specular (three's lights + the fire loop); 1 = unchanged
${surface}
roughnessFactor = clamp(roughnessFactor, 0.04, 1.0);
`;

const FRAG_LIGHT = /* glsl */`
{
  reflectedLight.directSpecular *= s5SpecK;
  vec3 s5D = vec3(0.0), s5S = vec3(0.0);
  vec3 s5R = reflect(-s5V, s5N);
  float s5Shin = mix(6.0, 900.0, pow(1.0 - roughnessFactor, 3.0));
  float surge = 1.0 + s5Pulse;
  for (int i = 0; i < ${MAX_FIRES}; i++) {
    vec4 T = s5Fire[i];
    if (T.w <= 0.0) continue;
    vec3 L = T.xyz - vS5World; float d2 = dot(L, L);
    if (d2 > 110.0) continue;
    L *= inversesqrt(d2);
    float fall = pow(clamp(1.0 - d2 / 110.0, 0.0, 1.0), 2.0);
    float att = T.w * fall / (1.0 + d2 * 0.6);
    float nl = dot(s5N, L);
    s5D += att * clamp(nl * 0.8 + 0.2, 0.0, 1.0);
    vec3 H = normalize(L + s5V);
    float spec = pow(max(dot(s5N, H), 0.0), s5Shin) * (s5Shin + 8.0) / 25.0;
    float mir = pow(max(dot(s5R, L), 0.0), mix(60.0, 1600.0, s5Mirror)) * mix(2.0, 30.0, s5Mirror);
    s5S += T.w * fall / (1.0 + d2 * 0.1) * (spec * 0.25 * step(0.0, nl) + mir * s5Mirror) * (0.3 + 0.7 * s5Wet);
  }
  // relic: warm gold, strong falloff, big reach (the altar zone)
  vec3 RL = s5Relic.xyz - vS5World; float rd2 = dot(RL, RL); RL *= inversesqrt(max(rd2, 1e-4));
  float rfall = s5Relic.w * pow(clamp(1.0 - rd2 / 400.0, 0.0, 1.0), 2.0) / (1.0 + rd2 * 0.18);
  vec3 rD = s5RelicCol * rfall * clamp(dot(s5N, RL) * 0.8 + 0.2, 0.0, 1.0);
  vec3 rS = s5RelicCol * s5Relic.w * pow(clamp(1.0 - rd2 / 400.0, 0.0, 1.0), 2.0) / (1.0 + rd2 * 0.06)
          * pow(max(dot(s5R, RL), 0.0), mix(40.0, 900.0, s5Mirror)) * mix(1.0, 14.0, s5Mirror) * s5Wet;
  float s5F = 0.04 + 0.96 * pow(1.0 - clamp(dot(s5N, s5V), 0.0, 1.0), 5.0);
  reflectedLight.directDiffuse += material.diffuseColor * (s5FireCol * s5D * surge + rD);
  reflectedLight.directSpecular += (s5FireCol * s5S * surge + rS) * (0.3 + s5F * 2.0) * s5SpecK;
  // obsidian sheen: violet at grazing, faint emerald overhead (reads polished black glass)
  float sky = smoothstep(-0.3, 0.8, s5R.y);
  vec3 sheen = mix(vec3(0.05, 0.03, 0.09), vec3(0.02, 0.07, 0.045), sky);
  reflectedLight.indirectSpecular += sheen * s5F * s5Mirror * 1.6;
  totalEmissiveRadiance += s5Emit * surge;
}
`;

export function patchMaterial(mat, { surface = '', extraPars = '', vertPars = '', vertMain = '', uniforms = {}, glow = 0, key } = {}) {
  const own = { s5Glow: { value: glow }, s5Gloss: { value: 1 }, ...uniforms };
  mat.userData.s5 = own;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, S5, own);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS + vertPars)
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + VERT_MAIN + vertMain);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS + extraPars)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + FRAG_SURFACE(surface))
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + FRAG_LIGHT);
  };
  mat.customProgramCacheKey = () => 's5:' + (key || surface.length + ':' + extraPars.length + ':' + vertMain.length);
  return mat;
}

// ---------------------------------------------------------------------------------------------- kit (GLB) material
const KIT_SURFACE = /* glsl */`
float m = vS5Mask;
diffuseColor.a = 1.0;
float up = smoothstep(0.35, 0.9, s5N.y);
vec2 wp = vec2(vS5World.x + vS5World.z * 0.7, vS5World.y);
float grain = s5n(vS5World.xy * 3.1 + vS5World.zx * 2.3);
float blotch = s5fbm(wp * 0.4 + 3.0);                                  // soot / weathering over many blocks
float seep = smoothstep(0.55, 0.85, s5n(vec2(wp.x * 2.3, wp.y * 0.18 - 0.3))) * (1.0 - up);   // damp seepage streaks
float foot = smoothstep(1.6, 0.0, vS5World.y);                         // grime at floor contact
metalnessFactor = 0.0;
if (m < 0.12) {                                                        // basalt
  diffuseColor.rgb *= (0.84 + 0.3 * grain) * (0.6 + 0.75 * blotch) * (1.0 - seep * 0.3) * (1.0 - foot * 0.35);
  s5Wet = clamp(seep * 0.8 + up * 0.25, 0.0, 1.0);
  roughnessFactor = mix(0.86, 0.45, s5Wet);
  diffuseColor.rgb *= mix(1.0, 0.8, s5Wet);
} else if (m < 0.37) {                                                 // bronze / iron: hold mid-tone
  metalnessFactor = 0.85; roughnessFactor = 0.36 + 0.3 * grain;
  vec3 verd = vec3(0.10, 0.2, 0.15);                                  // verdigris in crevices
  diffuseColor.rgb = mix(max(diffuseColor.rgb, vec3(0.06)) * 1.5, verd, smoothstep(0.55, 0.8, blotch) * 0.45);
  s5Wet = 0.6;
} else if (m < 0.62) {                                                 // matte: bone, cloth, skin, wood
  roughnessFactor = 0.8; diffuseColor.rgb *= 0.9 + 0.2 * grain;
} else if (m < 0.88) {                                                 // polished obsidian
  roughnessFactor = 0.08 + 0.18 * smoothstep(0.5, 0.8, blotch);
  s5Mirror = 0.85 - 0.5 * smoothstep(0.5, 0.8, blotch); s5Wet = 1.0;
  metalnessFactor = 0.0;
} else {                                                               // glow
  s5Emit = diffuseColor.rgb * s5Glow * (0.85 + 0.15 * sin(s5Time * 3.0 + vS5World.x));
  roughnessFactor = 0.6;
}
`;

export function kitMaterial({ glow = 2.5, key = 'kit' } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.FrontSide });
  return patchMaterial(m, {
    key, glow,
    vertPars: 'varying float vS5Mask;\n',
    vertMain: '#ifdef USE_COLOR_ALPHA\n vS5Mask = color.a;\n#else\n vS5Mask = 0.0;\n#endif\n',
    extraPars: 'varying float vS5Mask;\n',
    surface: KIT_SURFACE,
  });
}

/** fires: [{ x, y, z, i, seed, on }] → uniforms (flicker applied here; keeps the 16 nearest the camera). */
export function updateFires(fires, t, camX = 0) {
  const arr = S5.s5Fire.value;
  const list = fires.length > MAX_FIRES ? [...fires].sort((a, b) => Math.abs(a.x - camX) - Math.abs(b.x - camX)).slice(0, MAX_FIRES) : fires;
  for (let k = 0; k < MAX_FIRES; k++) {
    const T = list[k];
    if (!T) { arr[k].set(0, -100, 0, 0); continue; }
    const s = T.seed || k;
    const fl = 0.84 + 0.09 * Math.sin(t * 7.3 + s * 3.7) + 0.07 * Math.sin(t * 19.1 + s * 1.3) + 0.05 * Math.sin(t * 3.1 + s);
    arr[k].set(T.x, T.y, T.z, (T.i ?? 1) * fl * (T.on ?? 1));
  }
  S5.s5Time.value = t;
}
