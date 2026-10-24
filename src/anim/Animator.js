// Animator: plays baked clips on one model with crossfades, loop/one-shot, speed, time-warp to a duration,
// normalized-time events, and hitstop-aware time. After the mixer, RigPost (anim/RigPost.js) adds the procedural
// layers: charge overlay, breathing, hit flinch, momentum lean, look-at, landing dip, squash & stretch, foot plant,
// blade-vs-body guard, two-hand grip lock and spring chains (hair/beard/kilt/cape).
//
//   const an = new Animator(model, { library, rig: 'humanoid', character: 'brann' });
//   an.play('light_1', { fade: 0.06, duration: 26 / 60 })   // time-warp the clip to a move's length
//   an.play('idle')                                          // loops if the ClipDef says loop:true
//   an.on('footstep', (e) => ...)                           // ClipDef events { t|f|n, name, ... }
//   an.normalizedTime / an.done / an.name
//   an.impulse('land' | 'hit' | 'impact' | 'jump', strength)  // squash / dip / spring kick hooks for other systems
//   an.post (RigPost) · an.post.stats · an.meta() → blended clip meta { grip, plant, look, ... }
//
// Name resolution in play() (so moves upgrade without touching frame data):
//   • a move started by Combatant.startMove requests def.anim; if a clip named after the MOVE ID exists it wins
//     (pommel_1 / pommel_2 / air_slam_land / close_finisher get their own clips);
//   • 'knockdown' becomes 'thrown' in the thrown state, 'launched' for a vertical launch, 'spiked' for a ground bounce;
//   • 'throw' becomes 'throw_back' when throwing behind; 'land' after a big fall becomes 'land_heavy';
//   • a restart of the same one-shot alternates with '<name>_alt' when that clip exists (hit reacts, knees).
// Timing model: tick(dt) runs in the SIM (skipped while the actor is in hitstop) and advances the logical
// clock + fires events. render(visualTime) runs every frame and advances the THREE.AnimationMixer to the
// interpolated actor-local time, so slow-mo and hitstop look smooth at any frame rate.
import * as THREE from 'three';
import { RigInfo } from './retarget.js';
import { RigPost } from './RigPost.js';
import { reportError } from '../core/log.js';

const META0 = { grip: 0, plant: 0, look: 1, guard: 1, springs: 1, breathe: 0, flinch: 1 };

export class Animator {
  constructor(model, { library, rig = 'humanoid', character = null } = {}) {
    this.model = model;
    this.library = library;
    this.rig = rig;
    this.character = character;
    this.rigInfo = RigInfo.of(model);
    this.mixer = new THREE.AnimationMixer(model);
    this.actions = new Map();   // name → [actionA, actionB] (B used for self-crossfade restarts)
    this.cur = null;            // { name, clip, action, time, duration, loop, speed, done, events, evIdx }
    this.prev = null;           // { clip, time } of the clip we are fading from (meta blending)
    this.fade = { t: 1, dur: 0 };
    this.listeners = new Map();
    this.visualTime = 0;
    this._applied = 0;
    this.speed = 1;
    this._alt = { base: null, flip: false };
    this.post = null;
    this.postEnabled = true;
    this._overlays = new Map();
    /** Additive/override hooks for specialists: called after the mixer each frame (e.g. look-at, springs). */
    this.postProcessors = [];
  }

  /** The owning actor (Actor.view.userData.actor), found lazily once the model is parented. */
  get actor() {
    if (this._actor !== undefined) return this._actor;
    let o = this.model.parent, found = null;
    for (let i = 0; o && i < 4; i++, o = o.parent) if (o.userData && o.userData.actor) { found = o.userData.actor; break; }
    if (found || this.model.parent) this._actor = found;
    return found;
  }

  has(name) { return !!this.library && this.library.has(name, { rig: this.rig, character: this.character }); }

  on(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(fn);
    return () => this.listeners.get(name).delete(fn);
  }

  _emit(ev) {
    const run = (set) => { if (set) for (const fn of set) fn(ev, this); };
    run(this.listeners.get(ev.name));
    run(this.listeners.get('*'));
  }

  _action(name, alt = false) {
    let pair = this.actions.get(name);
    if (!pair) {
      const clip = this.library && this.library.clip(name, this.rigInfo, { rig: this.rig, character: this.character });
      if (!clip) return null;
      const a = this.mixer.clipAction(clip);
      const b = this.mixer.clipAction(clip.clone());
      b.getClip().userData = clip.userData;
      pair = [a, b];
      this.actions.set(name, pair);
    }
    return alt ? pair[1] : pair[0];
  }

