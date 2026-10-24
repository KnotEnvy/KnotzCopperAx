// Full in-stage boss fight (bosses agent). Use with /?mode=stage&stage=<n>&p1=..&p2=..&bot=1&screen=<boss screen>.
// God-mode bot heroes (damage they WOULD take is still summed); kills the screen's regular wave foes until the boss
// spawns, then lets the bots fight to the end (boss:finaleDone / stageClear) and reports TTK + events.
// Clips (frames for --sheet/--mp4): CLIPS = comma list of "<trigger>:<frames>" — trigger 'spawn' (boss actor appears)
// or any logged event name (e.g. boss:spark, boss:phaseShift, boss:defeat). CLIP_STEP ms (default 66). MAX s (180).
import fs from 'node:fs';
import path from 'node:path';

const EVENTS = ['bossIntro', 'bossPhase', 'boss:phaseShift', 'boss:spark', 'boss:summon', 'boss:stolenSpell', 'boss:defeat',
  'boss:relicFree', 'boss:impaled', 'boss:captivesLowered', 'boss:finaleDone', 'boss:memberDown', 'boss:rally', 'chapterComplete', 'stageClear'];

export default async (api) => {
  const MAX = Number(process.env.MAX || 180), STEP = Number(process.env.CLIP_STEP || 66);
  const clips = (process.env.CLIPS || 'spawn:24,boss:defeat:24').split(',').map((c) => { const i = c.lastIndexOf(':'); return { on: c.slice(0, i), n: Number(c.slice(i + 1)), done: false }; });
  await api.evalGame((names) => {
    const K = window.__KCA, g = K.game;
    K.debug.god(true);
    const L = window.__bf = { dmg: 0, hits: 0, events: [], moves: {} };
    g.bus.on('hit', (e) => { if (e.target && e.target.kind === 'hero' && e.attacker && e.attacker.team === 'enemies') { L.dmg += e.damage || 0; L.hits++; } });
    g.bus.on('boss:move', (e) => { L.moves[e.moveId] = (L.moves[e.moveId] || 0) + 1; });
    for (const t of names) g.bus.on(t, () => L.events.push({ t, s: g.tick / 60 }));
  }, EVENTS);
  const now = () => api.evalGame(() => window.__KCA.game.tick / 60);
  const clip = async (c) => { c.done = true; api.log(`clip ${c.on} (${c.n} frames)`); await api.frames(c.n, STEP, 'clip'); };
  // 1) clear regular waves until a boss actor exists
  let spawnT = null;
  for (let i = 0; i < 240 && spawnT === null; i++) {
    await api.advance(500);
    spawnT = await api.evalGame(() => {
      const K = window.__KCA, g = K.game;
      const foes = g.world.query({ team: 'enemies' });
      if (g.world.query({ kind: 'boss' }).length || foes.some((e) => e.inStage)) return g.tick / 60;
      if (K.events('waveStart').some((e) => /boss/.test(JSON.stringify(e.summary || '')))) return null;  // boss wave loading
      for (const e of foes) if (e.alive) K.debug.kill(e.id);
      return null;
    });
  }
  if (spawnT === null) throw new Error('no boss spawned within 120 s');
  api.log(`boss spawned at ${spawnT.toFixed(1)} s`);
  for (const c of clips) if (c.on === 'spawn' && !c.done) await clip(c);
  // 2) fight
  let end = null, seen = 0;
  while (end === null && (await now()) - spawnT < MAX) {
    await api.advance(500);
    const L = await api.evalGame(() => window.__bf.events);
    for (; seen < L.length; seen++) {
      const e = L[seen];
      for (const c of clips) if (!c.done && c.on === e.t) await clip(c);
      if (e.t === 'stageClear' || e.t === 'chapterComplete') end = e.s;
    }
    if (end === null && L.some((e) => e.t === 'boss:finaleDone')) {
      const left = await api.evalGame(() => window.__KCA.game.world.query({ team: 'enemies' }).filter((e) => e.alive).length);
      if (!left) end = await now();
    }
  }
  await api.advance(1500);
  const L = await api.evalGame(() => window.__bf);
  const info = await api.evalGame(() => window.__KCA.info());
  const ev = (t) => (L.events.find((e) => e.t === t) || {}).s;
  const intro = ev('bossIntro'), def = ev('boss:defeat');
  const dur = ((end || (await now())) - spawnT) / 60 * 60;
  const out = { spawnT, intro, defeat: def, ttk: def && intro ? +(def - intro).toFixed(1) : null, heroDamagePerMin: +(L.dmg / (dur / 60)).toFixed(1), heroHits: L.hits,
    moves: L.moves, events: L.events.map((e) => `${e.t}@${e.s.toFixed(1)}`), stage: info.stage, drawCalls: info.drawCalls, triangles: info.triangles, errors: info.errors };
  fs.writeFileSync(path.join(api.outDir, 'boss_stage_fight.json'), JSON.stringify(out, null, 1));
  api.log(`TTK ${out.ttk}s · dmg/min ${out.heroDamagePerMin} · moves ${JSON.stringify(L.moves)} · ${out.events.join(' ')}`);
  await api.shot('end');
};
