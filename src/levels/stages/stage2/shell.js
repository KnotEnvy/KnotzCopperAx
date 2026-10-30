// Stage 2 — continuous weathered carapace. The low vertebral scutes carry the fight belt;
// a broad costal flank behind it meets the nuchal hood and neck, while the near marginal
// rim curls into the lake. Ground heights and visible plate relief share one analytic surface.
// Horn scutes (env-r33 fix): dark quiet centres, worn lighter perimeters carrying short broken
// growth-layer edges that follow the plate edges, cloudy tortoiseshell pigment, narrow broken worn
// bevels beside the seams and a restrained worn satin. No centre-radius field, no radial fibres (together they read
// as sawn end grain), no complete contours. Moss and lichen remain confined to the seams.
import * as THREE from 'three';
import { patchStandard } from '../../../render/shaderlib.js';
import { smooth } from '../stage1/geo.js';

export const WATER_Y = -1.0;    // mean lake level
export const CZ = -0.3;         // crest line (world z)
export const BELT = { near: 2.8, far: -3.1 };
// waterline footprint used by the water shader (centre z, near waterline z)
export const ZC = -1.2;
export const LIP_Z = 3.55;
export const FRONT = { x0: 76, len: 16 };    // shell rounds down into the lake over [76, 92]
export const BACK = { x0: -5, len: 15 };     // and over [-5, -20]

// ---------------------------------------------------------------------------------------------- plate lattice
// Two interleaved rectangular lattices form hexagonal vertebral/costal scutes. Distances
// stay polygonal: a narrow bevel supports a nearly flat plate, rather than a rounded mound.
// The same metric is evaluated in the shader and groundAt, including the marginal row.
export const PV = 7.0, OV = 4.0, PM = 3.5;
const fract = (a) => a - Math.floor(a);
const HEX = 5.4, X_STRETCH = 1.18, SQRT3 = Math.sqrt(3);
function hexCell(x, w) {
  x += 0.19 * Math.sin(w * 1.3) + 0.09 * Math.sin(x * 1.7 + w);
  w += 0.14 * Math.sin(x * 1.15);
  const px = (x - 1.6) / (HEX * X_STRETCH), py = (w + 0.55) / HEX;
  const ax = px - Math.floor(px / SQRT3 + 0.5) * SQRT3, ay = py - Math.floor(py + 0.5);
  const bx = px - (Math.floor(px / SQRT3) + 0.5) * SQRT3, by = py - (Math.floor(py) + 0.5);
  const a = ax * ax + ay * ay < bx * bx + by * by;
  const lx = a ? ax : bx, ly = a ? ay : by;
  return { e: Math.max(0, Math.min(0.5 - Math.abs(ly), 0.5 - Math.abs(lx) * Math.sqrt(0.75) - Math.abs(ly) * 0.5) * HEX),
    id: Math.round((px - lx) / SQRT3 * 2) + 41 * Math.round((py - ly) * 2) };
}
export function plate(x, w) {
  if (w > 2.6) {
    const d = Math.abs(fract((x - OV) / PM + 0.5) - 0.5) * PM;
    return { e: Math.max(0, Math.min(w - 2.6, d)), row: 2, id: Math.floor((x - OV) / PM), emax: 1.2 };
  }
  const h = hexCell(x, w);
  return { e: Math.min(h.e, 2.6 - w), row: w < -3.3 ? 1 : 0, id: h.id, emax: HEX * 0.5 };
}
export function bulge(x, w) {
  const p = plate(x, w);
  return 0.022 * smooth(0.015, 0.095, p.e) + 0.009 * Math.min(1, p.e / p.emax)
    - 0.008 * (1 - smooth(0.0, 0.045, p.e));
}

