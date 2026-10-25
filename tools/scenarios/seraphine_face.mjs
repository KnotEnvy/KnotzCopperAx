// In-game close-ups of the hero for the C2 board (owner: hero-seraphine): the game's close cam (9.2 m), a 3/4
// close cam (same distance, yaw 40) and a 2.5 m 3/4 face cam, hero idle facing the camera side, enemies removed.
//   node tools/capture.mjs --url "/?mode=stage&stage=1&p1=seraphine" --scenario tools/scenarios/seraphine_face.mjs --warm 3500 --out <dir>
import fs from 'node:fs';
import path from 'node:path';
const CAMS = [
  ['close_cam', 9.2, 3.3, 31, 1.45, 0],
  ['close_34', 9.2, 3.0, 31, 1.45, -40],
  ['face_34', 2.6, 1.7, 30, 1.48, -42],
  ['face_front', 2.6, 1.7, 30, 1.48, -78],
];
export default async (api) => {
  const sharp = (await import('sharp')).default;
  const E = (fn, arg) => api.evalGame(fn, arg);
  await E(() => {
    const K = window.__KCA, g = K.game;
    if (g.levels) g.levels.scriptEnabled = false;
    for (const a of g.world.query({ team: 'enemies' })) a.remove();
    const h = g.world.query({ kind: 'hero' })[0];
    h.endMove(); h.fsm.go('idle'); h.vel.set(0, 0, 0); h.facing = -1;
    K.input.releaseAll();
  });
  await api.advance(300);
  const out = [];
  for (const [name, distance, height, fov, lookHeight, yaw] of CAMS) {
    await E(([distance, height, fov, lookHeight, yaw]) => {
      const g = window.__KCA.game, h = g.world.query({ kind: 'hero' })[0];
      g.cameraRig.clearDrama();
      g.cameraRig.drama({ focus: h, distance, height, fov, lookHeight, yaw, in: 0.001, hold: null, priority: 9 });
      return true;
    }, [distance, height, fov, lookHeight, yaw]);
    await api.advance(400);
    const geo = await E(() => {
      const g = window.__KCA.game, h = g.world.query({ kind: 'hero' })[0];
      const T3 = h.pos.constructor;
      const head = g.cameraRig.worldToScreen(new T3(h.pos.x, h.pos.y + h.height, h.pos.z));
      const crown = g.cameraRig.worldToScreen(new T3(h.pos.x, h.pos.y + h.height * 0.8, h.pos.z));
      return { head, crown, innerW: window.innerWidth, innerH: window.innerHeight };
    });
    await api.shot(name);
    const p = path.join(api.outDir, `${name}.png`);
    const meta = await sharp(p).metadata();
    const sx = meta.width / geo.innerW, sy = meta.height / geo.innerH;
    const headH = Math.max(40, Math.round((geo.crown.y - geo.head.y) * sy * 2.4));
    const hb = { left: Math.round(Math.max(0, geo.head.x * sx - headH * 0.8)), top: Math.round(Math.max(0, geo.head.y * sy - headH * 0.3)), width: Math.round(headH * 1.6), height: Math.round(headH * 1.1) };
    hb.width = Math.min(hb.width, meta.width - hb.left); hb.height = Math.min(hb.height, meta.height - hb.top);
    const z = headH < 200 ? 3 : 1;
    await sharp(p).extract(hb).resize(hb.width * z, hb.height * z, { kernel: 'nearest' }).png().toFile(path.join(api.outDir, `${name}_head.png`));
    out.push({ name, distance, yaw, headPx: headH, box: hb, zoom: z });
    api.log(`${name}: head ~${headH} px`);
  }
  await E(() => window.__KCA.game.cameraRig.clearDrama());
  fs.writeFileSync(path.join(api.outDir, 'ingame_face.json'), JSON.stringify(out, null, 1));
};
