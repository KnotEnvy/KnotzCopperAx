// perf-1650 r4: find WHO triggers "GL_INVALID_OPERATION: glDraw*: Mismatch between texture format and sampler type"
// (the console warning in every bench/capture report). Wraps renderer.renderBufferDirect (records object/material) and
// the gl draw functions (gl.getError() after each draw → attribute the error to the last renderBufferDirect call).
//   node tools/capture.mjs --realtime --url "/" --scenario tools/scenarios/glerrors.mjs --out ...     env GE_STAGES=1,2,3,4,5 GE_MS=3000
import fs from 'node:fs';
import path from 'node:path';

export default async function (api) {
  const { page, log } = api;
  const stages = String(process.env.GE_STAGES || '1,2,3,4,5').split(',').map((s) => s.trim()).filter(Boolean);
  const ms = Number(process.env.GE_MS || 3000);
  await page.evaluate(() => {
    const g = window.__KCA.game, R = g.renderer, W = R.webgl, gl = W.getContext();
    const E = window.__GLE = { stage: '?', errs: new Map(), draws: 0, cur: null };
    const rb = W.renderBufferDirect.bind(W);
    W.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
      E.cur = { camera, material, object, scene, target: W.getRenderTarget(), pass: camera && camera.layers ? camera.layers.mask : 0 };
      return rb(camera, scene, geometry, material, object, group);
    };
    const wrap = (name) => {
      const f = gl[name].bind(gl);
      gl[name] = function (...a) {
        const r = f(...a);
        E.draws++;
        const e = gl.getError();
        if (e !== 0) {
          const c = E.cur || {};
          const m = c.material || {}, o = c.object || {};
          const key = [E.stage, name, e, o.type, o.name || '', o.parent && o.parent.name || '', m.type, m.name || '', (m.userData && Object.keys(m.userData).slice(0, 4).join(',')) || '', c.target ? 'RT' : 'screen', o.isInstancedMesh ? 'inst' : '', o.isSkinnedMesh ? 'skin' : '', m.isShaderMaterial ? 'shader' : ''].join(' | ');
          E.errs.set(key, (E.errs.get(key) || 0) + 1);
        }
        return r;
      };
    };
    for (const n of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) wrap(n);
  });
  for (const st of stages) {
    await page.evaluate((st) => { window.__GLE.stage = 'S' + st; }, st);
    await page.evaluate(async (stage) => {
      const g = window.__KCA.game;
      if (g.session) { g.session.reset(); g.session.join(0, 'brann', { bot: true }); g.session.autoContinue = true; }
      await g.flow.go('stage', { stage, players: [{ player: 0, heroId: 'brann', bot: true, magic: 3 }], direct: true });
    }, st);
    await page.waitForFunction(() => window.__KCA.game.levels && window.__KCA.game.levels.phase === 'fight', null, { timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(ms);
    await page.evaluate(() => window.__KCA.debug && window.__KCA.debug.cast && window.__KCA.debug.cast(1, 9));
    await page.waitForTimeout(2500);
  }
  const res = await page.evaluate(() => ({ draws: window.__GLE.draws, errs: [...window.__GLE.errs.entries()] }));
  log(`draws ${res.draws}; distinct error sites ${res.errs.length}`);
  for (const [k, n] of res.errs.sort((a, b) => b[1] - a[1])) log(`  x${n}  ${k}`);
  fs.writeFileSync(path.join(api.outDir, 'glerrors.json'), JSON.stringify(res, null, 1));
}
