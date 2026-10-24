// perf-1650 r4: GPU-memory growth across stage transitions in ONE page (what a player's 5-stage run does).
// For each stage in SM_STAGES (default "1,2,3,4,5") : flow.go('stage'), wait for the fight, settle SM_SETTLE ms,
// then log renderer.info.memory (textures/geometries), programs, JS heap and the GPU process "Dedicated Usage" (MB).
//   node tools/capture.mjs --realtime --url "/?mode=stage&stage=1&p1=brann&bot=1" --scenario tools/scenarios/stagemem.mjs --out ...
import fs from 'node:fs';
import path from 'node:path';
import { gpuProcessMB } from './vramcensus.mjs';

export default async function (api) {
  const { page, log } = api;
  const stages = String(process.env.SM_STAGES || '1,2,3,4,5').split(',').map((s) => s.trim()).filter(Boolean);
  const settle = Number(process.env.SM_SETTLE || 4000);
  let gpuPid = null;
  try {
    const cdp = await page.context().browser().newBrowserCDPSession();
    const info = await cdp.send('SystemInfo.getProcessInfo');
    const g = info.processInfo.find((p) => String(p.type).toLowerCase() === 'gpu');
    gpuPid = g && g.id;
  } catch (e) { log('no GPU pid: ' + e.message); }
  const sample = async (label) => {
    const s = await page.evaluate(() => {
      const g = window.__KCA.game, W = g.renderer.webgl;
      return { tex: W.info.memory.textures, geo: W.info.memory.geometries, prog: W.info.programs.length, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0, stage: g.levels && g.levels.def && g.levels.def.id, phase: g.levels && g.levels.phase, fps: Math.round(g.fps) };
    });
    const line = { label, ...s, gpu: gpuPid ? gpuProcessMB(gpuPid) : '' };
    log(JSON.stringify(line));
    return line;
  };
  const out = [];
  out.push(await sample('start'));
  for (const st of stages) {
    await page.evaluate(async (stage) => {
      const g = window.__KCA.game;
      if (g.session) { g.session.reset(); g.session.join(0, 'brann', { bot: true }); g.session.autoContinue = true; }
      await g.flow.go('stage', { stage, players: [{ player: 0, heroId: 'brann', bot: true, magic: 3 }], direct: true });
    }, st);
    await page.waitForFunction(() => window.__KCA.game.levels && window.__KCA.game.levels.phase === 'fight', null, { timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(settle);
    out.push(await sample('stage ' + st));
  }
  fs.writeFileSync(path.join(api.outDir, 'stagemem.json'), JSON.stringify(out, null, 1));
}
