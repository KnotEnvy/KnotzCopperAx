// AI depth-spread audit (enemies-ai r8): do crowd fights use the whole walkable depth, or collapse onto ONE screen row?
// Samples every AI_EVERY ticks (default 20) the projected FEET row (screen y in px of the 1600x900 viewport) of every
// standing, on-screen, non-boss foe and hero, then reports how far the feet rows are spread apart.
//   node tools/capture.mjs --url "/?mode=showcase&what=ai&id=crowd" --scenario tools/scenarios/ai_depth.mjs --out <dir>
// Env: AI_SECONDS (default 40), AI_EVERY, AI_FLAGS='{json}' (director A/B hooks), AI_SEED (seeded respawns), AI_NOSHOT=1
// Writes ai_depth.json:
//   samples          samples with >= 4 standing foes on screen
//   spreadPx         mean / p10 / min of (max feet y - min feet y) over the foes (px)
//   rows             mean number of distinct feet rows (foes clustered when < ROW_PX apart)
//   oneRow           fraction of samples where ALL foes' feet lie within 60 px (a single-file conga line)
//   spread150        fraction of samples with spreadPx >= 150 (three readable depth bands)
//   zSpread          mean world z spread (m); frontBack = mean of (max z - min z) among the foes
//   heroRow          mean number of foes standing in the hero's own row (|dy| < 40 px) -> attackers
//   fused            fraction of samples where two foes overlap on screen (|dx| < 0.8 m projected AND |dy| < 55 px)
//   waiters (c1r9)   every sample, every standing non-entering foe that is NOT attacking / holding a token (a waiter): its
//                    screen x (px of the 1600 px viewport). out = fraction of waiter samples outside the frame (feet x < 0
//                    or > W), edge = fraction within 60 px of an edge, minPx / maxPx, perHero = rows per hero (co-op)
export default async (api) => {
  const secs = Number(process.env.AI_SECONDS || 40);
  const every = Number(process.env.AI_EVERY || 20);
  const E = (fn, arg) => api.evalGame(fn, arg);
  if (process.env.AI_FLAGS) await E((f) => Object.assign(window.__KCA.game.ai.director, f), JSON.parse(process.env.AI_FLAGS));
  await E((cfg) => {
    const k = window.__KCA, g = k.game;
    k.debug.god(true);
    const S = (window.__DEPTH = { seed: cfg.seed, n: 0, spread: [], rows: [], oneRow: 0, spread150: 0, zs: [], heroRow: [], fused: 0, last: [] });
    const cam = () => g.cameraRig && g.cameraRig.camera;
    const STAND = (e) => e.alive && !e.removed && e.pos.y < 0.5 && !(e.fsm && e.fsm.is('thrown', 'grabbed', 'clinch', 'bones', 'rise', 'dead', 'enter'));
    const sample = () => {
      if (g.tick % cfg.every) return;
      const c = cam(); if (!c) return;
      const W = window.innerWidth, H = window.innerHeight;
      const V = c.position.constructor;
      const proj = (x, z) => { const v = new V(x, 0, z).project(c); return { px: (v.x + 1) / 2 * W, py: (1 - v.y) / 2 * 900, on: v.z < 1 && Math.abs(v.x) < 0.98 }; }; // py normalised to a 900 px tall viewport
      const foes = g.world.query({ team: 'enemies' }).filter((e) => e.kind !== 'boss' && e.typeId !== 'thief' && STAND(e)).map((e) => ({ e, p: proj(e.pos.x, e.pos.z) })).filter((o) => o.p.on && o.p.py > 0 && o.p.py < 900);
      { // c1r9 waiter screen x (all standing waiters, on-screen or not; entering foes excluded)
        const tk = g.ai && g.ai.tokens;
        for (const e of g.world.query({ team: 'enemies' })) {
          if (e.kind === 'boss' || e.typeId === 'thief' || !STAND(e) || !e.brain || (tk && tk.has(e)) || (e.fsm && e.fsm.is('attack', 'hitstun', 'knockdown', 'down', 'getup'))) continue;
          if (e.brain.mode === 'attack') continue;
          const seen = (S.seen = S.seen || {}); if (seen[e.id] == null) seen[e.id] = g.tick; if (g.tick - seen[e.id] < 180) continue; // fresh (re)spawns walking in don't count as parked off-frame
          const v = new V(e.pos.x, 0, e.pos.z).project(c), px = (v.x + 1) / 2 * 1600;
          const Wt = (S.wait = S.wait || { n: 0, out: 0, edge: 0, min: Infinity, max: -Infinity, offIds: {} });
          Wt.n++; if ((px < 0 || px > 1600) && !(e.vel && Math.hypot(e.vel.x, e.vel.z) > 0.3)) Wt.parked = (Wt.parked || 0) + 1; if (px < 0 || px > 1600) { Wt.out++; const sl = e.aiSlot, h = e.aiTarget, vr = g.cameraRig.visibleRange ? g.cameraRig.visibleRange(sl && sl.z != null ? sl.z : e.pos.z) : null;
            const gx = h && sl && sl.x != null ? h.pos.x + sl.side * sl.x : null, why = g.tick - (e.aiHold ?? -99) < 6 ? 'hold' : gx != null && vr && (gx < vr.xMin || gx > vr.xMax) ? 'goalOff' : 'walk';
            const k = why + '/' + e.brain.mode; Wt.offIds[k] = (Wt.offIds[k] || 0) + 1; if ((Wt.ex = Wt.ex || []).length < 30 && g.tick % 60 === 0) Wt.ex.push([g.tick, e.typeId[0] + e.id, e.fsm.name, Math.round(px), +e.pos.x.toFixed(1), +e.pos.z.toFixed(1), gx != null ? +gx.toFixed(1) : null, sl && sl.z != null ? +sl.z.toFixed(1) : null, vr ? [+vr.xMin.toFixed(1), +vr.xMax.toFixed(1)] : null, h ? +h.pos.x.toFixed(1) : null, e.vel ? +Math.hypot(e.vel.x, e.vel.z).toFixed(2) : null]); if (vr) Wt.vw = +(vr.xMax - vr.xMin).toFixed(1); } if (px < 60 || px > 1540) Wt.edge++;
          Wt.min = Math.min(Wt.min, px); Wt.max = Math.max(Wt.max, px);
        }
      }
      if (foes.length < 4) return;
      const ys = foes.map((o) => o.p.py), zs = foes.map((o) => o.e.pos.z);
      const spread = Math.max(...ys) - Math.min(...ys);
      const sorted = ys.slice().sort((a, b) => a - b);
      let rows = 1; for (let i = 1; i < sorted.length; i++) if (sorted[i] - sorted[i - 1] >= 45) rows++;
      const hero = g.world.query({ kind: 'hero' })[0];
      const hp = hero ? proj(hero.pos.x, hero.pos.z) : null;
      const inHeroRow = hp ? foes.filter((o) => Math.abs(o.p.py - hp.py) < 40).length : 0;
      let fused = false;
      const D = g.ai && g.ai.director, SX = (e) => (D && D.sx ? D.sx(e.pos.x, e.pos.z) : e.pos.x);
      const tag = (e) => e.fsm.name + '/' + (e.brain && e.brain.mode) + (g.ai.tokens && g.ai.tokens.has(e) ? 'T' : '');
      for (let i = 0; i < foes.length && !fused; i++) for (let j = i + 1; j < foes.length; j++) if (Math.abs(SX(foes[i].e) - SX(foes[j].e)) < 0.8 && Math.abs(foes[i].p.py - foes[j].p.py) < 55) { fused = true; const k = [tag(foes[i].e), tag(foes[j].e)].sort().join(' + '); (S.fusedCause = S.fusedCause || {})[k] = (S.fusedCause[k] || 0) + 1; if ((S.fDet = S.fDet || []).length < 60) { const dd = (e) => [e.id, tag(e), +SX(e).toFixed(2), +e.pos.z.toFixed(1), e.aiCrossing ? 'X' : '', e.aiOutF ? 'O' : '', e.aiFreeT != null ? g.tick - e.aiFreeT : null, e.aiFreeEsc ? 'esc' : '', e.aiCell ? e.aiCell.slice(0, 5).map((v) => (Number.isFinite(v) ? +v.toFixed(2) : null)) : null, e.aiWhy || '']; S.fDet.push([g.tick, dd(foes[i].e), dd(foes[j].e), g.world.query({ kind: 'hero' }).map((h) => ['H' + h.id, +SX(h).toFixed(2), +h.pos.z.toFixed(1), h.fsm.name]), foes.filter((o) => o.e !== foes[i].e && o.e !== foes[j].e).map((o) => [o.e.id, tag(o.e), +SX(o.e).toFixed(2), +o.e.pos.z.toFixed(1)]), (g.world.query({ team: 'enemies' }).filter((e) => !foes.some((o) => o.e === e)).map((e) => [e.id, e.fsm.name, +SX(e).toFixed(2), +e.pos.z.toFixed(1)]))]); } break; }
      S.n++; (S.series = S.series || []).push([g.tick, Math.round(spread), foes.length, hero ? +hero.pos.z.toFixed(1) : null, rows]); S.spread.push(spread); S.rows.push(rows); S.zs.push(Math.max(...zs) - Math.min(...zs)); S.heroRow.push(inHeroRow);
      { const hs = g.world.query({ kind: 'hero' });
        if (hs.length > 1) for (const h of hs) { const ys2 = foes.filter((o) => o.e.aiTarget === h).map((o) => o.p.py).sort((a, b) => a - b); if (ys2.length < 2) continue; let r = 1; for (let i = 1; i < ys2.length; i++) if (ys2[i] - ys2[i - 1] >= 45) r++; (S.hrows = S.hrows || []).push(r); (S.hspread = S.hspread || []).push(ys2[ys2.length - 1] - ys2[0]); } }
      { // c1r9 row discipline: waiters (circle, standing) vs their slot row z; free-row geometry vs the heroes' rows
        const A = (S.adh = S.adh || { n: 0, on: 0, sum: 0, gap: [], kinds: {} });
        for (const o of foes) { const e = o.e, sl = e.aiSlot, h = e.aiTarget; if (!e.brain || e.brain.mode !== 'circle' || !sl || !h || !(e.fsm && e.fsm.is('idle', 'walk'))) continue; const rz = sl.z ?? h.pos.z + (sl.dz || 0); const dd = Math.abs(e.pos.z - rz); A.n++; A.sum += dd; if (dd < 0.5) A.on++; else { const sp = e.vel ? Math.hypot(e.vel.x, e.vel.z) : 0; const why = g.tick - (e.aiHold ?? -99) < 6 ? 'hold' : e.aiCrossing ? 'cross' : sp > 0.3 ? 'walking' : 'parked'; (A.why = A.why || {})[why] = (A.why[why] || 0) + 1; if (why === 'parked' && (A.pk = A.pk || []).length < 12 && g.tick % 40 === 0) A.pk.push([g.tick, e.typeId[0] + e.id, sl.row, +rz.toFixed(1), +e.pos.z.toFixed(1), +e.pos.x.toFixed(1), +h.pos.x.toFixed(1), e.fsm.name, e.brain.cooldown]); } A.kinds[sl.row] = (A.kinds[sl.row] || 0) + 1; }
        const fr = D && D._free, hz = g.world.query({ kind: 'hero' }).map((x) => x.pos.z);
        if (fr) A.gap.push(Math.min(...[fr.a, fr.b].map((r) => Math.min(...hz.map((z) => Math.abs(z - r))))));
      }
      { const cm = (S.comp2 = S.comp2 || { att: 0, wait: 0, n: 0 }); cm.n++; for (const o of foes) { if (o.e.brain && o.e.brain.mode === 'attack') cm.att++; else cm.wait++; } }
      if (spread < 60) S.oneRow++;
      if (spread >= 150) S.spread150++;
      if (fused) S.fused++;
      { // c1r10 fusedUp: the same test over STANDING foes only (a foe lying on the floor under a standing one excluded)
        const up = foes.filter((o) => !o.e.fsm.is('down', 'knockdown', 'getup'));
        let fu = false; for (let i = 0; i < up.length && !fu; i++) for (let j = i + 1; j < up.length; j++) if (Math.abs(SX(up[i].e) - SX(up[j].e)) < 0.8 && Math.abs(up[i].p.py - up[j].p.py) < 55) { fu = true; break; }
        if (fu) S.fusedUp = (S.fusedUp || 0) + 1;
      }
      if (S.last.length >= 8) S.last.shift();
      S.last.push({ t: g.tick, heroes: g.world.query({ kind: 'hero' }).map((x) => [x.id, +x.pos.x.toFixed(1), +x.pos.z.toFixed(1), D && D._rowSt && D._rowSt.get(x.id) ? D._rowSt.get(x.id).mode : null]), hero: hero ? [+hero.pos.x.toFixed(1), +hero.pos.z.toFixed(1), Math.round(hp.py)] : null, rows: hero && D && D._rowSt && D._rowSt.get(hero.id) ? [D._rowSt.get(hero.id).mode, +D._rowSt.get(hero.id).a.toFixed(2), +D._rowSt.get(hero.id).b.toFixed(2)] : null, foes: foes.map((o) => [o.e.typeId[0] + o.e.id, o.e.brain && o.e.brain.mode, +o.e.pos.x.toFixed(1), +o.e.pos.z.toFixed(1), Math.round(o.p.py), o.e.aiSlot ? o.e.aiSlot.row + ':' + (o.e.aiSlot.dz != null ? o.e.aiSlot.dz.toFixed(1) : '?') : '-', o.e.fsm && o.e.fsm.name]) });
      if (g.tick % 100 === 0 && (S.snaps = S.snaps || []).length < 40) S.snaps.push(S.last[S.last.length - 1]);
    };
    const sys = { name: 'depth-probe', order: 99, update: sample };
    if (g.addSystem) g.addSystem(sys); else if (g.systems) g.systems.push(sys);
  }, { every, seed: Number(process.env.AI_SEED || 12345) });
  for (let s = 0; s < secs; s += 2) {
    await api.advance(2000);
    if (s % 20 === 0 && !process.env.AI_NOSHOT) { try { await api.frames(1, 16, 'dpt'); } catch (err) { api.log('frame skipped: ' + String(err.message).slice(0, 120)); } }
    await E(() => { // keep the crowd topped up (seeded, same as ai_spacing)
      const k = window.__KCA, g = k.game, S = window.__DEPTH;
      if (!S.comp) S.comp = g.world.query({ team: 'enemies' }).map((e) => e.typeId).filter((t) => t !== 'thief');
      const R = () => ((S.rs = ((S.rs ?? Number(S.seed || 12345)) * 1103515245 + 12345) >>> 0) / 4294967296);
      const alive = g.world.query({ team: 'enemies' }).map((e) => e.typeId);
      for (const c of S.comp) { const i = alive.indexOf(c); if (i >= 0) { alive.splice(i, 1); continue; } const h = g.world.query({ kind: 'hero' })[0]; k.debug.spawn(c, (h ? h.pos.x : 0) + (R() < 0.5 ? -7 : 7), (R() - 0.5) * 2, {}); }
    });
  }
  const out = await E(() => {
    const S = window.__DEPTH, avg = (a) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : null);
    const sorted = S.spread.slice().sort((a, b) => a - b);
    return { samples: S.n, spreadPx: { mean: avg(S.spread), p10: sorted.length ? Math.round(sorted[Math.floor(sorted.length * 0.1)]) : null, min: sorted.length ? Math.round(sorted[0]) : null, max: sorted.length ? Math.round(sorted[sorted.length - 1]) : null },
      rows: avg(S.rows), oneRow: S.n ? +(S.oneRow / S.n).toFixed(3) : null, spread150: S.n ? +(S.spread150 / S.n).toFixed(3) : null, zSpread: avg(S.zs), heroRow: avg(S.heroRow), fused: S.n ? +(S.fused / S.n).toFixed(3) : null, fusedUp: S.n ? +((S.fusedUp || 0) / S.n).toFixed(3) : null,
      fDet: S.fDet || [], snaps: S.snaps || [], fusedCause: S.fusedCause || {}, perHero: S.hrows ? { rows: avg(S.hrows), spreadPx: avg(S.hspread) } : null,
      rowAdh: S.adh ? { n: S.adh.n, onRow: +(S.adh.on / Math.max(1, S.adh.n)).toFixed(3), meanOff: +(S.adh.sum / Math.max(1, S.adh.n)).toFixed(2), slotRows: S.adh.kinds, offWhy: S.adh.why, parked: S.adh.pk, rowHeroGap: avg(S.adh.gap), rowHeroGapLt15: S.adh.gap.length ? +(S.adh.gap.filter((x) => x < 1.5).length / S.adh.gap.length).toFixed(3) : null } : null,
      onScreen: S.comp2 ? { attackers: +(S.comp2.att / S.comp2.n).toFixed(2), waiters: +(S.comp2.wait / S.comp2.n).toFixed(2) } : null,
      waiters: S.wait ? { n: S.wait.n, out: +(S.wait.out / S.wait.n).toFixed(3), parkedOut: +((S.wait.parked || 0) / S.wait.n).toFixed(3), edge: +(S.wait.edge / S.wait.n).toFixed(3), minPx: Math.round(S.wait.min), maxPx: Math.round(S.wait.max), offIds: S.wait.offIds, ex: S.wait.ex, viewW: S.wait.vw } : null, series: S.series, last: S.last, errors: window.__KCA.info().errors.slice(-4) };
  });
  api.log('DEPTH ' + JSON.stringify({ ...out, last: undefined, series: undefined }));
  const fs = await import('node:fs'), path = await import('node:path');
  fs.writeFileSync(path.join(api.outDir, 'ai_depth.json'), JSON.stringify(out, null, 2));
};
