// Attack-token director (DESIGN.md §4): at most `maxPerTarget` enemies may commit to attacking one player at
// a time; everyone else circles, spaces or flanks. Difficulty tunes maxPerTarget and token hold times.
//
//   tokens.request(enemy, target) → true if the enemy holds (or was just granted) a token on target
//   tokens.release(enemy)           give it back (after an attack; update() also drops stunned/dead holders)
//   tokens.holders(target)          Map(enemyId → grantedTick)
//   tokens.capFor(target) → n       optional hook (CrowdDirector: difficulty + combo pressure + co-op)
//   tokens.canGrant(enemy, target, holders) → bool  optional veto (CrowdDirector: shared threat / elite caps)
//   tokens.preempt(enemy, target, holders) → holderId | null  optional priority bump when the cap is full (r3 tanks)
export class AttackTokenDirector {
  constructor(game, { maxPerTarget = 2, holdTicks = 150 } = {}) {
    this.game = game;
    this.maxPerTarget = maxPerTarget;
    this.holdTicks = holdTicks;
    this.byTarget = new Map(); // targetId → Map(enemyId → grantedTick)
    this.byEnemy = new Map();  // enemyId → targetId
  }

  holders(target) { return this.byTarget.get(target.id) || new Map(); }

  has(enemy) { return this.byEnemy.has(enemy.id); }

  request(enemy, target) {
    if (!target) return false;
    const cur = this.byEnemy.get(enemy.id);
    if (cur === target.id) return true;
    if (cur !== undefined) this.release(enemy);
    let m = this.byTarget.get(target.id);
    if (!m) this.byTarget.set(target.id, (m = new Map()));
    const cap = this.capFor ? this.capFor(target) : this.maxPerTarget;
    if (m.size >= cap) {
      // Priority hook (CrowdDirector.preempt): a starved tank may bump a lower-priority holder.
      const bump = this.preempt ? this.preempt(enemy, target, m) : null;
      if (bump == null) return false;
      m.delete(bump); this.byEnemy.delete(bump);
    }
    if (this.canGrant && !this.canGrant(enemy, target, m)) return false;
    m.set(enemy.id, this.game.tick);
    this.byEnemy.set(enemy.id, target.id);
    return true;
  }

  release(enemy) {
    const t = this.byEnemy.get(enemy.id);
    if (t === undefined) return;
    this.byEnemy.delete(enemy.id);
    const m = this.byTarget.get(t);
    if (m) m.delete(enemy.id);
  }

  /** Expire stale tokens and drop removed/dead holders. */
  update() {
    const w = this.game.world;
    for (const [tid, m] of this.byTarget) {
      for (const [eid, at] of m) {
        const e = w.byId.get(eid);
        // A holder that got stunned/knocked down/grabbed gives its token back at once, so a waiting foe steps in.
        const stunned = e && e.fsm && e.fsm.tagged('stunned');
        if (!e || !e.alive || e.removed || stunned || this.game.tick - at > this.holdTicks) { m.delete(eid); this.byEnemy.delete(eid); }
      }
      if (!w.byId.get(tid)) this.byTarget.delete(tid);
    }
  }

  clear() { this.byTarget.clear(); this.byEnemy.clear(); }
}