// ---------------------------------------------------------------------------------------------- cross-section
/** Belt crown (canonical z → y): highest just behind the lane centre, rolling toward both edges. */
export const camber = (z) => 0.12 - 0.035 * (z - CZ) * (z - CZ) - 0.2 * smooth(1.2, 2.8, z);
const farY = (d) => camber(BELT.far) + 0.45 * Math.sin(Math.min(d / 10, 1) * Math.PI) - 0.018 * d * d;        // d = metres past the far belt edge
function profile() {
  const P = [];
  // near: the marginal rim curling down under the lake (listed bottom → top)
  const nearPts = [[3.15, -3.4], [3.28, -2.3], [3.35, -1.6], [3.45, -1.05], [3.62, -0.72], [3.96, -0.54], [3.98, -0.43], [3.65, -0.36], [3.22, -0.33], [2.9, -0.36]];
  for (const [z, y] of nearPts) P.push({ z, y, kind: 'm' });
  for (let z = 2.8; z > BELT.far - 0.01; z -= 0.2) P.push({ z, y: camber(z), kind: 'b' });
  for (let d = 0.3; d <= 14.01; d += d < 3 ? 0.3 : 0.5) P.push({ z: BELT.far - d, y: farY(d), kind: 'c' });
  // unrolled coordinate w: z on the belt, arc length beyond the belt edges
  const iN = P.findIndex((p) => p.kind === 'b');
  const iF = P.length - 1 - [...P].reverse().findIndex((p) => p.kind === 'b');
  for (let i = iN; i <= iF; i++) P[i].w = P[i].z;
  for (let i = iN - 1; i >= 0; i--) P[i].w = P[i + 1].w + Math.hypot(P[i].z - P[i + 1].z, P[i].y - P[i + 1].y);
  for (let i = iF + 1; i < P.length; i++) P[i].w = P[i - 1].w - Math.hypot(P[i].z - P[i - 1].z, P[i].y - P[i - 1].y);
  // outward normals of the section (for the plate relief)
  for (let i = 0; i < P.length; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
    let tz = b.z - a.z, ty = b.y - a.y; const L = Math.hypot(tz, ty) || 1; tz /= L; ty /= L;
    // traversal runs near → far (z decreasing on top), so the outward normal is (-ty, tz) rotated to point up
    let nz = ty, ny = -tz; if (ny < 0 && P[i].kind === 'b') { nz = -nz; ny = -ny; }
    P[i].nz = nz; P[i].ny = ny;
  }
  return P;
}
const PROFILE = profile();
const FAR_TABLE = PROFILE.filter((p) => p.kind === 'c' || p.kind === 'b').sort((a, b) => a.z - b.z);

/** End rounding: u ∈ [0,1] past FRONT/BACK.x0 → { k: across-shell squeeze, drop: metres }. */
export function ends(x) {
  let u = 0;
  if (x > FRONT.x0) u = Math.min(1, (x - FRONT.x0) / FRONT.len);
  else if (x < BACK.x0) u = Math.min(1, (BACK.x0 - x) / BACK.len);
  return { u, k: Math.sqrt(Math.max(0.02, 1 - u * u * 0.85)), drop: 7.5 * u * u };
}
export function squeeze(x) { return ends(x).k; }
/** Near-side waterline z at x (scalloped marginals). */
export const rimZ = (x) => { const { k } = ends(x); const f = fract((x - OV - PM / 2) / PM); return CZ + (3.66 + 0.36 * (1 - Math.abs(f * 2 - 1)) - CZ) * k; };

/** Crest height (the belt crown) at x. */
export const crestH = (x) => camber(CZ) - ends(x).drop;

/** Analytic shell height; the tessellated belt differs slightly at narrow bevels and grooves. */
export function shellH(x, z) {
  const { k, drop } = ends(x);
  const zc = CZ + (z - CZ) / k;
  if (zc > BELT.near) {                        // near rim
    if (zc > 3.7) return WATER_Y - 0.4;
    const t = smooth(BELT.near, 3.7, zc);
    return camber(BELT.near) + (WATER_Y - 0.1 - camber(BELT.near)) * t * t - drop;
  }
  if (zc >= BELT.far) return camber(zc) + bulge(x, zc) - drop;
  // far slope: y from the table, relief along the (mostly upward) normal
  const d = BELT.far - zc;
  let w = BELT.far;
  for (let i = FAR_TABLE.length - 1; i > 0; i--) { const a = FAR_TABLE[i - 1], b = FAR_TABLE[i]; if (zc >= a.z && zc <= b.z) { const t = (zc - a.z) / (b.z - a.z); w = a.w + (b.w - a.w) * t; break; } }
  if (zc < FAR_TABLE[0].z) w = FAR_TABLE[0].w - (FAR_TABLE[0].z - zc);
  return farY(d) + bulge(x, w) * 0.6 - drop;
}
/** Seam distance (metres) at (x, z) — for tufts / props in the seams. */
export function scuteEdge(x, z) { return plate(x, z < BELT.far ? BELT.far - (BELT.far - z) * 1.25 : z).e; }

