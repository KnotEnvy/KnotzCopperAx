// AI balance audit (enemies-ai): bot heroes vs an AI showcase crowd, measuring how hard each enemy type pushes back.
//   node tools/capture.mjs --url "/?mode=showcase&what=ai&id=marauder" --scenario tools/scenarios/ai_balance.mjs --out progress/shots/enemies-ai/rN/bal_marauder
// Env: AI_SECONDS (default 40) · AI_FLAGS='{json}' (director A/B) · AI_NOSHOT=1 · AI_THIEF='10,24' (drop a thief next to hero 1 at those s) · AI_GOD=0 to let heroes die (default: god mode, damage still tallied as "virtual KOs")
//      AI_REFILL=0 to not respawn KO'd enemies (default: keep the starting crowd topped up)
// Metrics (writes ai_balance.json): enemy hits + damage per hero-minute, per-type attacks / hits / damage / KOs /
// mean time-to-kill (spawn → KO, s), hero hits landed, blocks, breakouts, telegraphs, reactions, thief spills/escapes.
// Targets (normal): 6–16 enemy hits per hero-minute, 20–70 damage per hero-minute for grunt crowds, every type KO-able.
import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  const secs = Number(process.env.AI_SECONDS || 40);
  const god = process.env.AI_GOD !== '0';
  const refill = process.env.AI_REFILL !== '0';
  const E = (fn, arg) => api.evalGame(fn, arg);
  await E((g) => { if (g) window.__KCA.debug.god(true); }, god);
  // Starting composition (type + tier + opts we can re-create) for refills.
  const comp = await E(() => window.__KCA.game.world.query({ team: 'enemies' }).map((e) => ({ type: e.typeId, tier: e.tier, elite: e.eliteLevel || 0, group: e.spawnOpts && e.spawnOpts.group })));
  const T = { types: {}, enemyHits: 0, enemyDamage: 0, heroHits: 0, kos: 0, playerDown: 0, blocks: 0, breakouts: 0, telegraphs: 0, reacts: 0, feints: 0, spills: 0, escapes: 0, steals: 0, grabs: 0, throws: 0, crumbles: 0, reassembles: 0, shatters: 0, rises: 0 };
  const ty = (s) => { const m = /^enemy:([a-z_]+)#/.exec(String(s || '')); return m ? m[1] : null; };
  const rec = (t) => (T.types[t] = T.types[t] || { attacks: 0, hits: 0, damage: 0, kos: 0, ttk: [] });
  const born = {};
  let since = await E(() => window.__KCA.game.tick);
  const t0 = since;
  if (process.env.AI_FLAGS) await E((f) => Object.assign(window.__KCA.game.ai.director, f), JSON.parse(process.env.AI_FLAGS));
  for (let s = 0; s < secs; s += 2) {
    await api.advance(2000);
    if (s % 8 === 0 && !process.env.AI_NOSHOT) await api.frames(1, 16, 'bal');
    // c1r10 AI_THIEF=<s,s,...>: drop a thief 1.6 m in front of hero 1 at those seconds (thief evidence: the bots' hits spill its sack)
    if (process.env.AI_THIEF && process.env.AI_THIEF.split(',').map(Number).includes(s)) {
      const shotNow = await E(() => { const k = window.__KCA, h = k.game.world.query({ kind: 'hero' })[0]; if (!h) return false; k.debug.spawn('thief', h.pos.x + (h.facing || 1) * 1.6, h.pos.z, { tier: 'blue' }); return true; });
      if (shotNow) { await api.advance(700); await api.frames(3, 120, 'thief' + s); }
    }
    const r = await E((t) => {
      const k = window.__KCA;
      return { tick: k.game.tick, alive: k.game.world.query({ team: 'enemies' }).map((e) => e.typeId), ev: k.events(null, t).map((e) => [e.type, e.tick, e.summary.actor || e.summary.attacker || '', e.summary.target || '', e.summary.damage || 0, e.summary.blocked || false]) };
    }, since);
    since = r.tick;
    for (const [type, tick, who, tgt, dmg, blocked] of r.ev) {
      const et = ty(who), tt = ty(tgt);
      if (type === 'spawn' && et) born[who] = tick;
      if (type === 'attackStart' && et) rec(et).attacks++;
      if (type === 'grab' && et) rec(et).grabs = (rec(et).grabs || 0) + 1;
      if (type === 'hit' && et && String(tgt).startsWith('hero')) { T.enemyHits++; T.enemyDamage += dmg; rec(et).hits++; rec(et).damage += dmg; }
      if (type === 'hit' && String(who).startsWith('hero') && tt && !blocked) T.heroHits++;
      if (type === 'ko' && et) { T.kos++; rec(et).kos++; rec(et).ttk.push(((tick - (born[who] ?? t0)) / 60)); }
      if (type === 'playerDown') T.playerDown++;
      const map = { 'ai:block': 'blocks', 'ai:breakout': 'breakouts', 'ai:telegraph': 'telegraphs', 'ai:react': 'reacts', 'ai:feint': 'feints', 'ai:thiefSpill': 'spills', 'ai:escape': 'escapes', 'ai:steal': 'steals', 'ai:crumble': 'crumbles', 'ai:reassemble': 'reassembles', 'ai:shatter': 'shatters', grab: 'grabs', throw: 'throws' };
      if (map[type]) T[map[type]]++;
    }
    if (refill) {
      const alive = r.alive.slice();
      for (const c of comp) {
        const i = alive.indexOf(c.type);
        if (i >= 0) { alive.splice(i, 1); continue; }
        if (c.type === 'thief') continue;
        await E((c) => { const k = window.__KCA, h = k.game.world.query({ kind: 'hero' })[0], x = (h ? h.pos.x : 0) + (Math.random() < 0.5 ? -7 : 7); return k.debug.spawn(c.type, x, (Math.random() - 0.5) * 2, { tier: c.tier || undefined, elite: c.elite || undefined, group: c.group, rise: c.type === 'skeleton' }); }, c);
      }
    }
  }
  const heroes = await E(() => window.__KCA.game.world.query({ kind: 'hero' }).length);
  const hm = Math.max(1e-6, heroes * secs / 60);
  for (const k of Object.keys(T.types)) { const r = T.types[k]; r.meanTTK = r.ttk.length ? +(r.ttk.reduce((a, b) => a + b, 0) / r.ttk.length).toFixed(1) : null; r.ttk = r.ttk.map((x) => +x.toFixed(1)); r.damage = +r.damage.toFixed(1); }
  const out = { seconds: secs, heroes, god, perHeroMinute: { enemyHits: +(T.enemyHits / hm).toFixed(1), enemyDamage: +(T.enemyDamage / hm).toFixed(1), heroHits: +(T.heroHits / hm).toFixed(1), virtualHeroKOs: +((T.enemyDamage / 48) / hm).toFixed(2) }, ...T, rises: undefined };
  const info = await E(() => { const i = window.__KCA.info(); return { fps: i.fps, drawCalls: i.drawCalls, triangles: i.triangles, errors: i.errors.slice(-6) }; });
  out.info = info;
  out.director = await E(() => { const d = window.__KCA.game.ai && window.__KCA.game.ai.director; return d ? { ...d.stats, heatPeak: +(d.stats.heatPeak || 0).toFixed(2) } : null; });
  api.log('BALANCE ' + JSON.stringify(out));
  fs.writeFileSync(path.join(api.outDir, 'ai_balance.json'), JSON.stringify(out, null, 2));
};
