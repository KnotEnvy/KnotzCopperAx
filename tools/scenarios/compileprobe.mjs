// Wave C1 (perf): how long does the stage prewarm's shader compile take, and why? Wraps the page's WebGL context before
// the stage loads (title → map → stage N, as the arcade does) and records, per program: linkProgram time, the first
// getProgramParameter(COMPLETION_STATUS_KHR) that returned true (three's compileAsync polls it every 10 ms), and any
// synchronous LINK_STATUS / getProgramInfoLog / getUniformLocation that blocked > 20 ms. Prints the prewarm report,
// the link→ready latency distribution and how many programs were in flight at once (serial vs parallel compile).
//   node tools/capture.mjs --realtime --url "/?mode=title" --scenario tools/scenarios/compileprobe.mjs --out <dir> --timeout 300000
// env: CP_STAGE=1..5
import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  const E = (fn, arg) => api.evalGame(fn, arg);
  const N = Number(process.env.CP_STAGE || 1);
  await E(() => {
    const g = window.__KCA.game, gl = g.renderer.webgl.getContext();
    const C = window.__CP = { progs: new Map(), block: [], t0: performance.now(), ext: !!gl.getExtension('KHR_parallel_shader_compile'), marks: {} };
    const CS = 0x91B1;
    const link = gl.linkProgram.bind(gl), gpp = gl.getProgramParameter.bind(gl), gil = gl.getProgramInfoLog.bind(gl), gsp = gl.getShaderParameter.bind(gl);
    let id = 0;
    gl.linkProgram = (p) => { const t = performance.now(); link(p); C.progs.set(p, { id: ++id, link: t, linkMs: performance.now() - t, ready: 0, polls: 0 }); };
    gl.getProgramParameter = (p, k) => {
      const t = performance.now(); const r = gpp(p, k); const d = performance.now() - t;
      const P = C.progs.get(p);
      if (P && k === CS) { P.polls++; if (r && !P.ready) P.ready = performance.now(); }
      else if (P && !P.ready) P.ready = performance.now(); // a sync query (LINK_STATUS…) completes the link
      if (d > 20) C.block.push({ fn: 'getProgramParameter', k, ms: Math.round(d), t: Math.round(t - C.t0), id: P && P.id });
      return r;
    };
    gl.getProgramInfoLog = (p) => { const t = performance.now(); const r = gil(p); const d = performance.now() - t; if (d > 20) C.block.push({ fn: 'getProgramInfoLog', ms: Math.round(d), t: Math.round(t - C.t0) }); return r; };
    gl.getShaderParameter = (s, k) => { const t = performance.now(); const r = gsp(s, k); const d = performance.now() - t; if (d > 20) C.block.push({ fn: 'getShaderParameter', ms: Math.round(d), t: Math.round(t - C.t0) }); return r; };
    g.bus.on('prewarm:done', (rep) => { C.marks.done = performance.now(); C.rep = rep; });
  });
  await E((n) => {
    const g = window.__KCA.game, f = g.flow;
    g.session.reset(); g.session.join(0, 'brann', { bot: true }); g.session.autoContinue = true;
    f.mode = 'arcade'; f.seqIndex = ['1', 'bonus', '2', 'bonus', '3', 'bonus', '4', 'bonus', '5'].indexOf(String(n));
    window.__CP.marks.go = performance.now();
    f.go('map', { from: n - 1, to: n, then: { stage: String(n), players: [{ player: 0, heroId: 'brann', bot: true, magic: 3 }] } });
  }, N);
  for (let t = 0; t < 240000; t += 250) { if (await E(() => !!window.__CP.marks.done)) break; await api.page.waitForTimeout(250); }
  const R = await E(() => {
    const C = window.__CP, L = [...C.progs.values()];
    const lat = L.filter((p) => p.ready).map((p) => p.ready - p.link).sort((a, b) => a - b);
    const q = (k) => Math.round(lat[Math.min(lat.length - 1, Math.floor(lat.length * k))] || 0);
    // in-flight count over time (linked, not yet ready)
    let maxIn = 0; const ev = []; for (const p of L) { ev.push([p.link, 1]); if (p.ready) ev.push([p.ready, -1]); }
    ev.sort((a, b) => a[0] - b[0]); let cur = 0; for (const e of ev) { cur += e[1]; maxIn = Math.max(maxIn, cur); }
    // completion cadence: gaps between consecutive ready times (serial compile = steady ~X ms cadence)
    const rd = L.filter((p) => p.ready).map((p) => p.ready).sort((a, b) => a - b);
    const cad = []; for (let i = 1; i < rd.length; i++) cad.push(rd[i] - rd[i - 1]);
    cad.sort((a, b) => a - b);
    const rel = (t) => Math.round(t - C.marks.go);
    return { ext: C.ext, rep: C.rep, programs: L.length, neverReady: L.filter((p) => !p.ready).length, latency: { p10: q(0.1), p50: q(0.5), p90: q(0.9), max: q(1) }, maxInFlight: maxIn,
      cadenceMs: { p50: Math.round(cad[cad.length >> 1] || 0), p90: Math.round(cad[Math.floor(cad.length * 0.9)] || 0) },
      firstLink: L.length ? rel(Math.min(...L.map((p) => p.link))) : null, lastReady: rd.length ? rel(rd[rd.length - 1]) : null, done: rel(C.marks.done),
      linkCallMs: Math.round(L.reduce((s, p) => s + p.linkMs, 0)), polls: L.reduce((s, p) => s + p.polls, 0), block: C.block.slice(0, 30) };
  });
  api.log(JSON.stringify(R, null, 1));
  fs.writeFileSync(path.join(api.outDir, 'compileprobe.json'), JSON.stringify(R, null, 1));
};
