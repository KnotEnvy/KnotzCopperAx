// Procedural placeholder weapons. Contract (same as weapon GLBs): grip point at the local origin, blade
// (or haft/head) along local +Y, cutting edges face ±Z, flats face ±X. With the socket convention
// (anim/retarget.js SOCKET_CONVENTION) the blade points forward and the edge faces up/down at rest.
//   buildWeapon(kind, palette) → THREE.Group (merged meshes; 2–3 draw calls)
//   kinds: 'greatsword' | 'sabre' | 'copperax' | 'club' | 'mace' | 'spear' | 'none'
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { noiseTexture } from './proceduralTextures.js';

function bladeShape(len, w, tip, curve = 0) {
  const s = new THREE.Shape();
  const N = 12;
  const cx = (t) => curve * Math.sin(t * Math.PI * 0.5) * len * 0.12;
  s.moveTo(-w / 2, 0);
  for (let i = 1; i <= N; i++) { const t = i / N; s.lineTo(-w / 2 * (1 - t * 0.25) + cx(t), t * (len - tip)); }
  s.lineTo(cx(1) + w * 0.1, len);
  for (let i = N; i >= 0; i--) { const t = i / N; s.lineTo(w / 2 * (1 - t * 0.25) + cx(t), t * (len - tip)); }
  return s;
}

function extrude(shape, depth, bevel) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 1.4, bevelSegments: 1, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  g.rotateY(Math.PI / 2); // flat of blade faces ±X → edge faces forward/back in the socket frame
  return g.index ? g.toNonIndexed() : g;
}

const cyl = (r0, r1, h, y, seg = 10) => { const g = new THREE.CylinderGeometry(r1, r0, h, seg); g.translate(0, y + h / 2, 0); return g.toNonIndexed(); };
const box = (w, h, d, y, x = 0, z = 0) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g.toNonIndexed(); };
const sph = (r, y, sx = 1, sy = 1, sz = 1) => { const g = new THREE.SphereGeometry(r, 12, 8); g.scale(sx, sy, sz); g.translate(0, y, 0); return g.toNonIndexed(); };

function clean(g) { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); g.clearGroups(); return g; }

function makeMesh(parts, mat, name) {
  const g = mergeGeometries(parts.map(clean), false);
  // Degenerate (zero-area) extrude triangles at blade tips get zero-length normals → NaN in lighting. Patch them.
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) if (Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) < 1e-4) n.setXYZ(i, 0, 0, 1);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true; m.name = name;
  return m;
}

export function buildWeapon(kind = 'greatsword', palette = {}) {
  const grp = new THREE.Group();
  grp.name = 'weapon_' + kind;
  if (kind === 'none' || !kind) return grp;
  const rough = noiseTexture({ size: 128, scale: 14, octaves: 4, seed: 3, colorA: '#9a948c', colorB: '#ffffff' });
  const steel = new THREE.MeshStandardMaterial({ color: palette.blade || '#c9ccd2', metalness: 0.95, roughness: 0.26, map: rough, name: 'w_steel' });
  const grip = new THREE.MeshStandardMaterial({ color: palette.grip || '#3a2618', metalness: 0, roughness: 0.8, map: rough, name: 'w_grip' });
  const brass = new THREE.MeshStandardMaterial({ color: palette.fitting || '#b98a3c', metalness: 0.9, roughness: 0.35, name: 'w_brass' });
  const metal = [], wood = [], fit = [];
  if (kind === 'greatsword') {
    wood.push(cyl(0.022, 0.02, 0.32, -0.17));
    fit.push(sph(0.04, -0.2, 1, 0.8, 1), box(0.38, 0.04, 0.05, 0.16));
    metal.push(extrude(bladeShape(1.2, 0.09, 0.16), 0.012, 0.007));
    metal[metal.length - 1].translate(0, 0.18, 0);
  } else if (kind === 'sabre') {
    wood.push(cyl(0.016, 0.014, 0.16, -0.08));
    fit.push(sph(0.026, -0.1), box(0.14, 0.022, 0.03, 0.085));
    const b = extrude(bladeShape(0.74, 0.05, 0.12, 1), 0.008, 0.005); b.translate(0, 0.095, 0); metal.push(b);
  } else if (kind === 'copperax') {
    wood.push(cyl(0.026, 0.024, 1.12, -0.46));
    fit.push(sph(0.042, -0.48), cyl(0.034, 0.034, 0.05, 0.1), cyl(0.036, 0.036, 0.06, 0.46));
    // double-bit crescent head
    for (const side of [1, -1]) {
      const s = new THREE.Shape();
      s.moveTo(0, -0.1); s.quadraticCurveTo(0.14 * side, -0.16, 0.26 * side, -0.24);
      s.quadraticCurveTo(0.34 * side, 0.0, 0.26 * side, 0.24);
      s.quadraticCurveTo(0.14 * side, 0.16, 0, 0.1); s.lineTo(0, -0.1);
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.012, bevelSegments: 1, curveSegments: 8 });
      g.translate(0, 0, -0.011);
      g.rotateY(Math.PI / 2); g.translate(0, 0.56, 0);
      metal.push(g.index ? g.toNonIndexed() : g);
    }
    const spike = new THREE.ConeGeometry(0.03, 0.16, 8); spike.translate(0, 0.72, 0); metal.push(spike.toNonIndexed());
    steel.color.set(palette.blade || '#c8763e'); steel.roughness = 0.3;
    steel.emissive = new THREE.Color('#ff7a2a'); steel.emissiveIntensity = 0.06;
  } else if (kind === 'club') {
    wood.push(cyl(0.03, 0.07, 0.75, -0.12, 9));
    fit.push(cyl(0.075, 0.075, 0.06, 0.45, 9));
    for (let i = 0; i < 5; i++) { const c = new THREE.ConeGeometry(0.02, 0.07, 6); c.rotateZ(Math.PI / 2); c.translate(0.08, 0.35 + i * 0.05, 0); c.rotateY(i * 1.3); metal.push(c.toNonIndexed()); }
  } else if (kind === 'mace') {
    wood.push(cyl(0.02, 0.02, 0.55, -0.12));
    metal.push(sph(0.09, 0.5));
    for (let i = 0; i < 6; i++) { const c = new THREE.ConeGeometry(0.03, 0.09, 6); c.translate(0, 0.12, 0); c.rotateX(Math.PI / 2); c.rotateY(i * Math.PI / 3); c.translate(0, 0.5, 0); metal.push(c.toNonIndexed()); }
  } else if (kind === 'spear') {
    wood.push(cyl(0.018, 0.018, 1.7, -0.7));
    const tip = new THREE.ConeGeometry(0.04, 0.28, 4); tip.translate(0, 1.14, 0); metal.push(tip.toNonIndexed());
  }
  if (metal.length) grp.add(makeMesh(metal, steel, 'blade'));
  if (wood.length) grp.add(makeMesh(wood, grip, 'grip'));
  if (fit.length) grp.add(makeMesh(fit, brass, 'fittings'));
  grp.traverse((o) => { if (o.isMesh) o.userData.ownsMaterial = true; });
  return grp;
}