// ---------------------------------------------------------------------------------------------- material
const GLSL_PLATE = /* glsl */`
vec4 kHex(vec2 p) {
  p.x += 0.19 * sin(p.y * 1.3) + 0.09 * sin(p.x * 1.7 + p.y);
  p.y += 0.14 * sin(p.x * 1.15);
  p = (p - vec2(1.6, -0.55)) / vec2(${HEX * X_STRETCH}, ${HEX});
  vec2 lattice = vec2(1.732050808, 1.0);
  vec2 a = p - floor(p / lattice + 0.5) * lattice;
  vec2 b = p - (floor(p / lattice) + 0.5) * lattice;
  vec2 q = dot(a, a) < dot(b, b) ? a : b;
  vec2 cell = floor((p - q) / lattice * 2.0 + 0.5);
  return vec4(q * ${HEX}, cell);
}
vec4 kPlate(vec2 p) {
  vec4 h = kHex(p);
  float e = max(0.0, min(${HEX * 0.5} - abs(h.y), ${HEX * 0.5} - dot(abs(h.xy), vec2(0.866025404, 0.5))));
  if (p.y > 2.6) {
    float d = abs(fract((p.x - 4.0) / 3.5 + 0.5) - 0.5) * 3.5;
    return vec4(min(p.y - 2.6, d), 2.0, floor((p.x - 4.0) / 3.5), 1.2);
  }
  return vec4(min(e, 2.6 - p.y), p.y < -3.3 ? 1.0 : 0.0, h.z + h.w * 41.0, ${HEX * 0.5});
}
// Small stable hash: no large sine multiplier whose last bits become stipple on mobile GPUs.
float kPlateHash(float id) { return fract(sin(id * 1.73 + 0.31) * 17.13); }
`;

// Edge frame of the nearest plate edge: the same polygonal distance as kPlate, plus the coordinate
// ALONG that edge and a small edge id. Growth layers run parallel to edges (a function of e) and are
// broken along them (a function of t). Nothing here measures distance to a plate centre.
const GLSL_EDGE = /* glsl */`
vec3 kEdgeFrame(vec2 p, vec4 h) {
  if (p.y > 2.6) {
    float fx = fract((p.x - 4.0) / 3.5 + 0.5) - 0.5;
    float dX = (0.5 - abs(fx)) * 3.5, dIn = p.y - 2.6;
    return dIn < dX ? vec3(dIn, p.x, 7.0) : vec3(dX, p.y, 8.0 + step(0.0, fx));
  }
  vec2 q = h.xy;
  float a0 = q.y, a1 = 0.866025404 * q.x + 0.5 * q.y, a2 = 0.866025404 * q.x - 0.5 * q.y;
  float m0 = abs(a0), m1 = abs(a1), m2 = abs(a2);
  vec3 f;
  if (m0 >= m1 && m0 >= m2) f = vec3(${HEX * 0.5} - m0, q.x, step(0.0, a0));
  else if (m1 >= m2) f = vec3(${HEX * 0.5} - m1, -0.5 * q.x + 0.866025404 * q.y, 2.0 + step(0.0, a1));
  else f = vec3(${HEX * 0.5} - m2, 0.5 * q.x + 0.866025404 * q.y, 4.0 + step(0.0, a2));
  float dRow = 2.6 - p.y;
  if (dRow < f.x) f = vec3(dRow, p.x, 6.0);
  f.x = max(f.x, 0.0);
  return f;
}
`;

