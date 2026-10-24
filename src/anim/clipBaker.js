// Clip baker: code-authored ClipDef → THREE.AnimationClip for one rig (via RigInfo), sampled densely so the
// authored interpolation (Catmull-Rom by default, or per-key easing) survives three's linear slerp playback.
//
// ClipDef:
//   { duration: seconds | frames: n (60 Hz ticks),  loop: bool,
//     keys: [ { t: s | f: frame, pose: { bone: [x,y,z] deg }, hips: [x,y,z] m, ease?: 'linear'|'in'|'out'|'inOut'|'outBack'|'outExpo'|'inExpo'|'outCubic'|'inCubic'|'step',
//               ── IK goals (solved at BAKE time on the real rig, so they hold on every body type) ──
//               wpn:  { at:[x,y,z], blade:[x,y,z], edge:[x,y,z] }   right-hand weapon: grip point + blade/edge dirs
//               wpnL: { at, blade, edge }                           left-hand weapon (dual wielders)
//               handR / handL: [x,y,z]                              free fist (wrist) position
//                   (at / hand positions: character axes, origin = the POSED chest bone, unit = that arm's length)
//               footL / footR: [dx,dy,dz, pitch°, out°]             ankle offset from its rest spot (character axes,
//                   hip-height units; dy 0 = planted), toe pitch (+ = toe up) and toe-out yaw. Knees solve forward.
//               grip: 0..1   two-hand grip weight (profile.grip.twoHand): the off hand locks onto the weapon handle
//               plant: 0..1  runtime foot-plant weight · look: 0..1 runtime look-at weight } ],
//     tracks?: { bone: [ [t, x, y, z, ease?], ... ] },   // optional per-bone channels (t in seconds)
//     hipsTrack?: [ [t, x, y, z, ease?], ... ],
//     events?: [ { t | f | n (normalized), name, ...data } ],
//     mirror?: 'otherClipName' (pose L↔R mirrored from another clip in the same set),
//     alias?:  'otherClipName' (same clip under another name), grip?/plant?/look?: clip-level defaults,
//     goalSpace?: 'chest' (hand/weapon goals expressed in the posed chest frame: rolls, flips, lying poses),
//     bakeFps?: 30 (60 for short clips with IK goals) }
// A bone (or goal) appears only in the keys that mention it; its channel interpolates between those keys. A goal's
// weight is 1 at keys that give it and 0 at keys that pose that limb by FK, so FK↔IK blends automatically.
import * as THREE from 'three';
import { EASE } from '../core/math.js';
import { mirrorPose, charEulerToModelQuat, SOCKET_CONVENTION } from './retarget.js';
import { wp, wq, setWQ, twoBone, armToSocket, socketQuatForWeapon, weaponQuatFromChar, charDirToWorld, snap, restore } from './ik.js';
import { DEFAULT_PROFILE } from './profiles.js';

const TICK = 1 / 60;
export const clipDuration = (def) => (def.frames !== undefined ? def.frames * TICK : def.duration ?? 1);
const keyTime = (k) => (k.f !== undefined ? k.f * TICK : k.t ?? 0);
const mz = (v) => (v ? [v[0], v[1], -v[2], ...v.slice(3)] : v);
const mGoal = (g) => (g ? { ...g, at: mz(g.at), blade: mz(g.blade), edge: mz(g.edge) } : g);

