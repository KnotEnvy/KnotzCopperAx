// C2 wrap QA (perf): cost of the character-select 3D set (skeletal hands ≈ 50k tris each) — draw calls, tris, GPU ms via the
// perfbench kit's timer-query sampler (clean-sample p25, converted to ≈1650 Ti ms with tools/perfbench.calib.json), with the
// hands hidden as an A/B, JS per frame on the select screen, and the webfont status at __KCA.ready (font-timeout check).
//   node tools/capture.mjs --url "/?mode=title&quality=high" --size 1920x1080 --scenario tools/scenarios/select_hands_perf.mjs --out <dir>
import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  const E = (fn, arg) => api.evalGame(fn, arg);
  const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
  const calib = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/perfbench.calib.json'), 'utf8'));
  const flow = () => E(() => window.__KCA.game.flow.state);
  const press = async (p, a, wait = 250) => { await api.press(p, a, 60); await api.advance(wait); };
  const until = async (fn, ms = 20000, step = 250) => { for (let t = 0; t < ms; t += step) { if (await fn()) return true; await api.advance(step); } return false; };
  // webfont status at ready (font-display: block → text invisible until the face lands or the 3 s block timeout)
  const fonts = await api.page.evaluate(async () => {
    const F = document.fonts; const t0 = performance.now();
    const readyNow = await Promise.race([F.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 50))]);
    const faces = []; F.forEach((f) => faces.push(`${f.family} ${f.weight} ${f.style}: ${f.status}`));
    return { status: F.status, readyAlready: readyNow, waitedMs: +(performance.now() - t0).toFixed(1), kcaReadyAt: +window.__KCA._readyAt.toFixed(0), now: +performance.now().toFixed(0), faces, check700: F.check('700 16px "EB Garamond"'), check400: F.check('400 16px "EB Garamond"') };
  });
  api.log('fonts ' + JSON.stringify(fonts));
  await api.advance(800);
  await press(1, 'start', 600);
  await press(1, 'light', 400);
  await until(async () => (await flow()) === 'select');
  const hasSet = () => E(() => !!window.__KCA.game.renderer.scene.getObjectByName('selectSet'));
  if (!(await until(hasSet, 60000))) { api.log('NO selectSet'); return; }
  await api.advance(1500);
  await api.shot('select');
  await api.page.addScriptTag({ content: fs.readFileSync(path.join(ROOT, 'tools/perfbench.page.js'), 'utf8') });
  const info = await E(() => window.__PB.info());
  const key = Object.keys(calib).find((k) => k === info.renderer) || Object.keys(calib).find((k) => k.includes('5070'));
  const REF = Object.keys(calib).find((k) => k.includes('1650'));
  const calIdle = calib[key].calIdleMs, refScale = calib[REF].calIdleMs / calIdle;
  api.log(`renderer ${info.renderer} calIdle ${calIdle} refScale ${refScale.toFixed(3)}`);
  // scene census + hand geometry
  const census = await E(() => window.__PB.census());
  const hands = await E(() => {
    const set = window.__KCA.game.renderer.scene.getObjectByName('selectSet');
    const out = [], all = [];
    set.traverse((o) => { if (!o.isMesh) return; const g = o.geometry; const tris = Math.round((g.index ? g.index.count : g.attributes.position.count) / 3); const row = { name: o.name || o.type, tris, visible: o.visible, skinned: !!o.isSkinnedMesh, mat: o.material && (o.material.name || o.material.type), castShadow: o.castShadow }; all.push(row); if (tris >= 40000 || /hand/i.test(o.name || '')) out.push(row); });
    all.sort((a, b) => b.tris - a.tris);
    return { hands: out, top: all.slice(0, 12), meshes: all.length, totalTris: all.reduce((s, r) => s + (r.visible ? r.tris : 0), 0) };
  });
  api.log('census ' + JSON.stringify({ calls: census.calls, tris: census.triangles, passPx: census.passPixels1080, casters: census.casters, lights: census.lights, pointLights: census.pointLights, programs: census.programs, skinned: census.skinned, bones: census.bones, texVisMB: census.texVisMB, rtMB: census.rtMB }));
  api.log('hands ' + JSON.stringify(hands));
  // JS per frame (manual clock, 1 s of select-screen time)
  await E(() => window.__PB.slicesOn());
  await E(() => window.__PB.takeSlices());
  await E(() => window.__PB.drive(1000));
  const sl = await E(() => window.__PB.takeSlices());
  const fr = sl.frames.map((f) => f[0]).sort((a, b) => a - b);
  const cpuCal = await E(() => { const a = []; for (let k = 0; k < 15; k++) a.push(window.__PB.cpuCal()); return a.sort((x, y) => x - y)[1]; });
  const kcpu = calib[REF].cpuCalIdleMs / cpuCal;
  const js = { frames: fr.length, p50: fr[fr.length >> 1], max: fr[fr.length - 1], p50Laptop: +(fr[fr.length >> 1] * kcpu).toFixed(1), maxLaptop: +(fr[fr.length - 1] * kcpu).toFixed(1), cpuCal, big: sl.big.slice(0, 3) };
  api.log('js ' + JSON.stringify(js));
  await E(() => window.__PB.takeSlices()); await E(() => window.__PB.drive(1000)); const sl2 = await E(() => window.__PB.takeSlices()); const fr2 = sl2.frames.map((f) => f[0]).sort((a, b) => a - b);
  js.second = { p50: fr2[fr2.length >> 1], max: fr2[fr2.length - 1], big: sl2.big.slice(0, 2) }; js.newProgAfterFirstDrive = await E(() => window.__PB.newPrograms());
  api.log('js2 ' + JSON.stringify(js.second) + ' newProg ' + JSON.stringify(js.newProgAfterFirstDrive));
  // GPU: clean-sample estimator, full set vs hands hidden (paired)
  const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1) + 0.5)))] : null; };
  const sample = async (hide) => {
    const r = await E(async (hide) => {
      const set = window.__KCA.game.renderer.scene.getObjectByName('selectSet'); const hid = [];
      if (hide) set.traverse((o) => { if (o.isMesh && o.visible && o.geometry && ((o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3 >= 40000)) { o.visible = false; hid.push(o); } });
      try { return await window.__PB.gpuSample({ frames: 2 }); } finally { for (const o of hid) o.visible = true; }
    }, hide);
    return r;
  };
  await E(() => window.__PB.gpuWarm());
  await E(() => window.__PB.quietDom(true));
  const acc = { full: [], nohands: [], attempts: 0, rejected: 0, notClean: 0 };
  for (let i = 0; i < 80 && (acc.full.length < 20 || acc.nohands.length < 20); i++) {
    acc.attempts++;
    for (const [k, hide] of [['full', false], ['nohands', true]]) {
      const r = await sample(hide);
      if (!r || r.frame == null || !r.valid) { acc.rejected++; continue; }
      if (r.calMax > 1.3 * calIdle) { acc.notClean++; continue; }
      acc[k].push(r.frame * calIdle / r.cal);
    }
  }
  await E(() => window.__PB.quietDom(false));
  const est = (a) => (a.length >= 4 ? +q(a, 0.25).toFixed(3) : null);
  const gpu = { full: { n: acc.full.length, est5070: est(acc.full), est1650: est(acc.full) != null ? +(est(acc.full) * refScale).toFixed(2) : null }, nohands: { n: acc.nohands.length, est5070: est(acc.nohands), est1650: est(acc.nohands) != null ? +(est(acc.nohands) * refScale).toFixed(2) : null }, attempts: acc.attempts, rejected: acc.rejected, notClean: acc.notClean };
  gpu.handsMs1650 = gpu.full.est1650 != null && gpu.nohands.est1650 != null ? +(gpu.full.est1650 - gpu.nohands.est1650).toFixed(2) : null;
  api.log('gpu ' + JSON.stringify(gpu));
  const newProg = await E(() => window.__PB.newPrograms());
  const errors = await E(() => window.__KCA.info().errors);
  fs.writeFileSync(path.join(api.outDir, 'select_hands.json'), JSON.stringify({ fonts, renderer: info.renderer, calIdle, refScale, census, hands, js, gpu, newProg, errors }, null, 1));
};
