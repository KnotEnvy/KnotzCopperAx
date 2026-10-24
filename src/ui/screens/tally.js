// Stage-clear tally: per player, rows reveal one by one (stage score, time bonus, pots, no-damage/clean screens,
// best combo), the bonus total counts up, then the stage rating (F…AA/SA) stamps in. CONFIRM skips/continues;
// auto-continues after a few seconds. opts: { rec (RunStats stage record), players: [0,1], stageName, onDone(bonuses) }
import { forge } from '../lettering.js';
import { rule } from '../art.js';
import { h, panel, fmt, CONFIRM } from '../widgets.js';
import { tally, stageRating } from '../../game/RunStats.js';
import { arcadeStageNumber } from '../../game/StageRunner.js';

// C2 r11: the ledger footer is world voice, not the scoring formula (the board read "Rating starts at 70 pts…" as leaked internals).
const SAGA = {
  1: 'The Ashen Wilds lie quiet behind you. The Keep is no longer a rumour.',
  2: 'The Shellback is crossed and the river lies behind you. The road to the Keep goes on.',
  3: 'The Eaglespine winds carried word of your coming; the Serpent Keep has heard it.',
  4: 'The Keep gates hang open. Nothing now stands between you and the Throne of Coils.',
  5: 'The Serpent Throne is empty, the coils lie still, and the Copper Ax is yours.',
  default: 'The road is cleared and the ledger remembers every blow.',
};
const RATE_METAL = { SA: 'ember', AA: 'gold', A: 'gold', B: 'copper', C: 'copper', D: 'bronze', E: 'bronze', F: 'iron' };

export default {
  id: 'tally',
  create(ui, opts = {}) {
    const rec = opts.rec;
    const players = (opts.players || [0]).filter((p) => rec && rec.players[p] && rec.players[p].active);
    const el = h('<div class="kca-tally"><div class="kca-dim"></div></div>');
    // r6: the rating is driven by deaths, damage taken, time, best combo and clean screens — show the two that the bonus lines never
    // did (deaths, damage) as muted INFO rows under the stage score, so two players with identical bonus lines but different
    // damage/deaths visibly earn different grades.
    const data = players.map((p) => {
      const t = tally(rec, p), P = rec.players[p];
      t.rows.splice(1, 0, { k: 'Deaths', v: P.deaths || 0, info: true }, { k: 'Damage taken', v: Math.round(P.damage || 0), info: true });
      return { p, ...t, rating: stageRating(rec, p) };
    });
    const an = rec ? (arcadeStageNumber(ui.game, rec.id) ?? rec.num) : null;
    const RANK_ORDER = ['SA', 'AA', 'A', 'B', 'C', 'D', 'E', 'F'];
    const best = data.map((d) => d.rating).sort((x, y) => RANK_ORDER.indexOf(x) - RANK_ORDER.indexOf(y))[0];
    const bestRating = { SA: 'Songs will be sung of this day', AA: 'Bards will brawl over who tells it first', A: 'The realm takes notice', B: 'A fair fight, fairly won', C: 'Bloodied, but the road goes on', D: 'The healers will be busy', E: 'You limp on, barely standing', F: 'Somehow, still breathing' }[best] || '';
    const rateHtml = (d) => `<div class="kca-rate" data-p="${d.p}"><small>RATING</small><div class="well">${forge(d.rating, { metal: RATE_METAL[d.rating] || 'copper', track: 6, glint: d.rating === 'SA' || d.rating === 'AA' ? 1.6 : false })}</div></div>`;
    const cols = data.map((d) => `<div class="kca-tcol" data-p="${d.p}"><h5>${forge(`${d.p + 1}P · ${(rec.players[d.p].hero || '').toUpperCase()}`, { metal: d.p ? 'p2' : 'p1', track: 10 })}</h5><div class="kca-tbody"><div class="rws">
      ${d.rows.map((r) => `<div class="kca-trow${r.info ? ' info' : ''}"><span>${r.k}</span><b>${r.bonus ? '+' : ''}${fmt(r.v)}</b></div>`).join('')}
      <div class="kca-trow total"><span>Bonus</span><b class="tot">0</b></div></div>${rateHtml(d)}</div></div>`).join('');
    const kicker = an ? `STAGE ${an}` : 'STAGE';
    const p = panel(`<div class="hd"><div class="k">${forge(kicker, { metal: 'bronze', track: 20 })}</div><div class="m">${forge('STAGE CLEAR', { metal: 'gold', track: 14, glint: 2.6 })}</div></div>${rule({ width: 700 })}
      <div class="kca-tcols" style="grid-template-columns:repeat(${Math.max(1, data.length)},1fr)">${cols}</div>
      <div class="kca-rrule"><div class="saga">${SAGA[an] || SAGA.default}</div><div class="cl">${bestRating}</div></div>`);
    if (data.length > 1) p.classList.add('duo');
    const c = h('<div class="kca-center"></div>'); c.appendChild(p); el.appendChild(c);
    const rows = data.map((d) => [...p.querySelectorAll(`.kca-tcol[data-p="${d.p}"] .kca-trow`)]);
    const tots = data.map((d) => p.querySelector(`.kca-tcol[data-p="${d.p}"] .tot`));
    const rates = [...p.querySelectorAll('.kca-rate')];
    const nRows = data.length ? rows[0].length : 0;
    let t = 0, finished = false, stamped = false;
    const T_ROW = 0.32, T_COUNT = 1.1, HOLD = 3.2;
    const tEnd = nRows * T_ROW + T_COUNT;
    if (opts.t0) t = Math.min(opts.t0, tEnd + 0.01); // showcase: preview a later moment
    const done = () => { if (finished) return; finished = true; if (opts.onDone) opts.onDone(data.map((d) => ({ player: d.p, bonus: d.bonus, rating: d.rating }))); };
    const step = () => {
      const shown = Math.min(nRows, Math.floor(t / T_ROW) + 1);
      rows.forEach((rs) => rs.forEach((r, i) => r.classList.toggle('on', i < shown)));
      const k = Math.max(0, Math.min(1, (t - (nRows - 1) * T_ROW) / T_COUNT));
      data.forEach((d, i) => { tots[i].textContent = fmt(d.bonus * (1 - Math.pow(1 - k, 3))); });
      if (k >= 1 && !stamped) { stamped = true; rates.forEach((r) => r.classList.add('on')); p.querySelector('.kca-rrule').classList.add('on'); if (ui.game.audio) ui.game.audio.play('hit_heavy', { bus: 'ui', volume: 0.6 }); }
    };
    step();
    return {
      el, data,
      update(dt) { if (finished) return; t += Math.min(dt, 0.5); step(); if (t > tEnd + HOLD) done(); },
      onAction(player, action) {
        if (!CONFIRM.includes(action)) return true;
        if (t < tEnd) { t = tEnd; step(); } else done();
        return true;
      },
    };
  },
};
