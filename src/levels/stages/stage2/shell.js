// Stage 2 — continuous weathered carapace. The low vertebral scutes carry the fight belt;
// a broad costal flank behind it meets the nuchal hood and neck, while the near marginal
// rim curls into the lake. Ground heights and visible plate relief share one analytic surface.
// Fused horn faces, amber growth bands and a sharp overhanging marginal row
// distinguish the deck from terrain. Moss and lichen remain confined to the seams.
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
    kScOpt: { value: new THREE.Vector4(WATER_Y, o.small ? 1 : 0, 0, 0) },
  };
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
