// CameraRig: belt-scroll follow cam with screen locks, trauma shake, punch-zoom and drama overrides.
//
//   rig.follow(actors)                  targets (centroid of alive ones; falls back to last focus)
//   rig.setLock(xMin, xMax) / clearLock()   camera focus is clamped so the view stays inside the lock
//   rig.setLimits(xMin, xMax)           hard stage extents (camera never shows beyond)
//   rig.shake(trauma)                   trauma 0..1 (amplitude ∝ trauma²), decays ~1.5/s
//   rig.punch(amount = 0.06, ticks = 9) quick dolly-in (hit confirm)
//   rig.drama({ distance, height, fov, lookHeight, focus, yaw, roll, in, hold, out, priority }) → handle
//        blends toward the given params; handle.release() blends back (hold: seconds, or null = until release)
//   rig.snap()                          jump to the target immediately (stage start / cuts)
//   rig.visibleRange(z) → { xMin, xMax }  horizontal view extents at depth z (spawners, screen clamp)
//   rig.worldToScreen(v3) → { x, y, visible }  CSS pixels (UI anchors, damage numbers)
//   rig.manual = true                   disables follow (showcase orbit cams set camera directly)
//   rig.setFraming({ distance, height, lookHeight, fov, lead }) / resetFraming()   per-stage framing (stage build/dispose)
//   rig.setMode({ desired(d, rig) → {x, z} | null, framing: { distance, height, lookHeight, fov }, blend }) / clearMode(mode?)
//        additive framing MODE (boss fights): desired() replaces the follow point (still lock/limit clamped) and the
//        framing blends in over `blend` seconds (framing may be mutated each tick); clearMode blends back to base.
import * as THREE from 'three';
import { clamp, damp, lerp, noise1, DEG } from '../core/math.js';

// Framing: heroes ≈ 26% of screen height (SoR4/GA-arcade scale) with the whole ~5 m depth band in view.
const BASE = { fov: 32, distance: 13.2, height: 4.5, lookHeight: 1.2, yaw: 0, roll: 0, lead: 0.9 };

export class CameraRig {
  constructor(game) {
    this.game = game;
    this.camera = new THREE.PerspectiveCamera(BASE.fov, 16 / 9, 0.1, 600);
    this.camera.name = 'gameCamera';
    this.base = { ...BASE };
    this.targets = [];
    this.focus = new THREE.Vector3(0, 0, 0);
    this.prevFocus = new THREE.Vector3();
    this.zMid = 0;
    this.lock = null;
    this.limits = { xMin: -Infinity, xMax: Infinity };
    this.trauma = 0;
    this.traumaDecay = 1.5;
    this.maxShake = { x: 0.34, y: 0.26, roll: 1.4 * DEG };
    this._punch = { t: 0, dur: 1, amount: 0 };
    this._dramas = [];
    this.manual = false;
    this.clampWorld = true;
    this.followZ = 0.3;
    this._lookAt = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this.current = { ...BASE };
    this.mode = null;
    this._modeW = 0;
    this._modeFraming = null;
    this._modeBlend = 1;
    this._fr = { ...BASE };
  }

  /** Additive framing mode (see header). Returns the mode; clearMode(mode) only clears if it is still the active one. */
  setMode(mode) { this.mode = mode || null; if (mode) { this._modeFraming = mode.framing || null; this._modeBlend = mode.blend ?? 1; } return mode; }
  clearMode(mode) { if (!mode || this.mode === mode) this.mode = null; }

  /** base framing with the active mode's framing blended in (render + clamp use this). */
  _framed(out = this._fr) {
    Object.assign(out, this.base);
    const f = this._modeFraming, w = this._modeW;
    if (f && w > 0) { const e = w * w * (3 - 2 * w); for (const k of ['fov', 'distance', 'height', 'lookHeight']) if (f[k] !== undefined) out[k] = lerp(out[k], f[k], e); }
    return out;
  }

