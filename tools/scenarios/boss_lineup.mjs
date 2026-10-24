// Boss stance lineup (bosses C2 r1): one shot per boss with the SAME camera offset (showcase &scene=lineup frame(i)),
// at two idle phases (IDLE_AT, s) and WALK frames (walk clip, in place). Composes lineup_sheet.png: rows = poses,
// columns = bosses. Use with /?mode=showcase&what=boss&scene=lineup[&sil=1][&phase=2].
import sharp from 'sharp';
import path from 'node:path';
export default async (api) => {
  const IDLE_AT = (process.env.IDLE_AT || '0.6,1.8').split(',').map(Number);
  const WALK = (process.env.WALK || '0.15,0.45').split(',').map(Number);
  const slots = await api.evalGame(() => window.__KCA.showcase.slots);
  const rows = [];
  let t = 0;
  // C2 r13: step at 60 Hz — Varkhul's flail chain is simulated per RENDERED frame; one long advance froze it mid-swing
  const adv = async (ms) => { for (let k = 0; k < Math.round(ms / 16.667); k++) await api.advance(16.667); };
  const shotAll = async (tag) => {
    const files = [];
    for (let i = 0; i < slots.length; i++) {
      await api.evalGame((k) => window.__KCA.showcase.frame(k), i);
      await api.advance(17); await api.advance(17);   // two frames: the orbit is applied in render (one frame lagged a slot after the 60 Hz stepping)
      const f = `${tag}_${i}_${slots[i]}`; await api.shot(f); files.push(path.join(api.outDir, f + '.png'));
    }
    rows.push(files);
  };
  for (const s of IDLE_AT) { await adv(Math.max(0, s - t) * 1000); t = s; await shotAll('idle' + s); }
  await api.evalGame(() => window.__KCA.showcase.play('walk'));
  t = 0;
  for (const s of WALK) { await adv(Math.max(0, s - t) * 1000); t = s; await shotAll('walk' + s); }
  // sheet: crop the centre of each tile (boss region) and tile it
  const CW = 520, CH = 700;
  const comp = [];
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) {
    const buf = await sharp(rows[r][c]).extract({ left: 800 - CW / 2, top: 450 - CH / 2 - 40, width: CW, height: CH }).toBuffer();
    comp.push({ input: buf, left: c * CW, top: r * CH });
  }
  await sharp({ create: { width: CW * slots.length, height: CH * rows.length, channels: 3, background: '#808080' } }).composite(comp).png().toFile(path.join(api.outDir, 'lineup_sheet.png'));
  api.log('slots ' + slots.join(' '));
};
