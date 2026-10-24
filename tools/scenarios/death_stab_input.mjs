// Death Stab gameplay proof (owner: heroes-anim, wave C1 r5). Real input path (virtual device = same code path as the
// keyboard/gamepad): double-tap → run → Jump → Light near the apex must start 'death_stab' (Hero.chooseAirMove:
// runJump && |vel.y| < 3.2), leave the ground, plunge onto a foe and knock it down. A control run presses Light early
// in the jump (|vel.y| >= 3.2) and must give 'run_jump_attack' instead (the two aerials are distinct by design).
//   node tools/capture.mjs --url "/?mode=stage&stage=test&p1=<hero>" --scenario tools/scenarios/death_stab_input.mjs --out <dir>
// Env: DS_DELAY ticks between the Jump press and the Light press (default 22 = the apex), DS_RUN run-up ticks (16),
//      DS_X hero start x (default: computed so the plunge lands on the foe), DS_FOE foe x (default 6.5).
// Writes death_stab.json { checks[], log[] } and a few stills (apex / plunge / contact).
import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  const DELAY = Number(process.env.DS_DELAY || 22), RUN = Number(process.env.DS_RUN || 16);
  const FOE = Number(process.env.DS_FOE || 6.5);
  const E = (fn, arg) => api.evalGame(fn, arg);
  const T = (n) => api.advance((1000 / 60) * n);
  const R = { checks: [], log: [] };
  const ok = (name, pass, detail) => { R.checks.push({ name, pass: !!pass, detail }); api.log((pass ? 'PASS ' : 'FAIL ') + name + ' ' + JSON.stringify(detail).slice(0, 600)); };
  const state = () => E(() => {
    const K = window.__KCA, g = K.game, h = g.world.query({ kind: 'hero' })[0];
    const e = g.world.query({ team: 'enemies' })[0];
    const feet = h.model && h.model.rigInfo && h.model.rigInfo.bones && h.model.rigInfo.bones.get('foot_L');
    let footY = null;
    if (feet && feet.node) { const T3 = feet.node.position.constructor; const p = new T3(); feet.node.getWorldPosition(p); footY = +p.y.toFixed(2); }
    return { tick: g.tick, st: h.fsm.name, move: h.attack ? h.attack.id : null, mf: h.attack ? h.attack.frame : null, x: +h.pos.x.toFixed(2), y: +h.pos.y.toFixed(2), vy: +h.vel.y.toFixed(2), vx: +h.vel.x.toFixed(2),
      gr: h.grounded, runJump: h.runJump, runDir: h.input.runDir, footY, foe: e ? { st: e.fsm.name, x: +e.pos.x.toFixed(2), hp: Math.round(e.hp) } : null, height: h.height };
  });
  const run = async (label, delay) => {
    // Reset: hero on the left, a dummy on the right, level script off, no enemy AI.
    await E(async ([foeX]) => {
      const K = window.__KCA, g = K.game;
      if (g.levels) g.levels.scriptEnabled = false;
      for (const a of g.world.query({ team: 'enemies' })) a.remove();
      const h = g.world.query({ kind: 'hero' })[0];
      h.endMove(); h.fsm.go('idle'); h.vel.set(0, 0, 0); h.runJump = false;
      // start x: run-up distance + leap distance so the plunge comes down on the foe (v = run speed; 0.95 v in the leap)
      const v = h.stats.run;
      const sx = Number(window.__DS_X || NaN);
      h.pos.set(isFinite(sx) ? sx : foeX - (0.7 * v * 16 / 60 + 0.95 * v * (22 + 7) / 60 + 0.25), 0, 0); h.prevPos.copy(h.pos); h.facing = 1;
      const s = await K.debug.spawn('dummy', foeX, 0, {});
      const e = g.world.byId.get(s.id); e.brain = null; e.pos.set(foeX, 0, 0); e.prevPos.copy(e.pos); e.facing = -1;
      if (g.cameraRig && g.cameraRig.snap) g.cameraRig.snap();
      K.input.releaseAll();
    }, [FOE]);
    await T(10);
    const t0 = await E(() => window.__KCA.game.tick);
    // double-tap right (two press edges within DOUBLE_TAP_TICKS) and keep holding = run
    await api.press(1, 'right', 50); await T(5); await api.hold(1, 'right', true);
    const log = [];
    let jumpTick = null, lightTick = null, apex = 0, apexFoot = null, startMove = null, startVy = null, contact = null, firstAir = null;
    for (let i = 0; i < RUN + delay + 70; i++) {
      await T(1);
      const s = await state(); log.push(s);
      if (i === RUN) { await api.press(1, 'jump', 4); jumpTick = s.tick + 1; }
      if (jumpTick !== null && s.tick === jumpTick + delay) { await api.press(1, 'light', 4); lightTick = s.tick + 1; startVy = s.vy; }
      if (!s.gr && firstAir === null) firstAir = s.tick;
      if (s.y > apex) { apex = s.y; apexFoot = s.footY; }
      if (s.move && !startMove && /death_stab|run_jump_attack|jump_attack/.test(s.move)) startMove = { move: s.move, tick: s.tick, y: s.y, vy: s.vy, x: s.x };
      if (s.foe && /hitstun|knockdown|launched|down/.test(s.foe.st) && !contact) contact = { tick: s.tick, foe: s.foe, heroY: s.y, heroX: s.x };
      if (lightTick !== null && s.tick === lightTick + 3) await api.shot(`${label}_press`);
      if (startMove && s.tick === startMove.tick + 4) await api.shot(`${label}_plunge`);
      if (contact && s.tick === contact.tick) await api.shot(`${label}_contact`);
      if (s.gr && lightTick !== null && s.tick > lightTick + 20 && s.st !== 'attack') { await api.shot(`${label}_landed`); break; }
    }
    await api.hold(1, 'right', false);
    const evs = await E((since) => window.__KCA.events(null, since).filter((e) => /attackStart|hit$|knockdown|jump|land/.test(e.type)).map((e) => ({ t: e.tick, type: e.type, s: e.summary })), t0);
    const starts = evs.filter((e) => e.type === 'attackStart').map((e) => e.s.moveId);
    const hits = evs.filter((e) => e.type === 'hit' && String(e.s.attacker).startsWith('hero')).map((e) => [e.t, e.s.moveId, e.s.damage, e.s.target]);
    const kd = evs.filter((e) => e.type === 'knockdown').map((e) => e.t);
    const jumpEv = evs.find((e) => e.type === 'jump');
    R.log.push({ label, delay, t0, jumpTick, lightTick, startVy, firstAir, apex: +apex.toFixed(2), apexFoot, startMove, contact, starts, hits, knockdownTicks: kd, jumpEv: jumpEv && jumpEv.s, rows: log });
    return { starts, hits, kd, apex, apexFoot, startMove, contact, startVy, jumpEv: jumpEv && jumpEv.s };
  };
  const H = await E(() => { const h = window.__KCA.game.world.query({ kind: 'hero' })[0]; return { id: h.typeId, height: h.height, jumpVel: h.stats.jumpVel, run: h.stats.run }; });
  api.log(`hero ${H.id} height ${H.height} jumpVel ${H.jumpVel.toFixed(2)} run ${H.run}`);
  const a = await run('apex', DELAY);
  ok(`${H.id}: dash → jump → Light at the apex starts death_stab (press ${DELAY} ticks after the jump)`, a.jumpEv && a.jumpEv.run === true && a.starts.includes('death_stab') && a.startMove && a.startMove.move === 'death_stab',
    { jump: a.jumpEv, startMove: a.startMove, velYAtPress: a.startVy, starts: a.starts });
  // "feet ≥ 1 body-height at the apex": the tucked feet (foot_L bone) at the apex tick; the actor origin is reported too
  ok(`${H.id}: airborne — feet at the apex ≥ 1 body-height (${H.height} m)`, a.apexFoot !== null && a.apexFoot >= H.height, { footYAtApex: a.apexFoot, originApex: +a.apex.toFixed(2), bodyHeight: H.height });
  ok(`${H.id}: the plunge connects and knocks the foe down`, a.hits.some((h) => h[1] === 'death_stab') && a.kd.length > 0 && a.contact,
    { hits: a.hits, knockdownTicks: a.kd, contact: a.contact });
  const b = await run('early', 10);
  ok(`${H.id}: control — Light 10 ticks after the jump (|vel.y| ≥ 3.2) gives run_jump_attack, not death_stab`, b.startMove && b.startMove.move === 'run_jump_attack' && !b.starts.includes('death_stab'),
    { startMove: b.startMove, velYAtPress: b.startVy, starts: b.starts });
  fs.writeFileSync(path.join(api.outDir, 'death_stab.json'), JSON.stringify({ hero: H, checks: R.checks, runs: R.log }, null, 1));
  api.log(`death_stab_input: ${R.checks.filter((c) => c.pass).length}/${R.checks.length} checks pass`);
};
