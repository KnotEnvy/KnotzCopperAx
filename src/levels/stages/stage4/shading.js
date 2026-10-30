// Stage 4 shared surface shading: every env material (stone kit, flagstones, drawbridge timber, moat) is a stock
// MeshStandardMaterial patched with onBeforeCompile so fog, shadows, the PMREM env and the post chain keep working.
// The patch adds:
//   - TORCH POOLS: up to 16 analytic warm point lights (s4Torch[i] = xyz, intensity) with wrap diffuse + wet
//     Blinn specular + a glossy mirror term (torch reflections streak in puddles / on wet slate). Real point lights are
//     limited to 2 by the budget, so the stage re-seats those on the torches nearest the camera for the ACTORS only.
//     s4Pool (per material, default 0 = the original reach) tightens the pools on the castle ARCHITECTURE only, so torch
//     warmth stays local to the fixtures and the broad stone reads cold grey (env-r33).
//   - WETNESS: up-facing surfaces darken + go glossy, puddles on the ground; the castle architecture gets gravity-driven,
//     STATIC weathering (env-r33): damp lower courses above the ground / moat line, runoff below real ledges and
//     gargoyle spouts, soot plumes above the torch fixtures, grimy ledge tops. Nothing in it moves with time.
//   - LIGHTNING: s4Flash scales a cold sky reflection (fresnel) on wet surfaces (the real flash light is a
//     DirectionalLight the storm owns).
//   - KIT MASKS: vertex colour alpha = 0 stone, .25 iron, .5 wood, .75 slate, 1 glow (emissive, s4Glow per material).
//   - STONE IDENTITY (env-r33 fix, Fable 5.1; board r2 4/4 "smooth manufactured panels"): on the castle architecture the
//     stone response is SHAPE and ROUGHNESS, not pigment: a static stone-scale relief normal in weathered patches, a
//     joint / underside shadow on every down-facing surface, the mortar bed (identified by vertex luminance) kept matte
//     and darker when damp, spatial roughness variation, mineral (iron/olive) runoff and sparse mid-wall rain-wash
//     stains. All darken-only; the per-stone broken planes, tone families and arris loss live in the supplement GLB.
import * as THREE from 'three';

export const MAX_TORCHES = 16;
export const S4 = {
  s4Torch: { value: Array.from({ length: MAX_TORCHES }, () => new THREE.Vector4(0, -100, 0, 0)) },
  s4TorchCol: { value: new THREE.Color('#ffa24c') },
  s4Flash: { value: 0 },
  s4FlashCol: { value: new THREE.Color('#b8c8ff') },
  s4Time: { value: 0 },
  s4Rain: { value: 1 },
  // env-r33: cold storm-sky fill for the castle architecture (per-material s4Cold, default 0 = none): soft wrap light
  // from the moon side, scaled by the surface's sky openness (s4Sky). Light, not albedo: the stone stays as authored.
  s4ColdCol: { value: new THREE.Color('#a8b6b4') },   // slate grey with a faint green-cyan bias: offsets the grade's violet mids
  s4ColdDir: { value: new THREE.Vector3(-0.32, 0.55, 0.77).normalize() },
};

