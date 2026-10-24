// Bizarrian ride/steal regression (mounts agent). Use with the riding sandbox:
//   node tools/capture.mjs --url "/?mode=showcase&what=mount&id=cluckhorn&scene=ride" --scenario tools/scenarios/mounts.mjs --sheet --mp4 --step 33 --out ...
// Flow: a marauder rides in → Brann knocks him off → walks into the free beast + Jump (mount) → beast attacks on two
// straw marauders (Light / Heavy) → a big hit knocks Brann off. Writes mounts.json (events + checks). FRAMES env
// (default 60) = total frames captured across the key beats.
import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  const S = (fn) => api.evalGame(fn);
  const st = () => S(() => window.__KCA.showcase.state());
  const checks = {};
  const budget = Number(process.env.FRAMES || 60);
  let shotN = 0;
  const grab = async (n, tag) => { const k = Math.min(n, budget - shotN); if (k > 0) { await api.frames(k, 33, `f${String(shotN).padStart(3, '0')}_${tag}`); shotN += k; } };
  const hold = (a, d) => api.hold(1, a, d);
  const release = async () => { for (const a of ['left', 'right', 'up', 'down']) await hold(a, false); };
  /** walk toward x (and z) until within r (or timeout ms). */
  const approach = async (getT, r = 1.0, ms = 3000, rec = 0, tag = 'walk') => {
    for (let t = 0; t < ms; t += 100) {
      const s = await st(); const T = await S(getT);
      if (!T) break;
      const dx = T.x - s.hero.x, dz = T.z - s.hero.z;
      if (Math.hypot(dx, dz) < r) break;
      await hold('right', dx > 0.2); await hold('left', dx < -0.2);
      await hold('down', dz > 0.15); await hold('up', dz < -0.15);
      if (rec) { await grab(rec, tag); rec = 0; } else await api.advance(100);
    }
    await release();
  };
  await S(() => window.__KCA.debug.god(true));
  const t0 = await S(() => window.__KCA.game ? window.__KCA.game.tick : 0);
  await api.advance(900); // the rider arrives
  await grab(4, 'arrive');
  // 1. knock the rider off
  const rider = () => { const b = window.__KCA.showcase.beast(); const r = b && b.rider; return r ? { x: r.pos.x - r.facing * 0.0, z: r.pos.z } : null; };
  await approach(rider, 1.7, 3000);
  for (let i = 0; i < 6; i++) {
    const s = await st();
    if (!s.beast.rider) break;
    await api.press(1, 'light', 60);
    if (i === 0) await grab(10, 'knockoff'); else await api.advance(260);
  }
  let s = await st();
  checks.riderKnockedOff = !s.beast.rider;
  api.log('after knockoff ' + JSON.stringify(s));
  // keep the scripted beat deterministic: the thrown-off marauder won't race us back into the saddle
  await S(() => { const b = window.__KCA.showcase.beast(); if (b && b.lastRider) { b.noMount.set(b.lastRider.id, 1e9); window.__KCA.debug.kill(b.lastRider.id); } });
  await grab(4, 'free');
  // 2. walk into the free beast and press Jump to mount
  const beast = () => { const b = window.__KCA.showcase.beast(); return b && !b.removed ? { x: b.pos.x, z: b.pos.z } : null; };
  await api.advance(700);
  await approach(beast, 0.9, 4000);
  api.log('before jump ' + JSON.stringify(await st()));
  await api.press(1, 'jump', 60);
  await grab(8, 'mount');
  await api.advance(300);
  s = await st();
  checks.heroMounted = s.hero.mounted;
  api.log('after mount ' + JSON.stringify(s));
  // 3. beast attacks on marauders
  // face the nearest foe and whip at once (the thrown-off marauder is already back on his feet)
  await S(() => { const sc = window.__KCA.showcase; return Promise.all([sc.spawnFoe('marauder', 2.6, 0.1, 'straw'), sc.spawnFoe('marauder', -3.2, -0.2, 'straw')]); });
  await api.advance(250);
  const dir = await S(() => { const h = window.__KCA.showcase.hero; const e = window.__KCA.game.world.query({ team: 'enemies' }).filter((x) => x.alive).sort((a, b) => Math.abs(a.pos.x - h.pos.x) - Math.abs(b.pos.x - h.pos.x))[0]; return e ? Math.sign(e.pos.x - h.pos.x) : 1; });
  await hold(dir > 0 ? 'right' : 'left', true); await api.advance(50); await hold(dir > 0 ? 'right' : 'left', false);
  await api.press(1, 'light', 60);
  await grab(14, 'tailwhip');
  api.log('whip ' + JSON.stringify(await S((t) => ({ starts: window.__KCA.events('attackStart', t).map((e) => e.summary.actor + ':' + e.summary.moveId + '@' + e.tick),
    hits: window.__KCA.events('hit', t).map((e) => e.summary.attacker + ':' + e.summary.moveId + '>' + e.summary.target + '@' + e.tick), dis: window.__KCA.events('dismount', t).map((e) => e.summary.rider + '@' + e.tick) }), t0)));
  await api.advance(300);
  await hold('left', true); await api.advance(150); await hold('left', false);
  await api.press(1, 'heavy', 60);
  await grab(8, 'ram');
  s = await st();
  checks.stillMountedAfterAttacks = s.hero.mounted;
  api.log('after attacks ' + JSON.stringify(s));
  // 4. get knocked off by a big hit (a knockdown swing from the nearest marauder, else a scripted heavy)
  const knocked = await S(() => {
    const g = window.__KCA.game, h = window.__KCA.showcase.hero;
    const e = g.world.query({ team: 'enemies' }).sort((a, b) => Math.abs(a.pos.x - h.pos.x) - Math.abs(b.pos.x - h.pos.x))[0] || null;
    g.combat.applyHit(e, h, { damage: 8, knockdown: true, launch: 5, knockback: 3.5, level: 'heavy', hitstop: 8, shake: 0.3 }, { moveId: 'test_heavy' });
    return !h.mountedOn;
  });
  checks.knockedOffByBigHit = knocked;
  await grab(budget, 'knocked');
  s = await st();
  const ev = await S((t) => ({ mount: window.__KCA.events('mount', t).length, dismount: window.__KCA.events('dismount', t).map((e) => ({ knocked: e.summary.knocked, rider: e.summary.rider, tick: e.tick })),
    beastHits: window.__KCA.events('hit', t).filter((e) => e.summary.moveId && String(e.summary.moveId).startsWith('beast_')).map((e) => e.summary.moveId + '>' + e.summary.target) }), t0);
  checks.beastHitsLanded = ev.beastHits.length;
  const info = await S(() => window.__KCA.info());
  const out = { checks, events: ev, final: s, errors: info.errors, drawCalls: info.drawCalls, triangles: info.triangles };
  fs.writeFileSync(path.join(api.outDir, 'mounts.json'), JSON.stringify(out, null, 2));
  api.log(JSON.stringify(checks));
};