/** Resolve a `mirror` def against its source. */
export function resolveMirror(def, getDef) {
  if (def.alias) { const src = getDef(def.alias); return src ? { ...src, ...def, alias: undefined } : def; }
  if (!def.mirror) return def;
  const src = getDef(def.mirror);
  if (!src) return def;
  const out = { ...src, ...def, mirror: undefined };
  out.keys = (src.keys || []).map((k) => ({
    ...k, pose: k.pose ? mirrorPose(k.pose) : undefined, hips: k.hips ? [k.hips[0], k.hips[1], -k.hips[2]] : undefined,
    wpn: mGoal(k.wpnL), wpnL: mGoal(k.wpn), handR: mz(k.handL), handL: mz(k.handR), footL: mz(k.footR), footR: mz(k.footL),
  }));
  if (src.tracks) {
    out.tracks = {};
    for (const b in src.tracks) {
      const m = b.endsWith('_L') ? b.slice(0, -2) + '_R' : b.endsWith('_R') ? b.slice(0, -2) + '_L' : b;
      out.tracks[m] = src.tracks[b].map(([t, x, y, z, e]) => [t, -x, -y, z, e]);
    }
  }
  if (src.hipsTrack) out.hipsTrack = src.hipsTrack.map(([t, x, y, z, e]) => [t, x, y, -z, e]);
  if (def.events) out.events = def.events;
  return out;
}

const GOALS = ['wpn', 'wpnL', 'handR', 'handL', 'footL', 'footR'];
/** Build channels: Map name → sorted [{ t, v:[x,y,z], ease }] ('@hips' = translation, '@…' = goals/meta). */
export function channelsOf(def, dflt = {}) {
  const ch = new Map();
  const push = (name, t, v, ease) => { if (!ch.has(name)) ch.set(name, []); ch.get(name).push({ t, v: [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0], ease }); };
  for (const k of def.keys || []) {
    const t = keyTime(k), e = k.ease, P = k.pose || {};
    if (k.pose) for (const b in k.pose) push(b, t, k.pose[b], e);
    if (k.hips) push('@hips', t, k.hips, e);
    // right arm: weapon goal, fist goal, or FK
    if (k.wpn) { push('@wpn.at', t, k.wpn.at, e); push('@wpn.bl', t, k.wpn.blade, e); push('@wpn.ed', t, k.wpn.edge || [0, 1, 0], e); push('@wpn.w', t, [1], e); push('@handR.w', t, [0], e); }
    else if (k.handR) { push('@handR.at', t, k.handR, e); push('@handR.w', t, [1], e); push('@wpn.w', t, [0], e); }
    else if (P.upperarm_R) { push('@wpn.w', t, [0], e); push('@handR.w', t, [0], e); }
    if (k.wpnL) { push('@wpnL.at', t, k.wpnL.at, e); push('@wpnL.bl', t, k.wpnL.blade, e); push('@wpnL.ed', t, k.wpnL.edge || [0, 1, 0], e); push('@wpnL.w', t, [1], e); push('@handL.w', t, [0], e); }
    else if (k.handL) { push('@handL.at', t, k.handL, e); push('@handL.w', t, [1], e); push('@wpnL.w', t, [0], e); }
    else if (P.upperarm_L) { push('@wpnL.w', t, [0], e); push('@handL.w', t, [0], e); }
    for (const s of ['L', 'R']) {
      const f = k['foot' + s];
      if (f) { push(`@foot${s}.at`, t, f, e); push(`@foot${s}.rot`, t, [f[3] || 0, f[4] || 0, 0], e); push(`@foot${s}.w`, t, [1], e); }
      else if (P['thigh_' + s]) push(`@foot${s}.w`, t, [0], e);
    }
  }
  // Meta channels (grip / plant / look): a key without a value holds the previous one (clip default before the
  // first), so `plant: 1` on the last key means "plant into the end", not "planted the whole clip".
  const metas = [['@grip', 'grip', dflt.grip ?? 0], ['@plant', 'plant', def.plant ?? 0], ['@look', 'look', def.look ?? 1]];
  for (const [ch_, f, d0] of metas) {
    const ks = def.keys || [];
    if (!ks.some((k) => k[f] !== undefined || (f === 'grip' && (k.handL || k.wpnL)))) continue;
    let last = d0;
    for (const k of ks) {
      let val = k[f];
      if (val === undefined && f === 'grip' && (k.handL || k.wpnL)) val = 0;
      if (val !== undefined) last = val;
      push(ch_, keyTime(k), [last], k.ease === 'step' ? 'step' : 'inOut');
    }
  }
  if (def.tracks) for (const b in def.tracks) for (const [t, x, y, z, e] of def.tracks[b]) push(b, t, [x, y, z], e);
  if (def.hipsTrack) for (const [t, x, y, z, e] of def.hipsTrack) push('@hips', t, [x, y, z], e);
  for (const list of ch.values()) list.sort((a, b) => a.t - b.t);
  return ch;
}

