// Rim/edge fade vs the close DRAMA cameras (owner: heroes-anim, wave C2 r1). characterLook.js fades the pixel-width
// silhouette EDGE (not the Fresnel rim) with camera distance: 0 at kRimNear.x (1.5 m) → full at kRimNear.y (4 m). This
// probe frames the hero with every close camera the game uses (boss intro 9.5 m, boss defeat 10 m, magic intro
// 14-19 m, the showcase/Death-Stab close cam 9.2 m, the game belt camera 13.2 m, plus a 2.5 m face cam as the
// control) and renders each twice: fade ON (preset) and fade OFF (kRimNear = 0 → the edge is never faded). It
// measures the real camera→hero distance and the mean |ON-OFF| over the hero's screen box: 0 = the fade does not
// touch that camera. Writes rim_drama.json, <cam>_on.png / <cam>_off.png (head crops at 3x: <cam>_head.png ON|OFF).
//   node tools/capture.mjs --url "/?mode=stage&stage=1&p1=seraphine" --scenario tools/scenarios/rim_drama.mjs --warm 1500 --out <dir>
// env: RIM_CAMS=name:dist:height:fov:look,...  override the camera list.
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_CAMS = [
  ['game', 13.2, 4.5, 32, 1.2],
  ['close_cam', 9.2, 3.3, 31, 1.45],
  ['boss_intro', 9.5, 2.8, 30, 1.2],
  ['boss_defeat', 10, 3.2, 30, 0.8],
  ['magic_intro_t1', 15.15, 5.65, 34, 1.5],
  ['face_2.5', 2.5, 1.6, 30, 1.45],
];

