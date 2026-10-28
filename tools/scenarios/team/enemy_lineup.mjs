import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

// Skeleton + Hollow Knight team (enemies-art-2, r22): the five-tier LINEUP at the real stage camera.
// Env:
//   SK_GLB_DIR  optional dir with candidate GLBs (enemy_skeleton_white.glb, enemy_skeleton_purple.glb,
//               enemy_knight_{silver,red,gold}.glb, weapon_sword_bone.glb, weapon_halberd.glb). Any file present there
//               is routed in place of public/assets/models/<same name>; missing files fall back to public/.
//   SK_STAGES   stages to shoot, default "1,2" (1 = dusk village, 2 = misty lake).
//   SK_ORDER    optional permutation of 0..4 (white, purple, silver, red, gold) for the blind 50 % naming test.
//   SK_CLIPS    "1" = also skinCheck every enemy over idle/walk/light_1/heavy (24 samples each) -> skin.json.
// Output per stage: s<N>.png (1600x900), s<N>_crop.png (lineup crop), s<N>_crop_50.png (50 % downscale),
// s<N>_luma.json (per-enemy mean L* + mean hue/chroma inside its screen box), and lineup_combo.png (both stages, 50 %).
// Usage: KCA_PORT=5190 node tools/capture.mjs --host http://127.0.0.1:5190 --url "/?mode=title" \
//          --scenario tools/scenarios/team/enemy_lineup.mjs --out <dir>
const DIR = process.env.SK_GLB_DIR ? path.resolve(process.env.SK_GLB_DIR) : null;
const STAGES = (process.env.SK_STAGES || '1,2').split(',').map(Number);
const FILES = ['enemy_skeleton_white', 'enemy_skeleton_purple', 'enemy_skeleton', 'enemy_knight_silver', 'enemy_knight_red',
  'enemy_knight_gold', 'enemy_knight', 'weapon_sword_bone', 'weapon_halberd'];
const LINE0 = [['skeleton', 'white'], ['skeleton', 'purple'], ['knight', 'silver'], ['knight', 'red'], ['knight', 'gold']];
// SK_ORDER="3,0,4,1,2" shuffles the row for the BLIND naming test (the reviewer names each figure without the key).
const LINE = process.env.SK_ORDER ? process.env.SK_ORDER.split(',').map(Number).map(i => LINE0[i]) : LINE0;

