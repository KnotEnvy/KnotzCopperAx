// In-game benchmark (perf-1650): /?mode=bench[&stages=1,2,3,4,5][&secs=14][&p1=brann][&quality=low|high]
// Plays a deterministic bot run of each stage in REAL TIME (the real frame loop, DRS and frame pacing as shipped):
// ~14 s steady combat → a top-tier spell → the boss arena (intro + fight). The &perf overlay is on throughout; the run
// ends on a results card with per-stage median / 1 %-low frame time (+ spell and boss segments), the preset, the
// resolution and DRS scale, so anyone can verify performance on their own browser. Press R (or click) to run again.
// Wall-clock numbers depend on what else the machine is doing — the contention-robust numbers are tools/perfbench.mjs.
import { forge } from '../ui/lettering.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * CPU speed index (perf-1650 r4): this laptop's CPU is heat-throttled to 35–60 % of its nominal clock for long stretches
 * (Windows "% Processor Performance"), which alone moves a cell from 16.7 to 33 ms. A fixed 60×4096 JS kernel (perfbench's
 * cpuCal) is timed around every segment: speed = CAL_REF_MS / best-of-3 kernel ms, 1.00 = the nominal 2.5 GHz clock
 * (kernel ≈ 6 ms), 0.55 = a throttled laptop. A cell measured at < ~0.8 is CPU-throttled and not comparable to one at 1.0.
 */
const CAL_REF_MS = 6;
const calBuf = new Float64Array(4096);
function calKernel() {
  const t = performance.now(); let s = 0.5;
  for (let r = 0; r < 60; r++) for (let i = 0; i < 4096; i++) { s = (s * 1.0000003 + calBuf[(i * 7 + r) & 4095]) % 97.13; calBuf[i] = Math.sqrt(s + i) * 0.5; }
  calBuf[0] += s * 1e-12;
  return performance.now() - t;
}
const calBest = () => Math.min(calKernel(), calKernel(), calKernel());

function stats(frames) {
  const d = frames.map((f) => f[1]).filter((x) => x > 0).sort((a, b) => a - b);
  if (!d.length) return null;
  const med = d[d.length >> 1];
  const n = Math.max(1, Math.floor(d.length * 0.01));
  const low1 = d.slice(-n).reduce((s, v) => s + v, 0) / n;
  // r4 diagnostics: median main-thread JS per frame (sim + render) and median GPU timer (the probe's TIME_ELAPSED sum;
  // -1 = not available) → tells a CPU-bound 30 fps from a GPU-bound / shared-GPU one
  const mid = (a) => { const v = a.filter((x) => x >= 0).sort((x, y) => x - y); return v.length ? Math.round(v[v.length >> 1] * 10) / 10 : -1; };
  return { frames: d.length, med: Math.round(med * 10) / 10, low1: Math.round(low1 * 10) / 10, over20: Math.round((d.filter((x) => x > 20.5).length / d.length) * 1000) / 10, worst: Math.round(d[d.length - 1]),
    js: mid(frames.map((f) => f[2] + f[3])), sim: mid(frames.map((f) => f[2])), ren: mid(frames.map((f) => f[3])), sub: [0, 1, 2, 3, 4].map((k) => mid(frames.map((f) => (f[8] ? f[8][k] : -1)))), gpu: mid(frames.map((f) => f[4])), calls: mid(frames.map((f) => f[6] || 0)), steps: mid(frames.map((f) => f[5])) };
}

/**
 * &probe=1 (perf-1650 r4 stall hunt): times every WebGL call (a call > 25 ms is logged with its JS stack) and every
 * system's update/render (per-frame totals) so a bench spike says WHERE a multi-second frame went. Attribution only:
 * the per-call timing inflates main-thread JS 2–3× (thousands of performance.now() per frame).
 */
