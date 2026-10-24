// Beast rig driver: procedural animation of creature rigs (ART_PIPELINE §5.1 beast_biped / beast_quad bone names)
// that works identically on a GLB skeleton (bones with arbitrary Blender rest rolls) and on the procedural fallback
// (plain Groups). Rotations are given in MODEL axes (+Z forward, +Y up, +X = the beast's left) as offsets from the
// rest pose, applied at the joint (children follow): rig.rot('neck_1', pitch, yaw, roll) (degrees).
//   pitch > 0 tips the bone's far end DOWN (nose down), yaw > 0 turns it to the beast's left, roll > 0 banks it.
//   const rig = await loadBeastRig(game, 'mount_cluckhorn', buildFallback)   → { root, J, source, rot, pos, reset }
import * as THREE from 'three';

const D2R = Math.PI / 180;
const _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _w = new THREE.Quaternion();

export function makeRig(root, source = 'placeholder') {
  const J = {};
  root.traverse((o) => { if (o.isBone || o.userData.joint) J[o.name] = o; });
  root.updateMatrixWorld(true);
  const rootInv = new THREE.Quaternion(); root.getWorldQuaternion(rootInv).invert();
  const rest = {};
  for (const [n, o] of Object.entries(J)) {
    const wq = new THREE.Quaternion(); o.getWorldQuaternion(wq); wq.premultiply(rootInv);
    // Frame of the joint's PARENT at rest (model space): offsets are applied in the parent's rest frame.
    const pq = new THREE.Quaternion();
    if (o.parent) { o.parent.getWorldQuaternion(pq); pq.premultiply(rootInv); }
    rest[n] = { q: o.quaternion.clone(), p: o.position.clone(), pq, pqi: pq.clone().invert() };
  }
  const rig = {
    root, J, source, rest,
    /** Offset rotation of joint `n` in model axes (deg). Accumulates onto the rest pose (call reset() per frame). */
    rot(n, pitch = 0, yaw = 0, roll = 0) {
      const o = J[n], r = rest[n];
      if (!o) return;
      _e.set(pitch * D2R, yaw * D2R, roll * D2R, 'YXZ');
      _q.setFromEuler(_e);
      // local = parentRest^-1 * qModel * parentRest * restLocal
      _w.copy(r.pqi).multiply(_q).multiply(r.pq);
      o.quaternion.copy(_w).multiply(r.q);
    },
    /** Translation offset in model axes (m), relative to the rest position (in the parent's rest frame). */
    pos(n, x = 0, y = 0, z = 0) {
      const o = J[n], r = rest[n];
      if (!o) return;
      const v = new THREE.Vector3(x, y, z).applyQuaternion(r.pqi);
      o.position.copy(r.p).add(v);
    },
    reset() { for (const [n, o] of Object.entries(J)) { o.quaternion.copy(rest[n].q); o.position.copy(rest[n].p); } },
  };
  return rig;
}

/** GLB (skinned) if present, else the procedural fallback. Returns a rig (see makeRig). */
export async function loadBeastRig(game, assetId, buildFallback) {
  let root = null, source = 'placeholder';
  const params = game.params || new URLSearchParams(location.search);
  const forcePh = params && params.get && params.get('placeholder') === '1';
  if (!forcePh && game.assets && game.assets.instance) {
    try {
      const r = await game.assets.instance(assetId, { fallback: null });
      if (r && r.source === 'glb') {
        let bones = 0; r.root.traverse((o) => { if (o.isBone) bones++; });
        if (bones >= 8) { root = r.root; source = 'glb'; }
      }
    } catch (e) { root = null; }
  }
  if (!root) root = buildFallback();
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  return makeRig(root, source);
}

/** Procedural-fallback joint: an empty Group marked as a joint, placed at `p` (model space, relative to parent). */
export function joint(name, parent, p = [0, 0, 0]) {
  const g = new THREE.Group(); g.name = name; g.userData.joint = true; g.position.fromArray(p); if (parent) parent.add(g); return g;
}

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp01 = (x) => Math.max(0, Math.min(1, x));
export const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
/** 0→1 over [a,b] with smoothstep */
export const ramp = (x, a, b) => smooth((x - a) / Math.max(1e-6, b - a));
