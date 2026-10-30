// Stage 4 ground: rain-soaked flagstones (world-space irregular courses, bevelled joints, per-stone tilt so torch
// reflections break up, puddles with animated rain-ripple normals that mirror the torches + lightning sky), the berm's
// retaining faces (ashlar, algae at the waterline) and the moat water (black mirror + ripples + slow swell).
import * as THREE from 'three';
import { patchMaterial } from './shading.js';
import { WATER_Y, BERM_Z0, BERM_Z1, COURT_X, FAR_WALL_Z, STAIRS } from './layout.js';

const RIPPLES = /* glsl */`
vec2 s4Ripple(vec2 p, float sc, float t) {
  vec2 rp = p * sc; vec2 ci = floor(rp); vec2 cf = fract(rp) - 0.5;
  float ph = fract(t * (0.8 + s4h(ci) * 0.7) + s4h(ci + 5.1));
  vec2 c = (vec2(s4h(ci + 1.7), s4h(ci + 2.9)) - 0.5) * 0.36;
  vec2 d = cf - c; float r = length(d); float rr = ph * 0.38;
  float ring = sin((r - rr) * 55.0) * exp(-pow((r - rr) * 12.0, 2.0)) * (1.0 - ph) * step(0.02, ph);
  return d / max(r, 1e-3) * ring;
}
`;

const FLAG_SURFACE = /* glsl */`
vec2 p = vS4World.xz;
float RH = 1.1;
float row = floor(p.y / RH);
float rh = s4h(vec2(row, 3.1));
float L = 0.7 + rh * 0.6;
float px = p.x / L + rh * 7.0;
vec2 id = vec2(floor(px), row);
float h1 = s4h(id), h2 = s4h(id + 17.3), h3 = s4h(id + 41.7);
vec2 f = vec2(fract(px) * L, fract(p.y / RH) * RH);
vec2 sz = vec2(L, RH);
vec2 e = min(f, sz - f);
float wob = (s4n(p * 7.0) - 0.5) * 0.03;
float edge = min(e.x, e.y) + wob;
float joint = 1.0 - smoothstep(0.014, 0.05, edge);
float bev = 1.0 - smoothstep(0.03, 0.12, edge);
vec2 edir = e.x < e.y ? vec2(sign(f.x - sz.x * 0.5), 0.0) : vec2(0.0, sign(f.y - sz.y * 0.5));
float pit = s4fbm(p * 5.0 + h1 * 9.0);
// albedo: cool slate-grey stones, each its own shade, a few warmer; dark wet joints with grit
vec3 cA = vec3(0.060, 0.061, 0.072), cB = vec3(0.085, 0.082, 0.090), cC = vec3(0.075, 0.066, 0.060);
vec3 alb = mix(mix(cA, cB, h1), cC, step(0.82, h2) * 0.8);
alb *= 0.8 + 0.45 * pit;
alb = mix(alb, vec3(0.012, 0.012, 0.014), joint);
// puddles: low-frequency pools + joints fill first + the odd sunken stone
float pv = s4fbm(p * 0.3 + vec2(3.0, 1.0)) + joint * 0.08 + step(h3, 0.1) * 0.12;
float pud = smoothstep(0.56, 0.62, pv) * s4Wet;
// normal: per-stone tilt, bevel toward joints, pitting; ripples in puddles (and a little everywhere: it's pouring)
vec3 nW = vec3((h1 - 0.5) * 0.09, 1.0, (h2 - 0.5) * 0.09);
// r33 fix: shallow worn joint shoulders, not a repeated tilted mirror around each slab.
nW.xz += edir * bev * 0.18 * (1.0 - pud);
nW.xz += (vec2(s4n(p * 14.0), s4n(p * 14.0 + 3.3)) - 0.5) * 0.12 * (1.0 - pud);
vec2 rip = s4Ripple(p, 3.1, s4Time * 1.1) + s4Ripple(p + 0.37, 4.7, s4Time * 1.3) * 0.7;
nW.xz = mix(nW.xz, rip * 0.22, pud);
s4N = normalize(nW);
normal = normalize((viewMatrix * vec4(s4N, 0.0)).xyz);
diffuseColor.rgb = alb * mix(1.0, 0.55, pud);
// Broad static roughness drift crosses several stones, breaking the regular blue specular grid.
// Albedo/pool locations are unchanged. Puddles still carry moving ripples and the storm sky,
// but the wet film over mineral stone is satin instead of a second moat mirror.
float wear = s4n(p * vec2(0.42, 0.68) + vec2(17.0, 9.0));
s4WetM = mix(0.38 + 0.18 * wear, 0.82, pud);
s4Mirror = mix(0.045 + 0.065 * wear, 0.45, pud) * (1.0 - joint * 0.65);
roughnessFactor = mix(mix(0.84, 0.69, wear) + joint * 0.12, 0.29 + 0.09 * wear, pud);
roughnessFactor = mix(roughnessFactor, max(roughnessFactor, 0.82), bev * (1.0 - pud));
metalnessFactor = 0.0;
`;

