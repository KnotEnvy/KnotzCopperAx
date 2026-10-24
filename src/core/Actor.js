// Actor: base class for everything that lives on the belt plane (heroes, enemies, mounts, pickups, props,
// projectiles). Owns belt-plane physics, facing, hitstop/invulnerability counters, a state machine and a
// view hierarchy:
//
//   actor.view  (Group, placed at interpolated pos; no rotation)       ← add world-space attachments here
//     ├ actor.body (Group, yaw = facing (smoothed) + camera cheat)      ← the model goes here
//     └ actor.shadow (contact blob, stays on the ground)
//
// Coordinates: pos.x = scroll, pos.z = depth (+Z toward camera), pos.y = height ABOVE THE GROUND under the
// actor (world.groundAt(x,z) supplies ground height, default 0). facing = +1 (toward +X) or −1.
import * as THREE from 'three';
import { StateMachine } from './StateMachine.js';
import { GRAVITY, DEPTH_TOL } from './config.js';
import { makeBox, boxFrom } from './aabb.js';
import { angleDelta, lerp } from './math.js';
import { createContactShadow, updateContactShadow } from '../render/contactShadow.js';

let NEXT_ID = 1;

export class Actor {
  /**
   * @param {import('./Game.js').Game} game
   * @param {object} opts { kind, typeId, team, x, y, z, facing, radius, height, hp, tags, shadow }
   */
  constructor(game, opts = {}) {
    this.game = game;
    this.id = NEXT_ID++;
    /** 'hero' | 'enemy' | 'mount' | 'pickup' | 'prop' | 'projectile' | 'boss' | 'dummy' | ... */
    this.kind = opts.kind || 'actor';
    this.typeId = opts.typeId || this.kind;
    /** 'players' | 'enemies' | 'neutral' */
    this.team = opts.team || 'neutral';
    this.tags = new Set(opts.tags || []);

    this.pos = new THREE.Vector3(opts.x || 0, opts.y || 0, opts.z || 0);
    this.prevPos = this.pos.clone();
    this.vel = new THREE.Vector3();
    this.facing = opts.facing === -1 ? -1 : 1;
    this.grounded = this.pos.y <= 0;
    this.gravityScale = opts.gravityScale ?? 1;
    this.groundY = 0;

    this.radius = opts.radius ?? 0.35;   // belt-plane body radius (push separation)
    this.height = opts.height ?? 1.8;
    this.mass = opts.mass ?? 1;
    /** Participates in body separation. */
    this.solid = opts.solid ?? true;
    /** 'screen' = clamp to camera/lock bounds (players), 'band' = z band only, 'none' = free. */
    this.boundsMode = opts.boundsMode || 'band';

    this.maxHp = opts.hp ?? 1;
    this.hp = this.maxHp;
    this.alive = true;
    this.removed = false;

    /** Per-actor hitstop in ticks (actor freezes; view jitters). */
    this.hitstop = 0;
    this.hitstopShake = 0;
    /** Invulnerability ticks. */
    this.invuln = 0;
    /** Per-actor time scale (0..1). Fractional values skip ticks deterministically. */
    this.timeScale = 1;
    this._tacc = 0;
    this.localTime = 0;
    this.age = 0; // ticks alive

    this.fsm = new StateMachine(this, {});

    this.view = new THREE.Group();
    this.view.name = `${this.kind}:${this.typeId}#${this.id}`;
    this.body = new THREE.Group();
    this.view.add(this.body);
    this.view.userData.actor = this;
    /** Visual yaw is smoothed toward the facing target. cheatYaw turns models slightly toward camera. */
    this.cheatYaw = opts.cheatYaw ?? 0.32;
    this.turnRate = opts.turnRate ?? 28;
    this.visualYaw = this.targetYaw();
    if (opts.shadow !== false) {
      this.shadow = createContactShadow(opts.shadowRadius ?? this.radius * 1.15, opts.shadowOpacity ?? 0.6);
      this.view.add(this.shadow);
    }

    /** Hurtbox dims (centered on pos.x/z, bottom at pos.y). Subclasses override hurtboxes() for per-state shapes. */
    this.hurt = { w: this.radius * 2, h: this.height * 0.95, d: DEPTH_TOL * 1.0, dx: 0, dy: 0 };
    this._hurtBox = makeBox();
    this._hurtList = [this._hurtBox];
    this.landedThisTick = false;
    this.lastLandSpeed = 0;
  }

