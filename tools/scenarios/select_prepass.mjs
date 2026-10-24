// perf-1650 C2: does the character-select set link a depth pre-pass program ON SCREEN? (C2 wrap QA: "kca-prepass no-UV
// variant links ~0.8 s after the set appears → a 158–182 ms frame".) Title → select (manual clock), then 4 s of 16 ms
// steps: per step the wall time of advance(), programs linked, and the names of new programs; at the end every
// kca-prepass program key (and DepthPrepass guard state, if any).
//   node tools/capture.mjs --url "/?mode=title&quality=high" --size 1920x1080 --scenario tools/scenarios/select_prepass.mjs --out <dir>
export default async (api) => {
  const E = (fn, arg) => api.evalGame(fn, arg);
  const flow = () => E(() => window.__KCA.game.flow.state);
  const press = async (p, a, wait = 250) => { await api.press(p, a, 60); await api.advance(wait); };
  const until = async (fn, ms = 20000, step = 250) => { for (let t = 0; t < ms; t += step) { if (await fn()) return true; await api.advance(step); } return false; };
  await api.advance(800);
  const keys0 = await E(() => window.__KCA.game.renderer.webgl.info.programs.map((p) => p.cacheKey));
  await E((k0) => {
    window.__SP = { known: new Set(k0), tex: [] };
    // texture uploads per step (size, format, sync JS ms) — first-draw uploads show up here by name/size
    const gl = window.__KCA.game.renderer.webgl.getContext(), S = window.__SP;
    // first DRAW of each program (ANGLE / D3D build the real executables at the first draw, not at link)
    const W0 = window.__KCA.game.renderer.webgl, seen = new WeakSet(); S.fd = []; let cur = null;
    const rbd = W0.renderBufferDirect.bind(W0);
    W0.renderBufferDirect = function (cam, sc, geo, mat, obj, grp) { cur = { mat, obj }; return rbd(cam, sc, geo, mat, obj, grp); };
    for (const n of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const f = gl[n].bind(gl);
      gl[n] = function (...a) { const pr = gl.getParameter(gl.CURRENT_PROGRAM); if (pr && !seen.has(pr)) { seen.add(pr); const P = W0.info.programs.find((x) => x.program === pr); const c = cur || {}; S.fd.push(`${P ? (P.name || P.cacheKey.slice(0, 24)) : '?'} @${(c.obj && (c.obj.name || c.obj.type)) || ''}:${(c.mat && (c.mat.name || c.mat.type)) || ''}`); } return f(...a); };
    }
    for (const n of ['texImage2D', 'texSubImage2D', 'texStorage2D', 'generateMipmap', 'compressedTexImage2D']) {
      const f = gl[n].bind(gl);
      gl[n] = function (...a) { const t0 = performance.now(); const r = f(...a); const src = a[a.length - 1]; const w = src && src.width ? src.width + 'x' + src.height : (typeof a[3] === 'number' && typeof a[4] === 'number' ? a[3] + 'x' + a[4] : ''); S.tex.push(n + ' ' + w + ' ' + (performance.now() - t0).toFixed(1)); return r; };
    }
  }, keys0);
  await press(1, 'start', 600);
  await press(1, 'light', 400);
  await until(async () => (await flow()) === 'select');
  const hasSet = () => E(() => !!window.__KCA.game.renderer.scene.getObjectByName('selectSet'));
  if (!(await until(hasSet, 60000, 100))) { api.log('NO selectSet'); return; }
  if (process.env.SP_NODOM === '1') await E(() => { const u = document.getElementById('ui'); if (u) u.style.display = 'none'; }); // A/B: DOM raster out of the picture
  // SP_TRACE=1: browser-wide CDP trace (GPU process incl.) over the step loop; events >= 30 ms are printed per slow step
  let bcdp = null; const kept = [], threads = {}, procs = {};
  if (process.env.SP_TRACE === '1') {
    bcdp = await api.page.context().browser().newBrowserCDPSession();
    bcdp.on('Tracing.dataCollected', (d) => { for (const e of d.value) { const k = e.pid + ':' + e.tid;
      if (e.ph === 'M') { if (e.name === 'thread_name') threads[k] = e.args.name; else if (e.name === 'process_name') procs[e.pid] = e.args.name; continue; }
      if (e.name === 'TimeStamp' && e.args && e.args.data && /^SP_/.test(e.args.data.message || '')) { kept.push([k, e.args.data.message, e.ts, 0, '']); continue; }
      if (e.ph === 'X' && e.dur >= 20000) { let a = ''; try { a = JSON.stringify(e.args || {}).slice(0, 140); } catch { /* */ } kept.push([k, e.name, e.ts, e.dur, a]); } } });
    await bcdp.send('Tracing.start', { traceConfig: { recordMode: 'recordUntilFull', includedCategories: ['toplevel', 'devtools.timeline', 'disabled-by-default-devtools.timeline', 'gpu', 'gpu.angle', 'gpu.service', 'blink.user_timing', 'v8', 'cc', 'viz'] }, transferMode: 'ReportEvents' });
    await api.page.waitForTimeout(1500);
  }
  const rows = [];
  for (let i = 0; i < 250; i++) {
    const t0 = Date.now();
    if (bcdp) await E((k) => console.timeStamp('SP_' + k), i);
    await api.advance(16);
    const ms = Date.now() - t0;
    const r = await E(() => {
      const W = window.__KCA.game.renderer.webgl, S = window.__SP, out = [];
      for (const p of W.info.programs) if (!S.known.has(p.cacheKey)) { S.known.add(p.cacheKey); out.push(p.name || p.cacheKey.slice(0, 30)); }
      const pre = window.__KCA.game.renderer.prepass;
      const tex = S.tex.filter((x) => !/ \d{1,2}x\d+ | 0x\d+ /.test(x)).slice(0, 12); S.tex.length = 0; // skip bone / tiny data textures
      const R = window.__KCA.game.renderer, G = R.guard, sub = R._sub ? R._sub.map((x) => +x.toFixed(1)) : null;
      const fd = S.fd.slice(0, 8); S.fd.length = 0;
      return { fd, sub, guard: G ? { pending: G.pending.size, hidden: G.stats.hidden, prepared: G.stats.prepared } : null, frozen: R.freeze && R.freeze.stats ? R.freeze.stats : null, n: W.info.programs.length, neu: out, tex, pre: pre ? { count: pre.count, skipped: pre.skipped || 0, state: pre.guardState || null } : null };
    });
    rows.push({ i, ms, ...r });
  }
  if (bcdp) {
    const done = new Promise((r) => bcdp.once('Tracing.tracingComplete', r));
    await bcdp.send('Tracing.end'); await done;
    const marks = new Map(); for (const k of kept) if (/^SP_\d+$/.test(k[1])) marks.set(Number(k[1].slice(3)), k[2]);
    for (const r of rows) {
      if (r.ms <= 100 || !marks.has(r.i)) continue;
      const a = marks.get(r.i), b = marks.get(r.i + 1) || a + r.ms * 1000;
      const ev = kept.filter((k) => k[3] > 0 && k[2] + k[3] > a && k[2] < b).sort((x, y) => y[3] - x[3]).slice(0, 14);
      api.log(`trace step ${r.i} (${r.ms} ms):\n` + ev.map((k) => `   ${((k[2] - a) / 1000).toFixed(0).padStart(6)} +${(k[3] / 1000).toFixed(1).padStart(7)} ms  ${(procs[k[0].split(':')[0]] || '?')}/${threads[k[0]] || k[0]}  ${k[1]}  ${k[4]}`).join('\n'));
    }
  }
  const big = rows.filter((r) => r.ms > 60 || r.neu.length || r.tex.length || (r.i > 0 && r.fd.length));
  for (const r of big.slice(0, 60)) api.log(`  step ${r.i}: ${r.ms} ms · sub(patch/freeze/guard/scans/draw) ${JSON.stringify(r.sub)} · guard ${JSON.stringify(r.guard)} · new programs ${JSON.stringify(r.neu.slice(0, 4))} · first-drawn ${JSON.stringify(r.fd)} · tex ${JSON.stringify(r.tex)}`);
  api.log('guard timeline: ' + rows.filter((r, k) => k === 0 || JSON.stringify(r.guard) !== JSON.stringify(rows[k - 1].guard)).map((r) => `${r.i}:${r.guard && r.guard.pending}/${r.guard && r.guard.hidden}`).join(' '));
  const worst = rows.reduce((a, r) => (r.ms > a.ms ? r : a), rows[0]);
  api.log(`worst step ${worst.ms} ms @${worst.i} (16 ms of sim per step) · steps>100ms ${rows.filter((r) => r.ms > 100).length} · prepass ${JSON.stringify(rows[rows.length - 1].pre)}`);
  const pk = await E(() => window.__KCA.game.renderer.webgl.info.programs.filter((p) => /prepass/.test(p.name || '')).map((p) => p.name + ' :: ' + p.cacheKey.slice(0, 400)));
  api.log('prepass programs:\n  ' + pk.join('\n  '));
  const lc = await E(() => { const G = window.__KCA.game.renderer.guard; return G ? { counts: G.lightCounts, max: G.maxCounts, warned: !!G._warned } : null; });
  api.log("lights " + JSON.stringify(lc));
  await api.shot("select_end");
};
