// Options: master / music / sfx volume (0–10), difficulty (Squire · Warrior · Legend), graphics quality (applies on
// reload), controls reference (keyboard 1P/2P + gamepad). Gamepad/keyboard: ▴▾ row, ◂▸ change, HEAVY/START = back.
// Values persist via game/Settings.js (localStorage, wrapped). opts: { onClose() }
import { forge } from '../lettering.js';
import { h, panel, seg, sfx, BACK } from '../widgets.js';
import * as Settings from '../../game/Settings.js';

const ROWS = [
  { id: 'master', k: 'Master volume', type: 'vol' },
  { id: 'music', k: 'Music', type: 'vol' },
  { id: 'sfx', k: 'Sound effects', type: 'vol' },
  { id: 'difficulty', k: 'Difficulty', type: 'enum', values: ['easy', 'normal', 'hard'], label: (v) => Settings.DIFFICULTY[v].label },
  { id: 'quality', k: 'Graphics', type: 'enum', values: ['high', 'low'], label: (v) => (v === 'high' ? 'High' : 'Low') },
  { id: 'back', k: 'Back', type: 'back' },
];

export default {
  id: 'options',
  create(ui, opts = {}) {
    const game = ui.game;
    const s0 = Settings.get();
    const startQuality = s0.quality;
    const el = h('<div class="kca-opts"><div class="kca-dim"></div></div>');
    const p = panel(`<div class="hd">${forge('OPTIONS', { metal: 'gold', track: 20, glint: 3 })}</div><div class="rows"></div>
      <div class="kca-controls"><h4>Controls</h4>
        <span>Move <b>WASD</b> · <b>Arrows</b></span><span>Light <b>J</b> · <b>Num1</b> · <b>X</b></span><span>Heavy <b>K</b> · <b>Num2</b> · <b>Y</b></span>
        <span>Jump <b>L/Space</b> · <b>Num3</b> · <b>A</b></span><span>Magic <b>I</b> · <b>Num5</b> · <b>RB</b></span><span>Dodge <b>U</b> · <b>Num0</b> · <b>B/LB</b></span>
        <span>Start <b>Enter</b> · <b>NumEnt</b> · <b>Start</b></span><span>Run <b>double-tap</b></span><span>Mount <b>walk into a beast</b></span></div>`);
    const rowsEl = p.querySelector('.rows');
    const rowEls = ROWS.map((r) => { const d = h(`<div class="kca-orow" data-id="${r.id}"><span class="k">${r.k}</span><span class="v"></span></div>`); rowsEl.appendChild(d); return d; });
    let sel = 0;
    const paint = () => {
      const s = Settings.get();
      ROWS.forEach((r, i) => {
        const v = rowEls[i].querySelector('.v');
        rowEls[i].classList.toggle('sel', i === sel);
        if (r.type === 'vol') v.innerHTML = `<span class="arr">◂</span>${seg(s[r.id])}<span class="arr">▸</span>`;
        else if (r.type === 'enum') v.innerHTML = `<span class="arr">◂</span><span>${r.label(s[r.id])}${r.id === 'quality' && s.quality !== startQuality ? ' · on reload' : ''}</span><span class="arr">▸</span>`;
        else v.innerHTML = '';
      });
    };
    const close = () => {
      const s = Settings.get();
      if (s.quality !== startQuality && !(game.params && game.params.capture)) {
        try { const u = new URL(location.href); u.searchParams.set('quality', s.quality); location.replace(u.toString()); return; } catch { /* ignore */ }
      }
      if (opts.onClose) opts.onClose();
    };
    const change = (dir) => {
      const r = ROWS[sel], s = Settings.get();
      if (r.type === 'vol') Settings.set({ [r.id]: Math.max(0, Math.min(10, s[r.id] + dir)) }, game);
      else if (r.type === 'enum') { const i = r.values.indexOf(s[r.id]); Settings.set({ [r.id]: r.values[(i + dir + r.values.length) % r.values.length] }, game); }
      else return;
      sfx(ui, 'move'); paint();
    };
    paint();
    const c = h('<div class="kca-center"></div>'); c.appendChild(p); el.appendChild(c);
    return {
      el,
      get row() { return ROWS[sel].id; },
      onAction(player, action) {
        if (action === 'up') { sel = (sel + ROWS.length - 1) % ROWS.length; sfx(ui, 'move'); paint(); }
        else if (action === 'down') { sel = (sel + 1) % ROWS.length; sfx(ui, 'move'); paint(); }
        else if (action === 'left') change(-1);
        else if (action === 'right') change(1);
        else if (action === 'light' || action === 'jump') { if (ROWS[sel].type === 'back') { sfx(ui, 'back'); close(); } else change(1); }
        else if (action === 'start' || BACK.includes(action)) { sfx(ui, 'back'); close(); }
        return true;
      },
    };
  },
};
