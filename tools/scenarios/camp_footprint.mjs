// Camp fire screen-footprint map (bonus-camp r10): for a hero-sized (1.7 m) and thief-sized (1.1 m) body box over a ground
// grid, the fraction of the box covered by the fire's screen rect (flame x ±0.8, y 0–1.9). Prints rows by z, columns by x.
//   node tools/capture.mjs --url "/?mode=stage&stage=bonus&p1=gorrim&bot=1&camp=2" --scenario tools/scenarios/camp_footprint.mjs --out progress/tmp/bonus-camp-r10/foot
export default async (api) => {
  await api.advance(1000);
  const out = await api.evalGame(() => {
    const g = window.__KCA.game, cam = g.cameraRig.camera;
    const proj = (x, y, z) => { const v = cam.position.clone(); v.set(x, y, z).project(cam); return [v.x, v.y]; };
    const box = (cx, cz, hw, h) => { let x0 = 9, x1 = -9, y0 = 9, y1 = -9; for (const dx of [-hw, hw]) for (const y of [0, h]) { const [px, py] = proj(cx + dx, y, cz); x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); } return [x0, x1, y0, y1]; };
    const F = box(0, -0.7, 0.8, 1.9);
    const res = { F, cam: cam.position.toArray(), rows: {} };
    for (const [name, h] of [['hero', 1.7], ['thief', 1.1]]) {
      const rows = [];
      for (let z = -2.2; z <= 2.21; z += 0.4) {
        const row = [];
        for (let x = -3; x <= 3.01; x += 0.5) {
          const B = box(x, z, 0.45, h);
          const ox = Math.min(F[1], B[1]) - Math.max(F[0], B[0]), oy = Math.min(F[3], B[3]) - Math.max(F[2], B[2]);
          row.push(ox > 0 && oy > 0 ? Math.round(ox * oy / ((B[1] - B[0]) * (B[3] - B[2])) * 100) : 0);
        }
        rows.push('z' + z.toFixed(1).padStart(5) + ' ' + row.map((v) => String(v).padStart(3)).join(''));
      }
      res.rows[name] = rows;
    }
    return res;
  });
  api.log('F ' + JSON.stringify(out.F) + ' cam ' + JSON.stringify(out.cam));
  for (const k of Object.keys(out.rows)) { api.log(k + '  x = -3 .. 3 step .5'); for (const r of out.rows[k]) api.log(r); }
};
