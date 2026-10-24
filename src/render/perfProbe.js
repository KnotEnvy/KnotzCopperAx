// Perf probe (perf-1650): per-frame recorder + GPU pass timer + longtask log + optional overlay.
//   &perf=1      overlay (fps, frame-time histogram, CPU sim/render, GPU total + per segment, longtasks, calls/tris)
//   &perfrec=1   recorder only (no overlay) — tools/scenarios/perfrec.mjs turns it on itself via window.__PERF.start()
// window.__PERF = { start(), stop(), frames: [[t, dtMs, simMs, renderMs, gpuMs|-1, steps, calls]], gpu: { seg: {name: ms EMA} },
//                   longtasks: [[start, dur]], marks: [[name, start, dur]], mark(name, fn) }
// GPU timing uses EXT_disjoint_timer_query_webgl2 (one TIME_ELAPSED query per SEGMENT: shadow, scene, each post pass),
// results are read back a few frames later (never stalls). Costs ~10 queries/frame, so it is off unless requested.
const MAXF = 20000;

export function installPerfProbe(game, renderer) {
  if (typeof window === 'undefined') return null;
  if (window.__PERF) return window.__PERF;
  const gl = renderer.webgl.getContext();
  let ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const P = {
    on: false, frames: [], longtasks: [], marks: [], gpuAvailable: !!ext,
    gpu: { seg: {}, last: {} }, _pending: [], _free: [], _cur: null, _frameSegs: null,
    start() { this.frames.length = 0; this.longtasks.length = 0; this.marks.length = 0; this.on = true; },
    stop() { this.on = false; },
    /** Wrap a synchronous chunk of work in a named measure (shows up in longtask attribution). */
    mark(name, fn) { const t = performance.now(); try { return fn(); } finally { const d = performance.now() - t; if (d > 2) this.marks.push([name, Math.round(t), Math.round(d * 10) / 10]); } },
  };
  window.__PERF = P;
  // perf C1: extension objects and query names die with a lost WebGL context — re-query, drop the pools (Renderer)
  P.onContextRestored = () => {
    ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    P.gpuAvailable = !!ext; P._free.length = 0; P._pending.length = 0; P._cur = null; P._frameSegs = null;
  };

  try {
    new PerformanceObserver((li) => { for (const e of li.getEntries()) P.longtasks.push([Math.round(e.startTime), Math.round(e.duration)]); if (P.longtasks.length > 2000) P.longtasks.splice(0, 1000); })
      .observe({ entryTypes: ['longtask'] });
  } catch (e) { /* unsupported */ }

  // ---------------------------------------------------------------- GPU segments
  const q = () => P._free.pop() || gl.createQuery();
  // P.gpuSegs = false (the in-game bench): ONE TIME_ELAPSED query per frame (total) instead of one per pass — the
  // per-pass begin/end/poll calls were ~4 % of the renderer's main-thread JS in the realtime bench profile (r4)
  P.gpuSegs = true;
  P.seg = (name) => {
    if (!ext || !P._frameSegs) return;
    if (!P.gpuSegs && name && P._cur) return; // keep the frame's single query open until frameEnd's seg(null)
    if (P._cur) { gl.endQuery(ext.TIME_ELAPSED_EXT); P._frameSegs.push([P._cur.name, P._cur.q]); P._cur = null; }
    if (name) { const qq = q(); gl.beginQuery(ext.TIME_ELAPSED_EXT, qq); P._cur = { name, q: qq }; }
  };
  P.frameBegin = () => { if (!ext || !P.gpuOn) return; P._frameSegs = []; P.seg('scene'); };
  P.frameEnd = () => {
    if (!ext || !P._frameSegs) return;
    P.seg(null);
    P._pending.push({ segs: P._frameSegs, idx: P.frames.length });
    P._frameSegs = null;
    // poll oldest
    while (P._pending.length) {
      const f = P._pending[0], lastQ = f.segs[f.segs.length - 1];
      if (!lastQ || !gl.getQueryParameter(lastQ[1], gl.QUERY_RESULT_AVAILABLE)) break;
      P._pending.shift();
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      let tot = 0; const agg = {};
      for (const [n, qq] of f.segs) { const ns = gl.getQueryParameter(qq, gl.QUERY_RESULT); P._free.push(qq); if (!disjoint) { const ms = ns / 1e6; agg[n] = (agg[n] || 0) + ms; tot += ms; } }
      if (disjoint) continue;
      P.gpu.last = agg; P.gpu.total = tot; P.gpu.at = performance.now(); // .at: Renderer._updateDRS ignores stale readings
      for (const n in agg) P.gpu.seg[n] = P.gpu.seg[n] === undefined ? agg[n] : P.gpu.seg[n] * 0.95 + agg[n] * 0.05;
      const fr = P.frames[f.idx]; // the frame record pushed right after this frame's render
      if (fr) { fr[4] = Math.round(tot * 100) / 100; fr[7] = agg; }
    }
    if (P._pending.length > 30) { for (const f of P._pending.splice(0, 10)) for (const [, qq] of f.segs) P._free.push(qq); }
  };
  // shadow map render is nested inside the scene render: split it into its own segment
  const sm = renderer.webgl.shadowMap, smRender = sm.render.bind(sm);
  sm.render = function (...a) { if (!P._frameSegs) return smRender(...a); P.seg('shadow'); try { return smRender(...a); } finally { P.seg('scene'); } };
  // each post pass (after the RenderPass) gets its own segment
  P.wrapPasses = () => {
    const post = renderer.post; if (!post || !post.composer || post._perfWrapped) return;
    post._perfWrapped = true;
    post.composer.passes.forEach((pass, i) => {
      const r = pass.render.bind(pass), nm = i === 0 ? 'scene' : (pass.name || `pass${i}`).replace(/Pass$/, '') + (pass === post.mainPass ? ':main' : '');
      pass.render = function (...a) { if (i > 0) P.seg(nm); return r(...a); };
    });
  };

  // ---------------------------------------------------------------- frame recorder
  let lastNow = 0;
  game.frameHook = (now, perf) => {
    const raw = lastNow ? now - lastNow : perf.dt * 1000; lastNow = now;
    if (!P.on) return;
    if (P.frames.length >= MAXF) P.frames.splice(0, MAXF / 2);
    const fi = renderer.frameInfo;
    P.frames.push([Math.round(now * 10) / 10, Math.round(raw * 10) / 10, Math.round(perf.sim * 100) / 100, Math.round(perf.render * 100) / 100, -1, perf.steps, fi.calls, null, renderer._sub ? Array.from(renderer._sub, (x) => Math.round(x * 100) / 100) : null]);
  };

  // ---------------------------------------------------------------- overlay
  const params = game.params;
  /** On-screen overlay (&perf=1, and the in-game benchmark /?mode=bench). */
  P.overlay = () => {
    if (P._overlay) return; P._overlay = true;
    P.gpuOn = !!ext; if (!P.on) P.start();
    const cv = document.createElement('canvas'); cv.width = 300; cv.height = 150;
    cv.style.cssText = 'position:fixed;left:6px;top:6px;z-index:9999;pointer-events:none;background:rgba(0,0,0,.6);font:11px monospace';
    document.body.appendChild(cv);
    const c2 = cv.getContext('2d');
    let lastDraw = 0;
    const draw = (t) => {
      requestAnimationFrame(draw);
      if (t - lastDraw < 100) return; lastDraw = t;
      const F = P.frames, n = Math.min(240, F.length);
      c2.clearRect(0, 0, 300, 150);
      for (let i = 0; i < n; i++) {
        const f = F[F.length - n + i], d = f[1], h = Math.min(90, d * 2);
        c2.fillStyle = d > 33 ? '#f44' : d > 18 ? '#fb3' : '#4c6';
        c2.fillRect(i * 1.25, 150 - h, 1.2, h);
      }
      c2.fillStyle = '#fff8'; c2.fillRect(0, 150 - 33.3, 300, 1); // 16.7 ms line
      const last = F.slice(-60), avg = (k) => (last.reduce((s, f) => s + (f[k] > 0 ? f[k] : 0), 0) / Math.max(1, last.length)).toFixed(1);
      const worst = last.reduce((m, f) => Math.max(m, f[1]), 0).toFixed(0);
      c2.fillStyle = '#fff';
      c2.fillText(`fps ${game.fps.toFixed(0)}  dt ${avg(1)} worst ${worst}  calls ${renderer.frameInfo.calls} tris ${(renderer.frameInfo.triangles / 1000).toFixed(0)}k`, 4, 12);
      c2.fillText(`cpu sim ${avg(2)} render ${avg(3)}  gpu ${P.gpu.total ? P.gpu.total.toFixed(1) : 'n/a'}  lt ${P.longtasks.length}`, 4, 24);
      const s = Object.entries(P.gpu.seg).map(([k, v]) => `${k} ${v.toFixed(1)}`);
      for (let i = 0; i < s.length; i += 3) c2.fillText(s.slice(i, i + 3).join('  '), 4, 36 + (i / 3) * 12);
    };
    requestAnimationFrame(draw);
  };
  if (params && params.get && params.get('perf') === '1') P.overlay();
  return P;
}
