// Character select (DESIGN §7/§10): 3D barrow set — the three heroes stand in giant skeletal hands, torchlit, with a
// per-player "chosen" spotlight (ui/select3d.js). Each player moves an independent cursor (1P amber, 2P blue);
// 2P drops in with START/LIGHT. Confirm → the hero plays its victory clip and a READY stamp lands; HEAVY/DODGE
// un-readies (or backs out to the title for 1P). DUPLICATES ARE NOT ALLOWED: a hero readied by one player is
// TAKEN for the other (distinct silhouettes/colours keep co-op readable; GA arcade rule). A 30 s timer auto-readies.
// opts: { heroes: [def...], player, onConfirm([{ player, heroId }]), onBack(), onCursor(player, heroId), no3d }
import { forge } from '../lettering.js';
import { reportError } from '../../core/log.js';
import { rule, crest, pot } from '../art.js';
import { h, panel, sfx, CONFIRM, BACK } from '../widgets.js';

const STATS = {
  brann: { POWER: 4, SPEED: 3, DEFENCE: 3, MAGIC: 4 },
  seraphine: { POWER: 2, SPEED: 5, DEFENCE: 2, MAGIC: 5 },
  gorrim: { POWER: 5, SPEED: 2, DEFENCE: 5, MAGIC: 2 },
};
const BIOS = {
  brann: 'Storm-born barbarian who carries his clan’s grudge on a greatsword. Balanced reach and power; his earth magic splits the ground.',
  seraphine: 'Ember-blooded blade-dancer. Fastest on the ground and deadliest in the air — she trades armour for six levels of fire.',
  gorrim: 'Keeper of the Copper Ax. Slow, stubborn and hard to knock down; throws raiders like grain sacks and calls down the storm.',
};
const EL = { earth: '#e0a060', fire: '#ff6a30', storm: '#8fd0ff' };
const SELECT_SECONDS = 30;
const flag = (n, col) => `<svg viewBox="0 0 50 60"><path d="M4 0 H46 V46 L25 58 L4 46 Z" fill="${col}" stroke="#140803" stroke-width="3"/><path d="M9 4 H41 V43 L25 52 L9 43 Z" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1.5"/>
<text x="25" y="33" text-anchor="middle" font-family="Palatino Linotype, Georgia, serif" font-weight="700" font-size="20" fill="#140803">${n}P</text></svg>`;

