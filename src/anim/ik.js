// IK helpers shared by the clip baker (bake-time weapon / hand / foot goals) and RigPost (runtime grip lock,
// foot planting). Everything works on live Object3D nodes in WORLD space, so it is independent of per-bone local
// axes (placeholder rig vs Blender GLB). Callers must keep matrixWorld current (updateWorldMatrix) before a solve;
// every setter here refreshes the changed node's subtree.
//
//   twoBone(a, b, c, T, pole)                 rotate a (root) and b (mid) so c's origin reaches world point T
//   armToSocket(rig, side, T, Qsock, pole)    2-bone arm solve putting socket_hand_<side> at T with world orientation
//                                             Qsock (the forearm absorbs part of the wrist twist: no candy wrappers)
//   socketQuatForWeapon(rig, side, Qw)        socket world orientation that holds a weapon at world orientation Qw
//   charDirToWorld(model, v) / charQuat(model)   character-space (+X fwd, +Y up, +Z right) → world
import * as THREE from 'three';
import { SOCKET_CONVENTION, charToModel } from './retarget.js';

const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _pq = new THREE.Quaternion();
const _A = new THREE.Vector3(), _B = new THREE.Vector3(), _C = new THREE.Vector3(), _T = new THREE.Vector3();
const _d = new THREE.Vector3(), _pole = new THREE.Vector3(), _u = new THREE.Vector3(), _w = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const CONV_INV = SOCKET_CONVENTION.clone().invert();
export const DEG = Math.PI / 180;

export function wq(o, out = new THREE.Quaternion()) { o.matrixWorld.decompose(_p, out, _s); return out; }
export function wp(o, out = new THREE.Vector3()) { return out.setFromMatrixPosition(o.matrixWorld); }
/** Set a node's WORLD orientation (parent matrixWorld must be current); refreshes its subtree. */
export function setWQ(o, q) {
  if (o.parent) { wq(o.parent, _pq).invert(); o.quaternion.copy(_pq).multiply(q); } else o.quaternion.copy(q);
  o.updateMatrixWorld(true);
}
/** Premultiply a world-space rotation onto a node. */
export function rotateWorld(o, q) { wq(o, _q3); _q3.premultiply(q); setWQ(o, _q3); }

/** Model-root world orientation (character space → world is charToModel then this). */
export function charQuat(model, out = new THREE.Quaternion()) { return wq(model, out); }
export function charDirToWorld(model, v, out = new THREE.Vector3()) {
  charToModel(v[0] ?? v.x, v[1] ?? v.y, v[2] ?? v.z, out);
  return out.applyQuaternion(wq(model, _q2));
}

/** World orientation from a character-space weapon frame (blade = weapon +Y, edge = weapon +Z). */
export function weaponQuatFromChar(model, blade, edge, out = new THREE.Quaternion()) {
  const Y = charDirToWorld(model, blade, new THREE.Vector3()).normalize();
  const e = charDirToWorld(model, edge || [0, 1, 0], new THREE.Vector3());
  let Z = e.sub(_u.copy(Y).multiplyScalar(e.dot(Y)));
  if (Z.lengthSq() < 1e-6) Z = new THREE.Vector3(0, 1, 0).cross(Y).cross(Y);
  Z.normalize();
  const X = new THREE.Vector3().crossVectors(Y, Z).normalize();
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
}

/** Socket world orientation that makes a weapon attached with SOCKET_CONVENTION face world orientation Qw. */
export function socketQuatForWeapon(rig, side, Qw, out = new THREE.Quaternion()) {
  const s = rig.bones.get('socket_hand_' + side);
  return out.copy(Qw).multiply(CONV_INV).multiply(s ? s.restQ : _q1.identity());
}

/**
 * Two-bone IK in world space. a → b → c (e.g. upperarm, forearm, hand). T: world target for c's origin.
 * pole: world direction the middle joint should bend toward (projected perpendicular to the a→T axis).
 * Returns { reach (d / chain length), miss (metres short) }.
 */
