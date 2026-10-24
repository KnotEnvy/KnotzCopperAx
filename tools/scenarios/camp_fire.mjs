// Camp fire keep-out probe (bonus-camp r9/r10): samples every fighter's distance to the campfire through the whole hunt.
//   minBand = min |x − fire.x| (the wall is FIRE_KEEP = 1.45), minGround = min ground distance, overlapPct = % of hunt samples where any
//   fighter's body box overlaps the flare sprite (x ±0.95, y 0–1.9) on screen by > 0, softPct = % of hunt samples with env.soft > 0.3,
//   crossings = fighters seen on both sides of the fire. Writes camp_fire.json. Run (1P; add &p2=brann for 2P):
//   node tools/capture.mjs --url "/?mode=stage&stage=bonus&p1=gorrim&bot=1&camp=2" --scenario tools/scenarios/camp_fire.mjs --out progress/tmp/camp-fire
import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  const S = [];
  const probe = () => api.evalGame(() => {
    const g = window.__KCA.game, reg = window.__KCA.camp, cam = g.cameraRig.camera;
    const st = reg && reg.camp && reg.camp.state;
    const F = { x: 0, z: -0.7 };
    const all = g.world.query({ kind: 'hero' }).concat(st ? [...st.live] : []);
    const proj = (x, y, z) => { const v = cam.position.clone(); v.set(x, y, z).project(cam); return [v.x, v.y]; };
    const box = (cx, cz, hw, h) => { let x0 = 9, x1 = -9, y0 = 9, y1 = -9; for (const dx of [-hw, hw]) for (const y of [0, h]) { const [px, py] = proj(cx + dx, y, cz); x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); } return [x0, x1, y0, y1]; };
    const FR = box(F.x, F.z, 0.95, 1.9);
    let over = 0;
    const a = all.filter((q) => !q.removed && q.alive !== false).map((q) => {
      const B = box(q.pos.x, q.pos.z, 0.45, Math.max(0.9, q.height || 1.4) + Math.max(0, q.pos.y));
      const ox = Math.min(FR[1], B[1]) - Math.max(FR[0], B[0]), oy = Math.min(FR[3], B[3]) - Math.max(FR[2], B[2]);
      if (ox > 0.006 && oy > 0.006) over++; // > ~5 px of overlap
      return [q.kind === 'hero' ? 'H' : 'T', +Math.hypot(q.pos.x - F.x, q.pos.z - F.z).toFixed(2), +q.pos.x.toFixed(2), +q.pos.z.toFixed(2), q.id];
    });
    return { phase: st && st.phase, soft: reg && reg.env && reg.env.soft, over, a };
  });
  await api.advance(2000);
  for (let i = 0; i < 400; i++) { await api.advance(100); const p = await probe(); S.push(p); if (p.phase === 'tally') break; }
  const mins = { H: 9, T: 9 }, band = { H: 9, T: 9 }; let maxSoft = 0, n = 0, nOver = 0, nSoft = 0; const ph = {}; const sides = {};
  for (const s of S) {
    ph[s.phase] = (ph[s.phase] || 0) + 1;
    if (s.phase !== 'hunt' && s.phase !== 'wrap') continue;
    n++; maxSoft = Math.max(maxSoft, s.soft || 0); if (s.over) nOver++; if ((s.soft || 0) > 0.3) nSoft++;
    for (const [k, d, x, , id] of s.a) { mins[k] = Math.min(mins[k], d); band[k] = Math.min(band[k], Math.abs(x)); (sides[id] = sides[id] || new Set()).add(Math.sign(x)); }
  }
  const crossings = Object.values(sides).filter((v) => v.size > 1).length;
  const res = { minGround: mins, minBand: band, overlapPct: +(100 * nOver / Math.max(1, n)).toFixed(1), softPct: +(100 * nSoft / Math.max(1, n)).toFixed(1), maxSoft: +maxSoft.toFixed(2), crossings, samples: n, ph };
  api.log('camp_fire ' + JSON.stringify(res));
  fs.writeFileSync(path.join(api.outDir, 'camp_fire.json'), JSON.stringify({ ...res, S }));
};
