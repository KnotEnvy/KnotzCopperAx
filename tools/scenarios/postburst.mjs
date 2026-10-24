// Post-chain pass costs by burst timing (perf-1650). Each composer pass rendered 8× back-to-back, synced by a
// 1-pixel readPixels, min of 5. Also the scene RenderPass and the bloom effect's internal passes.
import fs from 'node:fs';
import path from 'node:path';
export default async (api) => {
  await api.page.waitForTimeout(Number(process.env.GB_WAIT || 6000));
  const r = await api.evalGame(async () => {
    const g = window.__KCA.game, R = g.renderer, W = R.webgl, gl = W.getContext(), C = R.post.composer;
    g.setManualClock(true);
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const px = new Uint8Array(4);
    const sync = () => { W.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
    const time = async (fn, n = 8) => { sync(); await sleep(0); const t0 = performance.now(); for (let i = 0; i < n; i++) fn(); sync(); return (performance.now() - t0) / n; };
    const best = async (fn, k = 5) => { let m = Infinity; for (let i = 0; i < k; i++) m = Math.min(m, await time(fn)); return Math.round(m * 100) / 100; };
    R.render(1 / 60); await sleep(30);
    const out = { size: [R.width, R.height], passes: [] };
    out.empty = await best(() => {});
    out.full = await best(() => R.render(1 / 60));
    for (const p of C.passes) {
      if (!p.enabled) { out.passes.push([p.name, 'disabled']); continue; }
      const rts = p.renderToScreen; p.renderToScreen = false;
      const t = await best(() => p.render(W, C.inputBuffer, C.outputBuffer, 1 / 60, false));
      p.renderToScreen = rts;
      out.passes.push([p.name + (p.effects ? '[' + p.effects.map((e) => e.name).join(',') + ']' : ''), t]);
    }
    const b = R.post.bloom;
    if (b) out.bloomUpdate = await best(() => b.update(W, C.inputBuffer, 1 / 60));
    g.setManualClock(false);
    return out;
  });
  api.log(JSON.stringify(r));
  fs.writeFileSync(path.join(api.outDir, 'postburst.json'), JSON.stringify(r, null, 1));
};
