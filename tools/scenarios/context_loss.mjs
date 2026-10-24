// WebGL context loss → restore in the real game (perf-1650, Wave C1 renderer stability). Forces a loss with
// WEBGL_lose_context, steps frames while lost, restores, waits for Renderer._onContextRestored to relink every program
// (renderer.context.state === 'ok'), then steps FRAMES more frames and measures each one (mean luma / luma range; a
// blank frame has range < 12). Writes context_loss.json with the timeline, renderer.context and GL error counts.
//   node tools/capture.mjs --url "/?mode=stage&stage=1&p1=brann&bot=1&seed=3" --warm 9000 \
//     --scenario tools/scenarios/context_loss.mjs --out progress/shots/perf-1650/c1-render/ctxloss
// env: FRAMES=30  LOST_MS=1500 (how long the context stays lost)
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const FRAMES = Number(process.env.FRAMES || 30);
const LOST_MS = Number(process.env.LOST_MS || 1500);

async function meas(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height; let sum = 0, lo = 255, hi = 0;
  // canvas region only roughly: skip the top HUD band (DOM) so a black canvas is not hidden by HUD pixels
  const y0 = Math.floor(info.height * 0.12);
  let m = 0;
  for (let i = y0 * info.width; i < n; i++) { const l = 0.2126 * data[i * 3] + 0.7152 * data[i * 3 + 1] + 0.0722 * data[i * 3 + 2]; sum += l; m++; if (l < lo) lo = l; if (l > hi) hi = l; }
  // luma range from the 1st/99th percentile would be nicer; min/max is enough to flag a uniform frame
  return { mean: +(sum / m).toFixed(2), range: Math.round(hi - lo) };
}

export default async (api) => {
  const warns = [];
  api.page.on('console', (msg) => { const t = msg.text(); if (/context|program not valid|INVALID_OPERATION|CONTEXT_LOST/i.test(t)) warns.push([Date.now(), msg.type(), t.slice(0, 200)]); });
  const st = () => api.evalGame(() => { const R = window.__KCA.game.renderer; return { ...R.context, programs: R.webgl.info.programs.length, note: R._ctxEl ? R._ctxEl.textContent : null, lostGL: R.webgl.getContext().isContextLost() }; });
  const tl = [];
  await api.advance(33);
  const f0 = await api.shot('0_before'); tl.push({ at: 'before', ...(await meas(f0)), ctx: await st() });
  await api.evalGame(() => { window.__loseExt = window.__KCA.game.renderer.webgl.getContext().getExtension('WEBGL_lose_context'); window.__loseExt.loseContext(); });
  await api.page.waitForTimeout(200);
  for (let i = 0; i < 3; i++) await api.advance(33);
  const f1 = await api.shot('1_lost'); tl.push({ at: 'lost', ...(await meas(f1)), ctx: await st() });
  await api.page.waitForTimeout(LOST_MS);
  const tR = Date.now();
  await api.evalGame(() => window.__loseExt.restoreContext());
  await api.page.waitForFunction(() => { const c = window.__KCA.game.renderer.context; return c.state === 'ok' && c.restores >= 1; }, null, { timeout: 180000, polling: 100 });
  const restoreWallMs = Date.now() - tR;
  tl.push({ at: 'restored', ctx: await st(), restoreWallMs });
  const frames = [];
  for (let i = 0; i < FRAMES; i++) {
    const t = Date.now();
    await api.advance(33);
    const advMs = Date.now() - t;
    const f = path.join(api.outDir, `after_${String(i).padStart(3, '0')}.png`);
    await api.page.screenshot({ path: f });
    frames.push({ i, advMs, ...(await meas(f)) });
  }
  const f2 = await api.shot('2_after'); tl.push({ at: 'after', ...(await meas(f2)), ctx: await st() });
  const info = await api.evalGame(() => window.__KCA.info());
  const out = { timeline: tl, frames, blankAfter: frames.filter((f) => f.range < 12).length, maxAdvanceMs: Math.max(...frames.map((f) => f.advMs)), warnings: warns.length, warnSample: warns.slice(0, 12), errors: info && info.errors };
  fs.writeFileSync(path.join(api.outDir, 'context_loss.json'), JSON.stringify(out, null, 1));
  api.log(JSON.stringify({ timeline: tl, blankAfter: out.blankAfter, maxAdvanceMs: out.maxAdvanceMs, warnings: out.warnings }));
};
