// Mount (bizarrian): a rideable beast actor (DESIGN §5/§10, GOLDEN_AXE_NOTES §4).
//
// Stable API (ENGINE_API §11):
//   mount.rider                      current rider (hero or enemy) or null
//   mount.canMount(actor)            free, alive, not fleeing, close enough, actor allowed to ride
//   mount.mount(actor) / mount.dismount({ knocked, silent })   seat instantly / drop the rider (EV.MOUNT / EV.DISMOUNT)
//   mount.saddle                     Object3D the rider's body is pinned to (seat point, rider origin)
//   mount.attacks                    { id: MoveDef } beast attacks, run BY THE RIDER as moves 'beast_<id>'
//   mount.animate(dt, speed)         per-type visual hook (procedural gait / attack poses), every render
//
// Riding model: the RIDER is the physics body (camera, bounds and AI keep working unchanged). While ridden the beast
// copies the rider's position/facing every tick (MountSystem.update) and is not hurtable itself: hits land on the
// rider, whose hurtbox grows to cover the beast; MountSystem's preHit hook applies soak / knock-off rules.
// Unridden beasts are neutral, hittable by both teams (a hard hit makes them bolt), wander, and leave the screen
// `def.leaveTicks` after they lost a rider. States: 'free' | 'claimed' (a rider is hopping on) | 'ridden' | 'flee'.
import * as THREE from 'three';
import { Actor } from '../core/Actor.js';
import { EV } from '../core/EventBus.js';
import { seatRider, unseatRider } from './riding.js';

const _v = new THREE.Vector3();

export class Mount extends Actor {
  constructor(game, def, opts = {}) {
    super(game, { kind: 'mount', typeId: def.id, team: 'neutral', x: opts.x, z: opts.z, facing: opts.facing ?? 1, hp: def.hp ?? 40, radius: def.radius ?? 0.6, height: def.height ?? 1.8, mass: 3, shadowRadius: def.shadowRadius ?? 0.8, boundsMode: 'band' });
    this.def = def;
    this.rider = null;
    this.attacks = def.attacks || {};
    this.saddle = new THREE.Object3D();
    this.saddle.name = 'saddle';
    this.saddleY = def.saddleY ?? 1.2;
    this.speed = def.speed ?? 4;
    this.wander = { t: 0, x: this.pos.x, z: this.pos.z };
    this.mode = 'free';
    this.hurtable = true;       // free beasts can be struck (they flinch / bolt); off while ridden
    this.hittableByAll = true;  // neutral: both teams' swings connect
    this.model = null;
    this.gait = 0;
    this.leaveTimer = -1;       // ticks until a riderless beast leaves (-1 = dormant: waits for its first rider)
    this.lastRider = null;
    this.noMount = new Map();   // actor id → tick until which it may not re-mount (just knocked off)
    this.action = null;         // { id, frame, total, def } beast attack pose driver (visual)
    this.flinch = 0;            // visual hurt jolt (ticks)
    this.hurtLean = 0;
    this.blinkT = 0;
    this.surge = 0;             // visual 'effort' for dash/charge
  }

  get free() { return !this.rider && this.mode === 'free' && this.alive && !this.removed; }

  canMount(a) {
    if (!this.free || !a || !a.alive || a.mountedOn) return false;
    if (a.def && a.def.canRide === false) return false;
    const until = this.noMount.get(a.id);
    if (until && this.game.tick < until) return false;
    return Math.hypot(a.pos.x - this.pos.x, a.pos.z - this.pos.z) < (this.def.mountReach ?? 1.45);
  }

  /** Seat `a` immediately (spawned riders; the hop-on state calls this when it lands in the saddle). */
  mount(a, { force = false } = {}) {
    if (!force && !(this.canMount(a) || (this.mode === 'claimed' && this.claimedBy === a))) return false;
    this.rider = a; this.mode = 'ridden'; this.claimedBy = null;
    this.team = a.team; this.hurtable = false; this.solid = false;
    this.leaveTimer = -1; this.lastRider = a;
    this.pos.copy(a.pos); this.prevPos.copy(a.prevPos); this.facing = a.facing; this.vel.set(0, 0, 0);
    seatRider(a, this);
    this.game.bus.emit(EV.MOUNT, { rider: a, mount: this });
    return true;
  }

  claim(a) { if (!this.free) return false; this.mode = 'claimed'; this.claimedBy = a; this.vel.set(0, 0, 0); return true; }
  unclaim() { if (this.mode === 'claimed') { this.mode = 'free'; this.claimedBy = null; } }

  /** Drop the rider. knocked = struck off (rider enters knockdown via the hit); else a voluntary hop off. */
  dismount({ knocked = false, silent = false } = {}) {
    const a = this.rider;
    if (!a) return;
    this.rider = null; this.team = 'neutral'; this.mode = 'free';
    this.hurtable = true; this.solid = true; this.action = null;
    unseatRider(a, this, { knocked, silent });
    this.noMount.set(a.id, this.game.tick + (knocked ? 150 : 30));
    // A beast that lost its rider hangs around for a while, then leaves (GA: it wanders off).
    this.leaveTimer = this.def.leaveTicks ?? 720;
    this.wander.t = knocked ? 30 : 10;
    if (this.hp <= 0) this.flee();
    this.game.bus.emit(EV.DISMOUNT, { rider: a, mount: this, knocked });
    this.game.bus.emit('mounts:riderOff', { rider: a, mount: this, knocked });
  }

