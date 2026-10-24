#!/usr/bin/env node
// UI overlap audit (ui-flow r5): drives every UI screen/state in a real GPU browser, collects the box of every visible text
// item (tools/lib/uioverlap.mjs) and FAILS on any text-on-text intersection or text leaving the viewport. One PNG per state.
//   node tools/ui-overlap.mjs [--sizes 1280x720,1600x900,1920x1080] [--pages select,title,hud] [--out dir] [--no-shots] [--selftest]
// Three page loads per size (the showcase boots a whole stage, so states are switched in-page through game.ui):
//   select : 1P → 2P joins → P1 READY → 2P hits the duplicate pick (TAKEN toast) → both READY      (3D set built)
//   title  : title · menu · high-score table · initials entry · options · map to1..5 + 1→2 leg · tally · ranking · perfect
//   hud    : 2P HUD · CONTINUE? slot · stage card · boss card · GO · GAME OVER · demo banner · pause · tally over HUD
// --selftest injects a deliberately overlapping label and requires the detector to flag it (proves the check can fail).
// Exit 0 = every state passes. Writes <out>/overlap.json. Uses the shared capture slot lock; never starts a server.
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, gpuRenderer, isSoftwareRenderer } from './lib/browser.mjs';
import { KCA_HOST } from './lib/platform.mjs';
import { acquire } from './lib/locks.mjs';
import { checkPage, settleCss } from './lib/uioverlap.mjs';

const argv = process.argv.slice(2);
const opt = {};
for (let i = 0; i < argv.length; i++) { if (!argv[i].startsWith('--')) continue; const k = argv[i].slice(2), n = argv[i + 1]; if (n === undefined || n.startsWith('--')) opt[k] = true; else { opt[k] = n; i++; } }
const host = (opt.host || KCA_HOST).replace(/\/$/, '');
const sizes = String(opt.sizes || '1280x720,1600x900,1920x1080').split(',').map((s) => s.split('x').map(Number));
const onlyStates = opt.only ? String(opt.only).split(',') : null;
const pagesWanted = String(opt.pages || 'select,title,hud').split(',');
const outDir = path.resolve(opt.out || 'progress/shots/ui-flow/r5/overlap');
fs.mkdirSync(outDir, { recursive: true });
const SC = (id, q = '') => `/?mode=showcase&what=ui&id=${id}${q}&capture=1`;

const release = await acquire('capture', { slots: Number(process.env.KCA_CAPTURE_SLOTS || 6), info: { what: 'ui-overlap audit' } });
const browser = await launchBrowser({ tool: 'ui-overlap', args: ['--autoplay-policy=no-user-gesture-required'] });
const results = [];
let gpu = null;
const pageErrors = [];
const STUB = 'const hot=()=>({data:{},accept(){},acceptExports(){},dispose(){},prune(){},decline(){},invalidate(){},on(){},off(){},send(){}});export const createHotContext=hot;export function updateStyle(){}export function removeStyle(){}export function injectQuery(u){return u}export class ErrorOverlay extends HTMLElement{}export default {};';

