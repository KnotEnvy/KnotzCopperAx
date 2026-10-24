// Thieves' Night overlay (DOM, in the UI fx layer): hunt timer, steal/recover flashes, CAMP TALLY panel and the
// quiet-camp caption. Uses the game's forged lettering so it reads as part of the UI kit.
import { forge } from '../../../ui/lettering.js';
import { pot as potIcon } from '../../../ui/art.js';

// small roast-haunch icon for meat loot words
const MEAT_ICON = '<svg class="ic" viewBox="0 0 28 24" xmlns="http://www.w3.org/2000/svg"><path d="M4 14c0-6 6-11 12-10 5 1 8 5 7 9-1 5-7 8-12 7-2 0-3 1-4 2l-2 1-1-2c1-1 1-2 0-3-1 0-2-1-2-2z" fill="#b4582a" stroke="#2a1206" stroke-width="1.4"/><path d="M9 9c2-3 6-4 9-3" stroke="#f0b070" stroke-width="1.6" fill="none" stroke-linecap="round"/><circle cx="4" cy="20" r="2.6" fill="#f4ead0" stroke="#2a1206" stroke-width="1.2"/><circle cx="2.6" cy="17.4" r="2.2" fill="#f4ead0" stroke="#2a1206" stroke-width="1.2"/></svg>';

