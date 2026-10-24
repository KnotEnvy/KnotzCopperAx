// VFX trails check (owner: vfx-hitfx). Use with /?mode=showcase&what=moveset&id=<hero>. Captures frames and logs
// how many ribbons were emitted (draw-range triangles) so a silent failure is visible in report.json.
export default async (api) => {
  let maxTris = 0, trails = 0;
  for (let i = 0; i < 48; i++) {
    await api.advance(33);
    const s = await api.evalGame(() => { const t = window.__KCA.game.vfx.trails; return { tris: t.geo.drawRange.count / 3, n: t.trails.length, armed: t.armed.size }; });
    maxTris = Math.max(maxTris, s.tris); trails = Math.max(trails, s.n);
    if (s.tris > 0) await api.shot(`trail_${String(i).padStart(2, '0')}`);
  }
  api.log(`trails: max ribbons ${trails}, max tris ${maxTris}`);
  if (!maxTris) throw new Error('no weapon trail was drawn');
};
