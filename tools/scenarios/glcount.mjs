// perf-1650 r4: GL call census per frame (counts by function) for a stage phase — tells how many uniform uploads, program
// switches, texture binds and state calls one frame issues (the JS cost of renderer.render is ~ calls × 1.5–3 µs in Chrome).
//   node tools/capture.mjs --url "/?mode=stage&stage=2&p1=brann&bot=1" --scenario tools/scenarios/glcount.mjs --out ...   env GC_BOSS=1 (teleport to the boss first)
export default async function (api) {
  const { page, log, advance } = api;
  await advance(2500);
  if (process.env.GC_BOSS !== '0') {
    await page.evaluate(() => {
      const g = window.__KCA.game, L = g.levels, d = window.__KCA.debug;
      d.god(true); d.pots(1, 9);
      const last = L.screens.length - 1;
      for (let k = L.screenIndex; k < last; k++) { d.kill('enemies'); L.waveActors.clear(); }
      for (const h of g.world.query({ kind: 'hero' })) h.pos.x = L.screens[last].x[0] + 3;
      L.pendingSpawns = 0; L.waveActors.clear(); L.enterScreen(last);
      if (g.cameraRig && g.cameraRig.snap) g.cameraRig.snap();
      L.waveActors.clear(); L.pendingSpawns = 0; L.waveIndex = (L.screens[last].waves || []).length - 1; L.nextWave();
    });
    await advance(9000);
  }
  const res = await page.evaluate(async () => {
    const g = window.__KCA.game, R = g.renderer, W = R.webgl, gl = W.getContext();
    const proto = Object.getPrototypeOf(gl), cnt = new Map(); let on = false;
    const names = Object.getOwnPropertyNames(proto).filter((k) => { try { return typeof gl[k] === 'function' && k !== 'constructor'; } catch (e) { return false; } });
    const orig = {};
    for (const k of names) { orig[k] = gl[k]; gl[k] = function (...a) { if (on) cnt.set(k, (cnt.get(k) || 0) + 1); return orig[k].apply(gl, a); }; }
    const N = 30;
    for (let i = 0; i < 6; i++) { g._advanceReal(1 / 60); g.renderFrame(0.5, 1 / 60); }
    on = true;
    for (let i = 0; i < N; i++) { g._advanceReal(1 / 60); g.renderFrame(0.5, 1 / 60); }
    on = false;
    for (const k of names) gl[k] = orig[k];
    const rows = [...cnt.entries()].map(([k, v]) => [k, +(v / N).toFixed(1)]).sort((a, b) => b[1] - a[1]);
    const uni = rows.filter(([k]) => /^uniform/.test(k)).reduce((s, [, v]) => s + v, 0);
    const lights = {}; R.scene.traverse((o) => { if (o.isLight) { const t = o.type + (o.userData && o.userData.pad ? ':pad' : '') + (o.visible && o.intensity > 0 ? ':on' : ':off'); lights[t] = (lights[t] || 0) + 1; } });
    return { tex: rows.filter(([k]) => /tex|Texture|ipmap|Buffer|Query|Framebuffer|Renderbuffer/i.test(k)).map(([k, v]) => k + ' ' + v).join(' · '), rows: rows.slice(0, 22), uniformTotal: +uni.toFixed(1), total: +rows.reduce((s, [, v]) => s + v, 0).toFixed(1), programs: W.info.programs.length, calls: R.frameInfo.calls, lights };
  });
  log(`GL calls per frame: total ${res.total}, uniform* ${res.uniformTotal}, draw calls ${res.calls}, programs ${res.programs}`);
  log('lights ' + JSON.stringify(res.lights));
  log('texture/buffer calls: ' + res.tex);
  log('top: ' + res.rows.map(([k, v]) => `${k} ${v}`).join(' · '));
}
