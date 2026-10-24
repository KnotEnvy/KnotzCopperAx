// Shared shader plumbing for the game-wide look (look-dev owns this file).
//
//   shared.uTime / uNoise / uWind     global uniform objects (the SAME object is plugged into every material that
//                                     uses them, so Renderer updates one value per frame). uWind = (dirX, dirZ, strength, gust)
//   noiseTexture()                    256² tileable RGBA data noise: R = fbm (period 4) · G = fbm (period 8, other seed)
//                                     · B = fine fbm (period 32) · A = cellular F1 (period 8, 0 at cell centres)
//   GLSL.common                       helpers: kTri() triplanar, kBump() derivative bump, kHash(), kLuma(), kWindOffset()
//   patchStandard(material, spec)     inject custom albedo / roughness / emissive / bump / vertex code into a built-in
//                                     MeshStandard/Physical material while keeping three's lighting, shadows and fog.
//                                     spec = { key, uniforms, defines, vertHead, vertMain, fragHead, albedo, rough,
//                                              emissive, bump, fragEnd }. World pos/normal arrive as vKW / vKN, uv as vKUv,
//                                     the per-vertex `kmask` attribute (vec4, only with spec.useMask; the geometry MUST have it) as vKM.
import * as THREE from 'three';

export const shared = {
  uTime: { value: 0 },
  uNoise: { value: null },
  uWind: { value: new THREE.Vector4(1, 0, 0.6, 1) },
};

// ---------------------------------------------------------------- tileable noise
function hash2(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h >>> 0;
}
function gnoise(x, y, px, py, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const g = (ix, iy, dx, dy) => {
    const h = hash2(((ix % px) + px) % px, ((iy % py) + py) % py, seed);
    const a = ((h & 4095) / 4095) * Math.PI * 2;
    return Math.cos(a) * dx + Math.sin(a) * dy;
  };
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = g(x0, y0, fx, fy), b = g(x0 + 1, y0, fx - 1, fy), c = g(x0, y0 + 1, fx, fy - 1), d = g(x0 + 1, y0 + 1, fx - 1, fy - 1);
  return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
}
function fbm(x, y, period, oct, seed) {
  let amp = 0.5, f = 1, s = 0, n = 0;
  for (let o = 0; o < oct; o++) { s += amp * gnoise(x * f, y * f, period * f, period * f, seed + o * 17); n += amp; amp *= 0.5; f *= 2; }
  return s / n;
}
function worley(x, y, period, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  let best = 9;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = x0 + i, cy = y0 + j;
    const h = hash2(((cx % period) + period) % period, ((cy % period) + period) % period, seed);
    const fx = cx + (h & 1023) / 1023, fy = cy + ((h >>> 10) & 1023) / 1023;
    const d = Math.hypot(fx - x, fy - y);
    if (d < best) best = d;
  }
  return best;
}

let _noiseTex = null;
export function noiseTexture() {
  if (_noiseTex) return _noiseTex;
  const N = 256, data = new Uint8Array(N * N * 4);
  const ch = [new Float32Array(N * N), new Float32Array(N * N), new Float32Array(N * N), new Float32Array(N * N)];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const u = i / N, v = j / N, k = j * N + i;
    ch[0][k] = fbm(u * 4, v * 4, 4, 5, 11);
    ch[1][k] = fbm(u * 8, v * 8, 8, 4, 23);
    ch[2][k] = fbm(u * 32, v * 32, 32, 3, 37);
    ch[3][k] = worley(u * 8, v * 8, 8, 51);
  }
  for (let c = 0; c < 4; c++) {
    let lo = Infinity, hi = -Infinity;
    for (const x of ch[c]) { if (x < lo) lo = x; if (x > hi) hi = x; }
    const s = 255 / Math.max(1e-6, hi - lo);
    for (let k = 0; k < N * N; k++) data[k * 4 + c] = Math.max(0, Math.min(255, Math.round((ch[c][k] - lo) * s)));
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 4; t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true; t.name = 'kcaNoise';
  _noiseTex = t;
  shared.uNoise.value = t;
  return t;
}

// ---------------------------------------------------------------- GLSL helpers
export const GLSL = {
  common: /* glsl */`
uniform sampler2D kNoise;
uniform float kTime;
uniform vec4 kWind;
float kLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float kHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec4 kN(vec2 p) { return texture2D(kNoise, p); }
vec4 kTri(vec3 p, vec3 n, float s) {
  vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z + 1e-5);
  return texture2D(kNoise, p.zy * s) * w.x + texture2D(kNoise, p.xz * s) * w.y + texture2D(kNoise, p.xy * s) * w.z;
}
`,
  frag: /* glsl */`
vec3 kBump(vec3 surfPos, vec3 surfNorm, float h, float strength, float faceDir) {
  vec3 sx = dFdx(surfPos), sy = dFdy(surfPos);
  vec2 dh = vec2(dFdx(h), dFdy(h)) * strength;
  vec3 r1 = cross(sy, surfNorm), r2 = cross(surfNorm, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (dh.x * r1 + dh.y * r2);
  vec3 n = abs(det) * surfNorm - grad;
  float l = length(n);
  return l > 1e-6 ? n / l : surfNorm;
}
`,
  wind: /* glsl */`
// Wind displacement for foliage: 'h' is 0 at the root and 1 at the tip.
vec3 kWindOffset(vec3 wp, float h, float stiff) {
  vec2 dir = normalize(kWind.xy + vec2(1e-4, 0.0));
  float gust = texture2D(kNoise, (wp.xz - dir * kTime * 3.2) * 0.018).r;
  gust = smoothstep(0.35, 0.85, gust) * kWind.w;
  float sway = sin(kTime * 2.1 + wp.x * 0.6 + wp.z * 0.35) * 0.35 + sin(kTime * 3.7 + wp.x * 1.3) * 0.15;
  float bend = (kWind.z * (0.55 + sway) + gust * 1.1) * h * h / stiff;
  return vec3(dir.x * bend, -abs(bend) * 0.35, dir.y * bend);
}
`,
};

