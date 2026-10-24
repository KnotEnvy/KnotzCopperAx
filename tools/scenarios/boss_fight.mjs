// Boss fight probe (bosses agent). Use with /?mode=showcase&what=boss&id=<id>&scene=fight.
// Steps the fight in 1 s chunks up to BOSS_MAX seconds (default 150), logs boss HP/phase/state + hero damage taken,
// takes frames at BOSS_SHOTS (comma list of seconds, default "2,3.5,5,20,40,60,80,100") and writes boss_fight.json.
// BOSS_GOD=1 (default) keeps the heroes alive so TTK is measurable; damage the heroes WOULD take is still summed.
import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  const MAX = Number(process.env.BOSS_MAX || 150);
  const shots = (process.env.BOSS_SHOTS || '2,3.5,5,20,40,60,80,100').split(',').map(Number);
  const god = process.env.BOSS_GOD !== '0';
  await api.evalGame((g) => {
    const K = window.__KCA;
    window.__bossLog = { dmg: 0, hits: 0, moves: {}, events: [] };
    const L = window.__bossLog;
    K.game.bus.on('hit', (e) => { if (e.target && e.target.kind === 'hero' && e.attacker && (e.attacker.kind === 'boss' || e.attacker.team === 'enemies')) { L.dmg += e.damage || 0; L.hits++; } });
    K.game.bus.on('boss:move', (e) => { L.moves[e.moveId] = (L.moves[e.moveId] || 0) + 1; });
    for (const t of ['bossIntro', 'bossPhase', 'boss:memberDown', 'boss:defeat', 'boss:finaleDone', 'boss:summon', 'boss:rally', 'boss:stolenSpell', 'boss:captivesLowered', 'stageClear']) K.game.bus.on(t, () => L.events.push({ t, s: K.game.tick / 60 }));
    if (g) for (const h of K.showcase.heroes || []) h.godMode = true;
  }, god);
  const log = [];
  let t = 0, si = 0, done = false;
  if (process.env.BOSS_CLIP) {
    const at = Number(process.env.BOSS_CLIP_AT || 0), step = Number(process.env.BOSS_CLIP_STEP || 50), n = Number(process.env.BOSS_CLIP);
    if (at > 0) await api.advance(at * 1000);
    await api.frames(n, step, 'clip'); t = at + n * step / 1000;
  }
  const sampleStats = () => api.evalGame(() => {
    const K = window.__KCA, g = K.game, sh = K.showcase;
    const s = sh.stats ? sh.stats() : {};
    if (g._bossCam && g._bossCam.stats) window.__camStats = g._bossCam.stats;
    const enc = sh.encounter, actors = enc && enc.actors ? enc.actors : (sh.actor ? [sh.actor] : []);
    const live = actors.filter((a) => a && a.alive && !a.removed);
    const lead = live[0] || actors[0] || sh.actor;
    if (!s.state && lead && lead.fsm) s.state = lead.fsm.name;
    if (!s.phase) s.phase = (sh.actor && sh.actor.phase) || (live.length > 0 && live.length < actors.length ? 2 : 1);
    if (actors.length > 1) s.members = actors.map((a) => ({ tier: a.tier || a.typeId, hp: Math.round(Math.max(0, a.hp || 0)), maxHp: a.maxHp || 0, state: a.fsm && a.fsm.name, alive: !!a.alive, x: +(a.pos.x || 0).toFixed(1) }));
    if (lead && lead.pos && g.cameraRig) {
      const W = g.renderer.width, H = g.renderer.height, mt = lead.mountedOn;
      const extra = mt ? (mt.saddleY || 1.2) * (mt.modelScale || 1) : 0;
      const h = (lead.height || 2) + extra, hw = Math.max(lead.radius || 0.4, h * (mt ? 0.34 : 0.28));
      const sb = g.cameraRig.worldToScreen({ x: lead.pos.x, y: lead.pos.y, z: lead.pos.z, clone() { return this; } });
      const st = g.cameraRig.worldToScreen({ x: lead.pos.x, y: lead.pos.y + h, z: lead.pos.z, clone() { return this; } });
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < 8; i++) {
        const p = g.cameraRig.worldToScreen({ x: lead.pos.x + (i & 1 ? hw : -hw), y: lead.pos.y + (i & 2 ? h : 0), z: lead.pos.z + (i & 4 ? 0.3 : -0.3), clone() { return this; } });
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
      }
      s.framing = {
        fx: +(((x0 + x1) / 2) / W).toFixed(3),
        heightPct: +(100 * (sb.y - st.y) / H).toFixed(1),
        box: [Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1)],
        edgeDist: +(Math.min(x0 / W, (W - x1) / W, y0 / H, (H - y1) / H)).toFixed(3),
        inFrame: x0 >= 0 && x1 <= W && y0 >= 0 && y1 <= H ? 1 : 0,
      };
      // heroes in frame (C1 r8): body centre inside the frame (heroIn) and the whole standing box inside (heroBoxIn)
      const hs = (sh.heroes || []).filter((hr) => hr && !hr.removed);
      if (hs.length) {
        let cin = 0, bin = 0;
        for (const hr of hs) {
          const hh = hr.height || 1.8, P = (dx, y) => g.cameraRig.worldToScreen({ x: hr.pos.x + dx, y: hr.pos.y + y, z: hr.pos.z, clone() { return this; } });
          const c = P(0, hh * 0.5); if (c.x >= 0 && c.x <= W && c.y >= 0 && c.y <= H) cin++;
          const a = P(-0.4, 0), b = P(0.4, hh); if (Math.min(a.x, b.x) >= 0 && Math.max(a.x, b.x) <= W && Math.min(a.y, b.y) >= 0 && Math.max(a.y, b.y) <= H) bin++;
        }
        s.framing.heroIn = cin / hs.length; s.framing.heroBoxIn = bin / hs.length;
      }
    }
    const bEl = document.querySelector('.kca-boss');
    s.banner = bEl ? { opacity: +(Number(getComputedStyle(bEl).opacity) || 0).toFixed(2), t: +(Number(bEl.dataset.t) || 0).toFixed(2) } : null;
    return s;
  });
  const evShots = { bossPhase: [1.2, 2.6], 'boss:defeat': [1.0, 3.2, 5.5] };
  const taken = new Set();
  const evCheck = async () => {
    const L = await api.evalGame(() => window.__bossLog.events);
    for (const e of L) for (const d of evShots[e.t] || []) {
      const key = e.t + d;
      if (!taken.has(key) && t >= e.s + d - 0.5) { taken.add(key); await api.shot(`ev_${e.t.replace(':', '_')}_${String(d).replace('.', '_')}`); }
    }
  };
  while (t < MAX && !done) {
    await evCheck();
    const next = si < shots.length && shots[si] - t <= 1 + 1e-6 ? shots[si] : null;
    if (next !== null) {
      if (next > t) await api.advance((next - t) * 1000);
      t = next; si++;
      await api.shot(`t${String(Math.round(t * 10)).padStart(4, '0')}`);
      const s = await sampleStats();
      log.push({ t, ...s });
      if (Math.round(t) % 10 === 0) api.log(`t=${t} hp=${Math.round(s.hp)}/${s.maxHp} phase=${s.phase} state=${s.state} alive=${s.alive} finale=${s.finale}`);
      if (!s.alive && s.finale) done = true;
      continue;
    }
    await api.advance(1000); t += 1;
    const s = await sampleStats();
    log.push({ t, ...s });
    if (Math.round(t) % 10 === 0) api.log(`t=${t} hp=${Math.round(s.hp)}/${s.maxHp} phase=${s.phase} state=${s.state} alive=${s.alive} finale=${s.finale}`);
    if (!s.alive && s.finale) done = true;
  }
  const L = await api.evalGame(() => window.__bossLog);
  const info = await api.evalGame(() => window.__KCA.info());
  const dead = log.find((r) => !r.alive);
  const SK = ['bossWait', 'bossIntro', 'phaseShift', 'enter', 'bossDying', 'dead', 'bones', 'reform'];
  const ST = log.filter((r) => r.state && !SK.includes(r.state));
  const sp = (names) => ST.length ? +(100 * ST.filter((r) => names.includes(r.state)).length / ST.length).toFixed(1) : null;
  const stc = {}; for (const r of ST) stc[r.state] = (stc[r.state] || 0) + 1;
  const FR = log.filter((r) => r.framing && r.alive);
  const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : null; };
  const nearBanner = (sec) => {
    let best = null, bd = 999;
    for (const r of log) { const d = Math.abs(r.t - sec); if (d < bd) { bd = d; best = r; } }
    return best ? best.banner : null;
  };
  const summary = {
    groundedPct: sp(['knockdown', 'down', 'getup']),
    stunnedPct: sp(['hitstun', 'block', 'grabbed', 'thrown', 'stagger']),
    attackPct: sp(['attack', 'clinch']),
    threatPct: sp(['attack', 'clinch', 'walk', 'idle', 'pause']),
    states: stc,
    heightPctMin: FR.length ? Math.min(...FR.map((r) => r.framing.heightPct)) : null,
    heightPctMed: med(FR.map((r) => r.framing.heightPct)),
    pctHeightGe25: FR.length ? +(100 * FR.filter((r) => r.framing.heightPct >= 25).length / FR.length).toFixed(1) : null,
    pctBoxInFrame: FR.length ? +(100 * FR.filter((r) => r.framing.inFrame).length / FR.length).toFixed(1) : null,
    edgeDistMin: FR.length ? Math.min(...FR.map((r) => r.framing.edgeDist)) : null,
    edgeDistMed: med(FR.map((r) => r.framing.edgeDist)),
    pctHeroesInFrame: FR.some((r) => r.framing.heroIn !== undefined) ? +(100 * FR.reduce((q, r) => q + (r.framing.heroIn ?? 1), 0) / FR.length).toFixed(1) : null,
    pctHeroBoxInFrame: FR.some((r) => r.framing.heroBoxIn !== undefined) ? +(100 * FR.reduce((q, r) => q + (r.framing.heroBoxIn ?? 1), 0) / FR.length).toFixed(1) : null,
    bannerAt: { t5: nearBanner(5), t15: nearBanner(15), t30: nearBanner(30) },
    camWalls: await api.evalGame(() => { const c = window.__camStats; return c ? { pushes: c.pushes, pushM: +c.pushM.toFixed(2), maxStep: +c.maxStep.toFixed(3) } : null; }),
  };
  const out = { ttk: dead ? dead.t : null, max: MAX, heroDamagePerMin: L.dmg / (t / 60), heroHits: L.hits, moves: L.moves, events: L.events, summary, drawCalls: info.drawCalls, triangles: info.triangles, errors: info.errors, log };
  fs.writeFileSync(path.join(api.outDir, 'boss_fight.json'), JSON.stringify(out, null, 1));
  api.log(`TTK ${out.ttk}s · hero dmg/min ${out.heroDamagePerMin.toFixed(1)} · moves ${JSON.stringify(L.moves)} · summary ${JSON.stringify(summary)}`);
};
