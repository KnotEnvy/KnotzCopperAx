// Combatant: shared base for heroes, humanoid enemies and bosses. Adds to Actor:
//   - a model + Animator (+ weapon sockets), hit flash, invulnerability blink
//   - move execution (startMove / attack state) using MoveRunner frame data
//   - the reaction states every fighter shares: hitstun, knockdown (airborne/juggle), down, getup, dead
//   - the CombatSystem target contract: hurtable, canBeHit(ev), hurtboxes(), receiveHit(ev)
// Subclasses (Hero, Enemy) define locomotion states ('idle' is required) and their controllers.
import * as THREE from 'three';
import { Actor } from '../core/Actor.js';
import { Animator } from '../anim/Animator.js';
import { MoveRunner } from './MoveRunner.js';
import { EV } from '../core/EventBus.js';
import { boxFrom } from '../core/aabb.js';
import { DEPTH_TOL } from '../core/config.js';

const _flashColor = new THREE.Color();
const _rollQ = new THREE.Quaternion();
const _Z = new THREE.Vector3(0, 0, 1);

export class Combatant extends Actor {
  /**
   * @param {import('../core/Game.js').Game} game
   * @param {object} opts  Actor opts + { model: {root,...} from AssetLoader, moves: {id: MoveDef}, character, def }
   */
  constructor(game, opts = {}) {
    super(game, opts);
    this.def = opts.def || {};
    this.moves = opts.moves || {};
    this.hurtable = true;
    this.attack = null;       // current MoveRunner
    this.moveId = null;
    this.juggle = 0;
    this.downTicks = opts.downTicks ?? 44;
    this.otgTicks = 0;
    this.getupInvuln = opts.getupInvuln ?? 24;
    this.weight = opts.weight ?? 1;        // knockback resistance multiplier (bigger = heavier)
    this.superArmor = 0;                   // hits with damage < superArmor don't interrupt
    this.lastHitBy = null;
    this.damageTaken = 0;
    this._flash = { t: 0, dur: 1, color: new THREE.Color(1, 1, 1), strength: 1 };
    this.blink = 0;
    /** Whole-body roll about world Z (radians, pivot at mid-height): held/thrown foes lie flat and tumble. */
    this.roll = 0;

    this.model = opts.model || null;
    this.animator = null;
    this.flashMaterials = [];
    if (this.model) this.setModel(this.model, opts.character);

    this.fsm.define(reactionStates());
  }

