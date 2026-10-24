// Pause menu (START during a stage): RESUME · OPTIONS · QUIT TO TITLE. The flow freezes the sim (game.freeze) while
// this is up; UI input still flows (edge-detected on raw device state). opts: { player, onResume(), onOptions(), onQuit() }
import { forge } from '../lettering.js';
import { rule } from '../art.js';
import { h, panel, menu } from '../widgets.js';

export default {
  id: 'pause',
  create(ui, opts = {}) {
    const el = h('<div class="kca-pause"><div class="kca-dim"></div></div>');
    let confirmQuit = false;
    const items = [
      { id: 'resume', label: 'RESUME', desc: 'Back to the fight' },
      { id: 'options', label: 'OPTIONS', desc: 'Volume · difficulty · graphics · controls' },
      { id: 'quit', label: 'QUIT TO TITLE', desc: 'Your legend will be forgotten' },
    ];
    const m = menu(items, {
      ui, desc: true, height: 30,
      onPick: (id) => {
        if (id === 'resume') opts.onResume && opts.onResume();
        else if (id === 'options') opts.onOptions && opts.onOptions();
        else if (id === 'quit') {
          if (!confirmQuit) { confirmQuit = true; m.desc.textContent = 'Press again to abandon the run'; return; }
          opts.onQuit && opts.onQuit();
        }
      },
      onBack: () => opts.onResume && opts.onResume(),
      onMove: () => { confirmQuit = false; },
    });
    const p = panel(`<div class="hd">${forge('PAUSED', { metal: 'gold', track: 22, glint: 3 })}</div>${rule({ width: 380 })}`, '');
    p.append(m.el, m.desc);
    const c = h('<div class="kca-center"></div>'); c.appendChild(p); el.appendChild(c);
    return {
      el, menu: m,
      onAction(player, action) {
        if (action === 'start') { opts.onResume && opts.onResume(); return true; }
        return m.onAction(player, action);
      },
    };
  },
};