  follow(targets) { this.targets = (Array.isArray(targets) ? targets : [targets]).filter(Boolean); }
  setLock(xMin, xMax) { this.lock = { xMin, xMax }; }
  clearLock() { this.lock = null; }
  setLimits(xMin, xMax) { this.limits = { xMin, xMax }; }
  shake(t) { this.trauma = clamp(this.trauma + t, 0, 1); }
  addTrauma(t) { this.shake(t); }
  punch(amount = 0.06, ticks = 9) { if (amount >= this._punch.amount * (1 - this._punch.t / this._punch.dur)) this._punch = { t: 0, dur: ticks, amount }; }

  drama(opts = {}) {
    const d = { opts, w: 0, state: 'in', t: 0, in: opts.in ?? 0.3, out: opts.out ?? 0.45, hold: opts.hold === undefined ? 1 : opts.hold, priority: opts.priority ?? 0 };
    d.release = () => { if (d.state !== 'out') { d.state = 'out'; d.t = 0; d.w0 = d.w; } };
    this._dramas.push(d);
    this._dramas.sort((a, b) => a.priority - b.priority);
    return d;
  }
  clearDrama() { this._dramas.length = 0; }
  /** Per-stage framing override ({ distance, height, lookHeight, fov, lead }); resetFraming() restores the default. */
  setFraming(o = {}) { for (const k of ['fov', 'distance', 'height', 'lookHeight', 'lead']) if (o[k] !== undefined) this.base[k] = o[k]; }
  resetFraming() { Object.assign(this.base, BASE); }

  /** Half width of the view at the focus plane for the current params. */
  halfWidth(p = this.current, zOffset = 0) {
    const dist = Math.hypot(p.distance - zOffset, p.height - p.lookHeight);
    return dist * Math.tan((p.fov * DEG) / 2) * this.camera.aspect;
  }

  visibleRange(z = this.zMid) {
    const hw = this.halfWidth(this.current, z - this.focus.z);
    return { xMin: this.focus.x - hw, xMax: this.focus.x + hw };
  }

  _desired() {
    const alive = this.targets.filter((t) => t && !t.removed && (t.alive !== false || t.kind === 'hero'));
    if (!alive.length) return null;
    let x = 0, z = 0, lead = 0;
    for (const t of alive) { x += t.pos.x; z += t.pos.z; lead += (t.facing || 0); }
    x /= alive.length; z /= alive.length; lead /= alive.length;
    const d = { x: x + lead * this.base.lead, z };
    if (this.mode && this.mode.desired) {
      let m = null;
      try { m = this.mode.desired(d, this); } catch (e) { m = null; }
      if (m) return m;
    }
    return d;
  }

  _clampX(x) {
    const hw = this.halfWidth(this._framed());
    let lo = this.limits.xMin + hw, hi = this.limits.xMax - hw;
    if (this.lock) { lo = Math.max(lo, this.lock.xMin + hw); hi = Math.min(hi, this.lock.xMax - hw); }
    if (lo > hi) return (lo + hi) / 2;
    return clamp(x, lo, hi);
  }

  snap() {
    const d = this._desired();
    if (d) { this.focus.x = this._clampX(d.x); this.focus.z = lerp(this.zMid, d.z, this.followZ); }
    this.prevFocus.copy(this.focus);
  }

