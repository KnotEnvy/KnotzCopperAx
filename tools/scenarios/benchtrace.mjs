// perf-1650 r3: Chrome trace of the /?mode=bench FIGHT START (the realtime bench showed ~1 s rAF gaps in the first
// 1.5 s of the fight with no program link / DRS / heap change). Run with --realtime:
//   node tools/capture.mjs --realtime --url "/?mode=bench&stages=1&secs=6" --scenario tools/scenarios/benchtrace.mjs --out ...
// Prints trace events > 150 ms (by thread) from 0.5 s before the fight phase to 4 s after.
import fs from 'node:fs';
import path from 'node:path';
export default async (api) => {
  const E = (fn, a) => api.evalGame(fn, a);
  const cdp = await api.page.context().newCDPSession(api.page);
  const events = [];
  cdp.on('Tracing.dataCollected', (d) => { for (const e of d.value) events.push(e); });
  const done = new Promise((r) => cdp.on('Tracing.tracingComplete', r));
  // start once the curtain is up for the stage (prewarm) — the fight follows it
  for (let t = 0; t < 240000; t += 200) { if (await E(() => { const c = document.getElementById('kca-warm-curtain'); return !!(c && c.style.opacity !== '0'); })) break; await api.page.waitForTimeout(200); }
  await cdp.send('Tracing.start', { categories: 'blink.user_timing,devtools.timeline,disabled-by-default-devtools.timeline,gpu,viz,cc,toplevel,v8,blink,disabled-by-default-devtools.timeline.frame', transferMode: 'ReportEvents' });
  for (let t = 0; t < 240000; t += 100) { if (await E(() => { const g = window.__KCA.game; if (g.levels && g.levels.phase === 'fight' && !window.__BT) { window.__BT = performance.now(); console.timeStamp('KCA_FIGHT'); } return !!window.__BT; })) break; await api.page.waitForTimeout(100); }
  await api.page.waitForTimeout(4000);
  await cdp.send('Tracing.end');
  await done;
  const threads = {};
  for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') threads[e.pid + ':' + e.tid] = e.args.name;
  let t0 = Infinity; for (const e of events) if (e.ts && e.ts < t0) t0 = e.ts;
  const mk = events.find((e) => e.name === 'TimeStamp' && e.args && e.args.data && e.args.data.message === 'KCA_FIGHT');
  const md = mk ? mk.ts : t0;
  const long = events.filter((e) => e.ph === 'X' && e.dur > 150000 && e.ts > md - 500000 && !/^(ThreadControllerImpl::RunTask|Edge_RunTask|AsyncTask Run|v8.callFunction)$/.test(e.name)).map((e) => ({ th: threads[e.pid + ':' + e.tid] || e.tid, name: e.name, ms: Math.round(e.dur / 1000), at: Math.round((e.ts - md) / 1000), args: JSON.stringify(e.args || {}).slice(0, 160) }));
  long.sort((a, b) => a.at - b.at);
  const out = long.slice(0, 120).map((e) => `${e.ms}ms @${e.at} [${e.th}] ${e.name} ${e.args}`);
  api.log('FIGHT @' + (mk ? 'marked' : '?') + '\n' + out.join('\n'));
  fs.writeFileSync(path.join(api.outDir, 'benchtrace.txt'), out.join('\n'));
};
