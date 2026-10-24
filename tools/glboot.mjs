#!/usr/bin/env node
// perf-1650 r4 diagnostic: find the source of WebGL errors that happen during page boot (before capture.mjs scenarios
// can hook anything). Injects a getError() check after every draw call (via addInitScript on the WebGL2 prototype),
// records the JS stack of the first N failing draws, then prints them grouped by app frames.
//   node tools/glboot.mjs "/?mode=stage&stage=1&p1=brann&bot=1" [extraWaitMs]
import { launchBrowser } from './lib/browser.mjs';
import { KCA_HOST } from './lib/platform.mjs';
import { acquire } from './lib/locks.mjs';

const url = process.argv[2] || '/?mode=stage&stage=1&p1=brann&bot=1';
const extra = Number(process.argv[3] || 4000);
const release = await acquire('capture', { slots: Number(process.env.KCA_CAPTURE_SLOTS || 6), info: { what: 'glboot ' + url, owner: 'perf-1650' } });
const browser = await launchBrowser({ tool: 'glboot', args: [] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await ctx.route(/\/@vite\/client(\?.*)?$/, (route) => route.fulfill({ contentType: 'application/javascript', body: 'const hot=()=>({data:{},accept(){},acceptExports(){},dispose(){},prune(){},decline(){},invalidate(){},on(){},off(){},send(){}});export const createHotContext=hot;export function updateStyle(){}export function removeStyle(){}export function injectQuery(u){return u}export class ErrorOverlay extends HTMLElement{}export default {};' }));
  const page = await ctx.newPage();
  const msgs = [];
  page.on('console', (m) => { if (/GL_INVALID|GL_OUT|CONTEXT_LOST|error/i.test(m.text()) && m.type() !== 'log') msgs.push(m.text().slice(0, 200)); });
  await page.addInitScript(() => {
    const R = (window.__GLB = { recs: [], draws: 0, pre: 0 });
    const proto = WebGL2RenderingContext.prototype;
    for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) {
      const f = proto[name];
      proto[name] = function (...a) {
        R.draws++;
        if (R.recs.length < 60) { while (this.getError() !== 0) R.pre++; }
        const r = f.apply(this, a);
        if (R.recs.length < 60) {
          const e = this.getError();
          if (e !== 0) {
            const prog = this.getParameter(this.CURRENT_PROGRAM);
            let unis = [];
            try {
              const n = this.getProgramParameter(prog, this.ACTIVE_UNIFORMS);
              for (let i = 0; i < n; i++) {
                const u = this.getActiveUniform(prog, i);
                if (/sampler/i.test(String(u.type)) || [35678, 35679, 35680, 35682, 36298, 36299, 36300, 36303, 36289, 36292, 36293, 35682].includes(u.type)) unis.push(u.name + ':' + u.type);
              }
            } catch (err) { /* ignore */ }
            // what is bound on the units the program samples (target + internal-format-ish info via a quick tex query)
            const bound = [];
            try {
              const prevUnit = this.getParameter(this.ACTIVE_TEXTURE);
              for (let u = 0; u < 12; u++) { this.activeTexture(this.TEXTURE0 + u); bound.push(u + ':' + (this.getParameter(this.TEXTURE_BINDING_2D) ? '2D' : '-') + (this.getParameter(0x8C1D /* TEXTURE_BINDING_2D_ARRAY */) ? 'A' : '') + (this.getParameter(0x806A /* TEXTURE_BINDING_3D */) ? '3' : '') + (this.getParameter(this.TEXTURE_BINDING_CUBE_MAP) ? 'C' : '')); }
              this.activeTexture(prevUnit);
            } catch (err) { /* ignore */ }
            R.recs.push({ name, e, draws: R.draws, unis: unis.join(' '), bound: bound.join(' '), stack: String(new Error().stack).split('\n').slice(2, 9).map((l) => l.trim().replace(/^at /, '').replace(/https?:\/\/[^/]+\//, '').replace(/\?[^:]*:/, ':')).join(' < ') });
          }
        }
        return r;
      };
    }
  });
  await page.goto((url.startsWith('http') ? '' : KCA_HOST) + url, { waitUntil: 'domcontentloaded', timeout: 300000 });
  await page.waitForFunction(() => window.__KCA && window.__KCA.ready, null, { timeout: 300000 });
  await page.evaluate(() => window.__KCA.ready);
  await page.waitForTimeout(extra);
  const res = await page.evaluate(() => window.__GLB);
  console.log(`draws ${res.draws} pre-existing errors flushed ${res.pre} failing draws recorded ${res.recs.length}`);
  const g = new Map();
  for (const r of res.recs) { const k = r.name + ' e=' + r.e + ' | ' + r.stack; g.set(k, (g.get(k) || 0) + 1); }
  for (const [k, n] of g) console.log(`x${n} ${k}`);
  if (res.recs[0]) console.log('first rec:', JSON.stringify(res.recs[0]).slice(0, 900));
  console.log('console:', msgs.slice(0, 5));
} finally {
  await browser.close().catch(() => {});
  release();
}
