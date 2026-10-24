#!/usr/bin/env node
// perf-1650 r4: prewarm audit — which LINKED programs were never DRAWN by the time the stage starts?
// ANGLE/D3D11 compiles a program's HLSL at its first DRAW (100–2000 ms in the GPU process for a big PBR/skinned
// shader, and the next sync GL call waits for it), so every linked-but-undrawn program is a hitch waiting for the first
// spawn / hit / spell that uses it. Injects a draw wrapper from page start (addInitScript), loads a stage in real time,
// waits for the prewarm to finish + SETTLE ms, then lists the undrawn programs (name, key tail, owning materials).
//   node tools/fdaudit.mjs "/?mode=stage&stage=3&p1=brann&bot=1" [settleMs] [--boss]   (--boss also teleports to the boss)
import { launchBrowser } from './lib/browser.mjs';
import { KCA_HOST } from './lib/platform.mjs';
import { acquire } from './lib/locks.mjs';

const url = process.argv[2] || '/?mode=stage&stage=3&p1=brann&bot=1';
const settle = Number(process.argv[3] || 3000);
const boss = process.argv.includes('--boss');
const release = await acquire('capture', { slots: Number(process.env.KCA_CAPTURE_SLOTS || 6), info: { what: 'fdaudit ' + url, owner: 'perf-1650' } });
const browser = await launchBrowser({ tool: 'fdaudit', args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await ctx.route(/\/@vite\/client(\?.*)?$/, (route) => route.fulfill({ contentType: 'application/javascript', body: 'const hot=()=>({data:{},accept(){},acceptExports(){},dispose(){},prune(){},decline(){},invalidate(){},on(){},off(){},send(){}});export const createHotContext=hot;export function updateStyle(){}export function removeStyle(){}export function injectQuery(u){return u}export class ErrorOverlay extends HTMLElement{}export default {};' }));
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e && e.message || e).slice(0, 200))); page.on('console', (m) => { if (m.type() === 'error' || /GL_INVALID|GL_OUT/.test(m.text())) errs.push('CONSOLE ' + m.text().slice(0, 200)); });
  await page.addInitScript(() => {
    const F = (window.__FD = { seen: new WeakSet(), cur: null, armed: false, late: [] });
    const proto = WebGL2RenderingContext.prototype;
    F.gl = { del: [], link: [], on: false };
    for (const nm of ['deleteProgram', 'linkProgram']) { const f0 = proto[nm]; proto[nm] = function (...a) { if (F.gl.on) (nm === 'deleteProgram' ? F.gl.del : F.gl.link).push({ t: Math.round(performance.now()), stack: String(new Error().stack).split('\n').slice(2, 9).map((l) => l.trim().replace(/^at /, '').replace(/https?:\/\/[^/]+\//, '')).join(' < ') }); return f0.apply(this, a); }; }
    for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) {
      const f = proto[name];
      proto[name] = function (...a) {
        const p = this.getParameter(this.CURRENT_PROGRAM);
        if (p && !F.seen.has(p)) {
          F.seen.add(p);
          if (F.armed && F.late.length < 40) {
            const c = F.cur;
            F.lateProg = F.lateProg || []; F.lateProg.push(p); F.late.push({ t: Math.round(performance.now()), cur: c ? `${c.object.type}:${c.object.name || ''} / ${c.material.name || c.material.type} rt=${c.rt ? 1 : 0}` : '?',
              stack: String(new Error().stack).split('\n').slice(2, 12).map((l) => l.trim().replace(/^at /, '').replace(/https?:\/\/[^/]+\//, '').replace(/\?[^:]*:/, ':')).join(' < ') });
          }
        }
        return f.apply(this, a);
      };
    }
  });
  await page.goto((url.startsWith('http') ? '' : KCA_HOST) + url, { waitUntil: 'domcontentloaded', timeout: 300000 });
  await page.waitForFunction(() => window.__KCA && window.__KCA.ready, null, { timeout: 300000 });
  await page.evaluate(() => window.__KCA.ready);
  await page.waitForTimeout(settle);
  const audit = () => page.evaluate(() => {
    const g = window.__KCA.game, W = g.renderer.webgl, F = window.__FD;
    // owners: material name per program (via scene walk + properties)
    const owners = new Map();
    g.renderer.scene.traverse((o) => { for (const m of [].concat(o.material || [])) { if (!m) continue; const pr = W.properties.get(m); const cp = pr && pr.currentProgram; if (cp) { const l = owners.get(cp.cacheKey) || new Set(); if (l.size < 3) l.add(`${o.type}:${o.name || ''}/${m.name || m.type}`); owners.set(cp.cacheKey, l); } } });
    const out = [];
    for (const p of W.info.programs) if (!F.seen.has(p.program)) out.push(`${p.name} …${String(p.cacheKey).slice(-60)} | ${[...(owners.get(p.cacheKey) || [])].join(' ; ') || '(no live owner)'}`);
    return { linked: W.info.programs.length, undrawn: out };
  });
  console.log('prewarmReport', JSON.stringify(await page.evaluate(() => window.__KCA.game.prewarmReport)).slice(0, 900));
  let r = await audit();
  console.log(`after prewarm + ${settle} ms: linked ${r.linked}, never drawn ${r.undrawn.length}`);
  for (const l of r.undrawn) console.log('  UNDRAWN ' + l);
  if (process.argv.includes('--warmmount')) {
    const res = await page.evaluate(async () => {
      const g = window.__KCA.game, R = g.renderer, W = R.webgl;
      const { applyCharacterLook } = await import('/src/render/characterLook.js');
      const m = await g.mounts.spawn('cinderwyrm', { x: 0, z: 0, add: false });
      if (g.mounts.mounts && g.mounts.mounts.delete) g.mounts.mounts.delete(m);
      applyCharacterLook(m.modelRoot || m.view, { strength: 0.9 });
      m.view.position.set(g.cameraRig.focus.x, 0, 0); R.scene.add(m.view); m.view.traverse((o) => { o.frustumCulled = false; });
      m.view.updateMatrixWorld(true);
      window.__FD.armed = true; window.__FD.late.length = 0;
      const rb = W.renderBufferDirect.bind(W); W.renderBufferDirect = function (camera, scene, geometry, material, object, group) { window.__FD.cur = { object, material, rt: W.getRenderTarget() }; return rb(camera, scene, geometry, material, object, group); };
      R.render(1 / 60);
      const keys = []; m.view.traverse((o) => { if (o.isMesh) for (const mt of [].concat(o.material)) { const cp = W.properties.get(mt).currentProgram; keys.push(`${o.name} ${cp ? cp.cacheKey.slice(-70) : 'none'}`); } });
      R.scene.remove(m.view);
      return { keys, late: window.__FD.late.map((l) => l.cur), modelRoot: !!m.modelRoot };
    });
    console.log('WARMMOUNT', JSON.stringify(res));
  }
  if (boss) {
    await page.evaluate(() => { window.__FD.gl.on = true; });
    if (process.argv.includes('--cast')) { await page.evaluate(() => { const d = window.__KCA.debug; d.god(true); d.pots(1, 9); d.cast(1, 9); }); await page.waitForTimeout(4500); }
    await page.evaluate(() => { const g = window.__KCA.game, W = g.renderer.webgl, F = window.__FD; const rb = W.renderBufferDirect.bind(W); W.renderBufferDirect = function (camera, scene, geometry, material, object, group) { F.cur = { object, material, rt: W.getRenderTarget() }; return rb(camera, scene, geometry, material, object, group); }; F.armed = true; F.late.length = 0; });
    await page.evaluate(async () => {
      const g = window.__KCA.game, L = g.levels, d = window.__KCA.debug;
      d.god(true);
      const last = L.screens.length - 1;
      for (let k = L.screenIndex; k < last; k++) { d.kill('enemies'); L.waveActors.clear(); }
      for (const h of g.world.query({ kind: 'hero' })) h.pos.x = L.screens[last].x[0] + 3;
      L.pendingSpawns = 0; L.waveActors.clear(); L.enterScreen(last);
      if (g.cameraRig && g.cameraRig.snap) g.cameraRig.snap();
      L.waveActors.clear(); L.pendingSpawns = 0; L.waveIndex = (L.screens[last].waves || []).length - 1; L.nextWave();
    });
    const before = new Set(r.undrawn);
    const keys0 = await page.evaluate(() => window.__KCA.game.renderer.webgl.info.programs.map((p) => p.cacheKey));
    await page.waitForTimeout(6000);
    r = await audit();
    const glev = await page.evaluate(() => window.__FD.gl);
    console.log(`deleteProgram ${glev.del.length}, linkProgram ${glev.link.length} since boss start`);
    for (const d of glev.del.slice(0, 6)) console.log('  DEL @' + d.t + ' ' + d.stack);
    for (const d of glev.link.slice(0, 6)) console.log('  LINK @' + d.t + ' ' + d.stack);
    const lp = await page.evaluate(() => { const F = window.__FD, W = window.__KCA.game.renderer.webgl; return (F.lateProg || []).map((p) => { const e = W.info.programs.find((x) => x.program === p); if (!e) return null; const tail = String(e.cacheKey).slice(-30); const sib = W.info.programs.filter((x) => x !== e && String(x.cacheKey).slice(-30) === tail).map((x) => ({ seen: F.seen.has(x.program), key: String(x.cacheKey) })); return { key: String(e.cacheKey), name: e.name, sib }; }); });
    for (const q of lp) if (q) { console.log('  LATEPROG ' + q.name + ' KEY=' + q.key.slice(0, 400)); for (const x of q.sib) console.log('     SIBLING seen=' + x.seen + ' ' + x.key.slice(0, 400)); }
    const late = await page.evaluate(() => window.__FD.late);
    console.log(`FIRST-DRAWN after boss start: ${late.length}`);
    for (const l of late) console.log(`  @${l.t} ${l.cur}
      ${l.stack}`);
    const keys1 = await page.evaluate(() => window.__KCA.game.renderer.webgl.info.programs.map((p) => p.cacheKey));
    const k0 = new Set(keys0);
    for (const k of keys1) if (!k0.has(k)) {
      let best = '', bl = -1; for (const o of keys0) { let i = 0; while (i < o.length && i < k.length && o[i] === k[i]) i++; if (i > bl) { bl = i; best = o; } }
      console.log('  NEWKEY ' + k.slice(-260) + '\n  NEAREST(prefix ' + bl + ') ' + best.slice(-260));
    }
    const dump = await page.evaluate(() => { const g = window.__KCA.game, W = g.renderer.webgl, out = []; g.renderer.scene.traverse((o) => { if (!o.isMesh || !/mount_|viper/.test(o.name + (o.parent && o.parent.name || ''))) return; for (const m of [].concat(o.material)) { const pr = W.properties.get(m); const cp = pr && pr.currentProgram; out.push(`${o.name}<${o.parent && o.parent.name} mat=${m.name} key=${cp ? String(cp.cacheKey).slice(-46) : 'none'} obc=${String(m.onBeforeCompile).slice(0, 40).replace(/s+/g, ' ')} custom=${String(m.customProgramCacheKey && m.customProgramCacheKey()).slice(-30)}`); } }); const mo = g.world.actors.filter((a) => a.kind === 'mount').map((a) => `mount actor modelRoot=${!!a.modelRoot} view.kcaLook=${!!(a.view && a.view.userData.kcaLook)} defId=${a.def && a.def.id}`); return { out, mo }; });
    for (const l of dump.out.concat(dump.mo)) console.log('  DUMP ' + l);
    console.log(`after boss start + 6 s: linked ${r.linked}, never drawn ${r.undrawn.length}`);
    for (const l of r.undrawn) console.log('  UNDRAWN ' + l);
  }
  console.log(errs.length ? 'ERRORS ' + JSON.stringify(errs.slice(0, 8)) : 'no page/console errors');
} finally {
  await browser.close().catch(() => {});
  release();
}
