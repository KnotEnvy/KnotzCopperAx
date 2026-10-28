// Before/after showcase sheets: idle/walk/run × yaw 90/35, 8 evenly spaced frames per clip, 1600x900 captures.
// "before" routes src/anim/clips/hero_brann.js to the r18 copy; "after" = the working tree. Optional BRANN_GLB.
import fs from 'node:fs'; import path from 'node:path';
export default async (api) => {
  const sharp = (await import('sharp')).default;
  const OLD = fs.readFileSync('progress/tmp/brann_team/anim/hero_brann.r18.js');
  let arm = 'before';
  await api.page.route('**/src/anim/clips/hero_brann.js*', (r) => (arm === 'before' ? r.fulfill({ body: OLD, contentType: 'text/javascript' }) : r.continue()));
  if (process.env.BRANN_GLB) await api.page.route('**/assets/models/hero_brann.glb*', (r) => r.fulfill({ body: fs.readFileSync(process.env.BRANN_GLB), contentType: 'model/gltf-binary' }));
  const tmp = path.join(api.outDir, '_f'); fs.mkdirSync(tmp, { recursive: true });
  for (const a of (process.env.ARMS || 'before,after').split(',')) {
    arm = a;
    await api.page.goto(new URL('/?mode=showcase&what=hero&id=brann&anim=idle&spin=0&nocache&mute&capture=1', api.page.url()).href, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await api.page.waitForFunction(() => window.__KCA?.ready, null, { timeout: 180000 });
    await api.page.evaluate(() => window.__KCA.ready); await api.page.evaluate(() => window.__KCA.setManualClock(true)); await api.advance(400);
    for (const yaw of [90, 35]) for (const clip of ['idle', 'walk', 'run']) {
      await api.evalGame(([c, y]) => { window.__KCA.showcase.setYaw(y); return window.__KCA.showcase.play(c, { loop: true, fade: 0, restart: true }); }, [clip, yaw]);
      const dur = await api.evalGame(() => window.__KCA.showcase.actor.animator.cur.duration);
      const tiles = [];
      for (let i = 0; i < 8; i++) {
        await api.advance((dur * 1000) / 8);
        const p = path.join(tmp, `${a}_${clip}_${yaw}_${i}.png`); await api.page.screenshot({ path: p });
        tiles.push({ input: await sharp(p).extract({ left: 450, top: 120, width: 700, height: 760 }).resize(350, 380).toBuffer(), left: i * 354, top: 0 });
      }
      await sharp({ create: { width: 8 * 354 - 4, height: 380, channels: 3, background: '#111' } }).composite(tiles).png().toFile(path.join(api.outDir, `${a}_${clip}_yaw${yaw}.png`));
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
};
