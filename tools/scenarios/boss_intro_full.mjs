// Full boss intro clip + per-tick probe (bosses C2 r12). Unlike the board's intro-only.mjs (which starts at the reveal
// event), this starts the moment the boss wave spawns (g._bossCam set) and records the WHOLE intro + MS after.
//   node tools/capture.mjs --url "/?mode=stage&stage=5&p1=brann&p2=gorrim&bot=1&screen=2" --scenario tools/scenarios/boss_intro_full.mjs --out <dir> --warm 0 --mp4 --sheet
// env: MS=6000 (clip length after spawn) · STEP=33
// intro_probe.json per tick: boss fsm + intro tick, yaw toward the camera (deg, 0 = profile, 90 = facing camera),
// projected boss box (px), every hero's box and whether it is cut by the frame edge, the boss card band rect + opacity,
// and the overlap (px²/box area) of the card band with the lead boss box.
import fs from 'node:fs';
import path from 'node:path';
export default async (api) => {
  const MS = Number(process.env.MS || 6000), STEP = Number(process.env.STEP || 33);
  await api.evalGame(() => window.__KCA.debug.god(true));
  let spawned = false;
  for (let i = 0; i < 480 && !spawned; i++) {
    await api.advance(250);
    spawned = await api.evalGame(() => {
      const K = window.__KCA, g = K.game;
      if (g._bossCam) return true;
      for (const e of g.world.query({ team: 'enemies' })) if (e.alive && e.kind !== 'boss' && !e.def?.id?.startsWith('boss_') && e.typeId !== 'viper') K.debug.kill(e.id);
      return false;
    });
  }
  if (!spawned) throw new Error('no boss');
  await api.evalGame(() => {
    const g = window.__KCA.game, P = window.__INTRO = [];
    const THREE_V = g.camera.position.clone();
    const proj = (x, y, z) => { THREE_V.set(x, y, z).project(g.camera); return [(THREE_V.x + 1) / 2 * g.renderer.width, (1 - THREE_V.y) / 2 * g.renderer.height]; };
    const box = (a) => {
      const h = (a.height || 2) + (a.mountedOn ? (a.mountedOn.saddleY || 1.2) : 0)   /* C2 r13: saddleY is world-scale already */, r = Math.max(0.35, (a.height || 2) * 0.22);
      const pts = [proj(a.pos.x - r, a.pos.y, a.pos.z), proj(a.pos.x + r, a.pos.y, a.pos.z), proj(a.pos.x - r, a.pos.y + h, a.pos.z), proj(a.pos.x + r, a.pos.y + h, a.pos.z)];
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => Math.round(v));
    };
    g.addSystem({ name: 'probe.intro', order: 999, update() {
      const cam = g._bossCam; const L = cam ? cam.members().filter((a) => a && !a.removed) : [];
      const W = g.renderer.width, H = g.renderer.height;
      const bosses = L.map((b) => {
        const yaw = Number.isFinite(b.visualYaw) ? Math.round(Math.asin(Math.max(-1, Math.min(1, Math.cos(b.visualYaw)))) * 180 / Math.PI) : null;
        return { id: b.typeId, st: b.fsm && b.fsm.name, it: b.fsm && b.fsm.is('bossIntro') ? b.fsm.ticks : null, vis: b.view ? b.view.visible : null, facing: b.facing, yaw, clip: b.animator && b.animator.name, box: box(b), x: +b.pos.x.toFixed(2), z: +b.pos.z.toFixed(2) };
      });
      const heroes = g.world.query({ kind: 'hero' }).filter((h) => !h.removed).map((h) => { const bx = box(h); return { id: h.heroId || h.typeId, box: bx, cut: bx[0] < 0 || bx[2] > W || bx[1] < 0 || bx[3] > H }; });
      let card = null;
      const el = document.querySelector('.kca-boss');
      if (el) { const band = el.querySelector('.band'); const r = (band || el).getBoundingClientRect(); const cv = (g.renderer.webgl && g.renderer.webgl.domElement) || document.querySelector("canvas"); const cr = cv.getBoundingClientRect(); const sx = W / cr.width, sy = H / cr.height; const rise = Math.max(0, r.height - ((band || el).offsetHeight || 0)) * sy; card = { rise: Math.round(rise), bh: Math.round(((band || el).offsetHeight || 0) * sy), op: +Number(getComputedStyle(el).opacity).toFixed(2), r: [(r.left - cr.left) * sx, (r.top - cr.top) * sy, (r.right - cr.left) * sx, (r.bottom - cr.top) * sy].map(Math.round) }; }
      let cover = null, coverBand = null;
      if (card && card.op > 0.2 && bosses.length) {
        let ov = 0, ar = 0;
        for (const b of bosses) { if (!b.vis) continue; const [a0, b0, a1, b1] = b.box; ar += (a1 - a0) * (b1 - b0); const ix = Math.max(0, Math.min(a1, card.r[2]) - Math.max(a0, card.r[0])), iy = Math.max(0, Math.min(b1, card.r[3]) - Math.max(b0, card.r[1])); ov += ix * iy; }
        cover = ar ? +(ov / ar).toFixed(3) : null;
        // C2 r13: TRUE band cover — the band is a skewed strip (top edge climbs to the right by `rise` px over its width),
        // so integrate the box columns below the strip's top edge and above its bottom edge (the bbox above over-counts)
        let ovT = 0;
        for (const b of bosses) { if (!b.vis) continue; const [a0, b0, a1, b1] = b.box; const n = 24;
          for (let i = 0; i < n; i++) { const x = a0 + (a1 - a0) * (i + 0.5) / n; const u = Math.max(0, Math.min(1, (card.r[2] - x) / Math.max(1, card.r[2] - card.r[0])));
            const t0 = card.r[1] + card.rise * u, t1 = t0 + card.bh; ovT += Math.max(0, Math.min(b1, t1) - Math.max(b0, t0)) * (a1 - a0) / n; } }
        coverBand = ar ? +(ovT / ar).toFixed(3) : null;
      }
      const c = g.camera.position;
      P.push({ t: g.tick, cam: [+c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2)], bosses, heroes, card, cover, coverBand });
    } });
  });
  await api.frames(Math.round(MS / STEP), STEP, 'clip');
  const P = await api.evalGame(() => window.__INTRO);
  fs.writeFileSync(path.join(api.outDir, 'intro_probe.json'), JSON.stringify(P));
  // summary: card coverage, hero cuts, max camera step per tick, yaw while the card is up
  const s = { ticks: P.length, coverMax: 0, coverMean: 0, bandCoverMax: 0, bandCoverMean: 0, cardFullTicks: 0, cardFirstTick: null, cardTicks: 0, heroCutTicks: 0, heroCutWhileCard: 0, camStepMax: 0, camStepAt: null, yawCard: [] };
  let cs = 0, cb = 0;
  for (let i = 0; i < P.length; i++) {
    const p = P[i];
    if (p.card && p.card.op >= 0.95) s.cardFullTicks++;
    if (p.cover !== null && s.cardFirstTick === null) s.cardFirstTick = i;
    if (p.coverBand !== null && p.coverBand !== undefined) { cb += p.coverBand; s.bandCoverMax = Math.max(s.bandCoverMax, p.coverBand); }
    if (p.cover !== null) { s.cardTicks++; cs += p.cover; s.coverMax = Math.max(s.coverMax, p.cover); if (p.bosses[0]) s.yawCard.push(p.bosses[0].yaw); }
    const cut = p.heroes.some((h) => h.cut);
    if (cut) { s.heroCutTicks++; if (p.cover !== null) s.heroCutWhileCard++; }
    if (i) { const a = P[i - 1].cam, b = p.cam; const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); if (d > s.camStepMax) { s.camStepMax = +d.toFixed(3); s.camStepAt = p.t; } }
  }
  s.coverMean = s.cardTicks ? +(cs / s.cardTicks).toFixed(3) : 0;
  s.bandCoverMean = s.cardTicks ? +(cb / s.cardTicks).toFixed(3) : 0;
  // cardTicks / cardFullTicks = sim ticks (60 Hz) with the card up / at full opacity; cardFirstTick = ticks from spawn
  const yc = s.yawCard; s.yawCard = yc.length ? { min: Math.min(...yc), max: Math.max(...yc), first: yc[0] } : null;
  fs.writeFileSync(path.join(api.outDir, 'intro_summary.json'), JSON.stringify(s, null, 1));
  api.log('intro summary ' + JSON.stringify(s));
};
