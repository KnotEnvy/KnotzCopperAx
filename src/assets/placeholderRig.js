// Procedural humanoid built EXACTLY to the §2 rig contract (docs/ARCHITECTURE.md): bone names, A-pose rest
// (arms 40° below horizontal), facing +Z, feet on y=0, root at origin, hips at pelvis height.
// One SkinnedMesh (2 material groups: body + metal) with smooth joint blending, so a character costs ~2
// draw calls. Per-hero proportions/palette/style come from the hero/enemy definition:
//
//   buildHumanoid({ proportions, palette, style, name }) → { root, mesh, bones: Map<name,Bone>, materials, hipHeight }
//   proportionsFor(height, overrides)  sensible defaults for any height
//   RIG_BONES / REQUIRED_BONES         the contract (AssetLoader validates GLBs against REQUIRED_BONES)
//
// Placeholder bones all have IDENTITY rest rotations (their axes = model axes). Blender GLBs will not —
// anim/retarget.js makes clips look the same on both.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { noiseTexture, normalFromNoise } from './proceduralTextures.js';

export const RIG_BONES = [
  'root', 'hips', 'spine', 'chest', 'neck', 'head', 'jaw',
  'clavicle_L', 'upperarm_L', 'forearm_L', 'hand_L', 'socket_hand_L',
  'clavicle_R', 'upperarm_R', 'forearm_R', 'hand_R', 'socket_hand_R',
  'thigh_L', 'shin_L', 'foot_L', 'toe_L', 'thigh_R', 'shin_R', 'foot_R', 'toe_R',
];
export const REQUIRED_BONES = ['root', 'hips', 'spine', 'chest', 'neck', 'head', 'upperarm_L', 'forearm_L', 'hand_L', 'upperarm_R', 'forearm_R', 'hand_R', 'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R', 'socket_hand_R'];
const PARENT = {
  hips: 'root', spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck', jaw: 'head',
  clavicle_L: 'chest', upperarm_L: 'clavicle_L', forearm_L: 'upperarm_L', hand_L: 'forearm_L', socket_hand_L: 'hand_L',
  clavicle_R: 'chest', upperarm_R: 'clavicle_R', forearm_R: 'upperarm_R', hand_R: 'forearm_R', socket_hand_R: 'hand_R',
  thigh_L: 'hips', shin_L: 'thigh_L', foot_L: 'shin_L', toe_L: 'foot_L',
  thigh_R: 'hips', shin_R: 'thigh_R', foot_R: 'shin_R', toe_R: 'foot_R',
  socket_back: 'chest',
};

/** Default proportions scaled from a height; hero defs override individual fields. */
export function proportionsFor(height = 1.8, o = {}) {
  const s = height / 1.8;
  const p = {
    height,
    hipY: 0.93 * s, pelvisW: 0.105 * s, spineY: 1.04 * s, chestY: 1.23 * s, neckY: 1.48 * s, headY: 1.55 * s, headR: 0.115 * s,
    shoulderW: 0.21 * s, shoulderY: 1.41 * s, upperArm: 0.3 * s, foreArm: 0.27 * s, hand: 0.17 * s,
    ankleY: 0.085 * s, footLen: 0.24 * s,
    chestR: [0.19 * s, 0.13 * s], waistR: [0.15 * s, 0.11 * s], hipR: [0.17 * s, 0.125 * s],
    upperArmR: 0.058 * s, foreArmR: 0.048 * s, thighR: 0.085 * s, shinR: 0.06 * s, neckR: 0.058 * s,
    armDown: 40,
  };
  return Object.assign(p, o);
}

