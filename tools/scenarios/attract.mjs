// Attract/bot audit (foundation-engine): bot=1 heroes play unattended; tallies the moveset they show and how hard
// the enemies push back. Events are read incrementally (the bus log is a ring buffer).
//   node tools/capture.mjs --url "/?mode=stage&stage=1&p1=brann&p2=seraphine&bot=1&placeholder=1" --scenario tools/scenarios/attract.mjs --sheet --out progress/shots/foundation-engine/r3/attract
// Optional: window.__ATTRACT_SECONDS (default 70). Writes attract.json.
import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  const R = { checks: [] };
  const ok = (name, pass, detail) => { R.checks.push({ name, pass: !!pass, detail }); api.log((pass ? 'PASS ' : 'FAIL ') + name + ' ' + JSON.stringify(detail).slice(0, 900)); };
  const E = (fn, arg) => api.evalGame(fn, arg);
  const secs = Number(process.env.ATTRACT_SECONDS || 70);
  const T = { moves: {}, dodge: 0, perfect: 0, magic: 0, grab: 0, clinch: 0, throw: 0, charge: 0, heroHits: 0, enemyHits: 0, enemyDamage: 0, enemyAttacks: 0, kos: 0, playerDown: 0 };
  // In-page sampler: where do enemies spend their ticks (state / brain mode / token)?
  await E(() => { const k = window.__KCA, g = k.game, S = window.__qaEnemyStats = { ticks: 0, enemyTicks: 0, states: {}, modes: {}, alive: 0 };
    g.addSystem({ name: 'qa-enemy-stats', order: 99, update() { S.ticks++; for (const e of g.world.query({ team: 'enemies' })) { if (!e.alive) continue; S.enemyTicks++; S.states[e.fsm.name] = (S.states[e.fsm.name] || 0) + 1; const m = e.brain && e.brain.mode; if (m && e.fsm.is('idle', 'walk')) S.modes[m] = (S.modes[m] || 0) + 1; } } }); });
  // Grab trace: what happens to each grabbed foe during the next 40 ticks (diagnoses throws that never release).
  await E(() => { const g = window.__KCA.game, tr = window.__qaGrabs = [];
    g.bus.on('grab', (e) => { const rec = { tick: g.tick, move: e.moveId, hero: e.actor.fsm.name, seq: [] }; tr.push(rec); rec.v = e.victim; rec.h = e.actor; });
    g.addSystem({ name: 'qa-grab-trace', order: 98, update() { for (const r of tr) if (r.v && g.tick - r.tick < 40) r.seq.push(`${r.h.fsm.name}/${r.v.fsm.name}${r.v.grabbedBy ? '' : '!'}`); } }); });
  let since = await E(() => window.__KCA.game.tick);
  for (let s = 0; s < secs; s += 2) {
    await api.advance(2000);
    if (s % 6 === 0) await api.frames(1, 16, 'attract');
    const r = await E((t) => {
      const k = window.__KCA, all = k.events(null, t), hero = (x) => String(x).startsWith('hero'), enemy = (x) => String(x).startsWith('enemy');
      return { tick: k.game.tick, ev: all.map((e) => [e.type, e.summary.actor || e.summary.attacker || '', e.summary.moveId || '', e.summary.perfect || e.summary.clinch || false, e.summary.damage || 0, hero(e.summary.target) ? 1 : 0, enemy(e.summary.actor) ? 1 : 0]) };
    }, since);
    since = r.tick;
    for (const [type, who, move, flag, dmg, tgtHero, actEnemy] of r.ev) {
      const h = String(who).startsWith('hero');
      if (type === 'attackStart' && h) T.moves[move] = (T.moves[move] || 0) + 1;
      if (type === 'attackStart' && actEnemy) T.enemyAttacks++;
      if (type === 'dodge' && h) { T.dodge++; if (flag) T.perfect++; }
      if (type === 'magicCast') T.magic++;
      if (type === 'grab') { T.grab++; if (flag) T.clinch++; }
      if (type === 'throw') T.throw++;
      if (type === 'charge' && h) T.charge++;
      if (type === 'hit' && h) T.heroHits++;
      if (type === 'hit' && String(who).startsWith('enemy') && tgtHero) { T.enemyHits++; T.enemyDamage += dmg; }
      if (type === 'ko') T.kos++;
      if (type === 'playerDown') T.playerDown++;
    }
  }
  const m = Object.keys(T.moves);
  const has = (re) => m.some((x) => re.test(x));
  const shown = { dodge: T.dodge > 0, run_attack: has(/^run_attack/), death_stab: has(/^death_stab/), back_attack: has(/^back_attack/), magic: T.magic > 0, throw: T.throw > 0, charge: has(/_c[123]$/), air_slam: has(/^air_slam/), string: has(/^pommel_2/) && has(/^light_3/) };
  ok('attract: bots show the full moveset (dodge, dash attack, Death Stab, back attack, magic, throw, charge, slam, strings)', Object.values(shown).every(Boolean), { shown, tally: T });
  const nHeroes = await E(() => window.__KCA.game.world.query({ kind: 'hero' }).length);
  // ≥ 1.5× the QA r2 baseline (9 enemy hits on 2 bot heroes in 62 s = 4.4 hits per hero-minute) → ≥ 6.6 hits and ≥ 25 damage per hero-minute.
  const perHeroMin = (v) => (v / nHeroes) * (60 / secs);
  ok('attract: enemies threaten (≥ 1.5× QA baseline: ≥ 6.6 hits and ≥ 25 damage per hero-minute)', perHeroMin(T.enemyHits) >= 6.6 && perHeroMin(T.enemyDamage) >= 25, { enemyHits: T.enemyHits, enemyDamage: Math.round(T.enemyDamage), hitsPerHeroMin: Math.round(perHeroMin(T.enemyHits) * 10) / 10, dmgPerHeroMin: Math.round(perHeroMin(T.enemyDamage)), enemyAttacks: T.enemyAttacks, seconds: secs, playerDown: T.playerDown });
  R.botUses = await E(() => (window.__KCA.game.systems.find((s) => s.name === 'bots') || { bots: [] }).bots.map((b) => ({ hero: b.hero.typeId, uses: b.uses })));
  api.log('bot uses ' + JSON.stringify(R.botUses));
  R.grabTrace = await E(() => window.__qaGrabs.map((r) => ({ tick: r.tick, move: r.move, seq: [...new Set(r.seq)].join(' > ') })));
  api.log('grabs ' + JSON.stringify(R.grabTrace).slice(0, 1200));
  const es = await E(() => window.__qaEnemyStats);
  const pct = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round((v / Math.max(1, es.enemyTicks)) * 1000) / 10]));
  R.enemyTime = { avgAlive: Math.round((es.enemyTicks / Math.max(1, es.ticks)) * 10) / 10, statePct: pct(es.states), brainModePct: pct(es.modes) };
  api.log('enemy time ' + JSON.stringify(R.enemyTime));
  const info = await E(() => window.__KCA.info());
  R.errors = info.errors; R.tally = T;
  fs.writeFileSync(path.join(api.outDir, 'attract.json'), JSON.stringify(R, null, 1));
  api.log(`SUMMARY ${R.checks.filter((c) => c.pass).length}/${R.checks.length} passed · errors ${JSON.stringify(info.errors || []).slice(0, 300)}`);
};