// ---------------------------------------------------------------- material patching
/**
 * Inject custom code into a MeshStandardMaterial / MeshPhysicalMaterial (or Lambert/Phong for albedo only).
 * Chained with any existing onBeforeCompile. Returns the material.
 */
export function patchStandard(material, spec) {
  noiseTexture();
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  const key = spec.key || 'kcaPatch';
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(material, shader, renderer);
    shader.uniforms.kNoise = shared.uNoise;
    shader.uniforms.kTime = shared.uTime;
    shader.uniforms.kWind = shared.uWind;
    if (spec.uniforms) for (const k in spec.uniforms) shader.uniforms[k] = spec.uniforms[k];
    const defs = spec.defines ? Object.entries(spec.defines).map(([k, v]) => `#define ${k} ${v}`).join('\n') + '\n' : '';
    const varyings = 'varying vec3 vKW;\nvarying vec3 vKN;\nvarying vec2 vKUv;\nvarying vec4 vKM;\n';
    let vs = shader.vertexShader;
    vs = vs.replace('#include <common>', `#include <common>\n${defs}${varyings}${spec.useMask ? 'attribute vec4 kmask;\n' : ''}${GLSL.common}${GLSL.wind}${spec.vertHead || ''}`);
    // World position/normal (instancing aware); spec.vertMain may displace `transformed` BEFORE projection.
    if (spec.normalMain) vs = vs.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${spec.normalMain}`);
    vs = vs.replace('#include <begin_vertex>', `#include <begin_vertex>
  vKUv = uv; ${spec.useMask ? 'vKM = kmask;' : 'vKM = vec4(0.0, 0.0, 0.0, 1.0);'}
  {
    vec4 kwp0 = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      kwp0 = instanceMatrix * kwp0;
    #endif
    vKW = (modelMatrix * kwp0).xyz;
  }
  ${spec.vertMain || ''}
  {
    vec4 kwp = vec4(transformed, 1.0);
    vec3 kn = objectNormal;
    #ifdef USE_INSTANCING
      kwp = instanceMatrix * kwp; kn = mat3(instanceMatrix) * kn;
    #endif
    vKW = (modelMatrix * kwp).xyz;
    vKN = normalize(mat3(modelMatrix) * kn);
  }`);
    shader.vertexShader = vs;
    let fs = shader.fragmentShader;
    fs = fs.replace('#include <common>', `#include <common>\n${defs}${varyings}${GLSL.common}${GLSL.frag}${spec.fragHead || ''}`);
    if (spec.albedo) fs = fs.replace('#include <map_fragment>', `#include <map_fragment>\n{\n${spec.albedo}\n}`);
    if (spec.rough) fs = fs.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n{\n${spec.rough}\n}`);
    if (spec.bump) fs = fs.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n{\n${spec.bump}\n}`);
    if (spec.emissive) fs = fs.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n{\n${spec.emissive}\n}`);
    if (spec.fragEnd) fs = fs.replace('#include <opaque_fragment>', `{\n${spec.fragEnd}\n}\n#include <opaque_fragment>`);
    shader.fragmentShader = fs;
  };
  material.customProgramCacheKey = () => (prevKey ? prevKey.call(material) : '') + '|' + key;
  material.userData.kcaPatched = key;
  return material;
}

// ---------------------------------------------------------------- order-free program keys (perf-1650)
const PROTO_KEY = THREE.Material.prototype.customProgramCacheKey;
const COMMUTING_TAGS = ['|bossLook', '|kcaChar4c', '|kcaHitFlash1'];   // |bossLook: enemies/bosses/_look.js (uniform swap only)
/**
 * Program cache key for a chained patch whose shader edits COMMUTE with the other COMMUTING_TAGS patches (character
 * look: common + before opaque_fragment; hit flash: common + emissivemap_fragment). three's default key is the CURRENT
 * outermost onBeforeCompile's source text, so "look then flash" and "flash then look" produced two keys → a second
 * program linked mid-fight for every foe whose patches ran in the other order (perfbench S2/S3 boss). Here the base
 * is the ORIGINAL onBeforeCompile (captured at patch time) and the commuting tags are sorted → one key either way.
 */
export function orderFreeKey(m, prevKey, prevObc, tag) {
  let base = !prevKey || prevKey === PROTO_KEY ? (prevObc ? String(prevObc) : '') : prevKey.call(m);
  const tags = [tag];
  for (const t of COMMUTING_TAGS) if (base.includes(t)) { base = base.split(t).join(''); tags.push(t); }
  return base + [...new Set(tags)].sort().join('');
}