const FACE_SURFACE = /* glsl */`
// ashlar on a vertical face (world x/y), algae + grime toward the waterline
vec2 p = vec2(vS4World.x + vS4World.z, vS4World.y);
float CH = 0.46;
float row = floor(p.y / CH);
float rh = s4h(vec2(row, 7.7));
float L = 0.8 + rh * 0.6;
float px = p.x / L + rh * 5.0;
vec2 id = vec2(floor(px), row);
float h1 = s4h(id);
vec2 f = vec2(fract(px) * L, fract(p.y / CH) * CH);
vec2 e = min(f, vec2(L, CH) - f);
float joint = 1.0 - smoothstep(0.015, 0.045, min(e.x, e.y));
vec3 alb = mix(vec3(0.07, 0.07, 0.08), vec3(0.1, 0.095, 0.1), h1) * (0.8 + 0.4 * s4fbm(p * 4.0));
float alg = smoothstep(${(WATER_Y + 1.2).toFixed(2)}, ${(WATER_Y + 0.1).toFixed(2)}, vS4World.y);
alb = mix(alb, vec3(0.025, 0.035, 0.028), alg * 0.8);
alb = mix(alb, vec3(0.01), joint);
diffuseColor.rgb = alb;
s4WetM = 0.8; s4Mirror = 0.15 + alg * 0.3;
roughnessFactor = mix(0.45, 0.8, joint);
`;

const WATER_SURFACE = /* glsl */`
vec2 p = vS4World.xz;
vec2 sw = vec2(s4n(p * 0.35 + s4Time * 0.12), s4n(p * 0.35 - s4Time * 0.1 + 4.0)) - 0.5;
vec2 rip = s4Ripple(p, 1.6, s4Time * 1.0) + s4Ripple(p + 0.7, 2.7, s4Time * 1.25) * 0.7 + s4Ripple(p + 0.2, 4.1, s4Time * 1.5) * 0.4;
float dist = length(cameraPosition.xz - p);
float fine = 1.0 - smoothstep(18.0, 60.0, dist);           // ripple detail fades with distance (no shimmer)
vec3 nW = normalize(vec3(sw.x * 0.18 + rip.x * 0.45 * fine, 1.0, sw.y * 0.18 + rip.y * 0.45 * fine));
s4N = nW;
normal = normalize((viewMatrix * vec4(s4N, 0.0)).xyz);
diffuseColor.rgb = vec3(0.006, 0.009, 0.013);
s4WetM = 1.0; s4Mirror = 1.0;
// r33 integration: resolve the moat's subpixel GGX spikes locally. The original
// 0.03 surface reached the PBR minimum and produced >7000 HDR channel peaks during
// lightning. A finite ripple footprint keeps a wet lobe without a delta-like glint.
// Pigment, animated normals, analytic reflection and all light/exposure values stay intact.
roughnessFactor = 0.12 + 0.05 * (1.0 - fine);
metalnessFactor = 0.0;
`;

function mkMat(surface, key, extra = '') {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0 });
  return patchMaterial(m, { surface, key, extraPars: RIPPLES + extra });
}

