// GameSession (game.session): players, lives (3 per credit), continues (3), score and its multipliers (DESIGN §7).
//   session.join(i, heroId, { bot }) · session.addScore(i, pts, reason) · session.info()
//   session.autoContinue = true      bots/captures continue automatically (never GAME OVER)
//   session.dropIn = true            an inactive player pressing START during a stage joins with a free hero
// Listens to bus events for scoring and life loss; respawns heroes; runs the "CONTINUE? 9…0" countdown in the
// dead player's HUD slot while the partner keeps playing; ends the game when everyone is out.
import { EV } from '../core/EventBus.js';
import { HERO_IDS } from '../core/config.js';
import { reportError } from '../core/log.js';

export const LIVES_PER_CREDIT = 3;
export const CONTINUES = 3;
/** Score extends (arcade 1UP): one extra life each time a player's score crosses a threshold. */
export const EXTENDS = [15000, 35000, 60000, 90000, 125000];
export const CONTINUE_SECONDS = 10;
/** The digit shown for a countdown timer: 9 … 0 over CONTINUE_SECONDS. */
export const continueDigit = (t) => Math.max(0, Math.min(9, Math.ceil(t) - 1));

export class GameSession {
  constructor(game) {
    this.game = game;
    this.name = 'session';
    this.order = 50;
    this.autoContinue = false;
    this.dropIn = true;
    this.players = [0, 1].map((i) => this._blank(i));
    this.scope = game.bus.scope();
    this.scope.on(EV.HIT, (ev) => {
      const a = ev.attacker;
      if (a && a.playerIndex != null && !ev.blocked && ev.target && ev.target.team !== a.team) {
        const mul = game.combo && game.combo.multiplier ? game.combo.multiplier(a.playerIndex) : 1;
        const base = ev.target.score ? ev.target.score.hit : 10;
        this.addScore(a.playerIndex, Math.round((base + ev.damage * 2) * mul), 'hit');
      }
    });
    this.scope.on(EV.KO, (e) => {
      const a = e.by;
      if (a && a.playerIndex != null && e.actor.team === 'enemies') this.addScore(a.playerIndex, (e.actor.score && e.actor.score.ko) || 150, 'ko');
    });
    this.scope.on(EV.PLAYER_DOWN, (e) => this.onPlayerDown(e.player, e.hero));
  }

  _blank(i) { return { index: i, active: false, heroId: null, actor: null, lives: LIVES_PER_CREDIT, continues: CONTINUES, score: 0, bot: false, out: false, continueTimer: -1, deaths: 0, carry: null }; }

  reset() { this.players = [0, 1].map((i) => this._blank(i)); }

  join(i, heroId, { bot = false } = {}) {
    const p = this.players[i];
    Object.assign(p, { active: true, heroId, bot, out: false, continueTimer: -1, carry: null });
    this.game.bus.emit(EV.PLAYER_JOIN, { player: i, heroId });
    return p;
  }

  addScore(i, pts, reason = '') {
    const p = this.players[i];
    if (!p || !p.active) return;
    const before = p.score;
    p.score += pts;
    this.game.bus.emit(EV.SCORE, { player: i, points: pts, total: p.score, reason });
    for (const t of EXTENDS) if (before < t && p.score >= t) {
      p.lives++;
      this.game.bus.emit('playerExtend', { player: i, lives: p.lives, at: t });
      if (this.game.ui && this.game.ui.toast) this.game.ui.toast(`${i + 1}P  EXTRA LIFE`, 2);
      if (this.game.audio && this.game.audio.play) try { this.game.audio.play('ui_confirm'); } catch (e) { /* optional */ }
    }
  }

  onPlayerDown(i, hero) {
    const p = this.players[i];
    if (!p) return;
    p.lives--;
    p.deaths++;
    if (p.lives <= 0 && p.continues > 0 && (p.bot || this.autoContinue)) { p.continues--; p.lives = LIVES_PER_CREDIT; }
    if (p.lives > 0) { this.game.after(40, () => this.respawn(i)); return; }
    if (p.continues > 0) {
      p.continueTimer = CONTINUE_SECONDS - 0.001;
      this.game.bus.emit(EV.CONTINUE_START, { player: i, seconds: CONTINUE_SECONDS });
      return;
    }
    this.playerOut(i);
  }

  respawn(i) {
    const p = this.players[i], hero = p.actor;
    if (!hero) return;
    const cam = this.game.cameraRig;
    const x = cam ? cam.focus.x - 1.5 : hero.pos.x;
    hero.respawn({ x, z: 0, fromSky: true });
    this.game.bus.emit(EV.RESPAWN, { player: i, hero });
  }

  playerOut(i) {
    const p = this.players[i];
    p.out = true; p.continueTimer = -1;
    this.game.bus.emit(EV.PLAYER_OUT, { player: i });
    if (this.players.every((q) => !q.active || q.out)) this.game.bus.emit(EV.GAME_OVER, {});
  }

  update(dt) {
    const g = this.game;
    for (const p of this.players) {
      const inp = g.input.players[p.index];
      // CONTINUE? countdown (start = continue with a fresh credit).
      if (p.active && p.continueTimer >= 0) {
        const before = Math.ceil(p.continueTimer);
        p.continueTimer -= dt;
        if (inp && inp.pressed('start')) {
          p.continues--; p.lives = LIVES_PER_CREDIT; p.continueTimer = -1;
          g.bus.emit(EV.CONTINUE_TAKEN, { player: p.index });
          this.respawn(p.index);
        } else if (p.continueTimer < 0) this.playerOut(p.index);
        else if (Math.ceil(p.continueTimer) !== before) g.bus.emit(EV.CONTINUE_TICK, { player: p.index, seconds: continueDigit(p.continueTimer) });
      }
      // Drop-in during a stage.
      if (!p.active && this.dropIn && inp && inp.pressed('start') && g.flow && g.flow.state === 'stage') g.track(this._dropIn(p.index));
    }
  }

  async _dropIn(i) {
    const taken = this.players.filter((q) => q.active).map((q) => q.heroId);
    const heroId = HERO_IDS.find((h) => !taken.includes(h)) || HERO_IDS[0];
    this.join(i, heroId);
    try {
      const { spawnPlayerHero } = await import('./StageRunner.js');
      await spawnPlayerHero(this.game, { player: i, heroId, bot: false }, { dropIn: true });
    } catch (e) { reportError('session.dropIn', e); }
  }

  info() { return this.players.filter((p) => p.active).map((p) => ({ player: p.index + 1, hero: p.heroId, lives: p.lives, continues: p.continues, score: p.score, bot: p.bot, out: p.out, continue: p.continueTimer >= 0 ? continueDigit(p.continueTimer) : null })); }

  dispose() { this.scope.dispose(); }
}
