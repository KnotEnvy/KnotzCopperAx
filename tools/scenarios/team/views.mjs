import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import selectScenario from './select.mjs';

const GLB = process.env.BRANN_GLB || 'progress/tmp/brann_team/donor/hero_brann.glb';

// Shared QA camera scenario for the Brann team (QA critic owned).
// Same cameras for every candidate: route hero_brann.glb -> BRANN_GLB,
// showcase close (head+shoulders) yaw 0/35/90/180, full yaw 0/90/180,
// idle + run side strips (evenly spaced frames across one loop),
// stage-1 1600x900 still + 2x crop of Brann, select READY.
export default async api => {
  const abs = path.resolve(GLB);
  const buf = fs.readFileSync(abs);
  const sha = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
  await api.page.route('**/assets/models/hero_brann.glb*', r =>
    r.fulfill({ body: buf, contentType: 'model/gltf-binary' }));
  api.log(`views.mjs GLB=${GLB} sha=${sha}`);
  fs.writeFileSync(`${api.outDir}/glb.json`, JSON.stringify({ glb: GLB, sha256_16: sha }, null, 2));

  const go = async p => {
    await api.page.goto(new URL(p, api.page.url()).href, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await api.page.waitForFunction(() => window.__KCA?.ready, null, { timeout: 180000 });
    await api.page.evaluate(() => window.__KCA.ready);
    await api.page.evaluate(() => window.__KCA.setManualClock(true));
    await api.advance(300);
  };
  const frameCam = async () => {
    await api.evalGame(() => {
      const k = window.__KCA, g = k.game, h = k.showcase.actor;
      if (g._qaCam) return;
      g._qaCam = true;
      g.addSystem({
        name: 'qa-brann-framing', order: 90, render() {
          const cam = g.camera, p = h.pos.clone();
          h.modelRoot.updateWorldMatrix(true, true);
          const head = h.modelRoot.getObjectByName('head');
          head.getWorldPosition(p);
          const close = window.__brannCamera === 'head';
          const target = close ? p.clone().add({ x: 0, y: -0.025, z: 0 }) : h.pos.clone().add({ x: 0, y: 0.95, z: 0 });
          cam.position.copy(target).add({ x: 0, y: close ? 0.025 : 0.18, z: close ? 1.9 : 5.9 });
          cam.fov = close ? 28 : 30; cam.lookAt(target); cam.updateProjectionMatrix();
        }
      });
    });
  };
  const yawShot = async (cam, yaw, name) => {
    await api.evalGame(k => { window.__brannCamera = k; }, cam);
    await api.evalGame(y => window.__KCA.showcase.setYaw(y), yaw);
    await api.advance(33);
    await api.shot(name);
  };

  // 1. Showcase stills, idle.
  await go('/?mode=showcase&what=hero&id=brann&anim=idle&spin=0&nocache&mute&capture=1');
  await frameCam();
  for (const yaw of [0, 35, 90, 180]) await yawShot('head', yaw, `close_${yaw}`);
  for (const yaw of [0, 90, 180]) await yawShot('full', yaw, `full_${yaw}`);

  // 2. Idle + run side strips, evenly spaced across one loop at yaw 90.
  const strip = async (clip, prefix) => {
    await api.evalGame(c => window.__KCA.showcase.play(c, { loop: true, fade: 0, restart: true }), clip);
    await api.evalGame(() => { window.__brannCamera = 'full'; });
    await api.evalGame(() => window.__KCA.showcase.setYaw(90));
    await api.advance(100);
    const dur = await api.evalGame(() => window.__KCA.showcase.actor.animator.cur.duration);
    const step = Math.max(33, (dur * 1000) / 12);
    for (let i = 0; i < 12; i++) { await api.advance(step); await api.shot(`${prefix}_${String(i).padStart(2, '0')}`); }
    api.log(`${prefix}: loop ${dur.toFixed(2)}s step ${step.toFixed(0)}ms`);
  };
  await strip('idle', 'idle_side');
  await strip('run', 'run_side');

  // 3. Stage 1 still + 2x crop of Brann.
  await go('/?mode=stage&stage=1&p1=brann&p2=seraphine&mute&capture=1&drs=0');
  await api.evalGame(() => window.__KCA.debug.god(true));
  for (let i = 0; i < 24; i++) {
    await api.advance(500);
    const banner = await api.evalGame(() => !!document.querySelector('.kca-stageplate.on, .kca-boss, .kca-intro'));
    if (!banner) break;
  }
  await api.advance(400);
  const stagePath = await api.shot('stage1');
  const box = await api.evalGame(() => {
    const g = window.__KCA.game, h = g.world.query({ kind: 'hero' }).find(h => h.def.id === 'brann');
    let mesh; h.modelRoot.traverse(o => { if (o.isSkinnedMesh && !mesh) mesh = o; });
    mesh.updateWorldMatrix(true, true); mesh.skeleton.update();
    const v = h.pos.clone();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const n = mesh.geometry.attributes.position.count;
    for (let i = 0; i < n; i += 2) {
      mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld).project(g.camera);
      const x = (v.x + 1) * 0.5 * innerWidth, y = (1 - v.y) * 0.5 * innerHeight;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return { left: Math.max(0, Math.floor(minX) - 8), top: Math.max(0, Math.floor(minY) - 8), width: Math.ceil(maxX) - Math.floor(minX) + 16, height: Math.ceil(maxY) - Math.floor(minY) + 16 };
  });
  fs.writeFileSync(`${api.outDir}/stage1-box.json`, JSON.stringify(box, null, 2));
  const meta = await sharp(stagePath).metadata();
  const w2 = Math.min(meta.width, box.width * 2), h2 = Math.min(meta.height, box.height * 2);
  const l2 = Math.max(0, Math.min(meta.width - w2, Math.floor(box.left + box.width / 2 - w2 / 2)));
  const t2 = Math.max(0, Math.min(meta.height - h2, Math.floor(box.top + box.height / 2 - h2 / 2)));
  await sharp(stagePath).extract({ left: l2, top: t2, width: w2, height: h2 }).toFile(`${api.outDir}/stage1_brann_2x.png`);

  // 4. Select READY (reuses the r18 select flow).
  await go('/?mode=title&mute&capture=1&drs=0');
  await selectScenario(api);
};
