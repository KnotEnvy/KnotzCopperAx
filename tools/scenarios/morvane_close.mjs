// Morvane close-ups (bosses C2 r12): witchfire hand + cape on the showcase plinth at several yaws.
//   node tools/capture.mjs --url "/?mode=showcase&what=boss&id=morvane&yaw=0" --scenario tools/scenarios/morvane_close.mjs --out <dir> --warm 1500
// env YAWS="-90,-40,0,40,90,180" (deg, setYaw). Writes yaw_<d>.png, hand_<d>.png (2x crop around hand_L), and
// close_sheet.png (row 1 = hand crops, row 2 = full-body crops).
import sharp from 'sharp';
import path from 'node:path';
export default async (api) => {
  const yaws = String(process.env.YAWS || '-90,-40,0,40,90,180').split(',').map(Number);
  const hands = [], bodies = [];
  for (const y of yaws) {
    await api.evalGame((d) => window.__KCA.showcase.setYaw(d), y);
    await api.advance(700);
    const s = await api.evalGame(() => {
      const g = window.__KCA.game, a = window.__KCA.showcase.actor, W = g.renderer.width, H = g.renderer.height;
      const h = a.modelRoot.getObjectByName('hand_L'), v = h.position.clone(); h.getWorldPosition(v); v.project(g.camera);
      const t = a.pos.clone(); t.y = a.height * 1.15; t.project(g.camera); const f = a.pos.clone(); f.project(g.camera);
      return { hx: (v.x + 1) / 2 * W, hy: (1 - v.y) / 2 * H, top: (1 - t.y) / 2 * H, foot: (1 - f.y) / 2 * H, cx: (f.x + 1) / 2 * W, W, H };
    });
    const f = `yaw_${y}`; await api.shot(f);
    const file = path.join(api.outDir, f + '.png');
    const meta = await sharp(file).metadata(), k = meta.width / s.W;
    const cw = 200, chh = 200;
    const left = Math.round(Math.max(0, Math.min(meta.width - cw * k, (s.hx - cw / 2) * k))), top = Math.round(Math.max(0, Math.min(meta.height - chh * k, (s.hy - chh * 0.6) * k)));
    hands.push(await sharp(file).extract({ left, top, width: Math.round(cw * k), height: Math.round(chh * k) }).resize(400, 400, { kernel: 'nearest' }).toBuffer());
    const bh = (s.foot - s.top) * 1.1, bw = bh * 0.75;
    const bl = Math.round(Math.max(0, Math.min(meta.width - bw * k, (s.cx - bw / 2) * k))), bt = Math.round(Math.max(0, (s.top - bh * 0.05) * k));
    bodies.push(await sharp(file).extract({ left: bl, top: bt, width: Math.round(bw * k), height: Math.round(Math.min(meta.height - bt, bh * k)) }).resize(300, 400).toBuffer());
  }
  const n = yaws.length;
  const comp = [];
  for (let i = 0; i < n; i++) { comp.push({ input: hands[i], left: i * 400, top: 0 }); comp.push({ input: bodies[i], left: i * 400 + 50, top: 400 }); }
  await sharp({ create: { width: 400 * n, height: 800, channels: 3, background: '#000' } }).composite(comp).png().toFile(path.join(api.outDir, 'close_sheet.png'));
};
