// Emberdrake breath at 594 ms after press: visual sheet + calibrated perfbench timer/overdraw checkpoints.
// FX_FRAMES=18 node tools/capture.mjs --url '/?mode=showcase&what=mount&id=emberdrake&scene=ride' --warm 0 ...
import fs from 'node:fs';
import path from 'node:path';
import attack from './mounts_fx.mjs';
export default async api => {
  await api.page.addScriptTag({ content: fs.readFileSync(path.resolve('tools/perfbench.page.js'), 'utf8') });
  const rows = [];
  const measure = async phase => {
    const census = await api.evalGame(() => window.__PB.census());
    const overdraw = await api.evalGame(() => window.__PB.overdraw());
    await api.evalGame(() => window.__PB.gpuWarm());
    const samples = [];
    for (let i = 0; i < 48 && samples.filter(s => s.valid && s.calMax < 0.1872).length < 12; i++) samples.push(await api.evalGame(() => window.__PB.gpuSample({ frames: 2 })));
    const clean = samples.filter(s => s.valid && s.calMax < 0.1872), valid = samples.filter(s => s.valid);
    const q = (a, p) => a.sort((x, y) => x - y)[Math.floor((a.length - 1) * p)];
    const ratio = clean.length >= 4 ? q(clean.map(s => s.frame / s.cal), 0.25) : q(valid.map(s => s.frame), 0.1) / q(valid.map(s => s.cal), 0.1);
    const row = { phase, clean: clean.length, attempts: samples.length, est1650ms: ratio * 1.379, calls: census.calls, triangles: census.triangles, overdraw, samples };
    rows.push(row); api.log('breath perf ' + JSON.stringify({ ...row, samples: undefined }));
  };
  await attack({ ...api, press: async (...args) => { await measure('before_breath'); return api.press(...args); } });
  await measure('breath_active');
  await api.shot('breath');
  fs.writeFileSync(path.join(api.outDir, 'breath-perf.json'), JSON.stringify(rows, null, 2));
};
