// HDR scene-buffer scan (perf-1650, Wave C1 renderer stability). Wraps PostFX's RenderPass so that, on every captured
// frame, the freshly rendered half-float HDR buffer (the post chain's input, BEFORE the NaN guard) is read back and
// scanned: non-finite pixels (NaN / Inf, with the first coordinates found), max finite value, 99.9th percentile
// luminance, and how many pixels exceed the bloom-input cap (1024). Answers "does real gameplay put NaN/Inf into the
// post chain, and where" for the one-frame black frames, and sanity-checks the caps. Slow (full readback per frame).
//   node tools/capture.mjs --url "/?mode=showcase&what=ai&id=crowd&p2=seraphine" --warm 8000 \
//     --scenario tools/scenarios/hdr_scan.mjs --out progress/shots/perf-1650/c1-render/hdr-crowd
// env: N=150 STEP=33 SHOTS=0 (1 = also save a PNG per frame)
import fs from 'node:fs';
import path from 'node:path';

const N = Number(process.env.N || 150), STEP = Number(process.env.STEP || 33), SHOTS = process.env.SHOTS === '1';

export default async (api) => {
  const ok = await api.evalGame(() => {
    const g = window.__KCA.game, R = g.renderer, post = R.post;
    if (!post || !post.renderPass) return 'no post';
    const rp = post.renderPass, orig = rp.render.bind(rp), W = R.webgl;
    // half → float (exponent 31 = non-finite)
    const h2f = (h) => { const e = (h >> 10) & 31, m = h & 1023, s = h & 0x8000 ? -1 : 1; return e === 0 ? s * m * 2 ** -24 : s * (1 + m / 1024) * 2 ** (e - 15); };
    window.__hdr = { rows: [], want: false };
    rp.render = function (renderer, inputBuffer, outputBuffer, dt, st) {
      const r = orig(renderer, inputBuffer, outputBuffer, dt, st);
      const H = window.__hdr;
      if (!H.want) return r;
      H.want = false;
      const w = inputBuffer.width, h = inputBuffer.height, buf = new Uint16Array(w * h * 4);
      try { W.readRenderTargetPixels(inputBuffer, 0, 0, w, h, buf); } catch (e) { H.rows.push({ err: String(e) }); return r; }
      let nan = 0, inf = 0, max = 0, overCap = 0, neg = 0; const first = [];
      const hist = new Uint32Array(64); // log2 buckets of luminance
      for (let i = 0; i < w * h; i++) {
        let bad = false, lum = 0;
        for (let c = 0; c < 3; c++) {
          const v = buf[i * 4 + c];
          if (((v >> 10) & 31) === 31) { bad = true; if (v & 1023) nan++; else inf++; continue; }
          const f = h2f(v); if (f < 0) neg++; if (f > max) max = f;
          lum += f * (c === 0 ? 0.2126 : c === 1 ? 0.7152 : 0.0722);
        }
        if (bad) { if (first.length < 6) first.push([i % w, h - 1 - Math.floor(i / w)]); continue; }
        if (lum > 1024) overCap++;
        hist[Math.max(0, Math.min(63, Math.floor(Math.log2(Math.max(lum, 1e-9)) + 32)))]++;
      }
      // 99.9th percentile luminance from the histogram (bucket upper edge)
      let acc = 0, p999 = 0; const tot = w * h;
      for (let b = 0; b < 64; b++) { acc += hist[b]; if (acc >= tot * 0.999) { p999 = 2 ** (b - 31); break; } }
      H.rows.push({ tick: g.tick, w, h, nan, inf, neg, max: +max.toFixed(2), p999, overCap, first });
      return r;
    };
    return 'ok';
  });
  api.log('hook ' + ok);
  const rows = [];
  for (let i = 0; i < N; i++) {
    await api.evalGame(() => { window.__hdr.want = true; });
    if (SHOTS) await api.frames(1, STEP); else await api.advance(STEP);
    const r = await api.evalGame(() => window.__hdr.rows.pop() || null);
    rows.push({ i, ...(r || { missing: true }) });
  }
  const bad = rows.filter((r) => r.nan || r.inf);
  const out = {
    frames: rows.length, framesWithNonFinite: bad.length, totalNaN: rows.reduce((s, r) => s + (r.nan || 0), 0), totalInf: rows.reduce((s, r) => s + (r.inf || 0), 0),
    maxFinite: Math.max(...rows.map((r) => r.max || 0)), maxP999: Math.max(...rows.map((r) => r.p999 || 0)), framesOverBloomCap: rows.filter((r) => r.overCap).length,
    bad: bad.slice(0, 20), rows,
  };
  fs.writeFileSync(path.join(api.outDir, 'hdr_scan.json'), JSON.stringify(out, null, 1));
  api.log(JSON.stringify({ frames: out.frames, framesWithNonFinite: out.framesWithNonFinite, totalNaN: out.totalNaN, totalInf: out.totalInf, maxFinite: out.maxFinite, maxP999: out.maxP999, framesOverBloomCap: out.framesOverBloomCap, bad: out.bad.slice(0, 5) }));
};
