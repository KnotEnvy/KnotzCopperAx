// GPU A/B probe (perf-1650): median GPU ms (EXT_disjoint_timer_query) + CPU render ms for render-config toggles in a
// live stage. node tools/capture.mjs --realtime --size 1920x1080 --url "/?mode=stage&stage=3&p1=brann&bot=1&mute" --scenario tools/scenarios/gpuab.mjs --out <dir>
import fs from 'node:fs';
import path from 'node:path';
export default async (api) => {
  const E = (fn, a) => api.evalGame(fn, a);
  await E(() => { const P = window.__PERF; P.gpuOn = P.gpuAvailable; P.start(); window.__KCA.debug.god(true); });
  await api.page.waitForTimeout(5000);
  const meas = async (name, on, off, arg) => {
    if (on) await E(on, arg);
    await api.page.waitForTimeout(700);
    const i0 = await E(() => window.__PERF.frames.length);
    await api.page.waitForTimeout(Number(process.env.AB_MS || 2000));
    const r = await E((i0) => { const F = window.__PERF.frames.slice(i0); const q = (k, p) => { const s = F.map((f) => f[k]).filter((v) => v >= 0).sort((a, b) => a - b); return s.length ? s[Math.floor(p * (s.length - 1))] : -1; }; return { n: F.length, gpu50: q(4, 0.25), gpu90: q(4, 0.9), cpuR50: q(3, 0.5), dt50: q(1, 0.5), calls: q(6, 0.5) }; }, i0);
    if (off) await E(off, arg);
    r.name = name; return r;
  };
  const C = [
    ['base'],
    ['noPads', () => { const G = window.__KCA.game.renderer.guard; if (G) { G.enabled = false; if (G.pads) G.pads.group.visible = false; } }, () => { const G = window.__KCA.game.renderer.guard; if (G) { G.enabled = true; if (G.pads) G.pads.group.visible = true; } }],
    ['noShadowUpdate', () => { window.__KCA.game.renderer.lighting._forcedRate = 1e9; }, () => { window.__KCA.game.renderer.lighting._forcedRate = -1; }],
    ['noPost', () => { window.__KCA.game.renderer.postEnabled = false; }, () => { window.__KCA.game.renderer.postEnabled = true; }],
    ['pr0.75', () => { const g = window.__KCA.game; window.__pr = g.renderer.webgl.getPixelRatio(); g.renderer.webgl.setPixelRatio(0.75); g.renderer.resize(); }, () => { const g = window.__KCA.game; g.renderer.webgl.setPixelRatio(window.__pr); g.renderer.resize(); }],
    ['noVfx', () => { window.__KCA.game.vfx.group.visible = false; }, () => { window.__KCA.game.vfx.group.visible = true; }],
    ['noEnvTransp', () => { window.__hid = []; window.__KCA.game.renderer.envGroup.traverse((o) => { if (o.visible && o.material && [].concat(o.material).some((m) => m.transparent)) { o.visible = false; window.__hid.push(o); } }); }, () => { for (const o of window.__hid) o.visible = true; }],
    ['noEnv', () => { const e = window.__KCA.game.renderer.envGroup; window.__ev = e.visible; e.visible = false; }, () => { window.__KCA.game.renderer.envGroup.visible = true; }],
    ['noActors', () => { window.__hidA = []; for (const a of window.__KCA.game.world.actors) if (a.view && a.view.visible) { a.view.visible = false; window.__hidA.push(a.view); } }, () => { for (const v of window.__hidA) v.visible = true; }],
  ];
  if (process.env.AB_CENSUS === '1') {
    // hide each env child (depth 1, and depth 2 for big groups) and measure the GPU saving (min of 2 rounds)
    const kids = await E(() => { const g = window.__KCA.game, out = []; window.__cen = []; const walk = (o, d) => { for (const c of o.children) { if (!c.visible) continue; let n = 0; c.traverse(() => n++); window.__cen.push(c); out.push(`${'  '.repeat(d)}${c.name || c.type}(${n})`); if (d < 1 && n > 40) walk(c, d + 1); } }; walk(g.renderer.envGroup, 0); for (const c of g.renderer.scene.children) { if (c === g.renderer.envGroup || !c.visible) continue; window.__cen.push(c); out.push(`SCENE:${c.name || c.type}`); } return out; });
    const base = [];
    const cen = [];
    for (let i = 0; i < kids.length; i++) {
      const b = await meas('b', null, null); base.push(b.gpu50);
      const r1 = await meas(kids[i], (i) => { window.__cen[i].visible = false; }, (i) => { window.__cen[i].visible = true; }, i);
      cen.push([kids[i], r1.gpu50, b.gpu50]);
    }
    const bm = base.slice().sort((a, b) => a - b)[base.length >> 1];
    for (const [n, g, b] of cen.sort((x, y) => (x[1] - x[2]) - (y[1] - y[2]))) api.log(`CEN ${(g - b).toFixed(1)} ms  hidden ${g.toFixed(1)} vs ${b.toFixed(1)}  ${n}`);
    api.log('base median ' + bm);
    return;
  }
  const only = process.env.AB_ONLY ? process.env.AB_ONLY.split(',') : null;
  const res = {};
  for (let round = 0; round < Number(process.env.AB_ROUNDS || 3); round++) {
    for (const [name, on, off] of C) {
      if (only && !only.includes(name)) continue;
      const r = await meas(name, on, off);
      const o = res[name] || (res[name] = { gpu50: [], cpuR50: [], dt50: [], calls: r.calls });
      o.gpu50.push(r.gpu50); o.cpuR50.push(r.cpuR50); o.dt50.push(r.dt50);
    }
  }
  const R = Object.entries(res).map(([name, o]) => ({ name, gpuMin: Math.min(...o.gpu50), gpuMed: o.gpu50.sort((a, b) => a - b)[o.gpu50.length >> 1], cpuMin: Math.min(...o.cpuR50), dtMin: Math.min(...o.dt50), calls: o.calls }));
  for (const r of R) api.log('AB ' + JSON.stringify(r));
  R.info = await E(() => { const g = window.__KCA.game; return { size: [g.renderer.width, g.renderer.height], pr: g.renderer.webgl.getPixelRatio(), q: g.quality.name, sm: g.renderer.lighting.sun && g.renderer.lighting.sun.shadow.mapSize.x }; });
  fs.writeFileSync(path.join(api.outDir, 'gpuab.json'), JSON.stringify({ rows: R, info: R.info }, null, 1));
  api.log(JSON.stringify(R.info));
};