  setModel(model, character) {
    if (this.modelRoot) this.body.remove(this.modelRoot);
    this.model = model;
    this.modelRoot = model.root;
    this.body.add(model.root);
    this.flashMaterials = [];
    model.root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (m && m.emissive && !this.flashMaterials.includes(m)) { this.flashMaterials.push(m); m.userData.baseEmissive = m.emissive.clone(); m.userData.baseEmissiveIntensity = m.emissiveIntensity; }
        }
      }
    });
    if (this.game.anim) this.animator = new Animator(model.root, { library: this.game.anim, rig: model.rig || 'humanoid', character });
    if (this.animator) {
      this.animator.on('*', (e) => this.onAnimEvent(e));
    }
  }

  /** Animation events → bus (footsteps, body falls, swing whooshes). */
  onAnimEvent(e) {
    if (e.name === 'footstep') this.game.bus.emit(EV.FOOTSTEP, { actor: this, foot: e.foot, pos: this.pos });
    else if (e.name === 'bodyfall') this.game.bus.emit(EV.LAND, { actor: this, pos: this.pos, speed: 6, body: true });
  }

  play(name, o) { return this.animator ? this.animator.play(name, o) : false; }

  // ------------------------------------------------------------ moves
  /** Start a move by id (from this.moves). Returns the runner or null. */
  startMove(id, { target = null } = {}) {
    const def = this.moves[id];
    if (!def) return null;
    this.attack = new MoveRunner(this, id, def);
    this.attack.target = target;
    this.moveId = id;
    if (def.gravity !== undefined) this.gravityScale = def.gravity;
    const total = this.attack.total;
    this.play(def.anim || id, { restart: true, fade: def.animFade ?? 0.05, duration: total / 60, loop: false, fallback: def.animFallback || ['light_1'] });
    this.fsm.go('attack', { id });
    this.game.bus.emit(EV.ATTACK_START, { actor: this, move: def, moveId: id });
    this.attack.tick(1 / 60); // frame 0 runs on the start tick
    return this.attack;
  }

  endMove() {
    if (this.attack && this.attack.armored) this.superArmor = 0;
    this.attack = null;
    this.moveId = null;
    this.gravityScale = 1;
  }

  // ------------------------------------------------------------ CombatSystem target contract
  canBeHit(ev) {
    if (!this.alive || this.removed || this.invuln > 0) return false;
    if (this.fsm.is('down')) return !!(ev.otg && this.otgTicks > 0);
    if (this.fsm.is('getup', 'dead')) return false;
    return true;
  }

  hurtboxes() {
    const s = this.fsm.name;
    if (s === 'down' || s === 'dead') {
      boxFrom(this._hurtBox, this.pos.x - this.facing * this.height * 0.2, this.pos.y, this.pos.z, this.height * 0.95, 0.4, DEPTH_TOL * 1.1);
      return this._hurtList;
    }
    return super.hurtboxes();
  }

  /** Apply an incoming HitEvent. Return false to reject (i-frames etc.). */
  receiveHit(ev) {
    const w = ev.hit;
    this.lastHitBy = ev.attacker;
    // def.minHp (training dummy) and godMode (__KCA.debug.god) keep the target alive.
    const floor = (this.def.minHp || this.godMode) ? Math.max(1, this.def.minHp || 1) : 0;
    this.hp = Math.max(floor, this.hp - ev.damage);
    this.damageTaken += ev.damage;
    ev.killed = this.hp <= 0;
    this.flash(ev.level === 'magic' ? '#ffd9a0' : '#fff4e8', 4, ev.level === 'heavy' ? 0.8 : 0.5);
    if (ev.killed) this.alive = false;
    if (!ev.killed && this.superArmor > 0 && ev.damage < this.superArmor && !w.knockdown) return true;
    // Clinch strikes (hit data `hold: true`) keep a grabbed victim in the thrower's hands: flinch only.
    if (!ev.killed && w && w.hold && this.fsm.is('grabbed')) { this.play(w.reaction || 'hit_high', { restart: true, fade: 0.04, duration: 0.3 }); return true; }
    const airborne = !this.grounded || this.fsm.is('knockdown');
    if (this.attack) this.endMove();
    if (ev.attacker && this.grounded) this.facing = -ev.dir || this.facing;
    if (ev.killed || ev.knockdown || ev.launch > 0 || airborne) this.fsm.go('knockdown', ev);
    else this.fsm.go('hitstun', ev);
    return true;
  }

  // ------------------------------------------------------------ visuals
  flash(color = '#ffffff', ticks = 4, strength = 1.5) {
    const f = this._flash;
    f.t = ticks; f.dur = ticks; f.color.set(color); f.strength = strength;
  }

  update(dt) {
    super.update(dt);
    if (this.animator) this.animator.tick(dt);
    if (this._flash.t > 0) this._flash.t--;
    if (this.otgTicks > 0) this.otgTicks--;
    if (this.blink > 0) this.blink--;
    if (this.roll && !this.fsm.is('grabbed', 'thrown')) { this.roll *= 0.72; if (Math.abs(this.roll) < 0.01) this.roll = 0; }
  }

  onHitstopTick() { if (this._flash.t > 0 && this.hitstop <= 1) this._flash.t--; }

  render(alpha, frameDt) {
    super.render(alpha, frameDt);
    if (this.roll || this._rolled) {
      const b = this.body, H = (this.height || 1.8) * 0.5, r = this.roll;
      b.rotation.set(0, this.visualYaw, 0);
      if (r) { _rollQ.setFromAxisAngle(_Z, r); b.quaternion.premultiply(_rollQ); }
      b.position.x += H * Math.sin(r); b.position.y = H * (1 - Math.cos(r));
      this._rolled = !!r;
    }
    if (this.animator) {
      const vis = this.localTime + (this.hitstop > 0 ? 0 : alpha * (1 / 60));
      this.animator.render(vis);
    }
    const f = this._flash;
    const k = f.t > 0 ? (f.t / f.dur) * f.strength : 0;
    for (const m of this.flashMaterials) {
      if (k > 0) { _flashColor.copy(f.color).multiplyScalar(k); m.emissive.copy(_flashColor); m.emissiveIntensity = 1; }
      else if (m.userData.flashing) { m.emissive.copy(m.userData.baseEmissive); m.emissiveIntensity = m.userData.baseEmissiveIntensity; }
      m.userData.flashing = k > 0;
    }
    if (this.modelRoot) this.modelRoot.visible = this.blink > 0 ? (Math.floor(this.blink / 3) % 2 === 0) : true;
  }

  dispose() {
    super.dispose();
    if (this.animator) this.animator.dispose();
  }
}

