// Copper Ax TERM-ISOLATION probe (owner: hero-weapons, wave C2 r11). QA only, no runtime hook.
// Same input sequence as weapon_read_probe.mjs (stage 1, light-light-heavy). On the frames AX_FRAMES (default 27-38, the
// board strip) it re-renders the SAME pose (renderer.render(0): no tick, no animation) once per variant, each variant
// switching one shader term off through the per-material uniforms the look already has (no shader edit):
//   ship     shipped look
//   hotOff   kWeaponGlint.x = 1e-6  -> the finite hot streak ~0, the face gradient / hammer ripple still on
//   glintOff kWeaponGlint.x = 0     -> the whole weapon-glint block off (no streak, no face gradient)
//   lockOff  glint off + kMetalTint.x = 0 -> plain three PBR + actor key/rim terms (no hue lock / clamp)
//   rimOff   shipped look, the lit rim (kRimK) = 0 on the ax
//   envOff   shipped look, kMetalEnv = 0 (no IBL specular on metal texels)
//   postOff  shipped look, PostFX bypassed (no AgX tonemap / grade / bloom): the raw linear scene, sRGB-encoded
// Per variant it writes a screenshot `ax_<variant>_<frame>.png` and measures the ax pixels (depth-tested blade mask, as
// weapon_read_metal.mjs) in LINEAR HDR (a float render of the scene, before the post chain) -> terms.json.
//   AX_FRAMES=27-38 AX_HERO=gorrim node tools/capture.mjs --url "/?mode=stage&stage=1&p1=gorrim&bot=1" --warm 8000 \
//     --scenario tools/scenarios/weapon_ax_terms.mjs --frames 75 --step 33 --out progress/shots/hero-weapons/c2r11/terms
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import readProbe from './weapon_read_probe.mjs';
import moveSplit from './weapon_move_split.mjs';

const VARIANTS = (process.env.AX_VARIANTS || 'ship,hotOff,glintOff,lockOff,rimOff,envOff,postOff').split(',');
const [F0, F1] = (process.env.AX_FRAMES || '27-38').split('-').map(Number);
// candidate variants: AX_CANDS='{"c1":{"shape":[.95,1.3,.03,1],"glint":[1,.819,.38,1],"color":[.7,.7,.7],"tint":[1,.22,.12,.7],"emissive":0.5}}'
const CANDS = process.env.AX_CANDS ? JSON.parse(process.env.AX_CANDS) : {};
// any hero weapon: AX_HAND=L measures the left-hand weapon (Dusk); AX_YMIN = local blade start (ax .38, sabres/greatsword .20)
const HAND = process.env.AX_HAND || 'R', YMIN = Number(process.env.AX_YMIN || 0.38);

