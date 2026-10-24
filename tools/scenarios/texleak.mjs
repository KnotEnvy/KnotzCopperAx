// perf-1650 r4: which GPU textures survive a stage transition? Hooks EventDispatcher.addEventListener('dispose') (three
// registers it the first time a texture / render target is uploaded and drops it on dispose) to keep a registry of
// every LIVE GPU texture tagged with the stage that first uploaded it. Then plays stages TL_STAGES (default 1,2,3,4,5)
// in ONE page (flow.go, like a run) and after each stage prints the live set grouped by owning stage + biggest items.
//   node tools/capture.mjs --realtime --url "/" --scenario tools/scenarios/texleak.mjs --out progress/tmp/perf/r4b/texleak
import fs from 'node:fs';
import path from 'node:path';
import { gpuProcessMB } from './vramcensus.mjs';

export default async function (api) {
  const { page, log } = api;
  const stages = String(process.env.TL_STAGES || '1,2,3,4,5').split(',').map((s) => s.trim()).filter(Boolean);
  const settle = Number(process.env.TL_SETTLE || 3000);
  let gpuPid = null;
  try {
    const cdp = await page.context().browser().newBrowserCDPSession();
    const info = await cdp.send('SystemInfo.getProcessInfo');
    const g = info.processInfo.find((p) => String(p.type).toLowerCase() === 'gpu');
    gpuPid = g && g.id;
  } catch (e) { log('no GPU pid: ' + e.message); }
  await page.evaluate(() => {
    const g = window.__KCA.game;
    let p = g.scene; while (p && !Object.prototype.hasOwnProperty.call(p, 'addEventListener')) p = Object.getPrototypeOf(p);
    const REG = window.__TEXREG = { alive: new Map(), stage: 'boot', hooked: !!p };
    if (!p) return;
    const orig = p.addEventListener;
    p.addEventListener = function (type, listener, opts) {
      if (type === 'dispose' && this.isTexture && !this.__texreg) {
        this.__texreg = true;
        const t = this;
        orig.call(this, 'dispose', () => { REG.alive.delete(t.uuid); });
      }
      if (type === 'dispose' && this.isTexture) REG.alive.set(this.uuid, { t: this, stage: (REG.alive.get(this.uuid) || {}).stage || REG.stage });
      return orig.call(this, type, listener, opts);
    };
  });
  const snapshot = (label) => page.evaluate((label) => {
    const R = window.__TEXREG, g = window.__KCA.game;
    const texBytes = (t) => {
      if (!t) return 0;
      if (t.isCompressedTexture && t.mipmaps) return t.mipmaps.reduce((s, m) => s + (m.data ? m.data.byteLength : 0), 0);
      const im = t.image || {}; const w = im.width || im.videoWidth || 0, h = im.height || im.videoHeight || 0, d = im.depth || 1;
      if (!w || !h) return 0;
      const ch = t.format === 1028 ? 1 : t.format === 1030 ? 2 : 4;
      const bpc = t.type === 1015 ? 4 : t.type === 1016 ? 2 : 1;
      const mip = t.generateMipmaps !== false && t.minFilter !== 1006 && t.minFilter !== 1003 ? 4 / 3 : 1;
      return w * h * d * ch * bpc * mip;
    };
    const by = {};
    const items = [];
    for (const { t, stage } of R.alive.values()) {
      const b = texBytes(t) / 1048576; const o = by[stage] || (by[stage] = { n: 0, mb: 0 }); o.n++; o.mb += b;
      const im = t.image || {};
      items.push({ stage, mb: b, name: t.name || '', dim: `${im.width || 0}x${im.height || 0}`, kind: t.isCanvasTexture ? 'canvas' : t.isDataTexture ? 'data' : t.isCompressedTexture ? 'comp' : t.isCubeTexture ? 'cube' : t.isRenderTargetTexture ? 'rt' : (im.constructor && im.constructor.name) || '?' });
    }
    items.sort((a, b) => b.mb - a.mb);
    const kinds = {}; for (const i of items) { const o = kinds[i.kind] || (kinds[i.kind] = { n: 0, mb: 0 }); o.n++; o.mb += i.mb; }
    const dataDims = {}; for (const i of items) if (i.kind === 'data') dataDims[i.dim] = (dataDims[i.dim] || 0) + 1;
    const nonGlb = items.filter((i) => i.kind !== 'ImageBitmap').slice(0, 14).map((i) => `${i.stage} ${i.mb.toFixed(1)} MB ${i.dim} ${i.kind} ${i.name}`);
    return { label, dataDims, kinds: Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, `${v.n} tex ${v.mb.toFixed(0)} MB`])), nonGlb, count: R.alive.size, info: { ...g.renderer.webgl.info.memory }, by: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, `${v.n} tex ${v.mb.toFixed(0)} MB`])), top: items.slice(0, 16).map((i) => `${i.stage} ${i.mb.toFixed(1)} MB ${i.dim} ${i.kind} ${i.name}`) };
  }, label);
  const out = [];
  for (const st of stages) {
    await page.evaluate((st) => { window.__TEXREG.stage = 'S' + st; }, st);
    await page.evaluate(async (stage) => {
      const g = window.__KCA.game;
      if (g.session) { g.session.reset(); g.session.join(0, 'brann', { bot: true }); g.session.autoContinue = true; }
      await g.flow.go('stage', { stage, players: [{ player: 0, heroId: 'brann', bot: true, magic: 3 }], direct: true });
    }, st);
    await page.waitForFunction(() => window.__KCA.game.levels && window.__KCA.game.levels.phase === 'fight', null, { timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(settle);
    if (process.env.TL_SHOT && process.env.TL_SHOT.split(',').includes(st)) await api.shot('s' + st);
    const s = await snapshot('after S' + st);
    s.gpu = gpuPid ? gpuProcessMB(gpuPid) : '';
    log(`  kinds ${JSON.stringify(s.kinds)} dataDims ${JSON.stringify(s.dataDims)}`);
    log(`${s.label}: live ${s.count} (info ${JSON.stringify(s.info)}) by owner ${JSON.stringify(s.by)} gpu ${s.gpu}`);
    out.push(s);
  }
  const last = out[out.length - 1];
  if (last) log('largest NON-GLB live textures:\n  ' + last.nonGlb.join('\n  '));
  if (last) log('largest live textures at the end:\n  ' + last.top.join('\n  '));
  fs.writeFileSync(path.join(api.outDir, 'texleak.json'), JSON.stringify(out, null, 1));
}
