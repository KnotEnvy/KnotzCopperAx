// AI system hub (game.ai): attack tokens + the crowd director. Behaviours read game.ai.tokens / game.ai.director.
// Specialists extend via game.ai.directors.push({ update(dt, game) }) for extra crowd logic (bosses, set pieces).
//   game.ai.difficulty  'easy' | 'normal' | 'hard'
//   game.ai.director    CrowdDirector (slots, co-op target split, pressure, thrown-ally reactions, anti-stunlock)
import { AttackTokenDirector } from './AttackTokenDirector.js';
import { CrowdDirector, DIFFICULTY } from './CrowdDirector.js';
import { reportError } from '../core/log.js';

export class AISystem {
  constructor(game, { difficulty = 'normal' } = {}) {
    this.game = game;
    this.name = 'ai';
    this.order = 10;
    this.difficulty = DIFFICULTY[difficulty] ? difficulty : 'normal';
    const cfg = DIFFICULTY[this.difficulty];
    this.tokens = new AttackTokenDirector(game, { maxPerTarget: cfg.tokens, holdTicks: cfg.tokenHold });
    this.director = new CrowdDirector(game, this, cfg);
    this.tokens.capFor = (t) => this.director.tokenCap(t);
    this.tokens.canGrant = (e, t, holders) => this.director.canGrant(e, t, holders);
    this.tokens.preempt = (e, t, holders) => this.director.preempt(e, t, holders);
    this.directors = [];
    // C2 r1: the director's body-space floor runs right AFTER physics (world = order 20), so it is the last word on
    // where bodies stand before the frame is drawn.
    if (game.addSystem) game.addSystem({ name: 'ai.space', order: 21, update: () => { try { this.director.space(); } catch (e) { if (!this._spaceErr) { this._spaceErr = true; reportError('ai.space', e); } } } });
  }
  update(dt) {
    this.tokens.update();
    this.director.update(dt);
    for (const d of this.directors) d.update(dt, this.game);
  }
  reset() { this.tokens.clear(); this.director.reset(); }
}
