// Hero: a player-controlled Combatant. Reads a PlayerInput (keyboard / gamepad / bot / test hook — all the
// same path) and drives locomotion + the moveset (DESIGN.md §3):
//   8-way belt movement · double-tap run · jump (+ air control) · light string (continues only on hit; close
//   branch → pommel/pommel/finisher, range branch → finisher) · heavy · run (dash) attack · jump attack ·
//   run-jump attack · Death Stab (dash → jump → Light near the apex) · back attack (Light+Jump) ·
//   dodge roll with i-frames + perfect dodge slow-mo · magic (tap = spend all pots, hold = pick a lower tier) ·
//   heavy hold-to-charge (3 levels, MoveDef.charge) · air Heavy = ground-bouncing slam (air_slam → air_slam_land) ·
//   close-string THROW (pommel_2 + Light while holding ←/→, cond 'aim' → the 'throw' state; kind:'throw' MoveDef) ·
//   walk-in grab ('clinch': walk into a stunned foe, or push into a standing one) → knees → aimed THROW
// Frame data is authoritative in characters/movesets/<id>.js (format: combat/MoveRunner.js, docs/ENGINE_API.md).
// Extend by adding states with hero.fsm.define({...}) or by subclassing (def.heroClass); the controller hooks are
// chooseGroundMove / chooseAirMove / cancelAllowed.
import { Combatant } from '../combat/Combatant.js';
import { GRAVITY, DEPTH_TOL } from '../core/config.js';
import { EV } from '../core/EventBus.js';
import { BUFFER_TICKS } from '../core/Input.js';

/** Hold Magic longer than this (ticks) to enter tier selection instead of a tap (spend-all) cast. */
export const MAGIC_TAP_TICKS = 14;
/** While holding Magic, the selected tier steps down every this many ticks. */
export const MAGIC_STEP_TICKS = 20;
/** Perfect dodge: an attack that would have connected within this many ticks of the dodge start. */
export const PERFECT_DODGE_TICKS = 6;
/** Default heavy charge: hold ticks (after the charge starts) for levels 1..3, auto-release, and hit scaling. */
export const CHARGE_DEFAULTS = Object.freeze({
  at: 8, levels: [18, 42, 72], max: 150,
  scale: [
    { damage: 1.3, knockback: 1.15, launch: 1.05, hitstop: 2, shake: 1.2 },
    { damage: 1.65, knockback: 1.3, launch: 1.15, hitstop: 4, shake: 1.45 },
    { damage: 2.2, knockback: 1.55, launch: 1.3, hitstop: 6, shake: 1.8, guardBreak: true },
  ],
});
const CHARGE_COLORS = ['#ffe2a8', '#ffb25a', '#fff6e0'];
/** Ticks (unfrozen) from the killing blow to PLAYER_DOWN (respawn / CONTINUE?), while the body is still settling. */
export const DEATH_BEAT_TICKS = 42;
/** Walk-in grab (clinch): ticks of walking into a standing foe before grabbing it (a stunned foe: CLINCH_STUN_TICKS). */
export const CLINCH_PUSH_TICKS = 12;
export const CLINCH_STUN_TICKS = 2;
/** Clinch defaults (override per hero with a `clinch` entry in the moveset: { hold, knees, knee: hitData, anim }). */
export const CLINCH_DEFAULTS = Object.freeze({
  hold: 90, knees: 2, cool: 11, anim: 'grab', kneeAnim: 'knee',
  knee: { damage: 3, hitstun: 22, knockback: 0, hitstop: 5, level: 'light', hold: true, shake: 0.12, reaction: 'hit_high' },
});

