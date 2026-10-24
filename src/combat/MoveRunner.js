// MoveRunner: executes one MoveDef (frame data in 60 Hz ticks) on an actor.
//
// ─── MoveDef format (characters/movesets/*.js and enemy types) ─────────────────────────────────────────
//   {
//     anim: 'light_1',                 clip name (default: the move id). animFade: crossfade seconds (default 0.05)
//     animFallback: ['light_2'],       clips tried in order if `anim` isn't authored yet (default ['light_1'])
//     startup: 6, active: 3, recovery: 14,   ticks. total = startup+active+recovery unless `total` is given
//     hits: [{                         hit windows; default = one window [startup, startup+active)
//       from: 6, to: 9,                ticks [from, to) counted from move start (frame 0 = first tick)
//       box: { x: 0.9, y: 0.6, w: 1.5, h: 1.1, d: 0.9, z: 0 },   metres relative to the actor: x forward
//                                      (along facing, box centre), y = box bottom above feet, w/h/d sizes,
//                                      d = depth (belt tolerance ≈ (d + hurt.d)/2), z = depth offset
//       damage: 6, hitstun: 16,        hitstun in ticks
//       knockback: 1.8,                m/s along the hit direction
//       launch: 0,                     m/s upward (>0 launches → airborne knockdown / juggle)
//       knockdown: false,              true = floor the target (last hit of a string)
//       hitstop: 5,                    ticks of per-actor freeze for attacker and victim
//       level: 'light'|'heavy'|'magic', spark: 'hit_spark', sfx: 'hit_light', shake: 0.15 (camera trauma)
//       otg: false,                    can hit downed targets
//       hits: 1, interval: 6,          multi-hit: re-hit the same target every `interval` ticks, up to `hits`
//       dir: 0,                        0 = away from attacker, ±1 = force world direction, 'facing', 'back' (= −facing)
//       reaction: 'hit_high'           victim's hitstun clip (default hit_high; e.g. 'hit_low')
//       bounce: 0,                     >0 = GROUND BOUNCE: victim is spiked into the floor and rebounds at this m/s (juggle-able)
//     }],
//     move: [{ from: 2, to: 9, speed: 2.5, vy: 0, ease: 'out' }],  root motion along facing (m/s); vy sets vertical vel once at `from`
//     cancels: [{ from: 10, to: 23, on: 'light', into: 'light_2', hit: true, cond: 'close' }],
//                                      on = input action; into = move id or '@dodge' '@jump' '@idle'; hit:true = only if
//                                      this move connected; whiff:true = only if it missed; cond = controller predicate
//                                      (Hero.cancelAllowed: 'close' | 'far' | 'air' | 'ground'); turn:false = keep facing
//     clash: 'low'|'mid'|'high',       dash-attack priority (dash-clash rules, DESIGN §3)
//     invuln: [from, to],              i-frames window
//     armor: 6 | { from, to, damage },  super armor: during [from, to) (default 0..startup) hits dealing < damage (and
//                                      not knockdown) hurt but don't interrupt the move (Combatant.superArmor)
//     air: false, endOnLand: true, landInto: 'land',   aerial moves end when grounded
//     gravity: 1,                      gravity scale while the move runs
//     friction: 10,                    ground friction when no root motion window is active
//     tracking: 0,                     depth homing toward the target during startup (m/s)
//     next: 'light_2'                  documentation hint for strings (Hero uses cancels)
//     landInto: 'land',                state OR move id started on landing (air moves), e.g. an air slam's shockwave move
//     charge: { at, levels, max, scale }   hold-to-charge (Hero): holding the button at frame `at` pauses the move in the
//                                      'charge' state; levels = hold ticks for charge 1..3; release resumes the move with
//                                      its hit windows scaled by scale[level-1] (damage/knockback/launch/hitstop/shake mults)
//     kind: 'throw'                    not run by MoveRunner: Hero's 'throw' state (grab → lift → fling), fields:
//                                      { grab, release, total, lift:{x,y}, fling:{speed,vy}, damage, impact:{hit data}, maxWeight }
//   }
import { boxFrom, makeBox } from '../core/aabb.js';
import { DEPTH_TOL } from '../core/config.js';
import { EASE } from '../core/math.js';

export function moveTotal(def) { return def.total ?? ((def.startup || 0) + (def.active || 0) + (def.recovery || 0)); }

/** Normalize hit windows (fill defaults once per def). */
export function hitWindows(def) {
  if (def._wins) return def._wins;
  const base = def.hits && def.hits.length ? def.hits : (def.active ? [{}] : []);
  def._wins = base.map((h, i) => ({
    from: h.from ?? def.startup ?? 0,
    to: h.to ?? ((h.from ?? def.startup ?? 0) + (def.active || 1)),
    box: { x: 0.9, y: 0.4, w: 1.4, h: 1.2, d: DEPTH_TOL * 2 - 0.25, z: 0, ...(h.box || {}) },
    damage: 5, hitstun: 16, knockback: 1.5, launch: 0, knockdown: false, hitstop: 5, level: 'light', spark: 'hit_spark',
    sfx: null, shake: null, otg: false, hits: 1, interval: 6, dir: 0,
    ...h, index: i,
  }));
  return def._wins;
}