export function twoBone(a, b, c, T, pole) {
  wp(a, _A); wp(b, _B); wp(c, _C);
  const la = _A.distanceTo(_B), lb = _B.distanceTo(_C);
  _d.subVectors(T, _A);
  const d = _d.length();
  if (d < 1e-6 || la < 1e-6 || lb < 1e-6) return { reach: 0, miss: 0 };
  _d.multiplyScalar(1 / d);
  const dmax = (la + lb) * 0.9992, dmin = Math.abs(la - lb) * 1.02 + 1e-4;
  const dc = Math.min(dmax, Math.max(dmin, d));
  _pole.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_pole.lengthSq() < 1e-8) { _pole.subVectors(_B, _A); _pole.addScaledVector(_d, -_pole.dot(_d)); }
  if (_pole.lengthSq() < 1e-8) _pole.set(0, 1, 0).cross(_d);
  _pole.normalize();
  const x = (la * la - lb * lb + dc * dc) / (2 * dc), h = Math.sqrt(Math.max(la * la - x * x, 0));
  // desired elbow
  _w.copy(_A).addScaledVector(_d, x).addScaledVector(_pole, h);
  _q1.setFromUnitVectors(_u.subVectors(_B, _A).normalize(), _w.sub(_A).normalize());
  rotateWorld(a, _q1);
  wp(b, _B); wp(c, _C);
  _T.copy(_A).addScaledVector(_d, dc);
  _q1.setFromUnitVectors(_u.subVectors(_C, _B).normalize(), _w.subVectors(_T, _B).normalize());
  rotateWorld(b, _q1);
  return { reach: d / (la + lb), miss: Math.max(0, d - dmax) };
}

const _hq = new THREE.Quaternion(), _off = new THREE.Vector3(), _W = new THREE.Vector3(), _ax = new THREE.Vector3();
/**
 * Arm solve: socket_hand_<side> onto world point T with world orientation Qsock.
 * pronate (0..1): share of the wrist twist (about the forearm axis) the forearm takes (max ±100°).
 * Returns { miss, reach, strain (rad: hand local rotation away from rest) } or null if bones are missing.
 */
export function armToSocket(rig, side, T, Qsock, pole, pronate = 0.6) {
  const B = (n) => rig.bones.get(n);
  const up = B('upperarm_' + side), fo = B('forearm_' + side), ha = B('hand_' + side), so = B('socket_hand_' + side);
  if (!up || !fo || !ha || !so) return null;
  // desired hand world orientation and the wrist point that puts the socket on T
  _hq.copy(Qsock).multiply(_q2.copy(so.node.quaternion).invert());
  wp(so.node, _off).sub(wp(ha.node, _W)).applyQuaternion(wq(ha.node, _q3).invert()).applyQuaternion(_hq);
  _W.copy(T).sub(_off);
  const r = twoBone(up.node, fo.node, ha.node, _W, pole);
  if (pronate > 0) {
    // twist of the desired hand relative to the forearm, about the forearm→hand axis (forearm local)
    const delta = wq(fo.node, _q1).invert().multiply(_hq).multiply(_q2.copy(ha.restLocalQ).invert());
    _ax.copy(ha.node.position).normalize();
    const dot = _ax.x * delta.x + _ax.y * delta.y + _ax.z * delta.z;
    const tw = _q3.set(_ax.x * dot, _ax.y * dot, _ax.z * dot, delta.w);
    if (tw.lengthSq() > 1e-10) {
      tw.normalize();
      let ang = 2 * Math.acos(Math.min(1, Math.abs(tw.w)));
      if (ang > 1e-4) {
        const sgn = (Math.sign(tw.w) * Math.sign(dot)) || 1;
        ang = Math.min(ang * pronate, 100 * DEG);
        fo.node.quaternion.multiply(_q1.setFromAxisAngle(_ax, sgn * ang));
        fo.node.updateMatrixWorld(true);
      }
    }
  }
  setWQ(ha.node, _hq);
  return { miss: r.miss, reach: r.reach, strain: ha.node.quaternion.angleTo(ha.restLocalQ) };
}

/** Snapshot / restore local quaternions of a list of nodes (for trial solves and weight blending). */
export function snap(nodes, out = []) { nodes.forEach((n, i) => { (out[i] || (out[i] = new THREE.Quaternion())).copy(n.quaternion); }); return out; }
export function restore(nodes, qs) { nodes.forEach((n, i) => n.quaternion.copy(qs[i])); }