const CSS = `
.kca-camp{position:absolute;inset:0;pointer-events:none;font-family:"Palatino Linotype","Book Antiqua",Georgia,serif;color:#f0dcb0}
.kca-camp .tm{position:absolute;left:50%;top:calc(96px*var(--uiz,1));transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;opacity:0;transition:opacity .3s}
.kca-camp .tm.on{opacity:1}
.kca-camp .tm small{letter-spacing:.35em;font-size:calc(13px*var(--uiz,1));color:#b8a6ff;text-shadow:0 2px 6px #000}
.kca-camp .tm .d .forge{height:calc(58px*var(--uiz,1));width:auto;filter:drop-shadow(0 3px 6px #000)}
.kca-camp .tm.low .d{animation:kcaCampPulse .5s infinite alternate}
@keyframes kcaCampPulse{from{transform:scale(1)}to{transform:scale(1.12)}}
.kca-camp .fl{position:absolute;display:flex;align-items:center;gap:calc(6px*var(--uiz,1));transform:translateX(-50%);opacity:0;will-change:transform,opacity}
.kca-camp .fl .forge{height:calc(30px*var(--uiz,1));filter:drop-shadow(0 2px 3px #000)}
.kca-camp .fl svg.ic{height:calc(30px*var(--uiz,1));width:auto;filter:drop-shadow(0 2px 3px #000)}
.kca-camp .wp{position:absolute;left:0;top:0;display:flex;align-items:center;gap:calc(6px*var(--uiz,1));white-space:nowrap;opacity:0;will-change:transform,opacity;transform-origin:50% 100%}
.kca-camp .wp::before{content:"";position:absolute;inset:-18% -14%;border-radius:50%;background:radial-gradient(closest-side,rgba(8,4,2,.72),rgba(8,4,2,.38) 60%,rgba(8,4,2,0));z-index:-1}
.kca-camp .wp .forge{height:calc(40px*var(--uiz,1));filter:drop-shadow(0 3px 2px #000) drop-shadow(0 0 6px rgba(0,0,0,.8))}
.kca-camp .wp svg.ic{height:calc(40px*var(--uiz,1));width:auto;filter:drop-shadow(0 3px 3px #000)}
.kca-camp .wp.taunt{font-style:italic;font-weight:700;font-size:calc(17px*var(--uiz,1));letter-spacing:.06em;color:#e8d49a;text-shadow:0 2px 0 #1a0c04,0 0 6px #000}
.kca-camp .wp.taunt::before{display:none}
.kca-camp .toast{position:absolute;left:50%;top:32%;transform:translateX(-50%);animation:kcaCampFl 1.4s ease-out forwards}
.kca-camp .toast .forge{height:calc(34px*var(--uiz,1))}
.kca-camp .veil{position:absolute;inset:0;background:radial-gradient(ellipse 38% 48% at 50% 50%,rgba(6,4,12,.78),rgba(6,4,12,.5) 70%,rgba(4,3,8,.28) 100%);opacity:0}
.kca-camp .tally{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(.9);opacity:0;
  background:linear-gradient(180deg,#221a2e 0%,#130e1a 38%,#0c0910 100%);border:2px solid #7a6038;border-radius:6px;
  outline:1px solid rgba(255,216,138,.18);outline-offset:-7px;
  padding:calc(24px*var(--uiz,1)) calc(40px*var(--uiz,1)) calc(22px*var(--uiz,1));box-shadow:0 24px 70px #000,inset 0 1px 0 rgba(255,220,150,.25),inset 0 0 50px rgba(0,0,0,.7);text-align:center;min-width:calc(520px*var(--uiz,1))}
.kca-camp .tally .k .forge{height:calc(18px*var(--uiz,1))}.kca-camp .tally .m{margin-top:calc(4px*var(--uiz,1))}.kca-camp .tally .m .forge{height:calc(46px*var(--uiz,1));filter:drop-shadow(0 3px 6px #000)}
.kca-camp .tally .sub{font-style:italic;font-size:calc(15px*var(--uiz,1));color:#b8a6c8;margin-top:calc(4px*var(--uiz,1))}
.kca-camp .tally .rule{height:1px;margin:calc(14px*var(--uiz,1)) 0 calc(8px*var(--uiz,1));background:linear-gradient(90deg,transparent,#7a6038,transparent)}
.kca-camp .tally table{width:100%;border-collapse:collapse;font-size:calc(19px*var(--uiz,1))}
.kca-camp .tally th{font-weight:700;letter-spacing:.2em;font-size:calc(14px*var(--uiz,1));padding:0 0 calc(6px*var(--uiz,1))}
.kca-camp .tally th.p0{color:#ffcf7a}.kca-camp .tally th.p1{color:#9fc4ff}
.kca-camp .tally td{padding:calc(4px*var(--uiz,1)) calc(10px*var(--uiz,1));text-align:right;font-weight:700;color:#ffd88a;min-width:calc(80px*var(--uiz,1))}
.kca-camp .tally td:first-child{text-align:left;font-weight:400;color:#e8d4b0;padding-left:0}
.kca-camp .tally tr.r{opacity:0}
.kca-camp .tally td small.full{font-size:.62em;font-weight:400;letter-spacing:.08em;color:#c8b48a}
.kca-camp .tally td.bad{color:#ff8a7a}.kca-camp .tally td.good{color:#a8ffb0}.kca-camp .tally td.zero{color:#8a7c6a}
.kca-camp .tally tr.net td{border-top:1px solid rgba(200,170,110,.3);padding-top:calc(7px*var(--uiz,1))}
.kca-camp .tally tr.bonus td{font-size:calc(22px*var(--uiz,1))}
.kca-camp .quiet{position:absolute;left:0;right:0;bottom:18%;text-align:center;opacity:0;transition:opacity 1.6s}
.kca-camp .quiet.on{opacity:1}
.kca-camp .quiet .forge{height:calc(54px*var(--uiz,1));filter:drop-shadow(0 4px 10px #000)}
.kca-camp .quiet p{margin:calc(12px*var(--uiz,1)) auto 0;font-style:italic;font-size:calc(20px*var(--uiz,1));color:#e8d4b0;text-shadow:0 2px 8px #000;max-width:60%}
`;

