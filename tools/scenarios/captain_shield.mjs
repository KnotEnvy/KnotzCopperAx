// Captain tower-shield fit on the shield-forward guard (bosses C2 r12). Lineup slot (&only=captains), the captain
// turned to the GAME facing (-1, toward screen-left, like the stage-2 Patina) → rotation candidates on e._shield.
//   node tools/capture.mjs --url "/?mode=showcase&what=boss&scene=lineup&only=captains" --scenario tools/scenarios/captain_shield.mjs --out <dir> --warm 1200
// env ROTS="x,y,z;..." (deg, XYZ on the prop under socket_hand_L) · FACING=-1 · ANIM=idle → rot_<i>.png + rot_sheet.png
import sharp from 'sharp';
import path from 'node:path';
export default async (api) => {
  const ROTS = (process.env.ROTS || '0,180,0').split(';').map((s) => s.split(',').map(Number));
  const FACING = Number(process.env.FACING || -1), ANIM = process.env.ANIM || 'idle';
  const info = await api.evalGame(({ f, anim }) => {
    const g = window.__KCA.game;
    const e = g.world.query({ team: 'enemies' }).find((a) => a.typeId === 'boss_captain');
    if (!e) return { error: 'no captain' };
    e.setFacing(f); e.play(anim, { loop: true, restart: true, fade: 0 });
    window.__CAP = e;
    return { shield: !!e._shield, h: e.height, x: e.pos.x };
  }, { f: FACING, anim: ANIM });
  api.log(JSON.stringify(info));
  const files = [];
  for (let i = 0; i < ROTS.length; i++) {
    await api.evalGame((r) => { const D = Math.PI / 180, s = window.__CAP._shield; if (s) s.rotation.set(r[0] * D, r[1] * D, r[2] * D); }, ROTS[i]);
    await api.advance(500);
    const b = await api.evalGame(() => {
      const g = window.__KCA.game, e = window.__CAP, W = g.renderer.width, H = g.renderer.height;
      const p = e.pos.clone(); p.project(g.camera); const t = e.pos.clone(); t.y = e.height * 1.25; t.project(g.camera);
      return { cx: (p.x + 1) / 2 * W, yb: (1 - p.y) / 2 * H, yt: (1 - t.y) / 2 * H, W };
    });
    const f = `rot_${i}`; await api.shot(f);
    const file = path.join(api.outDir, f + '.png'), meta = await sharp(file).metadata(), k = meta.width / b.W;
    const h = (b.yb - b.yt) * 1.15, w = h * 0.8;
    const left = Math.round(Math.max(0, (b.cx - w / 2) * k)), top = Math.round(Math.max(0, (b.yt - h * 0.05) * k));
    files.push(await sharp(file).extract({ left, top, width: Math.round(Math.min(w * k, meta.width - left)), height: Math.round(Math.min(h * k, meta.height - top)) }).resize(360, 450).toBuffer());
  }
  await sharp({ create: { width: 360 * files.length, height: 450, channels: 3, background: '#000' } }).composite(files.map((input, i) => ({ input, left: i * 360, top: 0 }))).png().toFile(path.join(api.outDir, 'rot_sheet.png'));
};
