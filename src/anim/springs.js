// Procedural secondary motion: spring-damper chains for hair_*, beard_*, kilt_F/B/L/R_*, cape_*, tail_* bones.
// Each bone's TIP is simulated in world space and pulled toward where the animation puts it. Damping acts on the
// velocity RELATIVE to that animated tip, so steady running produces no lag (only a little air drag streams hair
// back), while starts, stops, hits and landings make everything swing and settle. Tips keep their bone length,
// stay within an angle cone of the animated direction, and are pushed out of simple body colliders (head sphere,
// torso capsule, thigh capsules for kilts) whose radii auto-calibrate from the rest pose (never pushes rest).
//
//   const sc = new SpringChains(rigInfo, profile); sc.nodes() → bones it writes (for FK restore)
//   sc.update(dt, gain)      after all other pose work (reads the animated pose, writes rotations)
//   sc.kick(worldVec)        velocity impulse (m/s) on every tip (hits, landings); sc.reset()
import * as THREE from 'three';
import { wp, wq, rotateWorld } from './ik.js';

const FAMILIES = [
  { fam: 'hair', re: /^hair(?:_([A-Za-z]+))?_(\d+)$/, k: 95, c: 7, air: 1.4, grav: 0.4, limit: 70, coll: ['head', 'torso'] },
  { fam: 'beard', re: /^beard(?:_([A-Za-z]+))?_(\d+)$/, k: 170, c: 10, air: 0.6, grav: 0.3, limit: 38, coll: ['torso'] },
  { fam: 'kilt', re: /^kilt_([A-Za-z]+)_(\d+)$/, k: 150, c: 9, air: 1.0, grav: 0.35, limit: 58, coll: ['thighs'] },
  { fam: 'cape', re: /^cape(?:_([A-Za-z]+))?_(\d+)$/, k: 60, c: 5, air: 2.2, grav: 0.5, limit: 80, coll: ['torso', 'thighs'] },
  { fam: 'tail', re: /^tail(?:_([A-Za-z]+))?_(\d+)$/, k: 70, c: 6, air: 0.8, grav: 0.2, limit: 60, coll: [] },
];
const G = new THREE.Vector3(0, -9.81, 0);
const _H = new THREE.Vector3(), _P = new THREE.Vector3(), _a = new THREE.Vector3(), _d1 = new THREE.Vector3(), _d2 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _t = new THREE.Vector3(), _c = new THREE.Vector3(), _e = new THREE.Vector3();

function closestOnSeg(p, a, b, out) {
  const ab = _e.subVectors(b, a); const l2 = ab.lengthSq();
  const u = l2 > 1e-9 ? Math.min(1, Math.max(0, _t.subVectors(p, a).dot(ab) / l2)) : 0;
  return out.copy(a).addScaledVector(ab, u);
}

export class SpringChains {
  constructor(rig, profile = {}) {
    this.rig = rig;
    this.gains = profile.springs || {};
    const stiff = this.gains.stiff ?? 1;
    const groups = new Map();
    for (const [name, b] of rig.bones) {
      for (const F of FAMILIES) {
        const m = F.re.exec(name);
        if (!m) continue;
        const key = F.fam + ':' + (m[1] || '');
        if (!groups.has(key)) groups.set(key, { F, list: [] });
        groups.get(key).list.push({ i: +m[2], name, b });
        break;
      }
    }
    this.chains = [];
    const P = (n) => rig.bones.get(n);
    for (const { F, list } of groups.values()) {
      if ((this.gains[F.fam] ?? 1) <= 0) continue;
      list.sort((x, y) => x.i - y.i);
      const n = list.length;
      const bones = list.map((e, j) => {
        const next = list[j + 1];
        // tip offset in the bone's local frame (child's position, or the continuation of the previous segment)
        let off;
        if (next) off = next.b.restLocalP.clone();
        else off = e.b.restLocalP.clone().applyQuaternion(e.b.restLocalQ.clone().invert());
        if (off.lengthSq() < 1e-8) off.set(0, 0.08, 0);
        // rest tip in model space (for collider calibration)
        const tipRest = next ? next.b.restP.clone() : e.b.restP.clone().add(e.b.restP.clone().sub(e.b.node.parent && P(e.b.node.parent.name) ? P(e.b.node.parent.name).restP : e.b.restP).setLength(off.length()));
        const f = n > 1 ? j / (n - 1) : 0;
        return {
          node: e.b.node, off, tipRest, X: new THREE.Vector3(), V: new THREE.Vector3(), Pa: new THREE.Vector3(), init: false,
          // Optional per-character family limit (degrees); old limits remain the default.
          k: F.k * stiff * (1 - 0.35 * f), c: F.c, limit: ((this.gains[F.fam + 'Limit'] ?? F.limit) * (0.75 + 0.25 * f)) * Math.PI / 180, minD: {},
        };
      });
      this.chains.push({ F, bones, gain: this.gains[F.fam] ?? 1 });
    }
    // colliders (model-space rest geometry → per-bone calibrated radii)
    const has = (n) => rig.bones.has(n);
    const s = rig.hipScale;
    this.coll = {
      head: has('head') ? { r: 0.135 * s, up: 0.085 * s } : null,
      torso: has('hips') && (has('neck') || has('chest')) ? { r: 0.16 * s } : null,
      thighs: has('thigh_L') && has('shin_L') && has('thigh_R') && has('shin_R') ? { r: 0.12 * s } : null,
    };
    const restSeg = (a, b) => [P(a).restP.clone(), P(b).restP.clone()];
    for (const ch of this.chains) for (const bn of ch.bones) {
      for (const cname of ch.F.coll) {
        const C = this.coll[cname];
        if (!C) continue;
        let d = Infinity;
        if (cname === 'head') d = bn.tipRest.distanceTo(P('head').restP.clone().add(_t.set(0, C.up, 0)));
        else if (cname === 'torso') { const [a, b] = restSeg('hips', has('neck') ? 'neck' : 'chest'); d = bn.tipRest.distanceTo(closestOnSeg(bn.tipRest, a, b, _c)); }
        else if (cname === 'thighs') for (const sd of ['L', 'R']) { const [a, b] = restSeg('thigh_' + sd, 'shin_' + sd); d = Math.min(d, bn.tipRest.distanceTo(closestOnSeg(bn.tipRest, a, b, _c))); }
        bn.minD[cname] = Math.min(C.r, d * 0.92);
      }
    }
    this._seg = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  }

