// Boss screen-pulse clip (bosses r10 — board r9: "boss pulses blow out the frame", ca 0.45–0.8 / flash 1.0).
// Use with /?mode=showcase&what=boss&id=varkhul&scene=fight --step 33 --mp4 --sheet. God heroes. Waits for the intro to
// end, then: LEAD frames → a real poise break (the 'stagger' FSM state, which fires the stagger pulse) → STAG frames →
// a real killing blow from P1 through combat.applyHit (Boss.beginDefeat: hitstop, slow-mo, KO pulse, drama zoom) →
// DEF frames. GROUP=1 (group bosses, e.g. &id=captains): other members are killed first. Logs the PostFX pulse actually stored (post-clamp) at each beat. Writes boss_pulse_clip.json.
import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  const LEAD = Number(process.env.LEAD || 6), STAG = Number(process.env.STAG || 34), DEF = Number(process.env.DEF || 80);
  await api.evalGame(() => { window.__KCA.debug.god(true); });
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    await api.advance(500);
    ready = await api.evalGame(() => {
      const g = window.__KCA.game, b = g.world.query({ kind: 'boss' })[0] || g.world.query({ team: 'enemies' }).find((e) => e.poise);
      const members = g.world.query({ team: 'enemies' }).filter((e) => e.poise && e.alive);   // group bosses: intro card gone + members out of intro invuln
      return !!(b && b.alive && b.fsm && !b.fsm.is('bossWait', 'bossIntro', 'enter') && !document.querySelector('.kca-boss') && members.every((e) => !(e.invuln > 0) && !e.fsm.is('enter', 'pause')));
    });
  }
  const log = { ready, beats: [] };
  if (process.env.GROUP) {   // group boss (Captains / Brutes): drop the other members first (memberDown), so the clip's
    log.group = await api.evalGame(() => {   // killing blow lands on the LAST member → _group.js defeatBeat
      const g = window.__KCA.game, P = g.world.query({ team: 'enemies' }).filter((e) => e.poise && e.alive);
      const h = g.world.query({ kind: 'hero' })[0];
      for (const e of P.slice(1)) { e.hp = 1; e.invuln = 0; e.superArmor = 0; g.combat.applyHit(h, e, { damage: 40, knockdown: true, knockback: 3, hitstop: 4, level: 'heavy' }, { moveId: 'qa_kill', dir: Math.sign(e.pos.x - h.pos.x) || 1 }); }
      return P.map((e) => e.typeId + ':' + (e.tier || '') + (e.alive ? '' : ' (down)'));
    });
    await api.advance(2500);
  }
  await api.frames(LEAD, 33);
  log.beats.push(await api.evalGame(() => {
    const g = window.__KCA.game, b = g.world.query({ kind: 'boss' })[0] || g.world.query({ team: 'enemies' }).find((e) => e.poise);
    const h = g.world.query({ kind: 'hero' })[0];
    const P = b.poise; P.breaks++; P.cur = 0;
    g.bus.emit('boss:stagger', { boss: b, by: h, breaks: P.breaks });
    b.fsm.go('stagger', { dir: Math.sign(b.pos.x - h.pos.x) || 1, by: h, point: { x: b.pos.x, y: b.height * 0.6, z: b.pos.z } });
    const p = g.renderer.post._pulse;
    return { beat: 'stagger', tick: g.tick, state: b.fsm.name, pulse: p ? { ca: p.ca, flash: p.flash, desat: p.desat, duration: p.duration } : null };
  }));
  await api.frames(STAG, 33);
  log.beats.push(await api.evalGame(() => {
    const g = window.__KCA.game, b = g.world.query({ kind: 'boss' })[0] || g.world.query({ team: 'enemies' }).find((e) => e.poise);
    const h = g.world.query({ kind: 'hero' })[0];
    b.hp = 1; b.invuln = 0; b.superArmor = 0; b.pendingPhase = null; b.godMode = false;
    const lockWas = b.showcaseLock; b.showcaseLock = true;   // skip the phase-line clamp so the blow is lethal
    g.combat.applyHit(h, b, { damage: 40, knockdown: true, knockback: 3, hitstop: 8, level: 'heavy' }, { moveId: 'qa_finisher', dir: Math.sign(b.pos.x - h.pos.x) || 1 });
    b.showcaseLock = lockWas;
    const p = g.renderer.post._pulse;
    return { beat: 'defeat', tick: g.tick, alive: b.alive, defeated: !!b.defeated, state: b.fsm && b.fsm.name, pulse: p ? { ca: p.ca, flash: p.flash, desat: p.desat, duration: p.duration } : null };
  }));
  await api.frames(DEF, 33);
  api.log(JSON.stringify(log));
  fs.writeFileSync(path.join(api.outDir, 'boss_pulse_clip.json'), JSON.stringify(log, null, 1));
};
