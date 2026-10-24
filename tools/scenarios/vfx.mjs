// VFX review scenario (owner: vfx-hitfx). Use with /?mode=showcase&what=vfx&id=hits&at=99&every=99
// Fires every hit weight in turn (or the ids in window.__vfxList) and saves <kind>_a.png (peak, +33 ms) and
// <kind>_b.png (+133 ms) for contact-sheet review.
export default async (api) => {
  const kinds = await api.evalGame(() => window.__vfxList || window.__KCA.showcase.kinds());
  await api.advance(300);
  for (const k of kinds) {
    await api.evalGame((kk) => window.__KCA.showcase.fire(kk), k);
    await api.advance(33); await api.shot(`${k}_a`);
    await api.advance(100); await api.shot(`${k}_b`);
    for (let i = 0; i < 34; i++) await api.advance(33); // VFX age per rendered frame (clamped) → step like live play
  }
};