export class Hero extends Combatant {
  /**
   * @param {import('../core/Game.js').Game} game
   * @param {object} def     hero definition (characters/heroes/<id>.js)
   * @param {object} model   AssetLoader character result
   * @param {object} moveset movesets/<id>.js default export
   * @param {object} opts    { x, z, facing, playerIndex, input, pots }
   */
  constructor(game, def, model, moveset, opts = {}) {
    const st = def.stats || {};
    super(game, {
      kind: 'hero', typeId: def.id, team: 'players', def, model, character: def.id,
      moves: (moveset && moveset.moves) || {},
      x: opts.x, z: opts.z, facing: opts.facing ?? 1,
      hp: st.hp ?? 48, radius: st.radius ?? 0.36, height: def.height ?? 1.8,
      boundsMode: 'screen', weight: st.weight ?? 1, mass: 2,
    });
    this.playerIndex = opts.playerIndex ?? 0;
    this.input = opts.input || game.input.players[this.playerIndex];
    this.stats = {
      walk: 3.2 * (st.speed ?? 1), run: 7.0 * (st.speed ?? 1), depth: st.depthSpeed ?? 0.72,
      jumpVel: Math.sqrt(2 * GRAVITY * (st.jumpApex ?? 2.1)), airControl: st.airControl ?? 4, accel: st.accel ?? 38,
      closeRange: st.closeRange ?? 0.95,
    };
    /** Incoming damage multiplier (DESIGN §7: Gorrim ×0.85, Seraphine ×1.1). CombatSystem applies it. */
    this.damageTakenMul = st.defense ?? 1;
    if (st.hurt) Object.assign(this.hurt, st.hurt);
    this.hurt.d = st.hurtDepth ?? DEPTH_TOL;
    // Magic pots + uneven tier thresholds (DESIGN §2). tiers[i] = pots needed for tier i+1.
    const mg = def.magic || {};
    this.tierThresholds = mg.tiers || [1, 2, 3];
    this.maxPots = mg.pots ?? this.tierThresholds[this.tierThresholds.length - 1];
    this.maxTier = this.tierThresholds.length;
    this.pots = Math.min(this.maxPots, opts.pots ?? 0);
    this.removeOnDeath = false;
    /** Global ticks this hero spent frozen in hitstop (recent only): presses don't age while frozen. */
    this._frozenTicks = [];
    this.runJump = false;
    this.fsm.define(heroStates());
    this.fsm.go('idle');
  }

  // ------------------------------------------------------------ magic pots
  /** Tier reachable with `pots` (0 = none). */
  magicTier(pots = this.pots) { let t = 0; for (const th of this.tierThresholds) if (pots >= th) t++; return t; }
  /** Pots spent by a HOLD cast of `tier` (the tier's threshold). */
  tierCost(tier) { return this.tierThresholds[Math.max(0, Math.min(this.maxTier, tier) - 1)] ?? 0; }
  addPots(n = 1) { this.pots = Math.max(0, Math.min(this.maxPots, this.pots + n)); return this.pots; }
  /** Force a cast (debug/showcase): tops pots up to the tier's cost, then casts that tier (spending its cost). */
  castMagic(tier = this.magicTier() || 1) {
    const t = Math.max(1, Math.min(this.maxTier, tier));
    this.pots = Math.max(this.pots, this.tierCost(t));
    this.endMove();
    this.fsm.go('magic', { tier: t, cost: this.tierCost(t) });
  }

  // ------------------------------------------------------------ input helpers
  /** Buffer window for `action`: 8 ticks (DESIGN §8) plus every tick this hero was frozen in hitstop since the press. */
  bufferWindow(action) {
    const since = this.input.pressTick[action];
    let extra = 0;
    for (let i = this._frozenTicks.length - 1; i >= 0 && this._frozenTicks[i] >= since; i--) extra++;
    return BUFFER_TICKS + extra;
  }
  /** Consume a buffered press (hitstop time doesn't eat the buffer window). */
  take(action) { return this.input.consume(action, this.bufferWindow(action)); }
  has(action) { return this.input.buffered(action, this.bufferWindow(action)); }
  moveDir() { return { x: this.input.moveX(), z: this.input.moveZ() }; }

  onHitstopTick() {
    super.onHitstopTick();
    this._frozenTicks.push(this.game.tick);
    if (this._frozenTicks.length > 90) this._frozenTicks.splice(0, 30);
  }

  /** Face the held horizontal direction (used when a move starts, classic turnaround). */
  faceInput() { const x = this.input.moveX(); if (x) this.facing = x; }

  /** Can `v` be grabbed and thrown with throw move `def`? (bosses, riders and heavies over maxWeight cannot) */
  canThrow(v, def = {}) {
    return !!(v && v.alive && !v.removed && v.hurtable && v.grounded && v.fsm && v.fsm.has('grabbed') && !v.mountedOn
      && !v.fsm.is('down', 'knockdown', 'getup', 'dead', 'grabbed', 'thrown') && v.kind !== 'boss'
      && (v.def && v.def.throwable) !== false && (v.weight ?? 1) <= (def.maxWeight ?? 1.6));
  }

