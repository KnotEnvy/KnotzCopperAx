// GPU cost census by BURST timing (perf-1650): renders the live scene N× back-to-back inside one timer query (robust
// against CPU starvation bubbles), with each env/scene object hidden in turn → per-object GPU cost incl. occlusion.
// Also times the post chain alone and the shadow pass. Quiet-machine-independent enough to rank costs.
//   node tools/capture.mjs --realtime --size 1920x1080 --url "/?mode=stage&stage=3&p1=brann&bot=1&mute" --scenario tools/scenarios/gpuburst.mjs --out <dir>
import fs from 'node:fs';
import path from 'node:path';
export default async (api) => {
  await api.page.waitForTimeout(Number(process.env.GB_WAIT || 6000));
  const r = await api.evalGame(async ({ depth, K }) => {
    const g = window.__KCA.game, R = g.renderer, W = R.webgl, gl = W.getContext();
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!ext) return { error: 'no timer ext' };
    g.setManualClock(true); // freeze the sim while we measure
    const tgt = R.post.composer.inputBuffer;
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const px = new Uint8Array(4);
    const sync = () => { W.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
    const time = async (fn, n = 8) => {
      sync(); await sleep(0);
      const t0 = performance.now();
      for (let i = 0; i < n; i++) fn();
      sync();
      return (performance.now() - t0) / n;
    };
    const best = async (fn, k = 5) => { let m = Infinity; for (let i = 0; i < k; i++) { const v = await time(fn); if (v < m) m = v; } return m; };
    const sm = W.shadowMap;
    const sceneOnly = () => { sm.needsUpdate = false; W.setRenderTarget(tgt); W.render(R.scene, R.camera); };
    const smWas = [sm.autoUpdate, g.renderer.lighting.sun.shadow.autoUpdate];
    g.renderer.lighting.sun.shadow.autoUpdate = false; g.renderer.lighting.sun.shadow.needsUpdate = false;
    // warm
    sceneOnly(); R.render(1 / 60); await sleep(50);
    const out = { size: [R.width, R.height], pr: W.getPixelRatio() };
    out.scene = await best(sceneOnly);
    out.shadow = await best(() => { g.renderer.lighting.sun.shadow.needsUpdate = true; W.setRenderTarget(tgt); W.render(R.scene, R.camera); }) - out.scene;
    out.fullFrame = await best(() => R.render(1 / 60));
    out.post = out.fullFrame - out.scene;
    // per object
    const cands = [];
    const walk = (o, d, pre) => { for (const c of o.children) { if (!c.visible || c.isLight) continue; let n = 0, lights = 0; c.traverse((x) => { n++; if (x.isLight) lights++; }); if (lights) { if (d < depth) walk(c, d + 1, pre + (c.name || c.type) + '/'); continue; } cands.push([pre + (c.name || c.type) + `(${n})`, c]); if (d < depth && n > 30) walk(c, d + 1, pre + (c.name || c.type) + '/'); } };
    walk(R.scene, 0, '');
    const res = [];
    for (const [name, c] of cands) {
      // interleaved pairs, median of differences (robust to drift and bursts of contention)
      const diffs = [];
      for (let k = 0; k < (K || 7); k++) { const a = await time(sceneOnly, 6); c.visible = false; const b = await time(sceneOnly, 6); c.visible = true; diffs.push(a - b); }
      diffs.sort((x, y) => x - y);
      const b0 = diffs[diffs.length >> 1], t = 0;
      let tris = 0; c.traverse((x) => { if (x.isMesh && x.geometry) { const gg = x.geometry; const n = gg.index ? gg.index.count / 3 : (gg.attributes.position ? gg.attributes.position.count / 3 : 0); tris += n * (x.isInstancedMesh ? x.count : 1); } });
      const tr = [...new Set((() => { const a = []; c.traverse((x) => { if (x.material) for (const m of [].concat(x.material)) a.push((m.transparent ? 'T:' : '') + m.type.replace('Material', '') + (m.name ? ':' + m.name : '')); }); return a; })())].slice(0, 3).join(',');
      res.push([Math.round(b0 * 100) / 100, name, Math.round(tris / 1000) + 'k', tr]);
    }
    res.sort((a, b) => b[0] - a[0]);
    out.objects = res.slice(0, 40);
    // post pieces: toggle effects that can be switched without relinking
    const P = R.post;
    const bl = P.bloom; const blWas = bl.blendMode.opacity.value;
    g.renderer.lighting.sun.shadow.autoUpdate = smWas[1];
    g.setManualClock(false);
    return out;
  }, { depth: Number(process.env.GB_DEPTH || 2), K: Number(process.env.GB_K || 7) });
  api.log(JSON.stringify(r, null, 1));
  fs.writeFileSync(path.join(api.outDir, 'gpuburst.json'), JSON.stringify(r, null, 1));
};
