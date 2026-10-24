// Title screen: animated forged logo (knotwork emblem, KNOTZ in gold between braids, COPPER AX in copper with a
// travelling glint), over the dusk backdrop the flow provides. PRESS START inserts a credit and opens the mode
// menu (ARCADE 1–2P · DUEL · OPTIONS · HIGH SCORES). Idle → the flow runs the attract demo.
// opts: { onSelect(mode, player), credits, skipPress, top: { initials, score } }
import { forge } from '../lettering.js';
import { knot, braid } from '../art.js';
import { h, menu, sfx, fmt } from '../widgets.js';
import { loadScores } from '../../game/HighScores.js';

const ITEMS = [
  { id: 'arcade', label: 'ARCADE', desc: 'One or two heroes · five stages to the Serpent Throne' },
  { id: 'duel', label: 'DUEL', desc: 'The Gauntlet · twelve rounds · eight life bars · no magic' },
  { id: 'options', label: 'OPTIONS', desc: 'Volume · difficulty · graphics · controls' },
  { id: 'highscores', label: 'HIGH SCORES', desc: 'The Hall of Legends' },
];
let credits = 0;

// Graphic backer behind the wordmark (title r2): a painted crimson war-banner hanging from an iron crossbar,
// gold-trimmed with a swallowtail hem and a stitched knot device, (the sun's rays are painted into the dusk backdrop now, from the sun itself) — plus a ragged ink
// "brushstroke" slab that the COPPER AX line sits on. Pure inline SVG (no bitmap), animated by CSS.
function backer() {
  // ragged brush edge: deterministic jitter along a long slab
  let top = 'M40 70', bot = '';
  for (let i = 0; i <= 24; i++) { const x = 40 + i * 45, j = ((i * 37) % 11) - 5; top += ` L${x} ${62 + j}`; }
  for (let i = 24; i >= 0; i--) { const x = 40 + i * 45, j = ((i * 53) % 13) - 6; bot += ` L${x} ${178 + j}`; }
  const slab = `${top} L1130 120 ${bot.trim()} L10 124 Z`;
  return `<div class="backer" aria-hidden="true">
    <svg class="banner" viewBox="0 0 420 760" preserveAspectRatio="xMidYMin meet">
      <defs>
        <linearGradient id="kbCloth" x1="0" x2="1"><stop offset="0" stop-color="#3a0604"/><stop offset=".22" stop-color="#7a120a"/><stop offset=".5" stop-color="#9a1c10"/><stop offset=".78" stop-color="#6e1008"/><stop offset="1" stop-color="#2a0402"/></linearGradient>
        <linearGradient id="kbShade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset=".25" stop-color="#000" stop-opacity="0"/><stop offset=".8" stop-color="#000" stop-opacity=".1"/><stop offset="1" stop-color="#000" stop-opacity=".6"/></linearGradient>
        <linearGradient id="kbGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0b8"/><stop offset=".4" stop-color="#e0a040"/><stop offset=".7" stop-color="#8a4a12"/><stop offset="1" stop-color="#e8b060"/></linearGradient>
        <pattern id="kbWeave" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M0 3h6M3 0v6" stroke="#000" stroke-opacity=".12" stroke-width="1"/></pattern>
      </defs>
      <path d="M40 30 H380 V660 L210 740 L40 660 Z" fill="url(#kbCloth)"/>
      <path d="M40 30 H380 V660 L210 740 L40 660 Z" fill="url(#kbWeave)"/>
      <path d="M40 30 H380 V660 L210 740 L40 660 Z" fill="url(#kbShade)"/>
      <path d="M60 30 V648 L210 718 L360 648 V30" fill="none" stroke="url(#kbGold)" stroke-width="5"/>
      <path d="M72 30 V640 L210 704 L348 640 V30" fill="none" stroke="#1a0402" stroke-opacity=".6" stroke-width="1.5" stroke-dasharray="6 5"/>
      <rect x="10" y="14" width="400" height="22" rx="5" fill="#1c140e" stroke="#6a5038" stroke-width="2"/>
      <circle cx="16" cy="25" r="13" fill="#2a2018" stroke="url(#kbGold)" stroke-width="3"/><circle cx="404" cy="25" r="13" fill="#2a2018" stroke="url(#kbGold)" stroke-width="3"/>
    </svg>
    <svg class="slab" viewBox="0 0 1140 240" preserveAspectRatio="none"><path d="${slab}" fill="#0c0503" fill-opacity=".86"/><path d="${slab}" fill="none" stroke="#c07a34" stroke-opacity=".55" stroke-width="2.5"/></svg>
  </div>`;
}

export default {
  id: 'title',
  create(ui, opts = {}) {
    let top = null;
    try { top = loadScores()[0]; } catch { top = null; }
    const el = h(`<div class="kca-title"><div class="bd" aria-hidden="true"></div><div class="kca-noise"></div>
      <div class="kca-logo">${backer()}<div class="emb">${knot({ size: 108, band: 7.5, metal: 'copper' })}</div>
        <div class="l1">${braid({ length: 150, height: 18, metal: 'bronze' })}${forge('KNOTZ', { metal: 'gold', track: 26, glint: 5 })}${braid({ length: 150, height: 18, metal: 'bronze', style: 'transform:scaleX(-1)' })}</div>
        <div class="l2">${forge('COPPER AX', { metal: 'copper', track: 12, glint: 4.2, rim: 8 })}</div>
        <div class="tag">A Legend Reforged</div></div>
      <div class="kca-press">${forge('PRESS START', { metal: 'gold', track: 18, glint: 2.4 })}</div>
      <div class="kca-menuwrap hidden"></div>
      <div class="kca-hs-mini">${top ? `TOP LEGEND &nbsp;<b>${top.initials}</b> &nbsp;<b>${fmt(top.score)}</b>` : ''}</div>
      <div class="kca-copy">© 2026 KNOTZ · A TRIBUTE TO THE ARCADE AXE · 1–2 PLAYERS</div>
      <div class="kca-credit">CREDITS <b class="n">00</b></div></div>`);
    const press = el.querySelector('.kca-press'), wrap = el.querySelector('.kca-menuwrap'), cr = el.querySelector('.kca-credit .n');
    const setCredits = () => { cr.textContent = String(Math.min(99, credits)).padStart(2, '0'); };
    if (opts.credits != null) credits = opts.credits;
    setCredits();
    const m = menu(ITEMS, { ui, desc: true, height: 32, metal: 'ivory', onPick: (id, player) => { if (opts.onSelect) opts.onSelect(id, player); } });
    wrap.append(m.el, m.desc);
    let stage = 'press';
    const openMenu = () => { stage = 'menu'; press.classList.add('hidden'); wrap.classList.remove('hidden'); wrap.classList.add('kca-menu-in'); requestAnimationFrame(() => m.place()); };
    if (opts.skipPress) openMenu();
    requestAnimationFrame(() => el.classList.add('in'));
    return {
      el, menu: m,
      get stage() { return stage; },
      onAction(player, action) {
        if (stage === 'press') {
          if (['start', 'light', 'jump'].includes(action)) { credits++; setCredits(); sfx(ui, 'confirm'); openMenu(); }
          return true;
        }
        if (action === 'start' && credits < 9) { credits++; setCredits(); }
        return m.onAction(player, action);
      },
    };
  },
};