/** Evaluate a channel at time t (seconds). Catmull-Rom (non-uniform Hermite) unless the arriving key names an ease. */
export function evalChannel(list, t, duration, loop, out = [0, 0, 0]) {
  const n = list.length;
  const set = (v) => { out[0] = v[0]; out[1] = v[1]; out[2] = v[2]; return out; };
  if (n === 1) return set(list[0].v);
  let L = list;
  if (loop) {
    t = ((t % duration) + duration) % duration;
    const a = list[n - 1], b = list[n - 2 >= 0 ? n - 2 : 0], c = list[0], d = list[1 % n];
    L = [{ t: b.t - duration, v: b.v, ease: b.ease }, { t: a.t - duration, v: a.v, ease: a.ease }, ...list,
      { t: c.t + duration, v: c.v, ease: c.ease }, { t: d.t + duration, v: d.v, ease: d.ease }];
  } else {
    if (t <= list[0].t) return set(list[0].v);
    if (t >= list[n - 1].t) return set(list[n - 1].v);
  }
  let i = 0;
  while (i < L.length - 2 && L[i + 1].t <= t) i++;
  const k0 = L[i], k1 = L[i + 1];
  const span = Math.max(1e-6, k1.t - k0.t);
  const u = Math.min(1, Math.max(0, (t - k0.t) / span));
  if (k1.ease && EASE[k1.ease]) {
    const e = EASE[k1.ease](u);
    for (let c = 0; c < 3; c++) out[c] = k0.v[c] + (k1.v[c] - k0.v[c]) * e;
    return out;
  }
  const tan = (j, c) => (j > 0 && j < L.length - 1 ? (L[j + 1].v[c] - L[j - 1].v[c]) / Math.max(1e-6, L[j + 1].t - L[j - 1].t) : 0);
  const u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  for (let c = 0; c < 3; c++) out[c] = h00 * k0.v[c] + h10 * span * tan(i, c) + h01 * k1.v[c] + h11 * span * tan(i + 1, c);
  return out;
}

/** Scalar meta channel (grip/plant/look) sampler for runtime use: (t) → value or the default. */
export function metaSampler(ch, name, duration, loop, dflt) {
  const list = ch.get(name);
  if (!list) return () => dflt;
  const v = [0, 0, 0];
  return (t) => Math.min(1, Math.max(0, evalChannel(list, t, duration, loop, v)[0]));
}

const hasGoals = (ch) => GOALS.some((g) => { const l = ch.get(`@${g}.w`); return !!l && l.some((k) => k.v[0] > 0); });
const _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _sP = new THREE.Vector3(), _sS = new THREE.Vector3(), _sQ = new THREE.Quaternion();
const _flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const _Y = new THREE.Vector3(0, 1, 0);