/** Shared reaction states (Hero and Enemy both install these via Combatant). */
export function reactionStates() {
  return {
    attack: {
      tags: ['busy'],
      update(a, dt) {
        const run = a.attack;
        if (!run) return 'idle';
        if (run.def.air || !a.grounded) {
          if (a.landedThisTick && (run.def.endOnLand !== false)) {
            const li = run.def.landInto || 'land';
            a.endMove();
            if (a.moves[li] && !a.fsm.has(li)) { // land into a MOVE (e.g. an air slam's shockwave)
              a.game.bus.emit(EV.LAND, { actor: a, pos: a.pos, speed: Math.max(a.lastLandSpeed || 0, 9), slam: true });
              a.startMove(li);
              return undefined;
            }
            return a.fsm.has(li) ? li : 'idle';
          }
        }
        if (a.onAttackTick) { const r = a.onAttackTick(run, dt); if (r) return r; }
        if (a.attack !== run) return undefined; // controller chained into a new move
        run.tick(dt);
        if (run.done) {
          a.endMove();
          if (!a.grounded) return a.fsm.has('fall') ? 'fall' : 'idle';
          return 'idle';
        }
        return undefined;
      },
      // Leaving the attack state ends the move (a stale runner would keep its hit windows live), except a run the
      // controller paused on purpose (Hero heavy charge sets run.paused and resumes it with go('attack')).
      exit(a, next) { if (next !== 'attack' && a.attack && !a.attack.paused) a.endMove(); },
    },
    hitstun: {
      tags: ['stunned'],
      enter(a, ev) {
        a.stunTicks = Math.max(6, ev ? ev.hitstun : 14);
        const kb = ev ? ev.knockback / a.weight : 1.5;
        a.vel.x = (ev ? ev.dir : -a.facing) * kb;
        a.vel.z = 0;
        a.play(ev && ev.hit && ev.hit.reaction ? ev.hit.reaction : 'hit_high', { restart: true, fade: 0.04, duration: Math.min(0.5, a.stunTicks / 60 + 0.1) });
      },
      update(a, dt) {
        a.friction(7, dt);
        if (--a.stunTicks <= 0) return 'idle';
        return undefined;
      },
    },
    knockdown: {
      tags: ['stunned', 'air'],
      enter(a, ev) {
        a.solid = false; // C2 r1 (heroes-anim, additive): a flying/floored body never shoves a hero who lands on it (Death Stab)
        a.juggle++;
        const kb = ev ? Math.max(ev.knockback, ev.killed ? 3.8 : 3) / a.weight : 3;
        const launch = ev && ev.launch > 0 ? ev.launch : (ev && ev.killed ? 6.5 : 5.2);
        a.vel.x = (ev ? ev.dir : -a.facing) * kb;
        a.vel.y = launch / Math.sqrt(a.weight) * (1 / (1 + (a.juggle - 1) * 0.18));
        a.vel.z = 0;
        a.grounded = false;
        a.pos.y = Math.max(a.pos.y, 0.02);
        a.gravityScale = 1 + (a.juggle - 1) * 0.12;
        a.bounced = false;
        // Ground bounce (air slam, MoveDef hit `bounce`): spike the victim into the floor; knockdown.update rebounds it.
        a.groundBounce = ev && ev.hit && ev.hit.bounce > 0 ? ev.hit.bounce / Math.sqrt(a.weight) * (1 / (1 + (a.juggle - 1) * 0.18)) : 0;
        if (a.groundBounce) { a.vel.y = -Math.max(9, Math.abs(a.vel.y)); a.vel.x *= 0.35; }
        a.play(ev && ev.killed ? 'death' : 'knockdown', { restart: true, fade: 0.05, fallback: ['knockdown', 'hit_high'] });
        a.bounceWalls = true;
        a.game.bus.emit(EV.KNOCKDOWN, { actor: a, by: ev ? ev.attacker : null });
      },
      update(a) {
        if (a.landedThisTick) {
          if (a.groundBounce > 0) {
            a.vel.y = a.groundBounce; a.groundBounce = 0; a.bounced = true; a.grounded = false;
            a.game.bus.emit(EV.LAND, { actor: a, pos: a.pos, speed: Math.max(8, a.lastLandSpeed), body: true, bounce: true });
            return undefined;
          }
          if (!a.bounced && a.lastLandSpeed > 5.5) {
            a.bounced = true;
            a.vel.y = a.lastLandSpeed * 0.28; a.vel.x *= 0.5; a.grounded = false;
            a.game.bus.emit(EV.LAND, { actor: a, pos: a.pos, speed: a.lastLandSpeed, body: true });
            return undefined;
          }
          a.game.bus.emit(EV.LAND, { actor: a, pos: a.pos, speed: a.lastLandSpeed, body: true });
          return 'down';
        }
        return undefined;
      },
      exit(a) { a.gravityScale = 1; a.bounceWalls = false; a.solid = true; },
    },
    down: {
      tags: ['down'],
      enter(a) {
        a.solid = false; // C2 r1 (heroes-anim, additive): see knockdown — restored on exit (getup) or kept off by 'dead'
        a.downTimer = a.alive ? a.downTicks : 30;
        a.otgTicks = 30;
        a.vel.x *= 0.3;
        a.play(a.alive ? 'down_loop' : 'death', { fade: 0.18, fallback: ['down_loop', 'knockdown'] });
      },
      update(a, dt) {
        a.friction(9, dt);
        if (--a.downTimer <= 0) return a.alive ? 'getup' : 'dead';
        return undefined;
      },
      exit(a) { a.juggle = 0; a.solid = !!a.alive; },
    },
    /** Held by a thrower (Hero 'clinch'/'throw' states write our position every tick). data: { by } */
    grabbed: {
      tags: ['stunned', 'grabbed'],
      enter(a, data) {
        if (a.attack) a.endMove();
        a.grabbedBy = data && data.by; a.grabTicks = 0;
        a.solid = false; a.gravityScale = 0; a.vel.set(0, 0, 0);
        if (a.grabbedBy) a.facing = -a.grabbedBy.facing;
        a.play('grabbed', { restart: true, fade: 0.06, fallback: ['hit_high'] });
      },
      update(a) {
        a.vel.set(0, 0, 0);
        const by = a.grabbedBy;
        // Thrower interrupted / gone → drop to the floor.
        if (++a.grabTicks > 150 || !by || by.removed || !by.alive || !by.fsm.is('throw', 'clinch')) return 'knockdown';
        return undefined;
      },
      exit(a) { a.solid = true; a.gravityScale = 1; a.grabbedBy = null; },
    },
    /** Flung by a throw: damages its own team on contact, takes the throw damage on landing. data: { by, dir, def, moveId } */
    thrown: {
      tags: ['stunned', 'air', 'thrown'],
      enter(a, data) {
        const d = (data && data.def) || {};
        const fl = d.fling || {};
        a.thrownBy = data && data.by; a.thrownDef = d; a.thrownDir = (data && data.dir) || 1;
        a.thrownMove = (data && data.moveId) || 'throw';
        a.thrownHit = new Set([a.id]);
        a.vel.set(a.thrownDir * (fl.speed ?? 9) / Math.sqrt(a.weight), fl.vy ?? 5.5, 0);
        a.grounded = false; a.pos.y = Math.max(a.pos.y, 0.05);
        a.facing = -a.thrownDir;
        a.solid = false; a.hurtable = false; a.bounceWalls = true; a.gravityScale = 1;
        a.play('knockdown', { restart: true, fade: 0.05, fallback: ['hit_high'] });
      },
      update(a, dt) {
        const g = a.game, d = a.thrownDef || {};
        if (!a.thrownHit) a.thrownHit = new Set(); // entered without a throw setup (seen in stage 4 playthrough)
        a.roll = Math.max(-2.4, Math.min(2.4, a.roll - a.thrownDir * 7 * dt)); // head-first tumble
        // Bowling: every foe of the victim's own team it passes through takes the impact hit.
        if (g.combat) for (const o of g.world.query({ team: a.team })) {
          if (a.thrownHit.has(o.id) || !o.hurtable || !o.alive || o.removed) continue;
          if (Math.abs(o.pos.x - a.pos.x) > (a.radius || 0.4) + (o.radius || 0.4) + 0.3) continue;
          if (Math.abs(o.pos.z - a.pos.z) > DEPTH_TOL || a.pos.y > o.pos.y + (o.height || 1.8) * 0.9) continue;
          a.thrownHit.add(o.id);
          const dir = Math.sign(a.vel.x) || a.thrownDir;
          g.combat.applyHit(a.thrownBy, o, { damage: 8, knockback: 5, launch: 5, knockdown: true, hitstop: 7, hitstun: 26, level: 'heavy', shake: 0.3, ...(d.impact || {}) }, { moveId: 'throw_impact', dir });
          a.vel.x *= 0.75;
        }
        if (a.landedThisTick) {
          a.hurtable = true; a.solid = true;
          const ok = g.combat && a.alive && g.combat.applyHit(a.thrownBy, a, { damage: d.damage ?? 8, knockback: 2.2, launch: 3.4, knockdown: true, hitstop: 5, hitstun: 24, level: 'heavy', otg: true, shake: 0.32 }, { moveId: a.thrownMove, dir: Math.sign(a.vel.x) || a.thrownDir });
          g.bus.emit(EV.LAND, { actor: a, pos: a.pos, speed: Math.max(7, a.lastLandSpeed), body: true });
          if (!ok) return 'down';
        }
        return undefined;
      },
      exit(a) { if (a.alive) a.hurtable = true; a.solid = true; a.bounceWalls = false; a.thrownHit = null; },
    },
    getup: {
      tags: ['invuln'],
      enter(a) {
        a.invuln = Math.max(a.invuln, a.getupInvuln + 12);
        a.getupTimer = a.getupTicks ?? 30;
        a.play('getup', { restart: true, fade: 0.1, duration: 0.5, fallback: ['idle'] });
        a.game.bus.emit(EV.GETUP, { actor: a });
      },
      update(a) { if (--a.getupTimer <= 0) return 'idle'; return undefined; },
    },
    dead: {
      tags: ['dead'],
      enter(a) {
        a.alive = false;
        a.hurtable = false;
        a.solid = false;
        a.deadTimer = 0;
        if (a.onDeath) a.onDeath();
      },
      update(a) {
        a.deadTimer++;
        if (a.removeOnDeath !== false) {
          if (a.deadTimer > 30) a.blink = Math.max(a.blink, 2);
          if (a.deadTimer > 70) a.remove();
        }
        return undefined;
      },
    },
  };
}
