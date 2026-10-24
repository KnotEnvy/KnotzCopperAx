// End-of-game YOUR STRENGTH / CLASS screen (DESIGN §7, after GA's ranking): a parchment ledger with score and
// deaths per stage, the strength formula and value, and the class ladder (A+++ … F) with a joke "percent of players"
// column; a sword cursor slides down the ladder to your class; PERFECT! stamps for a no-death clear.
// 2P runs show each player in turn. opts: { run (RunStats.run), players: [0,1], heroes: {0:'brann'}, onDone() }
import { forge } from '../lettering.js';
import { sword, rule } from '../art.js';
import { h, fmt, CONFIRM } from '../widgets.js';
import { strength, CLASSES } from '../../game/RunStats.js';

// Ledger labels: the arcade stage number (1–5; Thieves' Night camps are named, not numbered) + the stage's short name.
const STAGE_NAMES = { 1: 'Ashen Wilds', 2: 'Shellback Crossing', 3: 'Eaglespine Skies', 4: 'Serpent Keep Gates', 5: 'Throne of Coils' };

// Game-voice notes (the board read the scoring formula as leaked internals): one line per class, one for the falls.
const EPITAPH = {
  'A+++': 'Bards will argue over where the legend ends and you begin.',
  'A++': 'The storm itself learned your name, and lowered its voice.',
  'A+': 'The coils of Deathcoil hang slack; the Keep remembers your passing.',
  A: 'The Wilds are quiet where you walked. Fear keeps the peace now.',
  'B+': 'A hard road, well walked. The axe-swingers raise a cup to you.',
  B: 'The taverns will want the tale, and you will tell it kindly.',
  'C+': 'Bruised, brave and learning. The road is long, and you are on it.',
  C: 'The farmhands cheer. The thieves still wonder what hit them.',
  'D+': 'The pot-thieves grow bolder. Perhaps one more run will teach them.',
  D: 'A chicken leg was the finest of your victories. The rest was luck.',
  E: 'The gnome is telling it at every fire. Kindly, for a gnome.',
  F: 'The thieves emptied the camp while you slept. The road waits, and so does the Ax.',
};
// C2 r13 (board r12: empty bottom-left third): an inked road strip under the deeds - five waymarks, a filled seal where a realm was walked,
// red tally ticks for each fall there - and a wax seal under the verdict. All pure SVG/CSS, in the ledger's voice.
const ROAD_SHORT = { 1: 'Ashen Wilds', 2: 'Shellback', 3: 'Eaglespine', 4: 'Keep Gates', 5: 'Throne' };
function road(rows) {
  const by = {}; for (const r of rows) if (r.num) by[r.num] = r;
  const xs = [9.5, 29.5, 49.5, 69.5, 89.5], ys = [28, 10, 34, 14, 30];            // % across, px down
  let d = `M ${xs[0] * 4.76} ${ys[0] + 19}`;
  for (let i = 1; i < 5; i++) { const x0 = xs[i - 1] * 4.76, x1 = xs[i] * 4.76, mx = (x0 + x1) / 2; d += ` C ${mx} ${ys[i - 1] - 6}, ${mx} ${ys[i] + 46}, ${x1} ${ys[i] + 19}`; }
  const nodes = xs.map((x, i) => {
    const n = i + 1, r = by[n];
    let ticks = ''; for (let k = 0; r && k < Math.min(5, r.deaths); k++) ticks += '<i></i>';
    return `<div class="wp${r ? ' on' : ''}" style="left:${x}%;top:${ys[i]}px"><span class="wn">${n}</span>${ticks ? `<span class="tk">${ticks}</span>` : ''}<span class="wl">${ROAD_SHORT[n]}</span></div>`;
  }).join('');
  return `<div class="roadmap"><svg viewBox="0 0 476 112" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="#8a5a2a" stroke-width="2" stroke-dasharray="1 7" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>${nodes}</div>`;
}
const fate = (d) => (d === 0 ? 'Not once did the earth take you.' : d === 1 ? 'The earth took you once, and gave you back.' : `The earth took you ${d} times, and each time you rose.`);

