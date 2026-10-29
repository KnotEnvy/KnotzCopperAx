// Stage 5 shared surface shading (pattern from stage 4): stock MeshStandardMaterials patched with onBeforeCompile so
// fog, shadows, env and the post chain keep working. The patch adds:
//   - WITCHFIRE POOLS: up to 16 analytic emerald point lights (s5Fire[i] = xyz, intensity) — the dominant light —
//     with wrap diffuse, Blinn specular and a mirror term (brazier flames streak across the polished obsidian).
//   - RELIC: one analytic warm-gold light (s5Relic) — the only warm source in the hall.
//   - env r32 (opt-in per material, never actors): ARCH RAKE (s5Arch, archK) — a broad cool high light on the hall
//     architecture with its rough-stone specular sheen; LANE sheen (s5Lane, laneK) — the same source on the floor;
//     THRONE KEY (s5Key, throneK) — the relic's gold from above-behind, confined to the throne by a focus sphere.
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
  // env r32: stage-local ARCHITECTURE RAKE — a broad cool light from upper front-left that only opted-in hall
  // materials receive (s5ArchK > 0: kit, chains, captives; never actors, never the floor). xyz = direction toward the
  // light (normalised below), w = intensity. Band: y0..y1 height ramp, z = fraction kept below y0 (the lane zone stays
  // witchfire-led, the upper hall reads as lit form instead of a black void).
  s5Arch: { value: new THREE.Vector4(-0.38, 0.5, 0.78, 2.2) },
  s5ArchCol: { value: new THREE.Color('#8890b0') },
  s5ArchBand: { value: new THREE.Vector4(0.5, 7.0, 0.3, 0) },
  // the same cool source as a broad sheen on the lane (floor only, s5LaneK): x intensity, y lane centre z, z half-width,
  // w fade (dies out toward the back wall and the camera-side foreground)
  s5Lane: { value: new THREE.Vector4(1.6, 0.0, 3.0, 4.5) },
  // env r32: warm THRONE KEY — the relic's gold falling from above-behind: it rims the hood, arms, seat and dais tops
  // and leaves the throne's front a dark carved mass. Position + intensity; the focus sphere (centre, radius) confines it
  // to the throne so the warm focal never spreads over the hall or the lane.
  s5Key: { value: new THREE.Vector4(51.2, 10.0, -7.4, 3.6) },     // final carved forms: restrained gold on relief and arms
  s5KeyCol: { value: new THREE.Color('#ffae5c') },
  s5KeyFocus: { value: new THREE.Vector4(52, 3.4, -6.8, 5.4) },
  // env r32 integration (r32 throne forms): throne key response — x, y wrap (n·L·x + y), z exponent, w edge Blinn gain.
  // The scene pass used a soft wrap (.85, .15, 1, .14): on the new smooth hood-back it lit the whole front an even clay
  // brown. Now only up-facing tops and relief edges catch the gold and the carved front stays a dark mass (ref).
  // s5KeyArch = share of the cool architecture rake kept inside the throne focus sphere (.45: dark throne vs lit apse)
  s5KeyShape: { value: new THREE.Vector4(1.0, 0.0, 2.0, 0.55) },
  s5KeyArch: { value: 0.45 },
};
{ const a = S5.s5Arch.value, l = Math.hypot(a.x, a.y, a.z) || 1; a.set(a.x / l, a.y / l, a.z / l, a.w); }