export class MoveRunner {
  /**
   * @param {import('../core/Actor.js').Actor} actor
   * @param {string} id
   * @param {object} def MoveDef
   */
  constructor(actor, id, def) {
    this.actor = actor;
    this.id = id;
    this.def = def;
    this.frame = -1;
    this.total = moveTotal(def);
    this.wins = hitWindows(def);
    /** per window: Map targetId → hit count / last tick */
    this.hitLog = this.wins.map(() => new Map());
    this.anyHit = false;
    this.hitCount = 0;
    this.done = false;
    this._activeFired = new Set();
    this._box = makeBox();
  }

  /** Advance one tick: root motion + completion. */
  tick(dt) {
    const a = this.actor, d = this.def;
    this.frame++;
    const f = this.frame;
    let moving = false;
    if (d.move) for (const m of d.move) {
      if (f >= m.from && f < m.to) {
        moving = true;
        const u = (f - m.from) / Math.max(1, m.to - m.from);
        const k = m.ease && EASE[m.ease] ? 1 - EASE[m.ease](u) : 1;
        if (m.speed !== undefined) a.vel.x = a.facing * m.speed * (m.ease ? Math.max(0, k) : 1);
        if (m.vz !== undefined) a.vel.z = m.vz;
        if (m.vy !== undefined && f === m.from) { a.vel.y = m.vy; a.grounded = false; }
      }
    }
    if (!moving && a.grounded) a.friction(d.friction ?? 10, dt);
    if (d.tracking && f < (d.startup || 0) && this.target) {
      const dz = this.target.pos.z - a.pos.z;
      a.vel.z = Math.sign(dz) * Math.min(Math.abs(dz) / dt, d.tracking);
    }
    if (d.invuln && f >= d.invuln[0] && f < d.invuln[1]) a.invuln = Math.max(a.invuln, 1);
    if (d.armor) { // super armor window (default: the whole startup); Combatant.endMove clears it
      const A = typeof d.armor === 'number' ? { damage: d.armor } : d.armor;
      a.superArmor = f >= (A.from ?? 0) && f < (A.to ?? d.startup ?? 0) ? A.damage : 0;
      this.armored = true;
    }
    if (f >= this.total - 1) this.done = true;
  }

  /** Active windows on the current frame. */
  active() {
    const f = this.frame, out = [];
    for (const w of this.wins) if (f >= w.from && f < w.to) out.push(w);
    return out;
  }

  /** True on the first frame of a window (used for swing SFX/trail events). */
  firstActive(w) {
    if (this.frame === w.from && !this._activeFired.has(w.index)) { this._activeFired.add(w.index); return true; }
    return false;
  }

  /** World AABB for a window's box on the current frame. */
  worldBox(w, out = this._box) {
    const a = this.actor, b = w.box;
    return boxFrom(out, a.pos.x + a.facing * b.x, a.pos.y + b.y, a.pos.z + (b.z || 0), b.w, b.h, b.d);
  }

  /** May this window hit `target` now? (one hit per swing per target unless multi-hit) */
  canHit(w, target) {
    const log = this.hitLog[w.index].get(target.id);
    if (!log) return true;
    if (log.count >= w.hits) return false;
    return this.frame - log.frame >= w.interval;
  }

  /** Replace this run's hit windows with scaled copies (charge levels). mul: { damage, knockback, launch, hitstop, shake, ...extra fields } */
  scaleHits(mul) {
    const { damage = 1, knockback = 1, launch = 1, hitstop = 0, shake = 1, ...extra } = mul || {};
    this.wins = this.wins.map((w) => ({ ...w, ...extra, damage: w.damage * damage, knockback: w.knockback * knockback, launch: w.launch * launch,
      hitstop: w.hitstop + hitstop, shake: w.shake == null ? w.shake : w.shake * shake }));
  }

  registerHit(w, target) {
    this.lastTarget = target;
    const m = this.hitLog[w.index];
    const log = m.get(target.id) || { count: 0, frame: 0 };
    log.count++; log.frame = this.frame;
    m.set(target.id, log);
    this.anyHit = true;
    this.hitCount++;
  }

  /** Cancel lookup: returns the matching cancel entries for this frame. */
  cancelsNow() {
    const f = this.frame, out = [];
    if (this.def.cancels) for (const c of this.def.cancels) {
      if (f < (c.from ?? 0) || f > (c.to ?? this.total)) continue;
      if (c.hit && !this.anyHit) continue;
      if (c.whiff && this.anyHit) continue;
      out.push(c);
    }
    return out;
  }
}