export default async (api) => {
  const sharp = (await import('sharp')).default;
  const E = (fn, arg) => api.evalGame(fn, arg);
  const cams = process.env.RIM_CAMS ? process.env.RIM_CAMS.split(',').map((s) => { const [n, d, h, f, l] = s.split(':'); return [n, +d, +h, +f, +l]; }) : DEFAULT_CAMS;
  const out = { cams: [], notes: [] };
  // freeze the scene: no level script, enemies off, hero idle, frozen animation clock not needed (manual clock → same tick)
  await E(() => {
    const K = window.__KCA, g = K.game;
    if (g.levels) g.levels.scriptEnabled = false;
    for (const a of g.world.query({ team: 'enemies' })) a.remove();
    const h = g.world.query({ kind: 'hero' })[0];
    h.endMove(); h.fsm.go('idle'); h.vel.set(0, 0, 0); h.facing = -1; // face the camera side (key side)
    K.input.releaseAll();
  });
  await api.advance(300);
  for (const [name, distance, height, fov, lookHeight] of cams) {
    const info = await E(async ([distance, height, fov, lookHeight]) => {
      const K = window.__KCA, g = K.game, h = g.world.query({ kind: 'hero' })[0];
      g.cameraRig.clearDrama();
      g.cameraRig.drama({ focus: h, distance, height, fov, lookHeight, in: 0.001, hold: null, priority: 9 });
      return { heroX: h.pos.x, height: h.height };
    }, [distance, height, fov, lookHeight]);
    await api.advance(400);
    const geo = await E(() => {
      const K = window.__KCA, g = K.game, h = g.world.query({ kind: 'hero' })[0];
      const T3 = h.pos.constructor;
      const cam = g.cameraRig.camera || g.camera || (g.renderer && g.renderer.camera);
      const mid = new T3(h.pos.x, h.pos.y + h.height * 0.5, h.pos.z);
      const d = cam ? cam.position.distanceTo(mid) : null;
      const feet = g.cameraRig.worldToScreen(new T3(h.pos.x, h.pos.y, h.pos.z));
      const head = g.cameraRig.worldToScreen(new T3(h.pos.x, h.pos.y + h.height, h.pos.z));
      const crown = g.cameraRig.worldToScreen(new T3(h.pos.x, h.pos.y + h.height * 0.8, h.pos.z));
      return { camDist: d, feet, head, crown, fov: cam && cam.fov, innerW: window.innerWidth, innerH: window.innerHeight };
    });
    const setFade = (on) => E(async (on) => {
      const m = await import('/src/render/characterLook.js');
      if (!on) { window.__RIM_SAVE = m.charUniforms.kRimNear.value.clone(); m.charUniforms.kRimNear.value.set(0, 0.001); }
      else if (window.__RIM_SAVE) m.charUniforms.kRimNear.value.copy(window.__RIM_SAVE);
      return [m.charUniforms.kRimNear.value.x, m.charUniforms.kRimNear.value.y];
    }, on);
    // re-render the SAME sim frame (same interpolation alpha, same VFX) — only the uniform differs between the shots
    const rerender = () => E(() => { const g = window.__KCA.game; g.renderFrame(Math.min(1, g.acc / (1 / 60)), 0); return true; });
    const fadeOn = await setFade(true); await rerender();
    await api.shot(`${name}_on`);
    const fadeOff = await setFade(false); await rerender();
    await api.shot(`${name}_off`);
    await setFade(true); await rerender();
    // hero screen box (viewport px) → compare ON vs OFF inside it, and crop the head at 3x
    const pOn = path.join(api.outDir, `${name}_on.png`), pOff = path.join(api.outDir, `${name}_off.png`);
    const meta = await sharp(pOn).metadata();
    const sx = meta.width / geo.innerW, sy = meta.height / geo.innerH;
    const hw = Math.max(40, Math.abs(geo.feet.y - geo.head.y) * 0.45 * sy);
    const box = { left: Math.round(Math.max(0, geo.head.x * sx - hw)), top: Math.round(Math.max(0, geo.head.y * sy - 20)),
      width: Math.round(Math.min(meta.width, hw * 2)), height: Math.round(Math.min(meta.height, (geo.feet.y - geo.head.y) * sy + 40)) };
    box.width = Math.min(box.width, meta.width - box.left); box.height = Math.min(box.height, meta.height - box.top);
    const a = await sharp(pOn).extract(box).raw().toBuffer(), b = await sharp(pOff).extract(box).raw().toBuffer();
    let sum = 0, n = 0, mx = 0, hot = 0, big = 0;
    const diff = Buffer.alloc(a.length);
    // film grain re-rolls per frame (|d| ≲ 20 per channel); the 2.5 px edge outline is a > 40 step → `big` isolates it
    for (let i = 0; i < a.length; i += 3) {
      const d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3; sum += d; n++; if (d > mx) mx = d; if (d > 8) hot++; if (d > 40) big++;
      const v = Math.min(255, Math.round(d * 4)); diff[i] = v; diff[i + 1] = d > 40 ? 255 : v; diff[i + 2] = v;
    }
    await sharp(diff, { raw: { width: box.width, height: box.height, channels: 3 } }).png().toFile(path.join(api.outDir, `${name}_diff.png`));
    const headH = Math.max(24, Math.round((geo.crown.y - geo.head.y) * sy * 2.2));
    const hb = { left: Math.round(Math.max(0, geo.head.x * sx - headH * 0.75)), top: Math.round(Math.max(0, geo.head.y * sy - headH * 0.25)), width: Math.round(headH * 1.5), height: headH };
    hb.width = Math.min(hb.width, meta.width - hb.left); hb.height = Math.min(hb.height, meta.height - hb.top);
    const z = 3;
    const cOn = await sharp(pOn).extract(hb).resize(hb.width * z, hb.height * z, { kernel: 'nearest' }).png().toBuffer();
    const cOff = await sharp(pOff).extract(hb).resize(hb.width * z, hb.height * z, { kernel: 'nearest' }).png().toBuffer();
    await sharp({ create: { width: hb.width * z * 2 + 8, height: hb.height * z, channels: 3, background: '#202020' } })
      .composite([{ input: cOn, left: 0, top: 0 }, { input: cOff, left: hb.width * z + 8, top: 0 }]).png().toFile(path.join(api.outDir, `${name}_head.png`));
    const rec = { name, requested: { distance, height, fov, lookHeight }, camDist: geo.camDist && +geo.camDist.toFixed(2), heroPx: Math.round((geo.feet.y - geo.head.y) * sy), fadeOn, fadeOff,
      diff: { mean: +(sum / Math.max(1, n)).toFixed(3), max: mx, hotPx: hot, pct: +(100 * hot / Math.max(1, n)).toFixed(2), bigPx: big, bigPct: +(100 * big / Math.max(1, n)).toFixed(3) }, box };
    out.cams.push(rec);
    api.log(`${name}: cam→hero ${rec.camDist} m, hero ${rec.heroPx} px tall, |on-off| mean ${rec.diff.mean} max ${rec.diff.max} hot(>8) ${rec.diff.pct}% big(>40) ${rec.diff.bigPx} px = ${rec.diff.bigPct}%`);
  }
  await E(() => window.__KCA.game.cameraRig.clearDrama());
  fs.writeFileSync(path.join(api.outDir, 'rim_drama.json'), JSON.stringify(out, null, 1));
};
