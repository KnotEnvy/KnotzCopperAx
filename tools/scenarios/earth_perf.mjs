// Targeted T2 checkpoints using the official perfbench GPU timer/calibration/overdraw kit.
// Run through capture.mjs (same URL/options as earth_magic.mjs); writes earth-perf.json beside the visual evidence.
import fs from 'node:fs';
import path from 'node:path';
import earth from './earth_magic.mjs';

export default async api => {
  await api.page.addScriptTag({ content: fs.readFileSync(path.resolve('tools/perfbench.page.js'), 'utf8') });
  const rows = [];
  const measure = async phase => {
    const census = await api.evalGame(() => window.__PB.census());
    const overdraw = await api.evalGame(() => window.__PB.overdraw());
    await api.evalGame(() => window.__PB.gpuWarm());
    const samples = [];
    for (let i = 0; i < 48 && samples.filter(s => s.valid && s.calMax < 0.1872).length < 12; i++) {
      samples.push(await api.evalGame(() => window.__PB.gpuSample({ frames: 2 })));
    }
    const clean = samples.filter(s => s.valid && s.calMax < 0.1872), valid = samples.filter(s => s.valid);
    const q = (a, p) => a.sort((x, y) => x - y)[Math.floor((a.length - 1) * p)];
    const ratio = clean.length >= 4 ? q(clean.map(s => s.frame / s.cal), 0.25) : q(valid.map(s => s.frame), 0.1) / q(valid.map(s => s.cal), 0.1);
    const row = { phase, clean: clean.length, attempts: samples.length, est1650ms: ratio * 1.379, est5070ms: ratio * 0.144,
      calls: census.calls, triangles: census.triangles, programs: census.programs, overdraw, samples };
    rows.push(row);
    fs.writeFileSync(path.join(api.outDir, 'earth-perf.json'), JSON.stringify(rows, null, 2));
    api.log('earth perf ' + JSON.stringify({ ...row, samples: undefined }));
  };
  let eruption = false, crumble = false;
  await earth({ ...api,
    shot: async name => { const file = await api.shot(name); if (name === 'before') await measure('before_cast'); return file; },
    evalGame: async (fn, arg) => {
      const result = await api.evalGame(fn, arg);
      if (result?.rocks && result?.tick) {
        const height = result.rocks.reduce((n, r) => n + r.heightSum, 0);
        if (!eruption && height > 4) { eruption = true; await measure('eruption_hold'); }
        if (eruption && !crumble && height < 1) {
          const chips = await api.evalGame(() => window.__KCA.game.vfx.group.children.find(m => m.name === 'magic_chip')?.count || 0);
          if (chips > 4) { crumble = true; await measure('falling_fragments'); }
        }
      }
      return result;
    },
  });
  if (!eruption || !crumble) throw new Error('Missed T2 performance checkpoint: ' + JSON.stringify({ eruption, crumble }));
};