/** Limb IK solver bound to one rig instance (bake time and runtime share it). */
export class LimbSolver {
  constructor(rig, profile = DEFAULT_PROFILE) {
    this.rig = rig; this.model = rig.model; this.profile = profile;
    const B = (n) => rig.bones.get(n);
    this.node = (n) => (B(n) ? B(n).node : null);
    const len = (a, b) => (B(a) && B(b) ? B(a).restP.distanceTo(B(b).restP) : 0);
    this.armLenM = { L: len('upperarm_L', 'forearm_L') + len('forearm_L', 'hand_L'), R: len('upperarm_R', 'forearm_R') + len('forearm_R', 'hand_R') };
    this.limbs = {
      armL: ['upperarm_L', 'forearm_L', 'hand_L'].map(this.node), armR: ['upperarm_R', 'forearm_R', 'hand_R'].map(this.node),
      legL: ['thigh_L', 'shin_L', 'foot_L'].map(this.node), legR: ['thigh_R', 'shin_R', 'foot_R'].map(this.node),
    };
    this.ok = { armL: this.limbs.armL.every(Boolean) && !!B('socket_hand_L'), armR: this.limbs.armR.every(Boolean) && !!B('socket_hand_R'), legL: this.limbs.legL.every(Boolean), legR: this.limbs.legR.every(Boolean) };
    this.flipL = true;
    this._fk = [];
    // off-hand grip point: the weapon's own 'grip_offhand' node if it has one (GLB), else the profile value
    const sR = this.node('socket_hand_R');
    const wpn = sR && sR.children.find((c) => !c.isBone && c.type !== 'Bone');
    const go = wpn && wpn.getObjectByName('grip_offhand');
    this.gripOff = go ? go.position.y : (profile.grip && profile.grip.off) ?? -0.14;
  }
  scale() { this.model.matrixWorld.decompose(_sP, _sQ, _sS); return _sS.x || 1; }
  /** Char-space point relative to the posed chest (arm-length units) → world. */
  armPoint(side, at, out = new THREE.Vector3(), rel = null) {
    const chest = this.node('chest') || this.node('spine') || this.node('hips');
    const k = this.armLenM[side] * this.scale();
    wp(chest, out);
    const d = charDirToWorld(this.model, at, _v3);
    if (rel) d.applyQuaternion(rel);
    return out.add(d.multiplyScalar(k));
  }
  /** World rotation of the posed chest relative to its rest orientation (for chest-relative goals). */
  chestRel(out = new THREE.Quaternion()) {
    const cb = this.rig.bones.get('chest') || this.rig.bones.get('spine');
    if (!cb) return out.identity();
    const m = wq(this.model, new THREE.Quaternion()).multiply(cb.restQ);
    return wq(cb.node, out).multiply(m.invert());
  }
  armPole(side, out = new THREE.Vector3()) {
    const [up, fo] = this.limbs['arm' + side];
    const S = wp(up, new THREE.Vector3()), E = wp(fo, new THREE.Vector3());
    const dflt = charDirToWorld(this.model, [-0.35, -1, side === 'R' ? 0.75 : -0.75], out).normalize();
    const fk = E.sub(S).normalize();
    return out.multiplyScalar(0.4).addScaledVector(fk, 0.6);
  }
  _blend(limb, w) {
    if (w >= 0.999) return;
    limb.forEach((n, i) => n.quaternion.slerpQuaternions(this._fk[i], n.quaternion, w));
    limb[0].updateMatrixWorld(true);
  }
  /** Right/left weapon goal: socket at char point `at`, weapon frame from blade/edge. */
  weapon(side, at, blade, edge, w = 1, relChest = false) {
    if (!this.ok['arm' + side]) return null;
    const limb = this.limbs['arm' + side];
    snap(limb, this._fk);
    const rel = relChest ? this.chestRel() : null;
    const T = this.armPoint(side, at, new THREE.Vector3(), rel);
    const Qw = weaponQuatFromChar(this.model, blade, edge, new THREE.Quaternion());
    if (rel) Qw.premultiply(rel);
    const r = armToSocket(this.rig, side, T, socketQuatForWeapon(this.rig, side, Qw, _q2), this.armPole(side, new THREE.Vector3()));
    this._blend(limb, w);
    return r;
  }
  fist(side, at, w = 1, relChest = false) {
    if (!this.ok['arm' + side]) return null;
    const limb = this.limbs['arm' + side];
    snap(limb, this._fk);
    const T = this.armPoint(side, at, new THREE.Vector3(), relChest ? this.chestRel() : null);
    const r = twoBone(limb[0], limb[1], limb[2], T, this.armPole(side, new THREE.Vector3()));
    // keep the hand's authored local rotation (twoBone only turned its parents)
    this._blend(limb, w);
    return r;
  }
  /** Main weapon world orientation, from socket_hand_R's current pose. */
  weaponQuat(side = 'R', out = new THREE.Quaternion()) {
    const s = this.rig.bones.get('socket_hand_' + side);
    return wq(s.node, out).multiply(_q.copy(s.restQ).invert()).multiply(SOCKET_Q);
  }
  /** Off hand onto the main weapon's handle (weapon-local y = profile.grip.off). Hysteresis on the fist flip. */
  grip(w = 1, off = this.gripOff) {
    if (!this.ok.armL || !this.ok.armR) return null;
    const limb = this.limbs.armL;
    snap(limb, this._fk);
    const sR = this.node('socket_hand_R');
    const Qw = this.weaponQuat('R', new THREE.Quaternion());
    const T = wp(sR, new THREE.Vector3()).add(_v3.copy(_Y).applyQuaternion(Qw).multiplyScalar(off * this.scale()));
    const pole = this.armPole('L', new THREE.Vector3());
    const pref = this.profile.grip.flip;
    const tryFlip = (flip) => {
      restore(limb, this._fk); limb[0].updateMatrixWorld(true);
      const Qwl = flip ? _q2.copy(Qw).multiply(_flip) : _q2.copy(Qw);
      return armToSocket(this.rig, 'L', T, socketQuatForWeapon(this.rig, 'L', Qwl, new THREE.Quaternion()), pole);
    };
    let r;
    if (pref === true || pref === false) r = tryFlip(pref);
    else {
      const other = !this.flipL;
      const ro = tryFlip(other);
      const ko = snap(limb, []);
      const rc = tryFlip(this.flipL);
      if (ro && rc && ro.strain + 0.35 < rc.strain) { restore(limb, ko); limb[0].updateMatrixWorld(true); this.flipL = other; r = ro; } else r = rc;
    }
    this._blend(limb, w);
    return r;
  }
  /** Foot goal: ankle offset from rest (hip units), toe pitch / toe-out (deg). */
  foot(side, at, rot = [0, 0, 0], w = 1) {
    if (!this.ok['leg' + side]) return null;
    const limb = this.limbs['leg' + side];
    snap(limb, this._fk);
    const rb = this.rig.bones.get('foot_' + side);
    const hipH = this.rig.hipHeight * this.scale();
    const T = this.model.localToWorld(new THREE.Vector3().copy(rb.restP));
    T.add(charDirToWorld(this.model, at, _v3).multiplyScalar(hipH));
    const pole = charDirToWorld(this.model, [1, 0.05, side === 'L' ? -0.14 : 0.14], new THREE.Vector3());
    const r = twoBone(limb[0], limb[1], limb[2], T, pole);
    const yaw = (side === 'L' ? 1 : -1) * (rot[1] || 0);
    const Qf = wq(this.model, new THREE.Quaternion()).multiply(charEulerToModelQuat(0, yaw, rot[0] || 0, _q)).multiply(rb.restQ);
    setWQ(limb[2], Qf);
    this._blend(limb, w);
    return r;
  }
}
const SOCKET_Q = SOCKET_CONVENTION;

