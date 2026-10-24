// Weapon ribbon trails / smears (vfx.trails). All trails share ONE dynamic mesh (one draw call).
//
//   trails.start(actor, { hand: 'R'|'L'|'both', seconds, style, color: [hot, tint], alpha, persist, base, tip })
//   trails.stop(actor)                    stop emitting (ribbon fades out over `persist`)
//   trails.swingDir(actor) → Vector3|null last weapon-tip velocity direction (world), for sparks along the swing
//   trails.auto = true                    auto-drive from move hit windows (EV.ATTACK_START arms the actor; the ribbon
//                                         emits from `pre` ticks before each hit window to `post` ticks after it)
// MoveDef/hit-window overrides (read-only, optional): `def.trail = false | { hand, style, color, pre, post }`.
// Samples age on the actor's clock: during hitstop the ribbon freezes with the pose. Opacity follows tip speed
// (slow windups don't smear), fades head→tail, soft edges across, hot white at the leading edge.
import * as THREE from 'three';
import { EV } from '../core/EventBus.js';
import { FOG_ADDITIVE } from './glsl.js';

const MAX_TRAILS = 12, MAX_RAW = 14, SUB = 5, MAX_PTS = (MAX_RAW - 1) * SUB + 1;

/** Per weapon kind: blade span along the weapon's long axis (0 = grip, 1 = tip), persistence, opacity.
 *  `span` = max ribbon width (m) at the head (next to the blade); the ribbon tapers to a point (`taper` exponent)
 *  toward the tail, so a swing reads as a crescent swoosh, never a filled fan. */
export const TRAIL_STYLES = {
  greatsword: { base: 0.42, tip: 1.03, span: 0.55, taper: 1.25, persist: 0.12, alpha: 1.0, width: 1, minSpeed: 3.5, fullSpeed: 10 },
  sabre: { base: 0.5, tip: 1.02, span: 0.36, taper: 1.4, persist: 0.11, alpha: 0.9, width: 1, minSpeed: 4, fullSpeed: 11, maskScale: 1.35 },
  // C2 r4 (hero-weapons, additive): copper head -> storm-blue tail (board r3: "copper/storm tint"); the ribbon spans the bit
  copperax: { base: 0.6, tip: 1.06, span: 0.45, taper: 1.3, persist: 0.12, alpha: 1.0, width: 1, minSpeed: 3.5, fullSpeed: 10, color: ['#ffd2a0', '#4aa8ff'] },
  club: { base: 0.45, tip: 1.0, span: 0.26, taper: 1.6, persist: 0.1, alpha: 0.4, minSpeed: 4, fullSpeed: 10 },
  default: { base: 0.4, tip: 1.0, span: 0.3, taper: 1.5, persist: 0.1, alpha: 0.5, minSpeed: 4, fullSpeed: 10 },
};

// Self-occlusion guard: each vertex carries its owner's head+torso capsule projected to view space
// (body.xy = hips-end, body.zw = head-end, tuv.z = radius, all divided by -z). The fragment fades the ribbon to 0
// inside that capsule, so a swing never paints over the wielder's own face/torso.
const VERT = /* glsl */`
attribute vec4 color;
attribute vec3 tuv;
attribute vec4 body;
varying vec4 vColor;
varying vec3 vT;
varying vec4 vBody;
varying vec3 vView;
#include <fog_pars_vertex>
void main() {
  vColor = color; vT = tuv; vBody = body;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vView = mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FRAG = /* glsl */`
