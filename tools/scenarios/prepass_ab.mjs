// perf-1650 C2: render-path A/B on ONE frozen sim frame, same page. After PA_MS of seeded bot play (manual clock) the sim
// stops; each mode re-renders the identical frame (grain clock pinned) and reads the canvas back (gl.readPixels in the same
// task), then every pair of modes is diffed. Modes (PA_MODES, comma list; flags combine with '+', e.g. pulse+nofold):
//   new      the current tree as shipped
//   off      depth pre-pass disabled (R.prepass.enabled = false)
//   old      pre-pass as before C2: its own depth-only renderer.render() BEFORE the colour render (clear, pre, colour)
//   nofold   PostFX folds off (post.fold.ca / post.fold.bloom = false) — C2 post-chain folds A/B
//   pulse    forces a chromatic-aberration pulse (PA_CA, default 0.008)
// Also prints the perfbench kit census (passPx + pass table) per mode, and saves frame_<mode>.png.
//   node tools/capture.mjs --url "/?mode=stage&stage=4&p1=brann&p2=seraphine&bot=1&seed=1&drs=0" --size 1920x1080 --scenario tools/scenarios/prepass_ab.mjs --out <dir>
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

export default async (api) => {
  const E = (fn, arg) => api.evalGame(fn, arg);
  const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
  const MS = Number(process.env.PA_MS || 6000);
  const MODES = String(process.env.PA_MODES || 'new,off,old').split(',').map((s) => s.trim()).filter(Boolean);
  await E(() => window.__KCA.debug.god(true));
  for (let t = 0; t < MS; t += 500) await api.advance(500);
  // …then ~1.5 s of single-frame steps: StaticFreeze freezes env pieces after ~60 RENDERED frames and only frozen pieces
  // are flagged for the pre-pass (advance(500) renders one frame per call)
  for (let i = 0; i < 90; i++) await api.advance(17);
  await api.page.addScriptTag({ content: fs.readFileSync(path.join(ROOT, 'tools/perfbench.page.js'), 'utf8') });
  const res = [];
  for (const mode of MODES) {
    const r = await E(({ mode, ca }) => {
      const g = window.__KCA.game, R = g.renderer, W = R.webgl, gl = W.getContext(), post = R.post, pre = R.prepass;
      const rp = post && post.renderPass;
      // restore everything, then apply this mode
      const X = window.__PA || (window.__PA = { rpRender: rp ? rp.render : null });
      if (rp) rp.render = X.rpRender;
      if (pre) pre.enabled = true;
      if (post && post.fold) { post.fold.ca = X.foldCa ?? post.fold.ca; post.fold.bloom = X.foldBloom ?? post.fold.bloom; X.foldCa = post.fold.ca; X.foldBloom = post.fold.bloom; }
      const F = new Set(mode.split('+'));
      X.pulse = 0;
      if (F.has('off') && pre) pre.enabled = false;
      if (F.has('old') && pre && rp) {
        const orig = rp.render.bind(rp), base = Object.getPrototypeOf(rp).render.bind(rp);
        rp.render = (renderer, inputBuffer, outputBuffer, dt, st) => {
          if (!pre.enabled || !pre.count || rp.renderToScreen || !rp.clearPass.enabled) return base(renderer, inputBuffer, outputBuffer, dt, st);
          rp.clearPass.render(renderer, inputBuffer);
          renderer.setRenderTarget(inputBuffer);
          pre.render(renderer, rp.scene, rp.camera);
          rp.clearPass.enabled = false;
          try { return base(renderer, inputBuffer, outputBuffer, dt, st); } finally { rp.clearPass.enabled = true; }
        };
        void orig;
      }
      if (F.has('nofold') && post && post.fold) { post.fold.ca = false; post.fold.bloom = false; }
      if (F.has('nofoldca') && post && post.fold) post.fold.ca = false;
      if (F.has('nofoldbloom') && post && post.fold) post.fold.bloom = false;
      if (F.has('pulse') && post) X.pulse = ca;
      if (!X.pulse && post) { post._pulse = null; if (post.caPass) post.caPass.enabled = false; }
      const gt = post && post.grade && post.grade.uniforms.get('gtime');
      const frame = () => {
        if (gt) gt.value = 100;
        if (X.pulse && post) { post._pulse = { ca: X.pulse, flash: 0, desat: 0, duration: 1e9, t: 0 }; }
        R.render(0);
      };
      frame(); frame();
      const c = window.__PB.census(frame);
      frame();
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, buf = new Uint8Array(w * h * 4);
      W.setRenderTarget(null);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      (X.bufs || (X.bufs = {}))[mode] = buf;
      let b64 = ''; { const CH = 0x8000; let s = ''; for (let i = 0; i < buf.length; i += CH) s += String.fromCharCode.apply(null, buf.subarray(i, i + CH)); b64 = btoa(s); }
      return { mode, w, h, calls: c.calls, passPx: c.passPixels1080, passes: c.passes, passTable: c.passTable, programs: c.programs, pre: pre ? { enabled: pre.enabled, count: pre.count, drawn: pre.drawn, skipped: pre.skipped } : null, b64 };
    }, { mode, ca: Number(process.env.PA_CA || 0.008) });
    const raw = Buffer.from(r.b64, 'base64');
    // readPixels is bottom-up: flip rows for the PNG
    const row = r.w * 4, flip = Buffer.alloc(raw.length);
    for (let y = 0; y < r.h; y++) raw.copy(flip, (r.h - 1 - y) * row, y * row, (y + 1) * row);
    await sharp(flip, { raw: { width: r.w, height: r.h, channels: 4 } }).removeAlpha().png().toFile(path.join(api.outDir, `frame_${mode}.png`));
    delete r.b64;
    api.log(`${mode}: calls ${r.calls} passPx ${r.passPx} passes ${r.passes} programs ${r.programs} pre ${JSON.stringify(r.pre)}`);
    api.log(`${mode}: passTable ${r.passTable}`);
    res.push(r);
  }
  // every pair of modes (in-page buffers)
  const d = await E((modes) => {
    const X = window.__PA, out = {};
    for (let i = 0; i < modes.length; i++) for (let j = i + 1; j < modes.length; j++) {
      const a = X.bufs[modes[i]], b = X.bufs[modes[j]]; let sum = 0, max = 0, over = 0, over2 = 0;
      for (let q = 0; q < a.length; q += 4) { let mm = 0; for (let c = 0; c < 3; c++) { const v = Math.abs(a[q + c] - b[q + c]); sum += v; if (v > mm) mm = v; } if (mm > max) max = mm; if (mm > 8) over++; if (mm > 2) over2++; }
      out[modes[i] + ' vs ' + modes[j]] = { meanAbs: +(sum / (a.length * 0.75)).toFixed(4), max, over2Share: +(over2 / (a.length / 4)).toFixed(6), over8: over };
    }
    return out;
  }, MODES);
  for (const [k, v] of Object.entries(d)) api.log(`diff ${k}: ${JSON.stringify(v)}`);
  // PA_TIME=1: main-thread JS of R.render on this frozen frame, new vs old pre-pass path, interleaved (8 rounds × 30 frames)
  let timing = null;
  if (process.env.PA_TIME === '1') {
    timing = await E(() => {
      const g = window.__KCA.game, R = g.renderer, pre = R.prepass, rp = R.post.renderPass, X = window.__PA;
      rp.render = X.rpRender; if (R.post.fold) { R.post.fold.ca = true; R.post.fold.bloom = true; } R.post._pulse = null;
      const t = { new: [], old: [] };
      for (let round = 0; round < 8; round++) for (const m of ['new', 'old']) {
        pre.enabled = true; pre.legacy = m === 'old';
        for (let i = 0; i < 30; i++) { const t0 = performance.now(); R.render(1 / 60); t[m].push(performance.now() - t0); }
      }
      pre.legacy = false;
      const med = (a) => { const b = [...a].sort((x, y) => x - y); return +b[b.length >> 1].toFixed(3); };
      const p25 = (a) => { const b = [...a].sort((x, y) => x - y); return +b[b.length >> 2].toFixed(3); };
      return { newMed: med(t.new), oldMed: med(t.old), newP25: p25(t.new), oldP25: p25(t.old), n: t.new.length, prepassDrawn: pre.drawn, count: pre.count };
    });
    api.log('R.render JS ms (frozen frame, interleaved): ' + JSON.stringify(timing));
  }
  fs.writeFileSync(path.join(api.outDir, 'prepass_ab.json'), JSON.stringify({ modes: res, diff: d, timing }, null, 1));
};
