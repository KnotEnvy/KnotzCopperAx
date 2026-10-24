// Key-pose contact sheet for animation review (owner: anim-movesets). Use with the hero/enemy showcase:
//   ANIM_POSES="light_1:0,5,6,12,22;heavy:0,8,14,20" ANIM_CROP="450,40,700,820" ANIM_COLS=8 \
//   node tools/capture.mjs --url "/?mode=showcase&what=hero&id=brann&yaw=90&spin=0" --scenario tools/scenarios/anim_poses.mjs --out <dir>
// Each tile = the clip played from frame 0 (no fade) and advanced to that 60 Hz frame. Writes poses.png (labelled grid).
// ANIM_POSES entries: "clip:f1,f2,..." separated by ';'.  ANIM_CROP: x,y,w,h of the viewport region per tile.
// ANIM_TILE: tile width in px (default 260).  ANIM_EVAL: optional JS run in the page before each clip.
import path from 'node:path';
import sharp from 'sharp';

export default async (api) => {
  const spec = (process.env.ANIM_POSES || 'idle:0,30').split(';').map((s) => s.trim()).filter(Boolean).map((s) => {
    const [clip, fr] = s.split(':');
    return { clip, frames: (fr || '0').split(',').map(Number) };
  });
  const [cx, cy, cw, ch] = (process.env.ANIM_CROP || '450,40,700,820').split(',').map(Number);
  const cols = Number(process.env.ANIM_COLS || 8);
  const tileW = Number(process.env.ANIM_TILE || 260);
  const tileH = Math.round((tileW * ch) / cw);
  const tiles = [];
  for (const { clip, frames } of spec) {
    for (const f of frames) {
      await api.evalGame(([c, e]) => { if (e) (0, eval)(e); window.__KCA.showcase.play(c, { loop: false, fade: 0, restart: true }); }, [clip, process.env.ANIM_EVAL || '']);
      // advance exactly f ticks in chunks of <= 8 (Animator.render clamps one render step to 0.25 s); 0 renders frame 0
      if (f === 0) await api.advance(1);
      for (let left = f; left > 0; left -= 8) await api.advance(Math.min(8, left) * (1000 / 60));
      const buf = await api.page.screenshot({ clip: { x: cx, y: cy, width: cw, height: ch } });
      const label = Buffer.from(`<svg width="${tileW}" height="22"><rect width="100%" height="100%" fill="#000" opacity="0.6"/><text x="6" y="16" font-family="Consolas,monospace" font-size="15" fill="#ffd27a">${clip} f${f}</text></svg>`);
      tiles.push(await sharp(buf).resize(tileW, tileH).composite([{ input: label, top: 0, left: 0 }]).png().toBuffer());
    }
  }
  const rows = Math.ceil(tiles.length / cols);
  const W = Math.min(cols, tiles.length) * (tileW + 4) - 4, H = rows * (tileH + 4) - 4;
  const out = path.join(api.outDir, 'poses.png');
  await sharp({ create: { width: W, height: H, channels: 3, background: '#0b0b0e' } })
    .composite(tiles.map((t, i) => ({ input: t, left: (i % cols) * (tileW + 4), top: Math.floor(i / cols) * (tileH + 4) })))
    .png().toFile(out);
  api.log(`poses.png ${tiles.length} tiles → ${out}`);
};
