// Moveset regression scenario (foundation-engine): verifies the DESIGN §2/§3 moves in the real game.
//   node tools/capture.mjs --url "/?mode=stage&stage=test&p1=brann&placeholder=1&pots=1" \
//        --scenario tools/scenarios/moves.mjs --out progress/shots/foundation-engine/r3/moves_brann --sheet --every 1
// Checks: events(type, game.tick) stamping · first magic cast is synchronous/deterministic · canon spell damage per
// tier (4/8/16/24/32/40) · Heavy tap vs 3-level charge · air Heavy = slam with ground bounce · close string →
// aimed THROW that damages the foe it hits · walk-in grab (clinch) → knees → throw. Writes moves.json (checks) next to the frames; frames of the throw,
// charge and slam go to the contact sheet.
import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  const R = { checks: [] };
  const ok = (name, pass, detail) => { R.checks.push({ name, pass: !!pass, detail }); api.log((pass ? 'PASS ' : 'FAIL ') + name + ' ' + JSON.stringify(detail).slice(0, 700)); };
  const E = (fn, arg) => api.evalGame(fn, arg);
  const T = (n) => api.advance((1000 / 60) * n);
  const tick = () => E(() => window.__KCA.game.tick);
  const evs = (type, since) => E(([t, s]) => window.__KCA.events(t, s), [type, since]);
  const heroHits = async (t0) => (await evs('hit', t0)).filter((e) => String(e.summary.attacker).startsWith('hero')).map((e) => [e.summary.moveId, Math.round(e.summary.damage * 100) / 100, e.summary.target]);
  const place = (x) => E((x) => { const h = window.__KCA.game.world.query({ kind: 'hero' })[0]; h.endMove(); h.pos.set(x, 0, 0); h.vel.set(0, 0, 0); h.prevPos.copy(h.pos); h.facing = 1; h.fsm.go('idle'); }, x);
  const clear = () => E(() => { const k = window.__KCA; for (const a of k.game.world.query({ team: 'enemies' })) a.remove(); });
  const foe = (x, hp = 500) => E(async ([x, hp]) => { const k = window.__KCA; const s = await k.debug.spawn('marauder', x, 0, { hp }); const e = k.game.world.byId.get(s.id); e.brain = null; e.pos.set(x, 0, 0); e.prevPos.copy(e.pos); e.facing = -1; return e.id; }, [x, hp]);
  // Press Light as soon as the current move offers a Light cancel (works for every hero's frame data).
  const lightWhenOpen = async () => {
    for (let i = 0; i < 45; i++) {
      const open = await E(() => { const h = window.__KCA.game.world.query({ kind: 'hero' })[0]; return !!(h.attack && h.attack.cancelsNow().some((c) => c.on === 'light')); });
      if (open) break;
      await T(1);
    }
    await api.press(1, 'light', 50);
  };
  const hp = (id) => E((id) => { const e = window.__KCA.game.world.byId.get(id); return e ? Math.round(e.hp * 100) / 100 : null; }, id);

  // ---------------------------------------------------------------- 1. first cast (pots=1 from the URL, spell book preloaded on spawn)
  await E(() => { const k = window.__KCA; k.debug.god(true); if (k.game.levels) k.game.levels.scriptEnabled = false; });
  let t0 = await tick();
  await api.press(1, 'magic', 50); // 3-tick tap: magicSelect, then the cast on release
  await T(6);
  const castAfter1 = (await evs('magicCast', t0)).map((e) => e.tick - t0);
  await api.advance(1000);
  const castAfter1s = (await evs('magicCast', t0)).length;
  ok('first magic cast lands within the tap (6 ticks), no real-time wait (pots=1)', castAfter1.length === 1 && castAfter1[0] <= 6 && castAfter1s === 1, { ticksAfterPress: castAfter1, after1s: castAfter1s });
  await api.advance(2500);

  // ---------------------------------------------------------------- 2. events(type, game.tick) stamping
  t0 = await tick();
  await api.press(1, 'jump', 50);
  await T(1);
  const jNow = (await evs('jump', t0)).length;
  const direct = await E(() => { const k = window.__KCA, t = k.game.tick; k.game.bus.emit('qa:probe', {}); return k.events('qa:probe', t).length; });
  ok('events(type, game.tick) includes the next stepped tick and between-step emits', jNow === 1 && direct === 1, { jumpSinceT: jNow, directEmitSinceT: direct });
  await api.advance(1200);

  // ---------------------------------------------------------------- 3. canon spell damage per tier
  await clear(); await place(4); const big = await foe(6.5, 5000); await T(2);
  const maxTier = await E(() => window.__KCA.game.world.query({ kind: 'hero' })[0].maxTier);
  const dmg = [];
  for (let tier = 1; tier <= maxTier; tier++) {
    const before = await hp(big);
    await E((t) => window.__KCA.debug.cast(1, t), tier);
    await api.advance(tier >= 3 ? 7000 : 4500);
    dmg.push(Math.round((before - (await hp(big))) * 100) / 100);
    await E((id) => { const e = window.__KCA.game.world.byId.get(id); if (e) { e.pos.set(6.5, 0, 0); e.prevPos.copy(e.pos); } }, big);
    await api.advance(1500);
  }
  const canon = [4, 8, 16, 24, 32, 40].slice(0, maxTier);
  ok('spell damage per tier is canon 4/8/16/24/32/40', dmg.every((d, i) => Math.abs(d - canon[i]) < 0.01), { measured: dmg, canon });

  // ---------------------------------------------------------------- 4. Heavy: tap vs charge
  await clear(); await place(4); let f = await foe(5.3); await T(3);
  t0 = await tick(); await api.press(1, 'heavy', 50); await api.advance(1200); const tap = await heroHits(t0);
  await api.advance(1200); await clear(); await place(4); f = await foe(5.3); await T(3);
  t0 = await tick(); await api.press(1, 'heavy', 1000);
  await T(40); await api.frames(1, 16.7, 'charge'); // mid-charge pose (level 1)
  await T(18); await api.frames(1, 16.7, 'charge');
  await api.advance(1400);
  const chg = await heroHits(t0), chgEv = (await evs('charge', t0)).map((e) => e.summary.level);
  await api.advance(1000); await clear(); await place(4); f = await foe(5.3); await T(3);
  t0 = await tick(); await api.press(1, 'heavy', 2000); await api.advance(3200);
  const chg3 = await heroHits(t0), chg3Ev = (await evs('charge', t0)).map((e) => e.summary.level);
  ok('Heavy hold-to-charge: 3 levels, each hits harder than a tap', tap.length && chg.length && chg3.length && chg[0][1] > tap[0][1] && chg3[0][1] > chg[0][1] && chg3Ev.join() === '1,2,3',
    { tap, charged1s: chg, charged1sLevels: chgEv, charged2s: chg3, charged2sLevels: chg3Ev });

  // ---------------------------------------------------------------- 5. air Heavy = slam with ground bounce
  await api.advance(1000); await clear(); await place(4); f = await foe(5.0); await T(3);
  t0 = await tick(); await api.press(1, 'jump', 50); await api.advance(280); await api.press(1, 'heavy', 50);
  let peakAfterBounce = 0, bounced = false;
  for (let i = 0; i < 60; i++) {
    await T(1);
    const s = await E((id) => { const e = window.__KCA.game.world.byId.get(id); return e ? { y: e.pos.y, st: e.fsm.name } : null; }, f);
    if (i === 14 || i === 22) await api.frames(1, 0.001, 'slam');
    if (bounced && s) peakAfterBounce = Math.max(peakAfterBounce, s.y);
    if (!bounced && (await evs('land', t0)).some((e) => e.summary.bounce)) bounced = true;
  }
  const slamStarts = (await evs('attackStart', t0)).filter((e) => String(e.summary.actor).startsWith('hero')).map((e) => e.summary.moveId);
  const slamHits = await heroHits(t0);
  ok('air Heavy is a slam (air_slam → air_slam_land) whose victim ground-bounces', slamStarts.includes('air_slam') && slamStarts.includes('air_slam_land') && slamHits.length && bounced && peakAfterBounce > 0.4,
    { starts: slamStarts, hits: slamHits, bounced, peakAfterBounce: Math.round(peakAfterBounce * 100) / 100 });

  // ---------------------------------------------------------------- 6. close string → aimed THROW (hold ← = throw behind)
  await api.advance(1500); await clear(); await place(6);
  const victim = await foe(6.8), behind = await foe(4.2); await T(3);
  const hpB0 = await hp(behind), hpV0 = await hp(victim);
  t0 = await tick();
  await api.press(1, 'light', 50); await T(2);
  for (let i = 0; i < 3; i++) { await lightWhenOpen(); await T(2); }
  await api.hold(1, 'left', true); await lightWhenOpen();
  await api.frames(4, 100, 'throw');
  await api.hold(1, 'left', false);
  await api.frames(2, 150, 'throw');
  await api.advance(1200);
  const moves = (await evs('attackStart', t0)).filter((e) => String(e.summary.actor).startsWith('hero')).map((e) => e.summary.moveId);
  const grabs = (await evs('grab', t0)).length, throws = (await evs('throw', t0)).map((e) => e.summary.dir);
  const tHits = (await heroHits(t0)).filter((h) => /throw/.test(h[0]));
  const hpB1 = await hp(behind), hpV1 = await hp(victim);
  ok('close string ends in an aimed THROW (hold ←) that damages the foe it hits', moves.slice(-1)[0] === 'throw' && grabs === 1 && throws[0] === -1 && tHits.some((h) => h[0] === 'throw_impact') && hpB1 < hpB0 && hpV1 < hpV0,
    { moves, grabs, throwDir: throws, throwHits: tHits, behindHp: [hpB0, hpB1], victimHp: [hpV0, hpV1] });
  // Without an aim the close string still ends in the kick.
  await api.advance(1000); await clear(); await place(6); await foe(6.8); await T(3);
  t0 = await tick();
  await api.press(1, 'light', 50); await T(2);
  for (let i = 0; i < 4; i++) { await lightWhenOpen(); await T(2); }
  await api.advance(1200);
  const kickMoves = (await evs('attackStart', t0)).filter((e) => String(e.summary.actor).startsWith('hero')).map((e) => e.summary.moveId);
  ok('no aim → close string ends in the kick (close_finisher)', kickMoves.slice(-1)[0] === 'close_finisher' && !kickMoves.includes('throw'), { moves: kickMoves });

  // ---------------------------------------------------------------- 7. walk-in grab (clinch) → knees → throw forward into another foe
  await api.advance(1000); await clear(); await place(6);
  const held = await foe(6.95), front = await foe(9.2); await T(3);
  const hpH0 = await hp(held), hpF0 = await hp(front);
  t0 = await tick();
  await api.hold(1, 'right', true);
  let clinchAt = -1;
  for (let i = 0; i < 40 && clinchAt < 0; i++) { await T(1); if (await E(() => window.__KCA.game.world.query({ kind: 'hero' })[0].fsm.is('clinch'))) clinchAt = i; }
  await api.hold(1, 'right', false);
  await api.frames(1, 16.7, 'clinch');
  for (let i = 0; i < 2; i++) { await api.press(1, 'light', 50); await T(16); }
  await api.press(1, 'light', 50);
  await api.frames(3, 120, 'clinch');
  await api.advance(1500);
  const cGrabs = (await evs('grab', t0)).map((e) => e.summary.moveId), cThrows = (await evs('throw', t0)).map((e) => e.summary.dir);
  const cHits = (await heroHits(t0)).map((h) => h[0]);
  const hpH1 = await hp(held), hpF1 = await hp(front);
  ok('walk-in grab: pushing into a foe clinches it; Light = knees, 3rd Light = throw that bowls the foe ahead', clinchAt >= 0 && cGrabs.includes('clinch') && cHits.filter((m) => m === 'clinch_knee').length === 2 && cThrows[0] === 1 && cHits.includes('throw_impact') && hpH1 < hpH0 && hpF1 < hpF0,
    { clinchAfterTicks: clinchAt, grabs: cGrabs, hits: cHits, throwDir: cThrows, heldHp: [hpH0, hpH1], frontHp: [hpF0, hpF1] });

  const info = await E(() => window.__KCA.info());
  R.errors = info.errors;
  fs.writeFileSync(path.join(api.outDir, 'moves.json'), JSON.stringify(R, null, 1));
  api.log(`SUMMARY ${R.checks.filter((c) => c.pass).length}/${R.checks.length} passed · errors ${JSON.stringify(info.errors || []).slice(0, 300)}`);
};
