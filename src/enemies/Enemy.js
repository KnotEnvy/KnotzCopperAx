// Enemy: generic AI-driven Combatant built from an enemy type definition (src/enemies/types/<id>.js).
// A behaviour ("brain", src/ai/behaviours/<id>.js) steers it through a tiny command API while it's in a
// controllable state (idle / walk). Reactions (hitstun, knockdown, down, getup, dead, grabbed, thrown) come from
// Combatant; this class adds the enemy-only states and combat rules:
//
// Brain command API:
//   enemy.moveTo(x, z, speedScale=1)   walk toward a point this tick (sets desired velocity; >1.25 plays 'run')
//   enemy.stopMoving()
//   enemy.attackWith(moveId, target)   start a move from def.moves (faces the target)
//   enemy.pause(ticks, { anim, loop, face, vx, vz })   hold a pose (taunt, cackle, feint step, recovery window)
//   enemy.riseFromGround()             skeleton emergence (also opts.rise at spawn)
//   enemy.controllable / enemy.target
// Brain hooks (all optional, on the object returned by behaviour.create):
//   guard(ev) → bool      block this hit (clank, 0 damage, pushback; ev.blocked = true). Magic and `guardBreak` pass.
//   preHit(ev)            mutate an incoming hit before it lands (thieves: every kick knocks down)
//   onHit(ev)             after a hit landed (spill loot, retreat decisions)
//   react(order, data)    crowd-director orders: 'dodge' | 'brace' (a thrown ally is flying at us)
//   onAttackTick(run)     per-tick hook during own moves (ground-pound shockwave, grab reach) → state name to leave
// Combat rules (docs/notes/enemies-ai.md):
//   - Telegraph: every move flashes at `startup - teleLead` ticks (normal warm / heavy orange / unblockable red) and
//     emits 'ai:telegraph' { actor, moveId, kind, pos, activeIn } for VFX/audio.
//   - Anti-stunlock: after director.stunLimit(e) hits without regaining control the next hit floors the enemy
//     ('ai:breakout'), and it gets up with `armorTicks` of light-hit armour.
//   - def.reassemble: lethal non-magic hits crumble the enemy into a bone pile ('bones'); an OTG hit or magic on
//     the pile destroys it for good, otherwise it reforms ('ai:reassemble') with part of its HP.
//   - Elite ranks (opts.elite 1..4 or def.elite): HP/damage up + a floating name tag (Sgt. Tarnish … Gen. Oxide).
import * as THREE from 'three';
import { Combatant } from '../combat/Combatant.js';
import { DEPTH_TOL } from '../core/config.js';
import { EV } from '../core/EventBus.js';
import { boxFrom } from '../core/aabb.js';
import { reportError } from '../core/log.js';
import { grabbable } from '../ai/_kit.js';

export const ELITE_RANKS = [null,
  { title: 'Sgt. Tarnish', hp: 1.5, dmg: 1.15, aggro: 0.08, color: '#c9a36a' },
  { title: 'Lt. Verdigris', hp: 1.8, dmg: 1.25, aggro: 0.12, color: '#6fc9a8' },
  { title: 'Col. Patina', hp: 2.2, dmg: 1.35, aggro: 0.16, color: '#7fb0d8' },
  { title: 'Gen. Oxide', hp: 2.8, dmg: 1.5, aggro: 0.2, color: '#e0603a' },
];

// C2 r1: since the perf-1650 pale-figure fix the wind-up flash is masked to a glint at the weapon hand (VfxSystem
// 'ai:telegraph' → hitFlash), so it can be much hotter than the old whole-body value without making a statue: at game
// distance (stage 1, 1600x900) the 0.7 normal glint was barely visible on a jab / swing.
const TELE = {
  normal: { color: '#ffd89a', ticks: 8, strength: 1.35, spark: '#ffe2a8' },
  heavy: { color: '#ff8a2a', ticks: 10, strength: 1.6, spark: '#ffb060' },
  unblockable: { color: '#ff2414', ticks: 12, strength: 1.7, spark: '#ff4028' },
  grab: { color: '#d8a0ff', ticks: 10, strength: 1.6, spark: '#e0b0ff' },
};

