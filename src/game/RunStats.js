// RunStats (game.stats): per-run, per-stage, per-player bookkeeping for the stage-clear tally, the end-of-game
// YOUR STRENGTH / CLASS screen (DESIGN §7) and the high-score table. Pure listener: never changes gameplay.
//   stats.beginRun() · stats.stage(id) → current stage record · stats.run → { stages: [...], startedAt }
//   stageRating(rec, p) → 'F'…'AA'|'SA'   tally(rec, p) → { rows, bonus }   strength(run, p) → { value, cls, perfect }
import { EV } from '../core/EventBus.js';

/** Class ladder (A+++ … F): min strength, title, joke "percent of players" column. */
export const CLASSES = [
  { id: 'A+++', min: 420, title: 'Knot-Lord of the Copper Ax', pct: '0.01' },
  { id: 'A++', min: 340, title: 'Stormhewn Legend', pct: '0.3' },
  { id: 'A+', min: 285, title: 'Scourge of Deathcoil', pct: '1.6' },
  { id: 'A', min: 240, title: 'Champion of Ashen Wilds', pct: '4.2' },
  { id: 'B+', min: 200, title: 'Veteran Axe-Swinger', pct: '9.8' },
  { id: 'B', min: 168, title: 'Tavern Hero', pct: '14.4' },
  { id: 'C+', min: 138, title: 'Promising Squire', pct: '17.1' },
  { id: 'C', min: 110, title: 'Enthusiastic Farmhand', pct: '19.9' },
  { id: 'D+', min: 86, title: 'Pot-Thief Bait', pct: '22.6' },
  { id: 'D', min: 64, title: 'Chicken-Leg Enthusiast', pct: '31.0' },
  { id: 'E', min: 46, title: 'Kicked by a Gnome', pct: '48.5' },
  { id: 'F', min: 0, title: 'Sleeps Through Thieves’ Night', pct: '99.9' },
];
export const STAGE_RATINGS = [['SA', 96], ['AA', 86], ['A', 75], ['B', 62], ['C', 50], ['D', 38], ['E', 25], ['F', -1e9]];
export const PAR_SECONDS = { 1: 240, 2: 270, 3: 270, 4: 300, 5: 330, bonus: 60, duel: 600 };
const stageNum = (id) => { const n = parseInt(String(id).replace(/^stage/, ''), 10); return Number.isFinite(n) ? n : 0; };

export class RunStats {
  constructor(game) {
    this.game = game;
    this.name = 'stats';
    this.order = 52;
    this.run = null;
    this.cur = null;
    this.beginRun();
    const s = game.bus.scope();
    this.scope = s;
    s.on(EV.STAGE_START, (e) => this.stage(e.stageId));
    s.on(EV.KO, (e) => {
      const r = this.cur, a = e.by; if (!r || !a || a.playerIndex == null || !e.actor || e.actor.team !== 'enemies') return;
      const P = r.players[a.playerIndex]; if (!P) return;
      const ring = !!(e.ringout || e.ringOut || e.cause === 'ringout');
      const v = ((e.actor.score && e.actor.score.ko) || 150) / 150;
      P.kills++; P.killValue += v * (ring ? 2 : 1); if (ring) P.ringouts++;
    });
    s.on(EV.PLAYER_DOWN, (e) => { const P = this.cur && this.cur.players[e.player]; if (P) P.deaths++; });
    s.on(EV.POT_PICKUP, (e) => { const i = e.hero && e.hero.playerIndex; const P = this.cur && i != null && this.cur.players[i]; if (P) { if (e.kind === 'food') P.food++; else P.pots += e.amount || 1; } });
    s.on(EV.HIT, (e) => {
      const t = e.target; if (!this.cur || !t || t.kind !== 'hero' || t.playerIndex == null || e.blocked) return;
      const P = this.cur.players[t.playerIndex]; if (P) { P.damage += e.damage || 0; P.screenHurt = true; }
    });
    s.on(EV.SCREEN_CLEAR, () => { if (!this.cur) return; for (const P of this.cur.players) { if (!P.screenHurt) P.cleanScreens++; P.screenHurt = false; } this.cur.screens++; });
    s.on(EV.COMBO_END, (e) => { const P = this.cur && this.cur.players[e.player]; if (P) P.bestCombo = Math.max(P.bestCombo, e.count || 0); });
    s.on(EV.STAGE_CLEAR, () => { if (this.cur) { this.cur.cleared = true; this.cur.time = this.game.time - this.cur.t0; this._snapScores(); } });
  }