varying vec4 vColor;
varying vec3 vT;   // x: 0 head → 1 tail, y: 0 inner → 1 tip edge, z: body capsule radius (projected)
varying vec4 vBody;
varying vec3 vView;
#include <fog_pars_fragment>
void main() {
  float v = vT.y, u = vT.x;
  // Crescent profile: feathered inner edge, luminous band toward the tip edge, a thin hot leading line; along
  // the ribbon a soft onset at the blade (no hard straight wall) and a fast falloff behind the head.
  float edge = smoothstep(0.0, 0.55, v) * (1.0 - smoothstep(0.93, 1.0, v));
  float body = pow(smoothstep(0.02, 0.95, v), 1.6);
  float onset = mix(0.35, 1.0, smoothstep(0.0, 0.07, u));
  float a = vColor.a * edge * body * onset * (1.0 - u * 0.45);
  // Owner head/torso capsule mask (projected space).
  if (vT.z > 0.0) {
    vec2 p = vView.xy / max(0.05, -vView.z);
    vec2 ab = vBody.zw - vBody.xy;
    float h = clamp(dot(p - vBody.xy, ab) / max(1e-6, dot(ab, ab)), 0.0, 1.0);
    float d = length(p - vBody.xy - ab * h);
    // r3: radius swells toward the head end (faces are the worst offenders) and the fade band is wider.
    // C1 r4: wider still (0.7..1.8 r) so the cut through the ribbon is a long feather, not a blunt-ended wedge.
    float rr = vT.z * mix(0.9, 1.6, h);
    a *= smoothstep(rr * 0.7, rr * 1.8, d);
  }
  if (a < 0.003) discard;
  // r2: element-coloured body (HDR, blooms) + a THIN white-hot leading line, so the smear never reads as blade steel.
  float hot = smoothstep(0.86, 0.985, v) * (1.0 - smoothstep(0.0, 0.5, u));
  float mx = max(vColor.r, max(vColor.g, vColor.b));
  vec3 col = mix(vColor.rgb * 1.45, vec3(mx * 1.9), hot * 0.9);
  gl_FragColor = vec4(col * a, 0.0);
  ${FOG_ADDITIVE}
}`;

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _inv = new THREE.Matrix4(), _box = new THREE.Box3(), _m = new THREE.Matrix4();
const persistOf = (t) => t.style.persist ?? 0.1;
const _c = new THREE.Color(), _d = new THREE.Vector3(), _vd = new THREE.Vector3(), _tg = new THREE.Vector3(), _sd = new THREE.Vector3();
const _h0 = new THREE.Vector3(), _h1 = new THREE.Vector3(), _q0 = new THREE.Quaternion(), _q1 = new THREE.Quaternion();

function catmull(p0, p1, p2, p3, t, out) {
  const t2 = t * t, t3 = t2 * t;
  out.set(0, 0, 0)
    .addScaledVector(p0, -0.5 * t3 + t2 - 0.5 * t)
    .addScaledVector(p1, 1.5 * t3 - 2.5 * t2 + 1)
    .addScaledVector(p2, -1.5 * t3 + 2 * t2 + 0.5 * t)
    .addScaledVector(p3, 0.5 * t3 - 0.5 * t2);
  return out;
}

export class TrailSystem {
  constructor(vfx) {
    this.vfx = vfx;
    this.game = vfx.game;
    this.auto = true;
    this.trails = [];          // { actor, hand, ref, tipL, baseL, samples[], style, col0, col1, until, auto, lastTip, vel }
    this.armed = new Map();    // actor → { hand, style, color, pre, post }
    const V = MAX_TRAILS * MAX_PTS * 2;
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(V * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(new Float32Array(V * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aUv = new THREE.BufferAttribute(new Float32Array(V * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aBody = new THREE.BufferAttribute(new Float32Array(V * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos); geo.setAttribute('color', this.aCol); geo.setAttribute('tuv', this.aUv); geo.setAttribute('body', this.aBody);
    const idx = new Uint16Array(MAX_TRAILS * (MAX_PTS - 1) * 6);
    geo.setIndex(new THREE.BufferAttribute(idx, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.geo = geo;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]), fog: true,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 18;
    this.mesh.name = 'vfx_trails';
    this._pts = Array.from({ length: MAX_PTS }, () => ({ b: new THREE.Vector3(), t: new THREE.Vector3(), age: 0, sp: 0 }));
    const sc = vfx.scope;
    sc.on(EV.ATTACK_START, (e) => { if (this.auto && e.actor) this.arm(e.actor, e.move); });
    sc.on(EV.DESPAWN, (e) => { if (e.actor) this.forget(e.actor); });
  }

  /** Style for an actor: weapon kind table + element tint (heroes) or a dim neutral (enemies). */
  styleFor(actor, over = {}) {
    const def = actor.def || {};
    const kind = over.style || def.trailStyle || def.weapon || 'default';
    const st = { ...(TRAIL_STYLES[kind] || TRAIL_STYLES.default), ...(def.trail || {}), ...over };
    const pal = this.vfx.palette(actor);
    st.col0 = st.color ? st.color[0] : pal.trail[0];
    st.col1 = st.color ? st.color[1] : pal.trail[1];
    if (actor.kind !== 'hero' && !over.alpha && !(def.trail && def.trail.alpha)) st.alpha = Math.min(st.alpha, 0.42);
    return st;
  }

  arm(actor, move) {
    const tr = move && move.trail;
    if (tr === false || !actor.model) return;
    this.armed.set(actor, { ...(typeof tr === 'object' ? tr : {}), move });
  }

  forget(actor) { this.armed.delete(actor); for (const t of this.trails) if (t.actor === actor) t.dead = true; }

  /** Manual API (animator/combat/magic): emit a ribbon for `seconds`. */
  start(actor, o = {}) {
    for (const t of this._trailsFor(actor, o.hand || this._defaultHand(actor), o)) t.until = Math.max(t.until, this._now() + (o.seconds ?? 0.2));
  }

  stop(actor) { for (const t of this.trails) if (t.actor === actor) { t.until = 0; t.autoOn = false; } }

  swingDir(actor) {
    let best = null, bs = 0;
    for (const t of this.trails) if (t.actor === actor && t.speed > bs && this._now() - t.velAt < 0.1) { bs = t.speed; best = t.vel; }
    return best && bs > 2 ? best : null;
  }

  /** World position of the weapon tip (hand 'R'|'L'), or null if the actor has no weapon. */
  tipOf(actor, hand = 'R') {
    const t = this._trailsFor(actor, hand)[0];
    if (!t) return null;
    t.ref.updateWorldMatrix(true, false);
    return t.tipL.clone().applyMatrix4(t.ref.matrixWorld);
  }

  _now() { return this.game.time; }

  _defaultHand(actor) { return actor.model && actor.model.weaponL ? 'both' : 'R'; }

  _trailsFor(actor, hand, o = {}) {
    const hands = hand === 'both' ? ['R', 'L'] : [hand];
    const out = [];
    for (const h of hands) {
      let t = this.trails.find((x) => x.actor === actor && x.hand === h && !x.dead);
      if (!t) t = this._create(actor, h, o);
      if (t) out.push(t);
    }
    return out;
  }

  _create(actor, hand, o) {
    const model = actor.model;
    if (!model) return null;
    let src = hand === 'L' ? model.weaponL : model.weapon;
    if (!src && hand === 'R' && model.root) src = model.root.getObjectByName('weapon');
    if (!src) return null;
    // C2 r2 (hero-weapons, additive; see CHANGELOG_SHARED): measure in the WEAPON node's own space, not the socket's.
    // attachToSocket gives the weapon a constant local rotation (16-19 deg off the socket +Y), so the socket-space bbox
    // put the ribbon 0.16-0.30 m off the real blade tip (board C2 r1: "trail ~17 deg off the blade").
    const ref = src;
    // Measure the blade in ref-local space: longest extent from the grip = blade axis.
    ref.updateWorldMatrix(true, true);
    _inv.copy(ref.matrixWorld).invert();
    const bb = new THREE.Box3();
    src.traverse((m) => {
      if (!m.isMesh || !m.geometry) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      _box.copy(m.geometry.boundingBox).applyMatrix4(_m.multiplyMatrices(_inv, m.matrixWorld));
      bb.union(_box);
    });
    if (bb.isEmpty()) return null;
    const ext = [[bb.max.x, 0], [-bb.min.x, 0], [bb.max.y, 1], [-bb.min.y, 1], [bb.max.z, 2], [-bb.min.z, 2]];
    let bi = 0; for (let i = 1; i < 6; i++) if (ext[i][0] > ext[bi][0]) bi = i;
    const len = ext[bi][0], axis = new THREE.Vector3(); axis.setComponent(ext[bi][1], bi % 2 === 0 ? 1 : -1);
    if (len < 0.2) return null;
    const style = this.styleFor(actor, o);
    // C2 r2 (hero-weapons): when the GLB carries a blade_tip / head_tip node, the ribbon tip follows it (a curved sabre's
    // point sits ~10 cm off the straight grip axis); the base stays on the measured axis.
    const tipNode = src.getObjectByName('blade_tip') || src.getObjectByName('head_tip');
    let tipL = tipNode ? new THREE.Vector3().setFromMatrixPosition(_m.multiplyMatrices(_inv, tipNode.matrixWorld)).multiplyScalar(style.tip) : axis.clone().multiplyScalar(len * style.tip);
    let baseL = axis.clone().multiplyScalar(len * style.base);
    // C2 r3 (hero-weapons, additive): an axe strikes with its BIT, not its top spike. When the GLB carries a `bit_edge`
    // node (the Copper Ax: the engine's `edge` bit, weapon-local +Z) the ribbon runs from the haft at head height (base)
    // to the bit's cutting edge (tip), so the smear comes off the bit face instead of a wide fan off the spike (board
    // C2 r2: "Gorrim's trail arcs wide off the haft as a flat ribbon"). `tipOf` follows (charge_glint, probes).
    const bitNode = src.getObjectByName('bit_edge');
    if (bitNode) {
      tipL = new THREE.Vector3().setFromMatrixPosition(_m.multiplyMatrices(_inv, bitNode.matrixWorld)).multiplyScalar(style.tip);
      baseL = axis.clone().multiplyScalar(tipL.dot(axis));
    }
    const t = {
      actor, hand, ref, style, len, axis,
      tipL, baseL,
      samples: [], until: 0, autoOn: false, dead: false, last: null, vel: new THREE.Vector3(), speed: 0, velAt: -1,
    };
    this.trails.push(t);
    return t;
  }

  _autoEmitting(actor, arm) {
    const run = actor.attack;
    if (!run || run.done || !arm || (arm.move && run.def !== arm.move)) return false;
    const pre = arm.pre ?? 3, post = arm.post ?? 2;
    for (const w of run.wins) if (run.frame >= w.from - pre && run.frame < w.to + post) return true;
    return false;
  }

  update(dt) {
    const now = this._now();
    // Auto-drive from armed moves.
    for (const [actor, arm] of this.armed) {
      const on = !actor.removed && this._autoEmitting(actor, arm);
      if (on) for (const t of this._trailsFor(actor, arm.hand || this._defaultHand(actor), arm)) t.autoOn = true;
      else {
        for (const t of this.trails) if (t.actor === actor) t.autoOn = false;
        const run = actor.attack;
        if (actor.removed || !run || run.done || (arm.move && run.def !== arm.move)) this.armed.delete(actor);
      }
    }
    const pos = this.aPos.array, col = this.aCol.array, uv = this.aUv.array, bod = this.aBody.array, idx = this.geo.index.array;
    let v = 0, ii = 0;
    for (let k = 0; k < this.trails.length; k++) {
      const t = this.trails[k];
      const a = t.actor;
      if (a.removed) t.dead = true;
      const frozen = a.hitstop > 0;
      const adt = frozen ? 0 : dt;
      const emitting = !t.dead && (t.autoOn || t.until > now);
      for (const s of t.samples) s.age += dt; // light smears expire on render time, including hitstop
      // C2 r4 (hero-weapons, additive; board r3 Opus: "Gorrim's blue trail is a straight streak up-right off the haft while
      // the head swings down-left"): a strike key one tick after the windup key moves the head ~0.8 m in a single tick, and
      // the CONTACT tick starts hitstop before that pose is ever sampled -- the frozen ribbon was the stale windup arc,
      // detached from the bit. On the first frozen frame, add the strike pose as one final sample so the ribbon arrives at
      // the bit edge (probe: tools/scenarios/weapon_read_probe.mjs, trail tip vs bit_edge during hitstop 0.46 m -> 0).
      if (emitting && frozen && t.last && !t.frozenSampled) {
        t.frozenSampled = true;
        t.ref.updateWorldMatrix(true, false);
        const tip = t.tipL.clone().applyMatrix4(t.ref.matrixWorld);
        if (tip.distanceTo(t.last) > 0.05) {
          const base = t.baseL.clone().applyMatrix4(t.ref.matrixWorld);
          t.samples.unshift({ b: base, t: tip, age: 0, sp: Math.max(t.speed, t.style.fullSpeed) });
          if (t.samples.length > MAX_RAW) t.samples.length = MAX_RAW;
          t.last = tip;
        }
      } else if (!frozen) t.frozenSampled = false;
      if (emitting && !frozen && adt > 0) {
        t.ref.updateWorldMatrix(true, false);
        const tip = t.tipL.clone().applyMatrix4(t.ref.matrixWorld), base = t.baseL.clone().applyMatrix4(t.ref.matrixWorld);
        let sp = 0;
        if (t.last) {
          _a.subVectors(tip, t.last); sp = _a.length() / Math.max(1e-4, adt);
          if (sp > 0.01) {
            _a.multiplyScalar(1 / Math.max(1e-6, _a.length()));
            // C1 r4 (board r3: "trails kink into an acute V-shaped polygonal fold on every hero"): the fold is the
            // windup->strike reversal drawn as ONE ribbon. When the tip motion reverses (> ~110 deg) at swing speed,
            // retire the older samples quickly (not a pop: they fade over the next ~70 ms) so the strike starts a
            // fresh arc from the reversal point.
            // (compare against the ribbon's direction over the last few samples, not just the previous step: a curved
            // reversal turns through 180 deg gradually, so step-to-step dots never go negative)
            const nS = t.samples.length;
            if (nS >= 2 && sp > t.style.minSpeed * 0.6) {
              _b.subVectors(t.samples[0].t, t.samples[Math.min(4, nS - 1)].t);
              const lb = _b.length();
              if (lb > 0.02 && _b.multiplyScalar(1 / lb).dot(_a) < -0.2) for (const s of t.samples) s.age = Math.max(s.age, persistOf(t) * 0.6);
            }
            t.vel.copy(_a); t.speed = sp; t.velAt = now;
          }
        }
        t.last = tip.clone();
        t.samples.unshift({ b: base, t: tip, age: 0, sp });
        if (t.samples.length > MAX_RAW) t.samples.length = MAX_RAW;
      } else if (!emitting) t.last = null;
      const persist = t.style.persist;
      while (t.samples.length && t.samples[t.samples.length - 1].age > persist) t.samples.pop();
      if (t.dead && !t.samples.length) { this.trails.splice(k--, 1); continue; }
      if (t.samples.length < 2 || k >= MAX_TRAILS) continue;
      // Build: subdivide with Catmull-Rom, write verts.
      const S = t.samples, n = S.length, P = this._pts;
      let np = 0;
      for (let i = 0; i < n - 1; i++) {
        const s0 = S[Math.max(0, i - 1)], s1 = S[i], s2 = S[i + 1], s3 = S[Math.min(n - 1, i + 2)];
        for (let j = 0; j < SUB; j++) {
          const u = j / SUB, q = P[np++];
          catmull(s0.b, s1.b, s2.b, s3.b, u, q.b);
          // Blade vector rotates about the grip (slerp), so fast 60 Hz samples sweep a true arc instead of chords.
          _h0.subVectors(s1.t, s1.b); _h1.subVectors(s2.t, s2.b);
          const l0 = _h0.length(), l1 = _h1.length();
          if (l0 > 1e-5 && l1 > 1e-5) {
            _q0.setFromUnitVectors(_h0.multiplyScalar(1 / l0), _h1.multiplyScalar(1 / l1));
            _q1.identity().slerp(_q0, u);
            q.t.copy(_h0).applyQuaternion(_q1).multiplyScalar(l0 + (l1 - l0) * u).add(q.b);
          } else catmull(s0.t, s1.t, s2.t, s3.t, u, q.t);
          q.age = s1.age + (s2.age - s1.age) * u; q.sp = s1.sp + (s2.sp - s1.sp) * u;
        }
      }
      { const q = P[np++], s = S[n - 1]; q.b.copy(s.b); q.t.copy(s.t); q.age = s.age; q.sp = s.sp; }
      const st = t.style;
      const c0 = _c.set(st.col0), r0 = c0.r, g0 = c0.g, b0 = c0.b;
      const c1 = _c.set(st.col1), r1 = c1.r, g1 = c1.g, b1 = c1.b;
      const v0 = v;
      const cam = this.game.camera;
      const bc = this._bodyCapsule(t, cam); // [ax, ay, bx, by, r] projected, r = 0 → no mask
      const span = st.span ?? 0.35, taper = st.taper ?? 1.4;
      for (let i = 0; i < np; i++) {
        const q = P[i];
        const u = Math.min(1, q.age / persist);
        const velK = Math.min(1, Math.max(0, (q.sp - st.minSpeed) / (st.fullSpeed - st.minSpeed)));
        const al = Math.min(1, st.alpha * 1.05 * (1 - u) ** 1.7 * velK * (i === 0 ? 0.6 : 1));
        // Tapered ribbon: the outer edge follows the tip path; the inner edge sits `w` in from the tip toward the
        // blade (widest at the head, a point at the tail). When the swing plane turns edge-on to the camera the
        // inner direction bends toward the camera-facing side vector so the ribbon keeps a readable width.
        _d.subVectors(q.b, q.t); const bl = _d.length(); if (bl > 1e-5) _d.multiplyScalar(1 / bl); else _d.set(0, -1, 0);
        const w = Math.min(bl, span) * (1 - u) ** taper;
        if (cam) {
          _vd.subVectors(q.t, cam.position).normalize();
          const qa = P[Math.max(0, i - 1)].t, qb = P[Math.min(np - 1, i + 1)].t;
          _tg.subVectors(qa, qb);
          _sd.crossVectors(_tg, _vd);
          const sl = _sd.length();
          if (sl > 1e-6) {
            _sd.multiplyScalar(1 / sl); if (_sd.dot(_d) < 0) _sd.negate();
            const dv = _d.dot(_vd), f = Math.sqrt(Math.max(0, 1 - dv * dv)); // on-screen fraction of the inner dir
            const k = Math.min(1, Math.max(0, (0.6 - f) / 0.4));
            if (k > 0) _d.lerp(_sd, k * k * (3 - 2 * k)).normalize();
          }
        }
        _b.copy(q.t).addScaledVector(_d, w);
        const cu = Math.min(1, 0.5 + u * 1.5); // element tint from the head on (white only on the hot edge)
        const cr = r0 + (r1 - r0) * cu, cg = g0 + (g1 - g0) * cu, cb = b0 + (b1 - b0) * cu;
        for (let e = 0; e < 2; e++) {
          const p = e ? q.t : _b;
          pos[v * 3] = p.x; pos[v * 3 + 1] = p.y; pos[v * 3 + 2] = p.z;
          col[v * 4] = cr; col[v * 4 + 1] = cg; col[v * 4 + 2] = cb; col[v * 4 + 3] = al;
          uv[v * 3] = u; uv[v * 3 + 1] = e; uv[v * 3 + 2] = bc[4];
          bod[v * 4] = bc[0]; bod[v * 4 + 1] = bc[1]; bod[v * 4 + 2] = bc[2]; bod[v * 4 + 3] = bc[3];
          v++;
        }
      }
      for (let i = 0; i < np - 1; i++) {
        const a0 = v0 + i * 2;
        idx[ii++] = a0; idx[ii++] = a0 + 1; idx[ii++] = a0 + 2;
        idx[ii++] = a0 + 1; idx[ii++] = a0 + 3; idx[ii++] = a0 + 2;
      }
    }
    this.geo.setDrawRange(0, ii);
    for (const at of [this.aPos, this.aCol, this.aUv, this.aBody]) { at.clearUpdateRanges(); at.addUpdateRange(0, Math.max(1, v) * at.itemSize); at.needsUpdate = true; }
    this.geo.index.clearUpdateRanges(); this.geo.index.addUpdateRange(0, Math.max(1, ii)); this.geo.index.needsUpdate = true;
  }

  /** Owner's hips→head capsule in projected view space ([ax, ay, bx, by, r]; r = 0 disables the mask).
   *  Verify changes here with tools/scenarios/trail_face_vis.mjs (moveset showcase; replicates the fragment maths
   *  across every ribbon segment and flags visible samples inside the head disc) for ALL heroes — wave C1: 0 leak
   *  frames for seraphine / brann / gorrim over the full 600-frame move list. */
  _bodyCapsule(t, cam) {
    const out = t._bc || (t._bc = [0, 0, 0, 0, 0]);
    out[4] = 0;
    if (!cam || t.style.selfMask === false) return out;
    if (t._hipN === undefined) {
      const bones = t.actor.model && t.actor.model.rigInfo && t.actor.model.rigInfo.bones;
      t._hipN = (bones && bones.get('hips')?.node) || null;
      t._headN = (bones && bones.get('head')?.node) || null;
    }
    if (!t._hipN || !t._headN) return out;
    t._hipN.getWorldPosition(_h0); t._headN.getWorldPosition(_h1);
    const L = _h0.distanceTo(_h1);
    if (L < 0.05) return out;
    _h0.y += L * 0.1; _h1.y += L * 0.36; // torso starts above the belt; include the crown of the head
    // per-character: slim/fast wielders (twin sabres sweep past the face) get a wider guard via style.maskScale
    const r = Math.max(0.2, L * 0.36) * (t.style.maskScale ?? 1);
    cam.updateMatrixWorld();
    _h0.applyMatrix4(cam.matrixWorldInverse); _h1.applyMatrix4(cam.matrixWorldInverse);
    const z0 = Math.max(0.05, -_h0.z), z1 = Math.max(0.05, -_h1.z);
    out[0] = _h0.x / z0; out[1] = _h0.y / z0; out[2] = _h1.x / z1; out[3] = _h1.y / z1;
    out[4] = r / ((z0 + z1) * 0.5);
    return out;
  }

  clear() { this.trails.length = 0; this.armed.clear(); this.geo.setDrawRange(0, 0); }
  dispose() { this.geo.dispose(); this.material.dispose(); }
}
