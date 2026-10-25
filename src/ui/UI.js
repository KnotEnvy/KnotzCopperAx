// UI (game.ui): HTML overlay above the canvas. Owns the HUD, the screen stack (src/ui/screens/<id>.js),
// stage title cards, the GO arrow and toasts.
//
//   await ui.show('title', opts) → screen instance      ui.hide('title') / ui.hideAll()
//   ui.hud.show(true)   ui.card('STAGE 1', 'Ashen Wilds', 2.5)   ui.go(true)   ui.toast('text')
// Screen module: { id, create(ui, opts) → { el, update?(dt), dispose?(), onAction?(player, action) } }
import { registries } from '../core/registries.js';
import { reportError } from '../core/log.js';
import { Hud } from './Hud.js';
import { injectStyles } from './styles.js';
import { forge } from './lettering.js';
import { rule } from './art.js';

export class UI {
  constructor(game, container) {
    this.game = game;
    this.name = 'ui';
    this.order = 90;
    this.freezable = false;
    injectStyles();
    this.root = document.createElement('div');
    this.root.id = 'ui';
    this.root.className = 'kca-ui';
    container.appendChild(this.root);
    this.layer = (cls) => { const d = document.createElement('div'); d.className = cls; this.root.appendChild(d); return d; };
    this.hudLayer = this.layer('kca-layer kca-hud-layer');
    this.screenLayer = this.layer('kca-layer kca-screen-layer');
    this.fxLayer = this.layer('kca-layer kca-fx-layer');
    // Resolution scaling: every layer is authored at 1600x900 and zoomed UP on larger viewports (1080p → 1.2,
    // 1440p → 1.6) so panels, cards and the HUD keep the same share of the screen; never scaled below 1.
    const zoom = () => { const z = Math.max(1, Math.min(innerWidth / 1600, innerHeight / 900)); this.zoom = z; this.root.style.setProperty('--uiz', z.toFixed(3)); };
    zoom(); addEventListener('resize', zoom);
    this.hud = new Hud(this, this.hudLayer);
    this.screens = new Map();
    this._card = null;
    this._go = document.createElement('div');
    this._go.className = 'kca-go';
    const chev = '<svg viewBox="0 0 40 64"><path d="M6 6 L34 32 L6 58" fill="none" stroke="#1c0a02" stroke-width="15" stroke-linejoin="miter"/><path d="M6 6 L34 32 L6 58" fill="none" stroke="#ffc860" stroke-width="9" stroke-linejoin="miter"/></svg>';
    this._go.innerHTML = `<span class="word">${forge('GO', { metal: 'gold', track: 10, glint: 1.6 })}</span><span class="arrows">${chev}${chev}${chev}</span>`;
    this.fxLayer.appendChild(this._go);
    this._scope = game.bus.scope();
  }

  async show(id, opts = {}) {
    this.hide(id);
    const mod = await registries.screens.load(id);
    if (!mod) return null;
    let inst = null;
    try { inst = mod.create(this, opts) || {}; } catch (e) { reportError(`ui:${id}`, e); return null; }
    if (inst.el) { inst.el.classList.add('kca-screen', `kca-screen-${id}`); this.screenLayer.appendChild(inst.el); }
    this.screens.set(id, inst);
    return inst;
  }

  hide(id) {
    const s = this.screens.get(id);
    if (!s) return;
    try { if (s.dispose) s.dispose(); } catch (e) { reportError(`ui:${id}.dispose`, e); }
    if (s.el && s.el.parentNode) s.el.parentNode.removeChild(s.el);
    this.screens.delete(id);
  }

  hideAll() { for (const id of [...this.screens.keys()]) this.hide(id); }