export default async (api) => {
  const out = [];
  const grab = async (opts) => {
    const result = await api.page.screenshot(opts);
    const m = path.basename(opts.path).match(/^frame_(\d+)\.png$/);
    if (!m || +m[1] < F0 || +m[1] > (F1 ?? F0)) return result;
    const fr = m[1];
    const row = { frame: +fr, variants: {} };
    // the vertex stage's weapon-frame half vector (characterLook.js vKWeaponHalf), replicated: key dir = the stage preset's
    // character key (world) -> view space; components on the ax mesh's model-view axes; w = |flat . view|
    row.half = await api.evalGame(async (hand) => {
      const T = await import('/node_modules/three/build/three.module.js');
      const g = __KCA.game, cam = g.camera, h = g.world.query({ kind: 'hero' })[0];
      let mesh = null; (hand === 'L' ? h.model.weaponL : h.model.weapon).traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
      cam.updateMatrixWorld(); mesh.updateWorldMatrix(true, false);
      const mv = new T.Matrix4().multiplyMatrices(cam.matrixWorldInverse, mesh.matrixWorld), e = mv.elements;
      const ax = (i) => new T.Vector3(e[i * 4], e[i * 4 + 1], e[i * 4 + 2]).normalize();
      const kd = new T.Vector3(0.78, 0.52, 0.36).normalize().transformDirection(cam.matrixWorldInverse);
      const kv = new T.Vector3(-e[12], -e[13], -e[14]).normalize();
      const kh = kd.clone().add(kv).normalize();
      return [ax(0).dot(kh), ax(1).dot(kh), ax(2).dot(kh), Math.abs(ax(0).dot(kv))].map((x) => +x.toFixed(3));
    }, HAND);
    for (const v of VARIANTS) {
      const stats = await api.evalGame(async ([v, cand, hand, ymin]) => {
        const T = await import('/node_modules/three/build/three.module.js');
        const g = __KCA.game, R = g.renderer, r = R.webgl;
        const h = g.world.query({ kind: 'hero' })[0];
        const w = h && h.model && (hand === 'L' ? h.model.weaponL : h.model.weapon); if (!w) return null;
        const mats = []; w.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) if (m && m.userData.kcaWeaponGlintU) mats.push(m); });
        const saved = mats.map((m) => ({ wg: m.userData.kcaWeaponGlintU.value.x, mt: m.userData.kcaMetalTintU.value.x, rk: m.userData.kcaRimK.value, env: m.userData.kcaMetalEnvU.value,
          shape: m.userData.kcaWeaponShapeU.value.toArray(), glint: m.userData.kcaWeaponGlintU.value.toArray(), tint: m.userData.kcaMetalTintU.value.toArray(), color: m.color.toArray(), emi: m.emissiveIntensity }));
        if (cand) for (const m of mats) {
          if (cand.shape) m.userData.kcaWeaponShapeU.value.fromArray(cand.shape);
          if (cand.glint) m.userData.kcaWeaponGlintU.value.fromArray(cand.glint);
          if (cand.tint) m.userData.kcaMetalTintU.value.fromArray(cand.tint);
          if (cand.color) m.color.fromArray(cand.color);
          if (cand.emissive !== undefined) m.emissiveIntensity = cand.emissive;
        }
        for (const m of mats) {
          if (v === 'hotOff') m.userData.kcaWeaponGlintU.value.x = 1e-6;
          if (v === 'glintOff' || v === 'lockOff') m.userData.kcaWeaponGlintU.value.x = 0;
          if (v === 'lockOff') m.userData.kcaMetalTintU.value.x = 0;
          if (v === 'rimOff') m.userData.kcaRimK.value = 0;
          if (v === 'envOff') m.userData.kcaMetalEnvU.value = 0;
        }
        const postWas = R.postEnabled;
        if (v === 'postOff') R.postEnabled = false;   // webgl.outputColorSpace is sRGB already (Renderer.js)
        R.render(0);
        // linear HDR readback + blade mask (depth-tested against the stage)
        const W = window.innerWidth, H = window.innerHeight;
        const rt = new T.WebGLRenderTarget(W, H, { type: T.FloatType, minFilter: T.NearestFilter, magFilter: T.NearestFilter });
        const old = r.getRenderTarget(), auto = r.autoClear, clr = r.getClearColor(new T.Color()), al = r.getClearAlpha();
        const sh = r.shadowMap.autoUpdate; r.shadowMap.autoUpdate = false;
        let res = null;
        try {
          r.setRenderTarget(rt); r.autoClear = true; r.render(R.scene, g.camera);
          const hdr = new Float32Array(W * H * 4); r.readRenderTargetPixels(rt, 0, 0, W, H, hdr);
          const s = new T.Scene(), mm = [];
          w.updateWorldMatrix(true, true);
          w.traverse((o) => { if (!o.isMesh) return;
            // albedo pass: the mask writes the (decoded, linear) base-colour texel -> per-pixel surface class in JS
            const m = new T.ShaderMaterial({ uniforms: { map: { value: o.material.map } },
              vertexShader: 'varying vec3 p; varying vec2 vU; void main(){p=position;vU=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
              fragmentShader: 'uniform sampler2D map; varying vec3 p; varying vec2 vU; void main(){if(p.y<' + ymin.toFixed(3) + ')discard;gl_FragColor=vec4(texture2D(map,vU).rgb,1.);}',
              side: o.material.side, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }); mm.push(m);
            const c = new T.Mesh(o.geometry, m); c.matrixAutoUpdate = false; c.matrix.copy(o.matrixWorld); s.add(c); });
          r.autoClear = false; r.setClearColor(0, 0); r.clear(true, false, false); r.render(s, g.camera);
          const msk = new Float32Array(W * H * 4); r.readRenderTargetPixels(rt, 0, 0, W, H, msk);
          mm.forEach((m) => m.dispose());
          const px = []; let x0 = W, y0 = H, x1 = 0, y1 = 0;
          // surface class from the albedo texel (sRGB-encoded for the hue / saturation test)
          const cls = (a) => { const e = a.map((c) => Math.pow(Math.max(c, 0), 1 / 2.2)); const mx = Math.max(...e), mn = Math.min(...e), sat = mx > 0 ? (mx - mn) / mx : 0;
            let hue = 0; if (mx > mn) { const d = mx - mn; hue = mx === e[0] ? ((e[1] - e[2]) / d) % 6 : mx === e[1] ? (e[2] - e[0]) / d + 2 : (e[0] - e[1]) / d + 4; hue = (hue * 60 + 360) % 360; }
            if (hue > 120 && hue < 220 && sat > 0.2) return 'rune';
            if (sat < 0.42 && mx > 0.62) return 'band';
            if (hue >= 34 && hue < 70 && sat > 0.35) return 'brass';
            if ((hue < 34 || hue > 340) && sat >= 0.42) return 'body';
            return 'other'; };
          for (let i = 0; i < W * H; i++) if (msk[i * 4 + 3] > 0.5) {
            const x = i % W, y = H - 1 - Math.floor(i / W);
            px.push([hdr[i * 4], hdr[i * 4 + 1], hdr[i * 4 + 2], x, y, cls([msk[i * 4], msk[i * 4 + 1], msk[i * 4 + 2]])]);
            x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
          }
          const L = (p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
          px.sort((a, b) => L(a) - L(b));
          const q = (k) => { const p = px[Math.floor(k * (px.length - 1))]; return p ? p.slice(0, 3).map((x) => +x.toFixed(4)) : null; };
          res = { n: px.length, box: [x0, y0, x1, y1], lin: { p10: q(0.1), p50: q(0.5), p75: q(0.75), p90: q(0.9), p98: q(0.98) },
            linLum: { p10: px.length ? +L(px[Math.floor(0.1 * (px.length - 1))]).toFixed(4) : 0, p50: px.length ? +L(px[Math.floor(0.5 * (px.length - 1))]).toFixed(4) : 0, p90: px.length ? +L(px[Math.floor(0.9 * (px.length - 1))]).toFixed(4) : 0 },
            pixels: px.map((p) => [p[3], p[4], p[5]]), classes: {} };
          for (const c of ['body', 'band', 'rune', 'brass', 'other']) {
            const cp = px.filter((p) => p[5] === c); if (!cp.length) continue;
            const qq = (k) => cp[Math.floor(k * (cp.length - 1))].slice(0, 3).map((x) => +x.toFixed(4));
            res.classes[c] = { n: cp.length, p10: qq(0.1), p50: qq(0.5), p90: qq(0.9) };
          }
        } finally { r.setRenderTarget(old); r.autoClear = auto; r.setClearColor(clr, al); r.shadowMap.autoUpdate = sh; rt.dispose(); }
        // re-render the variant for the screenshot (the readback renders above went to the RT only)
        R.render(0);
        window.__axRestore = () => {
          mats.forEach((m, i) => { const s0 = saved[i]; m.userData.kcaWeaponShapeU.value.fromArray(s0.shape); m.userData.kcaWeaponGlintU.value.fromArray(s0.glint); m.userData.kcaMetalTintU.value.fromArray(s0.tint); m.color.fromArray(s0.color); m.emissiveIntensity = s0.emi;
            m.userData.kcaWeaponGlintU.value.x = s0.wg; m.userData.kcaMetalTintU.value.x = s0.mt; m.userData.kcaRimK.value = s0.rk; m.userData.kcaMetalEnvU.value = s0.env; });
          R.postEnabled = postWas;
        };
        return res;
      }, [v, CANDS[v] || null, HAND, YMIN]);
      const shotPath = path.join(api.outDir, `ax_${v}_${fr}.png`);   // (named ax_ for any weapon)
      await api.page.screenshot({ path: shotPath });
      await api.evalGame(() => { window.__axRestore && window.__axRestore(); window.__KCA.game.renderer.render(0); });
      if (stats) {
        const { data, info } = await sharp(shotPath).raw().toBuffer({ resolveWithObject: true });
        const by = {};
        for (const [x, y, c] of stats.pixels) { const i = (y * info.width + x) * info.channels; (by[c] || (by[c] = [])).push([data[i], data[i + 1], data[i + 2]]); }
        const lum = (p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
        for (const [c, arr] of Object.entries(by)) { arr.sort((a, b) => lum(a) - lum(b)); const qq = (k) => arr[Math.floor(k * (arr.length - 1))];
          if (stats.classes[c]) stats.classes[c].disp = { p10: qq(0.1), p50: qq(0.5), p90: qq(0.9) }; }
        // whole-head DISPLAY metrics (sRGB 0..1 luminance of the screenshot pixels): the board's value test is p90 >= .65 with
        // >= 25 % of the head in the dark third, no clipped white; 'salmon' = pale low-saturation red-pink (hue < 18 or > 340,
        // sat < .5, value > .55) -- the r10 failure colour
        const all = Object.values(by).flat(), L1 = (p) => (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255;
        const ls = all.map(L1).sort((a, b) => a - b), qd = (k) => +ls[Math.floor(k * (ls.length - 1))].toFixed(3);
        const hsv = (p) => { const mx = Math.max(...p), mn = Math.min(...p), d = mx - mn; let h = 0; if (d) h = mx === p[0] ? ((p[1] - p[2]) / d + 6) % 6 : mx === p[1] ? (p[2] - p[0]) / d + 2 : (p[0] - p[1]) / d + 4; return [h * 60, mx ? d / mx : 0, mx / 255]; };
        const salmon = all.filter((p) => { const [h, sa, va] = hsv(p); return (h < 18 || h > 340) && sa < 0.5 && va > 0.55; }).length;
        const bodyH = (by.body || []).map((p) => hsv(p)).filter((x) => x[2] > 0.25).map((x) => x[0]).sort((a, b) => a - b);
        stats.display = { n: all.length, p10: qd(0.1), p50: qd(0.5), p90: qd(0.9), dark3: +(ls.filter((x) => x < 1 / 3).length / ls.length).toFixed(3),
          bright: +(ls.filter((x) => x > 0.62).length / ls.length).toFixed(3), clippedWhite: all.filter((p) => p[0] > 250 && p[1] > 250 && p[2] > 250).length,
          salmon: +(salmon / all.length).toFixed(3), bodyHueMedian: bodyH.length ? +bodyH[Math.floor(bodyH.length / 2)].toFixed(1) : null };
        delete stats.pixels;
        row.variants[v] = { ...stats, shot: path.basename(shotPath) };
      }
    }
    out.push(row);
    fs.writeFileSync(path.join(api.outDir, 'terms.json'), JSON.stringify(out));
    api.log(`ax terms f${fr} half ${JSON.stringify(row.half)}: ` + VARIANTS.map((v) => `${v} n${row.variants[v]?.n} lum50 ${row.variants[v]?.linLum.p50} lum90 ${row.variants[v]?.linLum.p90} disp ${JSON.stringify(row.variants[v]?.display)}`).join(' | '));
    return result;
  };
  const page = new Proxy(api.page, { get(t, k) { return k === 'screenshot' ? grab : typeof t[k] === 'function' ? t[k].bind(t) : t[k]; } });
  // AX_BASE=moves: wrap the deterministic forced-move strip (weapon_move_split.mjs, MOVES=..., SPLIT=0) instead of the LHH probe
  if (process.env.AX_BASE === 'moves') { process.env.SPLIT = '0'; await moveSplit({ ...api, page }); } else await readProbe({ ...api, page });
};