export default {
  id: 'select',
  create(ui, opts = {}) {
    const game = ui.game;
    const heroes = opts.heroes || [];
    const el = h(`<div class="kca-select"><div class="hd">${forge('CHOOSE YOUR CHAMPION', { metal: 'copper', track: 14, glint: 3.5 })}${rule({ width: 640 })}</div>
      <div class="timer">TIME<span class="t"></span></div><div class="join2">2P PRESS START</div>
      <div class="kca-cards"></div>
      <div class="kca-btnrow"><span><b>◂ ▸</b>CHOOSE</span><span><b>J</b>READY</span><span><b>K</b>BACK</span><span><b>2P</b>NUMPAD · ARROWS</span></div></div>`);
    const row = el.querySelector('.kca-cards');
    const cards = heroes.map((d) => {
      const st = STATS[d.id] || { POWER: 3, SPEED: 3, DEFENCE: 3, MAGIC: 3 };
      const elc = EL[d.magic && d.magic.element] || '#ffcf80';
      const c = panel(`<div class="kca-flag f1">${flag(1, '#ff9a3c')}</div><div class="kca-flag f2">${flag(2, '#5fb2ff')}</div>
        <div class="kca-stamp s1">${forge('READY', { metal: 'p1', track: 8 })}</div><div class="kca-stamp s2">${forge('READY', { metal: 'p2', track: 8 })}</div>
        <div class="top">${crest(d.id, { size: 58 })}<div><div class="nm">${forge(d.name.split(' ')[0], { metal: 'gold', track: 10 })}</div><div class="ttl">${d.title || ''}</div></div></div>
        <p>${BIOS[d.id] || (d.ui && d.ui.blurb) || ''}</p>
        <div class="kca-stats">${Object.entries(st).map(([k, v]) => `<span>${k.toLowerCase()}</span><span class="pips">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= v ? 'on' : ''}"></i>`).join('')}</span>`).join('')}</div>
        <div class="el" style="--elc:${elc}"><span class="gem"></span>${(d.magic && d.magic.element) || ''} magic · ${d.magic ? d.magic.maxTier : 0} levels<span class="n">${pot({ full: true })}× ${d.magic ? d.magic.pots : 0}</span></div>`, 'kca-hcard');
      row.appendChild(c);
      return c;
    });
    const tEl = el.querySelector('.timer .t'), join2 = el.querySelector('.join2');
    const first = opts.player ?? 0;
    const cur = [0, 1].map((p) => ({ i: p === 1 ? Math.min(2, heroes.length - 1) : 0, joined: p === first, locked: false }));
    if (first === 1) cur[1].i = 0;
    let timer = SELECT_SECONDS, lastT = -1, done = false, set = null, disposed = false;
    const lockedBy = (i, not) => cur.findIndex((c, p) => p !== not && c.joined && c.locked && c.i === i);
    const paint = () => {
      cards.forEach((c, k) => {
        const p1 = cur[0].joined && cur[0].i === k, p2 = cur[1].joined && cur[1].i === k;
        c.classList.toggle('locked', (p1 && cur[0].locked) || (p2 && cur[1].locked)); c.classList.toggle('p1', p1); c.classList.toggle('p2', p2); c.classList.toggle('hov', p1 || p2);
        // C2 r15: the flag drop-in + READY plaque slam run on the UI clock (ui.clockAnims), not the browser's wall clock
        for (const [sel, on] of [['.f1', p1], ['.f2', p2], ['.s1', p1 && cur[0].locked], ['.s2', p2 && cur[1].locked]]) {
          const n = c.querySelector(sel);
          if (n.classList.contains('on') === on) continue;
          n.classList.toggle('on', on);
          if (on && ui.clockAnims) ui.clockAnims(n);
        }
        c.dataset.taken = lockedBy(k, -1) >= 0 ? 'yes' : '';
      });
      join2.style.display = cur[1].joined ? 'none' : '';
      if (set) cur.forEach((c, p) => set.hover(p, c.joined ? c.i : null));
    };
    const finish = () => {
      if (done) return; done = true;
      const picks = cur.map((c, p) => (c.joined ? { player: p, heroId: heroes[c.i].id } : null)).filter(Boolean);
      game.after(84, () => { if (opts.onConfirm) opts.onConfirm(picks); }); // sim clock (deterministic in captures)
    };
    const lock = (p) => {
      const c = cur[p];
      if (lockedBy(c.i, p) >= 0) { // TAKEN by the other player
        const card = cards[c.i]; if (card.animate) card.animate([{ transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }], { duration: 220 });
        ui.toast(`${heroes[c.i].name.split(' ')[0].toUpperCase()} IS TAKEN — CHOOSE ANOTHER`, 1.6, 'top'); sfx(ui, 'back'); return;
      }
      c.locked = true; sfx(ui, 'confirm');
      if (set) set.confirm(c.i, p);
      if (cur.every((x) => !x.joined || x.locked)) finish();
    };
    paint();
    let ready = Promise.resolve();
    if (!opts.no3d) {
      ready = import('../select3d.js').then((m) => game.track(m.buildSelectSet(game, heroes.map((d) => d.id)))).then((s) => { if (disposed) { if (s) s.dispose(); return; } set = s; paint(); }).catch((e) => reportError('ui:select3d', e));
    }
    return {
      el,
      get set() { return set; },
      ready, // resolves once the 3D set (hands, torches, heroes) is built — captures/showcases await it
      cursors: cur,
      update(dt) {
        if (set) set.update(dt);
        if (!done && !opts.noTimer) {
          timer -= dt;
          const n = Math.max(0, Math.ceil(timer));
          if (n !== lastT) { lastT = n; tEl.innerHTML = forge(String(n).padStart(2, '0'), { metal: n <= 5 ? 'ember' : 'gold', track: 4 }); }
          if (timer <= 0) cur.forEach((c, p) => { if (c.joined && !c.locked) { while (lockedBy(c.i, p) >= 0) c.i = (c.i + 1) % heroes.length; lock(p); } });
        }
      },
      onAction(player, action) {
        const c = cur[player];
        if (done) return true;
        if (!c.joined) { if (action === 'start' || action === 'light') { c.joined = true; sfx(ui, 'confirm'); if (lockedBy(c.i, player) >= 0) c.i = (c.i + 1) % heroes.length; paint(); } return true; }
        if (c.locked) {
          if (BACK.includes(action)) { c.locked = false; if (set) set.idle(c.i); sfx(ui, 'back'); paint(); }
          return true;
        }
        if (action === 'left' || action === 'right') {
          c.i = (c.i + (action === 'left' ? heroes.length - 1 : 1)) % heroes.length; sfx(ui, 'move');
        } else if (CONFIRM.includes(action)) lock(player);
        else if (BACK.includes(action)) {
          if (player === 1 && first !== 1) { c.joined = false; sfx(ui, 'back'); }
          else if (opts.onBack) { sfx(ui, 'back'); opts.onBack(); return true; }
        }
        if (opts.onCursor) opts.onCursor(player, heroes[c.i].id);
        paint();
        return true;
      },
      dispose() { disposed = true; if (set) set.dispose(); },
    };
  },
};
