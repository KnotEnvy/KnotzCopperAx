// Boss POISE QA (bosses agent, r7 — critic r6 gap "the bosses have NO POISE"). GPU-independent and cheap: an in-page
// system samples the LEAD boss's state machine every SAMPLE ticks (default 15 = 0.25 s) so a whole fight is a handful of
// round trips. Use with /?mode=stage&stage=<n>&p1=brann&p2=gorrim&bot=1&screen=<boss screen>[&poise=0] (god bots).
// Kills the regular wave foes until the boss camera exists, then samples until boss:finaleDone or MAX s. Reports
//   grounded%  knockdown + down + getup     (goal ≤ 15)        stunned%  hitstun + block + grabbed + thrown + stagger
//   attack%    attack + clinch              threat%   attack + clinch + walk + idle + pause + phaseShift (goal ≥ 50)
//   staggers / counters / knockdowns / flinches, TTK (spawn → finaleDone), damage per minute dealt to the bosses.
// Lead = first live member of g._bossCam.members(). Samples inside the boss intro / phase-shift script are excluded from
// the denominators (the boss is invulnerable there). Writes boss_poise.json { summary, samples[], events[] }.
import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  const MAX = Number(process.env.MAX || 130), SAMPLE = Number(process.env.SAMPLE || 15), AT = (process.env.AT || '').split(',').filter(Boolean).map(Number);
  await api.evalGame((sample) => {
    const K = window.__KCA, g = K.game; K.debug.god(true);
    const B = window.__bp = { S: [], E: [], done: false, dmg: 0, hurt: 0, hits: 0, kd: 0, stagger: 0, counter: 0, spawnTick: null, lastTick: -1, endTick: null };
    g.bus.on('boss:finaleDone', () => { B.done = true; B.endTick = g.tick; });
    g.bus.on('boss:stagger', (e) => { B.stagger++; B.E.push({ t: +((g.tick - (B.spawnTick || 0)) / 60).toFixed(1), e: 'stagger', id: e.boss && e.boss.typeId }); });
    g.bus.on('boss:counter', (e) => { B.counter++; B.E.push({ t: +((g.tick - (B.spawnTick || 0)) / 60).toFixed(1), e: 'counter', id: e.boss && e.boss.typeId, mv: e.moveId }); });
    const isBoss = (a) => { const cam = g._bossCam; if (!cam) return false; return cam.members().includes(a); };
    g.bus.on('hit', (e) => { if (e.target && isBoss(e.target) && e.attacker && e.attacker.kind === 'hero') { B.dmg += e.damage || 0; B.hits++; } });
    g.bus.on('hit', (e) => { if (B.spawnTick !== null && e.target && e.target.kind === 'hero' && e.attacker && e.attacker.team === 'enemies') B.hurt += e.damage || 0; });   // damage the heroes would take (god bots)
    g.bus.on('knockdown', (e) => { if (e.actor && isBoss(e.actor)) { B.kd++; B.E.push({ t: +((g.tick - (B.spawnTick || 0)) / 60).toFixed(1), e: 'knockdown', id: e.actor.typeId }); } });
    g.addSystem({ name: 'qa.bossPoise', order: 97, freezable: false, update: () => {
      const cam = g._bossCam; if (!cam) return;
      if (B.spawnTick === null) B.spawnTick = g.tick;
      if (g.tick % sample !== 0 || B.lastTick === g.tick || B.done) return;
      B.lastTick = g.tick;
      const mem = cam.members().filter((m) => m && m.alive && !m.removed);
      if (!mem.length) return;
      const lead = mem[0], P = lead.poise;
      const hpAll = mem.reduce((s, m) => s + m.hp, 0), mxAll = cam.members().reduce((s, m) => s + (m.maxHp || 0), 0);
      B.S.push({ t: +((g.tick - B.spawnTick) / 60).toFixed(2), st: lead.fsm.name, lead: lead.typeId + (lead.tier ? ':' + lead.tier : ''), hp: Math.round(hpAll), hpf: +(hpAll / Math.max(1, mxAll)).toFixed(3),
        pz: P ? +P.frac.toFixed(2) : null, im: P && P.immune > 0 ? 1 : 0, mounted: lead.mountedOn ? 1 : 0, ph: lead.phase || 1, n: mem.length,
        st2: mem[1] ? mem[1].fsm.name : null, hs: lead.hitstop > 0 ? 1 : 0,
        bm: lead.brain && lead.brain.mode || null, cd: lead.brain && lead.brain.cooldown != null ? lead.brain.cooldown : null,
        dx: (() => { let b = 1e9; for (const h of g.world.query({ kind: 'hero' })) b = Math.min(b, Math.abs(h.pos.x - lead.pos.x)); return +b.toFixed(1); })() });
    } });
  }, SAMPLE);
  let spawnT = null;
  for (let i = 0; i < 240 && spawnT === null; i++) {
    await api.advance(500);
    spawnT = await api.evalGame(() => {
      const K = window.__KCA, g = K.game;
      if (g._bossCam) return g.tick / 60;
      for (const e of g.world.query({ team: 'enemies' })) if (e.alive && !e.inStage) K.debug.kill(e.id);
      return null;
    });
  }
  if (spawnT === null) throw new Error('no boss');
  api.log('boss spawn @' + spawnT);
  const shots = [...AT];
  // STAG=1: film the FIRST stagger (STAG_N frames, STAG_STEP ms apart; run capture with --sheet --every 1 [--mp4]); STAG_SKIP=k waits for the k-th
  let t = 0, forced = false, stagLeft = process.env.STAG ? 1 : 0, stagSkip = Number(process.env.STAG_SKIP || 0);
  while (t < MAX) {
    const chunk = stagLeft ? 0.4 : shots.length ? Math.max(0.5, Math.min(5, shots[0] - t)) : 5;
    await api.advance(chunk * 1000); t += chunk;
    const done = await api.evalGame(() => window.__bp.done);
    // FORCE_KD=<s>: floor the lead once at that fight time (exercises the down -> getup -> counter path that poise otherwise never enters)
    if (process.env.FORCE_KD && !forced && t >= Number(process.env.FORCE_KD)) {
      forced = true;
      await api.evalGame(() => { const g = window.__KCA.game, m = g._bossCam.members().find((x) => x && x.alive && !x.removed); if (m) { m.fsm.go('knockdown', { dir: -m.facing, knockback: 3, launch: 5, killed: false, attacker: null }); window.__bp.E.push({ t: +((g.tick - window.__bp.spawnTick) / 60).toFixed(1), e: 'forcedKD', id: m.typeId }); } });
    }
    if (stagLeft && !done) {
      const inS = await api.evalGame(() => { const g = window.__KCA.game, cam = g._bossCam; const m = cam && cam.members().find((x) => x && x.alive && !x.removed); return m ? { st: m.fsm.name, n: window.__bp.stagger } : null; });
      if (inS && inS.st === 'stagger') {
        if (stagSkip > 0 && inS.n <= stagSkip) { await api.advance(2500); t += 2.5; continue; }
        await api.frames(Number(process.env.STAG_N || 8), Number(process.env.STAG_STEP || 150), 'stag'); t += Number(process.env.STAG_N || 8) * Number(process.env.STAG_STEP || 150) / 1000; stagLeft = 0;
      }
    }
    if (shots.length && t >= shots[0]) await api.shot('t' + shots.shift());
    if (done) break;
  }
  const out = await api.evalGame(() => {
    const B = window.__bp, SKIP = ['bossWait', 'bossIntro', 'phaseShift', 'enter', 'bossDying', 'dead', 'bones', 'reform'];
    const S = B.S.filter((s) => !SKIP.includes(s.st));
    const n = Math.max(1, S.length), cnt = {};
    for (const s of S) cnt[s.st] = (cnt[s.st] || 0) + 1;
    const pct = (names) => +(100 * names.reduce((q, k) => q + (cnt[k] || 0), 0) / n).toFixed(1);
    const secs = B.S.length ? B.S[B.S.length - 1].t : 0;
    return { done: B.done, n: S.length, ttk: B.endTick && B.spawnTick !== null ? +((B.endTick - B.spawnTick) / 60).toFixed(1) : null, fightS: secs,
      summary: {
        groundedPct: pct(['knockdown', 'down', 'getup']), stunnedPct: pct(['hitstun', 'block', 'grabbed', 'thrown', 'stagger']), attackPct: pct(['attack', 'clinch']),
        threatPct: pct(['attack', 'clinch', 'walk', 'idle', 'pause']), staggerPct: pct(['stagger']), hitstunPct: pct(['hitstun']),
        staggers: B.stagger, counters: B.counter, knockdowns: B.kd, heroHits: B.hits, heroHurt: Math.round(B.hurt), heroHurtPerMin: secs ? +(B.hurt / (secs / 60)).toFixed(0) : null, dmgPerMin: secs ? +(B.dmg / (secs / 60)).toFixed(0) : null, states: cnt },
      events: B.E, samples: B.S };
  });
  out.maxS = t;
  api.log(JSON.stringify(out.summary) + ' n=' + out.n + ' ttk=' + out.ttk + ' fightS=' + out.fightS);
  fs.writeFileSync(path.join(api.outDir, 'boss_poise.json'), JSON.stringify(out, null, 1));
};
