// ComboCounter: per-player hit chain + style rank (D→C→B→A→S→KNOT, DESIGN.md §3). The rank's multiplier
// feeds scoring. A combo resets when the player takes damage or after 2.5 s without landing a hit.
// Emits EV.COMBO on each counted hit and EV.COMBO_END when a chain ends. HUD/audio listen to those.
import { EV } from '../core/EventBus.js';

export const RANKS = [
  { id: 'D', at: 2, mul: 1.0 }, { id: 'C', at: 5, mul: 1.2 }, { id: 'B', at: 10, mul: 1.5 },
  { id: 'A', at: 18, mul: 1.8 }, { id: 'S', at: 30, mul: 2.2 }, { id: 'KNOT', at: 50, mul: 3.0 },
];
export const COMBO_TIMEOUT_TICKS = 150;

export class ComboCounter {
  constructor(game) {
    this.game = game;
    this.name = 'combo';
    this.order = 35;
    this.players = [0, 1].map(() => ({ count: 0, timer: 0, best: 0, rank: null }));
    this.scope = game.bus.scope();
    this.scope.on(EV.HIT, (ev) => this.onHit(ev));
  }

  rankFor(count) {
    let r = null;
    for (const k of RANKS) if (count >= k.at) r = k;
    return r;
  }

  onHit(ev) {
    const a = ev.attacker, t = ev.target;
    if (t && t.playerIndex != null && !ev.blocked) this.end(t.playerIndex);
    if (a && a.playerIndex != null && !ev.blocked) {
      const p = this.players[a.playerIndex];
      p.count++; p.timer = COMBO_TIMEOUT_TICKS;
      p.best = Math.max(p.best, p.count);
      p.rank = this.rankFor(p.count);
      ev.comboCount = p.count;
      this.game.bus.emit(EV.COMBO, { player: a.playerIndex, count: p.count, rank: p.rank ? p.rank.id : null, multiplier: p.rank ? p.rank.mul : 1 });
    }
  }

  end(i) {
    const p = this.players[i];
    if (p.count > 0) this.game.bus.emit(EV.COMBO_END, { player: i, count: p.count, rank: p.rank ? p.rank.id : null });
    p.count = 0; p.timer = 0; p.rank = null;
  }

  multiplier(i) { const p = this.players[i]; return p && p.rank ? p.rank.mul : 1; }

  update() {
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (p.timer > 0 && --p.timer === 0) this.end(i);
    }
  }

  dispose() { this.scope.dispose(); }
}
