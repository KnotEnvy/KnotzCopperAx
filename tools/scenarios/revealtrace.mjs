// Chrome trace around the stage reveal (perf-1650): what stalls the first frames after the prewarm curtain lifts?
// Prints the longest trace events (> 60 ms) by thread with their names, from 1 s before the curtain lifts to 4 s after.
import fs from 'node:fs';
import path from 'node:path';
export default async (api) => {
  const E = (fn, a) => api.evalGame(fn, a);
  const N = Number(process.env.WP_STAGE || 1);
  const cdp = await api.page.context().newCDPSession(api.page);
  const events = [];
  cdp.on('Tracing.dataCollected', (d) => { for (const e of d.value) events.push(e); });
  const done = new Promise((r) => cdp.on('Tracing.tracingComplete', r));
  await E((n) => {
    const g = window.__KCA.game, f = g.flow;
    g.session.reset(); g.session.join(0, 'brann', { bot: true }); g.session.autoContinue = true;
    f.mode = 'arcade'; f.seqIndex = ['1', 'bonus', '2', 'bonus', '3', 'bonus', '4', 'bonus', '5'].indexOf(String(n));
    window.__RT = { done: 0 }; g.bus.on('prewarm:done', () => { window.__RT.done = performance.now(); console.timeStamp('KCA_PREWARM_DONE'); });
    f.go('map', { from: n - 1, to: n, then: { stage: String(n), players: [{ player: 0, heroId: 'brann', bot: true, magic: 3 }] } });
  }, N);
  // start tracing once the prewarm is compiling (curtain up): poll for the curtain
  for (let t = 0; t < 240000; t += 200) { if (await E(() => { const c = document.getElementById('kca-warm-curtain'); return !!(c && c.style.opacity !== '0'); })) break; await api.page.waitForTimeout(200); }
  const extra = process.env.RT_SKIA === '1' ? ',skia,disabled-by-default-skia,disabled-by-default-skia.gpu,disabled-by-default-skia.shaders,gpu.angle,disabled-by-default-gpu.service' : '';
  await cdp.send('Tracing.start', { categories: 'blink.user_timing,devtools.timeline,disabled-by-default-devtools.timeline,gpu,viz,cc,toplevel,v8,blink,disabled-by-default-devtools.timeline.frame' + extra, transferMode: 'ReportEvents' });
  for (let t = 0; t < 240000; t += 200) { if (await E(() => window.__RT.done > 0)) break; await api.page.waitForTimeout(200); }
  await api.page.waitForTimeout(4000);
  await cdp.send('Tracing.end');
  await done;
  const threads = {};
  for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') threads[e.pid + ':' + e.tid] = e.args.name;
  const long = events.filter((e) => e.ph === 'X' && e.dur > 60000).map((e) => ({ th: threads[e.pid + ':' + e.tid] || e.tid, name: e.name, ms: Math.round(e.dur / 1000), ts: e.ts, args: JSON.stringify(e.args || {}).slice(0, 120) }));
  let t0 = Infinity; for (const e of events) if (e.ts && e.ts < t0) t0 = e.ts;
  long.sort((a, b) => b.ms - a.ms);
  const mk = events.find((e) => e.name === 'TimeStamp' && e.args && e.args.data && e.args.data.message === 'KCA_PREWARM_DONE');
  api.log('PREWARM_DONE @' + (mk ? Math.round((mk.ts - t0) / 1000) : '?'));
  const md = mk ? mk.ts : 0; const out = long.filter((e) => e.ts > md - 200000).sort((a, b) => a.ts - b.ts).slice(0, 60).map((e) => `${e.ms}ms @${Math.round((e.ts - t0) / 1000)} [${e.th}] ${e.name} ${e.args}`);
  // Wave C1: every paint / raster event in [done − 300 ms, done + RT_AFTER ms] (any duration), Paint events named by their
  // DOM node (backendNodeId → DOM.describeNode: tag.class), so a first-raster stall says WHICH element was rasterised.
  if (md) {
    const AFTER = Number(process.env.RT_AFTER || 1500) * 1000;
    const RX = /^(Paint|PaintImage|RasterTask|Decode Image|ImageDecodeTask|Layerize|UpdateLayer|RasterDecoderImpl::DoEndRasterCHROMIUM::Flush|DoEndRasterCHROMIUM|ProxyMain::BeginMainFrame|FireAnimationFrame)$/;
    const ev = events.filter((e) => e.ph === 'X' && RX.test(e.name) && e.ts > md - 300000 && e.ts < md + AFTER).sort((a, b) => a.ts - b.ts);
    try { await cdp.send('DOM.enable'); await cdp.send('DOM.getDocument', { depth: -1 }); } catch (e) { /* ignore */ }
    const names = new Map();
    const nodeName = async (id) => {
      if (!id) return '';
      if (names.has(id)) return names.get(id);
      let n = '#' + id;
      try { const d = await cdp.send('DOM.describeNode', { backendNodeId: id }); const at = d.node.attributes || []; const ci = at.indexOf('class'), ii = at.indexOf('id'); n = d.node.nodeName.toLowerCase() + (ii >= 0 ? '#' + at[ii + 1] : '') + (ci >= 0 ? '.' + String(at[ci + 1]).trim().split(/\s+/).join('.') : ''); } catch (e) { /* gone */ }
      names.set(id, n); return n;
    };
    const det = [];
    for (const e of ev) {
      const d = (e.args && e.args.data) || {};
      const who = e.name === 'Paint' ? await nodeName(d.nodeId) : '';
      if (e.dur < 2000 && e.name !== 'Paint') continue;
      det.push(`${(e.dur / 1000).toFixed(1).padStart(7)} ms @${Math.round((e.ts - md) / 1000)} [${threads[e.pid + ':' + e.tid] || e.tid}] ${e.name} ${who}${d.clip ? ' clip ' + JSON.stringify(d.clip).slice(0, 60) : ''}`);
    }
    // what runs INSIDE each long GPU-process task after the reveal (RT_SKIA=1 adds Skia / ANGLE events): names ≥ 1 ms, aggregated
    const gl = events.filter((e) => e.ph === 'X' && e.dur > 40000 && e.ts > md - 300000 && e.ts < md + AFTER && /CrGpuMain|VizCompositor/.test(threads[e.pid + ':' + e.tid] || '') && /DoEndRaster.*Flush|GPUTask/.test(e.name));
    for (const L of gl.filter((e) => /Flush/.test(e.name))) {
      const kids = events.filter((e) => e.ph === 'X' && e.pid === L.pid && e.tid === L.tid && e.ts >= L.ts && e.ts + e.dur <= L.ts + L.dur && e !== L && e.dur >= 1000);
      const agg = new Map(); for (const k of kids) { const a = agg.get(k.name) || [0, 0]; a[0] += k.dur / 1000; a[1]++; agg.set(k.name, a); }
      out.push('', `--- inside ${L.name} ${(L.dur / 1000).toFixed(0)} ms @${Math.round((L.ts - md) / 1000)}:`, ...[...agg.entries()].sort((a, b) => b[1][0] - a[1][0]).slice(0, 25).map(([n, [ms, c]]) => `   ${ms.toFixed(1).padStart(7)} ms ×${c}  ${n}`));
    }
    out.push('', `--- paint / raster events from −300 ms to +${AFTER / 1000} ms of PREWARM_DONE (ms @rel):`, ...det.slice(0, 160));
  }
  api.log(out.join('\n'));
  fs.writeFileSync(path.join(api.outDir, 'revealtrace.txt'), out.join('\n'));
};
