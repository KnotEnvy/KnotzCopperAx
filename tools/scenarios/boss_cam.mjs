import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  const AT = (process.env.AT || '7,16,28').split(',').map(Number), MAX = Number(process.env.MAX || 90);
  await api.evalGame(() => {
    const K = window.__KCA, g = K.game; K.debug.god(true);
    window.__bc = { done: false, n: 0, out70: 0, off: 0, xs: [], heights: null, hud: null, hPcts: [], edgeDists: [], inFrames: 0, heroIn: [], banners: {} };
    g.bus.on('boss:finaleDone', () => { window.__bc.done = true; });
  });
  let spawnT = null;
  for (let i = 0; i < 240 && spawnT === null; i++) {
    await api.advance(500);
    spawnT = await api.evalGame(() => {
      const K = window.__KCA, g = K.game;
      if (g._bossCam || g.world.query({ kind: 'boss' }).length) return g.tick / 60;
      for (const e of g.world.query({ team: 'enemies' })) if (e.alive && !e.inStage) K.debug.kill(e.id);
      return null;
    });
  }
  if (spawnT === null) throw new Error('no boss');
  api.log('boss spawn @' + spawnT);
  const sample = (elap) => api.evalGame((dtS) => {
    const g = window.__KCA.game, B = window.__bc;
    const mem = g._bossCam ? g._bossCam.members() : g.world.query({ team: 'enemies' }).filter((e) => e.inStage || e.kind === 'boss');
    const W = g.renderer.width, H = g.renderer.height;
    const live = mem.filter((m) => m && m.alive && !m.removed && (!m.view || m.view.visible !== false));
    for (const m of live) {
      const s = g.cameraRig.worldToScreen({ x: m.pos.x, y: m.pos.y + (m.height || 2) * 0.5, z: m.pos.z, clone() { return this; } });
      const f = s.x / W; B.n++; B.xs.push(+f.toFixed(3));
      if (f < 0.15 || f > 0.85) { B.out70++; if ((B.outT = B.outT || []).length < 40) B.outT.push([+(g.tick / 60).toFixed(2), m.typeId, m.tier, +f.toFixed(2), m.fsm && m.fsm.name, +m.pos.x.toFixed(2), +g.cameraRig.focus.x.toFixed(2), g.cameraRig.lock && [g.cameraRig.lock.xMin, g.cameraRig.lock.xMax], g._bossCam && +(g._bossCam.halfWidth || 0).toFixed(2), g._bossCam && g._bossCam.members()[0] === m]); }
      if (f < 0.02 || f > 0.98) B.off++;
    }
    if (live.length) {
      const lead = live[0], mt = lead.mountedOn;
      const extra = mt ? (mt.saddleY || 1.2) * (mt.modelScale || 1) : 0;
      const h = (lead.height || 2) + extra, hw = Math.max(lead.radius || 0.4, h * (mt ? 0.34 : 0.28));
      const sb = g.cameraRig.worldToScreen({ x: lead.pos.x, y: lead.pos.y, z: lead.pos.z, clone() { return this; } });
      const st = g.cameraRig.worldToScreen({ x: lead.pos.x, y: lead.pos.y + h, z: lead.pos.z, clone() { return this; } });
      const hPct = +(100 * (sb.y - st.y) / H).toFixed(1);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < 8; i++) {
        const p = g.cameraRig.worldToScreen({ x: lead.pos.x + (i & 1 ? hw : -hw), y: lead.pos.y + (i & 2 ? h : 0), z: lead.pos.z + (i & 4 ? 0.3 : -0.3), clone() { return this; } });
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
      }
      const ed = +(Math.min(x0 / W, (W - x1) / W, y0 / H, (H - y1) / H)).toFixed(3);
      B.hPcts.push(hPct);
      B.edgeDists.push(ed);
      if (x0 >= 0 && x1 <= W && y0 >= 0 && y1 <= H) B.inFrames++;
      const heroes = g.world.query({ kind: 'hero' }).filter((hr) => hr && !hr.removed && hr.alive !== false);
      if (heroes.length) {
        const hin = heroes.filter((hr) => { const p = g.cameraRig.worldToScreen({ x: hr.pos.x, y: hr.pos.y + (hr.height || 2) * 0.5, z: hr.pos.z, clone() { return this; } }); return p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H; }).length;
        B.heroIn.push(hin / heroes.length);
      }
    }
    for (const k of [5, 15, 30]) {
      if (Math.abs(dtS - k) < 0.15) {
        const bEl = document.querySelector('.kca-boss');
        B.banners['t' + k] = bEl ? { opacity: +(Number(getComputedStyle(bEl).opacity) || 0).toFixed(2), t: +(Number(bEl.dataset.t) || 0).toFixed(2) } : null;
      }
    }
    if (!B.heights && mem.some((m) => m && m.modelRoot && m.alive && m.view && m.view.visible !== false)) {
      const hgt = (a) => { const r = a.modelRoot; if (!r) return null; let lo = Infinity, hi = -Infinity; r.updateWorldMatrix(true, true); const v = new r.position.constructor(); r.traverse((o) => { if (o.isSkinnedMesh || o.isMesh) { o.geometry.computeBoundingBox && o.geometry.computeBoundingBox(); const bb = o.geometry.boundingBox; if (!bb) return; for (const y of [bb.min, bb.max]) { v.copy(y).applyMatrix4(o.matrixWorld); lo = Math.min(lo, v.y); hi = Math.max(hi, v.y); } } }); return +(hi - lo).toFixed(2); };
      B.heights = { heroes: g.world.query({ kind: 'hero' }).map((h) => [h.typeId, hgt(h)]), bosses: mem.filter(Boolean).map((m) => [m.typeId, m.tier, hgt(m), m.height]) };
    }
    const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return null; const b = e.getBoundingClientRect(); return b.width ? [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)] : null; };
    const bb = r('.kca-bosshp'), sp = r('.kca-stageplate');
    if (bb && !B.hud) B.hud = { boss: bb, plate: sp, overlap: !!(bb && sp && bb[0] < sp[2] && sp[0] < bb[2] && bb[1] < sp[3] && sp[1] < bb[3]) };
    return B.done;
  }, elap);
  let t = 0;
  const shots = [...AT];
  while (t < MAX) {
    await api.advance(250); t += 0.25;
    const done = await sample(t);
    if (shots.length && t >= shots[0]) { await api.shot('t' + shots.shift()); }
    if (done) break;
  }
  const res = await api.evalGame(() => {
    const B = window.__bc;
    const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : null; };
    const m = Math.max(1, B.hPcts.length);
    return {
      samples: B.n, leadSamples: B.hPcts.length, out70: B.out70, off: B.off,
      pctOut70: +(100 * B.out70 / Math.max(1, B.n)).toFixed(1), pctOff: +(100 * B.off / Math.max(1, B.n)).toFixed(1),
      min: Math.min(...B.xs), max: Math.max(...B.xs),
      heightPctMin: B.hPcts.length ? Math.min(...B.hPcts) : null,
      heightPctMed: med(B.hPcts),
      pctHeightGe25: +(100 * B.hPcts.filter((x) => x >= 25).length / m).toFixed(1),
      pctBoxInFrame: +(100 * B.inFrames / m).toFixed(1),
      edgeDistMin: B.edgeDists.length ? Math.min(...B.edgeDists) : null,
      edgeDistMed: med(B.edgeDists),
      pctHeroesInFrame: B.heroIn.length ? +(100 * B.heroIn.reduce((s, x) => s + x, 0) / B.heroIn.length).toFixed(1) : null,
      bannerAt: B.banners,
      heights: B.heights, outT: B.outT, hud: B.hud, done: B.done, t: window.__KCA.game.tick / 60,
    };
  });
  res.fightS = t;
  api.log(JSON.stringify(res));
  fs.writeFileSync(path.join(api.outDir, 'boss_cam.json'), JSON.stringify(res, null, 2));
};
