// perf-1650 r4: VRAM census of a running stage (manual clock). Prints
//   - renderer.info.memory (textures / geometries) and the page's GPU-process "Dedicated Usage" (Windows counter, MB)
//   - the largest textures reachable from the scene (materials + uniforms), render targets and shadow maps, by bytes,
//     grouped by a guess of their source, so a cap / reuse decision can be made per group.
//   node tools/capture.mjs --url "/?mode=stage&stage=5&p1=brann&bot=1" --scenario tools/scenarios/vramcensus.mjs --out progress/tmp/perf/r4/vram5
// env VC_ADV=<ms> game time to advance before the census (default 4000); VC_TOP=<n> rows (default 28).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function gpuProcessMB(pid) {
  if (process.platform !== 'win32') { // no per-process counter on Linux/WSL2: report whole-GPU usage instead
    const r = spawnSync('nvidia-smi', ['--query-gpu=memory.used,memory.total', '--format=csv,noheader,nounits'], { encoding: 'utf8' });
    const [used, total] = String(r.stdout || '').trim().split(/,\s*/);
    return used ? `gpuTotalUsed=${used}MB/${total}MB (whole GPU, all processes)` : '';
  }
  const r = spawnSync('powershell', ['-NoProfile', '-Command', `$c = Get-Counter '\\GPU Process Memory(pid_${pid}_*)\\Dedicated Usage','\\GPU Process Memory(pid_${pid}_*)\\Shared Usage' -ErrorAction SilentlyContinue; ($c.CounterSamples | ForEach-Object { $_.Path.Split('\\')[-1] + '=' + [int]($_.CookedValue/1MB) }) -join ' '`], { encoding: 'utf8' });
  return (r.stdout || '').trim();
}