export const GLSL_NOISE = /* glsl */`
float s5h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float s5n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(s5h(i), s5h(i + vec2(1, 0)), f.x), mix(s5h(i + vec2(0, 1)), s5h(i + vec2(1, 1)), f.x), f.y); }
float s5fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * s5n(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
// Value + analytic slope: stone relief at centimetre/decimetre scale, without extra texture fetches or screen-space
// derivatives across masks/discards. Broad clefts carry the read; the small second octave only breaks their edges.
vec3 s5ng(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f), du = 6.0 * f * (1.0 - f);
  float a = s5h(i), b = s5h(i + vec2(1, 0)), c = s5h(i + vec2(0, 1)), d = s5h(i + vec2(1, 1));
  return vec3(mix(mix(a, b, u.x), mix(c, d, u.x), u.y),
    du.x * mix(b - a, d - c, u.y), du.y * mix(c - a, d - b, u.x));
}
// Irregular cleft edges, distance to the nearest cell bisector + its analytic slope. Only sparse portions are used;
// this is broken stone, never a second visible tile grid. Fixed loop bounds keep the Low path predictable.
vec3 s5cleft(vec2 p) {
  vec2 cell = floor(p), f = fract(p), r1 = vec2(0.0), r2 = vec2(0.0);
  float d1 = 100.0, d2 = 100.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 c = vec2(float(x), float(y)), id = cell + c;
    vec2 r = c + 0.15 + 0.7 * vec2(s5h(id), s5h(id + 19.7)) - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; r2 = r1; d1 = d; r1 = r; }
    else if (d < d2) { d2 = d; r2 = r; }
  }
  vec2 delta = r1 - r2;
  float inv = inversesqrt(max(dot(delta, delta), 1e-6));
  return vec3(max(0.0, (d2 - d1) * 0.5 * inv), delta * inv);
}
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
uniform vec4 s5Arch; uniform vec3 s5ArchCol; uniform vec4 s5ArchBand; uniform float s5ArchK; uniform vec4 s5Lane; uniform float s5LaneK;
uniform vec4 s5Key; uniform vec3 s5KeyCol; uniform vec4 s5KeyFocus; uniform float s5KeyK; uniform vec4 s5KeyShape; uniform float s5KeyArch;
vec3 s5SafeN(vec3 v) { return v * inversesqrt(max(dot(v, v), 1e-8)); }   // env r32: half vectors never normalize(0)
${GLSL_NOISE}
`;