  /** Stage title card: kicker ('STAGE 1') over the forged stage name. opts.big = the GAME OVER treatment. */
  card(title, subtitle = '', seconds = 2.6, opts = {}) {
    // perf-1650: the stage prewarm (assets/prewarm.js) builds + rasters this exact card under the loading curtain;
    // reuse that element (restart its animation) instead of paying a fresh first raster the moment the curtain lifts
    const w = this._card;
    if (w && w.dataset.warm === '1' && !opts.big && w.dataset.title === String(title) && w.dataset.sub === String(subtitle)) {
      delete w.dataset.warm; w.dataset.life = String(seconds); w.dataset.t = '0'; w.style.zIndex = '';
      w.classList.remove('in'); void w.offsetWidth; requestAnimationFrame(() => w.classList.add('in'));
      return w;
    }
    if (this._card) this._card.remove();
    const el = document.createElement('div');
    el.className = 'kca-card' + (opts.big ? ' big' : '');
    if (opts.big) {
      this.go(false);
      if (!this._veil) { this._veil = document.createElement('div'); this._veil.className = 'kca-veil'; this.fxLayer.insertBefore(this._veil, this.fxLayer.firstChild); }
      this._veil.classList.add('on');
    }
    const big = !!opts.big;
    el.innerHTML = `<div class="ribbon">${title ? `<div class="kicker">${forge(title, { metal: big ? 'ivory' : 'bronze', track: 22 })}</div>` : ''}${rule({ width: big ? 900 : 760, metal: 'bronze' })}
      <div class="main kca-card-sub"><span class="kca-sr">${subtitle}</span>${forge(subtitle, { metal: opts.metal || (big ? 'gold' : 'copper'), track: big ? 12 : 10, glint: big ? 3 : 2.2 })}</div>${rule({ width: big ? 900 : 760, metal: 'bronze' })}</div>`;
    el.dataset.title = title; el.dataset.sub = subtitle;
    this.fxLayer.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    this._card = el;
    el.dataset.life = String(seconds);
    el.dataset.t = '0';
    return el;
  }

  /** Boss intro name card: a blood-red band slashes in with the forged name + epithet (sim-time driven). */
  bossCard(name, epithet = '', seconds = 2.5) {
    if (this._boss) this._boss.remove();
    const el = document.createElement('div');
    el.className = 'kca-boss in';
    el.innerHTML = `<div class="band"></div><div class="txt"><div class="ep">${epithet}</div><div class="nm">${forge(name, { metal: 'ember', track: 12, glint: 2 })}</div></div>`;
    el.dataset.life = String(seconds);
    el.dataset.t = '0';
    el.dataset.t0 = String(this.game.time ?? 0);
    this.fxLayer.appendChild(el);
    this._boss = el;
    this._syncBoss(0);
    return el;
  }

  /** Clamp remaining boss banner life so it finishes animating out within `fadeSec` once the intro ends. */
  dismissBossCard(fadeSec = 0.35) {
    const b = this._boss;
    if (!b) return;
    const t = Number(b.dataset.t) || 0, life = Number(b.dataset.life) || 2.5;
    if (life - t > fadeSec) b.dataset.life = String(t + fadeSec);
  }

  _syncBoss(dt) {
    const b = this._boss;
    if (!b) return;
    const simElapsed = Math.max(0, (this.game.time ?? 0) - Number(b.dataset.t0 || 0));
    const t = Math.max(Number(b.dataset.t || 0) + dt, simElapsed);
    const life = Number(b.dataset.life || 2.5);
    b.dataset.t = String(t);
    if (t >= life) { b.remove(); this._boss = null; return; }
    const band = b.querySelector('.band'), txt = b.querySelector('.txt');
    if (t < 0.32) {
      const k = t / 0.32;
      b.style.opacity = String(Math.min(1, k * 1.15));
      if (band) band.style.transform = `skewY(-3deg) scaleX(${k.toFixed(3)})`;
      if (txt) { txt.style.opacity = String(k); txt.style.transform = `translateY(${((1 - k) * 10).toFixed(1)}px) scale(${(1.06 - 0.06 * k).toFixed(3)})`; }
    } else if (t > life - 0.4) {
      const k = Math.max(0, (life - t) / 0.4);
      b.classList.add('out');
      b.style.opacity = String(k);
      if (band) band.style.transform = `skewY(-3deg) scaleX(${k.toFixed(3)})`;
      if (txt) { txt.style.opacity = String(k); txt.style.transform = `translateY(${(-(1 - k) * 8).toFixed(1)}px)`; }
    } else {
      b.style.opacity = '1';
      if (band) band.style.transform = 'skewY(-3deg) scaleX(1)';
      if (txt) { txt.style.opacity = '1'; txt.style.transform = 'translateY(0) scale(1)'; }
    }
  }

  /** Attract-mode banner (DEMO PLAY · PRESS START). */
  demo(on) {
    if (on && !this._demo) {
      this._demo = document.createElement('div');
      this._demo.innerHTML = `<div class="kca-demo"><div class="bg"></div><div class="d">${forge('DEMO PLAY', { metal: 'gold', track: 16, glint: 2.5 })}</div><div class="p">${forge('PRESS START', { metal: 'gold', track: 14 })}</div></div>
        <div class="kca-demo-logo">${forge('KNOTZ COPPER AX', { metal: 'copper', track: 10 })}</div>`;
      this.fxLayer.appendChild(this._demo);
    } else if (!on && this._demo) { this._demo.remove(); this._demo = null; }
  }

