// C2 wrap QA (perf): cost of the PER-MATERIAL NaN guard (Renderer.installNanGuard: bit-test scrub in opaque_fragment +
// dithering_fragment — no runtime flag). A = the shipped shaders; B = every scene material recompiled with the two scrub
// blocks stripped from its fragment shader (onBeforeCompile wrapper → new program variants, compileAsync), same sim frame.
// GPU via the perfbench kit sampler (clean p25 → ≈1650 Ti ms). The post-pass guard (&nanguard=0) is A/B'd by perfbench.
//   node tools/capture.mjs --url "/?mode=stage&stage=1&p1=brann&p2=seraphine&bot=1&drs=0&quality=high&mute" --size 1920x1080 --warm 7000 --scenario tools/scenarios/nanguard_mat_ab.mjs --out <dir>
import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  const E = (fn, arg) => api.evalGame(fn, arg);
  const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
  const calib = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/perfbench.calib.json'), 'utf8'));
  await api.page.addScriptTag({ content: fs.readFileSync(path.join(ROOT, 'tools/perfbench.page.js'), 'utf8') });
  const info = await E(() => window.__PB.info());
  const key = Object.keys(calib).find((k) => k === info.renderer) || Object.keys(calib).find((k) => k.includes('5070'));
  const REF = Object.keys(calib).find((k) => k.includes('1650'));
  const calIdle = calib[key].calIdleMs, refScale = calib[REF].calIdleMs / calIdle;
  const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1) + 0.5)))] : null; };
  await E(() => { window.__KCA.debug.god && window.__KCA.debug.god(true); });
  const guarded = () => E(() => { const R = window.__KCA.game.renderer, W = R.webgl, gl = W.getContext(); let g = 0, n = 0, ug = 0, un = 0; const used = new Set(); R.scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) { const pr = m && W.properties.get(m); if (pr && pr.currentProgram) used.add(pr.currentProgram); } }); for (const p of W.info.programs) { if (!p.fragmentShader) continue; n++; const gd = gl.getShaderSource(p.fragmentShader).includes('0x7f800000u'); if (gd) g++; if (used.has(p)) { un++; if (gd) ug++; } } return { programs: n, guarded: g, usedBySceneMaterials: un, usedGuarded: ug }; });
  const sampleN = async (n) => {
    const acc = { clean: [], attempts: 0, rejected: 0, notClean: 0 };
    for (let i = 0; i < n * 4 && acc.clean.length < n; i++) {
      acc.attempts++;
      const r = await E(() => window.__PB.gpuSample({ frames: 2 }));
      if (!r || r.frame == null || !r.valid) { acc.rejected++; continue; }
      if (r.calMax > 1.3 * calIdle) { acc.notClean++; continue; }
      acc.clean.push(r.frame * calIdle / r.cal);
    }
    const est = acc.clean.length >= 4 ? +q(acc.clean, 0.25).toFixed(3) : null;
    return { n: acc.clean.length, attempts: acc.attempts, rejected: acc.rejected, notClean: acc.notClean, est5070: est, est1650: est != null ? +(est * refScale).toFixed(2) : null, clean: acc.clean.map((v) => +v.toFixed(3)) };
  };
  const measure = async (label) => {
    await E(() => window.__PB.gpuWarm()); await E(() => window.__PB.quietDom(true));
    const census = await E(() => window.__PB.census()); const gpu = await sampleN(24);
    await E(() => window.__PB.quietDom(false));
    const g = await guarded();
    api.log(`${label}: calls ${census.calls} tris ${census.triangles} programs ${g.programs} guarded ${g.guarded} gpu ${JSON.stringify({ ...gpu, clean: undefined })}`);
    return { census: { calls: census.calls, triangles: census.triangles, passPx: census.passPixels1080 }, gpu, programs: g };
  };
  // interleave: A, B, A, B (the B patch is applied once; A' re-applies the guard by restoring the materials)
  const A1 = await measure('A1 guarded');
  const patched = await E(async () => {
    const g = window.__KCA.game, R = g.renderer, W = R.webgl;
    // onBeforeCompile runs BEFORE #include expansion: swap the two guarded chunks' includes for three r186's ORIGINAL chunk text
    const OPAQUE_ORIG = '\n#ifdef OPAQUE\ndiffuseColor.a = 1.0;\n#endif\n\n#ifdef USE_TRANSMISSION\ndiffuseColor.a *= material.transmissionAlpha;\n#endif\n\ngl_FragColor = vec4( outgoingLight, diffuseColor.a );\n';
    const DITHER_ORIG = '\n#ifdef DITHERING\n\n\tgl_FragColor.rgb = dithering( gl_FragColor.rgb );\n\n#endif\n';
    const mats = new Set(); R.scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) if (m) mats.add(m); });
    let n = 0;
    for (const m of mats) {
      if (m.isShaderMaterial || m.isRawShaderMaterial) continue; // own shaders: no three chunk → not guarded
      if (m.__ngOrig) continue;
      const orig = m.onBeforeCompile; m.__ngOrig = orig || null;
      m.onBeforeCompile = function (sh, r) { if (orig) orig.call(this, sh, r); sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', OPAQUE_ORIG).replace('#include <dithering_fragment>', DITHER_ORIG); };
      m.__ngKey = m.customProgramCacheKey; m.customProgramCacheKey = (() => { const o = m.__ngKey; return function () { return 'noguard|' + (o ? o.call(this) : ''); }; })();
      m.needsUpdate = true; n++;
    }
    const t = performance.now();
    try { await W.compileAsync(R.scene, R.camera); } catch (e) { /* older three */ }
    for (let i = 0; i < 3; i++) R.render(1 / 60);
    return { materials: n, compileMs: Math.round(performance.now() - t) };
  });
  api.log('patched ' + JSON.stringify(patched));
  await E(() => window.__PB.absorbPrograms());
  const B1 = await measure('B1 stripped');
  const B2 = await measure('B2 stripped');
  const restored = await E(async () => {
    const g = window.__KCA.game, R = g.renderer, W = R.webgl; let n = 0;
    R.scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) if (m && m.__ngOrig !== undefined) { m.onBeforeCompile = m.__ngOrig || function () {}; delete m.__ngOrig; m.customProgramCacheKey = m.__ngKey; delete m.__ngKey; m.needsUpdate = true; n++; } });
    const t = performance.now(); try { await W.compileAsync(R.scene, R.camera); } catch (e) { /* */ } for (let i = 0; i < 3; i++) R.render(1 / 60);
    return { materials: n, compileMs: Math.round(performance.now() - t) };
  });
  api.log('restored ' + JSON.stringify(restored));
  const A2 = await measure('A2 guarded again');
  const a = q(A1.gpu.clean.concat(A2.gpu.clean), 0.25), b = q(B1.gpu.clean.concat(B2.gpu.clean), 0.25);
  const out = { renderer: info.renderer, refScale, A1, B1, B2, A2, patched, restored, pooled: { A_est1650: +(a * refScale).toFixed(2), B_est1650: +(b * refScale).toFixed(2), ratio: +(a / b).toFixed(3), deltaMs1650: +((a - b) * refScale).toFixed(2) }, errors: await E(() => window.__KCA.info().errors) };
  fs.writeFileSync(path.join(api.outDir, 'nanguard_mat_ab.json'), JSON.stringify(out, null, 1));
  api.log('summary ' + JSON.stringify(out.pooled));
  await api.shot('end');
};
