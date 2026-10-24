// GPU frame split by BURST timing (perf-1650 r2): full frame vs. frame without each post piece / shadow / env layer,
// interleaved A/B pairs with a busy warm-up so the laptop GPU stays at P0 clocks; median of pair differences.
//   node tools/capture.mjs --realtime --size 1920x1080 --host http://127.0.0.1:4167 \
//     --url "/?mode=stage&stage=5&p1=brann&bot=1&mute&drs=0" --scenario tools/scenarios/gpuparts.mjs --out <dir> --timeout 180000
// env: GP_ENV=1 (per env child census) · GP_K=7 pairs · GP_N=6 frames per burst · GP_WAIT=6000 · GP_ONLY=a,b · GP_CAST=1 (measure during a top-tier spell)
import fs from 'node:fs';
import path from 'node:path';
export default async (api) => {
  await api.evalGame(() => { const d = window.__KCA.debug; d.god(true); d.pots(1, 9); });
  await api.page.waitForTimeout(Number(process.env.GP_WAIT || 6000));
  if (process.env.GP_CAST === '1') { await api.evalGame(() => window.__KCA.debug.cast(1, 6)); await api.page.waitForTimeout(1200); }
  const K = Number(process.env.GP_K || 7), N = Number(process.env.GP_N || 6), ONLY = process.env.GP_ONLY ? process.env.GP_ONLY.split(',') : null;
  const names = await api.evalGame(async ({ K, N }) => {
    const g = window.__KCA.game, R = g.renderer, W = R.webgl, gl = W.getContext();
    g.setManualClock(true); // freeze the sim: identical frames
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const px = new Uint8Array(4);
    const sync = () => { W.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
    const L = R.lighting, sh = L.sun.shadow;
    const frame = () => { sh.needsUpdate = true; R.render(1 / 60); };
    const time = (fn) => { sync(); const t0 = performance.now(); for (let i = 0; i < N; i++) fn(); sync(); return (performance.now() - t0) / N; };
    const warm = () => { for (let i = 0; i < 6; i++) frame(); sync(); };
    const P = R.post, passes = P.composer.passes, smaaPass = passes[passes.length - 1] !== P.mainPass ? passes[passes.length - 1] : null;
    const toggles = {
      noShadowPass: [() => { R._noSh = true; }, () => { R._noSh = false; }],
      noPost: [() => { R.postEnabled = false; }, () => { R.postEnabled = true; }],
      noSMAA: [() => { if (smaaPass) { smaaPass.enabled = false; P.mainPass.renderToScreen = true; } }, () => { if (smaaPass) { smaaPass.enabled = true; P.mainPass.renderToScreen = false; } }],
      noBloomBlur: [() => { R._bb = P.bloom.mipmapBlurPass.enabled; P.bloom.mipmapBlurPass.enabled = false; P.bloom.luminancePass.enabled = false; }, () => { P.bloom.mipmapBlurPass.enabled = true; P.bloom.luminancePass.enabled = true; }],
      pr085: [() => { R._pr = W.getPixelRatio(); W.setPixelRatio(R._pr * 0.85); P.setSize(R.width, R.height); }, () => { W.setPixelRatio(R._pr); P.setSize(R.width, R.height); }],
      pr070: [() => { R._pr = W.getPixelRatio(); W.setPixelRatio(R._pr * 0.7); P.setSize(R.width, R.height); }, () => { W.setPixelRatio(R._pr); P.setSize(R.width, R.height); }],
      noEnv: [() => { R.envGroup.visible = false; }, () => { R.envGroup.visible = true; }],
      noActors: [() => { R._ha = []; for (const a of g.world.actors) if (a.view && a.view.visible) { a.view.visible = false; R._ha.push(a.view); } }, () => { for (const v of R._ha) v.visible = true; }],
      noVfx: [() => { g.vfx.group.visible = false; }, () => { g.vfx.group.visible = true; }],
      noTransparent: [() => { R._ht = []; R.scene.traverse((o) => { if (o.visible && o.material && [].concat(o.material).some((m) => m && m.transparent)) { o.visible = false; R._ht.push(o); } }); }, () => { for (const o of R._ht) o.visible = true; }],
      noSky: [() => { R._hs = R.scene.children.filter((c) => /sky/i.test(c.name) && c.visible); for (const c of R._hs) c.visible = false; }, () => { for (const c of R._hs) c.visible = true; }],
      noCasters: [() => { R._cs = []; R.scene.traverse((o) => { if (o.castShadow) { o.castShadow = false; R._cs.push(o); } }); }, () => { for (const o of R._cs) o.castShadow = true; }],
      noReceive: [() => { R._rs = []; R.scene.traverse((o) => { if (o.receiveShadow && o.material) { o.receiveShadow = false; R._rs.push(o); for (const m of [].concat(o.material)) m.needsUpdate = true; } }); }, () => { for (const o of R._rs) { o.receiveShadow = true; for (const m of [].concat(o.material)) m.needsUpdate = true; } }],
    };
    // post passes one by one (output is wrong while skipped; only the timing matters) + bloom's own blur chain
    passes.forEach((ps, i) => { if (i === 0) return; const nm = 'skip' + i + '_' + (ps.name || 'pass'); toggles[nm] = [() => { ps._r = ps.render; ps.render = () => {}; }, () => { ps.render = ps._r; }]; });
    toggles.skipBloomUpdate = [() => { P.bloom._u = P.bloom.update; P.bloom.update = () => {}; }, () => { P.bloom.update = P.bloom._u; }];
    toggles.halfBloom = [() => { P.bloom._rs = P.bloom.resolution.scale; P.bloom.resolution.scale = P.bloom._rs * 0.5; }, () => { P.bloom.resolution.scale = P.bloom._rs; }];
    // shadow pass skip hook
    const smR = W.shadowMap.render.bind(W.shadowMap);
    W.shadowMap.render = (...a) => { if (R._noSh) return; return smR(...a); };
    // per-env-child census (top level)
    const envKids = R.envGroup.children.filter((c) => c.visible);
    const out = { size: [R.width, R.height], pr: W.getPixelRatio(), rows: {}, env: [] };
    warm();
    const base = []; for (let i = 0; i < 3; i++) base.push(time(frame));
    out.full = Math.min(...base);
    const measure = async (on, off) => {
      const d = [];
      for (let k = 0; k < K; k++) {
        warm(); const a = time(frame); on(); warm(); const b = time(frame); off(); d.push(a - b);
        await sleep(0);
      }
      d.sort((x, y) => x - y); return Math.round(d[d.length >> 1] * 100) / 100;
    };
    window.__GP = { toggles, measure, out, envKids, smR, finish: () => { W.shadowMap.render = smR; g.setManualClock(false); } };
    return Object.keys(toggles);
  }, { K, N });
  for (const n of names) {
    if (ONLY && !ONLY.includes(n)) continue;
    const v = await api.evalGame(async (n) => { const G = window.__GP; const [on, off] = G.toggles[n]; return G.measure(on, off); }, n);
    api.log(`GP ${n} ${v}`);
    await api.evalGame((a) => { window.__GP.out.rows[a[0]] = a[1]; }, [n, v]);
  }
  const r = await api.evalGame(async (ENV) => {
    const G = window.__GP, out = G.out, measure = G.measure, envKids = G.envKids;
    if (ENV) {
      for (const c of envKids) {
        let tris = 0; c.traverse((x) => { if (x.isMesh && x.geometry) { const gg = x.geometry; tris += (gg.index ? gg.index.count : (gg.attributes.position ? gg.attributes.position.count : 0)) / 3 * (x.isInstancedMesh ? x.count : 1); } });
        const mats = [...new Set((() => { const a = []; c.traverse((x) => { if (x.material) for (const m of [].concat(x.material)) a.push((m.transparent ? 'T:' : '') + m.type.replace('Material', '') + (m.name ? ':' + m.name : '')); }); return a; })())].slice(0, 3).join(',');
        const v = await measure(() => { c.visible = false; }, () => { c.visible = true; });
        out.env.push([v, c.name || c.type, Math.round(tris / 1000) + 'k', mats]);
      }
      out.env.sort((a, b) => b[0] - a[0]);
    }
    G.finish();
    return out;
  }, process.env.GP_ENV === '1');
  api.log(JSON.stringify(r, null, 1));
  fs.writeFileSync(path.join(api.outDir, 'gpuparts.json'), JSON.stringify(r, null, 1));
};
