// Full Chapter-1 playthrough QA harness (chapter1-integration agent).
//   node tools/capture.mjs --url "/?mode=title" --scenario tools/scenarios/playthrough.mjs --out progress/shots/chapter1-integration/rN/1p --timeout 180000 [--host http://127.0.0.1:5151]
//   env: PT_P2=1 (2-player co-op: P1 Brann + P2 Gorrim), PT_SKILL=0.85 (bot skill), PT_MAX_MIN=90 (sim-minute cap),
//        PT_PERF=1 (default on: realtime fps/drawCalls/triangles sample per stage), PT_SHOTS=1 (per-stage contact sheets),
//        PT_ARCADE=1 (strict credits: GAME OVER ends the run; default grants logged QA extra credits so the bot sees the ending).
// Drives the REAL flow: title → PRESS START → ARCADE → character select → map → stage 1 → tally → Thieves' Night →
// map → stage 2 … stage 5 → ending → ranking → high-score entry → title. The heroes are human (non-bot) session
// players whose virtual pads are driven by the hero bot (game.bots.attach) — the same input path as a keyboard.
// A dead player with CONTINUE? on screen presses START (continues used are counted). Nothing is skipped: no
// god mode, no kills, no teleports — EXCEPT a softlock breaker: if a stage makes no progress for SOFTLOCK_S sim
// seconds the harness logs a SOFTLOCK (with diagnostics) and then clears the wave so the run can continue; any
// softlock is a FAIL. Sim time is fast-forwarded with the manual clock (render only once per advance), which is the
// documented capture path; perf is sampled with the wall clock (realtime) for a few seconds in every stage.
// Writes playthrough.json (per-stage time, deaths, continues, bosses, errors, perf, softlocks) + <stage>/sheet.png.
import fs from 'node:fs';
import path from 'node:path';

const SOFTLOCK_S = 100;
const STAGE_CAP_S = 900;

