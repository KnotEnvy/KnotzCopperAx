// Rider HUD badge: a small beast-head icon + beast HP bar under the rider's life blocks (DESIGN §7 panel).
// Additive DOM only: our own element appended into game.ui.hud.panels[i].el (.kca-pinfo). No UI files edited.
const ICONS = {
  // tiny silhouettes, viewBox 0 0 24 24, filled with currentColor
  cluckhorn: 'M5 16c0-4 3-7 7-7 1-3 3-5 6-5l-1 2 3 1-3 1c1 2 0 4-2 5l1 5h-2l-1-4h-3l-1 4H7l1-4c-2 0-3-1-3-2z',
  emberdrake: 'M3 15c2-1 4-4 7-4l3-4 1 3 3-3v4c2 0 4 1 5 3l-4 1-2 4h-2l-1-3H9l-2 3H5l1-4c-1 0-2 0-3 0z',
  cinderwyrm: 'M3 15c2-1 4-4 7-4l3-4 1 3 3-3v4c2 0 4 1 5 3l-4 1-2 4h-2l-1-3H9l-2 3H5l1-4c-1 0-2 0-3 0z',
  tusker: 'M4 14c0-3 3-6 8-6s7 2 8 5l2 1-3 1c0 2-1 3-2 3l-1 3h-2l-1-3H9l-1 3H6l0-3c-1 0-2-2-2-4z',
};
const TINT = { cluckhorn: '#e6c46a', emberdrake: '#7fb8ff', cinderwyrm: '#ff8a5a', tusker: '#c9b08a' };

export class RiderHud {
  constructor(game, sys) { this.game = game; this.sys = sys; this.badges = [null, null]; }

  _badge(i) {
    if (this.badges[i]) return this.badges[i];
    const hud = this.game.ui && this.game.ui.hud;
    const P = hud && hud.panels && hud.panels[i];
    if (!P || !P.el) return null;
    const host = P.el.querySelector('.kca-pinfo') || P.el;
    const el = document.createElement('div');
    el.className = 'kca-beast';
    el.style.cssText = 'display:none;align-items:center;gap:6px;margin-top:3px;height:18px;pointer-events:none;';
    el.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" style="filter:drop-shadow(0 1px 1px #000a)"><path fill="currentColor"/></svg>'
      + '<div style="position:relative;width:72px;height:6px;border-radius:3px;background:#1a120cdd;box-shadow:0 0 0 1px #6b4a26, inset 0 1px 2px #000">'
      + '<i style="position:absolute;left:1px;top:1px;bottom:1px;border-radius:2px;background:linear-gradient(#ffe2a0,#c9822e);width:0"></i></div>';
    host.appendChild(el);
    const b = { el, path: el.querySelector('path'), svg: el.querySelector('svg'), bar: el.querySelector('i'), type: null, k: -1 };
    this.badges[i] = b;
    return b;
  }

  update() {
    const heroes = this.game.world.query({ kind: 'hero', alive: false });
    for (let i = 0; i < 2; i++) {
      const h = heroes.find((x) => x.playerIndex === i);
      const m = h && h.mountedOn;
      const b = (m || this.badges[i]) ? this._badge(i) : null;
      if (!b) continue;
      if (!m) { if (b.type !== null) { b.el.style.display = 'none'; b.type = null; } continue; }
      if (b.type !== m.typeId) {
        b.type = m.typeId; b.el.style.display = 'flex';
        b.path.setAttribute('d', ICONS[m.typeId] || ICONS.cluckhorn);
        b.svg.style.color = TINT[m.typeId] || '#e6c46a';
      }
      const k = Math.max(0, Math.min(1, m.hp / m.maxHp));
      if (Math.abs(k - b.k) > 0.004) { b.k = k; b.bar.style.width = `${Math.round(70 * k)}px`; }
    }
  }
}