  /** Close-string throw: grab the foe the string is hitting (or the closest one) and fling it along the held direction. */
  startThrow(id, run = null) {
    const def = this.moves[id];
    if (!def) return false;
    let v = run && run.lastTarget;
    if (!this.canThrow(v, def)) v = this.foeClose();
    if (!this.canThrow(v, def)) return false;
    const aim = Math.sign(this.input.moveX()) || this.facing;
    this.endMove();
    this.fsm.go('throw', { id, victim: v, dir: aim });
    return true;
  }

  /** Walk-in grab: walking into a stunned foe (or pushing into a grabbable, non-attacking one) clinches it. */
  tryClinch(d) {
    const td = this.moves.throw;
    if (!td || td.kind !== 'throw' || this.mountedOn || !d.x || !this.grounded) { this._clinchPush = 0; return false; }
    const v = this.foeClose();
    const contact = v && Math.sign(v.pos.x - this.pos.x) === d.x
      && Math.abs(v.pos.x - this.pos.x) <= (this.radius || 0.36) + (v.radius || 0.4) + 0.24;
    // A foe mid-swing can't be grabbed, except early in its windup (walking in beats a slow wind-up).
    const swinging = !!v && v.fsm.is('attack') && !(v.attack && v.attack.frame < (v.attack.def.startup || 0) - 4 && !v.superArmor);
    if (!contact || !this.canThrow(v, td) || swinging) { this._clinchPush = 0; return false; }
    this._clinchPush = (this._clinchPush || 0) + 1;
    if (this._clinchPush < (v.fsm.is('hitstun') ? CLINCH_STUN_TICKS : CLINCH_PUSH_TICKS)) return false;
    this._clinchPush = 0;
    this.fsm.go('clinch', { victim: v });
    return true;
  }

  /** Nearest standing foe in front within grab/pommel range (drives the close branch of the light string). */
  foeClose() {
    const r = this.stats.closeRange;
    for (const e of this.game.world.query({ team: 'enemies' })) {
      if (!e.hurtable || (e.fsm && e.fsm.is('down', 'knockdown'))) continue;
      const dx = (e.pos.x - this.pos.x) * this.facing;
      if (dx > -0.1 && dx <= r && Math.abs(e.pos.z - this.pos.z) <= DEPTH_TOL) return e;
    }
    return null;
  }

  // ------------------------------------------------------------ CombatSystem contract
  canBeHit(ev) {
    // Perfect dodge: the attack would have connected just after the dodge started → slow-mo reward.
    if (this.fsm.is('dodge') && !this.perfectDodged && this.fsm.ticks <= PERFECT_DODGE_TICKS + 2 && ev.attacker && ev.attacker !== this) {
      this.perfectDodged = true;
      this.game.slowmo(0.3, 0.6, { out: 0.2 });
      this.game.bus.emit(EV.DODGE, { actor: this, perfect: true, by: ev.attacker });
    }
    return super.canBeHit(ev);
  }

  // ------------------------------------------------------------ move selection (override points)
  /** Ground move from neutral/walk/land states. Returns true if a move/state started. */
  chooseGroundMove() {
    if (this.has('light') && this.has('jump') && this.moves.back_attack && !this.mountedOn) { this.take('light'); this.take('jump'); this.startMove('back_attack'); return true; }
    if (this.take('magic')) { if (this.pots > 0 && this.game.magic) { this.fsm.go('magicSelect'); return true; } }
    if (this.take('dodge')) { this.fsm.go('dodge'); return true; }
    if (this.take('light')) { this.faceInput(); this.startMove('light_1'); return true; }
    if (this.take('heavy') && this.moves.heavy) { this.faceInput(); this.startMove('heavy'); return true; }
    if (this.take('jump')) { this.fsm.go('jump', { run: false }); return true; }
    return false;
  }

  chooseAirMove() {
    // Heavy in the air = ground-bouncing slam (DESIGN §3). Not while riding.
    if (this.moves.air_slam && !this.mountedOn && this.has('heavy') && this.pos.y > 0.35) { this.take('heavy'); this.startMove('air_slam'); return true; }
    if (this.take('light') || this.take('heavy')) {
      let id = 'jump_attack';
      if (this.runJump) id = this.moves.death_stab && !this.mountedOn && Math.abs(this.vel.y) < 3.2 ? 'death_stab' : 'run_jump_attack';
      if (!this.moves[id]) id = 'jump_attack';
      if (this.moves[id]) { this.startMove(id); return true; }
    }
    return false;
  }

