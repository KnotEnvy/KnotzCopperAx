// Hero-generic team camera set (Gorrim team r25; generalises views.mjs + select.mjs, which are Brann-only).
//   HERO=gorrim HERO_GLB=<scratch .glb> NODE tools/capture.mjs --host http://127.0.0.1:<port> \
//     --url "/?mode=title&mute&capture=1&drs=0" --scenario tools/scenarios/team/hero_views.mjs --out <dir>
// Env: HERO (default gorrim), HERO_GLB (optional; routes /assets/models/hero_<HERO>.glb, public/ untouched),
//      PARTNER (stage-1 P2, default brann), SKIP (comma list of: showcase,strips,stage,duel,select).
// Shots: close_{0,35,90,180} (head + shoulders), full_{0,90,180}, idle/walk/run side strips (12 evenly spaced frames,
// yaw 90) + strip_<clip>.png, stage1 1600x900 + stage1_<hero>_2x.png, duel idle + run strip (duel_strip.png),
// select_stand / select_both_ready (+ _2x crops of the hero). glb.json records the SHA.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';

const HERO = process.env.HERO || 'gorrim';
const PARTNER = process.env.PARTNER || (HERO === 'brann' ? 'gorrim' : 'brann');
const SKIP = new Set((process.env.SKIP || '').split(',').filter(Boolean));

async function stripSheet(files, out, cols = 6) {
  const metas = await Promise.all(files.map(f => sharp(f).metadata()));
  const w = metas[0].width, h = metas[0].height;
  const rows = Math.ceil(files.length / cols);
  await sharp({ create: { width: w * cols, height: h * rows, channels: 3, background: '#222' } })
    .composite(files.map((f, i) => ({ input: f, left: (i % cols) * w, top: Math.floor(i / cols) * h })))
    .png().toFile(out);
}