// ---- per-page state scripts: each state = { name, run(h), need?(h) }
const ui = (fn) => (h) => h.page.evaluate(fn);   // fn runs in the page with window.__KCA.game
const PAGES = {
  select: {
    url: SC('select', '&notimer=1'), warm: 1500,
    states: [
      { name: 'select_1p' },
      { name: 'select_2p_joined', run: async (h) => { await h.press(2, 'start', 400); }, need: (h) => h.page.evaluate(() => document.querySelectorAll('.kca-flag.f2.on').length === 1) },
      { name: 'select_p1_ready', run: async (h) => { await h.press(1, 'light', 500); }, need: (h) => h.page.evaluate(() => document.querySelectorAll('.kca-stamp.on').length === 1) },
      { name: 'select_dup_toast', run: async (h) => { await h.press(2, 'left', 200); await h.press(2, 'left', 200); await h.press(2, 'light', 250); },
        need: (h) => h.page.evaluate(() => !!document.querySelector('.kca-toast') && document.querySelectorAll('.kca-stamp.on').length === 1 && document.querySelector('.kca-hcard.locked')) },
      { name: 'select_both_ready', run: async (h) => { await h.adv(1800); await h.press(2, 'right', 200); await h.press(2, 'light', 400); }, need: (h) => h.page.evaluate(() => document.querySelectorAll('.kca-stamp.on').length === 2) },
    ],
  },
  title: {
    url: SC('title'), warm: 1500,
    states: [
      { name: 'title_press' },
      { name: 'title_menu', run: ui(async () => { const u = window.__KCA.game.ui; u.hideAll(); await u.show('title', { onSelect() {}, skipPress: true }); }), wait: 900 },
      { name: 'highscore_table', run: ui(async () => { const u = window.__KCA.game.ui; u.hideAll(); await u.show('highscore', { entries: [], hold: 1e9, onDone() {} }); }), wait: 1200 },
      { name: 'highscore_entry', run: ui(async () => { const u = window.__KCA.game.ui; u.hideAll(); await u.show('highscore', { entries: [{ player: 0, score: 187650, hero: 'gorrim', stage: '4' }], anyPlayer: true, hold: 1e9, onDone() {} }); }), wait: 1200 },
      { name: 'options', run: ui(async () => { const u = window.__KCA.game.ui; u.hideAll(); await u.show('options', { onClose() {} }); }), wait: 1000 },
      ...[1, 2, 3, 4, 5].map((to) => ({ name: `map_to${to}`, wait: 800, run: (h) => h.page.evaluate(async (to) => { const u = window.__KCA.game.ui; u.hideAll(); await u.show('map', { t0: 6, to, onDone() {} }); }, to) })),
      { name: 'map_leg_1_to_2_start', wait: 600, run: ui(async () => { const u = window.__KCA.game.ui; u.hideAll(); await u.show('map', { t0: 0, from: 1, to: 2, onDone() {} }); }) },
      { name: 'map_leg_1_to_2_mid', wait: 2600 },
      ...[['tally', false], ['ranking', false], ['ranking_perfect', true]].map(([name, perfect]) => ({ name, wait: name === 'tally' ? 2800 : 2400, run: (h) => h.page.evaluate(async ([name, perfect]) => {
        const { sampleRun } = await import('/src/showcase/kinds/ui.js');
        const u = window.__KCA.game.ui; u.hideAll();
        if (name === 'tally') await u.show('tally', { rec: sampleRun(1).stages[0], players: [0, 1], t0: 9, onDone() {} });
        else await u.show('ranking', { run: sampleRun(5, perfect), players: [0], heroes: { 0: 'brann' }, t0: 4, onDone() {} });
      }, [name, perfect]) })),
    ],
  },
  hud: {
    url: SC('hud'), warm: 2200,
    states: [
      { name: 'hud_2p' },
      { name: 'hud_combo_2p', wait: 1000, run: ui(() => { const b = window.__KCA.game.bus; b.emit('combo', { player: 0, count: 14, rank: 'B' }); b.emit('combo', { player: 1, count: 52, rank: 'KNOT' }); }),
        need: (h) => h.page.evaluate(() => document.querySelectorAll('.kca-combo.on').length === 2) },
      { name: 'hud_continue', run: ui(() => { window.__KCA.game.session.players[1].continueTimer = 6.5; }), wait: 600 },
      { name: 'stage_card', wait: 1400, run: ui(() => { const u = window.__KCA.game.ui; window.__KCA.game.session.players[1].continueTimer = 0; u.card('STAGE 2', 'Shellback Crossing', 999); }) },
      { name: 'boss_card', wait: 1600, run: ui(() => { const u = window.__KCA.game.ui; u.clearStage(); u.bossCard('THE BRUTE BROTHERS', 'Butchers of the Ashen Wilds', 999); }) },
      { name: 'go_arrow', wait: 900, run: ui(() => { const u = window.__KCA.game.ui; u.clearStage(); u.go(true); }) },
      { name: 'gameover', wait: 2600, run: ui(() => { const u = window.__KCA.game.ui; u.clearStage(); u.card('YOUR LEGEND ENDS HERE', 'GAME OVER', 999, { big: true }); }) },
      { name: 'demo_banner', wait: 900, run: ui(() => { const u = window.__KCA.game.ui; u.clearStage(); u.demo(true); }) },
      { name: 'pause', wait: 900, run: ui(async () => { const u = window.__KCA.game.ui; u.clearStage(); await u.show('pause', {}); }) },
      { name: 'tally_over_hud', wait: 2800, run: ui(async () => { const u = window.__KCA.game.ui; u.hideAll(); const { sampleRun } = await import('/src/showcase/kinds/ui.js'); await u.show('tally', { rec: sampleRun(1).stages[0], players: [0, 1], t0: 9, onDone() {} }); }) },
    ],
  },
};