// World position → the shell's own unrolled coordinates (x, w): the end squeeze of ends(x), then the
// cross-section: w = z on the belt, arc length beyond it (the far table is the same PROFILE the deck
// mesh stores in aSc). Used by the nuchal hood (shellMaterial({ worldSc: true })) so it carries the
// SAME material field as the deck it rises from, continuous across the join, without any texture or
// readback. Vertical projection: valid on the deck's upper surface (the near rim below its lip clamps).
const FAR_D = FAR_TABLE.filter((p) => p.z < BELT.far).map((p) => BELT.far - p.z).sort((a, b) => a - b);
const FAR_W = FAR_D.map((d) => { const z = BELT.far - d; return FAR_TABLE.find((p) => Math.abs(p.z - z) < 1e-9).w; });
const WORLD_SC_TAB = [BELT.far, ...FAR_W];                                   // w at d = 0, 0.3 … 3.3, 3.8 … 13.8
const WORLD_SC_N = WORLD_SC_TAB.length;                                      // 33
const WORLD_SC_SLOPE = (WORLD_SC_TAB[WORLD_SC_N - 1] - WORLD_SC_TAB[WORLD_SC_N - 2]) / 0.5;
const GLSL_WORLD = /* glsl */`
uniform float kScFarW[${WORLD_SC_N}];
vec2 kScWorld(vec3 wp) {
  float x = wp.x, u = 0.0;
  if (x > ${FRONT.x0}.0) u = min(1.0, (x - ${FRONT.x0}.0) / ${FRONT.len}.0);
  else if (x < ${BACK.x0}.0) u = min(1.0, (${BACK.x0}.0 - x) / ${BACK.len}.0);
  float k = sqrt(max(0.02, 1.0 - u * u * 0.85));
  float zc = ${CZ} + (wp.z - ${CZ}) / k;
  float w = zc;
  if (zc > ${BELT.near}) w = ${BELT.near} + (min(zc, 3.98) - ${BELT.near}) * 1.0209;
  else if (zc < ${BELT.far}) {
    float d = ${BELT.far} - zc;
    float fi = d <= 3.3 ? d / 0.3 : 11.0 + (d - 3.3) / 0.5;
    fi = clamp(fi, 0.0, ${(WORLD_SC_N - 1).toFixed(1)} - 0.001);
    int i = int(floor(fi));
    w = mix(kScFarW[i], kScFarW[i + 1], fi - float(i));
    if (d > ${FAR_D[FAR_D.length - 1]}) w = kScFarW[${WORLD_SC_N - 1}] + (d - ${FAR_D[FAR_D.length - 1]}) * ${WORLD_SC_SLOPE.toFixed(6)};
  }
  return vec2(x, w);
}
`;

