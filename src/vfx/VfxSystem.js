// VfxSystem (game.vfx): effect registry front-end + shared GPU pools + event wiring. Everything is instanced
// (one draw call per pool) and shader-shaped; quality=low halves counts (vfx.scale) and capacities.
//
//   vfx.spawn(id, opts)     run src/vfx/effects/<id>.js → effect.spawn(vfx, opts). Sync if preloaded, else queued.
//   vfx.add / vfx.alpha     ParticlePool: additive HDR (sparks, embers, motes) / LIT alpha (dust, smoke: albedo colours)
//   vfx.shape / vfx.shapeLit ShapePool: shaped quads (glow ring star slash line crack bolt flame ripple flare dustring disc),
//                           billboard | ground-plane | axial. shapeLit = albedo lit by the stage lights (dust rings, stains)
//   vfx.debris              DebrisPool: lit instanced rock chips / splinters with bounce  → vfx.debris.burst({...})
//   vfx.trails              TrailSystem: weapon ribbons, auto-driven from move hit windows; start/stop/swingDir API
//   vfx.light(pos, o)       pooled fill pop (default ≤6 / 2.6m; contact ≤24 / 1.7m / 66ms)
//   vfx.track(obj, life, update?)  keep an Object3D alive for `life` s   ·  vfx.emitter(life, fn(t01, dt, age))
//   vfx.delay(seconds, fn)  render-clock timer (slow-mo aware)  ·  vfx.rng (cosmetic)  ·  vfx.scale
//   vfx.palette(actor|element) · vfx.dustColor() · vfx.debrisColor() · vfx.groundY(actor|pos) · vfx.camBasis()
// Default bus wiring is in _wire(); camera/post/material juice per hit weight lives in ScreenFx.js.
// Particles simulate on render frames with frameDt × game.timeScale (smooth slow-mo; hitstop does not freeze sparks —
// shaped impacts instead HOLD their peak for the hitstop duration via `hold`).
import * as THREE from 'three';
import { ParticlePool } from './ParticleSystem.js';
import { ShapePool } from './ShapeFx.js';
import { FirePool, preloadFireLibrary } from './fireLib.js';
import { DebrisPool } from './Debris.js';
import { TrailSystem } from './Trails.js';
import { PALETTES, paletteOf } from './palette.js';
import { registries } from '../core/registries.js';
import { reportError } from '../core/log.js';
import { EV } from '../core/EventBus.js';
import { ScreenFx } from './ScreenFx.js';
import { HitFlash } from './HitFlash.js';
import { updateContactFills } from '../render/characterLook.js';

const COMBO_MILESTONES = new Set([10, 20, 30, 50, 75, 100, 150, 200]);
// enemy telegraph glint radius (m) around the weapon hand, by Enemy TELE kind (perf-1650 C2 r1)
const TELE_GLINT = { normal: 0.6, heavy: 0.62, unblockable: 0.66, grab: 0.66 }; // C2 r1 (Combat, AI & Bosses, additive): normal 0.45 → 0.6 — the jab / swing tell was barely visible at game distance

