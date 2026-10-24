// perf-1650 r4: who calls Object3D.updateMatrixWorld / updateMatrix, how often per frame and how long (inclusive) —
// the V8 profile of S3 combat/boss put updateMatrixWorld + multiplyMatrices + setFromRotationMatrix + updateMatrix +
// updateWorldMatrix at ~19 % of the busy time. Wraps the two methods (root calls only: depth 0) for N frames under the
// manual clock (one advance(16.667) = one sim tick + one render), aggregates by (root object type/name, first app frames).
//   node tools/capture.mjs --url "/?mode=stage&stage=3&p1=brann&bot=1" --scenario tools/scenarios/mwcount.mjs --out ...    env MW_FRAMES=120
export default async function (api) {
  const { page, log, advance } = api;
  const N = Number(process.env.MW_FRAMES || 120);
  await advance(3000);
  await page.evaluate(() => {
    const g = window.__KCA.game;
    let P = g.scene; while (P && !Object.prototype.hasOwnProperty.call(P, 'updateMatrixWorld')) P = Object.getPrototypeOf(P);
    const S = window.__MW = { agg: new Map(), depth: 0, frames: 0, total: 0, calls: 0 };
    const orig = P.updateMatrixWorld;
    P.updateMatrixWorld = function (force) {
      if (S.depth > 0) { S.depth++; try { return orig.call(this, force); } finally { S.depth--; } }
      const t = performance.now(); S.depth = 1;
      try { return orig.call(this, force); }
      finally {
        S.depth = 0; const dt = performance.now() - t; S.total += dt; S.calls++;
        const st = String(new Error().stack).split('\n').slice(2, 7).map((l) => l.trim().replace(/^at /, '').replace(/https?:\/\/[^/]+\//, '').replace(/\?[^:)]*/g, '')).filter((l) => !/three\.module/.test(l)).slice(0, 3).join(' < ');
        const key = `${this.type}:${(this.name || '').slice(0, 24)} force=${!!force} | ${st}`;
        const e = S.agg.get(key) || { n: 0, ms: 0 }; e.n++; e.ms += dt; S.agg.set(key, e);
      }
    };
  });
  for (let i = 0; i < N; i++) await advance(16.667);
  const res = await page.evaluate((N) => {
    const S = window.__MW;
    return { calls: S.calls, totalMs: S.total, rows: [...S.agg.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 18).map(([k, v]) => `${(v.ms / N).toFixed(2)} ms/frame  ${(v.n / N).toFixed(2)} calls/frame  ${k}`) };
  }, N);
  log(`root updateMatrixWorld calls/frame ${(res.calls / N).toFixed(2)}, total ${(res.totalMs / N).toFixed(2)} ms/frame`);
  for (const r of res.rows) log('  ' + r);
}
