// High scores: initials entry for each qualifying player (▴▾ letter, LIGHT/▸ next, HEAVY/◂ back, START done), then
// the top-10 Hall of Legends table with the new rows highlighted. View-only when entries is empty.
// opts: { entries: [{ player, score, hero, stage }], onDone(), hold (seconds on the table, default 8) }
import { forge } from '../lettering.js';
import { rule, crest } from '../art.js';
import { h, panel, fmt, sfx, CONFIRM, BACK } from '../widgets.js';
import { loadScores, addScore, qualifies } from '../../game/HighScores.js';

const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ.!?0123456789 ';
const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];

export default {
  id: 'highscore',
  create(ui, opts = {}) {
    const el = h('<div class="kca-hs"></div>');
    const queue = (opts.entries || []).filter((e) => qualifies(e.score) >= 0);
    const fresh = [];
    let mode = queue.length ? 'entry' : 'table', t = 0, finished = false;
    let slots = [0, 0, 0], at = 0, entry = null;
    const hold = opts.hold ?? 8;
    const drawTable = () => {
      const list = loadScores();
      const p = panel(`<div class="hd"><div class="k">${forge('HALL OF LEGENDS', { metal: 'bronze', track: 18 })}</div>${forge('HIGH SCORES', { metal: 'gold', track: 14, glint: 3 })}</div>${rule({ width: 620 })}
        <table>${list.map((e, i) => `<tr class="${fresh.includes(i) ? 'new' : ''}"><td class="r">${ORD[i]}</td><td class="h">${e.hero ? crest(e.hero, { size: 26 }) : ''}</td><td class="i">${e.initials}</td><td class="st">${/^[1-5]$/.test(String(e.stage)) ? `stage ${e.stage}` : ''}</td><td class="s">${fmt(e.score)}</td></tr>`).join('')}</table>`);
      el.innerHTML = ''; el.appendChild(p);
    };
    const drawEntry = () => {
      const e = entry;
      const p = panel(`<div class="hd"><div class="k">${forge('A NEW LEGEND', { metal: 'bronze', track: 18 })}</div>${forge('ENTER YOUR NAME', { metal: 'gold', track: 12, glint: 3 })}</div>${rule({ width: 620 })}
        <div class="kca-entry" style="--pcol:var(--p${e.player + 1})"><div class="who"><b>${e.player + 1}P</b> · ${(e.hero || '').toUpperCase()} · rank ${ORD[qualifies(e.score)] || ''}</div>
        <div class="sc2">${fmt(e.score)}</div>
        <div class="slots">${slots.map((c, i) => `<div class="slot${i === at ? ' cur' : ''}">${forge(ABC[c] === ' ' ? '-' : ABC[c], { metal: i === at ? 'gold' : 'copper', track: 0 })}</div>`).join('')}</div>
        <div class="kca-btnrow"><span><b>▴▾</b>LETTER</span><span><b>J</b>NEXT</span><span><b>K</b>BACK</span><span><b>START</b>DONE</span></div></div>`);
      el.innerHTML = ''; el.appendChild(p);
    };
    const nextEntry = () => {
      entry = queue.shift();
      if (!entry) { mode = 'table'; t = 0; drawTable(); return; }
      slots = [0, 0, 0]; at = 0; drawEntry();
    };
    const commit = () => {
      const initials = slots.map((c) => ABC[c]).join('').replace(/ /g, '-');
      const i = addScore({ initials, score: entry.score, hero: entry.hero, stage: entry.stage });
      if (i >= 0) fresh.push(i);
      sfx(ui, 'confirm');
      nextEntry();
    };
    if (mode === 'entry') nextEntry(); else drawTable();
    const done = () => { if (finished) return; finished = true; if (opts.onDone) opts.onDone(); };
    return {
      el, get mode() { return mode; }, get initials() { return slots.map((c) => ABC[c]).join(''); },
      update(dt) { t += Math.min(dt, 0.5); if (mode === 'table' && t > hold) done(); if (mode === 'entry' && t > 45) commit(); },
      onAction(player, action) {
        if (mode === 'table') { if (CONFIRM.includes(action) && t > 0.6) done(); return true; }
        if (!entry || (player !== entry.player && !(opts.anyPlayer))) return true;
        t = 0;
        if (action === 'up' || action === 'down') { slots[at] = (slots[at] + (action === 'up' ? ABC.length - 1 : 1)) % ABC.length; sfx(ui, 'move'); drawEntry(); }
        else if (action === 'right' || action === 'light' || action === 'jump') { if (at < 2) { at++; sfx(ui, 'move'); drawEntry(); } else commit(); }
        else if (action === 'left' || BACK.includes(action)) { if (at > 0) { at--; sfx(ui, 'back'); drawEntry(); } }
        else if (action === 'start') commit();
        return true;
      },
    };
  },
};