  // ------------------------------------------------------------ lifecycle hooks
  /** Called once when added to the world (view already in scene). */
  onAdd() {}
  /** Called when removed from the world. */
  onRemove() {}
  /** Per-tick logic (state machine). Physics integrate() runs after this unless skipPhysics. */
  update(dt) { this.fsm.update(dt); }
  /** Called on the tick the actor touches ground after being airborne. */
  onLand(speed) {} // eslint-disable-line no-unused-vars
  /** Called each tick the actor is frozen by per-actor hitstop. */
  onHitstopTick() {}

  // ------------------------------------------------------------ physics
  integrate(dt) {
    this.landedThisTick = false;
    if (!this.grounded || this.vel.y > 0) this.vel.y -= GRAVITY * this.gravityScale * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= 0) {
      if (!this.grounded) {
        this.lastLandSpeed = -this.vel.y;
        this.grounded = true;
        this.pos.y = 0;
        this.vel.y = 0;
        this.landedThisTick = true;
        this.onLand(this.lastLandSpeed);
      } else { this.pos.y = 0; if (this.vel.y < 0) this.vel.y = 0; }
    } else {
      this.grounded = false;
    }
  }

  /** Ground friction on the belt plane (k = 1/s). */
  friction(k, dt) {
    const f = Math.exp(-k * dt);
    this.vel.x *= f; this.vel.z *= f;
  }

  // ------------------------------------------------------------ helpers
  targetYaw() { return this.facing > 0 ? Math.PI / 2 - this.cheatYaw : -Math.PI / 2 + this.cheatYaw; }
  setFacing(dir) { if (dir) this.facing = dir > 0 ? 1 : -1; }
  faceToward(other) { if (other) this.setFacing(other.pos.x - this.pos.x || this.facing); }
  dx(other) { return other.pos.x - this.pos.x; }
  dz(other) { return other.pos.z - this.pos.z; }
  distTo(other) { return Math.hypot(other.pos.x - this.pos.x, other.pos.z - this.pos.z); }
  isHittable() { return this.alive && !this.removed && this.invuln <= 0; }
  get airborne() { return !this.grounded; }

  /** World-space hurtboxes (array of AABB). Override for per-state shapes (e.g. lying down). */
  hurtboxes() {
    const h = this.hurt;
    boxFrom(this._hurtBox, this.pos.x + h.dx * this.facing, this.pos.y + (h.dy || 0), this.pos.z, h.w, h.h, h.d);
    return this._hurtList;
  }

  /** Mark for removal (world removes it after the current tick). */
  remove() { this.removed = true; }

  // ------------------------------------------------------------ render
  /** Interpolated view update. alpha ∈ [0,1) between previous and current tick; frameDt = real seconds. */
  render(alpha, frameDt) {
    const x = lerp(this.prevPos.x, this.pos.x, alpha);
    const y = lerp(this.prevPos.y, this.pos.y, alpha);
    const z = lerp(this.prevPos.z, this.pos.z, alpha);
    this.view.position.set(x, this.groundY + y, z);
    // Smooth turn toward facing.
    const target = this.targetYaw();
    const d = angleDelta(this.visualYaw, target);
    this.visualYaw += d * (1 - Math.exp(-this.turnRate * Math.min(frameDt, 0.05)));
    this.body.rotation.y = this.visualYaw;
    // Victim hitstop jitter (alternating ±).
    if (this.hitstop > 0 && this.hitstopShake > 0) {
      const s = (this.game.tick & 1 ? 1 : -1) * this.hitstopShake * Math.min(1, this.hitstop / 6);
      this.body.position.x = s; this.body.position.z = s * 0.3;
    } else if (this.body.position.x !== 0) { this.body.position.x = 0; this.body.position.z = 0; }
    if (this.shadow) updateContactShadow(this.shadow, y);
  }

  /** Release GPU resources owned by this actor (cloned materials). Shared geometry is left alone. */
  dispose() {
    this.view.traverse((o) => {
      // perf-1650 r4: every clone owns a Skeleton whose boneTexture (a float DataTexture + its GL object) was never
      // freed — 150+ of them alive by stage 5. three recreates it lazily if the mesh is ever drawn again.
      if (o.isSkinnedMesh && o.skeleton && o.userData && o.userData.ownsMaterial) { try { o.skeleton.dispose(); } catch (e) { /* ignore */ } }
      if (o.userData && o.userData.ownsMaterial && o.material) {
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      }
    });
    if (this.shadow) this.shadow.material.dispose();
  }
}