export default async (api) => {
  const P2 = process.env.PT_P2 === '1';
  const SKILL = Number(process.env.PT_SKILL || 0.85);
  const MAX_S = Number(process.env.PT_MAX_MIN || 90) * 60;
  const PERF = process.env.PT_PERF !== '0';
  const SHOTS = process.env.PT_SHOTS !== '0';
  const ARCADE = process.env.PT_ARCADE === '1';
  const E = (fn, arg) => api.evalGame(fn, arg);
  const R = { players: P2 ? 2 : 1, skill: SKILL, stages: [], flow: [], errors: [], softlocks: [], result: 'incomplete', wallStart: Date.now() };
  const log = (m) => { api.log(m); R.flow.push(`[${simS.toFixed(0)}s] ${m}`); };
  let simS = 0;
  const adv = async (ms) => { await api.advance(ms); simS += ms / 1000; };
  const flow = () => E(() => window.__KCA.game.flow.state);
  const has = (sel) => E((s) => !!document.querySelector(s), sel);
  const press = async (p, a, wait = 250) => { await api.press(p, a, 60); await adv(wait); };
  const until = async (fn, ms = 20000, step = 250) => { for (let t = 0; t < ms; t += step) { if (await fn()) return true; await adv(step); } return false; };
  const writeOut = () => fs.writeFileSync(path.join(api.outDir, 'playthrough.json'), JSON.stringify(R, null, 1));

  // In-page event counters (the __KCA.events ring buffer is too short for 5-minute stages).
  const COUNT = ['bossIntro', 'bossPhase', 'ko', 'mount', 'potPickup', 'screenClear', 'stageClear', 'playerDown', 'chapterComplete', 'boss:defeat', 'boss:finaleDone', 'props:smash', 'level:thiefEscaped', 'ai:steal'];
  await E((names) => {
    const g = window.__KCA.game; window.__PT = { c: {}, boss: [] };
    for (const n of names) g.bus.on(n, (e) => {
      const c = window.__PT.c; c[n] = (c[n] || 0) + 1;
      if (n === 'ko' && e && (e.ringout || e.ringOut || (e.ev && e.ev.ringout))) c.ringout = (c.ringout || 0) + 1;
      if (n === 'bossIntro') { const b = e && e.boss; window.__PT.boss.push((b && ((b.def && b.def.name) || b.name || b.typeId)) || '?'); }
    });
  }, COUNT);
  const takeCounts = () => E(() => { const r = { ...window.__PT.c, bossNames: window.__PT.boss.slice() }; window.__PT.c = {}; window.__PT.boss = []; return r; });

  // ---------------------------------------------------------------- title → select → map
  await adv(800);
  if ((await flow()) !== 'title') log('WARN not on title: ' + (await flow()));
  await press(1, 'start', 600);
  await press(1, 'light', 400);
  if (!(await until(async () => (await flow()) === 'select' && (await has('.kca-screen-select .kca-hcard'))))) throw new Error('never reached select');
  await until(() => E(() => !!window.__KCA.game.renderer.scene.getObjectByName('selectSet')), 20000);
  await adv(1200);
  if (P2) { await press(2, 'start', 400); }
  await press(1, 'light', 400);
  if (P2) await press(2, 'light', 400);
  if (!(await until(async () => (await flow()) === 'map', 10000))) throw new Error('select never confirmed → map (' + (await flow()) + ')');
  log('select → map; picks ' + JSON.stringify(await E(() => window.__KCA.game.flow.picks.map((p) => p.heroId))));

  // ---------------------------------------------------------------- main loop
  let cur = null;           // current stage record
  let lastState = '';
  let prog = null, progAt = 0;
  let shotN = 0, nextShot = 0;
  let bonusN = 0;           // camps share stage id 'bonus' → records/sheets are bonus1..4 (never overwritten)
  const sessionSnap = () => E(() => window.__KCA.game.session.players.filter((p) => p.active).map((p) => ({ i: p.index, lives: p.lives, continues: p.continues, deaths: p.deaths, score: p.score, out: p.out, ct: p.continueTimer })));
  const finishStage = async () => {
    if (!cur) return;
    const s = await sessionSnap();
    cur.simSeconds = +(simS - cur.simStart).toFixed(1);
    cur.wallSeconds = +((Date.now() - cur.wallStart) / 1000).toFixed(1);
    cur.deaths = s.map((p, k) => p.deaths - (cur.s0[k] ? cur.s0[k].deaths : 0));
    cur.score = s.map((p) => p.score);
    cur.events = await takeCounts();
    const errs = await E(() => window.__KCA.info().errors || []);
    cur.errors = errs.slice(R.errors.length);
    R.errors = errs.slice();
    delete cur.sid; delete cur.s0; delete cur.lastDeaths; delete cur.simStart; delete cur.wallStart;
    if (SHOTS && cur.shots.length) {
      try {
        const sharp = (await import('sharp')).default;
        const kept = cur.shots.length <= 12 ? cur.shots : Array.from({ length: 12 }, (_, i) => cur.shots[Math.round(i * (cur.shots.length - 1) / 11)]);
        const tileW = 480, tileH = 270, cols = 4, rows = Math.ceil(kept.length / cols);
        const comps = await Promise.all(kept.map(async (f, i) => ({ input: await sharp(f).resize(tileW, tileH).png().toBuffer(), left: (i % cols) * (tileW + 4), top: Math.floor(i / cols) * (tileH + 4) })));
        const out = path.join(api.outDir, cur.id, 'sheet.png');
        await sharp({ create: { width: cols * (tileW + 4) - 4, height: rows * (tileH + 4) - 4, channels: 3, background: '#111' } }).composite(comps).png().toFile(out);
        cur.sheet = path.relative(process.cwd(), out).replace(/\\/g, '/');
        for (const f of cur.shots) if (!kept.includes(f)) fs.rmSync(f, { force: true });
      } catch (e) { cur.sheetError = String(e.message || e); }
    }
    delete cur.shots;
    log(`stage ${cur.id} done: ${cur.simSeconds}s sim, deaths ${cur.deaths}, continues ${cur.continuesUsed}, events ${JSON.stringify(cur.events)}, perf ${JSON.stringify(cur.perf)}`);
    R.stages.push(cur); cur = null; writeOut();
  };

  while (simS < MAX_S) {
    const st = await flow();
    if (st !== lastState) { log('flow → ' + st); lastState = st; }
    if (st === 'stage') {
      const sid = await E(() => { const i = window.__KCA.info(); return i.stage && i.stage.id; });
      if (!cur || cur.sid !== sid) {
        await finishStage();
        // attach the hero bot to every human hero (their pads, not their session flag)
        const n = await E((skill) => { const g = window.__KCA.game; let k = 0; for (const h of g.world.query({ kind: 'hero', alive: false })) { if (!g.bots.bots.some((b) => b.hero === h)) { g.bots.attach(h, { skill }); k++; } } return k; }, SKILL);
        await takeCounts(); // drop anything counted between stages (tally/map)
        const s0 = await sessionSnap();
        cur = { id: sid === 'bonus' ? `bonus${++bonusN}` : sid, sid, tick0: await E(() => window.__KCA.game.tick), simStart: simS, wallStart: Date.now(), s0, continuesUsed: 0, softlocks: 0, lastDeaths: {}, perf: null, shots: [], maxScreen: 0 };
        fs.mkdirSync(path.join(api.outDir, cur.id), { recursive: true });
        shotN = 0; nextShot = simS + 3; prog = null; progAt = simS;
        // stage numbering check: HUD plate + intro card title (camps are unnumbered)
        await adv(500);
        cur.plate = await E(() => { const n = document.querySelector('.kca-stageplate .num'); const c = document.querySelector('.kca-card'); return { hud: n ? n.textContent.trim() : null, card: c ? c.dataset.title || null : null }; });
        log(`stage ${cur.id} start (bots attached ${n}) plate ${JSON.stringify(cur.plate)}`);
      }
      // (only once the stage script runs: the stage id is known while its env is still building, before heroes exist)
      const nHeroes = await E(() => { const g = window.__KCA.game; return /fight|go/.test(g.levels.phase) ? g.world.query({ kind: 'hero', alive: false }).length : -1; });
      if (nHeroes >= 0 && nHeroes !== R.players && !cur.heroCountBad) { cur.heroCountBad = nHeroes; log(`BUG hero count ${nHeroes} != players ${R.players}`); }
      // re-attach after drop-in / respawn safety
      await E((skill) => { const g = window.__KCA.game; for (const h of g.world.query({ kind: 'hero', alive: false })) if (!g.bots.bots.some((b) => b.hero === h)) g.bots.attach(h, { skill }); }, SKILL);
      // CONTINUE? → press START like a player would
      const snap = await sessionSnap();
      for (const p of snap) {
        const prev = cur.lastDeaths[p.i] ?? p.deaths;
        if (p.deaths > prev) {
          const ctx = await E(() => { const g = window.__KCA.game, i = window.__KCA.info(); return { st: i.stage && [i.stage.screen, i.stage.wave, i.stage.phase], foes: g.world.query({ team: 'enemies' }).map((a) => (a.kind === 'boss' ? 'BOSS:' : '') + (a.typeId || a.type) + (a.tier ? '/' + a.tier : '')).slice(0, 8) }; });
          (cur.deathLog = cur.deathLog || []).push(ctx);
        }
        cur.lastDeaths[p.i] = p.deaths;
      }
      // QA credits (PT_ARCADE=1 disables): a player with 0 continues left gets one standby credit so the run can reach
      // the ending. It is counted in extraCredits only once it is CONSUMED (continues back to 0 after the grant = a
      // strict arcade run would have been GAME OVER); an unused standby credit is not counted.
      if (!ARCADE) for (const p of snap) if (p.continues === 0 && !p.out) {
        R.standby = R.standby || {};
        if (R.standby[p.i]) { cur.extraCredits = (cur.extraCredits || 0) + 1; R.extraCredits = (R.extraCredits || 0) + 1; log(`P${p.i + 1} QA extra credit #${R.extraCredits} consumed (strict arcade = GAME OVER here)`); }
        R.standby[p.i] = true;
        await E((i) => { window.__KCA.game.session.players[i].continues = 1; }, p.i); p.continues = 1;
      }
      for (const p of snap) if (p.ct >= 0 && p.continues > 0 && p.ct < 8) { await api.press(p.i + 1, 'start', 60); cur.continuesUsed++; log(`P${p.i + 1} continue (${p.continues - 1} left)`); }
      // progress / softlock watch
      const pi = await E(() => { const i = window.__KCA.info(); const g = window.__KCA.game; return { s: i.stage, en: i.enemies, hx: Math.round(Math.max(...i.heroes.map((h) => h.x)) * 2) / 2, hp: g.world.query({ team: 'enemies' }).reduce((a, e) => a + (e.hp || 0), 0) }; });
      const key = JSON.stringify([pi.s && pi.s.screen, pi.s && pi.s.wave, pi.s && pi.s.phase, pi.en, pi.hx, Math.round(pi.hp)]);
      if (pi.s && pi.s.screen > cur.maxScreen) cur.maxScreen = pi.s.screen;
      if (key !== prog) { prog = key; progAt = simS; }
      else if (simS - progAt > SOFTLOCK_S || simS - (cur.simStart ?? simS) > STAGE_CAP_S) {
        const diag = await E(() => { const g = window.__KCA.game, L = g.levels; return { stage: window.__KCA.info().stage, pending: L.pendingSpawns, waveActors: [...L.waveActors].map((a) => ({ id: a.id, type: a.type || a.kind, alive: a.alive, removed: a.removed, x: a.pos && +a.pos.x.toFixed(1), z: a.pos && +a.pos.z.toFixed(1), st: a.fsm && a.fsm.current, hp: a.hp })), enemies: g.world.query({ team: 'enemies' }).map((a) => ({ id: a.id, type: a.type, x: +a.pos.x.toFixed(1), z: +a.pos.z.toFixed(1), st: a.fsm && a.fsm.current, hurtable: a.hurtable, hp: a.hp })), heroes: window.__KCA.info().heroes, cam: g.cameraRig && { lock: g.cameraRig.lock, fx: +g.cameraRig.focus.x.toFixed(1) } }; });
        const sl = { stage: sid, at: +(simS - (cur.simStart ?? 0)).toFixed(0), diag };
        R.softlocks.push(sl); cur.softlocks++;
        log('SOFTLOCK ' + JSON.stringify(sl).slice(0, 900));
        await E(() => { const g = window.__KCA.game, L = g.levels; window.__KCA.debug.kill('enemies'); for (const a of L.waveActors) { if (a.alive && a.kill) try { a.kill(); } catch (e) {} a.alive = false; } if (L.phase === 'go') { const n = L.screens[L.screenIndex + 1]; if (n) L.enterScreen(L.screenIndex + 1); } });
        progAt = simS; prog = null;
      }
      // perf sample (realtime) once per stage, ~25 s in
      if (PERF && !cur.perf && simS - (cur.simStart ?? simS) > 25 && sid !== 'bonus') {
        await E(() => window.__KCA.setManualClock(false));
        await api.page.waitForTimeout(3500);
        const samples = [];
        for (let k = 0; k < 4; k++) { await api.page.waitForTimeout(500); samples.push(await E(() => { const i = window.__KCA.info(); return { fps: i.fps, dc: i.drawCalls, tri: i.triangles, en: i.enemies }; })); }
        await E(() => window.__KCA.setManualClock(true));
        cur.perf = { fps: Math.round(Math.min(...samples.map((s) => s.fps))), fpsAvg: Math.round(samples.reduce((a, s) => a + s.fps, 0) / samples.length), drawCalls: Math.max(...samples.map((s) => s.dc)), triangles: Math.max(...samples.map((s) => s.tri)), enemies: samples[samples.length - 1].en };
      }
      if (SHOTS && simS >= nextShot) { const f = path.join(api.outDir, cur.id, `f_${String(shotN++).padStart(3, '0')}.png`); await api.page.screenshot({ path: f }); cur.shots.push(f); nextShot = simS + (sid === 'bonus' ? 4 : 12); }
      await adv(1000);
      continue;
    }
    if (cur && st !== 'stage' && st !== 'boot') {
      // QA r1: nothing of the enemy team may outlive a stage clear (boss lingering in world.query)
      const linger = await E(() => window.__KCA.game.world.query({ team: 'enemies' }).map((a) => `${a.kind}:${a.typeId || a.type}`));
      if (linger.length) { cur.lingering = linger; log('BUG enemies lingering after clear: ' + linger.join(',')); }
      await finishStage();
    }
    if (st === 'map' || st === 'tally') { await adv(1500); await press(1, 'light', 400); continue; }
    if (st === 'ending') { await adv(1000); continue; }
    if (st === 'gameover') { if (R.result === 'incomplete') { R.result = 'gameover'; log('GAME OVER'); } await adv(1000); continue; }
    if (st === 'ranking') { if (R.result === 'incomplete') R.result = 'complete'; await adv(2500); await press(1, 'light', 800); continue; }
    if (st === 'highscore') {
      if (await has('.kca-entry')) {
        const who = await E(() => Number((document.querySelector('.kca-entry .who b') || {}).textContent?.[0] || 1));
        await press(who, 'light'); await press(who, 'light'); await press(who, 'light'); await press(who, 'start', 400);
      } else { await adv(1000); await press(1, 'light', 400); }
      R.highscore = true; continue;
    }
    if (st === 'title' && R.stages.length) { log('back on title'); break; }
    await adv(1000);
  }
  if (simS >= MAX_S) log('SIM CAP reached');
  R.simSeconds = +simS.toFixed(0);
  R.wallSeconds = Math.round((Date.now() - R.wallStart) / 1000);
  R.run = await E(() => { const r = window.__KCA.game.stats && window.__KCA.game.stats.run; return r ? JSON.parse(JSON.stringify(r, (k, v) => (v && typeof v === 'object' && v.isObject3D) ? undefined : v)) : null; }).catch(() => null);
  R.finalErrors = await E(() => window.__KCA.info().errors || []);
  writeOut();
  api.log('RESULT ' + JSON.stringify({ result: R.result, stages: R.stages.map((s) => [s.id, s.simSeconds, s.deaths, s.continuesUsed, s.softlocks, s.perf && s.perf.fps, s.perf && s.perf.drawCalls]), softlocks: R.softlocks.length, sim: R.simSeconds, wall: R.wallSeconds }));
};