export function createCampHud(game) {
  const ui = game.ui;
  const host = (ui && (ui.fxLayer || ui.root)) || document.body;
  if (!document.getElementById('kca-camp-css')) { const s = document.createElement('style'); s.id = 'kca-camp-css'; s.textContent = CSS; document.head.appendChild(s); }
  const el = document.createElement('div'); el.className = 'kca-camp'; host.appendChild(el);
  const tm = document.createElement('div'); tm.className = 'tm'; tm.innerHTML = '<small>THIEVES\' NIGHT</small><div class="d"></div>'; el.appendChild(tm);
  const digits = tm.querySelector('.d');
  let shownSec = -1, rowsEl = [], rowT = 0, panel = null;
  const boxes = []; // live world-pop / flash screen boxes (lanes)
  const LIFE = 1.15, RISE = 14, MAX_WORDS = 2;
  // bottom of the HUD band (player panels incl. score + pot tiers, combo counters, hunt timer) in layer px
  const hudBand = () => {
    const R = el.getBoundingClientRect(); let b = 0;
    const root = (ui && ui.root) || document;
    for (const e of root.querySelectorAll('.kca-pp:not(.empty), .kca-combo:not(.muted), .kca-camp .tm.on')) {
      const r = e.getBoundingClientRect(); if (!r.width && !r.height) continue;
      // an idle combo counter is collapsed — reserve its full lit height (54px number + rank line) anyway
      const bot = e.classList.contains('kca-combo') ? Math.max(r.bottom, r.top + 66) : r.bottom;
      b = Math.max(b, bot - R.top);
    }
    return b;
  };
  const ease = (u) => 1 - Math.pow(1 - u, 3);
  const animPops = (dt) => {
    for (let i = boxes.length - 1; i >= 0; i--) {
      const b = boxes[i]; b.t += dt;
      const u = b.t, L = b.life;
      if (u >= L || !b.el.isConnected) { if (!b.track) b.el.remove(); boxes.splice(i, 1); continue; }
      if (b.fixed) continue;
      if (b.flash) {
        b.el.style.opacity = (Math.min(1, u / 0.12) * Math.min(1, (L - u) / 0.3)).toFixed(3);
        b.el.style.transform = `translate(-50%,${(-26 * ease(u / L)).toFixed(1)}px)`;
        continue;
      }
      const sc = u < 0.1 ? 0.45 + 0.67 * ease(u / 0.1) : u < 0.2 ? 1.12 - 0.12 * ease((u - 0.1) / 0.1) : 1;
      const dy = u > L - 0.3 ? -RISE * ease((u - (L - 0.3)) / 0.3) : 0;
      b.el.style.opacity = (Math.min(1, u / 0.07) * Math.min(1, (L - u) / 0.22)).toFixed(3);
      b.el.style.transform = `translateY(${dy.toFixed(1)}px) scale(${sc.toFixed(3)})`;
    }
  };
  const api = {
    timer(sec) {
      if (sec == null) { tm.classList.remove('on'); return; }
      tm.classList.add('on');
      const s = Math.ceil(sec);
      if (s !== shownSec) { shownSec = s; digits.innerHTML = forge(String(s).padStart(2, '0'), { metal: s <= 5 ? 'ember' : 'gold', track: 8, glint: false }); tm.classList.toggle('low', s <= 5); }
    },
    // Per-player steal/heal flash (r7): ONE forged line under that player's HUD corner — below the HUD band (panel +
    // combo counter), never over the score/combo; reserved as a lane so world words keep clear of it.
    flash(text, player = 0, kind = null) {
      const t = String(text), lose = t.startsWith('-'), k = kind || (lose ? 'lose' : 'pot');
      const f = document.createElement('div'); f.className = `fl ${k}`;
      const n = Math.abs(parseInt(t, 10)) || 1;
      const word = k === 'food' ? `${t} LIFE` : `${t} ${n === 1 ? 'POT' : 'POTS'}`;
      f.innerHTML = (k === 'food' ? MEAT_ICON : potIcon({ full: !lose, className: 'ic' })) + forge(word, { metal: lose ? 'ember' : k === 'food' ? 'ivory' : 'p2', track: 6 });
      el.appendChild(f);
      const R = el.getBoundingClientRect(), vw = R.width || innerWidth;
      const H = f.offsetHeight, hw = f.offsetWidth / 2 + 6, up = H + 30, dn = 4, x = player ? vw * 0.8 : vw * 0.2;
      let y = hudBand() + H + 10;
      // a world word already sitting there keeps its moment: the flash steps down below it (never up into the HUD)
      for (let k = 0; k < 3; k++) {
        const hs = boxes.filter((b) => Math.abs(b.x - x) < b.hw + hw && y - up < b.y + b.dn && b.y - b.up < y + dn);
        if (!hs.length) break;
        y = Math.max(...hs.map((b) => b.y + b.dn)) + up;
      }
      f.style.left = `${Math.round(x)}px`; f.style.top = `${Math.round(y - H)}px`;
      boxes.push({ x, y, hw, up, dn, kind: 'flash', el: f, t: 0, life: 1.3, flash: true });
    },
    toast(text) {
      const t = document.createElement('div'); t.className = 'toast'; t.innerHTML = forge(text, { metal: 'iron', track: 8 }); el.appendChild(t);
      // reserved lane (CSS-animated, so not driven by animPops) — world words keep clear of the centre toast
      const R = el.getBoundingClientRect(), H = t.offsetHeight;
      boxes.push({ x: (R.width || innerWidth) / 2, y: (R.height || innerHeight) * 0.32 + H, hw: t.offsetWidth / 2 + 6, up: H + 64, dn: 4, kind: 'toast', el: t, t: 0, life: 1.45, flash: true, fixed: true });
    },
    /**
     * World-anchored loot word (r7). ONE bold forged line with an icon ("+4 POTS", "+1 MEAT", "-2 POTS") readable in
     * < 1 s; thief taunts are small secondary italics. Lanes: every live word/flash reserves its screen box (incl. pop
     * overshoot + rise); the HUD band (player panels, combo counters, hunt timer) is an occupied lane — words clamp
     * below it. At most 2 world words live at once: a loot word evicts the oldest (taunts first); taunts never evict.
     * Game-time driven (update(dt)) so it animates with the sim clock and captures deterministically.
     */
    pop(text, pos, kind = 'pot') {
      const cam = game.cameraRig; if (!cam || !cam.worldToScreen || !pos) return;
      const s = cam.worldToScreen(pos); if (!s.visible) return;
      const taunt = kind === 'taunt';
      const R0 = el.getBoundingClientRect();
      for (const b of boxes) if (b.track) { const r = b.el.getBoundingClientRect(); b.x = (r.left + r.right) / 2 - R0.left; b.hw = r.width / 2 + 10; b.y = r.bottom - R0.top + 6; b.up = r.height + 12; b.dn = 6; }
      const words = boxes.filter((b) => !b.flash);
      if (taunt && (words.length >= MAX_WORDS || words.some((b) => b.kind !== 'taunt'))) return; // taunts are secondary
      // a loot word clears live taunts outright — the payoff reads alone, the heckle already had its beat
      if (!taunt) for (let i = boxes.length - 1; i >= 0; i--) if (boxes[i].kind === 'taunt') { boxes[i].el.remove(); boxes.splice(i, 1); }
      const f = document.createElement('div'); f.className = `wp ${kind}`;
      if (taunt) f.textContent = text;
      else {
        const lose = kind === 'lose', food = kind === 'food';
        const ic = food ? MEAT_ICON : String(text).includes('POT') ? potIcon({ full: !lose, className: 'ic' }) : '';
        f.innerHTML = ic + forge(text, { metal: lose ? 'ember' : food ? 'ivory' : 'gold', track: 6 });
      }
      el.appendChild(f);
      const W = f.offsetWidth, H = f.offsetHeight;
      // covers [y − H·1.12 − RISE, y + 4] vertically (overshoot ×1.12 about the bottom edge, then a short rise) and ±0.56W
      const hw = W * 0.56 + 6, up = H * 1.12 + RISE + 4, dn = 4;
      const hits = (x, y) => boxes.filter((b) => Math.abs(b.x - x) < b.hw + hw && y - up < b.y + b.dn && b.y - b.up < y + dn);
      const R = el.getBoundingClientRect(), vw = R.width || innerWidth, vh = R.height || innerHeight;
      const top = hudBand() + 8, bottom = vh - 12;
      const x = Math.max(hw + 8, Math.min(vw - hw - 8, s.x));
      let y = Math.max(top + up, Math.min(bottom, s.y));
      // step up past colliding words; if that would enter the HUD band, step DOWN below them instead
      for (let lane = 0; lane < 3 && hits(x, y).length; lane++) {
        const hs = hits(x, y), ny = Math.min(...hs.map((b) => b.y - b.up)) - dn;
        y = ny - up >= top ? ny : Math.min(bottom, Math.max(...hs.map((b) => b.y + b.dn)) + up);
      }
      const clash = hits(x, y);
      if (clash.length) {
        if (taunt || clash.some((b) => b.flash)) { f.remove(); return; }
        for (const b of clash) { b.el.remove(); boxes.splice(boxes.indexOf(b), 1); } // a loot word replaces older words
      }
      // cap: at most MAX_WORDS live world words — evict the oldest (taunts first)
      let live = boxes.filter((b) => !b.flash);
      while (live.length >= MAX_WORDS) {
        const v = live.find((b) => b.kind === 'taunt') || live[0];
        v.el.remove(); boxes.splice(boxes.indexOf(v), 1); live = boxes.filter((b) => !b.flash);
      }
      f.style.left = `${Math.round(x - W / 2)}px`; f.style.top = `${Math.round(y - H)}px`;
      boxes.push({ x, y, hw, up, dn, kind, el: f, t: 0, life: taunt ? 0.8 : LIFE });
    },
    /** Reserve a foreign UI element (e.g. the "THIEVES! / CATCH THEM" ui.card) as an occupied lane for `life` s. */
    reserve(elm, life = 2) { if (elm && elm.getBoundingClientRect) boxes.push({ x: 0, y: 0, hw: 0, up: 0, dn: 0, kind: 'ui', el: elm, t: 0, life, flash: true, fixed: true, track: true }); },
    clearPops() { for (const f of el.querySelectorAll('.fl,.toast,.wp')) f.remove(); boxes.length = 0; },
    /** probe: HUD band + live pop/flash boxes (layer px) */
    _lanes() { return { band: hudBand(), boxes: boxes.map((b) => ({ kind: b.kind, x: b.x, y: b.y, hw: b.hw, up: b.up, t: b.t })) }; },
    tally({ stolen, escaped = 0, rows, camp, outcome = 'caught', caught = 0, total = 0 }) {
      tm.classList.remove('on'); tm.style.display = 'none'; api.clearPops();
      const veil = document.createElement('div'); veil.className = 'veil'; el.appendChild(veil);
      const p = document.createElement('div'); p.className = 'tally';
      const HEAD = {
        caught: ['THIEVES CAUGHT', 'gold', 'Every stolen pot is back in the pack.'],
        some: ['SOME GOT AWAY', 'bronze', escaped > 0 ? 'A few sacks vanished into the dark.' : 'Not every pot came home.'],
        away: ['THEY GOT AWAY', 'ember', 'The thieves are gone, and your pots with them.'],
        held: ['THE CAMP HOLDS', 'copper', 'Nothing was taken tonight.'],
      }[outcome] || ['THIEVES CAUGHT', 'gold', ''];
      const sgn = (v) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0');
      const cls = (v, inv = false) => (v === 0 ? 'zero' : (v > 0) !== inv ? 'good' : 'bad');
      const multi = rows.length > 1;
      const head = multi ? `<tr><th></th>${rows.map((r) => `<th class="p${r.player ? 1 : 0}">${r.player + 1}P</th>`).join('')}</tr>` : '';
      const tr = (label, f, extra = '') => `<tr class="r ${extra}"><td>${label}</td>${rows.map(f).join('')}</tr>`;
      const body = [
        tr('Pots stolen', (r) => `<td class="${r.stolen ? 'bad' : 'zero'}">${r.stolen ? `−${r.stolen}` : '0'}</td>`),
        // pots actually banked (Hero.addPots caps at maxPots — a full pack shows "+N (full)", matching the HUD)
        tr('Pots recovered', (r) => { const k = r.kept ?? r.recovered; return `<td class="${k ? 'good' : 'zero'}">${k ? `+${k}` : '0'}${r.full ? ' <small class="full">(full)</small>' : ''}</td>`; }),
        tr('Meat taken', (r) => `<td class="${r.meat ? 'good' : 'zero'}">× ${r.meat}</td>`),
        // r10: the board asked for the headline's number — thieves actually kicked (≥ 1 kick) of the thieves that turned up
        `<tr class="r"><td>Thieves caught</td><td colspan="${rows.length}" class="${caught ? 'good' : 'zero'}">${caught} / ${total}</td></tr>`,
        tr('Net pots', (r) => `<td class="${cls(r.net)}">${sgn(r.net)}</td>`, 'net'),
        tr('Camp bonus', (r) => `<td class="${r.bonus ? '' : 'zero'}">+${r.bonus.toLocaleString('en-US')}</td>`, 'bonus'),
      ];
      const sub = HEAD[2] + (stolen ? ` <span style="opacity:.75">(${stolen} stolen in the night)</span>` : '');
      p.innerHTML = `<div class="k">${forge(`CAMP ${camp || 1}`, { metal: 'bronze', track: 18 })}</div><div class="m">${forge(HEAD[0], { metal: HEAD[1], track: 12, glint: outcome === 'caught' ? 2.2 : false })}</div><div class="sub">${sub}</div><div class="rule"></div><table>${head}${body.join('')}</table>`;
      el.appendChild(p);
      rowsEl = [...p.querySelectorAll('tr.r')]; rowT = 0; panel = { p, veil };
    },
    quiet(title, text) {
      const q = document.createElement('div'); q.className = 'quiet';
      q.innerHTML = `${forge(title, { metal: 'copper', track: 14, glint: 3 })}<p>${text}</p>`; el.appendChild(q);
      setTimeout(() => q.classList.add('on'), 30);
    },
    update(dt) {
      animPops(dt);
      if (!rowsEl.length) return;
      rowT += dt;
      // game-time driven (not CSS transitions) so the card animates with the sim clock, pauses with it and captures cleanly
      const cl = (v) => Math.max(0, Math.min(1, v));
      const a = cl(rowT / 0.4), k = 1 - Math.pow(1 - a, 3), over = Math.sin(a * Math.PI) * 0.035;
      panel.veil.style.opacity = cl(rowT / 0.5).toFixed(3);
      panel.p.style.opacity = a.toFixed(3);
      panel.p.style.transform = `translate(-50%,-50%) scale(${(0.9 + 0.1 * k + over).toFixed(4)})`;
      rowsEl.forEach((r, i) => {
        const u = cl((rowT - 0.45 - i * 0.24) / 0.25);
        r.style.opacity = u.toFixed(3); r.style.transform = u < 1 ? `translateX(${(-12 * (1 - u)).toFixed(1)}px)` : '';
      });
    },
    hide() { el.style.transition = 'opacity .4s'; el.style.opacity = '0'; },
    dispose() { el.remove(); },
  };
  return api;
}
