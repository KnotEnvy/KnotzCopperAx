// Flow regression scenario (foundation-engine): HUD DOM freshness after advance(), CONTINUE timing, GAME OVER card.
//   node tools/capture.mjs --url "/?mode=stage&stage=1&p1=brann&placeholder=1" --scenario tools/scenarios/flow.mjs --out progress/shots/foundation-engine/r3/flow
// Checks: HUD text/classes are current when advance() returns · CONTINUE? starts ≤ 60 ticks after the killing blow ·
// GAME OVER = big gold card over a veil, GO ▶ hidden. Writes flow.json.
import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  const R = { checks: [] };
  const ok = (name, pass, detail) => { R.checks.push({ name, pass: !!pass, detail }); api.log((pass ? 'PASS ' : 'FAIL ') + name + ' ' + JSON.stringify(detail).slice(0, 600)); };
  const E = (fn, arg) => api.evalGame(fn, arg);
  const T = (n) => api.advance((1000 / 60) * n);
  const tick = () => E(() => window.__KCA.game.tick);
  const evs = (type, since) => E(([t, s]) => window.__KCA.events(t, s), [type, since]);
  await api.advance(1500);

  // 1. DOM freshness: a sim change is in the HUD DOM when the next advance() returns.
  await E(() => { const k = window.__KCA; k.debug.god(true); k.game.session.addScore(0, 777, 'qa'); });
  await T(1);
  const score1 = await E(() => (document.querySelector('.kca-pp.p1 .kca-score') || {}).textContent);
  const tierBefore = await E(() => document.querySelectorAll('.kca-pp.p1 .kca-pot.on, .kca-pp.p1 .kca-pot.full').length);
  await E(() => window.__KCA.debug.pots(1, 2)); await T(1);
  const tierAfter = await E(() => document.querySelectorAll('.kca-pp.p1 .kca-pot.on, .kca-pp.p1 .kca-pot.full').length);
  ok('HUD DOM is current when advance() returns (no extra advance needed)', /777/.test(score1 || '') && tierAfter === tierBefore + 2, { score1, potsLit: [tierBefore, tierAfter] });

  // 2. CONTINUE? countdown begins promptly after the killing blow.
  await E(() => { const k = window.__KCA, s = k.game.session; s.autoContinue = false; k.debug.god(false); s.players[0].lives = 1; s.players[0].continues = 3; });
  let t0 = await tick();
  await E(() => window.__KCA.debug.kill('p1'));
  let startAt = -1, hudOnAt = -1;
  for (let i = 0; i < 180 && (startAt < 0 || hudOnAt < 0); i++) {
    await T(1);
    if (startAt < 0 && (await evs('continueStart', t0)).length) startAt = i + 1;
    if (hudOnAt < 0 && (await E(() => { const el = document.querySelector('.kca-pp.p1 .kca-continue'); return !!(el && el.classList.contains('on')); }))) hudOnAt = i + 1;
  }
  await T(20); await api.shot('continue');
  ok('CONTINUE? countdown starts ≤ 1 s (60 ticks) after the killing blow', startAt > 0 && startAt <= 60 && hudOnAt > 0 && hudOnAt <= 61, { continueStartTicks: startAt, hudOnTicks: hudOnAt });
  await api.press(1, 'start', 50); await api.advance(2500);

  // 3. GAME OVER: reach GO ▶ first, then lose the last life with no continues.
  let phase = null;
  for (let i = 0; i < 14 && phase !== 'go'; i++) { await E(() => window.__KCA.debug.kill('enemies')); await api.advance(1500); phase = await E(() => window.__KCA.info().stage.phase); }
  const goBefore = await E(() => { const g = document.querySelector('.kca-go'); return !!(g && g.classList.contains('on')); });
  await E(() => { const k = window.__KCA, s = k.game.session; k.debug.god(false); s.players[0].lives = 1; s.players[0].continues = 0; });
  t0 = await tick();
  await E(() => window.__KCA.debug.kill('p1'));
  await api.advance(2600);
  const go = await evs('gameOver', t0);
  const dom = await E(() => {
    const c = document.querySelector('.kca-card.big'), g = document.querySelector('.kca-go'), v = document.querySelector('.kca-veil');
    const sub = c && c.querySelector('.kca-card-sub');
    const cs = sub && getComputedStyle(sub);
    return { card: !!c, text: sub && sub.textContent, fontPx: cs && parseFloat(cs.fontSize), bg: cs && cs.backgroundImage.slice(0, 40), goOn: !!(g && g.classList.contains('on')), veil: !!(v && v.classList.contains('on')), flow: window.__KCA.info().flow };
  });
  await api.shot('gameover');
  ok('GAME OVER: big gold lettering over a veil, GO ▶ hidden', go.length >= 1 && dom.card && dom.text === 'GAME OVER' && dom.fontPx >= 100 && /gradient/.test(dom.bg || '') && !dom.goOn && dom.veil, { phaseBefore: phase, goBefore, gameOver: go.length, dom });

  const info = await E(() => window.__KCA.info());
  R.errors = info.errors;
  fs.writeFileSync(path.join(api.outDir, 'flow.json'), JSON.stringify(R, null, 1));
  api.log(`SUMMARY ${R.checks.filter((c) => c.pass).length}/${R.checks.length} passed · errors ${JSON.stringify(info.errors || []).slice(0, 300)}`);
};
