// AI contact-spacing audit (enemies-ai r4): bot heroes vs an AI showcase crowd, sampling every contact frame
// (a hit between a hero and an enemy) for crowd spacing.
//   node tools/capture.mjs --url "/?mode=showcase&what=ai&id=crowd" --scenario tools/scenarios/ai_spacing.mjs --out <dir>
// Env: AI_SECONDS (default 30). Writes ai_spacing.json:
//   contacts            contact frames sampled
//   minPair             closest two grounded, standing foes near the hero on any contact frame (m, euclidean x/z)
//   under1              contact frames with a pair < 1.0 m
//   engaged3            contact frames with ≥ 3 foes engaged (within 3.2 m x / 1.4 m z of that hero, standing)
//   bothSides3          …of those, frames with foes on BOTH sides of the hero
//   maxTargetsPerSwing  most distinct foes one hero attack run hit; swingHist = histogram
//   SCREEN-X (r5, side camera: depth-stacked bodies merge into one blob):
//   pairX08            contact frames with two near foes < 0.8 m apart in x (any depth)
//   heroX06            contact frames with a foe < 0.6 m in x from the hero (any depth)
//   minPairX           smallest x gap between two near foes on any contact frame; worstX = samples
//   PROJECTED (r6, director.sx = perspective-true screen x; this is what the player sees overlap):
//   pairS08 / pairS06  contact frames with two near foes < 0.8 / 0.6 m apart on screen; minPairS; sCause; worstS
//   waitInfeasible     contact frames where the director could not pack every waiting lane ≥ GAP apart
// Env: AI_SEED (seeded respawns, default 12345: runs are repeatable), AI_FLAGS='{json}' (director A/B hooks),
//   AI_R6OFF=1 (no clear-path gate, 1.6 m wait ring), AI_NOSHOT=1 (skip screenshots)
export default async (api) => {
  const secs = Number(process.env.AI_SECONDS || 30);
  const E = (fn, arg) => api.evalGame(fn, arg);
  if (process.env.AI_FLAGS) await E((f) => Object.assign(window.__KCA.game.ai.director, f), JSON.parse(process.env.AI_FLAGS)); // A/B director hooks
  if (process.env.AI_R6OFF) await E(() => { const d = window.__KCA.game.ai.director; d.noPathGate = true; d.waitX = 1.6; }); // A/B the r6 clear-path gate + strike-column wait ring
  if (process.env.AI_NOHANDOVER) await E(() => { window.__KCA.game.ai.director.noHandover = true; }); // A/B the r5 front-row hand-over
  await E((SEED) => {
    const k = window.__KCA, g = k.game;
    k.debug.god(true);
    const S = (window.__SPACING = { seed: SEED, contacts: 0, minPair: 99, pairX08: 0, heroX06: 0, minPairX: 99, worstX: [], under1: 0, engaged3: 0, bothSides3: 0, swings: new Map(), worst: [] });
    const STAND = (e) => e.alive && !e.removed && e.pos.y < 0.5 && !(e.fsm && e.fsm.is('thrown', 'grabbed', 'clinch', 'bones', 'rise', 'down', 'knockdown', 'getup', 'dead'));
    let lastTick = -1;
    g.bus.on('hit', (ev) => {
      const a = ev.attacker, t = ev.target;
      if (!a || !t) return;
      const hero = a.kind === 'hero' ? a : t.kind === 'hero' ? t : null;
      const foe = hero === a ? t : a;
      if (!hero || !foe || foe.team !== 'enemies') return;
      if (a.kind === 'hero' && a.attack) {
        let set = S.swings.get(a.attack); if (!set) S.swings.set(a.attack, (set = new Set()));
        set.add(t.id);
      }
      if (g.tick === lastTick) return;
      lastTick = g.tick;
      S.contacts++;
      const near = g.world.query({ team: 'enemies' }).filter((e) => e.kind !== 'boss' && STAND(e) && Math.abs(e.pos.x - hero.pos.x) < 4 && Math.abs(e.pos.z - hero.pos.z) < 2);
      let m = 99;
      for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) m = Math.min(m, Math.hypot(near[i].pos.x - near[j].pos.x, near[i].pos.z - near[j].pos.z));
      if (m < S.minPair) S.minPair = m;
      let mx = 99;
      for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) mx = Math.min(mx, Math.abs(near[i].pos.x - near[j].pos.x));
      if (mx < S.minPairX) S.minPairX = mx;
      // cause histogram: states of every pair closer than 0.8 m in x (fsm/brain mode, X = crossing), with depth gap
      for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) {
        const A = near[i], B = near[j];
        if (Math.abs(A.pos.x - B.pos.x) >= 0.8) continue;
        const tag = (e) => e.fsm.name + '/' + (e.brain && e.brain.mode) + (e.aiCrossing ? 'X' : '');
        const k = [tag(A), tag(B)].sort().join(' + ') + (Math.abs(A.pos.z - B.pos.z) < 0.6 ? ' ~z' : ' dz');
        (S.xCause = S.xCause || {})[k] = (S.xCause[k] || 0) + 1;
      }
      for (const e of near) if (Math.abs(e.pos.x - hero.pos.x) < 0.6) { const k = e.fsm.name + '/' + (e.brain && e.brain.mode) + (e.aiCrossing ? 'X' : ''); (S.hCause = S.hCause || {})[k] = (S.hCause[k] || 0) + 1; }
      const hx = near.some((e) => Math.abs(e.pos.x - hero.pos.x) < 0.6);
      if (hx) S.heroX06++;
      if (mx < 0.8) S.pairX08++;
      if (mx < 0.6) S.pairX06 = (S.pairX06 || 0) + 1;
      // r6: perspective-true screen x (director.sx) — what the player actually sees overlap
      const D = g.ai.director, SX = (e) => (D && D.sx ? D.sx(e.pos.x, e.pos.z) : e.pos.x);
      let ms = 99;
      for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) {
        const d = Math.abs(SX(near[i]) - SX(near[j]));
        if (d < ms) ms = d;
        if (d < 0.8) { // c1r10 category: A attacker (token / swing), R reeling (hitstun/block/knockback), W waiter (s = standing, m = moving, x = crossing its hero), E entering; ok = the waiter's own goal is clear of the other body
          const cat = (e) => { const tkn = g.ai.tokens && g.ai.tokens.has(e); if (e.fsm.is('enter')) return 'E'; if (e.fsm.is('hitstun', 'block', 'knockdown')) return 'R'; if (tkn || e.fsm.is('attack') || (e.brain && e.brain.mode === 'attack')) return 'A'; const mv = e.vel && Math.hypot(e.vel.x, e.vel.z) > 0.3; return 'W' + (e.aiCrossing ? 'x' : mv ? 'm' : 's'); };
          const k2 = [cat(near[i]), cat(near[j])].sort().join('+'); (S.pCat = S.pCat || {})[k2] = (S.pCat[k2] || 0) + 1;
          if (d < 0.6) (S.pCat06 = S.pCat06 || {})[k2] = (S.pCat06[k2] || 0) + 1;
          if ((S.pDet = S.pDet || []).length < 40) { // detail: [cat, sx rel contact hero, z, target hero id, goal sx rel its hero, slot src, fsm, aiWhy]
            const det = (e) => { const sl = e.aiSlot, h = e.aiTarget; return [cat(e), +(SX(e) - SX(hero)).toFixed(2), +e.pos.z.toFixed(1), h && h.id, sl && sl.x != null && h ? +(D.sx(h.pos.x + sl.side * sl.x, sl.z ?? h.pos.z + (sl.dz || 0)) - SX(h)).toFixed(2) : null, sl && sl.src, e.fsm.name, e.aiWhy || '']; };
            S.pDet.push([g.tick, hero.id, +d.toFixed(2), det(near[i]), det(near[j])]);
          }
        }
        if (d < 0.8) { const tag = (e) => e.fsm.name + '/' + (e.brain && e.brain.mode) + (g.ai.tokens && g.ai.tokens.has(e) ? 'T' : ''); const k = [tag(near[i]), tag(near[j])].sort().join(' + ') + (Math.abs(near[i].pos.z - near[j].pos.z) < 0.6 ? ' ~z' : ' dz'); (S.sCause = S.sCause || {})[k] = (S.sCause[k] || 0) + 1; }
      }
      if (ms < (S.minPairS ?? 99)) S.minPairS = ms;
      if (ms < 0.8) { S.pairS08 = (S.pairS08 || 0) + 1; if ((S.worstS = S.worstS || []).length < 10) S.worstS.push({ tick: g.tick, ds: +ms.toFixed(2), hero: [hero.id, +hero.pos.x.toFixed(2), +hero.pos.z.toFixed(2)], heroes: g.world.query({ kind: 'hero' }).map((h) => [h.id, +h.pos.x.toFixed(1), h.fsm && h.fsm.name]), foes: near.map((e) => [e.typeId, e.fsm.name, e.brain && e.brain.mode, +e.pos.x.toFixed(2), +e.pos.z.toFixed(2), +SX(e).toFixed(2), g.ai.tokens && g.ai.tokens.has(e) ? 'T' : '', e.aiSlot && e.aiSlot.x != null && e.aiTarget ? 'g' + (D.sx(e.aiTarget.pos.x + e.aiSlot.side * e.aiSlot.x, e.aiTarget.pos.z + e.aiSlot.dz)).toFixed(2) + '@h' + e.aiTarget.id : null]) }); }
      if (ms < 0.6) S.pairS06 = (S.pairS06 || 0) + 1;
      if (D && D.stats && D.stats.waitGap < 0.9) S.waitInfeasible = (S.waitInfeasible || 0) + 1; // r6: director's own wait-goal packing failed
      if ((mx < 0.8 || hx) && S.worstX.length < 8) S.worstX.push({ tick: g.tick, dx: +mx.toFixed(2), hero: [+hero.pos.x.toFixed(2), +hero.pos.z.toFixed(2)], foes: near.map((e) => [e.typeId, e.fsm.name, e.brain && e.brain.mode, +e.pos.x.toFixed(2), +e.pos.z.toFixed(2), e.aiCrossing ? 'X' : '']) });
      if (m < 1.0) { S.under1++; if (S.worst.length < 6) S.worst.push({ tick: g.tick, d: +m.toFixed(2), foes: near.map((e) => [e.typeId, e.fsm.name, +e.pos.x.toFixed(2), +e.pos.z.toFixed(2)]) }); }
      const eng = near.filter((e) => (!e.aiTarget || e.aiTarget === hero) && Math.abs(e.pos.x - hero.pos.x) < 3.2 && Math.abs(e.pos.z - hero.pos.z) < 1.4);
      if (eng.length >= 3) {
        S.engaged3++;
        const l = eng.some((e) => e.pos.x < hero.pos.x - 0.2), r = eng.some((e) => e.pos.x > hero.pos.x + 0.2);
        if (l && r) S.bothSides3++;
        else if ((S.oneSide = S.oneSide || []).push({ tick: g.tick, hero: [hero.id, +hero.pos.x.toFixed(2), +hero.pos.z.toFixed(2)], heroes: g.world.query({ kind: 'hero' }).map((h) => [h.id, +h.pos.x.toFixed(1), +h.pos.z.toFixed(1)]), foes: g.world.query({ team: 'enemies' }).map((e) => [e.typeId, e.fsm.name, e.brain && e.brain.mode, +e.pos.x.toFixed(1), +e.pos.z.toFixed(1), e.aiTarget && e.aiTarget.id, g.ai.tokens.has(e) ? "T" : "", e.aiSlot && e.aiSlot.side]) }) > 4) S.oneSide.shift();
      }
    });
    // c1r10 onset attribution (every tick): a near-hero pair becoming fused (< 0.8 m on screen) — who moved into whom.
    // mover = the body whose screen x changed more over the last 8 ticks; key = mover category > other category.
    const hist = new Map(), live = new Map();
    const catT = (e) => { const tkn = g.ai.tokens && g.ai.tokens.has(e); if (e.fsm.is('enter')) return 'E'; if (e.fsm.is('hitstun', 'block', 'knockdown')) return 'R'; if (e.fsm.is('attack')) return 'S'; if (tkn || (e.brain && e.brain.mode === 'attack')) return 'A'; if (e.brain && e.brain.mode === 'retreat') return 'T'; return 'W' + (e.aiCrossing ? 'x' : '') + (e.aiFreeEsc ? 'e' : ''); };
    const sys = { name: 'spacing-onset', order: 99, update: () => {
      const D = g.ai.director; if (!D || !D.sx) return;
      const foes = g.world.query({ team: 'enemies' }).filter((e) => e.kind !== 'boss' && STAND(e));
      for (const e of foes) { const h = hist.get(e.id) || []; h.push(D.sx(e.pos.x, e.pos.z)); if (h.length > 9) h.shift(); hist.set(e.id, h); }
      const seen = new Set();
      for (const hero of g.world.query({ kind: 'hero' })) {
        const near = foes.filter((e) => Math.abs(e.pos.x - hero.pos.x) < 4 && Math.abs(e.pos.z - hero.pos.z) < 2);
        for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) {
          const A = near[i], B = near[j], k = Math.min(A.id, B.id) + ':' + Math.max(A.id, B.id);
          if (seen.has(k)) continue;
          const d = Math.abs(D.sx(A.pos.x, A.pos.z) - D.sx(B.pos.x, B.pos.z));
          if (d >= 0.8) continue;
          seen.add(k);
          const O = (S.onset = S.onset || { ep: {}, ticks: {} });
          if (!live.has(k)) {
            const mv = (e) => { const h = hist.get(e.id) || [0]; return Math.abs(h[h.length - 1] - h[0]); };
            const [m, o] = mv(A) >= mv(B) ? [A, B] : [B, A];
            const key = catT(m) + '>' + catT(o);
            live.set(k, key); O.ep[key] = (O.ep[key] || 0) + 1;
            if (key.startsWith('We>We') && (O.snap = O.snap || []).length < 30) { const hs0 = D.sx(hero.pos.x, hero.pos.z); O.snap.push({ t: g.tick, key, m: m.id, o: o.id, heroes: g.world.query({ kind: 'hero' }).map((h) => [h.id, +(D.sx(h.pos.x, h.pos.z) - hs0).toFixed(2), +h.pos.z.toFixed(1), h.fsm.name, +(h.vel ? h.vel.x : 0).toFixed(1)]), foes: foes.filter((e) => Math.abs(e.pos.x - hero.pos.x) < 6).map((e) => { const sl = e.aiSlot, h = e.aiTarget; const hh = hist.get(e.id) || [0]; return [e.id, catT(e), +(D.sx(e.pos.x, e.pos.z) - hs0).toFixed(2), +e.pos.z.toFixed(1), +(hh[hh.length - 1] - hh[0]).toFixed(2), h && h.id, sl && sl.x != null && h ? +(D.sx(h.pos.x + sl.side * sl.x, sl.z ?? h.pos.z + (sl.dz || 0)) - hs0).toFixed(2) : null, e.fsm.name, e.aiWhy || '', e.aiCell ? e.aiCell.map((v) => (Number.isFinite(v) ? +(v - hs0).toFixed(2) : null)) : null, +(e.vel ? e.vel.x : 0).toFixed(2)]; }) }); }
          }
          const key = live.get(k); O.ticks[key] = (O.ticks[key] || 0) + 1;
        }
      }
      for (const k of [...live.keys()]) if (!seen.has(k)) live.delete(k);
      if (g.tick % 10 === 0) { const hs = g.world.query({ kind: 'hero' }); const vr = g.cameraRig && g.cameraRig.visibleRange ? g.cameraRig.visibleRange(0) : null; const on = vr ? foes.filter((e) => e.pos.x > vr.xMin && e.pos.x < vr.xMax).length : 0; const Q = (S.geo = S.geo || { n: 0, sep: [0, 0, 0, 0, 0], on: {}, w: 0 }); Q.n++; if (hs.length > 1) { const sp = Math.abs(hs[0].pos.x - hs[1].pos.x); Q.sep[Math.min(4, Math.floor(sp / 3))]++; } Q.on[on] = (Q.on[on] || 0) + 1; if (vr) Q.w = vr.xMax - vr.xMin; }
    } };
    if (g.addSystem) g.addSystem(sys); else if (g.systems) g.systems.push(sys);
  }, Number(process.env.AI_SEED || 12345));
  for (let s = 0; s < secs; s += 2) {
    await api.advance(2000);
    if (s % 20 === 0 && !process.env.AI_NOSHOT) { try { await api.frames(1, 16, 'spc'); } catch (err) { api.log('frame skipped: ' + String(err.message).slice(0, 120)); } }
    // keep the crowd topped up (same as ai_balance): respawn KO'd foes off to a side
    await E(() => {
      const k = window.__KCA, g = k.game;
      const n = g.world.query({ team: 'enemies' }).length;
      if (!window.__SPACING.comp) window.__SPACING.comp = g.world.query({ team: 'enemies' }).map((e) => e.typeId).filter((t) => t !== 'thief');
      const R = () => ((window.__SPACING.rs = ((window.__SPACING.rs ?? Number(window.__SPACING.seed || 12345)) * 1103515245 + 12345) >>> 0) / 4294967296); // r6: seeded respawns (A/B noise)
      const comp = window.__SPACING.comp, alive = g.world.query({ team: 'enemies' }).map((e) => e.typeId);
      for (const c of comp) { const i = alive.indexOf(c); if (i >= 0) { alive.splice(i, 1); continue; } const h = g.world.query({ kind: 'hero' })[0]; k.debug.spawn(c, (h ? h.pos.x : 0) + (R() < 0.5 ? -7 : 7), (R() - 0.5) * 2, {}); }
      return n;
    });
  }
  const out = await E(() => {
    const S = window.__SPACING, hist = {};
    let mx = 0;
    for (const set of S.swings.values()) { hist[set.size] = (hist[set.size] || 0) + 1; mx = Math.max(mx, set.size); }
    const d = window.__KCA.game.ai.director.stats;
    return { geo: S.geo || null, onset: S.onset || null, pDet: S.pDet || [], dstats: Object.fromEntries(Object.entries(d).filter(([, v]) => typeof v === 'number')), pCat: S.pCat || {},pCat06: S.pCat06 || {}, contacts: S.contacts, waitInfeasible: S.waitInfeasible || 0, pairS08: S.pairS08 || 0, pairS06: S.pairS06 || 0, minPairS: +(S.minPairS ?? 99).toFixed(2), sCause: S.sCause || {}, worstS: S.worstS || [], pairX08: S.pairX08, pairX06: S.pairX06 || 0, heroX06: S.heroX06, minPairX: +S.minPairX.toFixed(2), minPair: +S.minPair.toFixed(2), under1: S.under1, engaged3: S.engaged3, bothSides3: S.bothSides3, maxTargetsPerSwing: mx, swingHist: hist, xCause: S.xCause || {}, hCause: S.hCause || {}, worstX: S.worstX, worst: S.worst, oneSide: S.oneSide || [], directorMinSep: d.minSep != null ? +d.minSep.toFixed(2) : null, errors: window.__KCA.info().errors.slice(-4) };
  });
  api.log('SPACING ' + JSON.stringify(out));
  const fs = await import('node:fs'), path = await import('node:path');
  fs.writeFileSync(path.join(api.outDir, 'ai_spacing.json'), JSON.stringify(out, null, 2));
};
