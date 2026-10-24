// 2x crops around named bones of every actor of a type (bosses C2 r12: Brute hand check).
//   node tools/capture.mjs --url "/?mode=showcase&what=boss&scene=lineup&only=brute_brothers" --scenario tools/scenarios/bone_crop.mjs --out <dir>
// env TYPE=boss_brute BONES=hand_L,hand_R FACING=-1 SIZE=160 (px box around each bone) → bone_sheet.png
import sharp from 'sharp';
import path from 'node:path';
export default async (api) => {
  const TYPE = process.env.TYPE || 'boss_brute', BONES = (process.env.BONES || 'hand_L,hand_R').split(','), S = Number(process.env.SIZE || 160);
  const F = process.env.FACING ? Number(process.env.FACING) : null;
  if (F) await api.evalGame(({ t, f }) => { for (const a of window.__KCA.game.world.actors) if (a.typeId === t) a.setFacing(f); }, { t: TYPE, f: F });
  await api.advance(600);
  const pts = await api.evalGame(({ t, bones }) => {
    const g = window.__KCA.game, W = g.renderer.width, H = g.renderer.height, out = [];
    for (const a of g.world.actors) {
      if (a.typeId !== t || !a.modelRoot) continue;
      for (const n of bones) { const b = a.modelRoot.getObjectByName(n); if (!b) continue; const v = b.position.clone(); b.getWorldPosition(v); v.project(g.camera); out.push({ n, x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H, W }); }
    }
    return out;
  }, { t: TYPE, bones: BONES });
  api.log(JSON.stringify(pts));
  await api.shot('full');
  const file = path.join(api.outDir, 'full.png'), meta = await sharp(file).metadata();
  const crops = [];
  for (const p of pts) {
    const k = meta.width / p.W, w = Math.round(S * k);
    const left = Math.round(Math.max(0, Math.min(meta.width - w, (p.x - S / 2) * k))), top = Math.round(Math.max(0, Math.min(meta.height - w, (p.y - S / 2) * k)));
    crops.push(await sharp(file).extract({ left, top, width: w, height: w }).resize(400, 400).toBuffer());
  }
  if (crops.length) await sharp({ create: { width: 400 * crops.length, height: 400, channels: 3, background: '#000' } }).composite(crops.map((input, i) => ({ input, left: i * 400, top: 0 }))).png().toFile(path.join(api.outDir, 'bone_sheet.png'));
};