// The far herd (herd.js, small:true) keeps the exact first-build response: donor body and program key.
function donorShellMaterial(o, m, U) {
  patchStandard(m, {
    key: 'kcaShell8', uniforms: U,
    vertHead: 'attribute vec2 aSc; varying vec2 vSc;',
    vertMain: 'vSc = aSc;',
    fragHead: /* glsl */`
uniform vec3 kScUmber, kScOlive, kScOchre, kScTan, kScCore, kScSeam, kScMoss, kScBarn, kScWet; uniform vec4 kScOpt; varying vec2 vSc;
${GLSL_PLATE}
float kScH; float kScMossAmt; float kScWetAmt; float kScGloss;
`,
    albedo: /* glsl */`
  // Colour rings are analytic at fragment resolution; the mip-filtered noise only
  // modulates wear. No texture-resolution-dependent engraved contour maps.
  vec4 n1 = kN(vSc * 0.037), n2 = kN(vSc * 0.105 + 0.3), n3 = kN(vSc * 0.21);
  vec4 grain = kN(vSc * vec2(0.48, 0.63));
  vec4 pl = kPlate(vSc), hx = kHex(vSc);
  float e = pl.x, idh = kPlateHash(pl.z);
  float aa = max(fwidth(e), 0.006);
  float seam = 1.0 - smoothstep(0.012, 0.04 + aa * 0.65, e);
  // Offset areola, irregular radial growth: rounded annuli inside interlocking polygons.
  vec2 q = hx.xy - vec2((idh - 0.5) * 0.8, sin(idh * 13.0) * 0.28);
  if (pl.y > 1.5) q = vec2((fract((vSc.x - 4.0) / 3.5 + 0.5) - 0.5) * 3.0, (vSc.y - 3.4) * 0.8);
  float radius = length(q);
  float polygon = max(abs(q.y), dot(abs(q), vec2(0.8660254, 0.5)));
  float growth = mix(radius, polygon, 0.48) + 0.11 * sin(q.x * 3.0 + q.y * 1.6) + (n2.g - 0.5) * 0.28 + (n3.r - 0.5) * 0.08;
  float age = growth * (11.0 + idh * 1.8);
  float ringWave = 0.5 + 0.5 * sin(age + 0.18 * sin(age * 0.43));
  float ring = smoothstep(0.12, 0.72 + min(0.12, fwidth(age) * 0.15), ringWave);
  float crown = 1.0 - smoothstep(0.15, 2.55, growth);
  vec3 edge = mix(kScUmber, kScOlive, idh * 0.7 + n1.g * 0.2);
  vec3 honey = mix(kScOchre, kScTan, idh);
  vec3 c = mix(edge, honey, smoothstep(0.05, 1.65, e) * (0.32 + crown * 0.68));
  c = mix(c, kScCore, pow(crown, 3.0) * 0.42);
  // Broad translucent amber/dark annual bands, instead of black incisions.
  c *= (0.79 + 0.23 * ring) * (0.80 + idh * 0.28);
  c *= 0.69 + n1.g * 0.18 + n3.r * 0.38;
  c = mix(c, edge * 0.8, smoothstep(0.5, 0.67, n3.g) * (1.0 - crown) * 0.36);
  float bandEdge = (1.0 - smoothstep(0.05, 0.13 + fwidth(age) * 0.3, abs(sin(age * 0.5)))) * smoothstep(0.08, 0.3, growth);
  c *= 1.0 - bandEdge * 0.08;
  // Fine successive horn layers and abraded pores break up the broad annual bands.
  float layerPhase = age * 4.7 + n3.b * 1.1;
  float layerFade = 1.0 - smoothstep(0.7, 2.5, fwidth(layerPhase));
  float layer = pow(0.5 + 0.5 * sin(layerPhase), 8.0) * layerFade;
  c *= (1.0 - layer * 0.085) * (0.82 + grain.b * 0.34);
  // Fine radial fibres and a few short weather splits; derivative filtered at distance.
  float fibre = atan(q.y, q.x) * 95.0 + radius * 3.0 + n2.r * 2.0;
  float fibreFade = 1.0 - smoothstep(0.6, 2.0, fwidth(fibre));
  c *= 1.0 - (0.5 + 0.5 * sin(fibre)) * fibreFade * 0.12;
  vec2 direction = vec2(cos(idh * 6.283), sin(idh * 6.283));
  float cd = abs(dot(q, direction) + 0.05 * sin(q.x * 9.0 + q.y * 5.0));
  float split = (1.0 - smoothstep(0.004, 0.012 + aa * 0.4, cd)) * (1.0 - smoothstep(0.18, 0.72, e));
  c = mix(c, kScUmber * 0.6, split * 0.65);
  float moss = (1.0 - smoothstep(0.025, 0.11, e)) * smoothstep(0.35, 0.62, n1.r) * 0.8;
  float lichen = (1.0 - smoothstep(0.06, 0.16, e)) * smoothstep(0.58, 0.7, n2.g) * 0.25;
  c = mix(c, kScSeam, seam * 0.65);
  c = mix(c, kScMoss, moss);
  c = mix(c, kScBarn, lichen);
  float wet = 1.0 - smoothstep(0.05, 0.65, vKW.y - kScOpt.x);
  c = mix(c, c * 0.5 + kScWet * 0.12, wet * 0.65);
  diffuseColor.rgb = c;
  kScMossAmt = moss; kScWetAmt = wet; kScGloss = ring * (0.4 + crown * 0.6);
  kScH = -seam * 0.004 + sin(age) * 0.0012 - split * 0.002 - layer * 0.0006 + (grain.b - 0.5) * 0.004;

`,
    rough: /* glsl */`
  // Growth bands vary between dry matte and worn satin; moss remains matte.
  roughnessFactor = mix(0.88, 0.69, kScGloss);
  roughnessFactor = mix(roughnessFactor, 0.96, kScMossAmt);
  roughnessFactor = mix(roughnessFactor, 0.67, kScWetAmt);
`,
    bump: /* glsl */`
  normal = kBump(-vViewPosition, normal, kScH, 1.0, faceDirection);
`,
  });
  return m;
}