export class Enemy extends Combatant {
  constructor(game, def, model, opts = {}) {
    const rank = ELITE_RANKS[opts.elite ?? def.elite ?? 0] || null;
    super(game, {
      kind: def.kind || 'enemy', typeId: def.id, team: def.team || 'enemies', def, model, character: def.animCharacter || def.id,
      moves: def.moves || {}, x: opts.x, z: opts.z, facing: opts.facing ?? -1,
      hp: Math.round((opts.hp ?? def.hp ?? 30) * (rank && opts.hp === undefined ? rank.hp : 1)), radius: def.radius ?? 0.36, height: def.height ?? 1.8,
      boundsMode: 'band', weight: def.weight ?? 1, mass: def.mass ?? 1.5,
      downTicks: def.downTicks ?? 34, getupInvuln: def.getupInvuln ?? 20, // back up quicker than heroes (pressure)
    });
    this.speed = def.speed ?? 2.4;
    this.getupTicks = def.getupTicks ?? 24; // quicker get-up than heroes (30)
    this.hurt.d = def.hurtDepth ?? DEPTH_TOL;
    // Gameplay-only standing hurtbox height (m). `height` (art-owned, ≈ body height) keeps driving anchors, lying boxes
    // and the placeholder rig; GLBs are never scaled from either. Used where gear/heads rise above 0.95 × height.
    if (def.hurtHeight > 0) this.hurt.h = def.hurtHeight;
    this.target = null;
    this.brain = null;
    this.score = def.score || { hit: 10, ko: 150 };
    this.desired = { x: 0, z: 0, active: false, speed: 1 };
    this.tier = opts.tier || null;
    this.spawnOpts = opts;
    this.rank = rank;
    this.eliteLevel = rank ? (opts.elite ?? def.elite) : 0;
    this.damageMul = (def.damageMul ?? 1) * (rank ? rank.dmg : 1);
    if (rank) { this.score = { hit: this.score.hit * 2, ko: this.score.ko * 3 }; }
    this.stunChain = 0;      // hits taken since we last had control (anti-stunlock)
    this.calm = 0;           // ticks in control since the last hit
    this.armorTicks = 0;     // post-breakout light-hit armour
    this.braced = 0;         // bracing against a thrown ally
    this.reassembles = 0;
    this._tele = null;
    this._prevState = null;
    this.fsm.define(enemyStates());
    if (rank) this.addNameTag(rank.title, rank.color);
    this.fsm.go(opts.rise ? 'rise' : opts.enterFrom ? 'enter' : 'idle', opts.enterFrom || null);
  }

  get controllable() { return this.alive && this.fsm.is('idle', 'walk') && this.hitstop <= 0; }
  get displayName() { return this.rank ? this.rank.title : (this.def.name || this.typeId); }

  moveTo(x, z, speedScale = 1) { this.desired.x = x; this.desired.z = z; this.desired.speed = speedScale; this.desired.active = true; }
  stopMoving() { this.desired.active = false; }
  attackWith(id, target = this.target) {
    if (!this.moves[id]) return false;
    // C2 r1: the crowd director vetoes a start with the body half out of frame / from a pinned hero's outer side
    const dir = this.game.ai && this.game.ai.director;
    if (dir && dir.attackVeto && dir.attackVeto(this, target)) return false;
    if (target) this.faceToward(target);
    this.desired.active = false;
    this.startMove(id, { target });
    return true;
  }
  /** Hold a pose for `ticks` (taunts, feints, whiff recovery). vx = slide speed along facing (negative = backstep). */
  pause(ticks, o = {}) { this.desired.active = false; this.fsm.go('pause', { ticks, ...o }); }
  riseFromGround() { this.fsm.go('rise'); }

  startMove(id, o) {
    const run = super.startMove(id, o);
    if (run && run.def.telegraph !== 'none') {
      const d = run.def;
      const kind = d.telegraph || (d.unblockable ? 'unblockable' : d.grab ? 'grab' : d.armor ? 'heavy' : 'normal');
      this._tele = { at: Math.max(1, (d.startup || 0) - (d.teleLead ?? 9)), kind, id, startup: d.startup || 0 };
      if (d.armor) this.bracedArmor = true;
    }
    return run;
  }

  /** C2 r1: a LOCAL flash (guard-break, block, enrage, reform) — Combatant.flash lit the whole body (a flat pale/coloured
   *  "statue" for 3–20 frames); routed through vfx.hitFlash it becomes a capped surface tint inside a sphere round `point`
   *  (default: the chest). Falls back to the plain flash when there is no VFX system (headless tools). */
  localFlash(color, ticks, strength, { point = null, radius = 0.55 } = {}) {
    const hf = this.game.vfx && this.game.vfx.hitFlash;
    const P = this.game.params, off = !!(P && ((P.raw && P.raw.get && P.raw.get('teleglint') === '0') || (P.get && P.get('teleglint') === '0'))); // C2 r2: params are config (URLSearchParams in .raw)
    if (!hf || off || !this.modelRoot) { this.flash(color, ticks, strength); return; }
    const p = point || { x: this.pos.x, y: this.pos.y + (this.height || 1.8) * 0.62, z: this.pos.z };
    hf.hit(this, p, { color, ticks, strength, radius, tint: true });
  }