export function buildGround(ctx) {
  const { group } = ctx;
  const flag = mkMat(FLAG_SURFACE, 'flag-r33-satin');
  const face = mkMat(FACE_SURFACE, 'face');
  const water = mkMat(WATER_SURFACE, 'water');
  const meshes = [];
  const plane = (x0, x1, z0, z1, y, m, seg = 1) => {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, seg, 1); g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
    const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; group.add(mesh); meshes.push(mesh); return mesh;
  };
  const vface = (x0, x1, z, y0, y1, m, flip = false) => {
    const g = new THREE.PlaneGeometry(x1 - x0, y1 - y0); if (flip) g.rotateY(Math.PI); g.translate((x0 + x1) / 2, (y0 + y1) / 2, z);
    const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; group.add(mesh); return mesh;
  };
  const xface = (x, z0, z1, y0, y1, m) => {
    const g = new THREE.PlaneGeometry(z1 - z0, y1 - y0); g.rotateY(-Math.PI / 2); g.translate(x, (y0 + y1) / 2, (z0 + z1) / 2);
    const mesh = new THREE.Mesh(g, m); group.add(mesh); return mesh;
  };
  const cx = COURT_X - 1.5;
  // berm + courtyard flagstones
  plane(-40, cx, BERM_Z0, BERM_Z1, 0, flag);
  plane(cx, 112, -7.2, 9, 0, flag);
  // retaining faces of the berm (near side seen from the camera) + the courtyard's moat-side corner
  vface(-40, cx, BERM_Z1, WATER_Y - 1.5, 0, face);
  vface(-40, cx, BERM_Z0, WATER_Y - 1.5, 0, face, true);
  xface(cx, BERM_Z1, 9, WATER_Y - 1.5, 0, face);
  // moat water (front + back + the wide water court)
  const wmesh = plane(-80, cx, FAR_WALL_Z - 3, 30, WATER_Y, water);
  wmesh.receiveShadow = false;
  // coping stones along the berm edges (instanced chamfer-less boxes; value break between flagstones and the drop)
  const cope = new THREE.BoxGeometry(1, 0.22, 0.55);
  const copeMat = mkMat(/* glsl */`
    float h = s4h(floor(vec2(vS4World.x * 1.02 + 0.3, vS4World.z * 0.3)));
    diffuseColor.rgb = mix(vec3(0.11, 0.105, 0.115), vec3(0.14, 0.135, 0.14), h) * (0.8 + 0.4 * s4fbm(vS4World.xz * 6.0));
    s4WetM = 0.65; s4Mirror = 0.08; roughnessFactor = 0.72 + 0.1 * h;`, 'cope-r33-satin');
  const pos = [];
  for (let x = -40; x < cx - 0.5; x += 1.02) { pos.push([x + 0.5, BERM_Z1 - 0.2]); pos.push([x + 0.5, BERM_Z0 + 0.2]); }
  for (let z = BERM_Z1 + 0.5; z < 9; z += 1.02) pos.push([cx - 0.2, z, 1]);
  const im = new THREE.InstancedMesh(cope, copeMat, pos.length);
  const m4 = new THREE.Matrix4();
  pos.forEach((p, i) => {
    const r = p[2] ? new THREE.Matrix4().makeRotationY(Math.PI / 2) : new THREE.Matrix4();
    m4.makeTranslation(p[0], 0.06 + ((i * 37) % 7) * 0.004, p[1]).multiply(r);
    im.setMatrixAt(i, m4);
  });
  im.receiveShadow = true;
  group.add(im);
  // grand stair to the upper ward (boulder chase): stepped flagstone blocks + terrace
  const S = STAIRS;
  const stepGeo = new THREE.BoxGeometry(1, 1, 1);
  const stepMat = mkMat(/* glsl */`
    vec2 p = vS4World.xz; float h = s4h(floor(vec2(p.x / 1.1, p.y / 0.6)));
    diffuseColor.rgb = mix(vec3(0.07, 0.07, 0.08), vec3(0.1, 0.096, 0.1), h) * (0.8 + 0.4 * s4fbm(p * 5.0));
    float top = smoothstep(0.5, 0.9, s4N.y);
    s4WetM = 0.6 + 0.4 * top; s4Mirror = 0.3 * top; roughnessFactor = mix(0.7, 0.3, top);`, 'step');
  const sm = new THREE.InstancedMesh(stepGeo, stepMat, S.steps + 1);
  const dz = (S.z0 - S.z1) / S.steps, dy = S.rise / S.steps;
  for (let i = 0; i < S.steps; i++) {
    const zf = S.z0 - i * dz;                        // front edge of step i
    const h = (i + 1) * dy;
    m4.makeScale(S.x1 - S.x0, h, dz + 0.02).setPosition((S.x0 + S.x1) / 2, h / 2, zf - dz / 2);
    sm.setMatrixAt(i, m4);
  }
  m4.makeScale(S.x1 - S.x0 + 22, S.rise, 14).setPosition((S.x0 + S.x1) / 2, S.rise / 2, S.z1 - 7);
  sm.setMatrixAt(S.steps, m4);
  sm.receiveShadow = true;
  group.add(sm);
  return { flag, water, face, groundAt: () => 0 };
}