// Horn material tunables (env-r33 fix). Seed 33 is folded into the per-plate hashes below.
const HORN = {
  seed: 33,
  layerPeriod0: 0.06,      // growth-layer period at the seam (m)
  layerGrowth: 0.27,       // period grows by this much per metre inward (layers pack toward seams)
  layerReach: [0.55, 1.45],  // layers fade out over this e range (m); centres beyond are quiet
  layerHeight: 0.016,      // layer step relief (m, derivative bump): ~1.6 cm risers on a 5 m plate
  layerLight: 0.6,         // mix toward the lighter worn horn on each layer crest
  cloudDark: 0.22,         // tortoiseshell pigment cloud darkening (mix)
  seamDepth: 0.012,
};

export function shellMaterial(o = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.87, metalness: 0, envMapIntensity: o.env ?? 0.16 });
  const U = {
    kScUmber: { value: new THREE.Color(o.edge || '#302c1a') },     // plate rim band
    kScOlive: { value: new THREE.Color(o.olive || '#42452a') },
    kScOchre: { value: new THREE.Color(o.plate || '#795024') },
    kScTan: { value: new THREE.Color(o.tan || '#967037') },
    kScCore: { value: new THREE.Color(o.core || '#ae8646') },       // areola
    kScSeam: { value: new THREE.Color(o.seam || '#353725') },
    kScMoss: { value: new THREE.Color(o.moss || '#3f4930') },
    kScBarn: { value: new THREE.Color(o.barnacle || '#777d58') },
    kScWet: { value: new THREE.Color(o.wet || '#16201a') },
    kScOpt: { value: new THREE.Vector4(WATER_Y, o.small ? 1 : 0, o.worldSc ? 1 : 0, 0) },
  };
  if (o.small) return donorShellMaterial(o, m, U);
  const world = !!o.worldSc;
  if (world) U.kScFarW = { value: new Float32Array(WORLD_SC_TAB) };
  const H = HORN;
  patchStandard(m, {
    key: world ? 'kcaShell33fW' : 'kcaShell33f', uniforms: U,
    defines: world ? { KSC_WORLD: 1 } : undefined,
    vertHead: 'attribute vec2 aSc; varying vec2 vSc;',
    vertMain: 'vSc = aSc;',
    fragHead: /* glsl */`
uniform vec3 kScUmber, kScOlive, kScOchre, kScTan, kScCore, kScSeam, kScMoss, kScBarn, kScWet; uniform vec4 kScOpt; varying vec2 vSc;
${GLSL_PLATE}
${GLSL_EDGE}
${world ? GLSL_WORLD : ''}
float kScH; float kScMossAmt; float kScWetAmt; float kScGloss;
`,
    albedo: /* glsl */`
  #ifdef KSC_WORLD
  vec2 sc = kScWorld(vKW);
  #else
  vec2 sc = vSc;
  #endif
  // Broad pigment clouds (n1/n2), fine pores (n3) and micro grain: all mip-filtered texture reads.
  vec4 n1 = kN(sc * 0.037), n2 = kN(sc * 0.105 + 0.3), n3 = kN(sc * 0.21);
  vec4 grain = kN(sc * vec2(0.48, 0.63));
  vec4 pl = kPlate(sc), hx = kHex(sc);
  vec3 ef = kEdgeFrame(sc, hx);
  float e = pl.x, t = ef.y, eid = ef.z;
  float idh = kPlateHash(pl.z), idh2 = kPlateHash(pl.z + 7.0), idh3 = kPlateHash(pl.z + 19.0);
  float edgeGate = kPlateHash(pl.z + 3.0 + eid * 5.0);             // per plate edge: how much layering shows
  float aa = max(fwidth(e), 0.006);
  float seam = 1.0 - smoothstep(0.012, 0.04 + aa * 0.65, e);
  // ---- value plan: dark olive-umber horn over the whole plate (lane band ~45-85 display luma);
  // plates differ coherently in olive/umber balance and a little warmth; centres a touch darker and
  // cooler; no pale areola, no broad light perimeter. Worn tan appears only on narrow bevels and
  // exposed layer edges.
  vec3 base = mix(kScUmber, kScOlive, 0.3 + 0.45 * idh + 0.25 * n1.g);
  vec3 warm = mix(kScOchre, kScTan, 0.35 * idh2);
  float centre = smoothstep(0.7, 2.2, e);
  vec3 c = mix(base, warm, 0.1 + 0.16 * idh2 + 0.06 * n2.r);
  c = mix(c, base * 0.82, centre * 0.35);
  // tortoiseshell pigment: soft darker clouds, denser on some plates, never per-pixel colour
  float cloud = smoothstep(0.44, 0.72, n1.r * 0.7 + n2.g * 0.3 + (idh2 - 0.5) * 0.1);
  c = mix(c, kScUmber * 0.8, cloud * ${H.cloudDark});
  c *= (0.84 + n1.g * 0.1 + n3.r * 0.18) * (0.9 + 0.2 * idh3);        // coherent per-plate value step
  // ---- worn bevel: a narrow, broken lighter band just inside the seam (edge wear), not a halo
  vec4 nb0 = kN(vec2(t * 0.16 + eid * 0.43, idh * 0.61 + 0.2));
  float bevel = smoothstep(0.03, 0.09, e) * (1.0 - smoothstep(0.12, 0.3, e)) * smoothstep(0.42, 0.6, nb0.r);
  c = mix(c, warm, bevel * 0.35);
  // ---- growth layers: edge-parallel layer terminations whose period shrinks toward the seam
  // (phi counts layers: dphi/de = 1 / (p0 + g e)), broken along the edge per layer and per edge,
  // gated per edge, absent from the centres. The worn edge of each layer is a hair lighter and the
  // riser is in the bump, so the light catches the packed layers near the seams.
  float p0 = ${H.layerPeriod0} * (0.85 + 0.3 * idh), g = ${H.layerGrowth};
  float phi = log(1.0 + g * e / p0) / g;
  float fw = fwidth(phi);
  float layerFade = 1.0 - smoothstep(0.22, 0.5, fw);
  float layerN = floor(phi), s = fract(phi);
  vec4 nb = kN(vec2(t * 0.085 + eid * 0.37, layerN * 0.173 + idh * 0.5));
  float brk = smoothstep(0.4, 0.55, nb.g) * smoothstep(0.3, 0.5, nb.b + 0.15 * nb.r);
  float reachHi = pl.y > 1.5 ? 0.75 : ${H.layerReach[1]};                       // small marginal plates: shorter reach
  float reach = (1.0 - smoothstep(${H.layerReach[0]} * reachHi / ${H.layerReach[1]}, reachHi, e)) * smoothstep(0.03, 0.1, e);
  // profile per layer: a gentle rise then a short riser at s = 0.44..0.56 (the exposed, worn edge)
  float step_ = smoothstep(0.0, 0.44, s) * (1.0 - smoothstep(0.44, 0.56 + fw * 0.6, s));
  float ridge = smoothstep(0.3, 0.46, s) * (1.0 - smoothstep(0.46, 0.56 + fw * 0.6, s));   // the lit worn crest (thin)
  float layerAmt = brk * reach * layerFade * (0.15 + 0.85 * smoothstep(0.3, 0.8, edgeGate));
  vec3 hornEdge = mix(c * 1.3, warm, 0.25);
  c = mix(c, hornEdge, ridge * layerAmt * ${H.layerLight});
  c *= 1.0 - (1.0 - step_) * layerAmt * 0.05;
  // ---- worn satin: polished patches on the centres and lane (roughness), micro pores everywhere
  // broad per-plate sheen (whole-plate gradients, not patches: patches reflect the sky as pale mottling)
  float polish = smoothstep(0.3, 0.85, n1.g * 0.45 + idh2 * 0.4 + n1.r * 0.15) * (0.45 + 0.55 * centre);
  c *= 1.0 + polish * 0.03;
  c *= 0.9 + grain.b * 0.2;
  float moss = (1.0 - smoothstep(0.025, 0.11, e)) * smoothstep(0.35, 0.62, n1.r) * 0.7;
  float lichen = (1.0 - smoothstep(0.06, 0.16, e)) * smoothstep(0.58, 0.7, n2.g) * 0.12;
  float groove = 1.0 - smoothstep(0.02, 0.12, e);
  c *= 1.0 - groove * 0.28;
  c = mix(c, kScSeam, seam * 0.75);
  c = mix(c, kScMoss, moss);
  c = mix(c, kScBarn, lichen);
  float wet = 1.0 - smoothstep(0.05, 0.65, vKW.y - kScOpt.x);
  c = mix(c, c * 0.5 + kScWet * 0.12, wet * 0.65);
  diffuseColor.rgb = c;
  kScMossAmt = moss; kScWetAmt = wet; kScGloss = polish * (1.0 - layerAmt * 0.5) + bevel * 0.2;
  kScH = -seam * ${H.seamDepth} - groove * 0.006 + step_ * layerAmt * ${H.layerHeight} + bevel * 0.0015
       + (grain.b - 0.5) * 0.0025 * (1.0 - polish * 0.6) + (n3.b - 0.5) * 0.0015;

`,
    rough: /* glsl */`
  // Dry horn is matte; worn patches and bevels turn satin; layer troughs stay rough; moss stays matte.
  roughnessFactor = mix(0.84, 0.62, kScGloss);
  roughnessFactor = mix(roughnessFactor, 0.96, kScMossAmt);
  roughnessFactor = mix(roughnessFactor, 0.67, kScWetAmt);
`,
    bump: /* glsl */`
  normal = kBump(-vViewPosition, normal, kScH, 1.0, faceDirection);
`,
  });
  return m;
}

