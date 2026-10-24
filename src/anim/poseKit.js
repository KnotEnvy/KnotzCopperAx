// Pose-authoring helpers for code-written clips. Everything here returns plain Euler-degree arrays in the
// CHARACTER-space convention of anim/retarget.js (+X forward, +Y up, +Z right; XYZ order), so the results
// drop straight into ClipDef keys:  pose: { ...arm('R', { upper:[...], fore:[...], blade:[...] }), spine:[0,0,-8] }
//
// Directions are character-space vectors relative to the CHEST's rest frame (arms) or the HIPS' rest frame
// (legs). They need not be normalized. Examples:  [1,0,0] forward · [0,1,0] up · [0,-1,0] down · [0,0,1] right.
//
//   arm(side, { upper, fore, blade, edge })   upper-arm dir, forearm dir, weapon blade dir (+ where the edge faces)
//   leg(side, { thigh, shin, toe })           thigh dir, shin dir, toe dir
//   REST_DIR                                  rest directions of the §2 A-pose (per bone, character space)
import * as THREE from 'three';

const R2D = 180 / Math.PI;
const A = (40 * Math.PI) / 180;
const V = (a) => new THREE.Vector3(a[0], a[1], a[2]).normalize();

export const REST_DIR = {
  upperarm_L: new THREE.Vector3(0, -Math.sin(A), -Math.cos(A)),
  upperarm_R: new THREE.Vector3(0, -Math.sin(A), Math.cos(A)),
  thigh: new THREE.Vector3(0, -1, 0),
  foot: new THREE.Vector3(0.93, -0.36, 0).normalize(),
  blade: new THREE.Vector3(1, 0, 0), // socket convention: blade forward at rest
  edge: new THREE.Vector3(0, 1, 0),  //                    weapon +Z (edge side) up at rest
};

const _e = new THREE.Euler();
const round = (x) => Math.round(x * 10) / 10;
export function toEuler(q) { _e.setFromQuaternion(q, 'XYZ'); return [round(_e.x * R2D), round(_e.y * R2D), round(_e.z * R2D)]; }
export function fromEuler(d) { return new THREE.Quaternion().setFromEuler(new THREE.Euler(d[0] / R2D, d[1] / R2D, d[2] / R2D, 'XYZ')); }
const swing = (from, to) => new THREE.Quaternion().setFromUnitVectors(from.clone().normalize(), to.clone().normalize());

/** Rotation taking rest frame (X, Y) onto (dir, up) — for weapons where the edge orientation matters. */
function frame(dir, up) {
  const x = dir.clone().normalize();
  const y = up.clone().sub(x.clone().multiplyScalar(up.dot(x))).normalize();
  if (y.lengthSq() < 1e-6) return swing(new THREE.Vector3(1, 0, 0), x);
  const z = new THREE.Vector3().crossVectors(x, y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/**
 * @param {'L'|'R'} side
 * @param {{upper?:number[], fore?:number[], blade?:number[], edge?:number[], twist?:number}} o
 */
export function arm(side, o = {}) {
  const d0 = REST_DIR['upperarm_' + side];
  const out = {};
  let qu = new THREE.Quaternion();
  if (o.upper) {
    qu = swing(d0, V(o.upper));
    if (o.twist) qu.premultiply(new THREE.Quaternion().setFromAxisAngle(V(o.upper), o.twist / R2D));
    out['upperarm_' + side] = toEuler(qu);
  }
  let qf = new THREE.Quaternion();
  if (o.fore) {
    const local = V(o.fore).applyQuaternion(qu.clone().invert());
    qf = swing(d0, local);
    out['forearm_' + side] = toEuler(qf);
  }
  if (o.blade) {
    const inv = qu.clone().multiply(qf).invert();
    const b = V(o.blade).applyQuaternion(inv);
    let qh;
    if (o.edge) qh = frame(b, V(o.edge).applyQuaternion(inv));
    else qh = swing(REST_DIR.blade, b);
    out['hand_' + side] = toEuler(qh);
  }
  return out;
}

/** Legs: thigh/shin/toe directions (hips rest frame). */
export function leg(side, o = {}) {
  const out = {};
  const d0 = REST_DIR.thigh;
  let qt = new THREE.Quaternion();
  if (o.thigh) { qt = swing(d0, V(o.thigh)); out['thigh_' + side] = toEuler(qt); }
  let qs = new THREE.Quaternion();
  if (o.shin) { qs = swing(d0, V(o.shin).applyQuaternion(qt.clone().invert())); out['shin_' + side] = toEuler(qs); }
  if (o.toe) { const qf = swing(REST_DIR.foot, V(o.toe).applyQuaternion(qt.clone().multiply(qs).invert())); out['foot_' + side] = toEuler(qf); }
  return out;
}

/** Merge several partial poses. */
export const pose = (...parts) => Object.assign({}, ...parts);