// env-r33 kit weathering sources (static per build; kit materials only). setWeatherSources() fills them.
export const MAX_SOOT = 20;
export const MAX_DRIPS = 8;
export const S4W = {
  s4Soot: { value: Array.from({ length: MAX_SOOT }, () => new THREE.Vector4(0, -100, 0, 0)) },   // xyz flame, w strength
  s4Drip: { value: Array.from({ length: MAX_DRIPS }, () => new THREE.Vector4(0, -100, 0, 0)) },  // xyz spout, w strength
  s4WaterY: { value: -1.3 },     // the moat surface: damp courses start at max(module base, water)
  s4WeatherK: { value: 2 },      // weathering mask gain, masks saturate at 1 (integration knob vs. baked vertex-colour weathering)
};
/** Static soot / spout lists → kit uniforms. soot: [{x,y,z,k}] (flame position), drips: [{x,y,z,k}] (spout lip). */
export function setWeatherSources({ soot = [], drips = [] } = {}) {
  S4W.s4Soot.value.forEach((v, i) => { const s = soot[i]; if (s) v.set(s.x, s.y, s.z, s.k ?? 1); else v.set(0, -100, 0, 0); });
  S4W.s4Drip.value.forEach((v, i) => { const s = drips[i]; if (s) v.set(s.x, s.y, s.z, s.k ?? 1); else v.set(0, -100, 0, 0); });
}

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
uniform float s4Glow; uniform float s4Wet; uniform float s4Gloss; uniform float s4Pool; uniform float s4Cold;
uniform vec3 s4ColdCol; uniform vec3 s4ColdDir;
${GLSL_NOISE}
`;

// runs after normal_fragment_maps: world normal, wetness, per-mask PBR — BEFORE lights_physical_fragment reads them.
const FRAG_SURFACE = (surface) => /* glsl */`
vec3 s4N = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
vec3 s4V = normalize(cameraPosition - vS4World);
float s4WetM = 0.0;       // 0..1 how wet (glossy) this pixel is
float s4Mirror = 0.0;     // 0..1 mirror-like (puddles, wet slate)
vec3 s4Emit = vec3(0.0);
float s4Sky = 1.0;        // 0..1 sky openness for the cold fill (kit architecture sets it)
${surface}
roughnessFactor = clamp(roughnessFactor, 0.04, 1.0);
`;

// s4Pool 0 → the original pool reach (110 m² cut-off, 0.55 d² falloff; spec 0.12) and colour exactly; 1 → tight fixture
// pools whose colour is 28 % less saturated (amber on grey stone, not orange paint). s4Cold 0 → no cold fill.
const FRAG_LIGHT = /* glsl */`
{
  vec3 s4D = vec3(0.0), s4S = vec3(0.0);
  vec3 s4R = reflect(-s4V, s4N);
  float s4Shin = mix(6.0, 900.0, pow(1.0 - roughnessFactor, 3.0));
  float s4Cut = mix(110.0, 46.0, s4Pool), s4Kd = mix(0.55, 1.25, s4Pool), s4Ks = mix(0.12, 0.5, s4Pool);
  for (int i = 0; i < ${MAX_TORCHES}; i++) {
    vec4 T = s4Torch[i];
    if (T.w <= 0.0) continue;
    vec3 L = T.xyz - vS4World; float d2 = dot(L, L);
    if (d2 > s4Cut) continue;
    L *= inversesqrt(d2);
    float fall = pow(clamp(1.0 - d2 / s4Cut, 0.0, 1.0), 2.0);
    float att = T.w * fall / (1.0 + d2 * s4Kd);
    float nl = dot(s4N, L);
    s4D += att * clamp(nl * 0.8 + 0.2, 0.0, 1.0);
    vec3 H = normalize(L + s4V);
    float spec = pow(max(dot(s4N, H), 0.0), s4Shin) * (s4Shin + 8.0) / 25.0;
    float mir = pow(max(dot(s4R, L), 0.0), mix(60.0, 1400.0, s4Mirror)) * mix(2.0, 26.0, s4Mirror);
    s4S += T.w * fall / (1.0 + d2 * s4Ks) * (spec * 0.25 * step(0.0, nl) + mir * s4Mirror) * (0.25 + 0.75 * s4WetM);
  }
  float s4F = 0.04 + 0.96 * pow(1.0 - clamp(dot(s4N, s4V), 0.0, 1.0), 5.0);
  vec3 s4TC = mix(vec3(dot(s4TorchCol, vec3(0.2126, 0.7152, 0.0722))), s4TorchCol, 1.0 - 0.28 * s4Pool);
  reflectedLight.directDiffuse += material.diffuseColor * s4TC * s4D;
  reflectedLight.directSpecular += s4TC * s4S * (0.3 + s4F * 2.0);
  if (s4Cold > 0.0) reflectedLight.indirectDiffuse += material.diffuseColor * s4ColdCol * (s4Cold * s4Sky * clamp(dot(s4N, s4ColdDir) * 0.35 + 0.65, 0.0, 1.0));
  // storm sky in the wet: a faint cold sheen, blazing on lightning
  float sky = smoothstep(-0.2, 0.6, s4R.y);
  reflectedLight.indirectSpecular += s4FlashCol * (0.012 + s4Flash * 0.35) * sky * s4F * s4WetM * (1.0 + s4Mirror * 3.0);
  totalEmissiveRadiance += s4Emit;
}
`;

/**
 * Patch a MeshStandardMaterial with the stage-4 shading. `surface` = GLSL run after normals (may set roughnessFactor,
 * metalnessFactor, diffuseColor, s4WetM, s4Mirror, s4Emit, and may use s4N, s4V, vS4World). extraPars = GLSL decls.
 * `pool` (0..1, default 0) tightens the analytic torch pools for this material only; `cold` (default 0) adds the cold sky fill.
 */
export function patchMaterial(mat, { surface = '', extraPars = '', vertPars = '', vertMain = '', uniforms = {}, glow = 0, wet = 1, pool = 0, cold = 0, key } = {}) {
  const own = { s4Glow: { value: glow }, s4Wet: { value: wet }, s4Gloss: { value: 1 }, s4Pool: { value: pool }, s4Cold: { value: cold }, ...uniforms };
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
// env-r33 diagnosis of the donor KIT_SURFACE (why cool-grey vertex colours rendered as terracotta toy blocks):
//   - the 16 analytic torch pools reached ~10.5 m with a soft 1/(1+.55 d²) falloff: on the back walls (sconces every
//     6-8 m, braziers 1.6 m off the face) torch diffuse was ~7x the cold moon key everywhere → orange walls;
//   - a warm albedo tint (1.04, 1, .95) on all stone; ±14 % per-brick grain + ±20 % fbm 'blotch' camouflage on
//     every block; a streak noise that crawled with s4Time (moving grime);
//   - every vertical face ≥ .25 wet with up-facing bevels at roughness .34 → a white glint grid on course bevels.
// The candidate keeps non-stone masks byte-for-byte in behaviour (the donor block below), and gives STONE a quiet,
// luminance-preserving cold-grey response with causal, static weathering on the architecture (s4Arch = 1).
const KIT_PARS = /* glsl */`
varying float vS4Mask; varying vec4 vS4Inst;
uniform float s4Arch; uniform float s4Ledge[4]; uniform float s4ReliefK;
uniform vec4 s4Soot[${MAX_SOOT}]; uniform vec4 s4Drip[${MAX_DRIPS}]; uniform float s4WaterY; uniform float s4WeatherK;
// env-r33 fix: static stone-scale relief height (metres): 2 octaves, 2.4 + 5.3 cycles/m (29 / 13 px at the 72 px/m game
// camera: broad mottled relief, not grain), ~5 mm peak. Sampled 4x per relieved architecture pixel (tangent-frame slopes).
float s4relief(vec3 p) { vec2 q = vec2(p.x + p.z * 0.7, p.y); return 0.005 * s4n(q * 2.4 + 5.0) + 0.0025 * s4n(q * 5.3 + 17.0); }
`;
const KIT_VERT_MAIN = /* glsl */`
#ifdef USE_COLOR_ALPHA
 vS4Mask = color.a;
