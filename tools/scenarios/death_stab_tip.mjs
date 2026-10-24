// Death Stab BLADE-TIP proof (owner: heroes-anim, wave C2 r1). Board r5 saw the stab "connect 1-1.3 m short of the foe
// with the hero still ~1.76 m up": the old hit box reached 0.7 m below the feet, so the first active frame touched a
// standing foe while the blade was still raised. This probe measures, on the real input path (dash → jump → Light at
// the apex, stage mode), the WEAPON TIP (vfx.trails.tipOf = the same point the blade trail uses) against the foe's hurt
// box at the contact tick, and where the hero lands relative to the foe's body.
//   node tools/capture.mjs --url "/?mode=stage&stage=test&p1=<hero>" --scenario tools/scenarios/death_stab_tip.mjs --out <dir>
// Env: DS_DELAY Light press ticks after the Jump (22 = apex), DS_RUN run-up ticks (16), DS_FOE foe x (6.5),
//      DS_X hero start x override, DS_LEAD extra metres subtracted from the computed start (0), DS_TOL pass distance (0.3).
// Runs: 'stand' (foe standing) and 'down' (foe lying, OTG) — the Death Stab is the down-stab, both must pass.
// Writes death_stab_tip.json { hero, checks[], runs[] } and stills <run>_contact / <run>_landed.
import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  const DELAY = Number(process.env.DS_DELAY || 22), RUN = Number(process.env.DS_RUN || 16);
  const FOE = Number(process.env.DS_FOE || 6.5), TOL = Number(process.env.DS_TOL || 0.3), LEAD = Number(process.env.DS_LEAD || 0);
  const E = (fn, arg) => api.evalGame(fn, arg);
  const T = (n) => api.advance((1000 / 60) * n);
  const R = { checks: [], runs: [] };
  const ok = (name, pass, detail) => { R.checks.push({ name, pass: !!pass, detail }); api.log((pass ? 'PASS ' : 'FAIL ') + name + ' ' + JSON.stringify(detail).slice(0, 700)); };
  const r2 = (v) => (v == null ? null : +v.toFixed(2));
  const state = () => E(() => {
    const K = window.__KCA, g = K.game, h = g.world.query({ kind: 'hero' })[0];
    const e = window.__DS_E && !window.__DS_E.removed ? window.__DS_E : g.world.query({ team: 'enemies' })[0];
    const dsE = window.__DS_E ? { alive: window.__DS_E.alive, removed: window.__DS_E.removed, st: window.__DS_E.fsm.name, hp: Math.round(window.__DS_E.hp), x: +window.__DS_E.pos.x.toFixed(2) } : null;
    const lvl = g.levels ? { phase: g.levels.phase, script: g.levels.scriptEnabled } : null;
    const nE = g.world.query({ team: 'enemies', alive: false }).length;
    const tr = g.vfx && g.vfx.trails;
    const tip = (hand) => { const p = tr && tr.tipOf(h, hand); return p ? { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) } : null; };
    const hb = e ? e.hurtboxes()[0] : null;
    return { tick: g.tick, dsE, lvl, nE, st: h.fsm.name, move: h.attack ? h.attack.id : null, mf: h.attack ? h.attack.frame : null, hs: h.hitstop,
      x: +h.pos.x.toFixed(2), y: +h.pos.y.toFixed(2), vy: +h.vel.y.toFixed(2), vx: +h.vel.x.toFixed(2), gr: h.grounded,
      tipR: tip('R'), tipL: h.model && h.model.weaponL ? tip('L') : null,
      foe: e ? { st: e.fsm.name, alive: e.alive, x: +e.pos.x.toFixed(2), hp: Math.round(e.hp), box: hb && { minX: +hb.minX.toFixed(2), maxX: +hb.maxX.toFixed(2), minY: +hb.minY.toFixed(2), maxY: +hb.maxY.toFixed(2) } } : null };
  });
  // distance from a point to an AABB (x/y only: depth is the belt tolerance)
  const distXY = (p, b) => { if (!p || !b) return null; const dx = Math.max(b.minX - p.x, 0, p.x - b.maxX), dy = Math.max(b.minY - p.y, 0, p.y - b.maxY); return Math.hypot(dx, dy); };

  const run = async (label, down) => {
    const setup = await E(async ([foeX, down, lead]) => {
      const K = window.__KCA, g = K.game;
      if (g.levels) {
        g.levels.scriptEnabled = false;
        // the test stage flips to 'clear' when the hero runs off its end after a run; the clear sweep (45 ticks later)
        // would remove the next run's dummy mid-air — probe only, not a game change
        g.levels.stageClear = () => {}; g.levels.sweepEnemies = () => 0; if (g.levels.phase === 'clear') g.levels.phase = 'fight';
      }
      for (const a of g.world.query({ team: 'enemies' })) a.remove();
      const h = g.world.query({ kind: 'hero' })[0];
      h.endMove(); h.fsm.go('idle'); h.vel.set(0, 0, 0); h.runJump = false; h.hitstop = 0;
      const v = h.stats.run, ds = h.moves.death_stab;
      // start x so the plunge comes down on the foe: run-up (0.7 v for the double-tap ramp) + leap (0.95 v during the
      // rise: the jump + the hang frames) + the dive (plunge root speed over ~9 ticks of fall)
      const plunge = (ds.move || []).find((m) => m.vy !== undefined && m.vy < 0) || { speed: 0 };
      const dive = (plunge.speed || 0) * 9.5 / 60;
      // measured (c2r1): double-tap run-up + the leap to the Light press = 0.58 v for all three heroes; the hero should
      // land at foe.x + 0.3 (the lying body's chest), i.e. the leap apex sits ~0.6 m before the foe with the tip over it
      const sx = Number(window.__DS_X || NaN);
      h.pos.set(isFinite(sx) ? sx : foeX + 0.3 - (0.58 * v + dive + lead), 0, 0);
      h.prevPos.copy(h.pos); h.facing = 1;
      const s = await K.debug.spawn('dummy', foeX, 0, {});
      const e = g.world.byId.get(s.id); e.brain = null; e.pos.set(foeX, 0, 0); e.prevPos.copy(e.pos); e.facing = -1;
      window.__DS_E = e;
      if (down) { e.fsm.go('down'); e.downTimer = 900; e.otgTicks = 900; }
      if (g.cameraRig && g.cameraRig.snap) g.cameraRig.snap();
      K.input.releaseAll();
      return { startX: +h.pos.x.toFixed(2), dive: +dive.toFixed(2), foeState: e.fsm.name, foeBox: e.hurtboxes()[0] };
    }, [FOE, down, LEAD]);
    await T(10);
    const t0 = await E(() => window.__KCA.game.tick);
    await api.press(1, 'right', 50); await T(5); await api.hold(1, 'right', true);
    const rows = [];
    let jumpTick = null, lightTick = null, apex = 0, startMove = null, landed = null, shotC = false;
    let hitTick = null;
    for (let i = 0; i < RUN + DELAY + 90; i++) {
      await T(1);
      const s = await state(); rows.push(s);
      if (i === RUN) { await api.press(1, 'jump', 4); jumpTick = s.tick + 1; }
      if (jumpTick !== null && s.tick === jumpTick + DELAY) { await api.press(1, 'light', 4); lightTick = s.tick + 1; }
      if (s.y > apex) apex = s.y;
      if (s.move && !startMove && /death_stab|run_jump_attack|jump_attack/.test(s.move)) startMove = { move: s.move, tick: s.tick, y: s.y, vy: s.vy, x: s.x };
      if (hitTick === null && lightTick !== null) {
        const ev = await E((since) => window.__KCA.events(null, since).filter((e) => e.type === 'hit' && String(e.s ? e.s.attacker : (e.summary || {}).attacker).startsWith('hero')).map((e) => ({ t: e.tick, s: e.summary })), t0);
        if (ev.length) { hitTick = ev[0].t; rows[rows.length - 1].hitEv = ev[0]; }
      }
      if (hitTick !== null && !shotC) { shotC = true; await api.shot(`${label}_contact`); }
      if (s.gr && lightTick !== null && s.tick > lightTick + 12 && landed === null) { landed = { tick: s.tick, x: s.x, foe: s.foe }; await api.shot(`${label}_landed`); }
      if (landed && s.tick > landed.tick + 12) break;
    }
    await api.hold(1, 'right', false);
    const evs = await E((since) => window.__KCA.events(null, since).filter((e) => /attackStart|hit$|knockdown|jump|land/.test(e.type)).map((e) => ({ t: e.tick, type: e.type, s: e.summary })), t0);
    const hits = evs.filter((e) => e.type === 'hit' && String(e.s.attacker).startsWith('hero'));
    const hit = hits[0] || null;
    const cIdx = hit ? rows.findIndex((r) => r.tick >= hit.t) : -1;
    const cRow = cIdx >= 0 ? rows[cIdx] : null;
    // the hit flips the foe to the tall knockdown hurt box within the same tick: judge the tip against the box the
    // blade actually met = the previous tick's box
    const pre = cIdx > 0 ? rows[cIdx - 1] : cRow;
    const box = pre && pre.foe && pre.foe.box;
    const dR = cRow ? distXY(cRow.tipR, box) : null, dL = cRow && cRow.tipL ? distXY(cRow.tipL, box) : null;
    const dTip = dL == null ? dR : Math.min(dR ?? Infinity, dL);
    const spark = hit && hit.s && hit.s.point ? hit.s.point : null;
    const res = { label, down, setup, t0, jumpTick, lightTick, apex: r2(apex), startMove, hit: hit && { tick: hit.t, s: hit.s },
      contact: cRow && { tick: cRow.tick, heroX: cRow.x, heroY: cRow.y, mf: cRow.mf, tipR: cRow.tipR, tipL: cRow.tipL, foeBoxPre: box, foeStPre: pre && pre.foe && pre.foe.st, foeSt: cRow.foe && cRow.foe.st, distTipR: r2(dR), distTipL: r2(dL), distTip: r2(dTip), spark },
      landed, preHitFoeX: pre && pre.foe ? pre.foe.x : null, landDeltaToFoe: landed && pre && pre.foe ? +(landed.x - pre.foe.x).toFixed(2) : null,
      // on/over the foe = inside the body's box at landing (±0.15) or within 0.5 m of where the foe stood when stabbed
      landedOnFoe: landed ? ((landed.foe && landed.foe.box && landed.x >= landed.foe.box.minX - 0.15 && landed.x <= landed.foe.box.maxX + 0.15) || (pre && pre.foe && Math.abs(landed.x - pre.foe.x) <= 0.5)) : null,
      starts: evs.filter((e) => e.type === 'attackStart').map((e) => e.s.moveId), knockdownTicks: evs.filter((e) => e.type === 'knockdown').map((e) => e.t), rows };
    R.runs.push(res);
    return res;
  };
  const H = await E(() => { const h = window.__KCA.game.world.query({ kind: 'hero' })[0]; return { id: h.typeId, height: h.height, run: h.stats.run, ds: h.moves.death_stab && { startup: h.moves.death_stab.startup, move: h.moves.death_stab.move, hits: h.moves.death_stab.hits } }; });
  api.log(`hero ${H.id} height ${H.height} death_stab ${JSON.stringify(H.ds)}`);
  const RUNS = (process.env.DS_RUNS || 'stand,down').split(',');
  for (const [label, down] of [['stand', false], ['down', true]].filter((r) => RUNS.includes(r[0]))) {
    const a = await run(label, down);
    ok(`${H.id} ${label}: Light at the apex starts death_stab`, a.startMove && a.startMove.move === 'death_stab', { startMove: a.startMove, starts: a.starts });
    ok(`${H.id} ${label}: the plunge connects (death_stab hit) and knocks the foe down`, a.hit && /death_stab/.test(String(a.hit.s.moveId)) && a.knockdownTicks.length > 0, { hit: a.hit && a.hit.s, knockdownTicks: a.knockdownTicks });
    ok(`${H.id} ${label}: blade tip within ${TOL} m of the foe's body at the contact frame`, a.contact && a.contact.distTip !== null && a.contact.distTip <= TOL, a.contact);
    ok(`${H.id} ${label}: hero lands on/over the foe's body`, a.landedOnFoe === true, { landed: a.landed, preHitFoeX: a.preHitFoeX, landDeltaToFoe: a.landDeltaToFoe });
  }
  fs.writeFileSync(path.join(api.outDir, 'death_stab_tip.json'), JSON.stringify({ hero: H, checks: R.checks, runs: R.runs }, null, 1));
  api.log(`death_stab_tip: ${R.checks.filter((c) => c.pass).length}/${R.checks.length} checks pass`);
};