/**
 * Bake a ClipDef for a rig.
 * @param {string} name
 * @param {object} def   ClipDef (mirror already resolved)
 * @param {import('./retarget.js').RigInfo} rig
 * @param {object} [profile]  anim profile (profiles.js) for IK goals (grip offset, two-hand)
 */
export function bakeClip(name, def, rig, profile = DEFAULT_PROFILE) {
  const duration = clipDuration(def);
  const loop = !!def.loop;
  const twoHand = !!(profile.grip && profile.grip.twoHand);
  const gripDefault = def.grip !== undefined ? def.grip : (twoHand ? 1 : 0);
  const ch = channelsOf(def, { grip: gripDefault });
  const gripAt = metaSampler(ch, '@grip', duration, loop, gripDefault);
  const goals = hasGoals(ch) || (twoHand && (ch.has('@grip') || gripDefault > 0));
  const fps = def.bakeFps || (goals && duration <= 1.5 ? 60 : 30);
  const times = new Set();
  const steps = Math.max(1, Math.round(duration * fps));
  for (let i = 0; i <= steps; i++) times.add(+((i / steps) * duration).toFixed(5));
  for (const list of ch.values()) for (const k of list) if (k.t >= 0 && k.t <= duration) times.add(+k.t.toFixed(5));
  const T = [...times].sort((a, b) => a - b);
  const tracks = [];
  const v = [0, 0, 0];
  const q = new THREE.Quaternion(), p = new THREE.Vector3();
  const boneNames = [...ch.keys()].filter((b) => b[0] !== '@' && rig.has(b));
  const hipsList = ch.get('@hips');

  if (!goals) {
    for (const bone of boneNames) {
      const list = ch.get(bone);
      const vals = new Float32Array(T.length * 4);
      let prevQ = null;
      T.forEach((t, i) => {
        evalChannel(list, t, duration, loop, v);
        rig.localQuat(bone, v[0], v[1], v[2], q);
        if (prevQ && prevQ.dot(q) < 0) { q.x = -q.x; q.y = -q.y; q.z = -q.z; q.w = -q.w; }
        vals[i * 4] = q.x; vals[i * 4 + 1] = q.y; vals[i * 4 + 2] = q.z; vals[i * 4 + 3] = q.w;
        prevQ = (prevQ || new THREE.Quaternion()).copy(q);
      });
      tracks.push(new THREE.QuaternionKeyframeTrack(`${rig.bones.get(bone).node.name}.quaternion`, T, vals));
    }
  } else {
    // Full-pose sampling on the live rig nodes: FK → IK goals → read back local rotations.
    const solver = new LimbSolver(rig, profile);
    const allBones = [...rig.bones.values()];
    const saved = allBones.map((b) => [b.node.quaternion.clone(), b.node.position.clone()]);
    const affected = new Set(boneNames);
    const addLimb = (k) => solver.limbs[k].forEach((n) => n && affected.add(n.name));
    const wOf = (nm, t) => (ch.has(nm) ? Math.min(1, Math.max(0, evalChannel(ch.get(nm), t, duration, loop, v)[0])) : 0);
    const vec = (nm, t, out) => evalChannel(ch.get(nm), t, duration, loop, out);
    if (ch.has('@wpn.w') || ch.has('@handR.w')) addLimb('armR');
    if (ch.has('@wpnL.w') || ch.has('@handL.w') || twoHand) addLimb('armL');
    if (ch.has('@footL.w')) addLimb('legL');
    if (ch.has('@footR.w')) addLimb('legR');
    const nodeName = new Map(allBones.map((b) => [b.node.name, b]));
    const list = [...affected].map((n) => rig.bones.get(n) || nodeName.get(n)).filter(Boolean);
    const vals = list.map(() => new Float32Array(T.length * 4));
    const prev = list.map(() => null);
    const a1 = [0, 0, 0], a2 = [0, 0, 0], a3 = [0, 0, 0];
    const rel = def.goalSpace === 'chest';   // goals ride with the chest (rolls, flips, lying down)
    try {
      T.forEach((t, i) => {
        for (const b of allBones) { b.node.quaternion.copy(b.restLocalQ); b.node.position.copy(b.restLocalP); }
        for (const bone of boneNames) { evalChannel(ch.get(bone), t, duration, loop, v); rig.localQuat(bone, v[0], v[1], v[2], rig.bones.get(bone).node.quaternion); }
        if (hipsList && rig.has('hips')) { evalChannel(hipsList, t, duration, loop, v); rig.localPos('hips', v[0], v[1], v[2], rig.bones.get('hips').node.position); }
        rig.model.updateWorldMatrix(true, true);
        for (const s of ['L', 'R']) {
          const w = wOf(`@foot${s}.w`, t);
          if (w > 0.001 && ch.has(`@foot${s}.at`)) solver.foot(s, vec(`@foot${s}.at`, t, a1), vec(`@foot${s}.rot`, t, a2), w);
        }
        const ww = wOf('@wpn.w', t), hw = wOf('@handR.w', t);
        if (ww > 0.001 && ch.has('@wpn.at')) solver.weapon('R', vec('@wpn.at', t, a1), vec('@wpn.bl', t, a2), vec('@wpn.ed', t, a3), ww, rel);
        if (hw > 0.001 && ch.has('@handR.at')) solver.fist('R', vec('@handR.at', t, a1), hw, rel);
        const wl = wOf('@wpnL.w', t), hl = wOf('@handL.w', t);
        if (wl > 0.001 && ch.has('@wpnL.at')) solver.weapon('L', vec('@wpnL.at', t, a1), vec('@wpnL.bl', t, a2), vec('@wpnL.ed', t, a3), wl, rel);
        else if (twoHand) { const g = gripAt(t); if (g > 0.001) solver.grip(g); }
        if (hl > 0.001 && ch.has('@handL.at')) solver.fist('L', vec('@handL.at', t, a1), hl, rel);
        list.forEach((b, j) => {
          q.copy(b.node.quaternion);
          if (prev[j] && prev[j].dot(q) < 0) { q.x = -q.x; q.y = -q.y; q.z = -q.z; q.w = -q.w; }
          const o = vals[j]; o[i * 4] = q.x; o[i * 4 + 1] = q.y; o[i * 4 + 2] = q.z; o[i * 4 + 3] = q.w;
          prev[j] = (prev[j] || new THREE.Quaternion()).copy(q);
        });
      });
    } finally {
      allBones.forEach((b, i) => { b.node.quaternion.copy(saved[i][0]); b.node.position.copy(saved[i][1]); });
      rig.model.updateWorldMatrix(true, true);
    }
    list.forEach((b, j) => tracks.push(new THREE.QuaternionKeyframeTrack(`${b.node.name}.quaternion`, T, vals[j])));
  }
  if (hipsList && rig.has('hips')) {
    const vals = new Float32Array(T.length * 3);
    T.forEach((t, i) => { evalChannel(hipsList, t, duration, loop, v); rig.localPos('hips', v[0], v[1], v[2], p); vals[i * 3] = p.x; vals[i * 3 + 1] = p.y; vals[i * 3 + 2] = p.z; });
    tracks.push(new THREE.VectorKeyframeTrack(`${rig.bones.get('hips').node.name}.position`, T, vals));
  }
  const clip = new THREE.AnimationClip(name, duration, tracks);
  clip.userData = {
    loop, events: normalizeEvents(def.events, duration),
    meta: {
      grip: twoHand ? gripAt : () => 0,
      plant: metaSampler(ch, '@plant', duration, loop, def.plant ?? 0),
      look: metaSampler(ch, '@look', duration, loop, def.look ?? 1),
      guard: def.guard ?? 1, springs: def.springs ?? 1, breathe: def.breathe ?? 0, flinch: def.flinch ?? 1,
      tags: def.tags || [],
    },
  };
  return clip;
}

export function normalizeEvents(events = [], duration) {
  return (events || []).map((e) => {
    const t = e.n !== undefined ? e.n * duration : e.f !== undefined ? e.f * TICK : e.t ?? 0;
    return { ...e, t };
  }).sort((a, b) => a.t - b.t);
}