  /** Run off-screen and vanish (hit hard, out of HP, or bored). */
  flee() {
    if (this.rider) this.dismount({ knocked: true });
    if (this.mode === 'flee') return;
    this.mode = 'flee';
    this.hurtable = false;
    const cam = this.game.cameraRig;
    const vis = cam && cam.visibleRange ? cam.visibleRange(this.pos.z) : { xMin: this.pos.x - 10, xMax: this.pos.x + 10 };
    this.fleeDir = (this.pos.x - vis.xMin) < (vis.xMax - this.pos.x) ? -1 : 1;
    this.game.bus.emit('mounts:flee', { mount: this });
  }

  // ------------------------------------------------------------ CombatSystem target contract (free beasts)
  canBeHit(ev) { return this.alive && !this.removed && this.hurtable && !this.rider && this.invuln <= 0 && ev.attacker !== this.claimedBy; }
  receiveHit(ev) {
    this.hp = Math.max(0, this.hp - ev.damage);
    this.flinch = 12; this.hurtLean = ev.dir || -this.facing;
    this.vel.x = (ev.dir || -this.facing) * Math.min(4, 1.2 + (ev.knockback || 0) * 0.6);
    this.invuln = 8;
    this.game.bus.emit('mounts:hurt', { mount: this, ev });
    const hard = ev.knockdown || ev.level === 'heavy' || ev.level === 'magic' || (ev.launch || 0) > 0;
    if (this.hp <= 0 || hard) this.game.after(10, () => this.flee());
    return true;
  }

  // ------------------------------------------------------------ sim
  update(dt) {
    super.update(dt);
    if (this.flinch > 0) this.flinch--;
    if (this.invuln > 0) this.invuln--;
    if (this.mode === 'ridden') return; // MountSystem pins us to the rider after the world tick
    const band = this.game.world.band;
    if (this.mode === 'claimed') { this.friction(14, dt); return; }
    if (this.mode === 'flee') {
      const sp = (this.def.run ?? this.speed * 1.6);
      this.vel.x += (this.fleeDir * sp - this.vel.x) * Math.min(1, 6 * dt);
      this.vel.z *= 0.9;
      this.setFacing(this.fleeDir);
      const cam = this.game.cameraRig;
      const vis = cam && cam.visibleRange ? cam.visibleRange(this.pos.z) : null;
      if (!vis || this.pos.x < vis.xMin - 3 || this.pos.x > vis.xMax + 3 || this.age > 60 * 60) this.remove();
      return;
    }
    // free: wander near where it was left; bolt when the leave timer expires.
    if (this.leaveTimer > 0 && --this.leaveTimer === 0) { this.flee(); return; }
    if (this.flinch > 0) { this.friction(6, dt); return; }
    const w = this.wander;
    if (--w.t <= 0) {
      w.t = this.game.rng.int(80, 190);
      const cam = this.game.cameraRig;
      const vis = cam && cam.visibleRange ? cam.visibleRange(this.pos.z) : { xMin: this.pos.x - 6, xMax: this.pos.x + 6 };
      w.x = Math.max(vis.xMin + 1.2, Math.min(vis.xMax - 1.2, this.pos.x + this.game.rng.range(-2.5, 2.5)));
      w.z = this.game.rng.range(band.zMin * 0.85, band.zMax * 0.85);
      w.idle = this.game.rng.chance(0.35);
    }
    const dx = w.x - this.pos.x, dz = w.z - this.pos.z, d = Math.hypot(dx, dz);
    if (!w.idle && d > 0.3) { this.vel.x = (dx / d) * this.speed * 0.3; this.vel.z = (dz / d) * this.speed * 0.22; this.setFacing(dx); }
    else this.friction(8, dt);
  }

  /** Called by MountSystem after the world tick while ridden: follow the rider exactly. */
  follow(a) {
    this.pos.copy(a.pos); this.prevPos.copy(a.prevPos); this.vel.copy(a.vel);
    this.facing = a.facing; this.grounded = a.grounded; this.hitstop = a.hitstop;
    const run = a.attack;
    const id = run && a.moveId && a.moveId.startsWith('beast_') ? a.moveId.slice(6) : null;
    if (id && this.attacks[id]) {
      if (!this.action || this.action.run !== run) this.action = { id, run, def: this.attacks[id], frame: 0, total: run.total };
      this.action.frame = run.frame;
      if (this.def.onAttackTick) { try { this.def.onAttackTick(this, a, run, id); } catch (e) { /* visual/proj hooks never break riding */ } }
    } else if (!(this.action && this.action.demo)) this.action = null;
  }

  render(alpha, frameDt) {
    super.render(alpha, frameDt);
    const sp = this.demoSpeed ?? Math.hypot(this.vel.x, this.vel.z);
    this.gait += frameDt * this.game.timeScale * (this.hitstop > 0 ? 0 : 1) * (1.6 + sp * (this.def.stride ?? 1.9));
    this.speedNow = sp;
    if (this.animate) this.animate(frameDt, sp);
  }

  /** Showcase / scripted: play a beast attack pose without a rider (advance with demoTick() once per sim tick). */
  demoAction(id) {
    const d = this.attacks[id];
    if (!d) return false;
    const total = d.total ?? ((d.startup || 0) + (d.active || 0) + (d.recovery || 0));
    this.action = { id, def: d, frame: 0, total, demo: true, run: { frame: 0, total, def: d } };
    return true;
  }
  demoTick() {
    const a = this.action;
    if (!a || !a.demo) return;
    a.frame++; a.run.frame = a.frame;
    if (this.def.onAttackTick) { try { this.def.onAttackTick(this, this.rider || this, a.run, a.id); } catch (e) { /* cosmetic */ } }
    if (a.frame >= a.total) this.action = null;
  }

  /** World position of the seat (after the view matrices are current). */
  saddleWorld(out = _v) { this.view.updateMatrixWorld(true); return this.saddle.getWorldPosition(out); }
}
