// Pale spawn figure — frame sheet + numbers from spawn (perf-1650, wave C2 r1). Steps the game from the first playable
// frame to PALE_SECS (default 5 s) in PALE_STEP ms (default 33) at the normal game camera and, every frame, measures
// each on-screen enemy: its whole-body flash (Combatant._flash k = t/dur·strength) and the "pale" pixel fraction inside
// its screen box with the flash as it is vs. the flash forced off (same sim frame re-rendered). Writes
//   pale_sheet.json   per-frame rows + summary (max pale fraction with flash on/off, frames with a body flash)
//   t_<ms>.png        full frames every PALE_EVERY ms (spawn → 5 s contact sheet input)
//   flash_<n>.png     enemy crops (flash ON | flash OFF, 2x) on every frame where an enemy body flash is active
// PALE_RELOAD=1 reloads the page first (warm HTTP cache) and runs on the reloaded page.
// PALE_CLOSE=dist:height:fov:look additionally renders each flash frame from a close drama camera on the flashing foe.
//   node tools/capture.mjs --url "/?mode=stage&stage=1&p1=brann" --scenario tools/scenarios/pale_sheet.mjs --warm 0 --out <dir>
import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  const E = (fn, arg) => api.evalGame(fn, arg);
  const secs = +(process.env.PALE_SECS || 5), step = +(process.env.PALE_STEP || 33), every = +(process.env.PALE_EVERY || 500);
  const out = { secs, step, rows: [], flashes: [] };
  if (process.env.PALE_RELOAD === '1') {
    const t0 = Date.now();
    await api.page.reload({ waitUntil: 'load' });
    await api.page.waitForFunction(() => window.__KCA && window.__KCA.ready, null, { timeout: 300000 });
    await api.page.evaluate(() => window.__KCA.ready);
    out.reloadMs = Date.now() - t0;
    api.log(`reloaded (warm cache) in ${out.reloadMs} ms`);
  }
  out.start = await E(() => { const g = window.__KCA.game; return { tick: g.tick, stage: g.levels && g.levels.stage && g.levels.stage.id }; });
  let nextShot = 0, nFlash = 0;
  for (let t = 0; t <= secs * 1000; t += step) {
    if (t > 0) await api.advance(step);
    const row = await E(async () => {
      const K = window.__KCA, g = K.game, canvas = g.renderer.webgl.domElement;
      const W = canvas.width, H = canvas.height, sx = W / window.innerWidth, sy = H / window.innerHeight;
      const T3 = g.renderer.scene.position.constructor;
      const foes = g.world.actors.filter((a) => (a.kind === 'enemy' || a.kind === 'boss') && a.modelRoot && a.view && a.view.parent);
      const c2 = window.__paleC2 || (window.__paleC2 = document.createElement('canvas'));
      const ctx = c2.getContext('2d', { willReadFrequently: true });
      const boxes = foes.map((a) => {
        const feet = g.cameraRig.worldToScreen(new T3(a.pos.x, a.pos.y, a.pos.z)), head = g.cameraRig.worldToScreen(new T3(a.pos.x, a.pos.y + (a.height || 1.8) * 1.05, a.pos.z));
        const h = Math.abs(feet.y - head.y) * sy, w = h * 0.55;
        const x0 = Math.max(0, Math.round(feet.x * sx - w / 2)), y0 = Math.max(0, Math.round(head.y * sy)), x1 = Math.min(W, Math.round(feet.x * sx + w / 2)), y1 = Math.min(H, Math.round(feet.y * sy));
        return { a, x0, y0, x1, y1, ok: x1 - x0 > 4 && y1 - y0 > 8 };
      });
      const measure = () => {
        g.renderFrame(Math.min(1, g.acc / (1 / 60)), 0);
        return boxes.map((b) => {
          if (!b.ok) return null;
          const w = b.x1 - b.x0, h = b.y1 - b.y0; c2.width = w; c2.height = h;
          ctx.drawImage(canvas, b.x0, b.y0, w, h, 0, 0, w, h);
          const d = ctx.getImageData(0, 0, w, h).data;
          let pale = 0, n = 0, sum = 0;
          for (let i = 0; i < d.length; i += 4) { const r = d[i], gg = d[i + 1], bb = d[i + 2]; n++; sum += 0.2126 * r + 0.7152 * gg + 0.0722 * bb; if (r > 185 && gg > 165 && bb > 120 && r - bb < 90) pale++; }
          return { pale: pale / n, luma: sum / n, png: null };
        });
      };
      const flashK = (a) => { const f = a._flash; return f && f.t > 0 ? (f.t / f.dur) * f.strength : 0; };
      const ks = boxes.map((b) => flashK(b.a));
      const on = measure();
      let off = null;
      const crops = [];
      if (ks.some((k) => k > 0)) {
        // crop ON now (canvas holds the ON frame), then force the body flash off for one re-render
        for (let i = 0; i < boxes.length; i++) if (ks[i] > 0 && boxes[i].ok) { const b = boxes[i], w = b.x1 - b.x0, h = b.y1 - b.y0; c2.width = w; c2.height = h; ctx.drawImage(canvas, b.x0, b.y0, w, h, 0, 0, w, h); crops[i] = { on: c2.toDataURL('image/png') }; }
        // strength 0 (not t = 0): t = 0 would also end the actor's HitFlash entry (vfx/HitFlash.render drops it)
        const saved = boxes.map((b) => b.a._flash.strength); boxes.forEach((b) => { b.a._flash.strength = 0; });
        off = measure();
        for (let i = 0; i < boxes.length; i++) if (crops[i]) { const b = boxes[i], w = b.x1 - b.x0, h = b.y1 - b.y0; c2.width = w; c2.height = h; ctx.drawImage(canvas, b.x0, b.y0, w, h, 0, 0, w, h); crops[i].off = c2.toDataURL('image/png'); }
        boxes.forEach((b, i) => { b.a._flash.strength = saved[i]; });
        g.renderFrame(Math.min(1, g.acc / (1 / 60)), 0);
      }
      return { tick: g.tick, foes: boxes.map((b, i) => ({ id: b.a.id, type: b.a.typeId, tier: b.a.def && Object.keys(b.a.def.tiers || {}).find((k) => b.a.def.tiers[k].asset === b.a.def.asset), state: b.a.fsm && b.a.fsm.name, x: +b.a.pos.x.toFixed(2), k: +ks[i].toFixed(3), flashColor: b.a._flash && b.a._flash.t > 0 ? '#' + b.a._flash.color.getHexString() : null, box: [b.x0, b.y0, b.x1, b.y1], on: on[i] && { pale: +on[i].pale.toFixed(4), luma: +on[i].luma.toFixed(1) }, off: off && off[i] && { pale: +off[i].pale.toFixed(4), luma: +off[i].luma.toFixed(1) }, crop: crops[i] || null })) };
    });
    // crops → files (ON | OFF side by side, 2x)
    for (const f of row.foes) {
      if (!f.crop) continue;
      const sharp = (await import('sharp')).default;
      const a = Buffer.from(f.crop.on.split(',')[1], 'base64'), b = Buffer.from(f.crop.off.split(',')[1], 'base64');
      const m = await sharp(a).metadata();
      const A = await sharp(a).resize(m.width * 2, m.height * 2, { kernel: 'nearest' }).png().toBuffer();
      const B = await sharp(b).resize(m.width * 2, m.height * 2, { kernel: 'nearest' }).png().toBuffer();
      const name = `flash_${String(nFlash++).padStart(3, '0')}_t${t}_e${f.id}.png`;
      await sharp({ create: { width: m.width * 4 + 6, height: m.height * 2, channels: 3, background: '#202020' } }).composite([{ input: A, left: 0, top: 0 }, { input: B, left: m.width * 2 + 6, top: 0 }]).png().toFile(path.join(api.outDir, name));
      f.crop = name;
      out.flashes.push({ t, tick: row.tick, id: f.id, type: f.type, k: f.k, color: f.flashColor, on: f.on, off: f.off, file: name });
    }
    out.rows.push({ t, ...row });
    if (t >= nextShot) { await api.shot(`t_${String(t).padStart(4, '0')}`); nextShot += every; }
  }
  const all = out.rows.flatMap((r) => r.foes.filter((f) => f.on));
  const fl = out.flashes;
  out.summary = {
    frames: out.rows.length, foeFrames: all.length,
    flashFrames: fl.length,
    maxPaleNoFlash: +Math.max(0, ...all.filter((f) => !(f.k > 0)).map((f) => f.on.pale)).toFixed(4),
    maxPaleFlashOn: +Math.max(0, ...fl.map((f) => f.on ? f.on.pale : 0)).toFixed(4),
    maxPaleFlashOff: +Math.max(0, ...fl.map((f) => f.off ? f.off.pale : 0)).toFixed(4),
    maxLumaGain: +Math.max(0, ...fl.map((f) => f.on && f.off ? f.on.luma - f.off.luma : 0)).toFixed(1),
    colors: [...new Set(fl.map((f) => f.color))],
  };
  fs.writeFileSync(path.join(api.outDir, 'pale_sheet.json'), JSON.stringify(out, null, 1));
  api.log('summary ' + JSON.stringify(out.summary));
};
