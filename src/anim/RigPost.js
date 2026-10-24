// RigPost: the per-frame procedural layer that runs after the THREE mixer (Animator.render). Order:
//   1. charge overlay      (Hero 'charge' state: the paused heavy windup blends into the character's `heavy_charge`
//                           loop; tremble grows with actor.chargeLevel)
//   2. additive layers     breathing (faster/deeper after exertion), hit flinch (damped spring kicked when the actor
//                           takes damage, direction from the attacker), momentum lean (accel/decel), look-at toward
//                           the nearest foe (chest → neck → head share)
//   3. weight              hips dip on landing / heavy impact, victim shake during hitstop, squash & stretch
//                           (model root scale about the feet) on land / take-off / impact
//   4. foot plant          two-bone leg IK keeps planted feet on the floor (no sinking, low skate) where the clip's
//                           `plant` meta says so
//   5. blade guard         the weapon's blade segment is swung (about the wrist) out of the head sphere and torso
//                           capsule — crossfades and additive layers can never drag a greatsword through the face
//   6. grip lock           two-handed weapons: the off hand is IK-locked onto the handle (clip `grip` meta)
//   7. spring chains       hair / beard / kilt / cape / tail secondary motion (springs.js)
// Everything reads the actor (view.userData.actor) defensively; with no actor (rigtest) only 4–7 run.
// Bones touched here are restored to their mixer (FK) values before the next mixer update (begin()).
import * as THREE from 'three';
import { profileFor } from './profiles.js';
import { LimbSolver } from './clipBaker.js';
import { SpringChains } from './springs.js';
import { wp, wq, setWQ, rotateWorld, twoBone, snap, restore, DEG } from './ik.js';
import { Q_C2M, modelToChar } from './retarget.js';

const CORE = ['hips', 'spine', 'chest', 'neck', 'head', 'clavicle_L', 'upperarm_L', 'forearm_L', 'hand_L', 'clavicle_R', 'upperarm_R', 'forearm_R', 'hand_R',
  'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R'];
const REACT = new Set(['hitstun', 'knockdown', 'down', 'getup', 'dead', 'grabbed', 'thrown']);
const NO_LOOK = new Set(['knockdown', 'down', 'dead', 'grabbed', 'thrown', 'getup']);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();
const _Y = new THREE.Vector3(0, 1, 0);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const damp = (cur, tgt, rate, dt) => cur + (tgt - cur) * (1 - Math.exp(-rate * dt));