  /** Extra cancel conditions (MoveDef cancels[].cond). */
  cancelAllowed(c) {
    if (c.cond === 'close') return !!this.foeClose();
    if (c.cond === 'far') return !this.foeClose();
    if (c.cond === 'air') return !this.grounded;
    if (c.cond === 'ground') return this.grounded;
    if (c.cond === 'aim') return this.input.moveX() !== 0; // holding ← or → (throw aim)
    return true;
  }

  /** Called every attack tick before the runner advances: cancels + buffered strings. */
  onAttackTick(run) {
    // Hold-to-charge: still holding the button when the move reaches `charge.at` → pause into 'charge'.
    const ch = run.def.charge;
    if (ch && !run.charged && run.frame === (ch.at ?? CHARGE_DEFAULTS.at) - 1 && this.input.isDown(run.def.chargeButton || 'heavy')) {
      run.charged = true; run.paused = true; // paused: leaving 'attack' for 'charge' keeps the run
      this.fsm.go('charge', { run });
      return 'charge'; // stop attack.update from ticking the paused runner this tick
    }
    for (const c of run.cancelsNow()) {
      if (!this.has(c.on)) continue;
      if (c.cond && !this.cancelAllowed(c)) continue;
      this.take(c.on);
      if (c.into === '@dodge') { this.endMove(); this.fsm.go('dodge'); return 'dodge'; }
      if (c.into === '@jump') { this.endMove(); this.fsm.go('jump', { run: false }); return 'jump'; }
      if (c.into === '@idle') { this.endMove(); return 'idle'; }
      const into = this.moves[c.into];
      if (into && into.kind === 'throw') { if (this.startThrow(c.into, run)) return undefined; continue; } // nothing throwable → next cancel (kick)
      if (into) { if (c.turn !== false) this.faceInput(); this.startMove(c.into); return undefined; }
    }
    return undefined;
  }

  // ------------------------------------------------------------ pickups / respawn
  heal(n) { this.hp = Math.min(this.maxHp, this.hp + n); }

  respawn({ x, z, fromSky = true } = {}) {
    this.hp = this.maxHp;
    this.alive = true; this.hurtable = true; this.solid = true; this.removed = false;
    if (x !== undefined) this.pos.x = x;
    if (z !== undefined) this.pos.z = z;
    this.pos.y = fromSky ? 6 : 0; this.grounded = !fromSky;
    this.vel.set(0, 0, 0);
    this.prevPos.copy(this.pos);
    this.invuln = 150; this.blink = 150;
    this.endMove();
    this.fsm.go(fromSky ? 'fall' : 'idle');
  }

  onDeath() { this.deathTicks = 0; }

  update(dt) {
    super.update(dt);
    // Short dead beat: PLAYER_DOWN fires DEATH_BEAT_TICKS after the killing blow, whatever state the body is in.
    if (this.alive) { this._downTicks = 0; this._downSent = false; }
    else if (!this._downSent && ++this._downTicks >= DEATH_BEAT_TICKS) {
      this._downSent = true;
      this.game.bus.emit(EV.PLAYER_DOWN, { player: this.playerIndex, hero: this });
    }
  }
}

