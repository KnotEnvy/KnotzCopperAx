// NaN / Inf containment repro (perf-1650, Wave C1 renderer stability). Draws a tiny screen-centred quad whose fragment
// shader writes NaN (0/0), +Inf (1/0) or an over-range value (1e6 → Inf once stored in the half-float HDR target), or a
// MeshBasicMaterial with a NaN colour (exercises the per-material guard in Renderer.installNanGuard). Takes a reference
// frame, then INJECT_FRAMES frames per kind, then a clean frame, and measures how much of the frame went black
// (pixels whose luma dropped below 3 while the reference was ≥ 12). No game code is touched: three is imported from
// the exact URL the page already loaded (same module instance).
//   node tools/capture.mjs --url "/?mode=stage&stage=1&p1=brann&bot=1&seed=3" --warm 9000 \
//     --scenario tools/scenarios/nan_inject.mjs --out progress/shots/perf-1650/c1-render/nan-before
// env: KINDS=nan,inf,big,matnan  PX=6 (quad size in px)  INJECT_FRAMES=3
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const KINDS = String(process.env.KINDS || 'nan,inf,big,matnan').split(',');
const PX = Number(process.env.PX || 6);
const NF = Number(process.env.INJECT_FRAMES || 3);

async function lumaOf(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height, L = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) { const l = 0.2126 * data[i * 3] + 0.7152 * data[i * 3 + 1] + 0.0722 * data[i * 3 + 2]; L[i] = l; sum += l; }
  return { L, mean: sum / n, w: info.width, h: info.height };
}

export default async (api) => {
  const setup = await api.evalGame(async ({ px }) => {
    const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /\/node_modules\/\.vite\/deps\/three\.js/.test(n));
    if (!url) return { err: 'three dep url not found' };
    const THREE = await import(url);
    const g = window.__KCA.game, R = g.renderer;
    const frag = 'uniform float uA; uniform float uB; void main() { gl_FragColor = vec4(vec3(uA / uB), 1.0); }';
    const vert = 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
    const raw = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: { uA: { value: 0 }, uB: { value: 0 } }, depthTest: false, depthWrite: false, toneMapped: false });
    const basic = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false });
    const q = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), raw);
    q.name = 'kca-nan-probe'; q.frustumCulled = false; q.renderOrder = 1e7; q.matrixAutoUpdate = false; q.visible = false;
    const T = new THREE.Matrix4(), S = new THREE.Matrix4();
    q.onBeforeRender = (r, scene, cam) => {
      const d = 2, hPx = R.height || innerHeight;
      const world = 2 * d * Math.tan(THREE.MathUtils.degToRad(cam.fov || 40) / 2) * (px / hPx);
      T.makeTranslation(0, 0, -d); S.makeScale(world, world, 1);
      q.matrixWorld.copy(cam.matrixWorld).multiply(T).multiply(S);
    };
    R.scene.add(q);
    window.__nanProbe = {
      set(kind) {
        q.visible = !!kind;
        if (!kind) return;
        q.material = kind === 'matnan' ? basic : raw;
        if (kind === 'matnan') basic.color.setRGB(NaN, NaN, NaN);
        if (kind === 'nan') { raw.uniforms.uA.value = 0; raw.uniforms.uB.value = 0; }
        if (kind === 'inf') { raw.uniforms.uA.value = 1; raw.uniforms.uB.value = 0; }
        if (kind === 'big') { raw.uniforms.uA.value = 1e6; raw.uniforms.uB.value = 1; }
      },
    };
    // link both programs now (the program guard would otherwise hide the probe until it links in the background)
    for (const m of [raw, basic]) { q.material = m; q.visible = true; try { R.webgl.compile(q, g.camera); } catch (e) { /* ignore */ } }
    q.visible = false;
    return { ok: true, url, programs: R.webgl.info.programs.length };
  }, { px: PX });
  api.log('setup ' + JSON.stringify(setup));
  if (setup.err) throw new Error(setup.err);
  // warm the probe programs through a few hidden + visible frames so the guard has linked them
  for (const k of ['nan', 'matnan', null]) { await api.evalGame((kk) => window.__nanProbe.set(kk), k); await api.advance(33); await api.advance(33); }
  await api.evalGame(() => window.__nanProbe.set(null));
  await api.advance(0);
  const ref = await api.shot('ref');
  const R0 = await lumaOf(ref);
  const rows = [];
  for (const kind of KINDS) {
    await api.evalGame((kk) => window.__nanProbe.set(kk), kind);
    for (let i = 0; i < NF; i++) {
      await api.advance(0); // sim frozen: frames differ from ref only by the probe (+ film grain)
      const f = await api.shot(`${kind}_${i}`);
      const A = await lumaOf(f);
      let black = 0, cand = 0;
      for (let p = 0; p < A.L.length; p++) if (R0.L[p] >= 12) { cand++; if (A.L[p] < 3) black++; }
      rows.push({ kind, frame: i, file: path.relative(process.cwd(), f), mean: +A.mean.toFixed(2), refMean: +R0.mean.toFixed(2), blackFrac: +(black / Math.max(1, cand)).toFixed(5), blackPx: black });
    }
    await api.evalGame(() => window.__nanProbe.set(null));
    await api.advance(0);
  }
  const after = await api.shot('clean_after');
  const C = await lumaOf(after);
  const info = await api.evalGame(() => ({ programs: window.__KCA.game.renderer.webgl.info.programs.length, guard: !!window.__KCA.game.renderer.post && !!window.__KCA.game.renderer.post.nanGuard }));
  const out = { px: PX, setup, rows, cleanAfterMean: +C.mean.toFixed(2), info };
  fs.writeFileSync(path.join(api.outDir, 'nan_inject.json'), JSON.stringify(out, null, 1));
  api.log(JSON.stringify(rows.map((r) => [r.kind, r.frame, r.blackFrac, r.mean])));
};