function findWeapon(socket) {
  if (!socket) return null;
  for (const c of socket.children) if (!c.isBone && c.type !== 'Bone') return c;
  return null;
}
function segSegClosest(p1, q1, p2, q2, c1, c2) {
  // closest points between segments p1q1 and p2q2 (Ericson)
  const d1 = _v4.subVectors(q1, p1), d2 = _v5.subVectors(q2, p2), r = _v3.subVectors(p1, p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s = 0, t = 0;
  if (a <= 1e-9 && e <= 1e-9) { c1.copy(p1); c2.copy(p2); return; }
  if (a <= 1e-9) { t = clamp(f / e, 0, 1); }
  else {
    const c = d1.dot(r);
    if (e <= 1e-9) s = clamp(-c / a, 0, 1);
    else {
      const b = d1.dot(d2), den = a * e - b * b;
      s = den > 1e-9 ? clamp((b * f - c * e) / den, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  c1.copy(p1).addScaledVector(d1, s); c2.copy(p2).addScaledVector(d2, t);
}

export class RigPost {
  constructor(an) {
    this.an = an;
    this.model = an.model;
    this.rig = an.rigInfo;
    const actor = an.actor;
    this.profile = profileFor(an.character, actor && actor.def && actor.def.anim);
    this.solver = new LimbSolver(this.rig, this.profile);
    this.n = {};
    for (const n of CORE) { const b = this.rig.bones.get(n); if (b) this.n[n] = b.node; }
    this.springs = new SpringChains(this.rig, this.profile);
    this.touch = [...new Set([...Object.values(this.n), ...this.springs.nodes()])];
    this.fkQ = this.touch.map((o) => o.quaternion.clone());
    this.hipsP = this.n.hips ? this.n.hips.position.clone() : null;
    this.baseScale = this.model.scale.clone();
    this.cached = false;
    const sock = (s) => this.rig.bones.get('socket_hand_' + s)?.node;
    this.weapons = { R: findWeapon(sock('R')), L: findWeapon(sock('L')) };
    this.hipDelta = new THREE.Vector3();
    // state
    this.t = 0; this.frame = 0;
    this.breath = Math.random() * 6; this.exert = 0;
    this.flinch = { x: 0, y: 0, vx: 0, vy: 0 };
    this.look = { yaw: 0, pitch: 0, w: 0, target: null, refresh: 0 };
    this.lean = { v: 0, prevVx: 0, acc: 0 };
    this.dip = { y: 0, v: 0 };
    this.sq = { s: 0, v: 0 };
    this.charge = { w: 0, t: 0, ov: null, tried: false };
    this.lastDmg = actor ? actor.damageTaken || 0 : 0;
    this.wasGrounded = actor ? !!actor.grounded : true;
    this.wasHitstop = 0;
    this.locks = { L: null, R: null };
    this.lastFacing = actor ? actor.facing : 1;
    this.stats = { guard: 0, gripMiss: 0 };
  }

  /** Restore bones this layer wrote to their FK (mixer) values: call before mixer.update() and before new actions bind. */
  begin() {
    if (!this.cached) return;
    restore(this.touch, this.fkQ);
    if (this.hipsP) this.n.hips.position.copy(this.hipsP);
    this.model.scale.copy(this.baseScale);
  }

  /** Char-space rotation (Euler XYZ deg about the character's rest axes) as a WORLD quaternion. */
  _charQ(x, y, z, out) {
    wq(this.model, _q2).multiply(Q_C2M);            // char → world
    _e.set(x * DEG, y * DEG, z * DEG, 'XYZ');
    out.setFromEuler(_e);
    return out.premultiply(_q2).multiply(_q2.invert());
  }
  _rot(name, x, y, z) { const o = this.n[name]; if (!o || (!x && !y && !z)) return; rotateWorld(o, this._charQ(x, y, z, _q)); }

  apply(dt, meta) {
    const an = this.an, a = an.actor, model = this.model;
    snap(this.touch, this.fkQ);
    if (this.hipsP) this.hipsP.copy(this.n.hips.position);
    this.cached = true;
    this.t += dt; this.frame++;
    model.updateWorldMatrix(true, true);
    const st = a && a.fsm ? a.fsm.name : 'idle';
    const react = REACT.has(st);
    const S = this.rig.hipScale;

    if (a) {
      this._events(a, st, dt);
      this._charge(dt, a, st);
      this._layers(dt, a, st, react, meta);
      this._weight(dt, a, st, react);
      model.updateWorldMatrix(false, true);
    }
    // 4. foot plant
    const pw = (meta ? meta.plant : 0) * (a ? (a.grounded && !react ? 1 : 0) : 1);
    if (pw > 0.02 && this.solver.ok.legL && this.solver.ok.legR) { this._plant('L', pw, S); this._plant('R', pw, S); }
    else { this.locks.L = this.locks.R = null; }
    // 5. blade guard
    if (!meta || meta.guard > 0) { this._guard('R', S); if (this.weapons.L) this._guard('L', S); }
    // 6. grip lock
    const gw = meta ? meta.grip : 0;
    if (gw > 0.01 && this.profile.grip.twoHand && this.weapons.R) {
      const r = this.solver.grip(gw);
      this.stats.gripMiss = r ? r.miss : -1;
    }
    // 7. springs
    this.springs.update(dt, model, meta ? meta.springs : 1);
  }

  // ------------------------------------------------------------------ actor-driven impulses
  _events(a, st, dt) {
    const dmg = a.damageTaken || 0;
    if (dmg > this.lastDmg) {
      const m = clamp((dmg - this.lastDmg) / 7, 0.45, 1.5);
      const by = a.lastHitBy;
      const front = by ? Math.sign((by.pos.x - a.pos.x) * (a.facing || 1)) >= 0 : true;
      const side = by ? Math.sign((by.pos.z - a.pos.z) || (Math.random() - 0.5)) : 1;
      this.flinch.vx += (front ? 1 : -1) * 420 * m;           // pitch: back if hit from the front
      this.flinch.vy += side * 210 * m * (Math.random() < 0.5 ? 1 : -1);
      this.sq.v -= 1.2 * m;
      const dir = _v.set(by ? Math.sign(a.pos.x - by.pos.x) || -a.facing : -a.facing, 0.35, 0).multiplyScalar(2.2 * m);
      this.springs.kick(dir);
    }
    this.lastDmg = dmg;
    // landing / take-off
    const g = !!a.grounded;
    if (g && !this.wasGrounded) {
      const sp = clamp(a.lastLandSpeed || 5, 2, 16);
      const wt = this.profile.weight;
      this.dip.v -= sp * 0.11 * wt;
      this.sq.v -= sp * 0.12;
      this.springs.kick(_v.set(0, -sp * 0.35, 0));
    } else if (!g && this.wasGrounded && (a.vel ? a.vel.y > 2 : false)) {
      this.sq.v += 1.6;
      this.dip.v += 0.25;
    }
    this.wasGrounded = g;
    // landing a blow: attacker hitstop onset
    const hs = a.hitstop || 0;
    if (hs > 0 && this.wasHitstop <= 0 && st === 'attack') {
      this.sq.v -= 0.5;
      this.dip.v -= 0.18 * this.profile.weight;
      this.springs.kick(_v.set((a.facing || 1) * 1.2, -0.4, 0));
    }
    this.wasHitstop = hs;
    if (a.facing !== this.lastFacing) { this.locks.L = this.locks.R = null; this.lastFacing = a.facing; }
    // exertion (faster, deeper breathing after fighting)
    if (st === 'attack' || st === 'charge' || st === 'throw' || st === 'run') this.exert = Math.min(1, this.exert + dt * 0.45);
    else this.exert = Math.max(0, this.exert - dt * 0.12);
  }

  _charge(dt, a, st) {
    const C = this.charge;
    const want = st === 'charge' ? 1 : 0;
    C.w = clamp(C.w + (want - C.w) * Math.min(1, dt * (want ? 9 : 22)), 0, 1);
    if (want) C.t += dt; else if (C.w < 0.01) C.t = 0;
    if (C.w < 0.005) return;
    if (!C.ov && !C.tried) { C.tried = true; C.ov = this.an.overlay('heavy_charge'); }
    const lvl = a.chargeLevel || 0;
    if (C.ov) this.an.sampleOverlay(C.ov, C.t, C.w);
    // tremble grows with the charge level (power building up)
    const amp = [0.35, 0.9, 1.6, 2.6][clamp(lvl, 0, 3)] * C.w;
    const n = (f, p) => Math.sin(this.t * f + p) * 0.6 + Math.sin(this.t * f * 2.3 + p * 1.7) * 0.4;
    this._rot('chest', n(37, 0) * amp * 0.5, n(29, 1) * amp * 0.4, n(33, 2) * amp);
    this._rot('upperarm_R', n(41, 3) * amp, 0, n(39, 4) * amp);
    this._rot('upperarm_L', n(43, 5) * amp, 0, n(35, 6) * amp);
    if (this.n.hips) this.hipDelta.y -= lvl * 0.012 * C.w;
  }

  _layers(dt, a, st, react, meta) {
    // breathing
    const period = 3.3 - this.exert * 1.7;
    this.breath += (dt * Math.PI * 2) / period;
    const bAmp = (0.45 + (meta ? meta.breathe : 0) * 0.8 + this.exert * 1.1) * (this.profile.breathe ?? 1) * (st === 'dead' ? 0 : 1);
    if (bAmp > 0) {
      const b = Math.sin(this.breath), b2 = Math.sin(this.breath - 0.6);
      this._rot('spine', 0, 0, b * 0.5 * bAmp);
      this._rot('chest', 0, 0, b * 1.3 * bAmp);
      this._rot('clavicle_L', b2 * 1.4 * bAmp, 0, 0);
      this._rot('clavicle_R', -b2 * 1.4 * bAmp, 0, 0);
      this._rot('head', 0, 0, -b * 0.9 * bAmp);
    }
    // hit flinch spring (degrees)
    const F = this.flinch;
    if (Math.abs(F.x) + Math.abs(F.y) + Math.abs(F.vx) + Math.abs(F.vy) > 0.01 && dt > 0) {
      const K = 520, Cd = 2 * Math.sqrt(K) * 0.42;
      const h = Math.min(dt, 1 / 30);
      F.vx += (-K * F.x - Cd * F.vx) * h; F.vy += (-K * F.y - Cd * F.vy) * h;
      F.x = clamp(F.x + F.vx * h, -22, 22); F.y = clamp(F.y + F.vy * h, -18, 18);
      const w = meta ? meta.flinch : 1;
      this._rot('spine', 0, F.y * 0.25 * w, F.x * 0.25 * w);
      this._rot('chest', 0, F.y * 0.35 * w, F.x * 0.35 * w);
      this._rot('neck', 0, F.y * 0.2 * w, F.x * 0.25 * w);
      this._rot('head', F.y * 0.1 * w, F.y * 0.2 * w, F.x * 0.35 * w);
    }
    // momentum lean (accelerating tips the torso forward, braking tips it back)
    if (dt > 0 && a.vel) {
      const vx = a.vel.x * (a.facing || 1);
      const acc = (vx - this.lean.prevVx) / Math.max(dt, 1 / 240);
      this.lean.prevVx = vx;
      this.lean.acc = damp(this.lean.acc, clamp(acc, -60, 60), 10, dt);
      const on = a.grounded && !react && st !== 'charge' ? 1 : 0;
      this.lean.v = damp(this.lean.v, on * clamp(-this.lean.acc * 0.16, -7, 7), 12, dt);
      if (Math.abs(this.lean.v) > 0.05) { this._rot('spine', 0, 0, this.lean.v * 0.55); this._rot('chest', 0, 0, this.lean.v * 0.45); }
    }
    // look-at toward the nearest foe
    this._look(dt, a, st, meta);
  }

  _look(dt, a, st, meta) {
    const L = this.look;
    const g = a.game;
    if ((L.refresh -= dt) <= 0 && g && g.world && g.world.query) {
      L.refresh = 0.25;
      let best = null, bd = 49;
      try {
        for (const o of g.world.query({ notTeam: a.team, alive: true })) {
          if (o === a || !o.pos || o.team === 'neutral' && a.team === 'neutral') continue;
          const dx = o.pos.x - a.pos.x, dz = o.pos.z - a.pos.z, d2 = dx * dx + dz * dz;
          if (d2 < bd) { bd = d2; best = o; }
        }
      } catch { best = null; }
      L.target = best;
    }
    let yaw = 0, pitch = 0, w = 0;
    const T = L.target;
    if (T && !T.removed && this.n.head && !NO_LOOK.has(st)) {
      const head = wp(this.n.head, _v);
      const tgt = _v2.set(T.view ? T.view.position.x : T.pos.x, (T.view ? T.view.position.y : T.pos.y) + (T.height || 1.7) * 0.78, T.view ? T.view.position.z : T.pos.z);
      const dm = tgt.sub(head).applyQuaternion(wq(this.model, _q).invert());
      const c = modelToChar(dm, _v3);
      const hz = Math.hypot(c.x, c.z);
      yaw = Math.atan2(-c.z, c.x) / DEG;
      pitch = Math.atan2(c.y, hz) / DEG;
      const lim = this.profile.look;
      if (Math.abs(yaw) < 105) {
        w = (meta ? meta.look : 1) * (st === 'attack' || st === 'throw' || st === 'clinch' ? 0.55 : st === 'hitstun' ? 0.3 : 1);
        yaw = clamp(yaw, -lim.yaw, lim.yaw); pitch = clamp(pitch, -lim.pitch, lim.pitch);
      } else { yaw = 0; pitch = 0; }
    }
    L.yaw = damp(L.yaw, yaw * w, 7, dt); L.pitch = damp(L.pitch, pitch * w, 7, dt);
    if (Math.abs(L.yaw) + Math.abs(L.pitch) < 0.05) return;
    this._rot('chest', 0, L.yaw * 0.2, 0);
    this._rot('neck', 0, L.yaw * 0.35, L.pitch * 0.4);
    this._rot('head', 0, L.yaw * 0.45, L.pitch * 0.6);
  }

  _weight(dt, a, st, react) {
    const h = Math.min(dt, 1 / 30);
    const D = this.dip, Q = this.sq, S = this.rig.hipScale;
    if (h > 0) {
      const K = 260 / this.profile.weight, C = 2 * Math.sqrt(K) * 0.62;
      D.v += (-K * D.y - C * D.v) * h; D.y = clamp(D.y + D.v * h, -0.14, 0.05);
      const Ks = 480, Cs = 2 * Math.sqrt(Ks) * 0.3;
      Q.v += (-Ks * Q.s - Cs * Q.v) * h; Q.s = clamp(Q.s + Q.v * h, -0.075, 0.06);
    }
    this.hipDelta.y += D.y;
    // victim shake while frozen in hitstop (fighting-game hit vibration)
    if ((a.hitstop || 0) > 0 && react) this.hipDelta.x += (this.frame % 2 ? 1 : -1) * 0.022 * Math.min(1, a.hitstop / 6);
    if (this.n.hips && (this.hipDelta.x || this.hipDelta.y || this.hipDelta.z)) {
      const hp = this.rig.localPos('hips', this.hipDelta.x, this.hipDelta.y, this.hipDelta.z, _v);
      const r0 = this.rig.bones.get('hips').restLocalP;
      this.n.hips.position.add(_v.sub(r0));
    }
    this.hipDelta.set(0, 0, 0);
    if (Math.abs(Q.s) > 0.001 && !REACT.has(st) || st === 'hitstun') {
      const s = Q.s;
      this.model.scale.set(this.baseScale.x * (1 - s * 0.5), this.baseScale.y * (1 + s), this.baseScale.z * (1 - s * 0.5));
    }
    void S;
  }

  // ------------------------------------------------------------------ foot planting
  _plant(side, w, S) {
    const [th, sh, ft] = this.solver.limbs['leg' + side];
    const F = wp(ft, _v);
    const gy = wp(this.model, _v2).y;
    const rb = this.rig.bones.get('foot_' + side);
    const sc = this.solver.scale();
    const hA = rb.restP.y * sc;
    const T = _v3.copy(F);
    if (T.y < gy + hA) T.y = gy + hA;
    else if (T.y < gy + hA + 0.035 * S) T.y = damp(T.y, gy + hA, 30, 1 / 60);
    let lock = this.locks[side];
    if (!lock) lock = this.locks[side] = F.clone();
    const dx = F.x - lock.x, dz = F.z - lock.z, dist = Math.hypot(dx, dz);
    if (dist > 0.2 * S * sc) { lock.x += dx * 0.35; lock.z += dz * 0.35; }
    T.x = lock.x; T.z = lock.z;
    if (T.distanceTo(F) < 0.002) return;
    const Qf = wq(ft, _q2).clone();
    const fk = snap([th, sh, ft]);
    // knee pole: character forward (model +Z)
    const pole = _v4.set(0, 0, 1).applyQuaternion(wq(this.model, _q));
    twoBone(th, sh, ft, T, pole);
    setWQ(ft, Qf);
    if (w < 0.999) { [th, sh, ft].forEach((n, i) => n.quaternion.slerpQuaternions(fk[i], n.quaternion, w)); th.updateMatrixWorld(true); }
  }

  // ------------------------------------------------------------------ blade guard
  _guard(side, S) {
    const wpn = this.weapons[side];
    const hand = this.n['hand_' + side];
    if (!wpn || !hand || !this.n.head) return;
    const len = (this.profile.blade[side] ?? this.profile.blade.R) * S, pom = (this.profile.blade.pommel || 0.1) * S;
    const up = _v5.set(0, 1, 0).applyQuaternion(wq(this.model, _q));
    const headC = wp(this.n.head, new THREE.Vector3()).addScaledVector(up, 0.085 * S);
    const rHead = 0.155 * S;
    const t0 = wp(this.n.hips, new THREE.Vector3()).addScaledVector(up, 0.12 * S);
    const t1 = wp(this.n.neck || this.n.chest, new THREE.Vector3());
    const rTorso = 0.15 * S;
    const P0 = new THREE.Vector3(), Y = new THREE.Vector3(), A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), c2 = new THREE.Vector3();
    for (let it = 0; it < 3; it++) {
      wp(wpn, P0);
      Y.copy(_Y).applyQuaternion(wq(wpn, _q2));
      let fixed = false;
      // head: whole weapon (pommel → tip)
      A.copy(P0).addScaledVector(Y, -pom); B.copy(P0).addScaledVector(Y, len);
      segSegClosest(A, B, headC, headC, C, c2);
      const dH = C.distanceTo(headC);
      if (dH < rHead && P0.distanceTo(headC) > rHead * 0.9) { this._swing(hand, P0, C, headC, rHead - dH); fixed = true; }
      else {
        // torso: the blade only (the grip lives next to the body)
        A.copy(P0).addScaledVector(Y, 0.18 * S);
        segSegClosest(A, B, t0, t1, C, c2);
        const dT = C.distanceTo(c2);
        if (dT < rTorso && P0.distanceTo(c2) > rTorso * 0.8) { this._swing(hand, P0, C, c2, rTorso - dT); fixed = true; }
      }
      if (!fixed) break;
      this.stats.guard++;
    }
  }
  _swing(hand, P0, C, center, pen) {
    const arm = _v.subVectors(C, P0);
    const l = arm.length();
    if (l < 1e-4) return;
    let push = _v2.subVectors(C, center);
    if (push.lengthSq() < 1e-8) push = _v2.set(0, 1, 0);
    push.normalize();
    const axis = _v3.crossVectors(arm, push);
    if (axis.lengthSq() < 1e-10) return;
    axis.normalize();
    const ang = Math.min(0.6, Math.asin(Math.min(0.95, (pen + 0.015) / l)));
    rotateWorld(hand, _q.setFromAxisAngle(axis, ang));
  }
}
