// perfbench in-page kit (perf-1650). Injected by tools/perfbench.mjs into a running game page (manual clock). Uses only
// long-lived engine internals (__KCA.game.renderer.webgl/scene/camera/lighting, game.step/renderFrame/advance) so the
// SAME kit measures the candidate and an older baseline build. Nothing here ships with the game.
//   __PB.census()          deterministic budget metrics of one frame (draws, tris, programs, passes & pixels, VRAM est.)
//   __PB.overdraw()        shaded fragments per pixel (opaque / transparent) via counting clones of every material
//   __PB.gpuSample(o)      one interleaved [calibration, frame] GPU timer-query sample (see docs/PERF.md)
//   __PB.cpuCal()          fixed JS kernel wall ms (CPU contention factor)
//   __PB.drive(ms, step)   manual-clock advance in `step` chunks, recording per-frame JS slices + attributions
(() => {
  if (window.__PB) return;
  const g = window.__KCA.game, R = g.renderer, W = R.webgl, gl = W.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const px = new Uint8Array(4);
  const sync = () => { W.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  const frame = () => { const sh = R.lighting && R.lighting.sun && R.lighting.sun.shadow; if (sh) sh.needsUpdate = true; R.render(1 / 60); };
  const PB = { version: 1, known: new Set(W.info.programs.map((p) => p.cacheKey)), measureKeys: new Set() };
  window.__PB = PB;
  PB.seenObj = new WeakSet(); R.scene.traverse((o) => PB.seenObj.add(o));

  // ------------------------------------------------------------------ program tracking (gameplay compiles must be 0)
  PB.newPrograms = () => {
    const out = [];
    for (const p of W.info.programs) {
      if (PB.known.has(p.cacheKey)) continue;
      PB.known.add(p.cacheKey);
      if (!PB.measureKeys.has(p.cacheKey) && !/kca-od/.test(p.cacheKey)) out.push(p);
    }
    // name + what differs from the closest already-linked program (which parameter created the variant?)
    const olds = W.info.programs.filter((p) => !out.includes(p));
    return out.map((p) => {
      const k = p.cacheKey.split(',');
      let best = null, bd = 1e9;
      for (const o of olds) { const ok = o.cacheKey.split(','); let d = Math.abs(ok.length - k.length); for (let i = 0; i < Math.min(ok.length, k.length); i++) if (ok[i] !== k[i]) d++; if (d < bd) { bd = d; best = ok; } }
      const cut = (x, y) => { x = String(x); y = String(y); let j = 0; while (j < x.length && j < y.length && x[j] === y[j]) j++; const j0 = Math.max(0, j - 4); return `${j0 ? '…' : ''}${x.slice(j0, j0 + 40)}>${j0 ? '…' : ''}${y.slice(j0, j0 + 40)}`; };
      const diff = best ? k.map((v, i) => (v !== best[i] ? `${i}:${cut(best[i], v)}` : null)).filter(Boolean).slice(0, 4).join(' ') : 'none';
      // who uses it? (scene materials whose current program is p; shadow depth materials are not in the scene)
      const users = [];
      R.scene.traverse((o) => { if (users.length > 2 || !o.material) return; for (const m of [].concat(o.material)) { const pr = m && W.properties.get(m); if (pr && pr.currentProgram === p) { let ch = '', q2 = o.parent; for (let d = 0; q2 && q2 !== R.scene && d < 8; d++, q2 = q2.parent) if (q2.name && d > 1) ch = q2.name.slice(0, 16); users.push(`${m.name || m.type}${m.isShaderMaterial && !m.name ? "(" + Object.keys(m.uniforms || {}).slice(0, 4).join("/") + ")" : ""}@${(o.name || o.type).slice(0, 24)}${o.isSkinnedMesh ? '(skin)' : ''}<${ch}`); } } });
      // shadow-depth programs (shared custom depth materials are not in the scene): casters using that material that
      // appeared after the kit loaded (or were never drawn before), with their instancing flags
      if (!users.length && /depth/i.test(p.name || '')) R.scene.traverse((o) => { if (users.length > 3 || !o.castShadow || !o.isMesh) return; const dm = o.customDepthMaterial; if ((dm ? dm.name : 'depth') !== p.name || PB.seenObj.has(o)) return; let ch = '', q2 = o.parent; for (let d = 0; q2 && q2 !== R.scene && d < 8; d++, q2 = q2.parent) if (q2.name) ch = q2.name.slice(0, 16); users.push(`${(o.name || o.type).slice(0, 24)}${o.isInstancedMesh ? `(inst${o.instanceColor ? '+color' : ''}${o.morphTexture ? '+morph' : ''})` : ''}${o.isSkinnedMesh ? '(skin)' : ''}${o.isBatchedMesh ? '(batched)' : ''}<${ch}`); });
      return `${p.name || k[0].slice(0, 20)}{${diff}}${users.length ? '[' + users.join(',') + ']' : ''}`;
    });
  };

  // ------------------------------------------------------------------ JS slices (sync work between yields)
  const SL = PB.sl = { frames: [], big: [], sys: null };
  const origStep = g.step.bind(g), origRF = g.renderFrame.bind(g);
  let simAcc = 0, stepMax = 0, sysAcc = null;
  const wrapSystems = () => {
    for (const s of g.systems) {
      if (s.__pbw) continue; s.__pbw = true;
      for (const k of ['update', 'render']) {
        const f = s[k]; if (typeof f !== 'function') continue;
        s[k] = function (...a) { const t = performance.now(); try { return f.apply(this, a); } finally { if (sysAcc) { const n = s.name + '.' + k; sysAcc[n] = (sysAcc[n] || 0) + performance.now() - t; } } };
      }
    }
  };
  const origRender = R.render;
  PB.slicesOn = () => {
    wrapSystems();
    R.render = function (dt) { const t = performance.now(); try { return origRender.call(R, dt); } finally { if (sysAcc) sysAcc['renderer.render'] = (sysAcc['renderer.render'] || 0) + performance.now() - t; } };
    g.step = () => { const t = performance.now(); sysAcc = sysAcc || {}; try { origStep(); } finally { const d = performance.now() - t; simAcc += d; if (d > stepMax) stepMax = d; } };
    g.renderFrame = (a, dt) => {
      sysAcc = sysAcc || {};
      const t = performance.now();
      try { origRF(a, dt); } finally {
        const r = performance.now() - t, tot = simAcc + r;
        SL.frames.push([tot, simAcc, r]);
        if (tot > (PB.bigMs || 50)) { const top = Object.entries(sysAcc).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([n, v]) => n + ' ' + v.toFixed(0)); SL.big.push({ ms: +tot.toFixed(1), sim: +simAcc.toFixed(1), render: +r.toFixed(1), frame: SL.frames.length - 1, top, rsub: R._sub ? R._sub.map((x) => +x.toFixed(1)).join('/') : '' }); }
        simAcc = 0; stepMax = 0; sysAcc = null;
      }
    };
  };
  PB.slicesOff = () => { g.step = origStep; g.renderFrame = origRF; R.render = origRender; };
  PB.takeSlices = () => { const r = { frames: SL.frames.splice(0), big: SL.big.splice(0) }; return r; };

  /** Manual-clock drive: `ms` of game time in `step`-ms frames (each = sim ticks + one rendered frame). */
  PB.drive = async (ms, step = 16.667) => { for (let t = 0; t < ms - 1e-6; t += step) await g.advance(Math.min(step, ms - t)); };

  // ------------------------------------------------------------------ CPU calibration kernel (fixed work)
  const calBuf = new Float64Array(4096);
  PB.cpuCal = () => {
    const t = performance.now();
    let s = 0.5;
    for (let r = 0; r < 60; r++) for (let i = 0; i < 4096; i++) { s = (s * 1.0000003 + calBuf[(i * 7 + r) & 4095]) % 97.13; calBuf[i] = Math.sqrt(s + i) * 0.5; }
    PB._sink = s;
    return performance.now() - t;
  };

  // ------------------------------------------------------------------ budget census
  const texBytes = (t) => {
    if (!t) return 0;
    if (t.isCompressedTexture && t.mipmaps) return t.mipmaps.reduce((s, m) => s + (m.data ? m.data.byteLength : 0), 0);
    const im = t.image || {}; const w = im.width || im.videoWidth || 0, h = im.height || im.videoHeight || 0, d = im.depth || 1;
    if (!w || !h) return 0;
    const ch = t.format === 1028 /* Red */ ? 1 : t.format === 1030 /* RG */ ? 2 : 4;
    const bpc = t.type === 1015 /* Float */ ? 4 : t.type === 1016 /* Half */ ? 2 : 1;
    const mip = t.generateMipmaps !== false && t.minFilter !== 1006 && t.minFilter !== 1003 ? 4 / 3 : 1;
    return w * h * d * ch * bpc * mip;
  };
  const rtBytes = (rt) => { const n = rt.textures ? rt.textures.length : 1; const ty = rt.texture ? rt.texture.type : 1009; const bpc = ty === 1015 ? 4 : ty === 1016 ? 2 : 1; return rt.width * rt.height * (rt.depth || 1) * (4 * bpc * n + (rt.depthBuffer ? 4 : 0)); };
  const visible = (o) => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
  PB.census = () => {
    // hook draws for one frame: runs of draws to one framebuffer+viewport = a "pass"
    const runs = []; let cur = null, fb = null, vp = [0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight], clears = 0, clearPx = 0;
    const fbIds = new Map(); const fid = (f) => { if (!f) return 0; if (!fbIds.has(f)) fbIds.set(f, fbIds.size + 1); return fbIds.get(f); };
    const o = { bf: gl.bindFramebuffer, vp: gl.viewport, cl: gl.clear, de: gl.drawElements, da: gl.drawArrays, dei: gl.drawElementsInstanced, dai: gl.drawArraysInstanced, dre: gl.drawRangeElements };
    gl.bindFramebuffer = function (t, f) { if (t !== gl.READ_FRAMEBUFFER) { fb = f; cur = null; } return o.bf.call(gl, t, f); };
    gl.viewport = function (x, y, w, h) { vp = [x, y, w, h]; cur = null; return o.vp.call(gl, x, y, w, h); };
    gl.clear = function (m) { clears++; clearPx += vp[2] * vp[3]; return o.cl.call(gl, m); };
    const hit = (inst) => { if (!cur) { cur = { fb: fid(fb), w: vp[2], h: vp[3], draws: 0, inst: 0 }; runs.push(cur); } cur.draws++; cur.inst += inst; };
    gl.drawElements = function (...a) { hit(1); return o.de.apply(gl, a); };
    gl.drawArrays = function (...a) { hit(1); return o.da.apply(gl, a); };
    gl.drawRangeElements = function (...a) { hit(1); return o.dre.apply(gl, a); };
    gl.drawElementsInstanced = function (...a) { hit(a[4] || 1); return o.dei.apply(gl, a); };
    gl.drawArraysInstanced = function (...a) { hit(a[3] || 1); return o.dai.apply(gl, a); };
    try { frame(); } finally { gl.bindFramebuffer = o.bf; gl.viewport = o.vp; gl.clear = o.cl; gl.drawElements = o.de; gl.drawArrays = o.da; gl.drawElementsInstanced = o.dei; gl.drawArraysInstanced = o.dai; gl.drawRangeElements = o.dre; }
    const info = W.info;
    const eq = 1920 * 1080;
    const passPx = runs.reduce((s, r) => s + r.w * r.h, 0);
    // merge runs into a compact pass table: same fb+size consecutive
    const passes = [];
    for (const r of runs) { const l = passes[passes.length - 1]; if (l && l.fb === r.fb && l.w === r.w && l.h === r.h) { l.draws += r.draws; l.runs++; } else passes.push({ fb: r.fb, w: r.w, h: r.h, draws: r.draws, runs: 1 }); }
    // scene walk
    const tex = new Map(), texVis = new Set(), geos = new Map(), skel = new Set();
    const odd = new Map(); // opaque draws with unusual ordering/depth state (sky/backdrop layers): early-z audit
    let meshes = 0, visMeshes = 0, casters = 0, skinned = 0, bones = 0, instanced = 0, instances = 0, transparentMeshes = 0, lights = 0, pointLights = 0;
    R.scene.traverse((x) => {
      if (x.isLight) { if (visible(x) && x.intensity > 0 && (x.color.r + x.color.g + x.color.b) > 0) { lights++; if (x.isPointLight) pointLights++; } return; }
      if (!(x.isMesh || x.isPoints || x.isSprite || x.isLine)) return;
      meshes++;
      const vis = visible(x);
      const ms = x.material ? [].concat(x.material) : [];
      for (const m of ms) { if (!m) continue; for (const k in m) { const v = m[k]; if (v && v.isTexture) { tex.set(v.uuid, v); if (vis) texVis.add(v.uuid); } } if (m.uniforms) for (const k in m.uniforms) { const v = m.uniforms[k] && m.uniforms[k].value; if (v && v.isTexture) { tex.set(v.uuid, v); if (vis) texVis.add(v.uuid); } } }
      if (x.geometry && !geos.has(x.geometry.uuid)) { let b = 0; const ga = x.geometry.attributes || {}; for (const k in ga) b += ga[k].array ? ga[k].array.byteLength : 0; if (x.geometry.index) b += x.geometry.index.array.byteLength; geos.set(x.geometry.uuid, b); }
      if (!vis) return;
      visMeshes++;
      for (const m of ms) if (m && !m.transparent && (x.renderOrder !== 0 || !m.depthWrite || !m.depthTest)) { const k = `${(x.name || x.type).slice(0, 18)}:${x.renderOrder}:${m.depthTest ? 'T' : 'f'}${m.depthWrite ? 'W' : 'n'}`; odd.set(k, (odd.get(k) || 0) + 1); }
      if (x.castShadow) casters++;
      if (ms.some((m) => m && m.transparent)) transparentMeshes++;
      if (x.isSkinnedMesh) { skinned++; if (x.skeleton && !skel.has(x.skeleton)) { skel.add(x.skeleton); bones += x.skeleton.bones.length; } }
      if (x.isInstancedMesh) { instanced++; instances += x.count; }
    });
    let texAll = 0, texV = 0; for (const [id, t] of tex) { const b = texBytes(t); texAll += b; if (texVis.has(id)) texV += b; }
    // render targets reachable from the post chain + shadow maps
    const rts = new Set(), seen = new Set();
    const walk = (v, d) => { if (!v || typeof v !== 'object' || seen.has(v) || d > 5) return; seen.add(v); if (v.isWebGLRenderTarget) { rts.add(v); return; } if (v.isTexture || v.isObject3D || v.isMaterial || v.isBufferGeometry || ArrayBuffer.isView(v)) return; for (const k of Object.keys(v)) { try { walk(v[k], d + 1); } catch (e) { /* getter */ } } };
    if (R.post) walk(R.post.composer, 0);
    R.scene.traverse((x) => { if (x.isLight && x.shadow && x.shadow.map) rts.add(x.shadow.map); });
    let rtB = 0; for (const rt of rts) rtB += rtBytes(rt);
    const MB = (b) => Math.round(b / 1048576);
    return {
      calls: info.render.calls, triangles: info.render.triangles, points: info.render.points, lines: info.render.lines,
      programs: info.programs.length, geometries: info.memory.geometries, textures: info.memory.textures,
      drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], pixelRatio: +W.getPixelRatio().toFixed(3),
      passes: passes.length, passPixels1080: +(passPx / eq).toFixed(2), clears, clearPixels1080: +(clearPx / eq).toFixed(2),
      passTable: passes.map((p) => `${p.fb}:${p.w}x${p.h}:${p.draws}`).join(' '),
      meshes, visMeshes, casters, skinned, bones, instanced, instances, transparentMeshes, lights, pointLights,
      texMB: MB(texAll), texVisMB: MB(texV), rtMB: MB(rtB), geoMB: MB([...geos.values()].reduce((s, b) => s + b, 0)),
      opaqueOdd: [...odd.entries()].slice(0, 30).map(([k, n]) => (n > 1 ? `${k}×${n}` : k)).join(' '),
      vramEstMB: MB(texAll + rtB + [...geos.values()].reduce((s, b) => s + b, 0)),
    };
  };

  // ------------------------------------------------------------------ overdraw
  const odCache = new WeakMap();
  const outName = (src) => { const m = /(?:^|\n)\s*(?:layout\s*\([^)]*\)\s*)?out\s+(?:highp\s+|mediump\s+|lowp\s+)?vec4\s+(\w+)\s*;/.exec(src); return m ? m[1] : 'gl_FragColor'; };
  const odMat = (m) => {
    if (!m) return m;
    let c = odCache.get(m);
    if (c) return c;
    { const ud = m.userData; m.userData = {}; try { c = m.clone(); } finally { m.userData = ud; } c.userData = ud; } // no JSON round-trip of userData (S4: it poisoned V8 allocation sites → phantom alloc)
    const tr = !!m.transparent;
    const prevOBC = m.onBeforeCompile, prevKey = m.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : () => '';
    c.onBeforeCompile = function (s, r) {
      if (prevOBC) prevOBC.call(m, s, r);
      const fsrc = s.fragmentShader, i = fsrc.lastIndexOf('}');
      s.fragmentShader = fsrc.slice(0, i) + `\n${outName(fsrc)} = vec4(${tr ? '0.0, 1.0' : '1.0, 0.0'}, 0.0, 1.0);\n}` + fsrc.slice(i + 1);
    };
    c.customProgramCacheKey = () => prevKey() + '|kca-od' + (tr ? 'T' : 'O');
    c.blending = 5; c.blendSrc = 201; c.blendDst = 201; c.blendEquation = 100; c.blendSrcAlpha = 201; c.blendDstAlpha = 201; c.blendEquationAlpha = 100;
    c.premultipliedAlpha = false; c.toneMapped = false; c.fog = false; c.dithering = false;
    if (c.uniforms && m.uniforms) c.uniforms = m.uniforms; // share live uniforms (time, textures)
    c.name = (m.name || m.type) + '-od';
    odCache.set(m, c);
    return c;
  };
  let odRT = null;
  PB.overdraw = (part = null) => {
    const tg = part ? PB.parts[part] : null;
    if (tg) tg[0]();
    try { return odOnce(); } finally { if (tg) tg[1](); }
  };
  /** Transparent overdraw by material (spell FX budget): each transparent material's objects rendered ALONE into the
   *  counting target (no occluders: its raw fragment count) →
   *  fragments per screen pixel it contributes (mean) and its hottest pixel. Top n by mean. */
  PB.odByMat = (n = 8, opaque = false) => {   // opaque: split the OPAQUE layers instead (alpha-tested foliage etc.)
    const groups = new Map();
    R.scene.traverseVisible((o) => { if (!(o.isMesh || o.isPoints || o.isSprite) || !o.material) return; const ms = [].concat(o.material); if (ms.some((m) => m && m.transparent) === opaque) return; const m = ms[0]; const k = (m.name || m.type) + '@' + (o.name || o.parent && o.parent.name || o.type).slice(0, 20); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(o); });
    const out = [];
    // hot mask: pixels with ≥ 9 layers in the FULL frame → per group: its mean layers inside the mask ("hot" column)
    odOnce(); const full = PB._od; const mask = new Uint8Array(full.w * full.h); let mN = 0;
    for (let i = 0, j = 0; i < full.buf.length; i += 4, j++) if (full.buf[i] + full.buf[i + 1] >= 9) { mask[j] = 1; mN++; }
    for (const [k, objs] of groups) {
      const hid = [];
      R.scene.traverseVisible((o) => { if ((o.isMesh || o.isPoints || o.isSprite || o.isLine) && o.material && !objs.includes(o)) hid.push(o); });
      for (const o of hid) o.visible = false;
      let r = null;
      try { r = odOnce(); } finally { for (const o of hid) o.visible = true; }
      let hot = 0; if (r && mN) { const b = PB._od.buf; for (let i = 0, j = 0; i < b.length; i += 4, j++) if (mask[j]) hot += b[i] + b[i + 1]; hot = +(hot / mN).toFixed(2); }
      if (r) out.push({ k, n: objs.length, mean: r.mean, max: r.max, p99: r.p99, hot });
    }
    return [`hotMask ${(mN / mask.length * 100).toFixed(1)}% (sorted by hot)`].concat(out.sort((a, b) => b.hot - a.hot).slice(0, n).map((x) => `${x.k}×${x.n} ${x.mean}/${x.p99}/${x.max} hot ${x.hot}`));
  };
  const odOnce = () => {
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    if (!odRT || odRT.width !== w || odRT.height !== h) {
      const RT = R.post && R.post.composer ? R.post.composer.inputBuffer.constructor : null;
      if (!RT) return null;
      if (odRT) odRT.dispose();
      odRT = new RT(w, h, { type: 1015, depthBuffer: true, stencilBuffer: false, generateMipmaps: false, minFilter: 1003, magFilter: 1003 });
    }
    const swapped = [];
    R.scene.traverse((x) => {
      if (!x.material || !(x.isMesh || x.isPoints || x.isSprite || x.isLine)) return;
      const orig = x.material;
      if (Array.isArray(orig)) x.material = orig.map((m) => (m && m.colorWrite === false ? m : odMat(m)));
      else if (orig.colorWrite !== false) x.material = odMat(orig);
      swapped.push([x, orig]);
    });
    // a real THREE.Color (a Vector3 here got x/y/z = undefined → V8 generalised EVERY Vector3 field from double to tagged
    // → every vector/matrix write in the game boxed a HeapNumber afterwards: ~0.8 MB/frame of phantom allocations)
    let ColorC = null; R.scene.traverse((o) => { if (!ColorC && o.material && !Array.isArray(o.material) && o.material.color && o.material.color.isColor) ColorC = o.material.color.constructor; });
    const bg = R.scene.background, fogS = R.scene.fog, cc = W.getClearColor(new ColorC()), ca = W.getClearAlpha(), ac = W.autoClear;
    const keys0 = new Set(W.info.programs.map((p) => p.cacheKey));
    let buf;
    try {
      R.scene.background = null;
      W.setRenderTarget(odRT); W.setClearColor(0x000000, 0); W.autoClear = false; W.clear(true, true, false);
      W.render(R.scene, R.camera);
      buf = new Float32Array(w * h * 4);
      W.readRenderTargetPixels(odRT, 0, 0, w, h, buf);
    } finally {
      for (const [x, m] of swapped) x.material = m;
      R.scene.background = bg; R.scene.fog = fogS; W.setRenderTarget(null); W.setClearColor(cc, ca); W.autoClear = ac;
      for (const p of W.info.programs) if (!keys0.has(p.cacheKey)) PB.measureKeys.add(p.cacheKey);
    }
    PB._od = { buf, w, h };
    const hist = new Uint32Array(257), histT = new Uint32Array(257);
    let sO = 0, sT = 0, mx = 0, mxT = 0;
    for (let i = 0; i < buf.length; i += 4) {
      const o = Math.round(buf[i]), t = Math.round(buf[i + 1]), tot = o + t;
      sO += o; sT += t; if (tot > mx) mx = tot; if (t > mxT) mxT = t;
      hist[Math.min(256, tot)]++; histT[Math.min(256, t)]++;
    }
    const n = w * h;
    const pct = (H, p) => { let acc = 0; for (let i = 0; i < H.length; i++) { acc += H[i]; if (acc >= p * n) return i; } return 256; };
    return { mean: +((sO + sT) / n).toFixed(2), opaque: +(sO / n).toFixed(2), transparent: +(sT / n).toFixed(2), p95: pct(hist, 0.95), p99: pct(hist, 0.99), max: mx, tP95: pct(histT, 0.95), tMax: mxT, size: [w, h] };
  };

  /** Overdraw HEAT MAP of the last overdraw pass (PNG data URL, 1/4 res): grey = layers × 24, pixels ≥ 9 layers red
   *  (≥ 13 yellow); blue channel = transparent share. Where is the p95? */
  PB.odHeat = () => {
    const o = PB._od; if (!o) return null;
    const cw = o.w >> 2, ch = o.h >> 2, cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const cx = cv.getContext('2d'), im = cx.createImageData(cw, ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const i = (((o.h - 1 - y * 4) * o.w) + x * 4) * 4, op = o.buf[i], tr = o.buf[i + 1], t = op + tr, j = (y * cw + x) * 4;
      const g = Math.min(255, t * 24);
      im.data[j] = t >= 9 ? 255 : g; im.data[j + 1] = t >= 13 ? 255 : (t >= 9 ? 40 : g); im.data[j + 2] = t >= 9 ? 40 : Math.min(255, g + tr * 30); im.data[j + 3] = 255;
    }
    cx.putImageData(im, 0, 0);
    return cv.toDataURL('image/png');
  };

  // ------------------------------------------------------------------ GPU timing (timer queries + blocker + calibration)
  let kProg = null, kFb = null, kVao = null, kTex = null, kU = null;
  const KW = 1920, KH = 1080;
  const kInit = () => {
    if (kProg) return;
    const vs = '#version 300 es\nvoid main(){ vec2 p = vec2(gl_VertexID==1?3.0:-1.0, gl_VertexID==2?3.0:-1.0); gl_Position=vec4(p,0.0,1.0);}';
    // mixed ALU + texture bandwidth, like a lit full-screen frame; fixed forever (changing it invalidates calibration)
    const fs = '#version 300 es\nprecision highp float; uniform float k; uniform sampler2D tx; out vec4 o;\n' +
      'void main(){ vec2 uv = gl_FragCoord.xy / vec2(1920.0,1080.0); vec3 a = vec3(uv, k); vec4 acc = vec4(0.0);\n' +
      ' for(int i=0;i<24;i++){ a = fract(a*1.37 + a.yzx*0.71 + 0.13); a = a*a*(3.0-2.0*a); acc += texture(tx, uv*float(1+i%3) + a.xy*0.01); }\n' +
      ' o = vec4(a, 1.0) + acc*0.001; }';
    const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); return x; };
    kProg = gl.createProgram(); gl.attachShader(kProg, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(kProg, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(kProg);
    if (!gl.getProgramParameter(kProg, gl.LINK_STATUS)) throw new Error('perfbench kernel: ' + gl.getProgramInfoLog(kProg));
    kU = gl.getUniformLocation(kProg, 'k');
    const src = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, src);
    const N = 1024, d = new Uint8Array(N * N * 4); let s = 12345; for (let i = 0; i < d.length; i++) { s = (s * 1103515245 + 12345) >>> 0; d[i] = s >>> 24; }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, d);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    kTex = src;
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, KW, KH);
    kFb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, kFb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    kVao = gl.createVertexArray();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindTexture(gl.TEXTURE_2D, null);
    W.resetState();
  };
  const kern = (n) => {
    kInit();
    gl.bindFramebuffer(gl.FRAMEBUFFER, kFb); gl.viewport(0, 0, KW, KH); gl.useProgram(kProg); gl.bindVertexArray(kVao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, kTex); gl.uniform1i(gl.getUniformLocation(kProg, 'tx'), 0);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.STENCIL_TEST); gl.colorMask(true, true, true, true); gl.depthMask(false);
    for (let i = 0; i < n; i++) { gl.uniform1f(kU, (i % 17) * 0.01); gl.drawArrays(gl.TRIANGLES, 0, 3); }
    gl.bindVertexArray(null); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    W.resetState();
  };
  const qs = [];
  const timed = async (fn, blockDraws) => {
    if (!ext) return null;
    const q = qs.pop() || gl.createQuery();
    sync();
    // blocker: queue GPU work FIRST and flush it to the GPU process, so the GPU is busy while the renderer (and the
    // GPU-process decoder) submit the timed frames → the query window holds pure GPU time, no CPU starvation gaps
    if (blockDraws) { kern(blockDraws); gl.flush(); }
    const t0 = performance.now();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q); fn(); gl.endQuery(ext.TIME_ELAPSED_EXT);
    const cpu = performance.now() - t0;
    sync();
    const wall = performance.now() - t0;
    let tries = 0; while (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && tries++ < 500) await sleep(1);
    const dis = gl.getParameter(ext.GPU_DISJOINT_EXT);
    const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
    qs.push(q);
    return dis ? null : { gpu: ns / 1e6, cpu, wall };
  };
  PB.gpuWarm = async () => { for (let i = 0; i < 4; i++) frame(); kern(4); sync(); await sleep(0); };
  /** One interleaved sample. frames: frames per burst; calDraws: kernel draws per calibration burst; block: blocker ms. */
  // A sample is VALID only if the renderer finished submitting the burst well before the blocker could have drained
  // (submit < 0.5 × blocker GPU ms); the blocker adapts to the recent submit cost (CPU contention), capped at 300 ms (PB.blockCap).
  // The calibration window is matched in LENGTH to the frame window (PB._calDraws adapts), so both are equally likely
  // to overlap another process's GPU time slice (a short kernel burst slips between them more often → biased ratio).
  PB.gpuSample = async ({ frames = 3, calDraws = null, blockMs = null, part = null } = {}) => {
    calDraws = calDraws || PB._calDraws || 16;
    const cal = await timed(() => kern(calDraws), 0);
    const kms = cal ? cal.gpu / calDraws : 1.5;
    const est = PB._cpuEst || 12 * frames;
    const wantMs = blockMs ?? Math.min(PB.blockCap || 300, est * 2.2 + 10); // cap: long GPU queues risk a TDR / GPU-process reset on this shared laptop
    const blockDraws = blockMs === 0 ? 0 : Math.ceil(wantMs / Math.max(0.2, kms));
    const tg = part ? PB.parts[part] : null;
    if (tg) { tg[0](); frame(); sync(); }
    let fr;
    try { fr = await timed(() => { for (let i = 0; i < frames; i++) frame(); }, blockDraws); } finally { if (tg) { tg[1](); } }
    if (fr) PB._cpuEst = PB._cpuEst ? Math.max(fr.cpu, PB._cpuEst * 0.6 + fr.cpu * 0.4) : fr.cpu;
    // bracket: a second calibration window right AFTER the frame burst → the sample is "clean" only if the GPU was in
    // its uncontended state on both sides of it (bimodal contention: other processes' GPU work comes in bursts)
    const cal2 = await timed(() => kern(calDraws), 0);
    const blockGpu = blockDraws * kms;
    if (fr && !part) PB._calDraws = Math.max(4, Math.min(64, Math.round(fr.gpu / Math.max(0.2, kms))));
    const valid = !!fr && (blockMs === 0 || fr.cpu < 0.5 * blockGpu);
    const c1 = cal ? cal.gpu / calDraws : null, c2 = cal2 ? cal2.gpu / calDraws : null;
    return { cal: c1 != null && c2 != null ? (c1 + c2) / 2 : c1, calMax: c1 != null && c2 != null ? Math.max(c1, c2) : c1, calMin: c1 != null && c2 != null ? Math.min(c1, c2) : c1, frame: fr ? fr.gpu / frames : null, cpu: fr ? fr.cpu / frames : null, wall: fr ? fr.wall / frames : null, block: blockDraws, blockMs: +blockGpu.toFixed(1), valid };
  };
  /** Programs linked by measurement toggles (parts, overdraw) are not gameplay compiles. */
  /** DOM quieting for GPU sampling: CSS/Web animations keep running in real time under the manual clock (spell
   *  cut-in cards, boss band, HUD pulses) and their raster + composite share the GPU with our timed windows — a
   *  self-inflicted "contention" that made every cast/boss window look noisy. Pause them (and hide the UI layer)
   *  while sampling; the est metric excludes compositor/DOM cost by design (docs/PERF.md §3c). */
  let quiet = null;
  PB.domInfo = () => { const an = document.getAnimations ? document.getAnimations() : []; return { anims: an.length, running: an.filter((a) => a.playState === 'running').length, infinite: an.filter((a) => a.effect && a.effect.getTiming && a.effect.getTiming().iterations === Infinity).length, names: [...new Set(an.map((a) => a.animationName || (a.effect && a.effect.target && a.effect.target.className) || '?'))].slice(0, 8).join(',') }; };
  PB.quietDom = (on) => {
    if (on && !quiet) {
      const an = (document.getAnimations ? document.getAnimations() : []).filter((a) => a.playState === 'running');
      for (const a of an) a.pause();
      const hid = [];
      for (const el of [...document.querySelectorAll('body > *'), ...document.querySelectorAll('.kca-ui')]) { if (el.tagName !== 'CANVAS' && !el.querySelector('canvas') && el.style.visibility !== 'hidden') { hid.push([el, el.style.visibility]); el.style.visibility = 'hidden'; } }
      quiet = { an, hid };
    } else if (!on && quiet) {
      for (const a of quiet.an) { try { a.play(); } catch (e) { /* finished */ } }
      for (const [el, v] of quiet.hid) el.style.visibility = v;
      quiet = null;
    }
  };
  /** GL errors of one real frame, attributed to the program (and scene materials) of each failing draw.
   *  A GL_INVALID_OPERATION draw is SKIPPED by the driver — something is silently missing on screen. */
  PB.glErrors = () => {
    const out = new Map();
    const names = ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements'];
    const orig = {};
    while (gl.getError()) { /* clear */ }
    for (const n of names) { orig[n] = gl[n]; gl[n] = function (...a) { const r = orig[n].apply(gl, a); const e = gl.getError(); if (e) { const cp = gl.getParameter(gl.CURRENT_PROGRAM); const p = W.info.programs.find((x) => x.program === cp); const fb = gl.getParameter(gl.FRAMEBUFFER_BINDING); const k = `${e}:${p ? (p.name || p.cacheKey.slice(0, 40)) : '?'}`; if (!out.has(k)) { const users = []; if (p) R.scene.traverse((o) => { if (users.length < 3 && o.material) for (const m of [].concat(o.material)) { const pr = m && W.properties.get(m); if (pr && pr.currentProgram === p) users.push(`${m.name || m.type}@${(o.name || o.type).slice(0, 20)}`); } }); out.set(k, { n: 0, fb: !!fb, users }); } out.get(k).n++; } return r; }; }
    try { frame(); sync(); } finally { for (const n of names) gl[n] = orig[n]; }
    return [...out.entries()].map(([k, v]) => `${k} ×${v.n}${v.fb ? ' (RT)' : ''} [${v.users.join(',')}]`);
  };
  PB.absorbPrograms = () => { for (const p of W.info.programs) if (!PB.known.has(p.cacheKey)) PB.measureKeys.add(p.cacheKey); };
  // ------------------------------------------------------------------ cost split toggles (--parts): [apply, restore]
  const hideWhere = (pred) => { let hid = []; return [() => { hid = []; R.scene.traverse((o) => { if (o.visible && pred(o)) { o.visible = false; hid.push(o); } }); }, () => { for (const o of hid) o.visible = true; hid = []; }]; };
  const smR = W.shadowMap.render; let noSh = false;
  W.shadowMap.render = function (...a) { if (noSh) return; return smR.apply(this, a); };
  const post = R.post, passes = post && post.composer ? post.composer.passes : [];
  const smaaPass = passes.length && passes[passes.length - 1] !== post.mainPass ? passes[passes.length - 1] : null;
  const isTransparent = (o) => o.material && [].concat(o.material).some((m) => m && m.transparent);
  PB.parts = {
    shadowPass: [() => { noSh = true; }, () => { noSh = false; }],
    casters: (() => { let cs = []; return [() => { cs = []; R.scene.traverse((o) => { if (o.castShadow) { o.castShadow = false; cs.push(o); } }); }, () => { for (const o of cs) o.castShadow = true; }]; })(),
    post: [() => { R.postEnabled = false; }, () => { R.postEnabled = true; }],
    smaa: [() => { if (smaaPass) { smaaPass.enabled = false; post.mainPass.renderToScreen = true; } }, () => { if (smaaPass) { smaaPass.enabled = true; post.mainPass.renderToScreen = false; } }],
    bloomBlur: [() => { if (post.bloom.mipmapBlurPass) post.bloom.mipmapBlurPass.enabled = false; post.bloom.luminancePass.enabled = false; }, () => { if (post.bloom.mipmapBlurPass) post.bloom.mipmapBlurPass.enabled = true; post.bloom.luminancePass.enabled = true; }],
    env: [() => { R.envGroup.visible = false; }, () => { R.envGroup.visible = true; }],
    actors: (() => { let h = []; return [() => { h = []; for (const a of g.world.actors) if (a.view && a.view.visible) { a.view.visible = false; h.push(a.view); } }, () => { for (const v of h) v.visible = true; }]; })(),
    vfx: [() => { if (g.vfx && g.vfx.group) g.vfx.group.visible = false; }, () => { if (g.vfx && g.vfx.group) g.vfx.group.visible = true; }],
    transparent: hideWhere(isTransparent),
    instanced: hideWhere((o) => o.isInstancedMesh),
    sky: hideWhere((o) => o.parent === R.scene && /sky/i.test(o.name || '')),
    // early-z experiment: opaque sky/backdrop layers (renderOrder < 0, depth-tested) drawn AFTER the opaque geometry
    earlyZ: (() => { let ch = []; return [() => { ch = []; R.scene.traverse((o) => { if (o.renderOrder < 0 && o.material && ![].concat(o.material).some((m) => m && (m.transparent || !m.depthTest))) { ch.push([o, o.renderOrder]); o.renderOrder = 100000 + o.renderOrder; } }); }, () => { for (const [o, r] of ch) o.renderOrder = r; ch = []; }]; })(),
    pr085: [() => { PB._pr = W.getPixelRatio(); W.setPixelRatio(PB._pr * 0.85); if (post) post.setSize(R.width, R.height); }, () => { W.setPixelRatio(PB._pr); if (post) post.setSize(R.width, R.height); }],
  };

  /** One toggle per visible top-level env child (per-piece cost census). */
  PB.envParts = () => {
    const out = [];
    R.envGroup.children.forEach((c, i) => { if (!c.visible) return; const nm = 'env' + i + ':' + (c.name || c.type).slice(0, 24); PB.parts[nm] = [() => { c.visible = false; }, () => { c.visible = true; }]; out.push(nm); });
    return out;
  };

  // ------------------------------------------------------------------ deterministic phase drivers (manual clock, seed 1)
  const D = () => window.__KCA.debug;
  const heroes = () => g.world.query({ kind: 'hero' });
  let bossEv = null;   // group bosses (Brute Brothers, Captains, Wyrm Rider): regular enemies behind a proxy { members }
  const bosses = () => g.world.actors.filter((a) => a.alive !== false && (a.kind === 'boss' || (a.def && a.def.boss) || a.inStage || (bossEv && bossEv.members && bossEv.members.includes(a))));
  const immortal = () => { for (const a of bosses()) { a.maxHp = Math.max(a.maxHp || 0, 99999); a.hp = 99999; } for (const h of heroes()) if (h.maxHp) h.hp = h.maxHp; };
  // Manual-clock advance waits for tracked promises; some tracked promises wait on GAME time (boss intros:
  // game.track(G.intro({ ticks }))) and can only resolve if the sim advances → every advance() would sit out the
  // 8 s + 2 s flush timeouts. A promise still pending after one full flush wait is time-dependent: stop waiting on it.
  const timeDep = new WeakSet();
  const origFlush = g.flushPending.bind(g);
  g.flushPending = async (timeoutMs = 8000) => {
    const ps = [...g.pending].filter((p) => !timeDep.has(p));
    if (!ps.length) return;
    let done = false;
    await Promise.race([Promise.allSettled(ps).then(() => { done = true; }), sleep(timeoutMs)]);
    if (!done) for (const p of ps) if (g.pending.has(p)) timeDep.add(p);
  };
  PB.restoreFlush = () => { g.flushPending = origFlush; };
  PB.onStep = null;
  const drive = async (ms, step = 16.667) => { for (let t = 0; t < ms - 1e-6; t += step) { await g.advance(Math.min(step, ms - t)); if (PB.onStep) PB.onStep(); } };
  PB.drive = drive;
  let bossIntro = 0;
  try { g.bus.on('bossIntro', (ev) => { bossIntro++; if (ev && ev.boss) bossEv = ev.boss; }); } catch (e) { /* older bus */ }
  /** Bulk part of a phase (not sampled). Returns a note. */
  PB.pre = async (name) => {
    const d = D();
    if (name === 'reveal') { PB.onStep = null; return 'ready+0'; }
    if (name === 'combat') { d.god(true); d.pots(1, 9); d.pots(2, 9); await drive(7000, 50); return 'fight 7s'; }
    if (name === 'cast') {
      d.god(true); d.pots(1, 9); d.pots(2, 9);
      const hs = heroes(); d.cast(1, 9); if (hs.length > 1) d.cast(2, 9);
      return 'cast top tier ×' + hs.length;
    }
    if (name === 'boss') {
      d.god(true);
      const L = g.levels, last = L.screens.length - 1;
      for (let i = L.screenIndex; i < last; i++) { d.kill('enemies'); L.waveActors.clear(); }
      for (const h of heroes()) h.pos.x = L.screens[last].x[0] + 3;
      L.pendingSpawns = 0; L.waveActors.clear(); L.enterScreen(last);
      if (g.cameraRig && g.cameraRig.snap) g.cameraRig.snap();
      L.waveActors.clear(); L.pendingSpawns = 0; L.waveIndex = (L.screens[last].waves || []).length - 1; L.nextWave();
      let t = 0;
      for (; t < 90000 && !bossIntro; t += 100) {
        await drive(100, 100);
        if (t % 5000 === 0) console.log('[pb] boss wait', t, 'screen', L.screenIndex, '/', last, 'wave', L.waveIndex, 'actors', L.waveActors.size, 'phase', L.phase, 'bosses', bosses().length);
        for (const a of L.waveActors) if (a.alive && !a.inStage && !(a.kind === 'boss' || (a.def && a.def.boss))) { a.hp = 0; try { a.kill && a.kill(); } catch (e) { /* ignore */ } }
      }
      PB.onStep = immortal;
      await drive(4000, 50);
      return `boss intro after ${(t / 1000).toFixed(1)} s, +4 s fight` + (bosses().length ? '' : ' (NO BOSS)');
    }
    throw new Error('unknown phase ' + name);
  };
  /** Sampled window of a phase (every frame rendered: JS slices + allocations are measured over it). */
  PB.window = async (name) => { await drive(name === 'reveal' ? 1200 : name === 'cast' ? 700 : 1000); };
  /** Extra checkpoints measured after the window (cast: later spell stages). */
  PB.checkpoints = { cast: [700, 700] };

  PB.info = () => ({ gpuTimer: !!ext, renderer: (() => { try { const d = gl.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); } catch (e) { return '?'; } })(), quality: g.quality && g.quality.name });
})();