/** Build the carapace mesh. */
export function buildShell(ctx, o = {}) {
  const x0 = o.x0 ?? (BACK.x0 - BACK.len - 1), x1 = o.x1 ?? (FRONT.x0 + FRONT.len + 1), dx = o.dx ?? 0.16;
  const nx = Math.ceil((x1 - x0) / dx);
  const np = PROFILE.length;
  const pos = new Float32Array((nx + 1) * np * 3);
  const sc = new Float32Array((nx + 1) * np * 2);
  let k3 = 0, k2 = 0;
  for (let i = 0; i <= nx; i++) {
    const x = x0 + (i / nx) * (x1 - x0);
    const { k, drop } = ends(x);
    for (let j = 0; j < np; j++) {
      const p = PROFILE[j];
      const b = bulge(x, p.w) * (p.kind === 'c' ? 1 : p.kind === 'm' ? 0.9 : 1);
      let z = p.z + p.nz * b, y = p.y + p.ny * b;
      if (p.kind === 'm') {
        const f = fract((x - OV - PM / 2) / PM), tooth = 1 - Math.abs(f * 2 - 1);
        const edge = smooth(2.9, 3.95, p.z);
        z += (tooth * 0.48 - 0.18) * edge;
        y -= tooth * 0.12 * edge;
      } // thin scalloped overhang; fused underside, no separate puffy blocks
      z = CZ + (z - CZ) * k; y -= drop;
      sc[k2++] = x; sc[k2++] = p.w;
      pos[k3++] = x; pos[k3++] = y; pos[k3++] = z;
    }
  }
  const idx = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < np - 1; j++) {
    const a = i * np + j, b = a + np;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSc', new THREE.BufferAttribute(sc, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // orient faces up (flip if the winding came out downward)
  const n = g.getAttribute('normal');
  let up = 0; for (let i = 0; i < n.count; i += 37) up += n.getY(i);
  if (up < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } g.setIndex(idx); g.computeVertexNormals(); }
  const mesh = new THREE.Mesh(g, shellMaterial(o.material));
  mesh.receiveShadow = true; mesh.castShadow = false; mesh.name = 'shell';
  ctx.group.add(mesh);
  return mesh;
}