const FRAG_SURFACE = (surface) => /* glsl */`
vec3 s5N = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
vec3 s5V = normalize(cameraPosition - vS5World);
float s5Wet = 0.0;       // 0..1 glossy
float s5Mirror = 0.0;    // 0..1 mirror-like (polished obsidian)
vec3 s5Emit = vec3(0.0);
float s5SpecK = 1.0;     // scales ALL direct specular (three's lights + the fire loop); 1 = unchanged
float s5Stone = 0.0;     // only stone masks opt into the shaped architectural source (cloth/skin/metal unchanged)
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
  // env r32: one clamped mirror weight for every exponent/gain below (the C1 floor fix keeps it >= 0 at the source;
  // this also guards any future surface block from pow(0, negative))
  s5Mirror = clamp(s5Mirror, 0.0, 1.0);
  for (int i = 0; i < ${MAX_FIRES}; i++) {
    vec4 T = s5Fire[i];
    if (T.w <= 0.0) continue;
    vec3 L = T.xyz - vS5World; float d2 = dot(L, L);
    if (d2 > 110.0) continue;
    L *= inversesqrt(max(d2, 1e-4));
    float fall = pow(clamp(1.0 - d2 / 110.0, 0.0, 1.0), 2.0);
    float att = T.w * fall / (1.0 + d2 * 0.6);
    float nl = dot(s5N, L);
    s5D += att * clamp(nl * 0.8 + 0.2, 0.0, 1.0);
    vec3 H = s5SafeN(L + s5V);
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
  // env r32: cool architecture rake (opt-in s5ArchK) — broad wrap diffuse + the specular sheen any rough surface shows
  // under a broad source (Fresnel F0: ~4 % for stone whatever its albedo, the metal colour for brass). That sheen is why
  // the near-black recesses read as dark carved stone instead of a void; albedos are untouched.
  vec3 aD = vec3(0.0), aS = vec3(0.0);
  float s5Fr = pow(1.0 - clamp(dot(s5N, s5V), 0.0, 1.0), 5.0) * (1.0 - roughnessFactor) * 0.5;
  vec3 s5AreaF = mix(material.specularColorBlended, vec3(1.0), s5Fr);
  vec3 kc = vS5World - s5KeyFocus.xyz;      // throne focus sphere weight (0 outside, 1 at the centre)
  float kfoc = s5KeyK > 0.0 ? pow(clamp(1.0 - dot(kc, kc) / max(s5KeyFocus.w * s5KeyFocus.w, 1e-4), 0.0, 1.0), 2.0) : 0.0;
  if (s5ArchK > 0.0) {
    float aK = s5Arch.w * s5ArchK * mix(s5ArchBand.z, 1.0, smoothstep(s5ArchBand.x, s5ArchBand.y, vS5World.y)) * mix(1.0, s5KeyArch, kfoc);
    float aw = clamp(dot(s5N, s5Arch.xyz) * 0.6 + 0.4, 0.0, 1.0);
    float stoneD = pow(max(dot(s5N, s5Arch.xyz), 0.0), 1.35);
    float stoneS = pow(max(dot(s5N, s5SafeN(s5Arch.xyz + s5V)), 0.0), mix(18.0, 4.0, roughnessFactor));
    aD += s5ArchCol * aK * mix(aw, 0.12 + 0.88 * stoneD, s5Stone);
    aS += s5ArchCol * aK * mix(aw, stoneS * (1.5 - 0.65 * roughnessFactor), s5Stone) * s5AreaF;
  }
  // env r32: the same cool source seen in the LANE (opt-in s5LaneK: the floor) — a soft broad sheen on the worn obsidian
  // between the colonnade and the near edge, fading out toward the wall and the foreground; seams keep their cut
  if (s5LaneK > 0.0) {
    float lz = vS5World.z - s5Lane.y;
    float lb = smoothstep(s5Lane.z + s5Lane.w, s5Lane.z, abs(lz));
    // The previous constant F0 wash erased roughness and normal relief at belt distance. A broad reflected source
    // now follows slab slope and wear; it cannot outline grout because its existing specular cuts still apply.
    vec3 laneH = s5SafeN(s5SafeN(vec3(-0.4, 0.95, -0.3)) + s5V);
    float laneShape = pow(max(dot(s5N, laneH), 0.0), mix(15.0, 3.0, roughnessFactor));
    aS += s5ArchCol * (s5Lane.x * s5LaneK * lb) * s5AreaF * s5SpecK * laneShape * (1.65 - roughnessFactor * 0.65);
  }
  // env r32: warm throne key (opt-in s5KeyK), confined by the focus sphere: shaped throne relief + worn warm edges
  if (s5KeyK > 0.0) {
    vec3 KL = s5Key.xyz - vS5World; KL *= inversesqrt(max(dot(KL, KL), 1e-4));
    float kf = s5Key.w * s5KeyK * kfoc;
    float knl = dot(s5N, KL);
    aD += s5KeyCol * kf * pow(clamp(knl * s5KeyShape.x + s5KeyShape.y, 0.0, 1.0), max(s5KeyShape.z, 0.1));
    aS += s5KeyCol * kf * pow(max(dot(s5N, s5SafeN(KL + s5V)), 0.0), s5Shin) * (s5Shin + 8.0) / 25.0 * s5KeyShape.w * step(0.0, knl) * (0.3 + 0.7 * s5Wet)
        * (0.3 + s5F * 2.0) * s5SpecK;
  }
  reflectedLight.directDiffuse += material.diffuseColor * aD;
  reflectedLight.directSpecular += aS;
  // obsidian sheen: violet at grazing, faint emerald overhead (reads polished black glass)
  float sky = smoothstep(-0.3, 0.8, s5R.y);
  vec3 sheen = mix(vec3(0.05, 0.03, 0.09), vec3(0.02, 0.07, 0.045), sky);
  reflectedLight.indirectSpecular += sheen * s5F * s5Mirror * 1.6;
  totalEmissiveRadiance += s5Emit * surge;
}
`;