  beginRun() { this.run = { stages: [], startedAt: Date.now() }; this.cur = null; }

  _snapScores() { const s = this.game.session; if (!s || !this.cur) return; this.cur.players.forEach((P, i) => { P.scoreEnd = s.players[i] ? s.players[i].score : 0; }); }

  stage(id) {
    const sid = String(id).replace(/^stage/, '');
    const s = this.game.session;
    const rec = { id: sid, num: stageNum(sid), t0: this.game.time, time: 0, cleared: false, screens: 0,
      players: [0, 1].map((i) => ({ active: !!(s && s.players[i] && s.players[i].active), hero: s && s.players[i] ? s.players[i].heroId : null, kills: 0, killValue: 0, ringouts: 0, deaths: 0, pots: 0, food: 0, damage: 0,
        cleanScreens: 0, screenHurt: false, bestCombo: 0, scoreStart: s && s.players[i] ? s.players[i].score : 0, scoreEnd: 0 })) };
    this.run.stages.push(rec);
    this.cur = rec;
    return rec;
  }

  /** Called by the flow when a run ends (game over / ending) so the last stage has a final score and time. */
  close() { if (this.cur && !this.cur.cleared) { this.cur.time = this.game.time - this.cur.t0; this._snapScores(); } }

  update() { const s = this.game.session; if (this.cur && s) this.cur.players.forEach((P, i) => { if (s.players[i] && s.players[i].active) { P.active = true; P.hero = s.players[i].heroId; } }); }

  dispose() { this.scope.dispose(); }
}

/** Stage-clear tally rows + bonus total for player p. */
export function tally(rec, p) {
  const P = rec.players[p];
  const par = PAR_SECONDS[rec.id] ?? 240;
  const timeBonus = Math.max(0, Math.round((par - rec.time) * 40 / 10) * 10);
  const potBonus = P.pots * 500;
  const noDmg = P.damage <= 0 ? 10000 : P.cleanScreens * 1500;
  const comboBonus = Math.floor(P.bestCombo / 10) * 1000;
  const rows = [
    { k: 'Stage score', v: Math.max(0, (P.scoreEnd || 0) - P.scoreStart) },
    { k: `Time ${fmtTime(rec.time)}`, v: timeBonus, bonus: true },
    { k: `Pots gathered × ${P.pots}`, v: potBonus, bonus: true },
    { k: P.damage <= 0 ? 'Untouched!' : `Clean screens × ${P.cleanScreens}`, v: noDmg, bonus: true },
    { k: `Best combo ${P.bestCombo}`, v: comboBonus, bonus: true },
  ];
  return { rows, bonus: timeBonus + potBonus + noDmg + comboBonus };
}

export function stageRating(rec, p) {
  const P = rec.players[p];
  const par = PAR_SECONDS[rec.id] ?? 240;
  let pts = 70 - P.deaths * 22 - Math.min(40, P.damage / 3.5) + Math.min(14, (par - rec.time) / 8) + Math.min(10, P.bestCombo / 3) + Math.min(10, P.cleanScreens * 3);
  if (P.damage <= 0) pts += 12;
  return STAGE_RATINGS.find(([, min]) => pts >= min)[0];
}

/** YOUR STRENGTH: 30 + stage-weighted kill value / (deaths + 1); ring-out kills count ×2 (counted in killValue). */
export function strength(run, p) {
  let kv = 0, deaths = 0;
  const rows = [];
  for (const r of run.stages) {
    const P = r.players[p]; if (!P || !P.active) continue;
    const w = r.num || (r.id === 'bonus' ? 0.5 : 1);
    kv += P.killValue * w; deaths += P.deaths;
    rows.push({ id: r.id, num: r.num, score: Math.max(0, (P.scoreEnd || 0) - P.scoreStart), deaths: P.deaths, kills: P.kills });
  }
  const value = Math.round(30 + kv / (deaths + 1));
  const cls = CLASSES.find((c) => value >= c.min) || CLASSES[CLASSES.length - 1];
  const cleared = run.stages.filter((r) => r.num && r.cleared).length;
  return { value, cls, deaths, perfect: deaths === 0 && cleared > 0, rows };
}

export const fmtTime = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