export class VfxSystem {
  constructor(game) {
    this.game = game;
    this.name = 'vfx';
    this.order = 60;
    this.freezable = false;
    this.rng = game.fxRng;
    this.scale = game.quality.particleScale;
    const cap = game.quality.maxParticles;
    const low = this.scale < 1;
    this.add = new ParticlePool({ capacity: Math.round(cap * 0.6) + (low ? 600 : 2000), additive: true, name: 'vfx_add' }); // + headroom for top-tier spells
    this.alpha = new ParticlePool({ capacity: Math.round(cap * 0.4), additive: false, lit: true, name: 'vfx_alpha' });
    this.shape = new ShapePool({ capacity: low ? 400 : 1000, additive: true, name: 'vfx_shape' });
    this.shapeLit = new ShapePool({ capacity: low ? 60 : 120, additive: false, lit: true, name: 'vfx_shape_lit' });
    this.fire = new FirePool({ capacity: low ? 48 : 96 });
    // Impact paint must composite over the weapon ribbon (18); environment pools retain order 7.
    this.fire.mesh.renderOrder = 20;
    this.debris = new DebrisPool({ capacity: low ? 80 : 180, shadows: !low });
    this.group = new THREE.Group();
    this.group.name = 'vfx';
    this.scope = game.bus.scope();
    this.trails = new TrailSystem(this);
    this.group.add(this.fire.mesh, this.shapeLit.mesh, this.alpha.mesh, this.debris.mesh, this.trails.mesh, this.shape.mesh, this.add.mesh);
    game.scene.add(this.group);
    this.tracked = [];
    this.emitters = [];
    this.timers = [];
    this.lights = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffc080, 0, 2.5, 2);
      l.castShadow = false;
      l.name = 'vfx_popLight';
      // perf-1650: parented to the scene, not the vfx group — the spell cut-in hides the vfx group while it renders,
      // and hiding 3 lights changed numPointLights (a second program for every lit material in the inset).
      game.scene.add(l);
      this.lights.push({ light: l, t: 0, life: 0, base: 0 });
    }
    this._cam = { right: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0), fwd: new THREE.Vector3(0, 0, -1) };
    this._dust = new THREE.Color('#5c4c3e');
    this._debris = new THREE.Color('#4a3e34');
    this._dustStage = null;
    this.hitFlash = new HitFlash(game);
    this.screen = new ScreenFx(game, this);
    this._wire();
  }

  async preload() {
    await preloadFireLibrary();
    const all = await registries.effects.loadAll();
    for (const [id, fx] of all) { try { if (fx.preload) await fx.preload(this); } catch (e) { reportError(`vfx:${id}.preload`, e); } }
    return all;
  }

  /** Run an effect by id. Returns whatever the effect returns (handle) or null if not loaded yet. */
  spawn(id, opts = {}) {
    const fx = registries.effects.get(id);
    if (fx) {
      try { return fx.spawn(this, opts); } catch (e) { reportError(`vfx:${id}`, e); return null; }
    }
    if (!registries.effects.has(id)) { reportError('vfx', new Error(`unknown effect '${id}'`)); return null; }
    this.game.track(registries.effects.load(id).then((m) => { if (m) try { m.spawn(this, opts); } catch (e) { reportError(`vfx:${id}`, e); } }));
    return null;
  }

  /**
   * Tiny warm fill pop from a fixed pool (steals the oldest). Clamped so it can only kiss nearby surfaces:
   * default intensity ≤6 / distance ≤2.6m. Contact reuses slot0 at ≤24 / ≤1.7m / ≤66ms.
   */
  light(pos, { color = 0xffc080, intensity = 3, distance = 2, life = 0.1, contact = false } = {}) {
    let slot = contact ? this.lights[0] : this.lights.find((s) => s.t >= s.life) || this.lights.reduce((a, b) => (a.t / a.life > b.t / b.life ? a : b));
    slot.light.position.set(pos.x, pos.y, pos.z);
    slot.light.color.set(color);
    slot.light.distance = Math.min(contact ? 1.7 : 2.6, distance);
    // Contact is one reused light at torso height: short, bounded radius, no shader-count change.
    slot.base = Math.min(contact ? 24 : 6, intensity); slot.t = 0; slot.life = contact ? Math.min(.066,life) : life;
    slot.hold = contact ? 1/60 : 0;
    slot.light.intensity = slot.base;
  }

  /** Keep an Object3D alive for `life` seconds, calling update(obj, t01, dt) each frame, then remove it. */
  track(obj, life, update = null, { dispose = true } = {}) {
    this.group.add(obj);
    this.tracked.push({ obj, life, t: 0, update, dispose });
    return obj;
  }

  /** Per-frame emitter callback for `life` seconds: fn(t01, dt, age). Return false to stop early. */
  emitter(life, fn) { const e = { life, t: 0, fn }; this.emitters.push(e); return e; }

  /** Render-clock timer (scaled by timeScale, independent of hitstop). */
  delay(seconds, fn) { this.timers.push({ t: seconds, fn }); }

  // ------------------------------------------------------------ helpers for effects
  palette(actorOrElement) { return typeof actorOrElement === 'string' ? (PALETTES[actorOrElement] || PALETTES.neutral) : paletteOf(actorOrElement); }

  groundY(a) {
    if (!a) return 0;
    if (a.groundY !== undefined && a.groundY !== null) return a.groundY;
    const w = this.game.world;
    if (w && w.groundAt && a.x !== undefined) { try { return w.groundAt(a.x, a.z) || 0; } catch { return 0; } }
    return 0;
  }

  /** Terrain dust albedo: stage `vfx.dust` if given, else derived from the stage's hemisphere ground colour. */
  dustColor() { this._refreshStageTint(); return this._dust; }
  debrisColor() { this._refreshStageTint(); return this._debris; }

  _refreshStageTint() {
    const lv = this.game.levels, st = lv && lv.stage;
    if (!st || st === this._dustStage) return;
    this._dustStage = st;
    const v = st.vfx || {};
    if (v.dust) this._dust.set(v.dust);
    else {
      const g = st.lighting && st.lighting.hemi && st.lighting.hemi.ground;
      this._dust.set('#8e7e6c');
      if (g) this._dust.lerp(new THREE.Color(g), 0.22);
    }
    if (v.debris) this._debris.set(v.debris); else this._debris.copy(this._dust).multiplyScalar(0.72);
  }

  camBasis() {
    const cam = this.game.camera;
    if (cam) {
      const e = cam.matrixWorld.elements;
      this._cam.right.set(e[0], e[1], e[2]).normalize();
      this._cam.up.set(e[4], e[5], e[6]).normalize();
      this._cam.fwd.set(-e[8], -e[9], -e[10]).normalize();
    }
    return this._cam;
  }

  // ------------------------------------------------------------ event wiring
  _wire() {
    const bus = this.scope;
    bus.on(EV.HIT, (ev) => {
      const id = (ev.hit && ev.hit.spark) || 'hit_spark';
      this.spawn(id, {
        point: ev.point, dir: ev.dir, level: ev.level, damage: ev.damage, attacker: ev.attacker, target: ev.target, blocked: ev.blocked,
        killed: ev.killed, knockdown: ev.knockdown, launch: ev.launch, otg: ev.otg, moveId: ev.moveId, hitstop: ev.hitstop,
        bounce: ev.hit && ev.hit.bounce, element: ev.hit && ev.hit.element,
      });
    });
    bus.on(EV.LAND, (e) => {
      if (!e.actor) return;
      if (e.body || e.slam || e.speed > 3) this.spawn('land_impact', { actor: e.actor, speed: e.speed, body: e.body, slam: e.slam, bounce: e.bounce });
    });
    bus.on(EV.CHARGE, (e) => {
      if (!e.actor || !e.level) return;
      this.spawn('charge_glint', { actor: e.actor, level: e.level });
      // Charge flashes (Hero.flash, whole body) are masked to a glow gathering around the weapon hand.
      const a = e.actor, sock = a.model && a.model.sockets && (a.model.sockets.R || a.model.sockets.L);
      if (sock) {
        const wp = new THREE.Vector3();
        this.hitFlash.hit(a, sock.getWorldPosition(wp), { radius: 0.3 + e.level * 0.08, gain: 1.0,
          follow: () => sock.getWorldPosition(wp), until: () => a.chargeLevel > 0 && a.alive !== false });
      }
    });
    // perf-1650 C2 r1 (pale spawn figure): enemy wind-up telegraphs (Enemy.telegraph → Combatant.flash) lit the WHOLE
    // body at emissive 0.7-1.2, so every normal/heavy swing turned the foe into a flat cream/orange statue for 3-5
    // frames (stage 1's first straw marauders; a pale figure filling the frame edge on close cameras). Same treatment
    // as the charge glow: mask it to a glint at the weapon hand. Uniforms only, no new programs. Bosses keep their
    // surface-tint route (HitFlash.render). &teleglint=0: old whole-body flash (A/B).
    const P = this.game.params, teleGlint = !(P && P.get && P.get('teleglint') === '0');
    bus.on('ai:telegraph', (e) => {
      const a = e && e.actor, root = a && a.modelRoot;
      if (!teleGlint || !root || a.kind === 'boss' || root.userData.kcaBossFlash || !(a._flash && a._flash.t > 0)) return;
      const sock = a.model && a.model.sockets && (a.model.sockets.R || a.model.sockets.L);
      const radius = TELE_GLINT[e.kind] || TELE_GLINT.normal;
      if (sock) {
        const wp = new THREE.Vector3();
        this.hitFlash.hit(a, sock.getWorldPosition(wp), { radius, gain: 1.0, follow: () => sock.getWorldPosition(wp) });
      } else this.hitFlash.hit(a, { x: a.pos.x, y: a.pos.y + (a.height || 1.8) * 0.6, z: a.pos.z }, { radius: 0.65, tint: true });
    });
    bus.on(EV.THROW, (e) => { if (e.actor) this.spawn('dust', { pos: e.actor.pos, amount: 0.6, groundY: this.groundY(e.actor) }); });
    bus.on(EV.FOOTSTEP, (e) => {
      const a = e.actor;
      if (!a || !a.fsm) return;
      if (a.fsm.is('run')) this.spawn('dust', { pos: a.pos, amount: 0.32, groundY: this.groundY(a), dir: -(a.facing || 1), kind: 'step' });
      else if (a.kind === 'hero' && this.scale >= 1 && a.fsm.is('walk')) this.spawn('dust', { pos: a.pos, amount: 0.12, groundY: this.groundY(a), kind: 'step' });
    });
    bus.on(EV.DODGE, (e) => { if (e.actor) this.spawn(e.perfect ? 'time_ripple' : 'dodge_dust', { actor: e.actor }); });
    bus.on(EV.GETUP, (e) => { if (e.actor) this.spawn('dust', { pos: e.actor.pos, amount: 0.45, groundY: this.groundY(e.actor), kind: 'getup' }); });
    bus.on(EV.KO, (e) => { if (e.actor) this.spawn('ko_wisp', { actor: e.actor, by: e.by }); });
    bus.on(EV.POT_PICKUP, (e) => { if (e.hero) this.spawn('pickup_burst', { hero: e.hero, kind: e.kind, amount: e.amount }); });
    bus.on(EV.COMBO, (e) => {
      if (!e || !COMBO_MILESTONES.has(e.count)) return;
      const hero = this.game.world.query({ kind: 'hero' }).find((h) => h.playerIndex === e.player);
      if (hero) this.spawn('combo_flourish', { actor: hero, count: e.count, rank: e.rank });
    });
  }

  update() {}

  render(alpha, frameDt) {
    const dt = Math.min(0.1, frameDt) * this.game.timeScale;
    for (let i = 0; i < this.timers.length; i++) {
      const tm = this.timers[i];
      tm.t -= dt;
      if (tm.t <= 0) { this.timers.splice(i--, 1); try { tm.fn(); } catch (e) { reportError('vfx.delay', e); } }
    }
    for (let i = 0; i < this.emitters.length; i++) {
      const em = this.emitters[i];
      em.t += dt;
      let keep = em.t < em.life;
      try { if (em.fn(Math.min(1, em.t / em.life), dt, em.t) === false) keep = false; } catch (e) { reportError('vfx.emitter', e); keep = false; }
      if (!keep) this.emitters.splice(i--, 1);
    }
    this.trails.update(dt);
    this.add.update(dt);
    this.alpha.update(dt);
    this.shape.update(dt);
    this.shapeLit.update(dt);
    this.fire.update(dt);
    this.debris.update(dt);
    for (const s of this.lights) {
      if (s.t < s.life) { s.t += dt; const k = Math.max(0, 1 - Math.max(0,s.t-(s.hold||0)) / Math.max(.001,s.life-(s.hold||0))); s.light.intensity = s.base * k * k; }
      else s.light.intensity = 0;
    }
    for (let i = 0; i < this.tracked.length; i++) {
      const tr = this.tracked[i];
      tr.t += dt;
      const u = Math.min(1, tr.t / tr.life);
      if (tr.update) { try { tr.update(tr.obj, u, dt); } catch (e) { reportError('vfx.track', e); tr.t = tr.life; } }
      if (tr.t >= tr.life) {
        this.group.remove(tr.obj);
        if (tr.dispose) tr.obj.traverse((o) => { if (o.geometry && !o.userData.sharedGeometry) o.geometry.dispose(); if (o.material && !o.userData.sharedMaterial) o.material.dispose(); });
        this.tracked.splice(i--, 1);
      }
    }
    updateContactFills(dt);
    this.hitFlash.render(dt);
    this.screen.render(frameDt);
  }

  clear() {
    this.fire.clear(); this.add.clear(); this.alpha.clear(); this.shape.clear(); this.shapeLit.clear(); this.debris.clear(); this.trails.clear();
    this.emitters.length = 0; this.timers.length = 0;
    for (const tr of this.tracked) this.group.remove(tr.obj);
    this.tracked.length = 0;
    for (const c of this.group.children) if (c.userData.vfxReset) c.userData.vfxReset();   // persistent pools (magic rock fields)
    updateContactFills(0, true);
    this.hitFlash.clear();
  }

  dispose() {
    this.scope.dispose(); this.clear(); this.game.scene.remove(this.group);
    for (const s of this.lights) this.game.scene.remove(s.light);
    for (const p of [this.fire, this.add, this.alpha, this.shape, this.shapeLit, this.debris, this.trails]) p.dispose();
  }
}