export default async api => {
  const routed = {};
  if (DIR) {
    for (const f of FILES) {
      const p = path.join(DIR, f + '.glb');
      if (!fs.existsSync(p)) continue;
      const buf = fs.readFileSync(p);
      routed[f] = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
      await api.page.route(`**/assets/models/${f}.glb*`, r => r.fulfill({ body: buf, contentType: 'model/gltf-binary' }));
    }
  }
  fs.writeFileSync(`${api.outDir}/glbs.json`, JSON.stringify({ dir: DIR, routed }, null, 2));
  api.log(`enemy_lineup dir=${DIR} routed=${Object.keys(routed).join(',') || 'none (public)'}`);

  const go = async p => {
    await api.page.goto(new URL(p, api.page.url()).href, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await api.page.waitForFunction(() => window.__KCA?.ready, null, { timeout: 180000 });
    await api.page.evaluate(() => window.__KCA.ready);
    await api.page.evaluate(() => window.__KCA.setManualClock(true));
    await api.advance(300);
  };
  const crops = [];
  const skin = {};
  for (const st of STAGES) {
    await go(`/?mode=stage&stage=${st}&p1=brann&mute&capture=1&drs=0`);
    await api.evalGame(() => window.__KCA.debug.god(true));
    for (let i = 0; i < 24; i++) {
      await api.advance(500);
      const banner = await api.evalGame(() => !!document.querySelector('.kca-stageplate.on, .kca-boss, .kca-intro'));
      if (!banner) break;
    }
    // Remove stage foes, spawn the five tiers in a row to the hero's right (they face the hero: side view).
    await api.evalGame(() => { const g = window.__KCA.game; for (const a of g.world.query({ team: 'enemies', alive: false })) g.world.remove(a); });
    await api.advance(100);
    const ids = await api.evalGame(async (line) => {
      const k = window.__KCA, g = k.game, h = g.world.query({ kind: 'hero' })[0];
      const out = [];
      for (let i = 0; i < line.length; i++) {
        const [type, tier] = line[i];
        const s = await k.debug.spawn(type, h.pos.x + 1.9 + i * 1.15, h.pos.z + 0.15, { tier, rise: false });
        out.push(s && s.id);
      }
      return out;
    }, LINE);
    await api.advance(1200);
    // Freeze in place (brains + motion) so the row stays readable; animation pose = whatever idle frame they hold.
    await api.evalGame((ids) => {
      const g = window.__KCA.game, h = g.world.query({ kind: 'hero' })[0];
      for (const a of g.world.query({ team: 'enemies', alive: false })) if (!ids.includes(a.id)) g.world.remove(a); // late stage spawns
      ids.forEach((id, i) => { const a = g.world.byId.get(id); if (!a) return; a.pos.x = h.pos.x + 1.9 + i * 1.15; a.pos.z = h.pos.z + 0.15; if (a.vel) a.vel.set(0, 0, 0); });
      g.timeScale = 0;
    }, ids);
    await api.advance(200);
    const shot = await api.shot(`s${st}`);
    const boxes = await api.evalGame((ids) => {
      const g = window.__KCA.game;
      return ids.map(id => {
        const a = g.world.byId.get(id); if (!a || !a.modelRoot) return null;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        a.modelRoot.updateWorldMatrix(true, true);
        a.modelRoot.traverse(o => {
          if (!o.isSkinnedMesh) return;
          o.skeleton.update();
          const v = a.pos.clone(), n = o.geometry.attributes.position.count;
          for (let i = 0; i < n; i += 3) {
            o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld).project(g.camera);
            const x = (v.x + 1) * 0.5 * innerWidth, y = (1 - v.y) * 0.5 * innerHeight;
            minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          }
        });
        return { id, left: Math.floor(minX), top: Math.floor(minY), width: Math.ceil(maxX - minX), height: Math.ceil(maxY - minY) };
      });
    }, ids);
    const meta = await sharp(shot).metadata();
    const ok = boxes.filter(Boolean);
    const L = Math.max(0, Math.min(...ok.map(b => b.left)) - 20), T = Math.max(0, Math.min(...ok.map(b => b.top)) - 20);
    const R = Math.min(meta.width, Math.max(...ok.map(b => b.left + b.width)) + 20), B = Math.min(meta.height, Math.max(...ok.map(b => b.top + b.height)) + 20);
    const crop = `${api.outDir}/s${st}_crop.png`;
    await sharp(shot).extract({ left: L, top: T, width: R - L, height: B - T }).toFile(crop);
    await sharp(crop).resize(Math.round((R - L) / 2)).toFile(`${api.outDir}/s${st}_crop_50.png`);
    crops.push(crop);
    // Per-enemy colour stats: mean sRGB -> L* (CIE) and hue/chroma (LCh) over the central 60 % of each box
    // (approximate: background pixels inside the box leak in; compare candidates on the same camera only).
    const { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
    const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const f = t => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    const stats = boxes.map((b, i) => {
      if (!b) return null;
      const x0 = Math.max(0, Math.round(b.left + b.width * 0.2)), x1 = Math.min(info.width, Math.round(b.left + b.width * 0.8));
      const y0 = Math.max(0, Math.round(b.top + b.height * 0.15)), y1 = Math.min(info.height, Math.round(b.top + b.height * 0.85));
      let X = 0, Y = 0, Z = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const o = (y * info.width + x) * info.channels, r = lin(data[o]), g = lin(data[o + 1]), bb = lin(data[o + 2]);
        X += 0.4124 * r + 0.3576 * g + 0.1805 * bb; Y += 0.2126 * r + 0.7152 * g + 0.0722 * bb; Z += 0.0193 * r + 0.1192 * g + 0.9505 * bb; n++;
      }
      X /= n * 0.95047; Y /= n; Z /= n * 1.08883;
      const Ls = 116 * f(Y) - 16, A = 500 * (f(X) - f(Y)), Bb = 200 * (f(Y) - f(Z));
      return { who: LINE[i].join('_'), Lstar: +Ls.toFixed(1), chroma: +Math.hypot(A, Bb).toFixed(1), hue: +((Math.atan2(Bb, A) * 180 / Math.PI + 360) % 360).toFixed(0), box: b };
    });
    fs.writeFileSync(`${api.outDir}/s${st}_luma.json`, JSON.stringify(stats, null, 2));
    api.log(`stage ${st}: ` + stats.map(s => s && `${s.who} L*${s.Lstar} C${s.chroma} h${s.hue}`).join(' | '));
    if (process.env.SK_CLIPS === '1') {
      await api.evalGame(() => { window.__KCA.game.timeScale = 1; });
      skin[`s${st}`] = {};
      for (const id of ids) {
        let max = 0;
        for (let s = 0; s < 24; s++) { await api.advance(50); const r = await api.evalGame(i => window.__KCA.debug.skinCheck(i), id); if (r && r.stretched > max) max = r.stretched; }
        skin[`s${st}`][id] = max;
      }
    }
  }
  if (Object.keys(skin).length) fs.writeFileSync(`${api.outDir}/skin.json`, JSON.stringify(skin, null, 2));
  // Combo: both stage crops stacked, then a 50 % version (the board's "names itself at 50 %" test).
  const imgs = await Promise.all(crops.map(c => sharp(c).metadata()));
  const W = Math.max(...imgs.map(m => m.width)), H = imgs.reduce((s, m) => s + m.height, 0);
  let y = 0; const comp = [];
  for (let i = 0; i < crops.length; i++) { comp.push({ input: crops[i], left: 0, top: y }); y += imgs[i].height; }
  const combo = `${api.outDir}/lineup_combo.png`;
  await sharp({ create: { width: W, height: H, channels: 3, background: '#000' } }).composite(comp).png().toFile(combo);
  await sharp(combo).resize(Math.round(W / 2)).toFile(`${api.outDir}/lineup_combo_50.png`);
};
