// HUD: per-player panels (DESIGN §7) — forged-bronze portrait medallion (live render-to-texture portrait when
// available, heraldic crest otherwise), forged name, lives (gold lozenges), LIFE BLOCKS (16 HP each, 3 per life;
// smooth drain + damage ghost inside each block), numbered MAGIC TIER BOXES filled with pot flasks, score,
// "CONTINUE? 9…0" in the dead player's slot, the combo counter + style rank (D…S…KNOT) and a boss life bar.
// Reads game.session (players) and falls back to live heroes in showcases. Only touches the DOM when values change.
import { EV } from '../core/EventBus.js';
import { forge } from './lettering.js';
import { crest, pot } from './art.js';
import { h } from './widgets.js';
import { capturePortrait } from './portraits.js';

export const HP_PER_BAR = 16;
const RANK_METAL = { D: 'bronze', C: 'bronze', B: 'copper', A: 'gold', S: 'ember', KNOT: 'gold' };
const POT = `<span class="kca-pot"><span class="f">${pot({ full: true })}</span><span class="e">${pot({ full: false })}</span></span>`;

export class Hud {
  constructor(ui, layer) {
    this.ui = ui;
    this.game = ui.game;
    this.el = document.createElement('div');
    this.el.className = 'kca-hud';
    layer.appendChild(this.el);
    this.panels = [0, 1].map((i) => this._panel(i));
    this.combos = [0, 1].map((i) => {
      const c = h(`<div class="kca-combo p${i + 1}"><span class="n"></span><span class="l">${forge('HITS', { metal: 'ivory', track: 10 })}</span><span class="r"></span><i class="bar"></i></div>`);
      c.style[i === 0 ? 'left' : 'right'] = '96px';
      this.el.appendChild(c);
      return { el: c, n: c.querySelector('.n'), r: c.querySelector('.r'), bar: c.querySelector('.bar'), t: 0, count: 0, rank: null };
    });
    // Arcade stage plate (1–5; Thieves' Night camps are named, never numbered): its own reserved slot top-centre between the two panels.
    this.stagePlate = h(`<div class="kca-stageplate"><div class="cap">${forge('STAGE', { metal: 'ivory', track: 16 })}</div><div class="num"></div><div class="sn"></div></div>`);
    this.el.appendChild(this.stagePlate);
    this.stageKey = null;
    this.boss = { el: h(`<div class="kca-bosshp"><div class="nm"></div><div class="bar"><i class="g"></i><i class="f"></i></div><div class="pz"><i></i></div></div>`), actor: null, hp: 0, ghost: 0, fade: 1 };
    this.el.appendChild(this.boss.el);
    this.portraits = new Map(); // heroId → dataURL (set by ui/portraits.js)
    const bus = this.game.bus;
    this.scope = bus.scope();
    this.scope.on(EV.COMBO, (e) => {
      const c = this.combos[e.player]; if (!c) return;
      c.count = e.count; c.t = 2.5;
      c.n.innerHTML = forge(String(e.count), { metal: e.count >= 30 ? 'gold' : 'ivory', track: 4 });
      if (e.rank !== c.rank) {
        c.rank = e.rank;
        c.r.className = 'r' + (e.rank === 'KNOT' ? ' knot' : '');
        c.r.innerHTML = e.rank ? forge(e.rank, { metal: RANK_METAL[e.rank] || 'copper', track: 6, glint: e.rank === 'S' || e.rank === 'KNOT' ? 1.2 : false }) : '';
        if (e.rank && c.r.animate) c.r.animate([{ transform: 'scale(2.2) rotate(-10deg)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.2,1.5,.35,1)' });
      }
      c.el.classList.toggle('on', e.count >= 2);
      if (c.n.animate) c.n.animate([{ transform: 'scale(1.45) rotate(-4deg)' }, { transform: 'scale(1)' }], { duration: 160, easing: 'ease-out' });
    });
    this.scope.on(EV.COMBO_END, (e) => { const c = this.combos[e.player]; if (c) c.t = Math.min(c.t, 0.6); });
    this.scope.on(EV.MAGIC_SELECT, (e) => { const P = e.hero && this.panels[e.hero.playerIndex]; if (P) { P.state.sel = e.tier; P.state.selT = 1.2; P.state.pots = -1; } });
    this.scope.on(EV.HIT, (e) => { const t = e.target; if (t && t.kind === 'hero' && t.playerIndex != null && !e.blocked) { const P = this.panels[t.playerIndex]; if (P) { P.medal.classList.remove('hit'); void P.medal.offsetWidth; P.medal.classList.add('hit'); } } });
    this.scope.on(EV.BOSS_INTRO, (e) => this.trackBoss(e.boss));
  }

  _panel(i) {
    const d = h(`<div class="kca-pp p${i + 1} empty">
      <div class="kca-medal"><div class="ring"></div><div class="face"></div><div class="tag">${i ? '2P' : '1P'}</div></div>
      <div class="kca-pinfo"><div class="kca-name"><span class="nm"></span><span class="kca-lives"></span></div>
        <div class="kca-life"></div>
        <div class="kca-row"><div class="kca-tiers"></div><div class="kca-score">0</div></div>
        <div class="kca-continue"><span class="d"></span><span class="txt"><span class="l">${forge('CONTINUE?', { metal: 'ivory', track: 10 })}</span><span class="h">PRESS START</span></span></div></div>
      <div class="kca-join">${i ? '2P' : '1P'} PRESS START</div></div>`);
    this.el.appendChild(d);
    return {
      el: d, medal: d.querySelector('.kca-medal'), face: d.querySelector('.face'), name: d.querySelector('.nm'), life: d.querySelector('.kca-life'),
      tiers: d.querySelector('.kca-tiers'), lives: d.querySelector('.kca-lives'), score: d.querySelector('.kca-score'),
      cont: d.querySelector('.kca-continue'), contN: d.querySelector('.kca-continue .d'),
      blocks: [], potEls: [], tierEls: [],
      state: { hero: null, hp: -1, ghost: -1, bars: -1, pots: -1, lives: -1, score: -1, cont: -2, sel: 0, selT: 0, portrait: null },
    };
  }

  show(on) { this.el.classList.toggle('on', !!on); }

  /** Arcade stage number (1–5; null hides the numeral, e.g. test stages / duel) and the stage's short name. */
  setStage(num, name = '') {
    const key = `${num}|${name}`;
    if (key === this.stageKey) return;
    this.stageKey = key;
    const P = this.stagePlate;
    P.classList.toggle('on', num != null || !!name);
    P.classList.toggle('nonum', num == null);
    P.querySelector('.num').innerHTML = num != null ? forge(String(num), { metal: 'gold', track: 0, glint: 1.2 }) : '';
    P.querySelector('.sn').textContent = name;
  }

  /** Register a rendered portrait for a hero id (called by ui/portraits.js). */
  setPortrait(heroId, url) { this.portraits.set(heroId, url); for (const P of this.panels) P.state.portrait = null; }

  trackBoss(actor) {
    const B = this.boss; B.actor = actor || null;
    if (!actor) { B.el.classList.remove('on'); return; }
    const name = (actor.def && actor.def.name) || actor.name || actor.typeId || 'BOSS';
    B.el.querySelector('.nm').innerHTML = forge(name, { metal: 'ember', track: 10 });
    B.hp = B.ghost = actor.hp; B.fade = 0; this._bossFade(0); B.el.classList.add('on');
  }

  /** Boss bar entrance on render-frame dt (capture-clock safe): 0.5 s fade + settle from 90 % scale. */
  _bossFade(dt) {
    const B = this.boss; B.fade = Math.min(0.5, (B.fade || 0) + dt);
    const k = B.fade / 0.5, e = 1 - (1 - k) * (1 - k);
    B.el.style.opacity = String(e.toFixed(3));
    B.el.style.transform = k >= 1 ? '' : `translateX(-50%) scale(${(0.9 + 0.1 * e).toFixed(3)})`;
  }

  _playerData(i) {
    const s = this.game.session;
    if (s && s.players[i] && s.players[i].active) {
      const p = s.players[i];
      return { hero: p.actor, lives: p.lives, score: p.score, cont: p.continueTimer ?? -1, out: p.out };
    }
    const hr = this.game.world.query({ kind: 'hero', alive: false }).find((x) => x.playerIndex === i);
    if (hr) return { hero: hr, lives: 3, score: 0, cont: -1 };
    return null;
  }

  /** Build life blocks for a max HP (3 bars normally, 8 in Duel). */
  _buildLife(P, maxHp) {
    const n = Math.max(1, Math.ceil(maxHp / HP_PER_BAR));
    P.life.innerHTML = Array.from({ length: n }, () => '<div class="kca-block"><i class="ghost"></i><i class="fill"></i></div>').join('');
    const w = n > 4 ? Math.max(34, Math.floor(300 / n)) : 94;
    P.blocks = [...P.life.children].map((b) => { b.style.width = `${w}px`; return { ghost: b.children[0], fill: b.children[1], el: b }; });
    P.state.bars = n;
  }

  /** Numbered tier boxes; box k holds the pots from tier k's threshold up to the next one (Brann: 2·2·1·1). */
  _buildTiers(P, hero) {
    const th = hero.tierThresholds || [];
    const max = hero.maxPots ?? th[th.length - 1] ?? 0;
    let html = '';
    th.forEach((t, k) => {
      const n = Math.max(1, (k + 1 < th.length ? th[k + 1] : max + 1) - t);
      html += `<div class="kca-tier" data-t="${k + 1}"><em>${k + 1}</em>${POT.repeat(n)}</div>`;
    });
    P.tiers.innerHTML = html;
    P.tierEls = [...P.tiers.children];
    P.potEls = [...P.tiers.querySelectorAll('.kca-pot')];
  }

  _face(P, h2) {
    const id = h2.typeId || (h2.def && h2.def.id);
    const url = this.portraits.get(id);
    const key = url || `crest:${id}`;
    if (P.state.portrait === key) return;
    P.state.portrait = key;
    P.face.innerHTML = url ? `<img src="${url}" alt="">` : crest(id, { size: 56 });
  }

  render(dt) {
    for (let i = 0; i < 2; i++) {
      const P = this.panels[i], st = P.state, d = this._playerData(i);
      if (!d || !d.hero) {
        if (st.hero !== null) { P.el.classList.add('empty'); st.hero = null; P.cont.classList.remove('on'); P.el.classList.remove('cont'); }
        continue;
      }
      const hr = d.hero;
      if (st.hero !== hr) {
        st.hero = hr; P.el.classList.remove('empty');
        const ui = (hr.def && hr.def.ui) || {};
        P.el.style.setProperty('--pc', ui.color || '#c8874a');
        const nm = (hr.def && hr.def.name ? hr.def.name.split(' ')[0] : hr.typeId).toUpperCase();
        P.name.innerHTML = forge(nm, { metal: i ? 'p2' : 'p1', track: 12 });
        this._buildLife(P, hr.maxHp);
        this._buildTiers(P, hr);
        st.hp = -1; st.ghost = Math.max(0, hr.hp); st.pots = -1; st.lives = -1; st.portrait = null;
      }
      // Live portrait: once the hero has been on screen ~0.5 s (idle pose settled), render its head to a texture.
      const hid = hr.typeId || (hr.def && hr.def.id);
      if (!this.portraits.has(hid) && !this._noPortraits) {
        st.faceT = (st.faceT || 0) + dt;
        const inStage = !this.game.flow || this.game.flow.state !== 'select';   // r9: never grab the select-screen puppets (different light rig)
        if (inStage && st.faceT > 0.5 && hr.alive !== false && hr.pos && hr.pos.y <= 0.05) {
          st.faceT = -0.5; // retry in ~1 s on failure (guard-hidden / empty frame)
          try { const url = capturePortrait(this.game, hr); if (url) this.setPortrait(hid, url); } catch { this._noPortraits = true; }
        }
      }
      this._face(P, hr);
      if (Math.ceil(hr.maxHp / HP_PER_BAR) !== st.bars) this._buildLife(P, hr.maxHp);
      // Life: smooth drain of the fill + a lagging damage ghost (per block).
      const hp = Math.max(0, hr.hp);
      const healing = st.hp >= 0 && hp > st.hp + 0.5;
      st.hp = st.hp < 0 ? hp : st.hp + (hp - st.hp) * Math.min(1, dt * 14);
      st.ghost = st.ghost > st.hp ? Math.max(st.hp, st.ghost - dt * HP_PER_BAR * 0.9) : st.hp;
      for (let b = 0; b < P.blocks.length; b++) {
        const lo = b * HP_PER_BAR;
        const f = Math.max(0, Math.min(1, (st.hp - lo) / HP_PER_BAR)), g = Math.max(0, Math.min(1, (st.ghost - lo) / HP_PER_BAR));
        const B = P.blocks[b];
        B.fill.style.transform = `scaleX(${f.toFixed(3)})`;
        B.ghost.style.transform = `scaleX(${g.toFixed(3)})`;
        B.el.classList.toggle('empty', g <= 0);
      }
      P.life.classList.toggle('low', hp > 0 && hp <= HP_PER_BAR * 0.5);
      if (healing) P.life.classList.add('heal'); else if (Math.abs(hp - st.hp) < 0.3) P.life.classList.remove('heal');
      // Magic tier boxes.
      if (st.selT > 0) { st.selT -= dt; if (st.selT <= 0) { st.sel = 0; st.pots = -1; } }
      if (hr.pots !== st.pots) {
        P.potEls.forEach((p, k) => { const was = p.classList.contains('full'), now = k < hr.pots; p.classList.toggle('full', now); if (now && !was && st.pots >= 0) { p.classList.remove('pop'); void p.offsetWidth; p.classList.add('pop'); } });
        const tier = hr.magicTier ? hr.magicTier() : 0;
        P.tierEls.forEach((t, k) => { t.classList.toggle('ready', k < tier); t.classList.toggle('sel', st.sel === k + 1); });
        st.pots = hr.pots;
      }
      if (d.lives !== st.lives) { const n = Math.max(0, d.lives); P.lives.innerHTML = Array.from({ length: Math.max(3, n) }, (_, k) => `<i class="${k < n ? '' : 'gone'}"></i>`).join(''); st.lives = d.lives; }
      if (d.score !== st.score) {
        P.score.textContent = String(Math.floor(d.score)).padStart(7, '0');
        if (st.score >= 0) { P.score.classList.remove('bump'); void P.score.offsetWidth; P.score.classList.add('bump'); }
        st.score = d.score;
      }
      const cont = d.cont >= 0 ? Math.max(0, Math.min(9, Math.ceil(d.cont) - 1)) : -1; // 9 … 0
      if (cont !== st.cont) {
        P.cont.classList.toggle('on', cont >= 0); P.el.classList.toggle('cont', cont >= 0); if (this.combos[i]) this.combos[i].el.classList.toggle('muted', cont >= 0);
        if (cont >= 0) { P.contN.innerHTML = forge(String(cont), { metal: cont <= 3 ? 'ember' : 'gold', track: 0 }); }
        st.cont = cont;
      }
    }
    for (const c of this.combos) {
      if (c.t > 0) { c.t -= dt; c.bar.style.transform = `scaleX(${Math.max(0, Math.min(1, c.t / 2.5)).toFixed(3)})`; if (c.t <= 0) { c.el.classList.remove('on'); c.rank = null; } }
    }
    const B = this.boss;
    if (B.actor) {
      if (B.fade < 0.5) this._bossFade(dt);
      const mx = B.actor.maxHp || 1, hp = Math.max(0, B.actor.hp);
      B.hp += (hp - B.hp) * Math.min(1, dt * 12); B.ghost = B.ghost > B.hp ? Math.max(B.hp, B.ghost - dt * mx * 0.25) : B.hp;
      B.el.querySelector('.f').style.transform = `scaleX(${(B.hp / mx).toFixed(3)})`;
      B.el.querySelector('.g').style.transform = `scaleX(${(B.ghost / mx).toFixed(3)})`;
      const pz = B.actor.poise, zp = B.el.querySelector('.pz');   // bosses r7: poise sliver (gold → white; grey while break-immune, pulsing in a stagger)
      if (pz) { zp.classList.add('on'); zp.classList.toggle('lock', pz.immune > 0); zp.classList.toggle('brk', pz.stagger > 0); zp.firstChild.style.transform = `scaleX(${pz.frac.toFixed(3)})`; } else zp.classList.remove('on');
      if (B.actor.removed || (hp <= 0 && B.ghost <= 0.01)) { B.actor = null; B.el.classList.remove('on'); }
    }
  }

  dispose() { this.scope.dispose(); this.el.remove(); }
}