  /** Wind-up flash + event (fair telegraph; VFX/audio hook 'ai:telegraph'). */
  telegraph(t) {
    const k = TELE[t.kind] || TELE.normal;
    this.flash(k.color, k.ticks, k.strength);
    const pos = { x: this.pos.x + this.facing * 0.25, y: this.pos.y + this.height * 0.92, z: this.pos.z + 0.05 };
    if (this.game.vfx && this.game.vfx.spawn) this.game.vfx.spawn('sparkle', { pos, color: k.spark, count: t.kind === 'normal' ? 5 : 7 });
    this.game.bus.emit('ai:telegraph', { actor: this, moveId: t.id, kind: t.kind, pos, activeIn: Math.max(0, t.startup - t.at) });
  }

  // ------------------------------------------------------------ combat rules
  canBeHit(ev) {
    const s = this.fsm.name;
    if (s === 'rise') return this.hurtable && this.fsm.ticks > 26 && super.canBeHit(ev);
    if (s === 'bones') return this.fsm.ticks > 4 && !this.removed && (!!ev.otg || ev.level === 'magic');
    if (s === 'reform') return false;
    return super.canBeHit(ev);
  }

  hurtboxes() {
    if (this.fsm.is('bones')) {
      boxFrom(this._hurtBox, this.pos.x, 0, this.pos.z, this.height * 0.7, 0.45, DEPTH_TOL * 1.2);
      return this._hurtList;
    }
    return super.hurtboxes();
  }

  receiveHit(ev) {
    const b = this.brain, bus = this.game.bus;
    // Bone pile: OTG or magic destroys it for good.
    if (this.fsm.is('bones')) {
      this.lastHitBy = ev.attacker; this.hp = 0; this.alive = false; ev.killed = true; ev.damage = Math.max(ev.damage, 1);
      this.fsm.go('dead');
      this.shatter();
      return true;
    }
    // Guard (frontal block): magic and guard-breaking hits pass.
    if (this.alive && b && b.guard && ev.level !== 'magic' && !(ev.hit && ev.hit.guardBreak)) {
      let g = false;
      try { g = b.guard(ev); } catch (e) { reportError(`ai:${this.typeId}.guard`, e); }
      if (g) return this.blockHit(ev);
    }
    if (b && b.preHit) { try { b.preHit(ev); } catch (e) { reportError(`ai:${this.typeId}.preHit`, e); } }
    // Anti-stunlock: floor the foe once a chain gets too long; it rises with light-hit armour.
    const dir = this.game.ai && this.game.ai.director;
    const limit = dir && dir.stunLimit ? dir.stunLimit(this) : 10;
    this.stunChain++; this.calm = 0;
    if (this.alive && this.stunChain >= limit && !ev.knockdown && !this.fsm.is('grabbed')) {
      ev.knockdown = true; ev.launch = Math.max(ev.launch || 0, 4.4); ev.knockback = Math.max(ev.knockback || 0, 3.6);
      this.breakout = true;
      bus.emit('ai:breakout', { actor: this, by: ev.attacker, hits: this.stunChain });
    }
    // Brace against a thrown ally: the impact hurts less and does not floor us.
    if (this.braced > 0 && ev.moveId === 'throw_impact') { ev.damage *= 0.5; ev.knockdown = false; ev.launch = 0; ev.knockback *= 0.4; this.stunChain--; }
    let restore = null;
    if (this.armorTicks > 0 && ev.level !== 'magic' && !ev.knockdown) { restore = this.superArmor; this.superArmor = Math.max(this.superArmor, this.def.armorDamage ?? 7); }
    const wasAlive = this.alive;
    const ok = super.receiveHit(ev);
    if (restore !== null) this.superArmor = restore;
    // Reassembling skeletons: a non-magic KO crumbles them instead of killing them.
    const ra = this.def.reassemble;
    if (wasAlive && !this.alive && ra && ev.level !== 'magic' && this.reassembles < (ra.max ?? 3)) {
      this.alive = true; this.hp = 0; ev.killed = false; this.crumbling = true;
    }
    if (b && b.onHit) { try { b.onHit(ev); } catch (e) { reportError(`ai:${this.typeId}.onHit`, e); } }
    return ok;
  }