/** Rest-pose joint positions (model space, facing +Z, left = +X). */
export function jointPositions(p) {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const a = (p.armDown * Math.PI) / 180;
  const dirL = V(Math.cos(a), -Math.sin(a), 0), dirR = V(-Math.cos(a), -Math.sin(a), 0);
  const J = {};
  J.root = V(0, 0, 0);
  J.hips = V(0, p.hipY, 0);
  J.spine = V(0, p.spineY, -0.01);
  J.chest = V(0, p.chestY, -0.015);
  J.neck = V(0, p.neckY, -0.02);
  J.head = V(0, p.headY, -0.005);
  J.jaw = V(0, p.headY + p.headR * 0.35, p.headR * 0.35);
  for (const [side, sx, dir] of [['L', 1, dirL], ['R', -1, dirR]]) {
    J['clavicle_' + side] = V(sx * 0.035, p.shoulderY - 0.02, -0.02);
    J['upperarm_' + side] = V(sx * p.shoulderW, p.shoulderY, -0.025);
    J['forearm_' + side] = J['upperarm_' + side].clone().addScaledVector(dir, p.upperArm);
    J['hand_' + side] = J['forearm_' + side].clone().addScaledVector(dir, p.foreArm);
    J['socket_hand_' + side] = J['hand_' + side].clone().addScaledVector(dir, p.hand * 0.5);
    const thighY = p.hipY - 0.07 * (p.height / 1.8);
    const kneeY = p.ankleY + (thighY - p.ankleY) * 0.49;
    J['thigh_' + side] = V(sx * p.pelvisW, thighY, 0);
    J['shin_' + side] = V(sx * p.pelvisW * 0.93, kneeY, 0.012);
    J['foot_' + side] = V(sx * p.pelvisW * 0.9, p.ankleY, -0.012);
    J['toe_' + side] = V(sx * p.pelvisW * 0.9, 0.028, p.footLen * 0.62);
  }
  J.socket_back = V(0, p.chestY + 0.06, -(p.chestR[1] + 0.06));
  return J;
}

// ------------------------------------------------------------------ geometry helpers
const _up = new THREE.Vector3(0, 1, 0);

/** Lathe "limb": along +Y from 0..len, radius r0 → r1 with rounded caps and a muscle bulge. */
function limbGeo(len, r0, r1, { bulge = 0.12, radial = 14, caps = 5, rings = 6, sx = 1, sz = 1, capBottom = true, capTop = true } = {}) {
  const pts = [];
  if (capBottom) for (let i = 0; i <= caps; i++) { const a = -Math.PI / 2 + (i / caps) * (Math.PI / 2); pts.push(new THREE.Vector2(Math.max(1e-4, r0 * Math.cos(a)), r0 * Math.sin(a) * 0.9)); }
  else pts.push(new THREE.Vector2(r0, 0));
  for (let i = 1; i < rings; i++) {
    const t = i / rings;
    const r = r0 + (r1 - r0) * t + Math.sin(Math.PI * t) * bulge * (r0 + r1) * 0.5;
    pts.push(new THREE.Vector2(r, len * t));
  }
  if (capTop) for (let i = 0; i <= caps; i++) { const a = (i / caps) * (Math.PI / 2); pts.push(new THREE.Vector2(Math.max(1e-4, r1 * Math.cos(a)), len + r1 * Math.sin(a) * 0.9)); }
  else pts.push(new THREE.Vector2(r1, len));
  const g = new THREE.LatheGeometry(pts, radial);
  if (sx !== 1 || sz !== 1) g.scale(sx, 1, sz);
  return g;
}

/** Orient a +Y-authored geometry to run from a → b. */
function placeAlong(g, a, b, roll = 0) {
  const dir = b.clone().sub(a);
  const q = new THREE.Quaternion().setFromUnitVectors(_up, dir.clone().normalize());
  if (roll) g.rotateY(roll);
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return g;
}

function ellipsoid(center, rx, ry, rz, seg = 18) {
  const g = new THREE.SphereGeometry(1, seg, Math.max(8, seg * 0.66 | 0));
  g.scale(rx, ry, rz);
  g.translate(center.x, center.y, center.z);
  return g;
}

function rbox(center, w, h, d, r = 0.02) {
  const g = new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2));
  g.translate(center.x, center.y, center.z);
  return g;
}

/**
 * Accumulates skinned parts and bakes one merged SkinnedMesh.
 * Each part: geometry in model space, a bone (rigid) or a weight function (v) → [[boneIndex, w], ...].
 */
class PartBuilder {
  constructor(boneIndex) { this.bi = boneIndex; this.groups = { body: [], metal: [] }; }