  go(on) { this._go.classList.toggle('on', !!on); }

  toast(text, seconds = 2, cls = '') {
    const el = document.createElement('div');
    el.className = 'kca-toast' + (cls ? ' ' + cls : '');
    el.textContent = text;
    this.fxLayer.appendChild(el);
    (this._toasts || (this._toasts = [])).push({ el, left: seconds }); // life counts render-frame dt (capture clock safe)
  }

  /** Route an input action to the top-most screen that wants it. */
  dispatch(player, action) {
    for (const s of [...this.screens.values()].reverse()) if (s.onAction && s.onAction(player, action) !== false) return true;
    return false;
  }

  update() {
    if (this._boss) this._syncBoss(0);
    // Feed screens with press edges from both players (same PlayerInput path as gameplay).
    const ins = this.game.input.players;
    for (let i = 0; i < ins.length; i++) {
      // Edge = down now, up last input update. Same as pressed() during play, and still one edge per press while the
      // sim tick is frozen (pause uses game.freeze, so game.tick does not advance).
      for (const a of ['left', 'right', 'up', 'down', 'light', 'heavy', 'jump', 'magic', 'dodge', 'start']) if (ins[i].down[a] && !ins[i].prev[a]) this.dispatch(i, a);
    }
  }

  /** C2 r15 (board r14 'the 2P flag / READY plaque run on the wall clock'): put the FINITE CSS animations / transitions an element just started (class
   *  toggle) on the UI clock. They are paused at 0 and stepped by render(frameDt) like the veil / toasts, so a frame-stepped capture (manual clock) shows
   *  them exactly as many ms in as it advanced - no wall wait - and live play is unchanged (frameDt is real time there). Call right after the toggle. */
  clockAnims(el) {
    if (!el || !el.getAnimations) return;
    void el.offsetWidth;                                  // flush style so the transition / animation objects exist
    for (const a of el.getAnimations()) {
      let end = 0;
      try { const t = a.effect.getComputedTiming(); if (t.iterations === Infinity) continue; end = t.endTime; } catch { continue; }
      if (!(end > 0) || a.playState === 'finished') continue;
      a.pause(); a.currentTime = 0;
      (this._anims || (this._anims = new Map())).set(a, end);
    }
  }

  render(alpha, frameDt) {
    this.hud.render(frameDt);
    if (this._anims && this._anims.size) {
      for (const [a, end] of this._anims) {
        if (a.playState === 'idle') { this._anims.delete(a); continue; }       // cancelled (class toggled off / element removed)
        const t = (Number(a.currentTime) || 0) + frameDt * 1000;
        if (t >= end) { try { a.finish(); } catch { a.cancel(); } this._anims.delete(a); } else a.currentTime = t;
      }
    }
    if (this._toasts && this._toasts.length) this._toasts = this._toasts.filter((t) => { t.left -= frameDt; if (t.left > 0) return true; t.el.remove(); return false; });
    for (const [id, s] of this.screens) { if (s.update) { try { s.update(frameDt); } catch (e) { reportError(`ui:${id}.update`, e); } } }
    if (this._card) {
      const t = Number(this._card.dataset.t) + frameDt, life = Number(this._card.dataset.life);
      this._card.dataset.t = String(t);
      const k = t < 0.35 ? t / 0.35 : t > life - 0.5 ? Math.max(0, (life - t) / 0.5) : 1;
      this._card.style.opacity = String(k);
      this._card.style.transform = `translate(-50%, -50%) scale(${0.97 + 0.03 * k})`;
      if (t > life) { this._card.remove(); this._card = null; if (this._veil) this._veil.classList.remove('on'); }
    }
    if (this._boss) this._syncBoss(frameDt);
    if (this._veil) {      // C2 r12: eased on the UI clock (the CSS opacity transition ran on wall time, so frame-stepped captures caught the GAME OVER veil half-faded over the ranking ledger)
      const goal = this._veil.classList.contains('on') ? 1 : 0;
      this._vk = (this._vk || 0) + (goal - (this._vk || 0)) * Math.min(1, frameDt * 4);
      if (Math.abs(goal - this._vk) < 0.01) this._vk = goal;
      this._veil.style.opacity = this._vk.toFixed(3);
    }
  }

  clearStage() {
    this.go(false); this.demo(false);
    if (this._card) { this._card.remove(); this._card = null; }
    if (this._boss) { this._boss.remove(); this._boss = null; }
    if (this._veil) { this._veil.classList.remove('on'); this._vk = 0; this._veil.style.opacity = '0'; }
    if (this.hud && this.hud.trackBoss) this.hud.trackBoss(null);
  }
}