function installStallProbe(game) {
  const X = { gl: [], sys: new Map(), glAcc: new Map(), on: true };
  const gl = game.renderer.webgl.getContext();
  const proto = Object.getPrototypeOf(gl);
  for (const k of Object.getOwnPropertyNames(proto)) {
    let d; try { d = Object.getOwnPropertyDescriptor(proto, k); } catch (e) { continue; }
    if (!d || typeof d.value !== 'function' || k === 'constructor') continue;
    const f = d.value;
    gl[k] = function (...a) {
      const t = performance.now(); const r = f.apply(gl, a); const ms = performance.now() - t;
      X.glAcc.set(k, (X.glAcc.get(k) || 0) + ms);
      if (ms > 25 && X.gl.length < 200) X.gl.push({ fn: k, ms: Math.round(ms), t: Math.round(t), arg: typeof a[0] === 'number' ? a[0] : '', stack: String(new Error().stack).split('\n').slice(2, 9).map((l) => l.trim().replace(/^at /, '').replace(/https?:\/\/[^/]+\//, '').replace(/\?[^:]*:/, ':')).join(' < ') });
      return r;
    };
  }
  X.wrap = () => {
    for (const sy of game.systems) {
      if (sy.__bw) continue; sy.__bw = true;
      for (const m of ['update', 'render']) {
        if (typeof sy[m] !== 'function') continue;
        const f = sy[m], key = (sy.name || '?') + '.' + m;
        sy[m] = function (...a) { const t = performance.now(); try { return f.apply(this, a); } finally { X.sys.set(key, (X.sys.get(key) || 0) + performance.now() - t); } };
      }
    }
  };
  X.segAcc = new Map(); X.segFrames = 0; X.segSteps = 0;
  X.take = () => {
    const top = [...X.sys.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).filter((e) => e[1] >= 1).map(([k, v]) => `${k} ${Math.round(v)}`);
    for (const [k, v] of X.sys) X.segAcc.set(k, (X.segAcc.get(k) || 0) + v);
    X.sys.clear(); return top;
  };
  /** per-frame averages since the last call (segment summary): top systems + renderer sub-steps, ms/frame */
  X.segSummary = () => {
    const n = Math.max(1, X.segFrames), out = [...X.segAcc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k} ${(v / n).toFixed(2)}`);
    let glt = 0; for (const v of X.glAcc.values()) glt += v;
    const gtop = [...X.glAcc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${(v / n).toFixed(2)}`);
    const res = { steps: +(X.segSteps / n).toFixed(2), top: out, gl: `GL total ${(glt / n).toFixed(2)} ms/frame: ${gtop.join(' · ')}` };
    X.glAcc.clear(); X.segAcc.clear(); X.segFrames = 0; X.segSteps = 0; return res;
  };
  X.wrap();
  return X;
}

/**
 * &fd=1 (perf-1650 r4): first-DRAW log. ANGLE/D3D11 compiles a program's HLSL the first time it is DRAWN, not when
 * three links it (a linked-but-never-drawn program costs 50–450 ms of GPU-process time — and blocks the next sync GL
 * call — at its first draw). Every program first drawn after the run started is logged with the segment, the object
 * and the material, so prewarm misses show up by name. Cheap: one getParameter(CURRENT_PROGRAM) per draw.
 */
function installFirstDraw(game) {
  const W = game.renderer.webgl, gl = W.getContext();
  const F = { seen: new WeakSet(), list: [], cur: null, seg: 'load', on: true };
  const rb = W.renderBufferDirect.bind(W);
  W.renderBufferDirect = function (camera, scene, geometry, material, object, group) { F.cur = { material, object }; return rb(camera, scene, geometry, material, object, group); };
  const progName = (prog) => { const ps = W.info.programs || []; for (const p of ps) if (p.program === prog) return (p.name || '') + ' ' + String(p.cacheKey || '').slice(-70); return '?'; };
  for (const n of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) {
    const f = gl[n].bind(gl);
    gl[n] = function (...a) {
      if (F.on) {
        const prog = gl.getParameter(gl.CURRENT_PROGRAM);
        if (prog && !F.seen.has(prog)) {
          F.seen.add(prog);
          if (F.armed) { const c = F.cur || {}, m = c.material || {}, o = c.object || {}; F.list.push({ seg: F.seg, t: Math.round(performance.now()), prog: progName(prog), obj: `${o.type || ''}:${o.name || ''}<${(o.parent && o.parent.name) || ''}`, mat: `${m.type || ''}:${m.name || ''}`, flags: `transp=${m.transparent ? 1 : 0} dw=${m.depthWrite ? 1 : 0} side=${m.side} fadeOf=${m.userData && m.userData.bossFadeOf ? 1 : 0} recv=${o.receiveShadow ? 1 : 0} cast=${o.castShadow ? 1 : 0} inst=${o.isInstancedMesh ? o.count : 0} vis=${o.visible ? 1 : 0}` }); }
        }
      }
      return f(...a);
    };
  }
  // texture uploads of >= 512 px sources after arming (a texture that was NOT resident when the fight started)
  for (const n of ['texSubImage2D', 'texImage2D']) {
    const f = gl[n].bind(gl);
    gl[n] = function (...a) {
      if (F.armed) { const src = a[a.length - 1]; if (src && src.width >= 512 && F.list.length < 200) F.list.push({ seg: F.seg, t: Math.round(performance.now()), prog: 'TEXUPLOAD ' + src.width + 'x' + src.height, obj: '', mat: '' }); }
      return f(...a);
    };
  }
  return F;
}

/** Route for mode=bench: loads the first stage (so __KCA.ready covers it) and schedules the real-time run. */
export async function startBench(game, params) {
  const stages = String(params.get('stages', '1,2,3,4,5')).split(',').map((s) => s.trim()).filter(Boolean);
  const secs = Math.max(4, Number(params.get('secs', 14)) || 14);
  const hero = params.p1 || 'brann';
  const P = window.__PERF;
  if (P && P.overlay) P.overlay();
  const B = { stages, secs, results: [], running: true };
  window.__BENCH = B;
  if (String(params.get('probe', '0')) === '1') B.probe = installStallProbe(game);
  if (String(params.get('fd', '0')) === '1') B.fd = installFirstDraw(game);
  if (P) P.gpuSegs = String(params.get('gpusegs', '0')) === '1'; // one GPU query per frame (overlay shows the total)
  if (P && String(params.get('gputimer', '1')) === '0') P.gpuOn = false; // A/B the probe's TIME_ELAPSED queries
  await loadStage(game, stages[0], hero);
  (async () => {
    while (!game.running) await sleep(100);
    await sleep(500);
    try { await run(game, B, hero); } catch (e) { B.error = String(e && e.message || e); }
    B.running = false;
    showCard(game, B);
  })();
}

async function loadStage(game, stage, hero) {
  const players = [{ player: 0, heroId: hero, bot: true, magic: 3 }];
  if (game.session) { game.session.reset(); game.session.join(0, hero, { bot: true }); game.session.autoContinue = true; }
  await game.flow.go('stage', { stage, players, direct: true });
}

async function waitFor(fn, ms) { const t0 = performance.now(); while (!fn() && performance.now() - t0 < ms) await sleep(100); return fn(); }

async function run(game, B, hero) {
  const P = window.__PERF;
  const d = window.__KCA.debug;
  for (let i = 0; i < B.stages.length; i++) {
    const stage = B.stages[i];
    if (i > 0) await loadStage(game, stage, hero);
    const L = game.levels;
    await waitFor(() => L.phase === 'fight', 30000);
    d.god(true); d.pots(1, 9);
    let segName = 'reveal';
    // frames by rAF timestamp, not by index: the probe halves P.frames at 20000 entries (~5.5 min), which used to empty
    // or truncate a segment late in a 5-stage run (r4: S4 'top spell' came back null)
    const seg = async (ms, name) => { const c0 = calBest(); segName = B.seg = name; if (B.fd) B.fd.seg = name; if (B.probe) B.probe.segSummary(); const ta = performance.now(); await sleep(ms); segName = B.seg = 'between'; if (B.fd) B.fd.seg = 'between'; const tb = performance.now(); (r.cpu || (r.cpu = {}))[name] = +(CAL_REF_MS / Math.min(c0, calBest())).toFixed(2); if (B.probe) (r.prof || (r.prof = {}))[name] = B.probe.segSummary(); (r.actors || (r.actors = {}))[name] = actorCensus(); return P.frames.filter((f) => f[0] >= ta && f[0] < tb); };
    const r = { stage, drs: [], spikes: [] };
    // actors alive at the end of a segment by kind (a boss segment that piles up adds/corpses shows here)
    const actorCensus = () => { const c = {}; try { for (const a of game.world.actors) { const k = (a.kind || '?') + (a.alive === false ? ':dead' : ''); c[k] = (c[k] || 0) + 1; } } catch (e) { /* ignore */ } return c; };
    // r3: every frame gap > 100 ms with what changed since the previous frame (new linked programs, DRS scale, JS heap)
    // → B.results[i].spikes; tells a program link / resize / GC stall from machine contention (no change at all)
    const W = game.renderer.webgl, R = game.renderer, X = B.probe || null;
    let live = true, lastT = performance.now(), progs = W.info.programs ? W.info.programs.length : 0, drs0 = game.renderer.drs ? game.renderer.drs.scale : 1;
    const heap = () => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0);
    let heap0 = heap();
    const watch = () => {
      if (!live) return;
      const now = performance.now(), dt = now - lastT; lastT = now;
      const pn = W.info.programs ? W.info.programs.length : 0, ds = game.renderer.drs ? game.renderer.drs.scale : 1, hp = heap();
      if (dt > 100 && r.spikes.length < 40) {
        const lf = P.frames[P.frames.length - 1]; // this frame's [.., sim ms, render ms, .., steps]
        const np = W.info.programs ? W.info.programs.slice(progs).map((x) => (x.name || x.cacheKey.slice(0, 24)) + ' ' + x.cacheKey.slice(-90)) : [];
        r.spikes.push({ seg: segName, t: Math.round(now), ms: Math.round(dt), newProg: pn - progs, progNames: np.slice(0, 4), drs: ds !== drs0 ? `${drs0}>${ds}` : '', heapMB: `${heap0}>${hp}`, cpu: lf ? [lf[2], lf[3], lf[5]] : null, rsub: R._sub ? R._sub.map((x) => Math.round(x)) : null, sys: X ? X.take() : null, gl: X ? X.gl.filter((c) => c.t >= now - dt - 5).slice(-4) : null });
      }
      progs = pn; drs0 = ds; heap0 = hp;
      if (X) {
        X.take(); X.wrap(); X.segFrames++;
        const lf2 = P.frames[P.frames.length - 1]; if (lf2) X.segSteps += lf2[5];
        const sb = R._sub; if (sb) { const nm = ['r.patch', 'r.freeze', 'r.guard', 'r.scans', 'r.draw']; for (let k = 0; k < 5; k++) X.segAcc.set(nm[k], (X.segAcc.get(nm[k]) || 0) + sb[k]); }
      }
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
    await sleep(1500); // stage card / reveal settles
    if (B.fd) { B.fd.armed = true; B.fd.list = []; }
    r.combat = stats(await seg(B.secs * 1000, 'combat'));
    r.drs.push(game.renderer.drs ? game.renderer.drs.scale : 1);
    d.cast(1, 9);
    r.cast = stats(await seg(4000, 'cast'));
    // boss arena: clear the remaining screens and start the boss wave (as the perf scenarios do)
    const last = L.screens.length - 1;
    for (let k = L.screenIndex; k < last; k++) { d.kill('enemies'); L.waveActors.clear(); }
    for (const h of game.world.query({ kind: 'hero' })) h.pos.x = L.screens[last].x[0] + 3;
    L.pendingSpawns = 0; L.waveActors.clear(); L.enterScreen(last);
    if (game.cameraRig && game.cameraRig.snap) game.cameraRig.snap();
    L.waveActors.clear(); L.pendingSpawns = 0; L.waveIndex = (L.screens[last].waves || []).length - 1; L.nextWave();
    let intro = false; const off = game.bus.on ? game.bus.on('bossIntro', () => { intro = true; }) : null;
    const t0 = performance.now();
    while (!intro && performance.now() - t0 < 45000) {
      for (const a of L.waveActors) if (a.alive && !a.inStage && !(a.kind === 'boss' || (a.def && a.def.boss))) { a.hp = 0; try { a.kill && a.kill(); } catch (e) { /* ignore */ } }
      await sleep(250);
    }
    if (typeof off === 'function') off();
    const keep = setInterval(() => { for (const a of game.world.actors) if (a.kind === 'boss' || a.inStage || (a.def && a.def.boss)) { a.maxHp = Math.max(a.maxHp || 0, 99999); a.hp = 99999; } }, 300);
    r.boss = stats(await seg(8000, 'boss'));
    clearInterval(keep);
    r.drs.push(game.renderer.drs ? game.renderer.drs.scale : 1);
    live = false;
    if (B.fd) { r.firstDraw = B.fd.list.slice(0, 60); B.fd.armed = false; }
    B.results.push(r);
  }
}

function showCard(game, B) {
  const R = game.renderer, W = R.webgl, gl = W.getContext();
  let gpu = '';
  try { const x = gl.getExtension('WEBGL_debug_renderer_info'); gpu = x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : ''; } catch (e) { /* ignore */ }
  gpu = gpu.replace(/^ANGLE \(|\)$/g, '').replace(/Direct3D11.*$/, '').replace(/,\s*$/, '');
  const f = (s) => (s ? `<b>${s.med.toFixed(1)}</b><i>${s.low1.toFixed(1)}</i>` : '<b>—</b><i></i>');
  const cls = (s) => (!s ? '' : s.med <= 17.2 && s.low1 <= 25 ? 'ok' : s.med <= 17.2 ? 'warn' : 'bad');
  const rows = B.results.map((r) => `<tr><td class="st">Stage ${r.stage}</td><td class="${cls(r.combat)}">${f(r.combat)}</td><td class="${cls(r.cast)}">${f(r.cast)}</td><td class="${cls(r.boss)}">${f(r.boss)}</td><td class="drs">${r.drs.map((x) => Math.round(x * 100) + '%').join(' / ')}</td><td class="drs" title="CPU speed index per segment (1.00 = nominal clock)">${['combat', 'cast', 'boss'].map((k) => (r.cpu && r.cpu[k] != null ? r.cpu[k].toFixed(2) : '—')).join(' · ')}</td></tr>`).join('');
  const el = document.createElement('div');
  el.className = 'kca-bench';
  el.innerHTML = `<style>
.kca-bench{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:10000;background:radial-gradient(ellipse at center,rgba(20,11,6,.93),rgba(8,4,2,.985));font-family:Constantia,"Palatino Linotype",Georgia,serif;color:#f4e6c8}
.kca-bench .card{min-width:min(760px,94vw);padding:28px 34px 22px;background:linear-gradient(#2a1a0e,#140b06);border:2px solid #8a6034;box-shadow:0 0 0 1px #3a2412,0 18px 60px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,197,138,.25);border-radius:6px}
.kca-bench .hd{display:flex;justify-content:space-between;align-items:flex-end;gap:18px;margin-bottom:14px}
.kca-bench .meta{font-size:13px;color:#b89868;text-align:right;line-height:1.5}
.kca-bench table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
.kca-bench th{font-weight:400;font-variant:small-caps;letter-spacing:.08em;color:#b89868;font-size:14px;padding:6px 10px;border-bottom:1px solid #3a2412;text-align:right}
.kca-bench th:first-child,.kca-bench td.st{text-align:left}
.kca-bench td{padding:9px 10px;border-bottom:1px solid rgba(138,96,52,.25);text-align:right;font-size:15px}
.kca-bench td b{font-size:19px;color:#ffe0b0;margin-right:8px}.kca-bench td i{font-style:normal;color:#b89868;font-size:13px}
.kca-bench td.ok b{color:#9fe08a}.kca-bench td.warn b{color:#ffd070}.kca-bench td.bad b{color:#ff7a50}
.kca-bench td.drs{color:#b89868;font-size:13px}.kca-bench .ft{margin-top:14px;font-size:12px;color:#8a6a44;display:flex;justify-content:space-between}
</style><div class="card"><div class="hd">${forge('BENCHMARK', { metal: 'gold', height: 40 })}<div class="meta">Preset <b>${(game.quality.name || '').toUpperCase()}</b> · ${W.domElement.width}×${W.domElement.height} internal<br>${gpu}</div></div>
<table><tr><th>stage</th><th>combat ms · 1% low</th><th>top spell</th><th>boss</th><th>DRS</th><th>CPU ×</th></tr>${rows}</table>
<div class="ft"><span>median frame time · 1 %-low (ms) — 16.7 = 60 fps · CPU × = speed vs nominal clock (&lt; 0.8 = throttled, not comparable)${B.error ? ' · error: ' + B.error : ''}</span><span>R / click: run again</span></div></div>`;
  document.body.appendChild(el);
  const again = () => { location.reload(); };
  el.addEventListener('click', again);
  window.addEventListener('keydown', (e) => { if (e.key === 'r' || e.key === 'R') again(); });
}