  /** Context-aware clip substitutions (see header). */
  _resolve(name, o) {
    const a = this.actor;
    if (a) {
      const mid = a.moveId;
      if (mid && mid !== name && a.moves && a.moves[mid] && (a.moves[mid].anim || mid) === name && a.attack && a.attack.frame <= 0 && this.has(mid)) name = mid;
      const st = a.fsm && a.fsm.name;
      if (name === 'knockdown') {
        if (st === 'thrown' && this.has('thrown')) name = 'thrown';
        else if (a.groundBounce > 0 && this.has('spiked')) name = 'spiked';
        else if (a.vel && a.vel.y > 7.2 && Math.abs(a.vel.x) < 3.2 && this.has('launched')) name = 'launched';
      } else if (name === 'throw' && a.throwDir && a.throwDir !== a.facing && this.has('throw_back')) name = 'throw_back';
      else if (name === 'land' && st === 'land' && (a.lastLandSpeed || 0) > 11 && this.has('land_heavy')) name = 'land_heavy';
    }
    if (o.restart) {
      const A = this._alt;
      if (A.base === name && this.cur && (this.cur.name === name || this.cur.name === name + '_alt') && this.has(name + '_alt')) {
        A.flip = !A.flip;
        return A.flip ? name + '_alt' : name;
      }
      A.base = name; A.flip = false;
    }
    return name;
  }

  /**
   * @param {string} name   clip name (falls back through opts.fallback list if missing)
   * @param {object} o      { fade=0.12, speed=1, loop (default: clip def), restart=false, duration (s), startAt (normalized), fallback: [] }
   * @returns {boolean} true if a clip is now playing
   */
  play(name, o = {}) {
    try { name = this._resolve(name, o); } catch (e) { reportError('anim:resolve', e); }
    if (this.cur && this.cur.name === name && !o.restart && !this.cur.done) {
      if (o.speed !== undefined) this.setSpeed(o.speed);
      return true;
    }
    if (this.post) this.post.begin(); // new bindings must capture FK values, not post-processed ones
    const requested = name;
    let action = this._action(name);
    if (!action && o.fallback) {
      for (const f of o.fallback) { action = this._action(f); if (action) { name = f; break; } }
    }
    if (!action) return false;
    const clip = action.getClip();
    // QA trace (opt-in: globalThis.__KCA_animTrace = []): every play, the clip set that served it and whether the
    // fallback list was used — tools/scenarios/anim_audit.mjs asserts no move ends on a fallback / generic clip.
    const tr = globalThis.__KCA_animTrace;
    if (tr && tr.length < 20000) {
      let set = null;
      try { set = this.library.def(name, { rig: this.rig, character: this.character })?.set || null; } catch (e) { /* trace only */ }
      const ac = this.actor;
      tr.push({ actor: ac ? ac.id : null, character: this.character, move: ac ? ac.moveId || null : null, state: ac && ac.fsm ? ac.fsm.name : null, requested, played: name, set, fallback: requested !== name });
    }
    const prev = this.cur;
    let useAlt = false;
    if (prev && prev.name === name) useAlt = prev.action === action; // restart same clip → crossfade from its twin
    if (useAlt) action = this._action(name, true);
    const loop = o.loop !== undefined ? o.loop : !!clip.userData.loop;
    const duration = o.duration || clip.duration;
    const speed = (o.speed ?? 1) * (clip.duration / duration);
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = !loop;
    action.timeScale = speed;
    action.setEffectiveWeight(1);
    const startAt = (o.startAt || 0) * clip.duration;
    action.time = startAt;
    const fade = o.fade ?? 0.12;
    if (prev && prev.action && fade > 0) {
      action.play();
      prev.action.crossFadeTo(action, fade, false);
    } else {
      if (prev && prev.action) prev.action.stop();
      action.play();
    }
    this.prev = prev && fade > 0 ? { clip: prev.clip, time: prev.time } : null;
    this.fade.t = 0; this.fade.dur = fade;
    const events = clip.userData.events || [];
    this.cur = { name, clip, action, time: startAt, duration: clip.duration, loop, speed, baseSpeed: speed, mul: 1, done: false, events, evIdx: events.findIndex((e) => e.t >= startAt) };
    if (this.cur.evIdx < 0) this.cur.evIdx = events.length;
    return true;
  }

  stop() { this.mixer.stopAllAction(); this.cur = null; }

  /** Multiply the current clip's playback rate (e.g. walk cycle matched to ground speed). */
  setSpeed(m) { const c = this.cur; if (!c) return; c.mul = m; c.speed = c.baseSpeed * m; c.action.timeScale = c.speed; }

  get name() { return this.cur ? this.cur.name : null; }
  get time() { return this.cur ? this.cur.time : 0; }
  get normalizedTime() { return this.cur ? Math.min(1, this.cur.time / this.cur.duration) : 0; }
  get done() { return !this.cur || this.cur.done; }

