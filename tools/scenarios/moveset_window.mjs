// Dense labelled sheet of a tick window in the moveset showcase (owner: heroes-anim, wave C1 r5).
//   MS_FROM=<tick> MS_N=24 MS_STEP=33 MS_ZOOM=2 node tools/capture.mjs --url "/?mode=showcase&what=moveset&id=<hero>&cam=close" \
//        --scenario tools/scenarios/moveset_window.mjs --warm 0 --out <dir>
// Advances to tick MS_FROM, then captures MS_N frames MS_STEP ms apart. Each tile is cropped around the hero
// (MS_ZOOM × magnification, keeps the hero centred so the leap height reads) and labelled with the tick, state,
// move id, hero y and the front dummy's state. Writes window.png (MS_COLS per row, default 6), window.json and the
// full frames (f_<tick>.png) for closer inspection.
import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  const FROM = Number(process.env.MS_FROM || 0), N = Number(process.env.MS_N || 24), STEP = Number(process.env.MS_STEP || 33);
  const ZOOM = Number(process.env.MS_ZOOM || 2), COLS = Number(process.env.MS_COLS || 6);
  const sharp = (await import('sharp')).default;
  const E = (fn, arg) => api.evalGame(fn, arg);
  const t = await E(() => window.__KCA.game.tick);
  if (t < FROM) await api.advance((FROM - t) * 1000 / 60);
  const rows = [], tiles = [];
  let W = 0, H = 0;
  for (let i = 0; i < N; i++) {
    if (i) await api.advance(STEP);
    const s = await E(() => {
      const K = window.__KCA, g = K.game, h = K.showcase.actor, d = (K.showcase.dummies || [])[0];
      const T3 = h.pos.constructor;
      const p = g.cameraRig.worldToScreen(new T3(h.pos.x, h.pos.y + (h.height || 1.8) * 0.5, h.pos.z));
      const r = g.renderer;
      return { tick: g.tick, st: h.fsm.name, move: h.attack ? h.attack.id : null, mf: h.attack ? h.attack.frame : null, y: +h.pos.y.toFixed(2), x: +h.pos.x.toFixed(2),
        sx: Math.round(p.x), sy: Math.round(p.y), w: r ? r.width : innerWidth, h: r ? r.height : innerHeight, dummy: d ? d.fsm.name : null, dx: d ? +d.pos.x.toFixed(2) : null };
    });
    const buf = await api.page.screenshot({ type: 'png' });
    const meta = await sharp(buf).metadata();
    W = meta.width; H = meta.height;
    const cw = Math.round(W / ZOOM), ch = Math.round(H / ZOOM);
    // keep the crop centred on the hero (screen coords are in the renderer's buffer units, scale to the PNG)
    const kx = W / s.w, ky = H / s.h;
    const cx = Math.max(cw / 2, Math.min(W - cw / 2, s.sx * kx)), cy = Math.max(ch / 2, Math.min(H - ch / 2, s.sy * ky));
    const left = Math.round(cx - cw / 2), top = Math.round(cy - ch / 2);
    const label = `t${s.tick} ${s.st}${s.move ? ' ' + s.move + '#' + s.mf : ''} y${s.y}${s.dummy ? ' · dummy ' + s.dummy : ''}`;
    const svg = Buffer.from(`<svg width="${cw}" height="${ch}"><rect x="0" y="0" width="${cw}" height="26" fill="rgba(0,0,0,0.55)"/><text x="8" y="19" font-family="DejaVu Sans, Arial" font-size="15" fill="#fff">${label.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`);
    const tile = await sharp(buf).extract({ left, top, width: cw, height: ch }).composite([{ input: svg, left: 0, top: 0 }]).png().toBuffer();
    tiles.push(tile);
    fs.writeFileSync(path.join(api.outDir, `f_${String(s.tick).padStart(4, '0')}.png`), buf);
    rows.push({ ...s, label, crop: [left, top, cw, ch] });
    api.log(label);
  }
  const cw = Math.round(W / ZOOM), ch = Math.round(H / ZOOM), G = 4;
  const nrows = Math.ceil(tiles.length / COLS);
  const comps = tiles.map((input, i) => ({ input, left: (i % COLS) * (cw + G), top: Math.floor(i / COLS) * (ch + G) }));
  await sharp({ create: { width: COLS * (cw + G) - G, height: nrows * (ch + G) - G, channels: 3, background: '#111' } }).composite(comps).png().toFile(path.join(api.outDir, 'window.png'));
  fs.writeFileSync(path.join(api.outDir, 'window.json'), JSON.stringify({ from: FROM, n: N, step: STEP, zoom: ZOOM, rows }, null, 1));
  api.log(`moveset_window: ${tiles.length} tiles → window.png`);
};