export function patchMaterial(mat, { surface = '', extraPars = '', vertPars = '', vertMain = '', uniforms = {}, glow = 0, key, archK = 0, throneK = 0, laneK = 0 } = {}) {
  const own = { s5Glow: { value: glow }, s5Gloss: { value: 1 }, s5ArchK: { value: archK }, s5KeyK: { value: throneK }, s5LaneK: { value: laneK }, ...uniforms };
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
  roughnessFactor = mix(0.88, 0.6, s5Wet);                             // env r32: rough stone 0.6-0.88 (was 0.45 wet)
  diffuseColor.rgb *= mix(1.0, 0.8, s5Wet);
} else if (m < 0.37) {                                                 // bronze / iron: hold mid-tone
  metalnessFactor = 0.85; roughnessFactor = 0.5 + 0.2 * grain;         // env r32: aged brass 0.5-0.7 (was 0.36-0.66)
  vec3 verd = vec3(0.10, 0.2, 0.15);                                  // verdigris in crevices
  diffuseColor.rgb = mix(max(diffuseColor.rgb, vec3(0.06)) * 1.5, verd, smoothstep(0.55, 0.8, blotch) * 0.45);
  s5Wet = 0.6;
} else if (m < 0.62) {                                                 // matte: bone, cloth, skin, wood
  roughnessFactor = 0.8; diffuseColor.rgb *= 0.9 + 0.2 * grain;
} else if (m < 0.88) {                                                 // worn obsidian accents
  // env r32: was a near-mirror (rough 0.08, mirror 0.85) that streaked every witchfire across pillars/throne → a
  // semi-gloss worn glass: broad edge sheen, short soft reflections
  roughnessFactor = 0.36 + 0.2 * smoothstep(0.5, 0.8, blotch);
  s5Mirror = 0.2 - 0.14 * smoothstep(0.5, 0.8, blotch); s5Wet = 0.7;
  metalnessFactor = 0.0;
} else {                                                               // glow
  s5Emit = diffuseColor.rgb * s5Glow * (0.85 + 0.15 * sin(s5Time * 3.0 + vS5World.x));
  roughnessFactor = 0.6;
}
// Basalt and obsidian only: broad fractured stone planes, restrained roughness pockets and dark contact grit.
// RGB/COLOR_0 is never raised, and categorical alpha remains the sole material selector.
if (m < 0.12 || (m >= 0.62 && m < 0.88)) {
  s5Stone = 0.65;
  // Horizontal ledge/dais tops need XZ mapping: the wall's XY projection would collapse to a one-dimensional stripe.
  bool stoneTop = abs(s5N.y) > 0.75;
  vec2 stoneUV = stoneTop ? vS5World.xz : wp;
  mat2 turn = mat2(0.8, -0.6, 0.6, 0.8);
  vec3 bed = s5ng(stoneUV * 3.6 + 5.7), grit = s5ng(turn * stoneUV * 10.5 + 21.3);
  vec3 cleft = s5cleft(stoneUV * 1.7 + 12.1);
  float broken = smoothstep(0.46, 0.65, blotch);
  float cut = (1.0 - smoothstep(0.006, 0.028, cleft.x)) * broken;
  vec2 slope = bed.yz * 0.025 + transpose(turn) * grit.yz * 0.085;
  slope += cleft.yz * (1.0 - smoothstep(0.015, 0.085, cleft.x)) * broken * 0.11;
  vec3 grad = stoneTop ? vec3(slope.x, 0.0, slope.y) : vec3(slope.x, slope.y, slope.x * 0.7);
  s5N = s5SafeN(s5N - (grad - s5N * dot(grad, s5N)));
  normal = normalize((viewMatrix * vec4(s5N, 0.0)).xyz);
  roughnessFactor = clamp(roughnessFactor + (bed.x - 0.45) * 0.12 + foot * 0.04 + cut * 0.12, 0.46, 0.96);
  diffuseColor.rgb *= (1.0 - 0.1 * smoothstep(0.65, 0.9, grit.x) * foot) * (1.0 - 0.22 * cut);
}
`;

export function kitMaterial({ glow = 2.5, key = 'kit' } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.FrontSide });
  return patchMaterial(m, {
    key, glow, archK: 1, throneK: 1,
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
