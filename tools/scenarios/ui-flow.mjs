// UI/flow regression (ui-flow agent): drives the REAL flow with scripted input and reads the DOM.
//   node tools/capture.mjs --url "/?mode=title" --scenario tools/scenarios/ui-flow.mjs --out progress/shots/ui-flow/rN/flow --timeout 180000
// title (PRESS START → menu) → ARCADE → select (P2 joins, duplicate blocked, both READY) → map → stage 1 (card, HUD,
// portraits) → pause/resume → forced stage clear → tally → bonus → GAME OVER → ranking → initials → high scores → title.
// Writes ui-flow.json with PASS/FAIL checks.
import fs from 'node:fs';
import path from 'node:path';
import { COLLECT, analyse, describe } from '../lib/uioverlap.mjs';

export default async (api) => {
  const R = { checks: [] };
  const ok = (name, pass, detail) => { R.checks.push({ name, pass: !!pass, detail }); api.log((pass ? 'PASS ' : 'FAIL ') + name + ' ' + JSON.stringify(detail ?? '').slice(0, 300)); };
  const E = (fn, arg) => api.evalGame(fn, arg);
  const flow = () => E(() => window.__KCA.game.flow.state);
  const has = (sel) => E((s) => !!document.querySelector(s), sel);
  const press = async (p, a, wait = 250) => { await api.press(p, a, 60); await api.advance(wait); };
  // ui-flow r5: every captured state also runs the text-overlap detector (tools/lib/uioverlap.mjs) — no visible text
  // may intersect other text or leave the viewport (the defect class that came back on select/title in r4).
  const vp = () => E(() => ({ width: innerWidth, height: innerHeight }));
  const noOverlap = async (name) => { const res = analyse(await E(COLLECT), await vp()); ok(`no text overlap: ${name}`, !res.overlaps.length && !res.offscreen.length && res.count > 1, describe(res).slice(0, 4).concat(`${res.count} items`)); };
  const shotOv = async (name) => { await api.shot(name); await noOverlap(name); };
  const walk = async (ms, step = 100) => { for (let t = 0; t < ms; t += step) await api.advance(step); }; // many rendered frames (UI animations run on frame dt)
  const until = async (fn, ms = 20000, step = 250) => { for (let t = 0; t < ms; t += step) { if (await fn()) return true; await api.advance(step); } return false; };

  await api.advance(800);
  ok('title screen shown', (await flow()) === 'title' && (await has('.kca-screen-title .kca-logo')), await flow());
  await shotOv('01_title');
  await press(1, 'start', 600);
  ok('PRESS START opens the mode menu', await E(() => !document.querySelector('.kca-menuwrap.hidden') && document.querySelector('.kca-mi.sel').dataset.id === 'arcade'));
  await press(1, 'down'); await press(1, 'down');
  const sel2 = await E(() => document.querySelector('.kca-mi.sel').dataset.id);
  await press(1, 'up'); await press(1, 'up');
  ok('menu navigates (down ×2 = options)', sel2 === 'options', sel2);
  await shotOv('02_menu');
  await press(1, 'light', 400);
  ok('ARCADE → character select', await until(async () => (await flow()) === 'select' && (await has('.kca-screen-select .kca-hcard'))), await flow());
  await until(() => E(() => !!window.__KCA.game.renderer.scene.getObjectByName('selectSet')), 20000);
  await api.advance(1200);
  await shotOv('03_select');
  await press(2, 'start', 300);
  ok('2P drops in on select', await E(() => document.querySelectorAll('.kca-flag.f2.on').length === 1));
  await press(1, 'light', 300);                        // P1 readies Brann
  await press(2, 'left'); await press(2, 'left');      // P2 cursor onto Brann
  await press(2, 'light', 300);
  ok('duplicate pick blocked (TAKEN)', await E(() => document.querySelectorAll('.kca-stamp.s2.on').length === 0 && !!document.querySelector('.kca-toast')));
  await noOverlap('select_duplicate_toast');
  // C2 r14 (board r13: the "both READY" frame showed 1P READY + a "BRANN IS TAKEN" toast): the duplicate-pick test above stays, but P2 only picks
  // Seraphine once its toast (1.6 s of UI time) has cleared, and the frame is taken with BOTH stamps on and no toast (select -> map starts ~1.4 s later).
  ok('duplicate-pick toast clears by itself', await until(() => E(() => !document.querySelector('.kca-toast')), 4000, 100));
  await press(2, 'right'); await press(2, 'light', 300); // P2 readies Seraphine
  ok('both READY', await until(() => E(() => document.querySelectorAll('.kca-stamp.on').length === 2), 2000, 50));
  // the 2P flag / READY plaque land with CSS animations on the browser's WALL clock (the manual game clock does not drive them): without a real wait the
  // frame caught them still at opacity 0 / scale 2.2 (the r13 board saw only "1P READY"). Wait 1 s of wall time (sim is paused between advance() calls).
  await api.advance(350); await api.page.evaluate(() => new Promise((r) => setTimeout(r, 1000))); await shotOv('04_select_ready');
  ok('ready frame is clean (both READY, no toast)', await E(() => document.querySelectorAll('.kca-stamp.on').length === 2 && !document.querySelector('.kca-toast')));
  ok('select → map interlude', await until(async () => (await flow()) === 'map', 8000), await flow());
  await walk(3200); await shotOv('05_map');
  const capK = () => E(() => { const k = document.querySelector('.kca-map .cap .k'); return k ? k.textContent.trim() : null; });
  ok('stage numbering 1-5: map caption reads "Stage 1" for the first leg', (await capK()) === 'Stage 1', await capK());
  const nums = await E(async () => { const m = await import('/src/game/StageRunner.js'); const g = window.__KCA.game; return ['1', '2', '3', '4', '5', 'bonus', 'stage3', 'stage5'].map((id) => m.arcadeStageNumber(g, id)); });
  ok('stage numbering 1-5: arcadeStageNumber(1..5)=1..5, camps unnumbered', JSON.stringify(nums) === JSON.stringify([1, 2, 3, 4, 5, null, 3, 5]), nums);
  await press(1, 'light', 200); await press(1, 'light', 200);
  ok('map → stage 1', await until(async () => (await flow()) === 'stage' && (await E(() => window.__KCA.info().heroes.length === 2)), 30000), await flow());
  await api.advance(600);
  const card = await E(() => { const c = document.querySelector('.kca-card'); return c && { t: c.dataset.title, s: c.dataset.sub }; });
  ok('stage title card', card && /STAGE 1/.test(card.t) && /Ashen Wilds/i.test(card.s), card);
  await shotOv('06_stage_card');
  const pl1 = await E(() => { const p = document.querySelector('.kca-stageplate'); return p && { on: p.classList.contains('on'), key: p.parentNode && window.__KCA && document.querySelector('.kca-stageplate .sn').textContent, num: (window.__KCA.game || {}).ui ? window.__KCA.game.ui.hud.stageKey : null }; });
  ok('HUD arcade stage plate = 1', pl1 && pl1.on && /^1\|/.test(String(pl1.num)), pl1);
  const ai = await E(() => { const g = window.__KCA.game; return g.ai && g.ai.tokens && { max: g.ai.tokens.maxPerTarget, hold: g.ai.tokens.holdTicks, d: g.ai.difficulty }; });
  ok('difficulty drives AI attack tokens', ai && ai.max === ({ easy: 1, normal: 2, hard: 3 })[ai.d], ai);
  await api.advance(3000);
  // r9: portrait PIXELS, not just <img> elements (r8 passed with an empty-black Brann medallion: the program guard had hidden the actor
  // on layer 30 during the one-shot render and the black frame was cached). Poll until both medallions hold a real image.
  const portraitPx = () => E(() => Promise.all([...document.querySelectorAll('.kca-pp:not(.empty) .kca-medal .face')].map(async (f) => {
    const im = f.querySelector('img'); if (!im) return { img: false, lit: 0, mean: 0 };
    try { await im.decode(); } catch { return { img: true, lit: 0, mean: 0 }; }
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.drawImage(im, 0, 0, 64, 64);
    const d = g.getImageData(0, 0, 64, 64).data; let lit = 0, sum = 0;
    for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; sum += l; if (l > 30) lit++; }
    return { img: true, lit: +(lit / 4096).toFixed(3), mean: +(sum / 4096).toFixed(1) };
  })));
  // selftest: the same pixel analysis must reject an all-black medallion (what r8 shipped) — so the probe cannot pass vacuously again
  const blackLit = await E(async () => {
    const c0 = document.createElement('canvas'); c0.width = c0.height = 160; const g0 = c0.getContext('2d'); g0.fillStyle = '#0a0605'; g0.fillRect(0, 0, 160, 160);
    const im = new Image(); im.src = c0.toDataURL('image/png'); await im.decode();
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.drawImage(im, 0, 0, 64, 64);
    const d = g.getImageData(0, 0, 64, 64).data; let lit = 0;
    for (let i = 0; i < d.length; i += 4) if ((d[i] + d[i + 1] + d[i + 2]) / 3 > 30) lit++;
    return lit / 4096;
  });
  ok('portrait probe selftest: a black medallion image reads lit=0 (would FAIL the check)', blackLit < 0.01, blackLit);
  let px = [];
  for (let k = 0; k < 14; k++) { px = await portraitPx(); if (px.length === 2 && px.every((p) => p.img && p.lit > 0.15)) break; await api.advance(500); }
  ok('HUD portrait PIXELS: both medallions hold a lit hero (not black)', px.length === 2 && px.every((p) => p.img && p.lit > 0.15 && p.mean > 25), px);
  const hud = await E(() => ({ names: [...document.querySelectorAll('.kca-pp:not(.empty) .kca-name .nm .forge')].map((s) => s.getAttribute('aria-label')), blocks: document.querySelectorAll('.kca-pp.p1 .kca-block').length, portraits: document.querySelectorAll('.kca-medal .face img').length }));
  ok('HUD shows both heroes with 3 life blocks', hud.names.length === 2 && hud.blocks === 3, hud);
  ok('HUD live portraits rendered (2 <img>)', hud.portraits === 2, hud.portraits);
  await shotOv('07_hud');
  await press(1, 'start', 400);
  const t0 = await E(() => window.__KCA.game.tick);
  await api.advance(500);
  const t1 = await E(() => window.__KCA.game.tick);
  ok('pause freezes the sim', (await has('.kca-screen-pause')) && t1 === t0, { t0, t1 });
  await shotOv('08_pause');
  await press(1, 'down', 200); await press(1, 'up', 200); await press(1, 'light', 300);
  await api.advance(300);
  const t2 = await E(() => window.__KCA.game.tick);
  ok('resume', !(await has('.kca-screen-pause')) && t2 > t1, { t2 });
  // Force a stage clear → tally.
  await E(() => { window.__KCA.debug.kill('enemies'); window.__KCA.game.bus.emit('stageClear', { stageId: 'stage1' }); });
  ok('stage clear → tally', await until(async () => (await flow()) === 'tally' && (await has('.kca-screen-tally')), 8000), await flow());
  await walk(3600); await shotOv('09_tally');
  const tk = await E(() => { const k = document.querySelector('.kca-screen-tally .hd .k .forge'); return k ? k.getAttribute('aria-label') : null; });
  ok('stage numbering 1-5: stage-clear tally kicker = STAGE 1', tk === 'STAGE 1', tk);
  const rate = await E(() => [...document.querySelectorAll('.kca-rate .forge')].map((s) => s.getAttribute('aria-label')));
  ok('tally shows a rating per player', rate.length === 2, rate);
  await press(1, 'light', 300); await press(1, 'light', 300);
  ok('tally → Thieves’ Night camp', await until(async () => (await flow()) === 'stage' && (await E(() => window.__KCA.info().stage.id)) === 'bonus', 20000), await E(() => window.__KCA.info().stage));
  // Camp auto-clears → map (1→2) → stage 2.
  ok('camp → map interlude (1→2)', await until(async () => (await flow()) === 'map', 90000, 500), await flow());
  await walk(3200); await shotOv('09b_map2');
  const capK2 = await capK();
  ok('stage numbering 1-5: map leg after camp 1 reads "Stage 2" (not 3)', capK2 === 'Stage 2', capK2);
  await press(1, 'light', 200); await press(1, 'light', 200);
  ok('map → stage 2', await until(async () => (await flow()) === 'stage' && /2$/.test(String(await E(() => window.__KCA.info().stage.id))), 30000), await E(() => window.__KCA.info().stage.id));
  await until(() => E(() => /^2\|/.test(String((window.__KCA.game.ui.hud || {}).stageKey))), 20000, 500); // the plate follows the stage build
  const pl3 = await E(() => { const p = document.querySelector('.kca-stageplate'); return p && { on: p.classList.contains('on'), key: p.parentNode && window.__KCA && document.querySelector('.kca-stageplate .sn').textContent, num: (window.__KCA.game || {}).ui ? window.__KCA.game.ui.hud.stageKey : null }; });
  ok('HUD arcade stage plate = 2 (camps are not numbered: stage 2 after the camp)', pl3 && /^2\|/.test(String(pl3.num)), pl3);
  await api.advance(1500);
  // GAME OVER.
  await E(() => { const k = window.__KCA, s = k.game.session; for (const p of s.players) { p.lives = 1; p.continues = 0; } k.debug.kill('p1'); k.debug.kill('p2'); });
  ok('GAME OVER card', await until(() => E(() => { const c = document.querySelector('.kca-card.big'); return !!c && c.dataset.sub === 'GAME OVER'; }), 6000));
  await api.advance(600); await shotOv('10_gameover');
  ok('→ ranking (YOUR STRENGTH / CLASS)', await until(async () => (await flow()) === 'ranking', 12000), await flow());
  await until(() => E(() => { const c = document.querySelector('.kca-rank .cur'); return !!c && c.dataset.arrived === '1'; }), 6000, 200);
  await walk(2200);                                   // C2 r12: let the GAME OVER card / fade finish before the ledger is judged
  const veil = await E(() => [[800, 450], [300, 120], [1300, 800], [120, 450]].map(([x, y]) => { const e = document.elementFromPoint(x, y); const cs = e ? getComputedStyle(e.closest('.kca-rank') || e) : null; return { in: !!(e && e.closest('.kca-rank')), op: cs ? cs.opacity : null }; }));
  ok('ranking ledger is not veiled by another full-screen layer (GAME OVER dim / fade) when judged', veil.every((v) => v.in && Number(v.op) > 0.97), veil);
  await shotOv('11_ranking');
  // C2 r11: the sword cursor must point at the awarded class (r10 caught it beside row A while the highlight and caption said F).
  const aim = await E(() => {
    const c = document.querySelector('.kca-rank .cur'), r = document.querySelector('.kca-ladder tr.me'), v = document.querySelector('.kca-rank .verdict b');
    if (!c || !r) return null;
    const cb = c.getBoundingClientRect(), rb = r.getBoundingClientRect();
    return { dy: Math.round(Math.abs((cb.top + cb.bottom) / 2 - (rb.top + rb.bottom) / 2) * 10) / 10, rowH: Math.round(rb.height), cls: r.dataset.c, caption: v && v.textContent.trim() };
  });
  ok('ranking sword cursor points at the awarded class row (centre within 0.4 row) and the caption agrees', !!aim && aim.dy < aim.rowH * 0.4 && aim.caption === aim.cls, aim);
  const rk = await E(() => [...document.querySelectorAll('.kca-rank tbody tr')].slice(0, 6).map((r) => (r.querySelector('.sn') || {}).textContent + ' ' + r.firstElementChild.lastChild.textContent.trim()));
  ok('stage numbering 1-5: ranking ledger numbers stages 1,2 (camp unnumbered between)', rk.length >= 3 && /^1 Ashen/.test(rk[0]) && /^· Thieves/.test(rk[1]) && /^2 Shellback/.test(rk[2]), rk);
  const cls = await E(() => { const r = document.querySelector('.kca-ladder tr.me'); return r && r.dataset.c; });
  ok('ranking highlights a class', !!cls, cls);
  await press(1, 'light', 1000);                       // 2P run: one ledger page per player
  if ((await flow()) === 'ranking') { await walk(1000); await press(1, 'light', 400); }
  ok('ranking → high-score entry (or table)', await until(async () => (await flow()) === 'highscore', 12000), await flow());
  const entry = await has('.kca-entry');
  for (let k = 0; k < 2 && (await has('.kca-entry')); k++) {
    const who = await E(() => Number((document.querySelector('.kca-entry .who b') || {}).textContent?.[0] || 1));
    await press(who, 'down'); await press(who, 'down'); await press(who, 'light');
    await press(who, 'down'); await press(who, 'light'); if (!k) await shotOv('12_initials'); await press(who, 'start', 400);
  }
  await api.advance(600); await shotOv('13_scores');
  ok('high-score table shown', await has('.kca-hs table'), { entry });
  const scores = await E(() => { try { return JSON.parse(localStorage.getItem('kca.highscores.v1') || 'null'); } catch { return 'blocked'; } });
  R.scores = scores;
  const info = await E(() => window.__KCA.info());
  R.errors = info.errors;
  ok('no runtime errors', !info.errors.length, info.errors.slice(0, 3));
  fs.writeFileSync(path.join(api.outDir, 'ui-flow.json'), JSON.stringify(R, null, 1));
};