export default async function (api) {
  const { page, log } = api;
  await api.advance(Number(process.env.VC_ADV || 4000));
  let gpuPid = null;
  try {
    const br = page.context().browser();
    const cdp = await br.newBrowserCDPSession();
    const info = await cdp.send('SystemInfo.getProcessInfo');
    const g = info.processInfo.find((p) => p.type === 'GPU' || p.type === 'gpu');
    gpuPid = g && g.id;
  } catch (e) { log('no GPU pid: ' + e.message); }
  if (gpuPid) log(`GPU process pid ${gpuPid}: ${gpuProcessMB(gpuPid)}`);
  const top = Number(process.env.VC_TOP || 28);
  const res = await page.evaluate((top) => {
    const g = window.__KCA.game, R = g.renderer, W = R.webgl;
    const texBytes = (t) => {
      if (!t) return 0;
      if (t.isCompressedTexture && t.mipmaps) return t.mipmaps.reduce((s, m) => s + (m.data ? m.data.byteLength : 0), 0);
      const im = t.image || {}; const w = im.width || im.videoWidth || 0, h = im.height || im.videoHeight || 0, d = im.depth || 1;
      if (!w || !h) return 0;
      const ch = t.format === 1028 ? 1 : t.format === 1030 ? 2 : 4;
      const bpc = t.type === 1015 ? 4 : t.type === 1016 ? 2 : 1;
      const mip = t.generateMipmaps !== false && t.minFilter !== 1006 && t.minFilter !== 1003 ? 4 / 3 : 1;
      return w * h * d * ch * bpc * mip;
    };
    const tex = new Map(); const users = new Map();
    const add = (v, who) => { if (v && v.isTexture) { tex.set(v.uuid, v); if (!users.has(v.uuid)) users.set(v.uuid, new Set()); if (users.get(v.uuid).size < 3) users.get(v.uuid).add(who); } };
    R.scene.traverse((x) => {
      if (!(x.isMesh || x.isPoints || x.isSprite || x.isLine)) return;
      for (const m of [].concat(x.material || [])) {
        if (!m) continue;
        const who = (x.name || x.type) + '/' + (m.name || m.type);
        for (const k in m) add(m[k], who + '.' + k);
        if (m.uniforms) for (const k in m.uniforms) add(m.uniforms[k] && m.uniforms[k].value, who + '.u:' + k);
      }
    });
    add(R.scene.background, 'scene.background'); add(R.scene.environment, 'scene.environment');
    const rows = [];
    for (const t of tex.values()) {
      const im = t.image || {};
      rows.push({ mb: texBytes(t) / 1048576, dim: `${im.width || im.videoWidth || 0}x${im.height || im.videoHeight || 0}`, name: t.name || '', kind: t.isCompressedTexture ? 'compressed' : t.isCanvasTexture ? 'canvas' : t.isDataTexture ? 'data' : t.isCubeTexture ? 'cube' : t.isDataArrayTexture ? 'array' : (im.tagName || im.constructor.name || '?'), fmt: t.format + '/' + t.type, mips: t.generateMipmaps !== false && t.minFilter !== 1006 && t.minFilter !== 1003, who: [...(users.get(t.uuid) || [])].join(' | ').slice(0, 110) });
    }
    rows.sort((a, b) => b.mb - a.mb);
    const sum = (f) => Math.round(rows.filter(f).reduce((s, r) => s + r.mb, 0));
    const byKind = {}; for (const r of rows) byKind[r.kind] = (byKind[r.kind] || 0) + r.mb;
    const bySize = {}; for (const r of rows) { const k = r.dim; bySize[k] = bySize[k] || { n: 0, mb: 0 }; bySize[k].n++; bySize[k].mb += r.mb; }
    // render targets reachable from the composer + shadow maps
    const rts = new Set(), seen = new Set();
    const walk = (v, d) => { if (!v || typeof v !== 'object' || seen.has(v) || d > 5) return; seen.add(v); if (v.isWebGLRenderTarget) { rts.add(v); return; } if (v.isTexture || v.isObject3D || v.isMaterial || v.isBufferGeometry || ArrayBuffer.isView(v)) return; for (const k of Object.keys(v)) { try { walk(v[k], d + 1); } catch (e) { /* ignore */ } } };
    if (R.post) walk(R.post.composer, 0);
    R.scene.traverse((x) => { if (x.isLight && x.shadow && x.shadow.map) rts.add(x.shadow.map); });
    const rtRows = [];
    for (const rt of rts) { const n = rt.textures ? rt.textures.length : 1; const ty = rt.texture ? rt.texture.type : 1009; const bpc = ty === 1015 ? 4 : ty === 1016 ? 2 : 1; const b = rt.width * rt.height * (rt.depth || 1) * (4 * bpc * n + (rt.depthBuffer ? 4 : 0)) * (rt.texture && rt.texture.generateMipmaps ? 4 / 3 : 1); rtRows.push({ mb: +(b / 1048576).toFixed(1), dim: `${rt.width}x${rt.height}x${n}`, ty }); }
    // geometry bytes
    const geos = new Map();
    R.scene.traverse((x) => { if (x.geometry && !geos.has(x.geometry.uuid)) { let b = 0; const ga = x.geometry.attributes || {}; for (const k in ga) b += ga[k].array ? ga[k].array.byteLength : 0; if (x.geometry.index) b += x.geometry.index.array.byteLength; geos.set(x.geometry.uuid, b); } });
    return {
      memory: { ...W.info.memory }, programs: W.info.programs.length, drawing: [W.domElement.width, W.domElement.height],
      texCount: rows.length, texTotalMB: Math.round(rows.reduce((s, r) => s + r.mb, 0)),
      byKind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, Math.round(v)])),
      bySize: Object.entries(bySize).sort((a, b) => b[1].mb - a[1].mb).slice(0, 10).map(([k, v]) => `${k} x${v.n} = ${Math.round(v.mb)} MB`),
      rtTotalMB: Math.round(rtRows.reduce((s, r) => s + r.mb, 0)), rt: rtRows.sort((a, b) => b.mb - a.mb).slice(0, 14),
      geoMB: Math.round([...geos.values()].reduce((s, b) => s + b, 0) / 1048576),
      top: rows.slice(0, top).map((r) => `${r.mb.toFixed(1)} MB ${r.dim} ${r.kind} ${r.fmt}${r.mips ? ' mip' : ''} "${r.name}" ${r.who}`),
    };
  }, top);
  log('census ' + JSON.stringify({ memory: res.memory, programs: res.programs, drawing: res.drawing, texCount: res.texCount, texTotalMB: res.texTotalMB, byKind: res.byKind, rtTotalMB: res.rtTotalMB, geoMB: res.geoMB }));
  log('bySize\n  ' + res.bySize.join('\n  '));
  log('rt ' + JSON.stringify(res.rt));
  log('top textures\n  ' + res.top.join('\n  '));
  if (gpuPid) log(`GPU process after census pid ${gpuPid}: ${gpuProcessMB(gpuPid)}`);
  fs.writeFileSync(path.join(api.outDir, 'vram.json'), JSON.stringify({ gpuPid, res }, null, 1));
}
