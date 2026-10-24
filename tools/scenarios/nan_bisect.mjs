// Find the drawable that writes NaN/Inf into the HDR scene buffer (perf-1650, Wave C1). Steps the page STEP ms at a
// time (up to MAXF frames) until the freshly rendered HDR buffer (PostFX RenderPass output, read back as half floats)
// contains a non-finite pixel, then — with the sim frozen (advance(0) re-renders the identical frame) — bisects the
// visible drawables by hiding halves until one object is left whose hiding removes every non-finite pixel. Repeats for
// up to HITS distinct frames. Writes nan_bisect.json (object name, type, material type/name, parent chain, shader hints).
//   node tools/capture.mjs --url "/?mode=showcase&what=boss&id=morvane&scene=fight" --warm 5000 \
//     --scenario tools/scenarios/nan_bisect.mjs --out progress/shots/perf-1650/c1-render/nan-bisect-morvane
// env: STEP=50 MAXF=160 HITS=3
import fs from 'node:fs';
import path from 'node:path';

const STEP = Number(process.env.STEP || 50), MAXF = Number(process.env.MAXF || 160), HITS = Number(process.env.HITS || 3);

export default async (api) => {
  await api.evalGame(() => {
    const g = window.__KCA.game, R = g.renderer, rp = R.post.renderPass, orig = rp.render.bind(rp), W = R.webgl;
    window.__nb = { want: false, last: null };
    rp.render = function (renderer, inputBuffer, outputBuffer, dt, st) {
      const r = orig(renderer, inputBuffer, outputBuffer, dt, st);
      const H = window.__nb; if (!H.want) return r; H.want = false;
      const w = inputBuffer.width, h = inputBuffer.height, buf = new Uint16Array(w * h * 4);
      W.readRenderTargetPixels(inputBuffer, 0, 0, w, h, buf);
      let bad = 0; const at = [];
      for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) if (((buf[i * 4 + c] >> 10) & 31) === 31) { bad++; if (at.length < 4) at.push([i % w, h - 1 - Math.floor(i / w)]); break; }
      H.last = { bad, at };
      return r;
    };
  });
  const scan = async (ms) => { await api.evalGame(() => { window.__nb.want = true; }); await api.advance(ms); return api.evalGame(() => window.__nb.last); };
  const hits = [];
  for (let f = 0; f < MAXF && hits.length < HITS; f++) {
    const s = await scan(STEP);
    if (!s || !s.bad) continue;
    const again = await scan(0);
    const tick = await api.evalGame(() => window.__KCA.game.tick);
    if (!again.bad) { hits.push({ frame: f, tick, bad: s.bad, at: s.at, note: 'not reproducible on a re-render of the same tick' }); continue; }
    // collect visible drawables
    const n = await api.evalGame(() => {
      const g = window.__KCA.game, L = window.__nbList = [];
      g.renderer.scene.traverseVisible((o) => { if ((o.isMesh || o.isPoints || o.isLine || o.isSprite) && o.material) L.push(o); });
      return L.length;
    });
    let lo = 0, hi = n; // candidate range [lo, hi)
    let steps = 0;
    while (hi - lo > 1 && steps < 24) {
      steps++;
      const mid = (lo + hi) >> 1;
      await api.evalGame(([a, b]) => { for (let i = a; i < b; i++) window.__nbList[i].visible = false; }, [lo, mid]);
      const t = await scan(0);
      await api.evalGame(([a, b]) => { for (let i = a; i < b; i++) window.__nbList[i].visible = true; }, [lo, mid]);
      if (!t.bad) hi = mid; else lo = mid; // hiding [lo,mid) cleared it → culprit inside; else it is in [mid,hi)
    }
    const confirm = await api.evalGame(async (i) => { const o = window.__nbList[i]; o.visible = false; return true; }, lo);
    const t2 = await scan(0);
    await api.evalGame((i) => { window.__nbList[i].visible = true; }, lo);
    const desc = await api.evalGame((i) => {
      const o = window.__nbList[i], ms = [].concat(o.material), chain = [];
      for (let p = o; p && chain.length < 8; p = p.parent) chain.push((p.name || p.type) + (p.userData && p.userData.kind ? `{${p.userData.kind}}` : ''));
      return {
        name: o.name, type: o.type, chain: chain.join(' < '), renderOrder: o.renderOrder,
        materials: ms.map((m) => ({ type: m.type, name: m.name, transparent: m.transparent, blending: m.blending, custom: !!m.isShaderMaterial, defines: m.defines ? Object.keys(m.defines).slice(0, 12) : [], fragHead: m.isShaderMaterial ? String(m.fragmentShader).slice(0, 600) : null, uniforms: m.uniforms ? Object.keys(m.uniforms).slice(0, 30) : [], onBeforeCompile: !!(m.onBeforeCompile && m.onBeforeCompile.toString().length > 30) })),
        geom: o.geometry ? { type: o.geometry.type, verts: o.geometry.attributes.position ? o.geometry.attributes.position.count : 0, attrs: Object.keys(o.geometry.attributes) } : null,
      };
    }, lo);
    hits.push({ frame: f, tick, bad: s.bad, at: s.at, drawables: n, bisectSteps: steps, culpritIndex: lo, clearedWhenHidden: !t2.bad, culprit: desc });
    api.log(JSON.stringify(hits[hits.length - 1]).slice(0, 1500));
  }
  fs.writeFileSync(path.join(api.outDir, 'nan_bisect.json'), JSON.stringify({ step: STEP, hits }, null, 1));
};
