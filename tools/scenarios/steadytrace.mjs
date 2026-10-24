// Steady-state Chrome trace (perf-1650 r2): which THREAD limits the frame rate? Traces TR_MS of live play and prints,
// per thread, the busy share (top-level events only) and the event names with the most total time.
//   node tools/capture.mjs --realtime --size 1920x1080 --host http://127.0.0.1:4167 \
//     --url "/?mode=stage&stage=5&p1=brann&bot=1&mute&drs=0" --scenario tools/scenarios/steadytrace.mjs --out <dir> --timeout 180000
// env: TR_MS=3000 · TR_WAIT=8000 · TR_EVAL (js run before tracing) · TR_CAST=1
import fs from 'node:fs';
import path from 'node:path';
export default async (api) => {
  const E = (fn, a) => api.evalGame(fn, a);
  await E(() => { const d = window.__KCA.debug; d.god(true); d.pots(1, 9); });
  if (process.env.TR_EVAL) await api.page.evaluate(process.env.TR_EVAL);
  await api.page.waitForTimeout(Number(process.env.TR_WAIT || 8000));
  const cdp = await api.page.context().newCDPSession(api.page);
  const events = [];
  cdp.on('Tracing.dataCollected', (d) => { for (const e of d.value) events.push(e); });
  const done = new Promise((r) => cdp.on('Tracing.tracingComplete', r));
  const MS = Number(process.env.TR_MS || 3000);
  const f0 = await E(() => { window.__RAF = 0; const t = () => { window.__RAF++; requestAnimationFrame(t); }; requestAnimationFrame(t); return 0; });
  const t0w = Date.now();
  if (process.env.TR_CAST === '1') await E(() => window.__KCA.debug.cast(1, 6));
  await cdp.send('Tracing.start', { categories: 'gpu,viz,cc,toplevel,v8,blink,renderer.scheduler,disabled-by-default-gpu.service,disabled-by-default-devtools.timeline,devtools.timeline', transferMode: 'ReportEvents' });
  if (process.env.TR_SHOT === '1') { await api.page.waitForTimeout(700); await api.page.screenshot({ path: path.join(api.outDir, 'trace.png') }); }
  await api.page.waitForTimeout(MS);
  const f1r = 0;
  const f1 = await E(() => window.__RAF); const wall = Date.now() - t0w;
  await cdp.send('Tracing.end');
  await done;
  const threads = {};
  for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') threads[e.pid + ':' + e.tid] = e.args.name;
  // per thread: top-level X events (not nested in another X on the same thread)
  const byT = {};
  for (const e of events) if (e.ph === 'X' && e.dur > 0) (byT[e.pid + ':' + e.tid] = byT[e.pid + ':' + e.tid] || []).push(e);
  let tMin = Infinity, tMax = 0; for (const e of events) if (e.ts) { tMin = Math.min(tMin, e.ts); tMax = Math.max(tMax, e.ts + (e.dur || 0)); }
  const span = (tMax - tMin) / 1000;
  const lines = [`span ${Math.round(span)} ms, events ${events.length}`];
  const rows = [];
  for (const [k, list] of Object.entries(byT)) {
    list.sort((a, b) => a.ts - b.ts || b.dur - a.dur);
    let end = -1, busy = 0; const top = {}, all = {};
    const stack = [];
    for (const e of list) {
      all[e.name] = (all[e.name] || 0) + e.dur;
      if (e.ts >= end) { busy += e.dur; end = e.ts + e.dur; top[e.name] = (top[e.name] || 0) + e.dur; }
    }
    rows.push({ th: threads[k] || k, busy: busy / 1000, top, all, n: list.length });
  }
  rows.sort((a, b) => b.busy - a.busy);
  for (const r of rows.slice(0, 8)) {
    lines.push(`[${r.th}] busy ${Math.round(r.busy)} ms (${Math.round((r.busy / span) * 100)} %), events ${r.n}`);
    lines.push('   top-level: ' + Object.entries(r.top).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, d]) => `${n} ${Math.round(d / 1000)}`).join(' | '));
    lines.push('   all:       ' + Object.entries(r.all).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([n, d]) => `${n} ${Math.round(d / 1000)}`).join(' | '));
  }
  // DOM paints: which screen rects get repainted (clip quad → bbox), counted per rect
  const paints = {};
  for (const e of events) if (e.name === 'Paint' && e.args && e.args.data && e.args.data.clip) { const c = e.args.data.clip; const xs = [c[0], c[2], c[4], c[6]], ys = [c[1], c[3], c[5], c[7]]; const k = `${Math.round(Math.min(...xs))},${Math.round(Math.min(...ys))} ${Math.round(Math.max(...xs) - Math.min(...xs))}x${Math.round(Math.max(...ys) - Math.min(...ys))} node${e.args.data.nodeId || '?'}`; const o = paints[k] || (paints[k] = { n: 0, ms: 0 }); o.n++; o.ms += (e.dur || 0) / 1000; }
  lines.push('paints (rect node: count ms): ' + Object.entries(paints).sort((a, b) => b[1].n - a[1].n).slice(0, 14).map(([k, o]) => `${k}: ${o.n} ${o.ms.toFixed(0)}`).join(' | '));
  if (process.env.TR_NODES === '1') {
    const ids = [...new Set(Object.keys(paints).map((k) => Number(k.split('node')[1])).filter((x) => x > 0))].slice(0, 14);
    try { await cdp.send('DOM.getDocument', { depth: -1 }); const r = await cdp.send('DOM.pushNodesByBackendIdsToFrontend', { backendNodeIds: ids }); for (let i = 0; i < ids.length; i++) { const d = await cdp.send('DOM.describeNode', { nodeId: r.nodeIds[i] }).catch(() => null); if (d) lines.push(`  node${ids[i]} = <${d.node.localName} class="${(d.node.attributes || []).join(' ').slice(0, 120)}">`); } } catch (e) { lines.push('nodes: ' + e.message); }
  }
  lines.push(`rAF frames ${f1 - f0} in ${wall} ms wall = ${((f1 - f0) * 1000 / wall).toFixed(1)} fps`);
  api.log('\n' + lines.join('\n'));
  fs.writeFileSync(path.join(api.outDir, 'steadytrace.txt'), lines.join('\n'));
};
