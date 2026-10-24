// Cinderwyrm fireball IMPACT close-up strip (mounts agent). Hero in the saddle, two straw marauders ahead, Light fires the ball.
// Frames are CROPPED around the first foe (so the blast is big enough to judge) and composed into strip.png.
//   node tools/capture.mjs --url "/?mode=showcase&what=mount&id=cinderwyrm&scene=ride" --scenario tools/scenarios/mounts_impact.mjs --out progress/shots/mounts/r6/imp
// env: IM_DX "4.2,5.4" foe offsets (m ahead of the hero) · IM_SKIP ms after the press before frame 0 (default 800) ·
//      IM_FRAMES (16) · IM_STEP ms (33) · IM_COLS (4) · IM_W/IM_H crop size (520x340) · IM_KEEP=1 keep the single crops
import fs from 'node:fs';
import path from 'node:path';
export default async (api) => {
  const S = (fn, a) => api.evalGame(fn, a);
  const dx = (process.env.IM_DX || '4.2,5.4').split(',').map(Number);
  const N = Number(process.env.IM_FRAMES || 16), step = Number(process.env.IM_STEP || 33), cols = Number(process.env.IM_COLS || 4);
  const CW = Number(process.env.IM_W || 520), CH = Number(process.env.IM_H || 340);
  await S(() => window.__KCA.debug.god(true));
  await api.advance(300);
  await S(() => { const sc = window.__KCA.showcase, h = sc.hero, b = sc.beast(); const e = b.rider; if (e) { b.dismount({ knocked: true, silent: true }); e.remove(); } b.pos.x = h.pos.x + 0.6; b.pos.z = h.pos.z; b.mount(h, { force: true }); h.facing = 1; });
  await S((d) => { const sc = window.__KCA.showcase; return Promise.all(d.map((x, i) => sc.spawnFoe('marauder', x, i % 2 ? 0.3 : -0.1, 'straw'))); }, dx);
  await S(() => { for (const e of window.__KCA.showcase.foes()) { e.brain = null; } });
  await api.advance(150);
  // crop window: centred on the first foe's chest, shifted a little toward the beast (the blast bursts on his near side)
  const c = await S(() => {
    const g = window.__KCA.game, f = window.__KCA.showcase.foes()[0], cam = g.camera, v = cam.position.clone();
    v.set(f.pos.x - 0.4, f.pos.y + 1.1, f.pos.z).project(cam);
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (1 - (v.y * 0.5 + 0.5)) * innerHeight, w: innerWidth, h: innerHeight };
  });
  const x0 = Math.max(0, Math.min(c.w - CW, Math.round(c.x - CW / 2))), y0 = Math.max(0, Math.min(c.h - CH, Math.round(c.y - CH * 0.55)));
  api.log(`crop ${x0},${y0} ${CW}x${CH} (foe at ${Math.round(c.x)},${Math.round(c.y)})`);
  const OD = !!process.env.IM_OD;   // IM_OD=1: perfbench overdraw kit (tools/perfbench.page.js) before the spawn and at frame IM_ODAT (default 3)
  if (OD) { await api.page.addScriptTag({ content: fs.readFileSync(path.resolve('tools/perfbench.page.js'), 'utf8') }); api.log('od before ' + JSON.stringify(await S(() => window.__PB.overdraw()))); }
  if (process.env.IM_STATIC) {
    // IM_STATIC=1: no attack; the impact effect is spawned straight onto the standing foe (judge how visible he stays)
    await S(() => { const sc = window.__KCA.showcase, g = window.__KCA.game, b = sc.beast(), f = sc.foes()[0]; f.hurtable = false;
      g.vfx.spawn('mount_fire', { type: 'ball_burst', pos: { x: f.pos.x - 0.55, y: f.pos.y + 1.15, z: f.pos.z }, dir: 1, gy: f.pos.y, body: b.fireMesh, target: { x: f.pos.x, y: f.pos.y + 1.0, z: f.pos.z } }); });
  } else {
    await api.press(1, process.env.FX_KEY || 'light', 60);
    await api.advance(Number(process.env.IM_SKIP || 800));
  }
  const files = [];
  for (let i = 0; i < N; i++) {
    await api.advance(step);
    const p = path.join(api.outDir, `imp_${String(i).padStart(2, '0')}.png`);
    await api.page.screenshot({ path: p, clip: { x: x0, y: y0, width: CW, height: CH } });
    if (OD && i === Number(process.env.IM_ODAT || 3)) { api.log('od frame ' + i + ' ' + JSON.stringify(await S(() => window.__PB.overdraw()))); api.log('od mats ' + JSON.stringify(await S(() => window.__PB.odByMat(8)))); }
    files.push(p);
  }
  const sharp = (await import('sharp')).default;
  const rows = Math.ceil(N / cols);
  const comps = files.map((f, i) => ({ input: f, left: (i % cols) * (CW + 4), top: Math.floor(i / cols) * (CH + 4) }));
  await sharp({ create: { width: cols * (CW + 4) - 4, height: rows * (CH + 4) - 4, channels: 3, background: '#111' } }).composite(comps).png().toFile(path.join(api.outDir, 'strip.png'));
  if (!process.env.IM_KEEP) for (const f of files) fs.rmSync(f, { force: true });
  const st = await S(() => { const sc = window.__KCA.showcase, g = window.__KCA.game; return { foes: sc.foes().map((e) => e.pos.x.toFixed(2) + ':' + e.state), shapes: g.vfx.shape.count, errors: (window.__KCA.info().errors || []).length }; });
  api.log(JSON.stringify(st));
};