  /** Sim tick. */
  update(dt) {
    this.prevFocus.copy(this.focus);
    this._modeW = this.mode ? Math.min(1, this._modeW + dt / Math.max(0.05, this._modeBlend)) : Math.max(0, this._modeW - dt / Math.max(0.05, this._modeBlend));
    if (!this.mode && this._modeW <= 0) this._modeFraming = null;
    if (!this.manual) {
      const d = this._desired();
      if (d) {
        const tx = this._clampX(d.x);
        this.focus.x = damp(this.focus.x, tx, 4.2, dt);
        this.focus.z = damp(this.focus.z, lerp(this.zMid, d.z, this.followZ), 2.5, dt);
      }
      if (this.clampWorld && this.game.world) {
        const r = this.visibleRange(this.game.world.band.zMax);
        const s = this.game.world.screen;
        s.xMin = r.xMin + 0.5; s.xMax = r.xMax - 0.5;
        if (this.lock) { s.xMin = Math.max(s.xMin, this.lock.xMin + 0.3); s.xMax = Math.min(s.xMax, this.lock.xMax - 0.3); }
      }
    }
    this.trauma = Math.max(0, this.trauma - this.traumaDecay * dt);
    if (this._punch.t < this._punch.dur) this._punch.t++;
    for (const d of this._dramas) {
      d.t += dt;
      if (d.state === 'in') { d.w = Math.min(1, d.t / Math.max(0.001, d.in)); if (d.w >= 1) { d.state = 'hold'; d.t = 0; } }
      else if (d.state === 'hold') { d.w = 1; if (d.hold !== null && d.t >= d.hold) d.release(); }
      else if (d.state === 'out') { d.w = (d.w0 ?? 1) * (1 - Math.min(1, d.t / Math.max(0.001, d.out))); }
    }
    this._dramas = this._dramas.filter((d) => !(d.state === 'out' && d.w <= 0));
  }

  /** Render: interpolate, blend dramas, apply shake. */
  render(alpha) {
    if (this.manual) {
      // Showcase/orbit cams position the camera themselves; keep the sun + sky centred on manualFocus.
      const lighting = this.game.renderer && this.game.renderer.lighting;
      if (lighting) lighting.update(this.manualFocus || this.focus, this.camera);
      return;
    }
    const p = this.current;
    this._framed(p);
    let fx = lerp(this.prevFocus.x, this.focus.x, alpha), fz = lerp(this.prevFocus.z, this.focus.z, alpha), fy = 0;
    for (const d of this._dramas) {
      const e = d.w * d.w * (3 - 2 * d.w);
      const o = d.opts;
      for (const k of ['fov', 'distance', 'height', 'lookHeight', 'yaw', 'roll']) if (o[k] !== undefined) p[k] = lerp(p[k], o[k], e);
      if (o.focus) {
        const f = o.focus.pos || o.focus;
        fx = lerp(fx, f.x, e); fz = lerp(fz, f.z ?? fz, e); fy = lerp(fy, (f.y || 0), e);
      }
    }
    // Punch: fast in, eased out.
    const pu = this._punch;
    if (pu.t < pu.dur) { const k = pu.t / pu.dur; const s = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8; p.distance *= 1 - pu.amount * s * s; }
    const yaw = p.yaw * DEG;
    const cam = this.camera;
    cam.position.set(fx + Math.sin(yaw) * p.distance, p.height + fy, fz + Math.cos(yaw) * p.distance);
    this._lookAt.set(fx, p.lookHeight + fy, fz);
    // Trauma shake (continuous noise sampled on real time, so hitstop freezes don't freeze the shake).
    const t = this.game.realTime * 18, s = this.trauma * this.trauma;
    if (s > 0.0001) {
      cam.position.x += noise1(t) * this.maxShake.x * s;
      cam.position.y += noise1(t + 37.1) * this.maxShake.y * s;
      this._lookAt.x += noise1(t + 11.3) * this.maxShake.x * 0.4 * s;
    }
    cam.lookAt(this._lookAt);
    const roll = p.roll * DEG + (s > 0.0001 ? noise1(t + 71.7) * this.maxShake.roll * s : 0);
    if (roll) cam.rotateZ(roll);
    if (cam.fov !== p.fov) { cam.fov = p.fov; cam.updateProjectionMatrix(); }
    const lighting = this.game.renderer && this.game.renderer.lighting;
    if (lighting) lighting.update(this._lookAt, cam);
  }

  worldToScreen(v, out = { x: 0, y: 0, visible: false }) {
    const r = this.game.renderer;
    this._v.copy(v).project(this.camera);
    out.x = (this._v.x * 0.5 + 0.5) * (r ? r.width : innerWidth);
    out.y = (-this._v.y * 0.5 + 0.5) * (r ? r.height : innerHeight);
    out.visible = this._v.z < 1 && Math.abs(this._v.x) <= 1.05 && Math.abs(this._v.y) <= 1.05;
    return out;
  }
}