  /** Sim tick: logical clock + events. */
  tick(dt) {
    this.visualTarget = undefined;
    const c = this.cur;
    if (!c || c.done) return;
    // Heavy charge: hold the windup frame exactly (the charge overlay supplies the coiled pose + tremble).
    const a = this.actor;
    if (a && a.fsm && a.fsm.name === 'charge') { c.action.timeScale = 0; return; }
    if (c.action.timeScale === 0 && c.speed !== 0) c.action.timeScale = c.speed;
    const prevT = c.time;
    c.time += dt * c.speed;
    if (c.loop) {
      if (c.time >= c.duration) {
        // fire remaining events, wrap
        this._fire(prevT, c.duration);
        c.time %= c.duration;
        c.evIdx = 0;
        this._fire(0, c.time);
        this._emit({ name: 'loop', clip: c.name });
      } else this._fire(prevT, c.time);
    } else {
      if (c.time >= c.duration) { c.time = c.duration; this._fire(prevT, c.time + 1e-6); c.done = true; this._emit({ name: 'end', clip: c.name }); }
      else this._fire(prevT, c.time);
    }
  }

  _fire(t0, t1) {
    const c = this.cur;
    while (c.evIdx < c.events.length && c.events[c.evIdx].t < t1) {
      const e = c.events[c.evIdx++];
      if (e.t >= t0 - 1e-6) this._emit({ ...e, clip: c.name });
    }
  }

  /** Blended clip meta (crossfade-aware). */
  meta(out = { ...META0 }) {
    const c = this.cur;
    const mc = c && c.clip.userData.meta;
    const tc = c ? Math.min(c.duration, c.action.time) : 0;
    const f = this.fade.dur > 0 ? Math.min(1, this.fade.t / this.fade.dur) : 1;
    const mp = f < 1 && this.prev && this.prev.clip.userData.meta;
    for (const k in META0) {
      const val = (m, t) => (!m ? META0[k] : typeof m[k] === 'function' ? m[k](t) : m[k] ?? META0[k]);
      const vc = val(mc, tc);
      out[k] = mp ? val(mp, this.prev.time) * (1 - f) + vc * f : vc;
    }
    return out;
  }

  /** Overlay sampler for a clip (post-mixer pose blend, e.g. heavy_charge). */
  overlay(name) {
    if (this._overlays.has(name)) return this._overlays.get(name);
    let ov = null;
    const clip = this.library && this.library.clip(name, this.rigInfo, { rig: this.rig, character: this.character });
    if (clip) {
      const root = this.model;
      const samplers = [];
      for (const tr of clip.tracks) {
        const dot = tr.name.lastIndexOf('.');
        const node = root.getObjectByName(tr.name.slice(0, dot));
        if (!node) continue;
        samplers.push({ node, prop: tr.name.slice(dot + 1), interp: tr.createInterpolant() });
      }
      ov = { clip, samplers, loop: !!clip.userData.loop };
    }
    this._overlays.set(name, ov);
    return ov;
  }
  sampleOverlay(ov, t, w) {
    const d = ov.clip.duration;
    const tt = ov.loop ? t % d : Math.min(t, d);
    const q = _oq, p = _op;
    for (const s of ov.samplers) {
      const r = s.interp.evaluate(tt);
      if (s.prop === 'quaternion') { q.set(r[0], r[1], r[2], r[3]); s.node.quaternion.slerp(q, w); }
      else if (s.prop === 'position') { p.set(r[0], r[1], r[2]); s.node.position.lerp(p, w); }
    }
    this.model.updateMatrixWorld(true);
  }

  /** Procedural hooks for other systems (VFX, combat, cutscenes). */
  impulse(kind, k = 1) {
    const P = this.post;
    if (!P) return;
    if (kind === 'land') { P.dip.v -= 0.9 * k; P.sq.v -= 1.1 * k; }
    else if (kind === 'jump') { P.sq.v += 1.6 * k; }
    else if (kind === 'impact') { P.sq.v -= 0.6 * k; P.dip.v -= 0.2 * k; }
    else if (kind === 'hit') { P.flinch.vx += 380 * k; P.sq.v -= 1.0 * k; }
  }

  /** Render: advance the mixer to `visualTime` (actor-local seconds, interpolated). */
  render(visualTime) {
    if (this._applied === 0 && this.visualTime === 0) this._applied = visualTime;
    let d = visualTime - this._applied;
    if (d < 0) d = 0;
    if (d > 0.25) d = 0.25;
    this._applied = visualTime;
    if (this.post) this.post.begin();
    this.mixer.update(d);
    this.fade.t += d;
    if (this.postEnabled) {
      try {
        if (!this.post && this.model.parent) this.post = new RigPost(this);
        if (this.post) this.post.apply(d, this.meta(this._meta || (this._meta = { ...META0 })));
      } catch (e) { reportError('anim:post', e); this.postEnabled = false; this.post = null; }
    }
    for (const p of this.postProcessors) p(d, this);
  }

  dispose() { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.model); }
}
const _oq = new THREE.Quaternion(), _op = new THREE.Vector3();