  blockHit(ev) {
    ev.blocked = true;
    const chip = Math.min(Math.max(0, this.hp - 1), (ev.damage || 0) * (this.def.chip ?? 0));
    this.hp -= chip; ev.damage = chip;
    this.lastHitBy = ev.attacker;
    if (ev.attacker) this.faceToward(ev.attacker);
    this.vel.x = (ev.dir || -this.facing) * (0.8 + (ev.knockback || 1) * 0.35) / this.weight;
    this.localFlash('#a8c8ff', 3, 0.35, { point: ev.point, radius: 0.45 }); // C2 r1: guard clank = a glint at the contact, not a blue body
    // The attacker bounces off the guard (SoR4 clank): a short push back, so mashing a knight is not free.
    const a = ev.attacker;
    if (a && a.vel && a.kind === 'hero' && a.grounded) a.vel.x -= (ev.dir || 1) * 2.2;
    this.guardHits = (this.guardHits || 0) + 1;
    this.fsm.go('block', { ticks: Math.max(10, Math.round((ev.hitstun || 16) * 0.55)) });
    this.game.bus.emit('ai:block', { actor: this, by: a, point: ev.point, moveId: ev.moveId });
    return true;
  }

  /** Bone pile destroyed (OTG / magic): debris burst + KO bookkeeping. */
  shatter() {
    const p = { x: this.pos.x, y: 0.1, z: this.pos.z };
    const v = this.game.vfx;
    if (v && v.spawn) { v.spawn('fx_rock_burst', { pos: p, count: 14, speed: 5, size: 0.08 }); v.spawn('dust', { pos: p, amount: 1.1, kind: 'getup' }); }
    this.game.bus.emit('ai:shatter', { actor: this, pos: p });
    if (this.onDeath) this.onDeath();
  }