  add(geo, { bone, color, mat = 'body', weights = null, rough = null }) {
    const g = geo;
    const n = g.attributes.position.count;
    // mergeGeometries needs all-indexed input; some generators (RoundedBoxGeometry) are non-indexed.
    if (!g.index) g.setIndex(Array.from({ length: n }, (_, i) => i));
    const col = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const c = new THREE.Color(color);
    const pos = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      let infl;
      if (weights) { v.fromBufferAttribute(pos, i); infl = weights(v); } else infl = [[this.bi[bone], 1]];
      let tot = 0;
      for (let k = 0; k < 4; k++) { const e = infl[k]; if (e) { si[i * 4 + k] = e[0]; sw[i * 4 + k] = e[1]; tot += e[1]; } }
      if (tot > 0) for (let k = 0; k < 4; k++) sw[i * 4 + k] /= tot;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color', 'skinIndex', 'skinWeight'].includes(k)) g.deleteAttribute(k);
    g.clearGroups();
    this.groups[mat].push(g);
    return g;
  }

  /** Limb from joint a to joint b rigidly on `bone`, blended into `parent` near a. */
  limb(a, b, r0, r1, bone, parent, color, opts = {}) {
    const len = a.distanceTo(b);
    const g = placeAlong(limbGeo(len, r0, r1, opts), a, b, opts.roll || 0);
    const axis = b.clone().sub(a).normalize();
    const blend = opts.blend ?? Math.min(0.09, len * 0.3);
    const ib = this.bi[bone], ip = parent ? this.bi[parent] : null;
    const tmp = new THREE.Vector3();
    return this.add(g, {
      color, mat: opts.mat,
      weights: (v) => {
        if (ip === null || ip === undefined) return [[ib, 1]];
        const t = tmp.copy(v).sub(a).dot(axis);
        const wp = t <= 0 ? 0.5 : 0.5 * (1 - smooth(t / blend));
        return wp > 0.001 ? [[ib, 1 - wp], [ip, wp]] : [[ib, 1]];
      },
    });
  }

  bake(materials) {
    const merged = [];
    const mats = [];
    for (const key of ['body', 'metal']) {
      if (!this.groups[key].length) continue;
      merged.push(mergeGeometries(this.groups[key], false));
      mats.push(materials[key]);
    }
    const geo = mergeGeometries(merged, true);
    for (const g of [...this.groups.body, ...this.groups.metal, ...merged]) g.dispose();
    return { geo, mats };
  }
}

const smooth = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ materials
function makeMaterials(palette) {
  const detail = noiseTexture({ size: 256, scale: 10, octaves: 5, seed: 11, contrast: 0.9, colorA: '#c9c2bb', colorB: '#ffffff' });
  const nrm = normalFromNoise({ size: 256, scale: 12, octaves: 4, seed: 5, strength: 1.2 });
  const body = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: palette.roughness ?? 0.66, metalness: 0, map: detail, normalMap: nrm, normalScale: new THREE.Vector2(0.18, 0.18), name: 'placeholder_body' });
  const metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.85, map: detail, normalMap: nrm, normalScale: new THREE.Vector2(0.12, 0.12), name: 'placeholder_metal' });
  return { body, metal };
}

// ------------------------------------------------------------------ the builder
/**
 * @param {object} o
 * @param {object} o.proportions  see proportionsFor()
 * @param {object} o.palette      { skin, hair, cloth, cloth2, leather, metal, boots, accent, eyes }
 * @param {object} o.style        { hair:'mane'|'braid'|'none'|'bald', beard:bool, helm:'horned'|'none'|'hood'|'circlet', kilt:bool, cape:bool, pauldron:'L'|'R'|'both'|null, bracers:'leather'|'metal'|null, armor:'harness'|'scale'|'chain'|'plate'|'rags' }
 */