function heroStates() {
  const loco = (h, dt, speedX, speedZ) => {
    const d = h.moveDir();
    const tx = d.x * speedX, tz = d.z * speedZ;
    const acc = h.stats.accel * dt;
    h.vel.x += Math.max(-acc, Math.min(acc, tx - h.vel.x));
    h.vel.z += Math.max(-acc, Math.min(acc, tz - h.vel.z));
    if (d.x) h.facing = d.x;
    return d;
  };
  return {
    idle: {
      enter(h) { h.play('idle', { fade: 0.18 }); },
      update(h, dt) {
        h.friction(14, dt);
        if (!h.grounded) return 'fall';
        if (h.chooseGroundMove()) return undefined;
        if (h.input.runDir) return 'run';
        const d = h.moveDir();
        if (d.x || d.z) return 'walk';
        return undefined;
      },
    },
    walk: {
      enter(h) { h.play('walk', { fade: 0.14 }); },
      update(h, dt) {
        if (!h.grounded) return 'fall';
        if (h.chooseGroundMove()) return undefined;
        if (h.input.runDir) return 'run';
        const d = loco(h, dt, h.stats.walk, h.stats.walk * h.stats.depth);
        if (h.tryClinch(d)) return undefined;
        // Cadence matched to ground speed, normalized by leg length so short heroes take quicker steps.
        if (h.animator) h.animator.setSpeed(Math.max(0.5, Math.hypot(h.vel.x, h.vel.z) / h.stats.walk) * (1.95 / (h.height || 1.8)) ** 0.5);
        if (!d.x && !d.z) return 'idle';
        return undefined;
      },
    },
    run: {
      enter(h) { h.play('run', { fade: 0.1 }); h.runDir = h.input.runDir || h.facing; h.facing = h.runDir; },
      update(h, dt) {
        if (!h.grounded) return 'fall';
        if (h.input.runDir !== h.runDir) return h.moveDir().x || h.moveDir().z ? 'walk' : 'idle';
        if (h.take('light') || h.take('heavy')) { if (h.moves.run_attack) { h.startMove('run_attack'); return undefined; } }
        if (h.take('jump')) { h.fsm.go('jump', { run: true }); return undefined; }
        if (h.take('dodge')) { h.fsm.go('dodge'); return undefined; }
        const d = h.moveDir();
        if (h.tryClinch({ x: h.runDir, z: d.z })) return undefined; // ran into a foe and kept pushing → clinch
        h.vel.x += (h.runDir * h.stats.run - h.vel.x) * Math.min(1, 12 * dt);
        h.vel.z += (d.z * h.stats.walk * 0.5 - h.vel.z) * Math.min(1, 10 * dt);
        return undefined;
      },
    },
    jump: {
      tags: ['air'],
      enter(h, data) {
        h.runJump = !!(data && data.run);
        h.vel.y = h.stats.jumpVel * (h.runJump ? 0.92 : 1);
        if (h.runJump) h.vel.x = h.facing * h.stats.run * 0.95; // dash → jump = the long leap
        h.grounded = false;
        h.play('jump_up', { restart: true, fade: 0.06 });
        h.game.bus.emit(EV.JUMP, { actor: h, run: h.runJump });
      },
      update(h, dt) {
        if (h.landedThisTick) return 'land';
        if (h.chooseAirMove()) return undefined;
        const d = h.moveDir();
        if (!h.runJump) {
          h.vel.x += (d.x * h.stats.walk - h.vel.x) * Math.min(1, h.stats.airControl * dt);
          if (d.x) h.facing = d.x;
        }
        h.vel.z += (d.z * h.stats.walk * h.stats.depth - h.vel.z) * Math.min(1, h.stats.airControl * dt);
        if (h.vel.y < 0 && h.animator && h.animator.name !== 'jump_fall') h.play('jump_fall', { fade: 0.2 });
        return undefined;
      },
    },
    fall: {
      tags: ['air'],
      enter(h) { h.play('jump_fall', { fade: 0.15 }); },
      update(h, dt) {
        if (h.grounded || h.landedThisTick) return 'land';
        if (h.chooseAirMove()) return undefined;
        const d = h.moveDir();
        h.vel.x += (d.x * h.stats.walk - h.vel.x) * Math.min(1, h.stats.airControl * dt);
        h.vel.z += (d.z * h.stats.walk * h.stats.depth - h.vel.z) * Math.min(1, h.stats.airControl * dt);
        return undefined;
      },
    },
    land: {
      enter(h) {
        h.landTimer = 5;
        h.play('land', { restart: true, fade: 0.04, duration: 0.24 });
        h.game.bus.emit(EV.LAND, { actor: h, pos: h.pos, speed: h.lastLandSpeed });
        h.runJump = false;
      },
      update(h, dt) {
        h.friction(18, dt);
        if (h.chooseGroundMove()) return undefined;
        if (--h.landTimer <= 0) return 'idle';
        return undefined;
      },
    },
    dodge: {
      tags: ['busy', 'invuln'],
      enter(h) {
        const d = h.moveDir();
        let dx = d.x, dz = d.z;
        if (!dx && !dz) dx = -h.facing; // neutral dodge = backstep roll
        const mag = Math.hypot(dx, dz * 0.8) || 1;
        h.dodgeVel = { x: (dx / mag) * 7.2, z: (dz / mag) * 5.2 };
        const back = dx && Math.sign(dx) !== h.facing;
        h.dodgeFlip = back;
        if (dx) h.facing = Math.sign(dx);
        h.dodgeTicks = 22;
        h.perfectDodged = false;
        h.play(!dx && dz ? 'sidestep' : 'dodge_roll', { restart: true, fade: 0.05, duration: 22 / 60, fallback: ['dodge_roll'] });
        h.game.bus.emit(EV.DODGE, { actor: h, perfect: false });
      },
      update(h, dt) {
        const t = 22 - h.dodgeTicks;
        if (t >= 1 && t < 15) h.invuln = Math.max(h.invuln, 1);
        const k = t < 16 ? 1 : 0.25;
        h.vel.x = h.dodgeVel.x * k; h.vel.z = h.dodgeVel.z * k;
        if (--h.dodgeTicks <= 0) { if (h.dodgeFlip) h.facing = -h.facing; return 'idle'; }
        if (t > 16 && h.chooseGroundMove()) return undefined;
        return undefined;
      },
    },
    /** Holding Heavy: the move is paused at its windup; 3 charge levels (flash + 'charge' event); release swings. */
    charge: {
      tags: ['busy', 'charging'],
      enter(h, data) {
        h.chargeRun = data && data.run;
        h.chargeLevel = 0;
        h.chargeCfg = { ...CHARGE_DEFAULTS, ...((h.chargeRun && h.chargeRun.def.charge) || {}) };
        if (h.animator) h.animator.setSpeed(0.04); // hold the windup pose
        h.vel.x *= 0.2; h.vel.z *= 0.2;
      },
      update(h, dt) {
        const run = h.chargeRun, cfg = h.chargeCfg;
        if (!run || h.attack !== run) return 'idle';
        h.friction(22, dt);
        const t = h.fsm.ticks;
        // Level-ups: flash + camera tick + event (VFX/audio listen).
        while (h.chargeLevel < 3 && t >= cfg.levels[h.chargeLevel]) {
          h.chargeLevel++;
          // C2 r1: 9 ticks at 0.7-1.0 washed the whole body (one material per hero: the face went flat peach for a
          // third of a second). Shorter and dimmer; the level-up read stays on the charge_glint VFX + camera tick.
          h.flash(CHARGE_COLORS[h.chargeLevel - 1], 6, 0.3 + h.chargeLevel * 0.08);
          if (h.game.cameraRig && h.game.cameraRig.shake) h.game.cameraRig.shake(0.05 + h.chargeLevel * 0.04);
          h.game.bus.emit(EV.CHARGE, { actor: h, level: h.chargeLevel, moveId: run.id });
        }
        // Sustained glow pulse while charged.
        if (h.chargeLevel > 0 && t % 10 === 0 && h._flash.t <= 0) h.flash(CHARGE_COLORS[h.chargeLevel - 1], 5, 0.07 + h.chargeLevel * 0.04);
        if (h.take('dodge')) { h.endMove(); h.fsm.go('dodge'); return undefined; }
        const held = h.input.isDown(run.def.chargeButton || 'heavy');
        if (!held || t >= cfg.max) {
          const L = h.chargeLevel;
          if (L > 0) {
            run.scaleHits(cfg.scale[L - 1]);
            run.id = `${run.id}_c${L}`;
            h.game.bus.emit(EV.ATTACK_START, { actor: h, move: run.def, moveId: run.id, charge: L });
          } else h.game.bus.emit(EV.CHARGE, { actor: h, level: 0, moveId: run.id });
          run.paused = false;
          h.fsm.go('attack', { id: run.id, resume: true });
        }
        return undefined;
      },
      exit(h, next) {
        if (h.animator) h.animator.setSpeed(1);
        if (h.chargeRun) h.chargeRun.paused = false;
        if (next !== 'attack' && h.attack === h.chargeRun) h.endMove();
        h.chargeRun = null;
      },
    },
    /** Walk-in grab: hold the foe at arm's length. Light = knee (hold hit, up to `knees`), then Light/Heavy or
     *  Light with ←/→ held = THROW along the held direction (the moveset's 'throw' move). The foe breaks free after `hold`. */
    clinch: {
      tags: ['busy', 'grabbing'],
      enter(h, data) {
        const v = h.clinchVictim = data && data.victim;
        h.clinchCfg = { ...CLINCH_DEFAULTS, ...(h.moves.clinch || {}), knee: { ...CLINCH_DEFAULTS.knee, ...((h.moves.clinch && h.moves.clinch.knee) || {}) } };
        h.clinchKnees = 0; h.clinchCool = 6; h.clinchQ = null;
        h.faceToward(v);
        h.vel.set(0, 0, 0);
        h.clinchGap = Math.max(0.62, Math.min(0.85, Math.abs(v.pos.x - h.pos.x)));
        v.fsm.go('grabbed', { by: h });
        h.play(h.clinchCfg.anim, { restart: true, fade: 0.08, fallback: ['pommel', 'light_1', 'idle'] });
        h.game.bus.emit(EV.GRAB, { actor: h, victim: v, moveId: 'clinch', clinch: true });
      },
      update(h, dt) {
        const v = h.clinchVictim, cfg = h.clinchCfg;
        h.friction(30, dt);
        if (!v || !v.fsm.is('grabbed') || v.grabbedBy !== h) return 'idle';
        // Hold the foe in front, feet on the ground, facing us.
        v.pos.x = h.pos.x + h.facing * h.clinchGap; v.pos.z += (h.pos.z - v.pos.z) * 0.35; v.pos.y = 0; v.grounded = true;
        v.facing = -h.facing; v.vel.set(0, 0, 0);
        if (h.take('dodge')) return 'dodge'; // shove off (exit releases the foe)
        if (h.fsm.ticks >= cfg.hold) { h.clinchBroke = true; return 'idle'; }
        // Presses during the knee recovery are queued (mashing Light never drops an input).
        const btn = h.take('heavy') ? 'heavy' : h.take('light') ? 'light' : null;
        if (btn) h.clinchQ = h.clinchQ === 'heavy' ? 'heavy' : btn;
        if (h.clinchCool > 0) { h.clinchCool--; return undefined; }
        const aim = Math.sign(h.input.moveX());
        const heavy = h.clinchQ === 'heavy', light = h.clinchQ === 'light';
        h.clinchQ = null;
        if (!heavy && !light) return undefined;
        if (heavy || aim || h.clinchKnees >= cfg.knees) {
          if (h.fsm.go('throw', { id: 'throw', victim: v, dir: aim || h.facing })) return undefined;
        }
        h.clinchKnees++;
        h.clinchCool = cfg.cool;
        h.play(cfg.kneeAnim, { restart: true, fade: 0.04, duration: cfg.cool / 60 + 0.1, loop: false, fallback: ['pommel', 'light_1'] });
        h.game.bus.emit(EV.ATTACK_START, { actor: h, move: { hits: [cfg.knee] }, moveId: 'clinch_knee' });
        if (h.game.combat) h.game.combat.applyHit(h, v, cfg.knee, { moveId: 'clinch_knee', dir: h.facing });
        return undefined;
      },
      exit(h, next) {
        const v = h.clinchVictim;
        h.clinchVictim = null;
        if (next === 'throw' || !v || !v.fsm.is('grabbed') || v.grabbedBy !== h) return;
        // Released (dodge / hit / foe broke free): the foe staggers back a step.
        v.fsm.go('hitstun', { hitstun: 12, knockback: h.clinchBroke ? 3 : 2, dir: h.facing });
        if (h.clinchBroke) { h.vel.x = -h.facing * 2.2; h.clinchBroke = false; }
      },
    },
    /** Close-string throw (kind:'throw' MoveDef): grab → lift over the shoulder → fling along the aimed direction. */
    throw: {
      tags: ['busy', 'throwing'],
      enter(h, data) {
        const d = h.moves[data.id];
        h.throwDef = d; h.throwId = data.id; h.throwVictim = data.victim; h.throwDir = data.dir || h.facing; h.throwT = 0;
        const v = h.throwVictim;
        h.faceToward(v);
        h.throwFrom = { x: (v.pos.x - h.pos.x) * h.facing, z: v.pos.z - h.pos.z };
        h.vel.set(0, 0, 0);
        v.fsm.go('grabbed', { by: h });
        h.play(d.anim || 'throw', { restart: true, fade: 0.05, duration: (d.total ?? 36) / 60, loop: false, fallback: d.animFallback || ['heavy'] });
        h.game.bus.emit(EV.GRAB, { actor: h, victim: v, moveId: data.id });
        h.game.bus.emit(EV.ATTACK_START, { actor: h, move: d, moveId: data.id });
      },
      update(h, dt) {
        const d = h.throwDef, v = h.throwVictim, t = h.throwT++;
        const grab = d.grab ?? 6, rel = d.release ?? 16, total = d.total ?? 36;
        h.friction(24, dt);
        if (t < rel) h.invuln = Math.max(h.invuln, 1);
        if (v && v.fsm.is('grabbed') && v.grabbedBy === h) {
          // Carry path in character space: hold at the grab point, then arc up over the head toward the aim side.
          const back = h.throwDir !== h.facing;
          const lift = d.lift || { x: 0.3, y: 1.7 };
          const u = t < grab ? 0 : Math.min(1, (t - grab) / Math.max(1, rel - grab));
          const e = u * u * (3 - 2 * u);
          const x1 = back ? -lift.x : lift.x;
          const fx = h.throwFrom.x + (x1 - h.throwFrom.x) * e;
          v.pos.x = h.pos.x + h.facing * fx;
          // Back throw: up over the head (peak lift.y) and down to ~0.7 lift.y behind the shoulder; forward: hoist to ~0.75 lift.y.
          v.pos.y = back ? Math.sin(e * Math.PI * 0.75) * lift.y : Math.sin(e * Math.PI * 0.5) * lift.y * 0.75;
          v.pos.z = h.pos.z + h.throwFrom.z * (1 - e);
          v.grounded = false;
          v.roll = -h.throwDir * e * Math.PI * 0.5; // lie flat overhead, head toward the throw
          if (t === rel) {
            v.fsm.go('thrown', { by: h, dir: h.throwDir, def: d, moveId: h.throwId });
            h.game.bus.emit(EV.THROW, { actor: h, victim: v, dir: h.throwDir, moveId: h.throwId });
            if (h.game.cameraRig && h.game.cameraRig.shake) h.game.cameraRig.shake(0.18);
            if (back) h.facing = h.throwDir; // follow-through turns the hero toward the throw
          }
        }
        if (t >= total) return 'idle';
        if (t > rel + 8 && h.take('dodge')) { h.fsm.go('dodge'); return undefined; }
        return undefined;
      },
      exit(h) {
        const v = h.throwVictim;
        if (v && v.fsm.is('grabbed') && v.grabbedBy === h) v.fsm.go('knockdown');
        h.throwVictim = null;
      },
    },
    /** Magic button went down: a quick release casts everything (tap, GA1); holding steps the tier down (GA2). */
    magicSelect: {
      tags: ['busy'],
      enter(h) {
        h.selTier = h.magicTier();
        h.vel.x *= 0.3; h.vel.z *= 0.3;
        h.game.bus.emit(EV.MAGIC_SELECT, { hero: h, tier: h.selTier, pots: h.pots });
      },
      update(h, dt) {
        h.friction(16, dt);
        const t = h.fsm.ticks;
        const held = h.input.isDown('magic');
        if (held && t >= MAGIC_TAP_TICKS && (t - MAGIC_TAP_TICKS) % MAGIC_STEP_TICKS === 0 && t > MAGIC_TAP_TICKS && h.selTier > 1) {
          h.selTier--;
          h.game.bus.emit(EV.MAGIC_SELECT, { hero: h, tier: h.selTier, pots: h.pots });
        }
        if (!held || t > 150) {
          const tap = t < MAGIC_TAP_TICKS;
          const tier = tap ? h.magicTier() : h.selTier;
          h.fsm.go('magic', { tier, cost: tap ? h.pots : h.tierCost(tier) });
        }
        return undefined;
      },
    },
    magic: {
      tags: ['busy', 'invuln'],
      enter(h, data) {
        const tier = (data && data.tier) || h.magicTier();
        const cost = data && data.cost !== undefined ? data.cost : h.pots;
        h.pots = Math.max(0, h.pots - cost);
        h.vel.set(0, h.grounded ? 0 : h.vel.y, 0);
        h.play('magic_cast', { restart: true, fade: 0.08, fallback: ['idle'] });
        h.castDone = false;
        h.castTicks = 0;
        const p = tier > 0 && h.game.magic ? h.game.magic.cast(h, tier) : null;
        Promise.resolve(p).finally(() => { h.castDone = true; });
      },
      update(h, dt) {
        h.invuln = Math.max(h.invuln, 2);
        h.friction(20, dt);
        h.castTicks++;
        if ((h.castDone && h.castTicks > 40) || h.castTicks > 60 * 8) return 'idle';
        return undefined;
      },
    },
    dead: {
      tags: ['dead'],
      enter(h) { h.alive = false; h.hurtable = false; h.deadTicks = 0; h.play('death', { fade: 0.2, fallback: ['down_loop'] }); },
      update(h) {
        h.deadTicks++;
        // PLAYER_DOWN is emitted by Hero.update (DEATH_BEAT_TICKS after the killing blow), not here.
        return undefined;
      },
    },
  };
}