  addNameTag(text, color) {
    try {
      const c = document.createElement('canvas'); c.width = 512; c.height = 96;
      const g = c.getContext('2d');
      g.font = '700 50px Georgia, "Times New Roman", serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 10; g.strokeStyle = 'rgba(12,8,6,0.9)'; g.strokeText(text.toUpperCase(), 256, 50);
      const grad = g.createLinearGradient(0, 22, 0, 78); grad.addColorStop(0, '#fff4dc'); grad.addColorStop(1, color);
      g.fillStyle = grad; g.fillText(text.toUpperCase(), 256, 50);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, toneMapped: false });
      const s = new THREE.Sprite(m); s.scale.set(1.5, 0.28, 1); s.position.y = this.height + 0.38; s.renderOrder = 20;
      this.nameTag = s; this.view.add(s);
    } catch (e) { reportError('enemy.nameTag', e); }
  }

  update(dt) {
    if (this.armorTicks > 0) this.armorTicks--;
    if (this.braced > 0) this.braced--;
    if (this.controllable) { if (++this.calm > 20) this.stunChain = 0; } else if (this.fsm.is('attack')) this.calm++;
    if (this.brain && this.controllable) {
      try { this.brain.update(dt); } catch (e) { this.brain = null; reportError(`ai:${this.typeId}`, e); }
    }
    super.update(dt);
    // Telegraph at the move's wind-up frame.
    const run = this.attack;
    if (run && this._tele && this._tele.id === this.moveId && run.frame >= this._tele.at) { const t = this._tele; this._tele = null; this.telegraph(t); }
    if (!run) this._tele = null;
    // Crumble into bones when the lethal knockdown lands.
    if (this.crumbling && this.fsm.is('down')) { this.crumbling = false; this.fsm.go('bones'); }
    // Breakout: the armour window starts as the foe rises.
    const s = this.fsm.name;
    if (s !== this._prevState) {
      if (s === 'getup' && this.breakout) { this.breakout = false; this.armorTicks = 70; this.stunChain = 0; this.game.bus.emit('ai:armor', { actor: this, ticks: 70 }); }
      // Whiffed heavy/armoured moves leave a short recovery window (fair punish opening).
      if (this._prevState === 'attack' && s === 'idle' && this._lastRun && !this._lastRun.anyHit && this._lastRun.def.whiffPause) {
        this.pause(this._lastRun.def.whiffPause, { anim: this._lastRun.def.whiffAnim || 'idle', face: false });
      }
      this._prevState = this.fsm.name;
    }
    this._lastRun = this.attack || this._lastRun;
    if (this.nameTag) this.nameTag.visible = this.alive && !this.fsm.is('bones', 'rise');
    this.desired.active = false; // the brain re-issues moveTo every tick
  }

  onAttackTick(run, dt) {
    const d = run.def, f = run.frame + 1; // frame about to run
    // Chains (enemy strings): def.chain = { into, at, hit: true, chance } → continue into the next move.
    const ch = d.chain;
    const hot = this.game.ai && this.game.ai.director && run.target && this.game.ai.director.heat(run.target) > 1.0; // over the damage budget: no follow-up
    if (ch && !run._chained && !hot && f >= ch.at && (!ch.hit || run.anyHit) && this.moves[ch.into]) {
      run._chained = true;
      // C2 r2: a chain continuation is a new attack start — the director's edge / pinned-hero veto applies to it too
      // (board r11: all 7 stage-2 outer-side attacks were skeleton slash → slash_2 strings)
      const dir = this.game.ai && this.game.ai.director;
      if (this.game.rng.chance(ch.chance ?? 0.7) && !(dir && dir.attackVeto && dir.attackVeto(this, this.target, true))) { this.startMove(ch.into, { target: this.target }); return undefined; }
    }
    // Grab window: def.grab = { from, to, reach } → a grabbable hero in reach is clinched (then tossed, def.grab on the type).
    const gb = d.grab;
    if (gb && f >= gb.from && f < gb.to) {
      for (const h of this.game.world.query({ kind: 'hero' })) {
        const ax = (h.pos.x - this.pos.x) * this.facing;
        if (ax > -0.2 && ax < (gb.reach ?? 1.3) && Math.abs(h.pos.z - this.pos.z) < 0.55 && grabbable(h)) { this._clinchVictim = h; return 'clinch'; }
      }
    }
    // Ground shockwave: def.shockwave = { at, radius, x, hit } → grounded heroes in the ring are hit (jump over it).
    const sw = d.shockwave;
    if (sw && f === sw.at) {
      const c = { x: this.pos.x + this.facing * (sw.x ?? 1.0), y: 0.02, z: this.pos.z };
      const v = this.game.vfx, cam = this.game.cameraRig;
      if (v && v.spawn) { v.spawn('fx_shockwave', { pos: c, radius: sw.radius, element: 'earth', dust: true, debris: 8 }); v.spawn('fx_crack', { pos: c, radius: sw.radius * 0.5, element: 'earth' }); }
      if (cam && cam.shake) cam.shake(0.45);
      this.game.bus.emit('ai:shockwave', { actor: this, pos: c, radius: sw.radius });
      if (this.game.combat) for (const h of this.game.world.query({ team: 'players' })) {
        if (!h.hurtable || h.pos.y > 0.35 || Math.hypot(h.pos.x - c.x, (h.pos.z - c.z) * 1.4) > sw.radius) continue;
        this.game.combat.applyHit(this, h, { damage: 8, knockback: 4, launch: 4.5, knockdown: true, hitstop: 8, hitstun: 26, level: 'heavy', shake: 0.3, ...(sw.hit || {}) }, { moveId: run.id + '_wave', dir: Math.sign(h.pos.x - c.x) || this.facing });
      }
    }
    if (this.brain && this.brain.onAttackTick) {
      try { return this.brain.onAttackTick(run, dt); } catch (e) { reportError(`ai:${this.typeId}.onAttackTick`, e); }
    }
    return undefined;
  }

  onDeath() {
    if (this._deathDone) return;
    this._deathDone = true;
    if (this.game.ai && this.game.ai.tokens) this.game.ai.tokens.release(this);
    if (this.brain && this.brain.onDeath) { try { this.brain.onDeath(); } catch (e) { reportError(`ai:${this.typeId}.onDeath`, e); } }
  }

  onRemove() { if (this.game.ai && this.game.ai.tokens) this.game.ai.tokens.release(this); }
}

const ease = (t) => 1 - (1 - t) * (1 - t);
/** r7: per-actor, per-moment gait phase (normalized clip start) so walkers entering together never step in unison. */
const phase = (e) => ((e.id * 0.6180339 + (e.game.tick || 0) * 0.0137) % 1 + 1) % 1;

