// CombatSystem: per-tick hitbox/hurtbox overlaps → HitEvents; applies hitstop, emits bus events.
// Also the shared entry point for non-melee damage (projectiles, magic, hazards): combat.applyHit(...).
//
//   HitEvent = { attacker, target, hit (window data), moveId, damage, dir:±1, point:{x,y,z}, level,
//                knockback, launch, hitstun, knockdown, otg, hitstop, blocked, killed, comboCount }
//   Target contract (Combatant implements it): target.hurtable (bool), target.canBeHit(ev) → bool,
//   target.hurtboxes() → AABB[], target.receiveHit(ev) → bool (accepted)
import { overlaps, overlapCenter } from '../core/aabb.js';
import { EV } from '../core/EventBus.js';
import { reportError } from '../core/log.js';

export class CombatSystem {
  constructor(game) {
    this.game = game;
    this.name = 'combat';
    this.order = 30;
    this.friendlyFire = false;
    /** Global damage multipliers per team (difficulty). */
    this.damageScale = { players: 1, enemies: 1, neutral: 1 };
    this.debugBoxes = [];
    /** Hooks: fn(ev) may mutate or veto (return false) a hit before it is applied. */
    this.preHitHooks = [];
    this._pt = { x: 0, y: 0, z: 0 };
  }

  update() {
    const actors = this.game.world.actors;
    this.debugBoxes.length = 0;
    const pending = [];
    for (const a of actors) {
      const run = a.attack;
      if (!run || run.done || a.hitstop > 0 || !a.alive || a.removed) continue;
      const wins = run.active();
      for (const w of wins) {
        const box = run.worldBox(w);
        if (this.game.params.debug) this.debugBoxes.push({ ...box, kind: 'hit' });
        if (run.firstActive(w)) this.game.bus.emit(EV.ATTACK_ACTIVE, { actor: a, move: run.def, moveId: run.id, hit: w, index: w.index });
        for (const t of actors) {
          if (t === a || !t.hurtable || t.removed) continue;
          if (!this.friendlyFire && t.team === a.team) continue;
          if (t.team === 'neutral' && !t.hittableByAll) continue;
          if (!run.canHit(w, t)) continue;
          const boxes = t.hurtboxes();
          let hitBox = null;
          for (const hb of boxes) if (overlaps(box, hb)) { hitBox = hb; break; }
          if (!hitBox) continue;
          const pt = overlapCenter(box, hitBox, { x: 0, y: 0, z: 0 });
          pending.push({ a, t, w, run, pt });
        }
      }
    }
    for (const p of pending) {
      if (!p.run.canHit(p.w, p.t)) continue;
      const ev = this.makeEvent(p.a, p.t, p.w, { point: p.pt, moveId: p.run.id });
      if (this.resolve(ev)) p.run.registerHit(p.w, p.t);
    }
    if (this.game.params.debug) {
      for (const t of actors) if (t.hurtable) for (const hb of t.hurtboxes()) this.debugBoxes.push({ ...hb, kind: 'hurt' });
    }
  }

  makeEvent(attacker, target, w, { point = null, moveId = null, dir = null } = {}) {
    let d = dir;
    if (d === null) {
      if (w.dir === 'facing') d = attacker ? attacker.facing : 1;
      else if (w.dir === 'back') d = attacker ? -attacker.facing : -1;
      else if (w.dir === 1 || w.dir === -1) d = w.dir;
      else d = attacker ? Math.sign(target.pos.x - attacker.pos.x) || attacker.facing : 1;
    }
    // Outgoing: team difficulty scale × attacker.damageMul. Incoming: target.damageTakenMul (hero defence, DESIGN §7).
    const scale = (attacker ? (this.damageScale[attacker.team] ?? 1) * (attacker.damageMul ?? 1) : 1) * (target.damageTakenMul ?? 1);
    return {
      attacker, target, hit: w, moveId,
      damage: w.damage * scale,
      dir: d,
      point: point || { x: (target.pos.x + (attacker ? attacker.pos.x : target.pos.x)) / 2, y: target.pos.y + target.height * 0.6, z: target.pos.z },
      level: w.level, knockback: w.knockback, launch: w.launch, hitstun: w.hitstun, knockdown: w.knockdown,
      otg: w.otg, hitstop: w.hitstop, blocked: false, killed: false,
    };
  }

  /** Apply a HitEvent to its target. Returns true if accepted. */
  resolve(ev) {
    const t = ev.target;
    for (const h of this.preHitHooks) { try { if (h(ev) === false) return false; } catch (e) { reportError('combat.preHit', e); } }
    if (!t.canBeHit || !t.canBeHit(ev)) return false;
    let ok = false;
    try { ok = t.receiveHit(ev); } catch (e) { reportError(`combat.receiveHit:${t.typeId}`, e); }
    if (!ok) return false;
    const hs = ev.blocked ? Math.ceil(ev.hitstop * 0.6) : ev.hitstop;
    if (ev.attacker && hs > 0) ev.attacker.hitstop = Math.max(ev.attacker.hitstop, hs);
    if (hs > 0) { t.hitstop = Math.max(t.hitstop, hs + 1); t.hitstopShake = ev.level === 'heavy' ? 0.06 : 0.04; }
    this.game.bus.emit(EV.HIT, ev);
    if (ev.killed) this.game.bus.emit(EV.KO, { actor: t, by: ev.attacker, ev });
    return true;
  }

  /**
   * Non-melee hit (projectile, spell, trap). hitData uses the hit-window fields (damage, knockback, ...).
   * @returns {boolean} accepted
   */
  applyHit(attacker, target, hitData, opts = {}) {
    const w = { damage: 5, hitstun: 16, knockback: 2, launch: 0, knockdown: false, hitstop: 4, level: 'magic', spark: 'hit_spark', otg: false, dir: 0, ...hitData };
    const ev = this.makeEvent(attacker, target, w, opts);
    return this.resolve(ev);
  }

  /** Hit everything of `team` inside an AABB or radius. Returns accepted HitEvents count. */
  areaHit(attacker, { box = null, center = null, radius = 0, team = 'enemies' }, hitData, opts = {}) {
    let n = 0;
    for (const t of this.game.world.query({ team })) {
      if (!t.hurtable) continue;
      let inside = false;
      if (box) inside = t.hurtboxes().some((hb) => overlaps(box, hb));
      else if (center) inside = Math.hypot(t.pos.x - center.x, (t.pos.z - center.z) * 1.4) <= radius;
      if (inside && this.applyHit(attacker, t, hitData, opts)) n++;
    }
    return n;
  }
}
