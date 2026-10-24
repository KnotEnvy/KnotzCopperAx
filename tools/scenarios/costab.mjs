// Cost table (perf-1650 r2): with the browser UNCAPPED (KCA_UNCAP=1 → no vsync, no rAF cap) and &fpscap=0&drs=0, the
// median frame time IS the throughput cost, so hiding/disabling one thing and re-measuring gives its real cost in ms
// (GPU and CPU together). Base is re-measured between every toggle (drift/thermal control); rows = min over rounds.
//   KCA_UNCAP=1 CA_ROUNDS=2 node tools/capture.mjs --realtime --size 1920x1080 --host http://127.0.0.1:4167 \
//     --url "/?mode=stage&stage=5&p1=brann&bot=1&mute&drs=0&fpscap=0" --scenario tools/scenarios/costab.mjs --out <dir> --timeout 180000
// env: CA_ONLY=a,b · CA_CENSUS=1 (hide each env child) · CA_MS=2000 · CA_CAST=1 (keep casting top-tier spells) · CA_EVAL (js before)
import fs from 'node:fs';
import path from 'node:path';
export default async (api) => {
  const E = (fn, a) => api.evalGame(fn, a);
  const MS = Number(process.env.CA_MS || 2000);
  await E(() => { const P = window.__PERF; P.gpuOn = false; P.start(); const d = window.__KCA.debug; d.god(true); d.pots(1, 9); });
  if (process.env.CA_EVAL) await api.page.evaluate(process.env.CA_EVAL);
  await api.page.waitForTimeout(6000);
  const meas = async (name, on, off, arg) => {
    if (on) await E(on, arg);
    await api.page.waitForTimeout(900);
    const i0 = await E(() => window.__PERF.frames.length);
    await api.page.waitForTimeout(MS);
    const r = await E((i0) => { const F = window.__PERF.frames.slice(i0); const q = (k, p) => { const s = F.map((f) => f[k]).filter((v) => v >= 0).sort((a, b) => a - b); return s.length ? s[Math.floor(p * (s.length - 1))] : -1; }; return { n: F.length, dt50: q(1, 0.5), dt90: q(1, 0.9), ren50: q(3, 0.5), sim50: q(2, 0.5), calls: q(6, 0.5) }; }, i0);
    if (off) await E(off, arg);
    r.name = name; return r;
  };
  const R = 'window.__KCA.game.renderer';
  const hideWhere = (pred) => `(() => { window.__hid = []; ${R}.scene.traverse((o) => { if (o.visible && (${pred})(o)) { o.visible = false; window.__hid.push(o); } }); })()`;
  const unhide = '(() => { for (const o of window.__hid || []) o.visible = true; window.__hid = []; })()';
  const C = [
    ['base'],
    ['noShadowPass', `${R}.lighting._forcedRate = 1e9`, `${R}.lighting._forcedRate = -1`],
    ['noPost', `${R}.postEnabled = false`, `${R}.postEnabled = true`],
    ['noSMAA', `(() => { const p = ${R}.post, c = p.composer.passes; const s = c[c.length - 1]; if (s !== p.mainPass) { s.enabled = false; p.mainPass.renderToScreen = true; } })()`, `(() => { const p = ${R}.post, c = p.composer.passes; const s = c[c.length - 1]; if (s !== p.mainPass) { s.enabled = true; p.mainPass.renderToScreen = false; } })()`],
    ['pr0.5', `(() => { const r = ${R}; window.__pr = r.webgl.getPixelRatio(); r.webgl.setPixelRatio(window.__pr * 0.5); r.post.setSize(r.width, r.height); })()`, `(() => { const r = ${R}; r.webgl.setPixelRatio(window.__pr); r.post.setSize(r.width, r.height); })()`],
    ['noVfx', 'window.__KCA.game.vfx.group.visible = false', 'window.__KCA.game.vfx.group.visible = true'],
    ['noEnv', `${R}.envGroup.visible = false`, `${R}.envGroup.visible = true`],
    ['noActors', '(() => { window.__hidA = []; for (const a of window.__KCA.game.world.actors) if (a.view && a.view.visible) { a.view.visible = false; window.__hidA.push(a.view); } })()', '(() => { for (const v of window.__hidA) v.visible = true; })()'],
    ['noTransparent', hideWhere('(o) => o.isMesh || o.isPoints || o.isSprite ? [].concat(o.material).some((m) => m && m.transparent) : false'), unhide],
    ['noAdditive', hideWhere('(o) => o.material ? [].concat(o.material).some((m) => m && m.blending === 2) : false'), unhide],
    ['noSkinned', hideWhere('(o) => o.isSkinnedMesh'), unhide],
    ['noCasters', `(() => { window.__cs = []; ${R}.scene.traverse((o) => { if (o.castShadow) { o.castShadow = false; window.__cs.push(o); } }); })()`, '(() => { for (const o of window.__cs) o.castShadow = true; })()'],
    ['noPointLights', `(() => { window.__pl = []; ${R}.scene.traverse((o) => { if (o.isPointLight && o.intensity > 0) { window.__pl.push([o, o.intensity]); o.intensity = 0; } }); })()`, '(() => { for (const [o, i] of window.__pl) o.intensity = i; })()'],
    ['noUI', "(() => { const u = document.getElementById('ui') || document.querySelector('#hud') || document.body.children[1]; window.__ui = [...document.body.children].filter((e) => e.id !== 'game-canvas' && !e.contains(document.getElementById('game-canvas'))); for (const e of window.__ui) e.style.visibility = 'hidden'; })()", "(() => { for (const e of window.__ui) e.style.visibility = ''; })()"],
  ];
  const only = process.env.CA_ONLY ? process.env.CA_ONLY.split(',') : null;
  const out = { rows: [], census: [] };
  const rounds = Number(process.env.CA_ROUNDS || 2);
  const res = {};
  const castLoop = process.env.CA_CAST === '1' ? setInterval(() => { E(() => { const d = window.__KCA.debug; d.pots(1, 9); if (!window.__KCA.game.magic || !window.__KCA.game.magic.active) d.cast(1, 6); }).catch(() => {}); }, 1500) : null;
  for (let round = 0; round < rounds; round++) {
    for (const [name, on, off] of C) {
      if (only && name !== 'base' && !only.includes(name)) continue;
      const b = name === 'base' ? null : await meas('base', null, null);
      const r = await meas(name, on, off);
      const o = res[name] || (res[name] = { d: [], n: r.n, calls: r.calls });
      o.d.push(b ? b.dt50 - r.dt50 : r.dt50); // cost (saving when removed), or the base itself if (b) o.base = b.dt50; o.ren = r.ren50; o.sim = r.sim50;
    }
  }
  for (const [name, o] of Object.entries(res)) {
    const srt = o.d.slice().sort((a, b) => a - b);
    const row = { name, costMs: Math.round(srt[srt.length >> 1] * 100) / 100, all: o.d.map((x) => Math.round(x * 100) / 100), base: o.base, ren: o.ren, sim: o.sim, calls: o.calls, n: o.n };
    out.rows.push(row); api.log('CA ' + JSON.stringify(row));
  }
  if (process.env.CA_CENSUS === '1') {
    const kids = await E(() => { const g = window.__KCA.game, o = []; window.__cen = []; const walk = (p, d) => { for (const c of p.children) { if (!c.visible) continue; let n = 0; c.traverse(() => n++); window.__cen.push(c); o.push(`${'  '.repeat(d)}${c.name || c.type}(${n})`); if (d < 1 && n > 30) walk(c, d + 1); } }; walk(g.renderer.envGroup, 0); for (const c of g.renderer.scene.children) { if (c === g.renderer.envGroup || !c.visible) continue; window.__cen.push(c); o.push(`SCENE:${c.name || c.type}`); } return o; });
    for (let i = 0; i < kids.length; i++) {
      const b = await meas('b');
      const r = await meas(kids[i], (i) => { window.__cen[i].visible = false; }, (i) => { window.__cen[i].visible = true; }, i);
      out.census.push([kids[i], Math.round((b.dt50 - r.dt50) * 100) / 100, b.dt50]);
    }
    for (const [n, d, b] of out.census.slice().sort((x, y) => y[1] - x[1])) api.log(`CEN ${d.toFixed(2)} ms (base ${b}) ${n}`);
  }
  if (castLoop) clearInterval(castLoop);
  out.info = await E(() => { const g = window.__KCA.game, i = window.__KCA.info(); return { size: [g.renderer.width, g.renderer.height], pr: g.renderer.webgl.getPixelRatio(), q: g.quality.name, calls: i.drawCalls, tris: i.triangles, errors: i.errors }; });
  fs.writeFileSync(path.join(api.outDir, 'costab.json'), JSON.stringify(out, null, 1));
  api.log(JSON.stringify(out.info));
};