  nodes() { const out = []; for (const ch of this.chains) for (const b of ch.bones) out.push(b.node); return out; }
  get count() { return this.chains.length; }
  reset() { for (const ch of this.chains) for (const b of ch.bones) b.init = false; }
  kick(v, scale = 1) { for (const ch of this.chains) for (const b of ch.bones) b.V.addScaledVector(v, scale * ch.gain); }

  _colliders(model) {
    const B = (n) => this.rig.bones.get(n)?.node;
    const up = _d1.set(0, 1, 0).applyQuaternion(wq(model, _q));
    const [h, t0, t1, l0, l1, r0] = this._seg;
    const out = {};
    if (this.coll.head) { wp(B('head'), h).addScaledVector(up, this.coll.head.up); out.head = h; }
    if (this.coll.torso) { wp(B('hips'), t0); wp(B('neck') || B('chest'), t1); out.torso = [t0, t1]; }
    if (this.coll.thighs) {
      wp(B('thigh_L'), l0); wp(B('shin_L'), l1); wp(B('thigh_R'), r0);
      if (!this._r1) this._r1 = new THREE.Vector3();
      wp(B('shin_R'), this._r1);
      out.thighs = [[l0, l1], [r0, this._r1]];
    }
    return out;
  }

  /** dt: seconds since the last update (0 = hitstop: re-apply without stepping). gain scales everything (0..1). */
  update(dt, model, gain = 1) {
    if (!this.chains.length) return;
    const h = Math.min(dt, 1 / 30);
    const col = this._colliders(model);
    for (const ch of this.chains) {
      const g = gain * ch.gain;
      for (const bn of ch.bones) {
        const node = bn.node;
        wp(node, _H);
        node.localToWorld(_P.copy(bn.off));
        const L = _P.distanceTo(_H);
        if (!bn.init || bn.X.distanceTo(_P) > L * 4 + 0.5 || g <= 0) {
          bn.X.copy(_P); bn.V.set(0, 0, 0); bn.Pa.copy(_P); bn.init = true;
          if (g <= 0) continue;
        }
        if (h > 0) {
          // animated tip velocity (for relative damping)
          const va = _a.subVectors(_P, bn.Pa).multiplyScalar(1 / h);
          const acc = _d1.subVectors(_P, bn.X).multiplyScalar(bn.k);
          acc.addScaledVector(_d2.subVectors(bn.V, va), -bn.c);
          acc.addScaledVector(bn.V, -ch.F.air);
          acc.addScaledVector(G, ch.F.grav);
          const V = bn.V.addScaledVector(acc, h);
          const X0 = _d2.copy(bn.X);
          bn.X.addScaledVector(V, h);
          this._constrain(bn, ch, col, _H, _P, L);
          bn.V.subVectors(bn.X, X0).multiplyScalar(1 / h);
          if (bn.V.lengthSq() > 900) bn.V.setLength(30);
        } else this._constrain(bn, ch, col, _H, _P, L);
        bn.Pa.copy(_P);
        // blend by gain, rotate the bone from the animated tip to the simulated one
        _t.copy(_P).lerp(bn.X, g);
        const a = _d1.subVectors(_P, _H), b = _d2.subVectors(_t, _H);
        if (a.lengthSq() > 1e-10 && b.lengthSq() > 1e-10) {
          _q.setFromUnitVectors(a.normalize(), b.normalize());
          rotateWorld(node, _q);
        }
      }
    }
  }

  _constrain(bn, ch, col, H, P, L) {
    const X = bn.X;
    const fix = () => { _t.subVectors(X, H); const l = _t.length(); if (l > 1e-6) X.copy(H).addScaledVector(_t, L / l); else X.copy(P); };
    fix();
    for (const cname of ch.F.coll) {
      const r = bn.minD[cname];
      if (!r || !col[cname]) continue;
      if (cname === 'head') this._pushOut(X, col.head, r);
      else if (cname === 'torso') this._pushOut(X, closestOnSeg(X, col.torso[0], col.torso[1], _c), r);
      else for (const [a, b] of col.thighs) this._pushOut(X, closestOnSeg(X, a, b, _c), r);
    }
    fix();
    // cone limit around the animated direction
    const a = _d1.subVectors(P, H).normalize(), b = _t.subVectors(X, H).normalize();
    const ang = Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
    if (ang > bn.limit) {
      const k = bn.limit / ang;
      b.lerp(a, 1 - k).normalize();
      X.copy(H).addScaledVector(b, L);
    }
  }

  _pushOut(X, c, r) {
    const d = _e.subVectors(X, c); const l = d.length();
    if (l < r && l > 1e-6) X.copy(c).addScaledVector(d, r / l);
  }
}