#else
 vS4Mask = 0.0;
#endif
{ vec4 s4o = vec4(0.0, 0.0, 0.0, 1.0); float s4sc = 1.0;
#ifdef USE_INSTANCING
  s4o = instanceMatrix * s4o; s4sc = length(instanceMatrix[1].xyz);
#endif
  s4o = modelMatrix * s4o; vS4Inst = vec4(s4o.xyz, s4sc * length(modelMatrix[1].xyz)); }
`;

const KIT_SURFACE = /* glsl */`
float m = vS4Mask;
diffuseColor.a = 1.0;
float up = smoothstep(0.35, 0.9, s4N.y);
float s4Stone = 1.0 - step(0.12, m);
float bed = 0.0, s4Rough = 0.0;   // env-r33 fix: mortar-bed id (architecture stone) and stone-scale roughness offset
if (s4Stone < 0.5) {
  // NON-STONE (iron .25 / wood .5 / slate .75 / glow 1): the donor response, unchanged
  float st = s4n(vec2((vS4World.x + vS4World.z) * 3.1, vS4World.y * 0.35 - s4Time * 0.05));
  float streak = smoothstep(0.55, 0.85, st) * (1.0 - up) * step(abs(s4N.y), 0.6);
  float grain = s4n(vS4World.xy * 2.7 + vS4World.zx * 1.9);
  vec2 wp = vec2(vS4World.x + vS4World.z * 0.7, vS4World.y);
  float blotch = s4fbm(wp * 0.45 + 3.0);
  float drip = smoothstep(0.5, 0.8, s4n(vec2(wp.x * 1.3, wp.y * 0.12))) * (1.0 - up);
  diffuseColor.rgb *= (0.86 + 0.28 * grain) * (0.62 + 0.7 * blotch) * (1.0 - drip * 0.35);
  s4WetM = clamp(up * 0.9 + streak * 0.7 + 0.25, 0.0, 1.0) * s4Wet;
} else {
  // STONE: cold grey mineral. Luminance-preserving de-violet (no warm tint: warmth comes from torch light), one broad
  // mineral drift across groups of stones (metres scale, low amplitude) instead of per-block grain/blotch.
  float lumK = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 alb = mix(vec3(lumK), diffuseColor.rgb, 0.45);
  vec2 wp = vec2(vS4World.x + vS4World.z * 0.7, vS4World.y);
  float mineral = s4n(wp * vec2(0.17, 0.31) + 11.0);
  alb *= mix(vec3(0.92, 0.93, 0.955), vec3(1.0, 0.99, 0.965), mineral);   // never lifts: linear albedo stays <= donor distribution
  float wetS = clamp(up * 0.9 + 0.3, 0.0, 1.0);
  if (s4Arch > 0.5) {
    // env-r33 integration: the r33 ashlar's stone faces are nearly one tone (visible albedo p50→p90 ±4 %); a coherent
    // mineral variation across groups of 1-3 stones (≈1.6 × 1.0 m), darken-only (≤ 10 %), cool-blue vs warm-olive grey.
    // Not per-block grain: one smooth field, no time term.
    float mg = s4n(wp * vec2(0.62, 1.0) + vec2(37.0, 5.0));
    alb *= mix(mix(vec3(0.9, 0.905, 0.93), vec3(0.93, 0.915, 0.88), s4n(wp * vec2(0.23, 0.4) + 71.0)), vec3(1.0), smoothstep(0.28, 0.72, mg));
    float sc = max(vS4Inst.w, 1e-3);
    float hl = (vS4World.y - vS4Inst.y) / sc;                                // module-local height (ledge table frame)
    float bay = s4h(vec2(floor(vS4Inst.x * 0.25 + 0.5) + vS4Inst.z * 0.37, 5.3)); // per-bay seed: bay-scale variation
    float u = vS4World.x + vS4World.z * 0.6;                                 // along-face coordinate
    float wk = s4WeatherK;
    // 1) damp lower courses above the wet base (courtyard floor or the moat surface): wavy tide line, splash foot
    float hw = vS4World.y - max(vS4Inst.y, s4WaterY);
    float tide = 1.35 + 0.7 * bay + 0.6 * (s4n(vec2(u * 0.42 + bay * 9.0, 1.7)) - 0.5);
    float damp = min(1.0, (1.0 - smoothstep(tide - 0.7, tide + 0.05, hw)) * wk);
    float foot = 1.0 - smoothstep(0.0, 0.65, hw);
    // 2) runoff below the module's real ledges (corbels / string courses / plinth): sparse static columns that taper
    float c1 = s4n(vec2(u * 1.55 + bay * 13.0, 4.1));
    float c2 = s4n(vec2(u * 4.6, 9.7 + bay * 5.0));
    float len = 2.4 + 3.6 * s4n(vec2(u * 0.65 + 3.0, 2.3 + bay * 3.0));                 // env-r33 fix: longer streaks
    float run = 0.0, under = 0.0;
    for (int k = 0; k < 4; k++) {
      float Lk = s4Ledge[k];
      if (Lk < -50.0) continue;
      float d = (Lk - hl) * sc;                                              // metres below the ledge's drip edge
      if (d < 0.0 || d > 5.2) continue;
      float tp = d / len;
      float colM = smoothstep(0.40 + 0.18 * tp, 0.70, c1) * (0.5 + 0.5 * smoothstep(0.3, 0.72, c2));   // env-r33 fix: denser columns
      run = max(run, colM * smoothstep(0.0, 0.12, d) * (1.0 - smoothstep(0.25, 1.0, tp)));
      under = max(under, (1.0 - smoothstep(0.05, 0.32, d)) * (0.6 + 0.4 * c2));
    }
    // 3) gargoyle spouts: a narrow wet stain fanning down the face below each spout
    for (int i = 0; i < ${MAX_DRIPS}; i++) {
      vec4 G = s4Drip[i];
      if (G.w <= 0.0 || abs(vS4World.z - G.z) > 1.8) continue;
      float dx = vS4World.x - G.x, d = G.y - vS4World.y;
      if (d < 0.0 || d > 5.5 || abs(dx) > 1.3) continue;
      float w = 0.18 + 0.09 * d;
      run = max(run, G.w * exp(-dx * dx / (w * w)) * (1.0 - smoothstep(2.2, 5.5, d)) * (0.65 + 0.35 * c2));
    }
    run = min(1.0, run * wk); under = min(1.0, under * wk * 0.5);
    // 4) soot plumes above the torch fixtures / braziers by the wall (static list: no flicker, no popping)
    float soot = 0.0;
    for (int i = 0; i < ${MAX_SOOT}; i++) {
      vec4 S = s4Soot[i];
      if (S.w <= 0.0) continue;
      float dz = abs(vS4World.z - S.z);
      if (dz > 2.6) continue;
      float dx = vS4World.x - S.x;
      if (abs(dx) > 2.2) continue;
      float dy = vS4World.y - S.y;
      float w = 0.2 + 0.22 * max(dy, 0.0);
      float pl = exp(-dx * dx / (w * w)) * smoothstep(-0.3, 0.25, dy) * (1.0 - smoothstep(0.9 * S.w, 3.3 * S.w, dy));
      soot = max(soot, pl * (1.0 - smoothstep(0.7, 2.6, dz)) * (0.72 + 0.28 * s4n(vec2(dx * 4.0 + S.x, dy * 1.6))));
    }
    soot = min(1.0, soot * wk);
    // ---- env-r33 fix (Fable): stone identity as SHAPE and ROUGHNESS, not pigment ----------------------------------
    // mortar bed by vertex luminance (the supplement bakes the bed at #252b31 = 0.023 linear; the darkest damp stone
    // family stays above 0.044). The bevel ring interpolates bed -> stone, so the arrises get a partial bed treatment.
    bed = 1.0 - smoothstep(0.030, 0.044, lumK);
    // joint / underside shadow: every down-facing surface (the stones' wider bottom arrises, corbel undersides) is occluded
    float down = smoothstep(0.2, 0.7, -s4N.y) * (1.0 - bed);
    // a few rain-wash stains mid-wall starting below joints: sparse 0.25 m columns, 0.9-2.6 m long, no stencil edges
    float on = 1.2 + 5.5 * s4n(vec2(u * 0.9 + bay * 4.0, 2.0 + bay));
    float dd = on - hl;
    float wash = smoothstep(0.62, 0.82, s4n(vec2(u * 4.0 + bay * 5.0, 6.3))) * smoothstep(0.0, 0.15, dd)
               * (1.0 - smoothstep(0.5, 0.9 + 1.7 * s4n(vec2(u * 0.7, 9.0 + bay)), dd)) * (0.7 + 0.3 * c2);
    // stone-scale RELIEF: the static height field bump-maps the broad faces in weathered patches only (coherent
    // 0.45 cycles/m mask, more where water goes: damp / runoff / wash), never on the bed; fades out by 70 m (far keep).
    float relM = (1.0 - bed) * smoothstep(0.25, 0.65, s4n(wp * 0.45 + 23.0)) * (0.55 + 0.45 * max(damp, max(run, wash)));
    relM *= 1.0 - smoothstep(35.0, 70.0, length(cameraPosition - vS4World));
    if (relM > 0.002) {
      // analytic tangent-frame finite differences (NO screen-space derivatives: dFdx of the world position breaks at the
      // joint recesses and facet edges and printed dashed outlines in the first probe); 1 cm steps, slope -> tilt
      vec3 s4Up = abs(s4N.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
      vec3 s4T = normalize(cross(s4Up, s4N)), s4B = cross(s4N, s4T);
      float hx = s4relief(vS4World + s4T * 0.01) - s4relief(vS4World - s4T * 0.01);
      float hy = s4relief(vS4World + s4B * 0.01) - s4relief(vS4World - s4B * 0.01);
      s4N = normalize(s4N - (hx * s4T + hy * s4B) * (50.0 * relM * s4ReliefK));
      normal = normalize((viewMatrix * vec4(s4N, 0.0)).xyz);
    }
    // roughness varies across 0.6-0.9 m patches (dry rough vs rain-polished stone); relief patches read drier
    s4Rough = (s4n(wp * vec2(1.1, 1.6) + 41.0) - 0.5) * 0.22 + relM * 0.10;
    // sky openness for the cold fill: the foot of a wall sees less sky; drip edges / recess under ledges are sheltered
    s4Sky = mix(0.45, 1.0, smoothstep(0.0, 5.5, hw)) * (1.0 - under * 0.35);
    alb *= mix(1.0, 0.5, damp);
    alb = mix(alb, alb * vec3(0.84, 0.95, 0.88), foot * damp * 0.55);       // faint algae at the splash foot
    alb = mix(alb, alb * vec3(0.56, 0.53, 0.47), run);                    // env-r33 fix: mineral (iron/olive) runoff stain, luma x0.53
    alb *= 1.0 - under * 0.22;                                               // env-r33 fix: 0.16 -> 0.22 drip line under ledges
    alb *= mix(1.0, 0.8, min(1.0, up * 0.3 * wk));                                    // grimy, wet ledge tops
    alb *= 1.0 - down * 0.38;                                                // env-r33 fix: joint / underside shadow
    alb = mix(alb, alb * vec3(0.56, 0.53, 0.47), wash * 0.45);               // env-r33 fix: mid-wall rain-wash stain
    alb *= 1.0 - bed * (0.05 + 0.10 * damp);                                 // env-r33 fix: the bed holds water: darker when damp
    alb = mix(alb, alb * vec3(0.3, 0.285, 0.275), soot * 0.9);              // soot: darkening, faint warm-black
    // env-r33 fix: facets / relief tilting up catch the rain (wetter, glossier); the porous bed stays drier
    wetS = clamp(0.26 + up * 0.35 + max(damp, run) * 0.6 + 0.2 * smoothstep(0.02, 0.14, s4N.y) * (1.0 - bed) - bed * 0.15, 0.0, 1.0);
  }
  diffuseColor.rgb = alb;
  s4WetM = wetS * s4Wet;
}
roughnessFactor = mix(0.9, mix(0.34, 0.58, s4Arch * s4Stone), s4WetM);   // wet stone architecture: satin, not glass
roughnessFactor = clamp(roughnessFactor + s4Rough * s4Arch * s4Stone, 0.3, 1.0);   // env-r33 fix: spatial roughness variation
roughnessFactor = mix(roughnessFactor, 0.95, bed * s4Arch * s4Stone);              // env-r33 fix: the mortar bed is matte
// env-r33 integration: the r33 ashlar's course tops and 8-20 mm arrises project to sub-pixel strips at the game camera;
// the moon key and the rim light glinted on them as a dashed white line along every course. Up-facing ARCHITECTURE stone
// stays matte (broad faces keep the satin wet response; floor, statues and props are not architecture).
roughnessFactor = mix(roughnessFactor, max(roughnessFactor, 0.92), s4Arch * s4Stone * smoothstep(0.25, 0.6, s4N.y));
metalnessFactor = 0.0;
if (abs(m - 0.25) < 0.12) { metalnessFactor = 0.8; roughnessFactor = mix(0.5, 0.28, s4WetM); diffuseColor.rgb = max(diffuseColor.rgb, vec3(0.05)) * 1.6; }
else if (abs(m - 0.5) < 0.12) { roughnessFactor = mix(0.85, 0.45, s4WetM); }
else if (abs(m - 0.75) < 0.12) { roughnessFactor = mix(0.55, 0.16, s4WetM); s4Mirror = 0.35 * s4WetM; }
else if (m > 0.88) { s4Emit = diffuseColor.rgb * s4Glow; roughnessFactor = 0.6; }
diffuseColor.rgb *= mix(1.0, 0.72, s4WetM * (1.0 - step(0.88, m)));
`;

/**
 * Kit material. arch = null → statues / gargoyles / sigils / animated pieces (donor torch reach, no weathering);
 * arch = { ledges: [module-local y of drip edges, ≤ 4] } → castle architecture (tight torch pools, static weathering,
 * env-r33 fix stone identity; relief = gain of the stone-scale relief normal, 1.8 = authored, 0 = off).
 * One shared program for every kit material (same key/text); per-material uniform values only.
 */
export const KIT_COLD = 0.85;   // cold sky fill on the architecture (tuned at 1600x900 against the blueprint's value bands)
export const KIT_POOL = 0.75;  // torch-pool tightening on the architecture (0 = donor reach, 1 = tightest)
export function kitMaterial({ glow = 2.5, key = 'kit', arch = null, relief = 1.8 } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.FrontSide });
  const led = [0, 1, 2, 3].map((i) => (arch && arch.ledges && arch.ledges[i] !== undefined ? arch.ledges[i] : -99));
  return patchMaterial(m, {
    key,
    glow,
    pool: arch ? KIT_POOL : 0,
    cold: arch ? KIT_COLD : 0,
    uniforms: { s4Arch: { value: arch ? 1 : 0 }, s4Ledge: { value: led }, s4ReliefK: { value: arch ? relief : 0 }, ...S4W },
    vertPars: 'varying float vS4Mask; varying vec4 vS4Inst;\n',
    vertMain: KIT_VERT_MAIN,
    extraPars: KIT_PARS,
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