export default {
  id: 'ranking',
  create(ui, opts = {}) {
    const run = opts.run || { stages: [] };
    const players = (opts.players && opts.players.length ? opts.players : [0]);
    const el = h('<div class="kca-rank"></div>');
    let idx = 0, t = 0, finished = false, S = null, cur = null, meRow = null, perf = null, curY = 20;
    const render = () => {
      const p = players[idx];
      S = strength(run, p);
      const rows = S.rows.map((r) => `<tr><td><span class="sn${r.num ? '' : ' camp'}">${r.num || '·'}</span>${r.id === 'bonus' ? 'Thieves’ Night' : STAGE_NAMES[r.num] || `Stage ${r.num || r.id}`}</td><td>${fmt(r.score)}</td><td>${r.kills}</td><td>${r.deaths}</td></tr>`).join('');
      const tot = S.rows.reduce((a, r) => ({ s: a.s + r.score, k: a.k + r.kills, d: a.d + r.deaths }), { s: 0, k: 0, d: 0 });
      const hero = (opts.heroes && opts.heroes[p]) || '';
      el.innerHTML = `<div class="sheet kca-parch">
        <div><h2>${forge('YOUR STRENGTH', { metal: 'bronze', track: 14 })}</h2>
          <div style="text-align:center;margin:-4px 0 10px;font-variant:small-caps;letter-spacing:.3em;color:#6a3c14">${players.length > 1 ? `${p + 1}P · ` : ''}${hero}</div>
          <table><thead><tr><th>Stage</th><th>Score</th><th>Kills</th><th>Deaths</th></tr></thead><tbody>${rows || '<tr><td colspan="4">— no stages —</td></tr>'}
          <tr class="tot"><td>Total</td><td>${fmt(tot.s)}</td><td>${tot.k}</td><td>${tot.d}</td></tr></tbody></table>
          <div class="strength">${forge(String(S.value), { metal: 'copper', track: 6 })}<span class="cap">Strength</span></div>
          <div class="epitaph">${EPITAPH[S.cls.id] || EPITAPH.F}</div>
          ${rule({ width: 300 })}
          <div class="deeds">
            <div><b>${tot.k}</b><span>foes felled</span></div>
            <div><b>${S.rows.filter((r) => r.num).length}</b><span>${S.rows.filter((r) => r.num).length === 1 ? 'realm' : 'realms'} walked</span></div>
            <div><b>${tot.d}</b><span>${tot.d === 1 ? 'fall' : 'falls'}</span></div>
          </div>
          <div class="fate">${fate(S.deaths)}</div>
          <div class="roadcap">The road walked</div>${road(S.rows)}</div>
        <div><h2>${forge('CLASS', { metal: 'bronze', track: 14 })}</h2>
          <div style="position:relative"><table class="kca-ladder"><thead><tr><th>Class</th><th style="text-align:left">Title</th><th>Players</th></tr></thead><tbody>
          ${CLASSES.map((c) => `<tr class="${c.id === S.cls.id ? 'me' : ''}" data-c="${c.id}"><td class="c">${c.id}</td><td class="t">${c.title}</td><td>${c.pct}%</td></tr>`).join('')}</tbody></table>
          <div class="cur">${sword({ size: 54 })}</div></div>
          <div class="verdict">Your class <b>${S.cls.id}</b> · ${S.cls.title}</div>
          <div class="waxline"><span class="wax"><b>${S.cls.id}</b></span><span class="waxtxt">Entered in the Ledger of the Keep<br><i>by the hand of the Keeper of the Ax</i></span></div></div>
        <div class="foot${S.perfect ? ' has-perfect' : ''}">${S.perfect
          ? `${rule({ width: 340 })}<div class="perfect"><div class="seal">${forge('PERFECT!', { metal: 'ember', track: 8, glint: 1.4 })}<small>no life lost · the realm remembers</small></div></div>${rule({ width: 340 })}`
          : rule({ width: 700 })}</div></div>`;
      cur = el.querySelector('.cur'); meRow = el.querySelector('tr.me'); perf = el.querySelector('.perfect');
      cur.style.top = '20px'; curY = 20; cur.dataset.arrived = '';
      t = 0;
    };
    render();
    if (opts.t0) t = Math.min(opts.t0, 8); // showcase: preview a later moment
    const fit = () => { const sh = el.querySelector('.sheet'); if (!sh) return; const z = ui.zoom || 1; const k = Math.min(1, (innerWidth / z - 40) / 1180, (innerHeight / z - 72) / (sh.offsetHeight || 700)); sh.style.setProperty('--fit', k.toFixed(3)); };
    requestAnimationFrame(fit);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit); // metrics change once the bundled face lands
    const next = () => {
      if (idx < players.length - 1) { idx++; render(); requestAnimationFrame(fit); return; }
      if (finished) return; finished = true; if (opts.onDone) opts.onDone();
    };
    return {
      el, get result() { return S; },
      update(dt) {
        if (finished) return;
        t += Math.min(dt, 0.5);
        if (t < 1) fit();
        // The sword slides to the awarded row on the UI clock (a CSS transition ran on wall time, so a frame-stepped capture caught it half way
        // down beside row A while the highlighted row and caption said F). The target is re-read every frame so late font / fit layout shifts follow.
        if (t > 0.4 && meRow && cur) {
          const goal = meRow.offsetTop + meRow.offsetHeight / 2 - 13;
          curY += (goal - curY) * Math.min(1, Math.min(dt, 0.5) * 7);
          if (Math.abs(goal - curY) < 0.6) { curY = goal; cur.dataset.arrived = '1'; }
          cur.style.top = `${curY.toFixed(1)}px`;
        }
        if (t > 1.4 && S && S.perfect && perf && !perf.classList.contains('on')) perf.classList.add('on');
        if (t > 9) next();
      },
      onAction(player, action) { if (CONFIRM.includes(action) && t > 0.8) next(); return true; },
    };
  },
};