export function buildHumanoid({ proportions, palette = {}, style = {}, name = 'humanoid' } = {}) {
  const p = proportions || proportionsFor(1.8);
  const pal = Object.assign({ skin: '#b98262', hair: '#1c1512', cloth: '#6b4a32', cloth2: '#8c2b22', leather: '#4a3222', metal: '#9a9aa2', boots: '#3a281c', accent: '#c89b3c', eyes: '#18110c' }, palette);
  const J = jointPositions(p);

  // ---- bones (identity rest rotations; local position = world − parent world)
  const names = [...RIG_BONES];
  const extra = [];
  if (style.hair === 'mane' || style.hair === 'braid') extra.push('hair_1', 'hair_2', 'hair_3');
  if (style.beard) extra.push('beard_1', 'beard_2');
  if (style.cape) extra.push('cape_1', 'cape_2', 'cape_3');
  names.push('socket_back', ...extra);
  const hs = p.headR;
  if (extra.includes('hair_1')) {
    const braid = style.hair === 'braid';
    J.hair_1 = new THREE.Vector3(0, p.headY + hs * (braid ? 1.1 : 1.5), -hs * 0.95);
    J.hair_2 = J.hair_1.clone().add(new THREE.Vector3(0, braid ? -hs * 1.6 : -hs * 1.4, -hs * 0.25));
    J.hair_3 = J.hair_2.clone().add(new THREE.Vector3(0, braid ? -hs * 1.8 : -hs * 1.3, -hs * 0.1));
    PARENT.hair_1 = 'head'; PARENT.hair_2 = 'hair_1'; PARENT.hair_3 = 'hair_2';
  }
  if (extra.includes('beard_1')) {
    J.beard_1 = new THREE.Vector3(0, p.headY + hs * 0.05, hs * 0.85);
    J.beard_2 = J.beard_1.clone().add(new THREE.Vector3(0, -hs * 1.3, hs * 0.25));
    PARENT.beard_1 = 'jaw'; PARENT.beard_2 = 'beard_1';
  }
  if (extra.includes('cape_1')) {
    J.cape_1 = new THREE.Vector3(0, p.shoulderY, -(p.chestR[1] + 0.03));
    J.cape_2 = J.cape_1.clone().add(new THREE.Vector3(0, -(p.shoulderY - p.hipY) * 0.7, -0.05));
    J.cape_3 = J.cape_2.clone().add(new THREE.Vector3(0, -(p.hipY * 0.5), -0.04));
    PARENT.cape_1 = 'chest'; PARENT.cape_2 = 'cape_1'; PARENT.cape_3 = 'cape_2';
  }
  const bones = new Map();
  for (const n of names) { const b = new THREE.Bone(); b.name = n; bones.set(n, b); }
  for (const n of names) {
    const b = bones.get(n), par = PARENT[n];
    if (par) { bones.get(par).add(b); b.position.copy(J[n]).sub(J[par]); } else b.position.copy(J[n]);
  }
  const boneList = names.map((n) => bones.get(n));
  const bi = Object.fromEntries(names.map((n, i) => [n, i]));
  const B = new PartBuilder(bi);

  // ---- torso (hips → spine → chest blend by height)
  const torsoW = (v) => {
    const y = v.y;
    if (y < p.spineY - 0.04) return [[bi.hips, 1]];
    if (y < p.spineY + 0.04) { const t = (y - (p.spineY - 0.04)) / 0.08; return [[bi.hips, 1 - t], [bi.spine, t]]; }
    if (y < p.chestY - 0.05) return [[bi.spine, 1]];
    if (y < p.chestY + 0.05) { const t = (y - (p.chestY - 0.05)) / 0.1; return [[bi.spine, 1 - t], [bi.chest, t]]; }
    return [[bi.chest, 1]];
  };
  // Pelvis
  B.add(ellipsoid(new THREE.Vector3(0, p.hipY + 0.01, 0), p.hipR[0], (p.spineY - p.hipY) * 1.1 + 0.07, p.hipR[1]), { color: style.kilt ? pal.leather : pal.cloth, weights: torsoW });
  // Abdomen (tapered lathe waist → chest)
  const abdomen = limbGeo(p.chestY - p.spineY + 0.08, p.waistR[0], p.chestR[0] * 0.92, { bulge: 0.02, radial: 18, sz: p.waistR[1] / p.waistR[0], capBottom: false, capTop: false });
  abdomen.translate(0, p.spineY - 0.06, -0.01);
  B.add(abdomen, { color: armorColor(style, pal, 'belly'), weights: torsoW, mat: armorMat(style) });
  // Chest mass
  const chestC = new THREE.Vector3(0, p.chestY + (p.shoulderY - p.chestY) * 0.45, -0.005);
  B.add(ellipsoid(chestC, p.chestR[0], (p.shoulderY - p.chestY) * 0.78 + 0.03, p.chestR[1], 22), { color: armorColor(style, pal, 'chest'), weights: torsoW, mat: armorMat(style) });
  // Pecs / plate front for readability of facing
  B.add(ellipsoid(chestC.clone().add(new THREE.Vector3(0, -0.02, p.chestR[1] * 0.45)), p.chestR[0] * 0.8, (p.shoulderY - p.chestY) * 0.55, p.chestR[1] * 0.62), { color: armorColor(style, pal, 'chest'), weights: torsoW, mat: armorMat(style) });
  // Trapezius/shoulder yoke
  B.add(ellipsoid(new THREE.Vector3(0, p.shoulderY + 0.01, -0.03), p.shoulderW * 0.95, 0.06 * p.height / 1.8, p.chestR[1] * 0.8), { color: armorColor(style, pal, 'chest'), bone: 'chest', mat: armorMat(style) });
  // Neck
  B.limb(J.neck.clone().add(new THREE.Vector3(0, -0.05, 0)), J.head.clone().add(new THREE.Vector3(0, 0.04, 0)), p.neckR * 1.15, p.neckR, 'neck', 'chest', pal.skin, { bulge: 0 });

  // ---- head
  const headC = new THREE.Vector3(0, p.headY + hs * 0.95, hs * 0.08);
  B.add(ellipsoid(headC, hs * 0.86, hs * 1.02, hs * 0.94, 22), { color: pal.skin, bone: 'head' });
  // Jaw/chin
  B.add(ellipsoid(headC.clone().add(new THREE.Vector3(0, -hs * 0.55, hs * 0.28)), hs * 0.6, hs * 0.42, hs * 0.55), { color: pal.skin, bone: 'jaw' });
  // Nose + brow (facing readability)
  B.add(ellipsoid(headC.clone().add(new THREE.Vector3(0, -hs * 0.08, hs * 0.92)), hs * 0.13, hs * 0.22, hs * 0.16, 10), { color: pal.skin, bone: 'head' });
  B.add(ellipsoid(headC.clone().add(new THREE.Vector3(0, hs * 0.22, hs * 0.72)), hs * 0.7, hs * 0.14, hs * 0.2, 12), { color: pal.skin, bone: 'head' });
  for (const sx of [1, -1]) B.add(ellipsoid(headC.clone().add(new THREE.Vector3(sx * hs * 0.34, hs * 0.08, hs * 0.76)), hs * 0.11, hs * 0.075, hs * 0.07, 10), { color: pal.eyes, bone: 'head' });
  // Ears
  for (const sx of [1, -1]) B.add(ellipsoid(headC.clone().add(new THREE.Vector3(sx * hs * 0.86, 0, -hs * 0.05)), hs * 0.1, hs * 0.2, hs * 0.14, 8), { color: pal.skin, bone: 'head' });

  // Hair
  if (style.hair && style.hair !== 'none' && style.hair !== 'bald') {
    B.add(ellipsoid(headC.clone().add(new THREE.Vector3(0, hs * 0.2, -hs * 0.12)), hs * 0.92, hs * 0.9, hs * 0.95, 20), { color: pal.hair, bone: 'head' });
  }
  if (style.hair === 'mane') {
    const hw = (bn) => [[bi[bn], 1]];
    B.add(ellipsoid(J.hair_1.clone().add(new THREE.Vector3(0, -hs * 0.2, 0)), hs * 0.95, hs * 0.85, hs * 0.55), { color: pal.hair, weights: () => hw('hair_1') });
    B.add(ellipsoid(J.hair_2.clone().add(new THREE.Vector3(0, -hs * 0.1, 0)), hs * 0.9, hs * 0.9, hs * 0.45), { color: pal.hair, weights: () => hw('hair_2') });
    B.add(ellipsoid(J.hair_3.clone(), hs * 0.6, hs * 0.7, hs * 0.32), { color: pal.hair, weights: () => hw('hair_3') });
  } else if (style.hair === 'braid') {
    B.add(ellipsoid(J.hair_1.clone(), hs * 0.4, hs * 0.4, hs * 0.35), { color: pal.hair, bone: 'hair_1' });
    B.limb(J.hair_1, J.hair_2, hs * 0.3, hs * 0.26, 'hair_1', 'head', pal.hair, { bulge: 0.3, radial: 10 });
    B.limb(J.hair_2, J.hair_3, hs * 0.26, hs * 0.16, 'hair_2', 'hair_1', pal.hair, { bulge: 0.3, radial: 10 });
    B.add(ellipsoid(J.hair_3.clone(), hs * 0.18, hs * 0.28, hs * 0.18, 8), { color: pal.accent, bone: 'hair_3', mat: 'metal' });
  }
  // Beard
  if (style.beard) {
    B.add(ellipsoid(headC.clone().add(new THREE.Vector3(0, -hs * 0.75, hs * 0.42)), hs * 0.92, hs * 0.75, hs * 0.62, 18), { color: pal.hair, bone: 'jaw' });
    B.limb(J.beard_1, J.beard_2, hs * 0.55, hs * 0.3, 'beard_1', 'jaw', pal.hair, { bulge: 0.2 });
    B.add(ellipsoid(J.beard_2.clone(), hs * 0.2, hs * 0.14, hs * 0.2, 10), { color: pal.accent, bone: 'beard_2', mat: 'metal' });
    for (const sx of [1, -1]) B.add(ellipsoid(headC.clone().add(new THREE.Vector3(sx * hs * 0.45, -hs * 0.15, hs * 0.75)), hs * 0.32, hs * 0.14, hs * 0.14, 10), { color: pal.hair, bone: 'head' });
  }
  // Helm / circlet / hood
  if (style.helm === 'horned') {
    B.add(ellipsoid(headC.clone().add(new THREE.Vector3(0, hs * 0.3, -hs * 0.05)), hs * 1.0, hs * 0.82, hs * 1.02, 20), { color: pal.metal, bone: 'head', mat: 'metal' });
    B.add(limbGeoAt(headC.clone().add(new THREE.Vector3(0, hs * 0.2, 0)), hs * 1.04, hs * 0.16), { color: pal.accent, bone: 'head', mat: 'metal' });
    for (const sx of [1, -1]) {
      const a = headC.clone().add(new THREE.Vector3(sx * hs * 0.85, hs * 0.55, -hs * 0.05));
      const b = a.clone().add(new THREE.Vector3(sx * hs * 0.9, hs * 0.75, hs * 0.1));
      const c = b.clone().add(new THREE.Vector3(sx * hs * 0.1, hs * 0.75, hs * 0.2));
      B.limb(a, b, hs * 0.22, hs * 0.12, 'head', null, '#e8dcc0', { bulge: 0, radial: 10 });
      B.limb(b, c, hs * 0.12, hs * 0.02, 'head', null, '#e8dcc0', { bulge: 0, radial: 10 });
    }
  } else if (style.helm === 'circlet') {
    B.add(limbGeoAt(headC.clone().add(new THREE.Vector3(0, hs * 0.35, -hs * 0.02)), hs * 0.93, hs * 0.07), { color: pal.accent, bone: 'head', mat: 'metal' });
  } else if (style.helm === 'hood') {
    B.add(ellipsoid(headC.clone().add(new THREE.Vector3(0, hs * 0.2, -hs * 0.15)), hs * 1.08, hs * 1.12, hs * 1.08, 18), { color: pal.cloth, bone: 'head' });
  } else if (style.helm === 'cap') {
    B.add(ellipsoid(headC.clone().add(new THREE.Vector3(0, hs * 0.35, -hs * 0.02)), hs * 0.95, hs * 0.72, hs * 0.98, 18), { color: pal.metal, bone: 'head', mat: 'metal' });
  }

  // ---- arms
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? 1 : -1;
    const ua = J['upperarm_' + side], fa = J['forearm_' + side], ha = J['hand_' + side], so = J['socket_hand_' + side];
    // Deltoid
    B.add(ellipsoid(ua.clone().add(new THREE.Vector3(sx * 0.015, 0.01, 0)), p.upperArmR * 1.45, p.upperArmR * 1.35, p.upperArmR * 1.35), {
      color: armorColor(style, pal, 'shoulder'), weights: () => [[bi['upperarm_' + side], 0.7], [bi['clavicle_' + side], 0.3]],
    });
    B.limb(ua, fa, p.upperArmR * 1.05, p.foreArmR * 1.05, 'upperarm_' + side, 'clavicle_' + side, pal.skin, { bulge: 0.18 });
    B.limb(fa, ha, p.foreArmR * 1.1, p.foreArmR * 0.78, 'forearm_' + side, 'upperarm_' + side, pal.skin, { bulge: 0.14 });
    // Bracer
    if (style.bracers) {
      const m = style.bracers === 'metal' ? 'metal' : 'body';
      const a = fa.clone().lerp(ha, 0.3), b = fa.clone().lerp(ha, 0.95);
      B.limb(a, b, p.foreArmR * 1.28, p.foreArmR * 1.05, 'forearm_' + side, null, style.bracers === 'metal' ? pal.metal : pal.leather, { bulge: 0.02, mat: m, radial: 12 });
    }
    // Fist
    const dir = ha.clone().sub(fa).normalize();
    const fist = rbox(new THREE.Vector3(), p.foreArmR * 1.9, p.hand * 0.78, p.foreArmR * 2.1, p.foreArmR * 0.6);
    const q = new THREE.Quaternion().setFromUnitVectors(_up, dir);
    fist.applyQuaternion(q);
    const fc = ha.clone().lerp(so, 0.75);
    fist.translate(fc.x, fc.y, fc.z);
    B.add(fist, { color: style.gloves ? pal.leather : pal.skin, bone: 'hand_' + side });
    // Pauldron
    if (style.pauldron === side || style.pauldron === 'both') {
      const c = ua.clone().add(new THREE.Vector3(sx * 0.03, 0.05, 0));
      B.add(ellipsoid(c, p.upperArmR * 2.0, p.upperArmR * 1.35, p.upperArmR * 1.85, 16), { color: pal.metal, mat: 'metal', weights: () => [[bi['upperarm_' + side], 0.6], [bi['clavicle_' + side], 0.4]] });
    }
    if (style.furShoulder === side) {
      const c = ua.clone().add(new THREE.Vector3(sx * 0.0, 0.07, -0.02));
      B.add(ellipsoid(c, p.upperArmR * 2.2, p.upperArmR * 1.2, p.upperArmR * 2.0, 14), { color: pal.fur || '#5a4636', weights: () => [[bi['upperarm_' + side], 0.5], [bi['clavicle_' + side], 0.5]] });
    }
  }

  // ---- legs
  for (const side of ['L', 'R']) {
    const th = J['thigh_' + side], sh = J['shin_' + side], ft = J['foot_' + side], to = J['toe_' + side];
    B.limb(th.clone().add(new THREE.Vector3(0, 0.05, 0)), sh, p.thighR * 1.12, p.shinR * 1.08, 'thigh_' + side, 'hips', style.pants ? pal.cloth : pal.skin, { bulge: 0.16, blend: 0.12 });
    B.limb(sh, ft, p.shinR * 1.15, p.shinR * 0.72, 'shin_' + side, 'thigh_' + side, style.pants ? pal.cloth : pal.skin, { bulge: 0.2 });
    // Boot shaft
    const bootTop = sh.clone().lerp(ft, 0.35);
    B.limb(bootTop, ft, p.shinR * 1.25, p.shinR * 1.05, 'shin_' + side, null, pal.boots, { bulge: 0.02, radial: 12 });
    // Foot (ankle → toe) rounded box
    const fl = p.footLen;
    const footBox = rbox(new THREE.Vector3(ft.x, p.ankleY * 0.55, ft.z + fl * 0.22), p.shinR * 1.9, p.ankleY * 1.15, fl * 0.8, 0.025);
    B.add(footBox, { color: pal.boots, weights: (v) => (v.z > to.z - fl * 0.08 ? [[bi['toe_' + side], 1]] : [[bi['foot_' + side], 1]]) });
  }

  // ---- costume layers
  if (style.kilt) {
    // Fur-trimmed kilt: rigid at the belt, follows the thighs at the hem.
    const top = p.spineY - 0.02, hem = p.hipY - (p.hipY - J.shin_L.y) * 0.55;
    const kilt = limbGeo(top - hem, p.hipR[0] * 1.38, p.hipR[0] * 1.08, { bulge: -0.05, radial: 20, sz: (p.hipR[1] + 0.02) / p.hipR[0], capBottom: false, capTop: false, rings: 5 });
    kilt.translate(0, hem, 0);
    B.add(kilt, {
      color: pal.cloth,
      weights: (v) => {
        const t = Math.min(1, Math.max(0, (top - v.y) / (top - hem)));
        const w = 0.55 * t * t;
        const thigh = v.x >= 0 ? bi.thigh_L : bi.thigh_R;
        return w > 0.001 ? [[bi.hips, 1 - w], [thigh, w]] : [[bi.hips, 1]];
      },
    });
    const trim = limbGeo(0.05, p.hipR[0] * 1.42, p.hipR[0] * 1.4, { bulge: 0.1, radial: 20, sz: (p.hipR[1] + 0.03) / p.hipR[0], capBottom: false, capTop: false, rings: 2 });
    trim.translate(0, hem - 0.02, 0);
    B.add(trim, { color: pal.fur || '#6a5442', weights: (v) => [[bi.hips, 0.45], [v.x >= 0 ? bi.thigh_L : bi.thigh_R, 0.55]] });
  }
  if (style.sash) {
    const sash = limbGeo(0.09, p.waistR[0] * 1.12, p.waistR[0] * 1.08, { bulge: 0.05, radial: 18, sz: p.waistR[1] / p.waistR[0] * 1.05, capBottom: false, capTop: false, rings: 2 });
    sash.translate(0, p.spineY - 0.08, 0);
    B.add(sash, { color: pal.cloth2, weights: torsoW });
    // hanging tail
    const tailA = new THREE.Vector3(p.waistR[0] * 0.6, p.spineY - 0.06, p.waistR[1] * 0.7);
    const tailB = tailA.clone().add(new THREE.Vector3(0.02, -0.34 * p.height / 1.8, 0.03));
    B.limb(tailA, tailB, 0.04, 0.03, 'hips', null, pal.cloth2, { bulge: 0, sz: 0.4 });
  }
  // Belt + buckle
  {
    const belt = limbGeo(0.06, p.waistR[0] * 1.08, p.waistR[0] * 1.06, { bulge: 0, radial: 18, sz: p.waistR[1] / p.waistR[0] * 1.1, capBottom: false, capTop: false, rings: 2 });
    belt.translate(0, p.spineY - 0.12, 0);
    B.add(belt, { color: pal.leather, weights: torsoW });
    B.add(rbox(new THREE.Vector3(0, p.spineY - 0.09, p.waistR[1] * 1.12), 0.08, 0.07, 0.025, 0.01), { color: pal.accent, bone: 'hips', mat: 'metal' });
  }
  if (style.armor === 'harness') {
    // Crossed chest straps
    for (const sx of [1, -1]) {
      const a = new THREE.Vector3(sx * p.shoulderW * 0.75, p.shoulderY + 0.02, p.chestR[1] * 0.7);
      const b = new THREE.Vector3(-sx * p.waistR[0] * 0.8, p.spineY + 0.02, p.waistR[1] * 1.0);
      B.limb(a, b, 0.028, 0.028, 'chest', 'spine', pal.leather, { bulge: 0, sz: 0.45, radial: 8, blend: 0.3 });
    }
    B.add(ellipsoid(new THREE.Vector3(0, (p.chestY + p.shoulderY) / 2 - 0.02, p.chestR[1] * 1.02), 0.05, 0.05, 0.02, 10), { color: pal.accent, bone: 'chest', mat: 'metal' });
  }
  if (style.cape) {
    const a = J.cape_1, b = J.cape_2, c = J.cape_3;
    B.limb(a, b, p.chestR[0] * 0.9, p.chestR[0] * 1.0, 'cape_1', 'chest', pal.cloth2, { bulge: 0, sz: 0.18, radial: 12 });
    B.limb(b, c, p.chestR[0] * 1.0, p.chestR[0] * 1.1, 'cape_2', 'cape_1', pal.cloth2, { bulge: 0, sz: 0.16, radial: 12 });
  }

  const materials = makeMaterials(pal);
  const { geo, mats } = B.bake(materials);
  const mesh = new THREE.SkinnedMesh(geo, mats);
  mesh.name = name + '_body';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  const root = new THREE.Group();
  root.name = name;
  root.add(bones.get('root'));
  root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(boneList));
  return { root, mesh, bones, materials: mats, hipHeight: p.hipY, proportions: p, source: 'placeholder' };
}

/** Horizontal ring (helm band / circlet) centred at c. */
function limbGeoAt(c, r, h) {
  const g = limbGeo(h, r, r, { bulge: 0, radial: 20, capBottom: false, capTop: false, rings: 2 });
  g.translate(c.x, c.y - h / 2, c.z);
  return g;
}

const armorMat = (style) => (style.armor === 'chain' || style.armor === 'plate' ? 'metal' : 'body');

function armorColor(style, pal, part) {
  switch (style.armor) {
    case 'scale': return part === 'belly' ? pal.cloth : pal.armor || '#2f5a52';
    case 'chain': return pal.armor || '#6d7078';
    case 'plate': return pal.armor || pal.metal;
    case 'rags': return pal.cloth;
    case 'harness': default: return part === 'shoulder' ? pal.skin : pal.skin;
  }
}
