// C2 wrap QA (perf): stage-4 lightning — GPU cost of a flash frame vs a no-flash frame (same sim frame, storm flash held
// at its envelope peak; perfbench kit timer-query sampler, clean p25 → ≈1650 Ti ms), the JS cost of the strike frame
// (bolt geometry build) and a luma check of the flash frame (no white-out).
//   node tools/capture.mjs --url "/?mode=stage&stage=4&p1=brann&p2=seraphine&bot=1&drs=0&quality=high&mute" --size 1920x1080 --warm 7000 --scenario tools/scenarios/s4_flash_perf.mjs --out <dir>
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

async function luma(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height; let s = 0, white = 0;
  for (let i = 0; i < n; i++) { const l = 0.2126 * data[i * 3] + 0.7152 * data[i * 3 + 1] + 0.0722 * data[i * 3 + 2]; s += l; if (l > 245) white++; }
  return { mean: +(s / n).toFixed(1), whitePct: +(100 * white / n).toFixed(2) };
}

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
  const ok = await E(() => !!(window.__KCA.game.levels.env && window.__KCA.game.levels.env.storm));
  if (!ok) { api.log('NO storm in levels.env'); return; }
  // hold off random strikes, let any running envelope finish
  await E(() => { window.__KCA.game.levels.env.storm.quiet(9999); window.__KCA.debug.god && window.__KCA.debug.god(true); });
  await E(() => window.__PB.slicesOn());
  for (let i = 0; i < 80; i++) { await api.advance(16.667); if ((await E(() => window.__KCA.game.levels.env.storm.flash)) === 0) break; }
  const flash0 = await E(() => window.__KCA.game.levels.env.storm.flash);
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
    return { n: acc.clean.length, attempts: acc.attempts, rejected: acc.rejected, notClean: acc.notClean, est5070: est, est1650: est != null ? +(est * refScale).toFixed(2) : null };
  };
  await E(() => window.__PB.gpuWarm());
  await E(() => window.__PB.quietDom(true));
  const censusBase = await E(() => window.__PB.census());
  const base = await sampleN(20);
  await E(() => window.__PB.quietDom(false));
  const f0 = await api.shot('flash_off'); const l0 = await luma(f0);
  api.log(`base flash=${flash0} calls ${censusBase.calls} tris ${censusBase.triangles} gpu ${JSON.stringify(base)} luma ${JSON.stringify(l0)}`);
  // strike at full power, step the envelope to its peak (t = 0.09 s → level 1.0) in 15 ms steps
  await E(() => window.__PB.takeSlices());
  await E(() => window.__KCA.game.levels.env.storm.strike({ power: 1 }));
  await api.advance(15);
  const slStrike = await E(() => window.__PB.takeSlices());
  for (let i = 0; i < 5; i++) await api.advance(15);
  const flash1 = await E(() => window.__KCA.game.levels.env.storm.flash);
  await E(() => window.__PB.gpuWarm());
  await E(() => window.__PB.quietDom(true));
  const censusFlash = await E(() => window.__PB.census());
  const flash = await sampleN(20);
  await E(() => window.__PB.quietDom(false));
  const f1 = await api.shot('flash_peak'); const l1 = await luma(f1);
  // SAME-FRAME A/B: zero every flash output (uniforms, bolt, flash light, exposure kick) without stepping the sim, sample, restore, sample again
  const setFlash = (on) => E((on) => {
    const g = window.__KCA.game, storm = g.levels.env.storm, S = window.__S4F || (window.__S4F = {});
    if (!on) {
      S.sky = storm.sky.material.uniforms.uFlash.value; S.boltW = storm.sky.material.uniforms.uBolt.value.w; S.boltVis = storm.bolt.visible; S.light = storm.light.intensity; S.exp = g.renderer.exposureMul; S.boltI = storm.bolt.material.uniforms.uI.value;
      S.u = null; g.renderer.envGroup.traverse((o) => { if (S.u) return; const ms = o.material ? [].concat(o.material) : []; for (const m of ms) if (m && m.uniforms && m.uniforms.s4Flash) { S.u = m.uniforms.s4Flash; } });
      S.s4 = S.u ? S.u.value : null;
      storm.sky.material.uniforms.uFlash.value = 0; storm.sky.material.uniforms.uBolt.value.w = 0; storm.bolt.visible = false; storm.light.intensity = 0; g.renderer.exposureMul = 1; storm.bolt.material.uniforms.uI.value = 0; if (S.u) S.u.value = 0;
    } else {
      storm.sky.material.uniforms.uFlash.value = S.sky; storm.sky.material.uniforms.uBolt.value.w = S.boltW; storm.bolt.visible = S.boltVis; storm.light.intensity = S.light; g.renderer.exposureMul = S.exp; storm.bolt.material.uniforms.uI.value = S.boltI; if (S.u) S.u.value = S.s4;
    }
    return { s4FlashShared: !!S.u, s4: S.s4 };
  }, on);
  const sf = await setFlash(false);
  await E(() => window.__PB.gpuWarm()); await E(() => window.__PB.quietDom(true));
  const censusOff = await E(() => window.__PB.census()); const offSame = await sampleN(20);
  await E(() => window.__PB.quietDom(false));
  const fOff = await api.shot('flash_off_sameframe'); const lOff = await luma(fOff);
  await setFlash(true);
  await E(() => window.__PB.gpuWarm()); await E(() => window.__PB.quietDom(true));
  const onAgain = await sampleN(20);
  await E(() => window.__PB.quietDom(false));
  api.log(`same-frame: on ${JSON.stringify(flash)} / off ${JSON.stringify(offSame)} (calls ${censusOff.calls} tris ${censusOff.triangles}, luma ${JSON.stringify(lOff)}) / on again ${JSON.stringify(onAgain)} · s4Flash uniform found ${sf.s4FlashShared}`);
  const cpuCal = await E(() => { const a = []; for (let k = 0; k < 15; k++) a.push(window.__PB.cpuCal()); return a.sort((x, y) => x - y)[1]; });
  const kcpu = calib[REF].cpuCalIdleMs / cpuCal;
  const strikeFrame = slStrike.frames[0] || null;
  const strikeJs = strikeFrame ? { ms: +strikeFrame[0].toFixed(1), sim: +strikeFrame[1].toFixed(1), render: +strikeFrame[2].toFixed(1), laptopMs: +(strikeFrame[0] * kcpu).toFixed(1) } : null;
  api.log(`flash=${flash1} calls ${censusFlash.calls} tris ${censusFlash.triangles} gpu ${JSON.stringify(flash)} luma ${JSON.stringify(l1)} strikeJs ${JSON.stringify(strikeJs)}`);
  // whole envelope: JS + luma per frame over the 0.7 s strike (fresh strike), 15 ms steps
  await E(() => window.__PB.takeSlices());
  await E(() => window.__KCA.game.levels.env.storm.strike({ power: 1 }));
  const env = [];
  for (let i = 0; i < 48; i++) { await api.advance(15); env.push(await E(() => window.__KCA.game.levels.env.storm.flash)); }
  const slEnv = await E(() => window.__PB.takeSlices());
  const envJs = slEnv.frames.map((f) => +f[0].toFixed(1));
  const newProg = await E(() => window.__PB.newPrograms());
  const errors = await E(() => window.__KCA.info().errors);
  const out = { sameFrame: { on: flash, off: offSame, onAgain, censusOff: { calls: censusOff.calls, triangles: censusOff.triangles }, lumaOff: lOff, deltaMs1650: flash.est1650 != null && offSame.est1650 != null ? +(((flash.est1650 + (onAgain.est1650 ?? flash.est1650)) / 2) - offSame.est1650).toFixed(2) : null }, renderer: info.renderer, calIdle, refScale, cpuCal, flash0, flash1, base: { census: censusBase, gpu: base, luma: l0 }, flashPeak: { census: censusFlash, gpu: flash, luma: l1 }, deltaMs1650: base.est1650 != null && flash.est1650 != null ? +(flash.est1650 - base.est1650).toFixed(2) : null, strikeJs, envelope: env.map((f, i) => [+f.toFixed(2), envJs[i]]), envJsMax: Math.max(...envJs), envJsMaxLaptop: +(Math.max(...envJs) * kcpu).toFixed(1), newProg, errors };
  fs.writeFileSync(path.join(api.outDir, 's4_flash.json'), JSON.stringify(out, null, 1));
  api.log('summary ' + JSON.stringify({ sameFrameDelta: out.sameFrame.deltaMs1650, base: base.est1650, flash: flash.est1650, delta: out.deltaMs1650, strikeJs, envJsMax: out.envJsMax, envJsMaxLaptop: out.envJsMaxLaptop, newProg: newProg.length, errors: errors.length }));
};