try {
  for (const [W, H] of sizes) {
    const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    await context.route(/\/@vite\/client(\?.*)?$/, (route) => route.fulfill({ contentType: 'application/javascript', body: STUB }));
    for (const pid of pagesWanted) {
      const P = PAGES[pid]; if (!P) continue;
      const page = await context.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
      page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
      const adv = async (ms) => { for (let t = 0; t < ms; t += 100) await page.evaluate((m) => window.__KCA.advance(m), Math.min(100, ms - t)); };
      const h = { page, adv, press: async (p, a, wait = 250) => { await page.evaluate(([p, a]) => window.__KCA.input.press(p, a, 60), [p, a]); await adv(wait); } };
      try {
        if (!gpu) { gpu = await gpuRenderer(page); if (isSoftwareRenderer(gpu)) pageErrors.push('SOFTWARE RENDERER ' + gpu); }
        await page.goto(host + P.url, { waitUntil: 'domcontentloaded', timeout: 180000 });
        await page.waitForFunction(() => window.__KCA && window.__KCA.ready, null, { timeout: 180000 });
        await page.evaluate(() => window.__KCA.ready);
        await page.evaluate(() => window.__KCA.setManualClock && window.__KCA.setManualClock(true));
        await adv(P.warm);
      } catch (e) { const rec = { size: `${W}x${H}`, name: pid + '_LOAD', pass: false, count: 0, problems: ['LOAD FAILED ' + String(e.message).split('\n')[0]], errors: errs }; results.push(rec); console.log('FAIL', rec.size, rec.name, rec.problems[0]); await page.close(); continue; }
      for (const st of P.states) {
        if (onlyStates && !onlyStates.some((o) => st.name.startsWith(o))) { if (st.run && !onlyStates.length) continue; }
        const rec = { size: `${W}x${H}`, name: st.name, pass: false, count: 0, problems: [], errors: [] };
        try {
          if (st.run) await st.run(h);
          await adv(st.wait || 300);
          await settleCss(page); // CSS animations/transitions run on the real clock: wait for every finite one to finish
          if (st.need && !(await st.need(h))) rec.problems.push('PRECONDITION: state not reached (the check would be vacuous)');
          const r = await checkPage(page);
          rec.count = r.count; rec.problems.push(...r.problems);
          if (r.count < 2) rec.problems.push('no text collected (screen did not render?)');
          if (!opt['no-shots']) await page.screenshot({ path: path.join(outDir, `${W}x${H}_${st.name}.png`) });
        } catch (e) { rec.problems.push('ERROR ' + String(e.message).split('\n')[0]); }
        rec.errors = errs.splice(0);
        rec.pass = rec.problems.length === 0 && !rec.errors.length;
        results.push(rec);
        console.log(`${rec.pass ? 'PASS' : 'FAIL'} ${rec.size} ${rec.name} (${rec.count} text items)${rec.problems.length ? '\n   ' + rec.problems.join('\n   ') : ''}${rec.errors.length ? '\n   page errors: ' + rec.errors.slice(0, 2).join(' | ') : ''}`);
      }
      if (opt.selftest && pid === 'title') {
        // The detector must flag a deliberately overlapping label (proves a regression can't pass silently).
        await page.evaluate(() => window.__KCA.game.ui.hideAll());
        await page.evaluate(async () => { await window.__KCA.game.ui.show('title', { onSelect() {}, skipPress: true }); const d = document.createElement('div'); d.textContent = 'SELFTEST DEBUG LABEL'; d.style.cssText = 'position:fixed;left:30px;bottom:18px;font:13px serif;letter-spacing:.2em;color:#fff;z-index:99'; document.body.appendChild(d); });
        await adv(900);
        const r = await checkPage(page);
        const caught = r.problems.some((p) => p.includes('SELFTEST'));
        console.log(`${caught ? 'PASS' : 'FAIL'} ${W}x${H} selftest: detector ${caught ? 'flags' : 'MISSED'} an injected overlapping label`);
        results.push({ size: `${W}x${H}`, name: 'detector_selftest', pass: caught, count: r.count, problems: caught ? [] : ['detector did not flag the injected overlap'], errors: [] });
      }
      await page.close();
    }
    await context.close();
  }
} finally {
  try { await browser.close(); } catch {}
  release();
}
const failed = results.filter((r) => !r.pass);
fs.writeFileSync(path.join(outDir, 'overlap.json'), JSON.stringify({ gpu, pageErrors, total: results.length, failed: failed.length, results }, null, 1));
console.log(`\nui-overlap: ${results.length - failed.length}/${results.length} PASS · gpu ${gpu} · ${path.join(outDir, 'overlap.json')}`);
process.exit(failed.length || pageErrors.length ? 1 : 0);
