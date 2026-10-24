// Procedural-fallback mesh helpers for beast models (used when the GLB is missing or &placeholder=1).
import * as THREE from 'three';

export const std = (color, rough = 0.75, metal = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
export function blob(r, s, mat, seg = 20) { const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.round(seg * 0.7)), mat); m.scale.set(...s); m.castShadow = true; return m; }
/** Tapered cylinder hanging DOWN from its joint (length along −Y). */
export function limb(r0, r1, len, mat, seg = 10) { const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1); g.translate(0, -len / 2, 0); const m = new THREE.Mesh(g, mat); m.castShadow = true; return m; }
/** Cone with its base at the origin, tip along +Y. */
export function cone(r, h, mat, seg = 8) { const g = new THREE.ConeGeometry(r, h, seg); g.translate(0, h / 2, 0); const m = new THREE.Mesh(g, mat); m.castShadow = true; return m; }
/** Orient a Y-up mesh so its +Y points along dir (parent space). */
export function aim(m, dir) { m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir).normalize()); return m; }
/** Tapered tube from a to b (parent space), radii r0 → r1. */
export function tube(a, b, r0, r1, mat, seg = 12) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), len = A.distanceTo(B);
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1); g.translate(0, len / 2, 0);
  const m = new THREE.Mesh(g, mat); m.castShadow = true; m.position.copy(A); aim(m, B.clone().sub(A).toArray()); return m;
}
