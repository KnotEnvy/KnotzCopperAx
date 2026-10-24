// Shared UI widgets: forged menus with a sword cursor, bronze panels with knot corners, option rows, sound hooks.
//   const m = menu([{ id, label, desc?, disabled? }], { onPick(id, player), onMove?, metal? }); el.append(m.el); m.onAction(p, a)
//   panel(innerHTML, cls) → HTMLElement        h(html) → HTMLElement         sfx(ui, 'move'|'confirm'|'back')
import { forge } from './lettering.js';
import { corner, sword } from './art.js';

export function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

export function panel(inner, cls = '') {
  return h(`<div class="kca-panel ${cls}">${corner({ className: 'orn-corner c-tl' })}${corner({ className: 'orn-corner c-tr' })}${corner({ className: 'orn-corner c-bl' })}${corner({ className: 'orn-corner c-br' })}${inner}</div>`);
}

export function sfx(ui, kind) {
  const a = ui.game.audio; if (!a || !a.play) return;
  if (kind === 'move') a.play('ui_move', { bus: 'ui', volume: 0.5 });
  else if (kind === 'confirm') a.play('ui_confirm', { bus: 'ui', volume: 0.8 });
  else if (kind === 'back') a.play('ui_move', { bus: 'ui', volume: 0.5, pitch: 0.7 });
}

export const CONFIRM = ['start', 'light', 'jump'];
export const BACK = ['heavy', 'dodge'];

/** Vertical forged menu with a springy sword cursor either side of the selection. */
export function menu(items, { onPick, onMove, onBack, ui = null, metal = 'bronze', selMetal = 'gold', index = 0, height = 30, desc = null } = {}) {
  const el = h('<div class="kca-menu"></div>');
  const L = h(`<div class="kca-cursor">${sword({ size: 64 })}</div>`), Rc = h(`<div class="kca-cursor r">${sword({ size: 64 })}</div>`);
  const rows = items.map((it) => {
    const r = h(`<div class="kca-mi${it.disabled ? ' dis' : ''}" data-id="${it.id}"><span class="base">${forge(it.label, { metal, track: 14 })}</span><span class="alt">${forge(it.label, { metal: selMetal, track: 14, glint: 3.2 })}</span></div>`);
    r.querySelectorAll('.forge').forEach((f) => { f.style.height = `${height}px`; });
    el.appendChild(r); return r;
  });
  el.append(L, Rc);
  const d = desc ? h('<div class="kca-desc"></div>') : null;
  let sel = Math.max(0, Math.min(items.length - 1, index));
  const place = () => {
    rows.forEach((r, i) => r.classList.toggle('sel', i === sel));
    const r = rows[sel]; if (!r) return;
    // Measure after layout; fall back to estimates before the element is attached.
    const f = r.querySelector('.alt .forge');
    const w = (f && f.getBoundingClientRect().width) || 300;
    const cw = el.getBoundingClientRect().width || 600;
    const y = r.offsetTop + r.offsetHeight / 2 - 8;
    L.style.transform = `translate(${cw / 2 - w * 0.5 - 92}px, ${y}px)`;
    Rc.style.transform = `translate(${cw / 2 + w * 0.5 + 28}px, ${y}px)`;
    if (d) d.textContent = items[sel].desc || '';
  };
  rows.forEach((r, i) => r.classList.toggle('sel', i === sel)); // selected look from the first frame (no fade-in)
  requestAnimationFrame(place);
  const move = (dir) => {
    let n = sel;
    for (let k = 0; k < items.length; k++) { n = (n + dir + items.length) % items.length; if (!items[n].disabled) break; }
    if (n !== sel) { sel = n; place(); if (ui) sfx(ui, 'move'); if (onMove) onMove(items[sel].id); }
  };
  return {
    el, desc: d, place, get index() { return sel; }, get id() { return items[sel].id; },
    set(i) { sel = i; place(); },
    onAction(player, action) {
      if (action === 'up') move(-1);
      else if (action === 'down') move(1);
      else if (CONFIRM.includes(action)) { if (!items[sel].disabled) { if (ui) sfx(ui, 'confirm'); rows[sel].animate && rows[sel].animate([{ transform: 'scale(1.2)' }, { transform: 'scale(1.06)' }], { duration: 220, easing: 'ease-out' }); if (onPick) onPick(items[sel].id, player); } }
      else if (BACK.includes(action)) { if (onBack) { if (ui) sfx(ui, 'back'); onBack(player); } }
      return true;
    },
  };
}

/** Segmented bar (0..n). */
export const seg = (v, n = 10) => `<span class="kca-seg">${Array.from({ length: n }, (_, i) => `<i class="${i < v ? 'on' : ''}"></i>`).join('')}</span>`;

/** Format a score. */
export const fmt = (n) => String(Math.max(0, Math.floor(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