function enemyStates() {
  const steer = (e, dt) => {
    const d = e.desired;
    if (!d.active) { e.friction(12, dt); return false; }
    const dx = d.x - e.pos.x, dz = d.z - e.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.08) { e.friction(14, dt); return false; }
    const sp = e.speed * d.speed;
    const k = Math.min(1, dist / 0.4);
    e.vel.x += ((dx / dist) * sp * k - e.vel.x) * Math.min(1, 10 * dt);
    e.vel.z += ((dz / dist) * sp * 0.75 * k - e.vel.z) * Math.min(1, 10 * dt);
    if (e.faceMove && Math.abs(dx) > 0.05) e.setFacing(dx);
    else if (e.target) e.faceToward(e.target); else if (Math.abs(dx) > 0.05) e.setFacing(dx);
    return true;
  };
  return {
    idle: {
      enter(e) { e.play('idle', { fade: 0.2, startAt: phase(e) }); }, // r7: idles breathe out of phase
      update(e, dt) {
        if (!e.grounded) return 'fall';
        if (steer(e, dt)) return 'walk';
        return undefined;
      },
    },
    walk: {
      enter(e) { e.gait = null; },
      update(e, dt) {
        if (!e.grounded) return 'fall';
        const moving = steer(e, dt);
        const sp = Math.hypot(e.vel.x, e.vel.z);
        const gait = e.desired.speed > 1.25 && sp > e.speed * 1.05 && e.def.canRun !== false ? 'run' : 'walk';
        if (gait !== e.gait) { e.gait = gait; e.play(gait, { fade: 0.15, fallback: ['walk'], startAt: phase(e) }); }
        if (e.animator) e.animator.setSpeed((gait === 'run' ? Math.max(0.7, sp / 6) : Math.max(0.5, sp / 3.2)) * (0.94 + ((e.id * 0.37) % 1) * 0.12)); // r7: own cadence
        if (!moving && sp < 0.3) return 'idle';
        return undefined;
      },
      exit(e) { if (e.animator) e.animator.setSpeed(1); },
    },
    fall: {
      enter(e) { e.play('jump_fall', { fade: 0.15, fallback: ['idle'] }); },
      update(e) { if (e.grounded) return 'idle'; return undefined; },
    },
    /** Scripted entrance: walk in from off-screen to data.x before the brain takes over. */
    enter: {
      enter(e, data) {
        e.enterTarget = data ? { ...data } : data;
        e.invulnEnter = true;

        e.play(data && data.run ? 'run' : 'walk', { fade: 0.1, fallback: ['walk'], startAt: phase(e) });
      },
      update(e, dt) {
        const t = e.enterTarget;
        // r5b: own arrival lane + staggered start, picked on the first tick in the world (spawnEnemy awaits the brain
        // before world.add, so a wave spawned together only sees its mates from here).
        const D = e.game.ai && e.game.ai.director;
        if (!t._laned) { t._laned = true; if (D && D.entryLane && !t.fixed) try { D.entryLane(e, t); } catch (err) { /* keep scripted target */ } }
        // r7 arrival queue: wait off-screen for this entrant's turn (the director spaces a wave's arrivals in time).
        if (t.delay > 0) {
          t.delay--; t.waited = (t.waited || 0) + 1; e.vel.x = 0; e.vel.z = 0;
          // the camera may scroll while it waits: stay just outside the frame (never a statue standing at the edge)
          if (e.game.cameraRig && e.game.cameraRig.visibleRange) {
            const vr = e.game.cameraRig.visibleRange(e.pos.z);
            if (t.x < e.pos.x) e.pos.x = Math.max(e.pos.x, vr.xMax + 1.2); else e.pos.x = Math.min(e.pos.x, vr.xMin - 1.2);
          }
          return undefined;
        }
        if (!t._gait) {
          t._gait = true;
          if (t.run) e.play('run', { fade: 0.1, fallback: ['walk'], startAt: phase(e) });
          else if (t.waited) e.play('walk', { fade: 0.1, fallback: ['walk'], startAt: phase(e) });
          if (e.animator && t.spMul) e.animator.setSpeed(t.run ? 1 : t.spMul);
        }
        const dx = t.x - e.pos.x, dz = (t.z ?? e.pos.z) - e.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.3 || e.fsm.ticks > 60 * 6 + (t.waited || 0)) return 'idle';
        // r5b: a generic walk-in hands over to the (lane-aware) brain once it is well inside the frame, instead of
        // walking a fixed line through the column of foes already fighting.
        if (t.lane && e.game.cameraRig && e.game.cameraRig.visibleRange) {
          const vr = e.game.cameraRig.visibleRange(e.pos.z), inset = e.vanguard ? 0.5 : 1.3;
          if (e.pos.x > vr.xMin + inset && e.pos.x < vr.xMax - inset) {
            // r7 arrival beat: some non-vanguard entrants plant their feet and brandish before joining the ring, so
            // a wave reads as individuals arriving, not one pack walking in step.
            if (!e.vanguard && e.animator && e.animator.has('taunt') && e.game.rng.chance(0.45)) { e.pause(e.game.rng.int(26, 44), { anim: 'taunt', face: false }); return undefined; }
            return 'idle';
          }
        }
        let sp = e.speed * (t.speed ?? e.def.enterSpeed ?? 1.35) * (t.spMul ?? 1); // brisk walk-in: foes reach the fight quickly
        if (!e.vanguard && D && D.entryHold && D.entryHold(e, dx)) sp *= 0.3; // r5b: single file behind an entrant in this column
        e.vel.x = (dx / dist) * sp; e.vel.z = (dz / dist) * sp * 0.6;
        e.setFacing(dx);
        return undefined;
      },
      exit(e) { if (e.animator) e.animator.setSpeed(1); e.arrivedAt = e.game.tick; },
    },
    /** Timed pose: taunt, cackle, feint back-step, whiff recovery. data: { ticks, anim, loop, face, vx } */
    pause: {
      tags: ['busy'],
      enter(e, d = {}) {
        e.pauseTicks = d.ticks ?? 20; e.pauseVx = d.vx || 0; e.pauseVz = d.vz || 0;
        if (d.face !== false && e.target) e.faceToward(e.target);
        if (d.anim) e.play(d.anim, { restart: true, fade: 0.12, loop: !!d.loop, fallback: ['idle'], duration: d.duration });
      },
      update(e, dt) {
        if (e.pauseVx) e.vel.x = e.facing * e.pauseVx; else e.friction(10, dt);
        if (e.pauseVz) { e.vel.z = e.pauseVz; e.pauseVz *= 0.88; if (Math.abs(e.pauseVz) < 0.2) e.pauseVz = 0; }
        if (--e.pauseTicks <= 0) return 'idle';
        return undefined;
      },
      exit(e) { e.pauseVx = 0; },
    },
    /** Guard clank: hold the shield up, slide back a little. */
    block: {
      tags: ['busy'],
      enter(e, d = {}) { e.blockTicks = d.ticks ?? 12; e.play('blocked', { restart: true, fade: 0.04, duration: 0.32, fallback: ['hit_high'] }); },
      update(e, dt) { e.friction(8, dt); if (--e.blockTicks <= 0) return 'idle'; return undefined; },
    },
    /** Emerge from the ground (skeletons): crack → dirt burst → climb out. 'ai:rise' { actor, pos, phase } */
    rise: {
      tags: ['busy', 'invuln'],
      enter(e) {
        e.hurtable = false; e.solid = false; e.vel.set(0, 0, 0);
        e.play('getup', { restart: true, fade: 0, duration: 0.9, fallback: ['idle'] });
        if (e.modelRoot) e.modelRoot.position.y = -e.height * 1.05;
        const p = { x: e.pos.x, y: 0.02, z: e.pos.z }, v = e.game.vfx;
        if (v && v.spawn) v.spawn('fx_crack', { pos: p, radius: 0.9, element: 'earth' });
        e.game.bus.emit('ai:rise', { actor: e, pos: p, phase: 'start' });
      },
      update(e) {
        const t = e.fsm.ticks, T = 52;
        if (t === 12) {
          const p = { x: e.pos.x, y: 0.05, z: e.pos.z }, v = e.game.vfx;
          if (v && v.spawn) { v.spawn('fx_rock_burst', { pos: p, count: 12, speed: 4.5, size: 0.09, element: 'earth' }); v.spawn('dust', { pos: p, amount: 1.4, kind: 'getup' }); }
          if (e.game.cameraRig && e.game.cameraRig.shake) e.game.cameraRig.shake(0.12);
          if (e.game.audio && e.game.audio.play) e.game.audio.play('land', { volume: 0.7, pitch: 0.7 });
          e.game.bus.emit('ai:rise', { actor: e, pos: p, phase: 'burst' });
        }
        if (t >= 12 && e.modelRoot) e.modelRoot.position.y = -e.height * 1.05 * (1 - ease(Math.min(1, (t - 12) / (T - 16))));
        if (t === 26) e.hurtable = true;
        if (t >= T) return 'idle';
        return undefined;
      },
      exit(e) { if (e.modelRoot) e.modelRoot.position.y = 0; e.hurtable = true; e.solid = true; e.game.bus.emit('ai:rise', { actor: e, pos: e.pos, phase: 'done' }); },
    },
    /** Crumbled bone pile (def.reassemble): OTG/magic destroys it, else it reforms after `ticks`. */
    bones: {
      tags: ['down', 'stunned'],
      enter(e) {
        const ra = e.def.reassemble || {};
        e.bonesTicks = ra.ticks ?? 150; e.solid = false; e.vel.x *= 0.2;
        if (e.game.ai && e.game.ai.tokens) e.game.ai.tokens.release(e);
        const p = { x: e.pos.x, y: 0.1, z: e.pos.z }, v = e.game.vfx;
        if (v && v.spawn) { v.spawn('fx_rock_burst', { pos: p, count: 8, speed: 3, size: 0.06 }); v.spawn('dust', { pos: p, amount: 0.8, kind: 'getup' }); }
        e.game.bus.emit('ai:crumble', { actor: e, pos: p, ticks: e.bonesTicks });
      },
      update(e, dt) {
        e.friction(10, dt);
        const t = e.fsm.ticks;
        if (e.modelRoot) { const k = Math.min(1, t / 8); e.modelRoot.scale.set(1 + 0.25 * k, 1 - 0.72 * k, 1 + 0.25 * k); }
        // Rattle before reforming (the tell: hit it NOW).
        if (e.modelRoot && t > e.bonesTicks - 40) e.modelRoot.position.x = Math.sin(t * 1.7) * 0.04;
        if (t >= e.bonesTicks) return 'reform';
        return undefined;
      },
      exit(e) { if (e.modelRoot) { e.modelRoot.position.x = 0; } e.solid = true; },
    },
    reform: {
      tags: ['busy', 'invuln'],
      enter(e) {
        e.reassembles++;
        const ra = e.def.reassemble || {};
        e.hp = Math.max(1, Math.round(e.maxHp * (ra.hp ?? 0.5)));
        e.play('getup', { restart: true, fade: 0.1, duration: 0.6, fallback: ['idle'] });
        e.localFlash('#b8a0ff', 18, 1.2, { radius: 0.62 }); // C2 r1: reform glow on the chest, not a violet statue
        e.game.bus.emit('ai:reassemble', { actor: e, pos: { x: e.pos.x, y: 0.1, z: e.pos.z }, count: e.reassembles });
      },
      update(e) {
        const k = Math.min(1, e.fsm.ticks / 24);
        if (e.modelRoot) e.modelRoot.scale.set(1.25 - 0.25 * k, 0.28 + 0.72 * ease(k), 1.25 - 0.25 * k);
        if (e.fsm.ticks >= 34) { e.invuln = Math.max(e.invuln, 12); return 'idle'; }
        return undefined;
      },
      exit(e) { if (e.modelRoot) e.modelRoot.scale.set(1, 1, 1); },
    },
    /** Enemy grab (ogre): holds data.victim ('grabbed' persists while we're in 'clinch'), then tosses it. */
    clinch: {
      tags: ['busy'],
      enter(e, d) {
        const v = e._clinchVictim; e._clinchVictim = null;
        e.held = v; e.clinchT = 0; e.vel.set(0, 0, 0);
        if (!v) return;
        v.fsm.go('grabbed', { by: e });
        e.play('grab', { restart: true, fade: 0.06, fallback: ['heavy'] });
        e.game.bus.emit(EV.GRAB, { actor: e, victim: v, moveId: 'enemy_grab' });
      },
      update(e, dt) {
        const v = e.held, G = e.def.grab || {};
        e.friction(14, dt);
        if (!v || v.removed || !v.fsm.is('grabbed')) return 'idle';
        const t = ++e.clinchT, tossAt = G.tossAt ?? 34, lift = Math.min(1, t / 14);
        v.pos.x = e.pos.x + e.facing * (G.reach ?? 0.85);
        v.pos.z = e.pos.z + 0.02;
        v.pos.y = (G.liftY ?? 1.1) * lift;
        v.facing = -e.facing;
        if (t === tossAt - 10) e.play('throw', { restart: true, fade: 0.05, duration: 0.45, fallback: ['heavy'] });
        if (t >= tossAt) {
          const dir = G.over ? -e.facing : e.facing;
          v.fsm.go('thrown', { by: e, dir, def: { fling: G.fling || { speed: 8, vy: 6 }, damage: G.damage ?? 12, impact: { damage: 6 } }, moveId: 'enemy_toss' });
          e.game.bus.emit(EV.THROW, { actor: e, victim: v, dir });
          e.held = null;
          e.pause(G.recover ?? 30, { anim: 'idle', face: false });
          return undefined;
        }
        return undefined;
      },
      exit(e) { e.held = null; },
    },
  };
}