export default async api => {
  const out = api.outDir;
  if (process.env.HERO_GLB) {
    const buf = fs.readFileSync(path.resolve(process.env.HERO_GLB));
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    await api.page.route(`**/assets/models/hero_${HERO}.glb*`, r => r.fulfill({ body: buf, contentType: 'model/gltf-binary' }));
    fs.writeFileSync(`${out}/glb.json`, JSON.stringify({ hero: HERO, glb: process.env.HERO_GLB, sha256: sha }, null, 2));
  } else {
    const p = `public/assets/models/hero_${HERO}.glb`;
    const sha = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    fs.writeFileSync(`${out}/glb.json`, JSON.stringify({ hero: HERO, glb: p, sha256: sha }, null, 2));
  }
  api.log(`hero_views HERO=${HERO} GLB=${process.env.HERO_GLB || 'public'}`);

  const go = async p => {
    await api.page.goto(new URL(p, api.page.url()).href, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await api.page.waitForFunction(() => window.__KCA?.ready, null, { timeout: 180000 });
    await api.page.evaluate(() => window.__KCA.ready);
    await api.page.evaluate(() => window.__KCA.setManualClock(true));
    await api.advance(300);
  };
  const heroBox = (id, pad = 8) => api.evalGame(([id, pad]) => {
    const g = window.__KCA.game, h = g.world.query({ kind: 'hero' }).find(h => h.def.id === id);
    if (!h) throw new Error(id + ' missing');
    const v = h.pos.clone();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    h.modelRoot.updateWorldMatrix(true, true);
    h.modelRoot.traverse(o => {
      if (!o.isSkinnedMesh) return;
      o.skeleton.update();
      for (let i = 0; i < o.geometry.attributes.position.count; i += 2) {
        o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld).project(g.camera);
        if (v.z < -1 || v.z > 1) continue;
        const x = (v.x + 1) * 0.5 * innerWidth, y = (1 - v.y) * 0.5 * innerHeight;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    });
    const left = Math.max(0, Math.floor(minX) - pad), top = Math.max(0, Math.floor(minY) - pad);
    return { left, top, width: Math.min(innerWidth - left, Math.ceil(maxX) - left + pad), height: Math.min(innerHeight - top, Math.ceil(maxY) - top + pad), clip: h.animator?.name };
  }, [id, pad]);
  const crop2x = async (src, box, dst) => {
    if (!(box.width > 0 && box.height > 0)) return;
    await sharp(src).extract({ left: box.left, top: box.top, width: box.width, height: box.height })
      .resize(box.width * 2, box.height * 2, { kernel: 'lanczos3' }).png().toFile(dst);
  };
  const waitBanner = async () => {
    for (let i = 0; i < 30; i++) {
      await api.advance(500);
      if (!(await api.evalGame(() => !!document.querySelector('.kca-stageplate.on, .kca-boss, .kca-intro')))) break;
    }
    await api.advance(400);
  };

  // 1. Showcase stills (idle) + side strips.
  if (!SKIP.has('showcase') || !SKIP.has('strips')) {
    await go(`/?mode=showcase&what=hero&id=${HERO}&anim=idle&spin=0&nocache&mute&capture=1`);
    await api.evalGame(() => {
      const k = window.__KCA, g = k.game, h = k.showcase.actor;
      g.addSystem({ name: 'qa-hero-framing', order: 90, render() {
        const cam = g.camera, p = h.pos.clone();
        h.modelRoot.updateWorldMatrix(true, true);
        h.modelRoot.getObjectByName('head').getWorldPosition(p);
        const close = window.__qaCam === 'head';
        const height = window.__qaHeight || 1.4;
        const target = close ? p.clone().add({ x: 0, y: -0.06, z: 0 }) : h.pos.clone().add({ x: 0, y: height * 0.5, z: 0 });
        cam.position.copy(target).add({ x: 0, y: close ? 0.02 : 0.12, z: close ? 1.6 : height * 3.6 });
        cam.fov = close ? 28 : 30; cam.lookAt(target); cam.updateProjectionMatrix();
      } });
      const b = new (h.pos.constructor)(); // world height of the model for framing
      let maxY = 0; h.modelRoot.traverse(o => { if (o.isBone) { o.getWorldPosition(b); maxY = Math.max(maxY, b.y - h.pos.y); } });
      window.__qaHeight = Math.max(1.2, maxY + 0.15);
    });
    const yawShot = async (cam, yaw, name) => {
      await api.evalGame(k => { window.__qaCam = k; }, cam);
      await api.evalGame(y => window.__KCA.showcase.setYaw(y), yaw);
      await api.advance(33);
      await api.shot(name);
    };
    if (!SKIP.has('showcase')) {
      for (const yaw of [0, 35, 90, 180]) await yawShot('head', yaw, `close_${yaw}`);
      for (const yaw of [0, 90, 180]) await yawShot('full', yaw, `full_${yaw}`);
    }
    if (!SKIP.has('strips')) {
      for (const clip of ['idle', 'walk', 'run']) {
        await api.evalGame(c => window.__KCA.showcase.play(c, { loop: true, fade: 0, restart: true }), clip);
        await api.evalGame(() => { window.__qaCam = 'full'; window.__KCA.showcase.setYaw(90); });
        await api.advance(100);
        const dur = await api.evalGame(() => window.__KCA.showcase.actor.animator.cur.duration);
        const step = Math.max(33, (dur * 1000) / 12);
        const files = [];
        for (let i = 0; i < 12; i++) { await api.advance(step); files.push(await api.shot(`${clip}_side_${String(i).padStart(2, '0')}`)); }
        await stripSheet(files, `${out}/strip_${clip}.png`);
        api.log(`${clip}: loop ${dur.toFixed(2)}s step ${step.toFixed(0)}ms`);
      }
    }
  }

  // 2. Stage 1 still + 2x crop.
  if (!SKIP.has('stage')) {
    await go(`/?mode=stage&stage=1&p1=${HERO}&p2=${PARTNER}&mute&capture=1&drs=0`);
    await api.evalGame(() => window.__KCA.debug.god(true));
    await waitBanner();
    const sp = await api.shot('stage1');
    const box = await heroBox(HERO);
    fs.writeFileSync(`${out}/stage1-box.json`, JSON.stringify(box, null, 2));
    await crop2x(sp, box, `${out}/stage1_${HERO}_2x.png`);
  }

  // 3. Duel: idle 1 s, then double-tap run right ~1.2 s, stop (hero 2x crops, evenly spaced).
  if (!SKIP.has('duel')) {
    await go(`/?mode=stage&stage=duel&p1=${HERO}&mute&capture=1&drs=0`);
    await api.evalGame(() => {
      const k = window.__KCA, g = k.game; k.debug.god(true);
      g.addSystem({ name: 'qa-duel-space', order: 30, update() {
        const h = g.world.query({ kind: 'hero' })[0];
        for (const e of g.world.query({ team: 'enemies' })) { e.pos.x = (h ? h.pos.x : 0) + 11; e.pos.z = 2.5; e.vel?.set(0, 0, 0); }
      } });
    });
    await waitBanner();
    await api.evalGame(() => { const h = window.__KCA.game.world.query({ kind: 'hero' })[0]; h.pos.x = -6; h.pos.z = 0; h.vel.set(0, 0, 0); h.facing = 1; });
    await api.advance(600);
    const crops = [];
    const grab = async name => {
      const p = await api.shot(name);
      const b = await heroBox(HERO, 40);
      const c = `${out}/_${name}_c.png`;
      const w = 360, h = 420, cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      const meta = await sharp(p).metadata();
      const l = Math.max(0, Math.min(meta.width - w, Math.round(cx - w / 2))), t = Math.max(0, Math.min(meta.height - h, Math.round(cy - h / 2)));
      await sharp(p).extract({ left: l, top: t, width: w, height: h }).toFile(c);
      crops.push(c);
    };
    for (let i = 0; i < 4; i++) { await api.advance(250); await grab(`duel_idle_${i}`); }
    await api.press(1, 'right', 35); await api.advance(70); await api.hold(1, 'right', true);
    for (let i = 0; i < 6; i++) { await api.advance(200); await grab(`duel_run_${i}`); }
    await api.hold(1, 'right', false);
    for (let i = 0; i < 2; i++) { await api.advance(250); await grab(`duel_stop_${i}`); }
    await stripSheet(crops, `${out}/duel_strip.png`);
  }

  // 4. Select screen: stand + both READY (P1 = PARTNER default Brann, P2 default = Gorrim).
  if (!SKIP.has('select')) {
    await go('/?mode=title&mute&capture=1&drs=0');
    const press = async (p, a, wait = 250) => { await api.press(p, a, 60); await api.advance(wait); };
    await api.advance(800); await press(1, 'start', 600); await press(1, 'light', 400);
    for (let i = 0; i < 120; i++) {
      if (await api.evalGame(() => window.__KCA.game.flow.state === 'select' && window.__KCA.game.world.query({ kind: 'hero' }).length >= 2)) break;
      await api.advance(250);
    }
    await api.advance(1500);
    const take = async name => {
      await api.page.evaluate(async () => { await new Promise(r => setTimeout(r, 150)); });
      const p = await api.shot(name);
      const b = await heroBox(HERO, 12);
      await crop2x(p, b, `${out}/${name}_2x.png`);
      return b;
    };
    const probes = [];
    probes.push({ name: 'select_stand', ...(await take('select_stand')) });
    if (HERO === 'gorrim') { await press(2, 'start', 300); }        // P2 joins on Gorrim (default)
    else { await press(2, 'start', 300); await press(2, 'left', 300); }
    await press(1, 'light', 700); await press(2, 'light', 60);
    await api.advance(900);
    probes.push({ name: 'select_both_ready', ...(await take('select_both_ready')) });
    fs.writeFileSync(`${out}/select_proof.json`, JSON.stringify(probes, null, 2));
  }
};
