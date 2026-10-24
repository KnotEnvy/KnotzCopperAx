// Exact Cinderwyrm contact capture: records first hit at 60 Hz, then 0..330 ms every 33 ms.
// URL /?mode=showcase&what=mount&id=cinderwyrm&scene=ride, or stage=1&p1=brann&p2=seraphine&bot=1.
// --warm 0 --sheet --mp4; MC_STAGE=1 uses the live stage (only the firing hero and first target are staged).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
export default async (api) => {
  const stage = process.env.MC_STAGE === '1';
  if (stage) {
    await api.evalGame(() => window.__KCA.debug.god(true));
    await api.advance(3600); // native stage title lasts 3.2 s; keep HUD and let it expire naturally
  }
  await api.evalGame(async (stage) => {
    const K = window.__KCA, g = K.game; K.debug.god(true);
    const h = stage ? g.world.query({ kind: 'hero' })[0] : K.showcase.hero;
    g.bots.detach(h); K.input.releaseAll(); h.fsm.go('idle');
    let b;
    if (stage) b = await g.mounts.spawn('cinderwyrm', { x: h.pos.x, z: h.pos.z });
    else { b = K.showcase.beast(); if (b.rider) { const old = b.rider; b.dismount({ knocked: true, silent: true }); old.remove(); } }
    b.pos.x = h.pos.x + 0.6; b.pos.z = h.pos.z; b.mount(h, { force: true });
    h.facing = 1; h.vel.set(0, 0, 0); h.input.runDir = 0;
    let f;
    if (stage) { const foes = g.world.query({ team: 'enemies' }).filter(a => a.alive); f = foes[0]; if (!f) f = await K.debug.spawn('marauder', h.pos.x + 4.2, h.pos.z); }
    else f = await K.showcase.spawnFoe('marauder', 4.2, 0, 'straw');
    f.pos.x = h.pos.x + 4.2; f.pos.z = h.pos.z; f.brain = null; f.vel.set(0, 0, 0); f.fsm.go('idle');
    window.__MC = { f, b, hit: null };
    g.bus.on('hit', e => { if (e.moveId === 'beast_fireball' && !window.__MC.hit) window.__MC.hit = { tick: g.tick, target: e.target.id }; });
  }, stage);
  await api.advance(100);
  await api.evalGame(n=>{const r=window.__KCA.game.fxRng;for(let i=0;i<n;i++)r.range(0,1);},Number(process.env.MC_VARIANT||0));
  await api.press(1, 'light', 60);
  let elapsed = 0, recorded = 0;
  const flight = [], flightFiles = [];
  let launched = false, flightMs = 0, flightTicks = 0;
  for (let i = 0; i < 120; i++) {
    const step = 1000 / 60;
    await api.frames(1, step, 'ride'); recorded++; elapsed += step;
    if (launched) { flightMs += step; flightTicks++; }
    const sample = await api.evalGame(() => {
      const X = window.__MC, f = X.b.fireball;
      const g = window.__KCA.game, chest = X.f.modelRoot?.getObjectByName('chest');
      const c = g.camera.position.clone(); if (chest) chest.getWorldPosition(c);
      const target = c.clone(); c.project(g.camera);
      const head = f && !f.removed ? f.view.position.clone() : null;
      const screen = head && head.clone().project(g.camera);
      return { hit: !!X.hit, target: { x: target.x, y: target.y, z: target.z },
        headToChestPx: screen ? Math.hypot((screen.x-c.x)*innerWidth/2, (screen.y-c.y)*innerHeight/2) : null,
        projectile: f && !f.removed ? { x: f.pos.x, y: f.pos.y, z: f.pos.z, visualX: head.x, visualY: head.y, travel: f.travel, range: f.range, arcDistance: f.arcDistance, arcHeight: f.arcHeight, endY: f.endY, damage: f.hitData.damage } : null };
    });
    if ((sample.projectile && (!launched || flightTicks % 2 === 0)) || (launched && sample.hit)) {
      launched = true;
      const file = await api.shot(`flight_${String(flightMs).padStart(3, '0')}ms${sample.hit ? '_contact' : ''}`);
      flight.push({ elapsedMs: elapsed, flightMs, headToChestPx: sample.headToChestPx, target: sample.target, hit: sample.hit, ...sample.projectile, file });
      const tile = path.join(api.outDir, `flight_tile_${flightMs}.png`);
      const label = Buffer.from(`<svg width="800" height="450"><rect width="220" height="30" fill="#111"/><text x="10" y="23" fill="#ffd17c" font-family="sans-serif" font-size="20">flight +${Math.round(flightMs)} ms${sample.hit ? ' CONTACT' : ''}</text></svg>`);
      await sharp(file).resize(800,450).composite([{input:label}]).png().toFile(tile); flightFiles.push(tile);
    }
    if (sample.hit) break;
  }
  if (!await api.evalGame(() => !!window.__MC.hit)) throw new Error('Cinderwyrm did not contact target within 2 seconds');
  await sharp({create:{width:2400,height:450*Math.ceil(flightFiles.length/3),channels:3,background:'#111'}}).composite(flightFiles.map((input,i)=>({input,left:(i%3)*800,top:Math.floor(i/3)*450}))).png().toFile(path.join(api.outDir,'flight-strip.png'));
  const contact = [], crops = [], combustion = [];
  const probe = process.env.MC_PROBE === '1';
  const at = Array.from({ length: 11 }, (_, i) => i * 33);
  for (let i = 0; i < at.length; i++) {
    if (i) { await api.frames(1, at[i] - at[i - 1], 'ride'); recorded++; }
    const meta = await api.evalGame(() => {
      const g = window.__KCA.game, X = window.__MC, f = X.f, chest = f.modelRoot && f.modelRoot.getObjectByName('chest');
      const p = g.camera.position.clone();
      if (chest) chest.getWorldPosition(p); else p.set(f.pos.x, f.pos.y + f.height * 0.55, f.pos.z);
      p.project(g.camera);
      return { hit: X.hit, tick: g.tick, projectileVisible: X.b.fireMesh.visible, projectileLive: X.b.fireMesh.userData.live,
        projectileOpacity: X.b.fireMesh.material.uniforms.uK.value, blastAgeMs: X.b.fireMesh.userData.blast.material.uniforms.uAge.value * 440,
        targetState: f.fsm.name, mounted: !!X.b.rider,
        x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight, w: innerWidth, h: innerHeight };
    });
    if (probe && at[i] >= 33) await api.evalGame(() => {
      const g=window.__KCA.game, grade=g.renderer.post?.grade;
      // GradeEffect.update advances grain even for dt=0. Freeze ONLY the paired probe renders.
      if(grade) { window.__MC.gradeUpdate=grade.update; grade.update=()=>{}; }
      g.renderer.render(0);
    });
    const file = await api.shot(`contact_${String(at[i]).padStart(3, '0')}ms`);
    const crop = path.join(api.outDir, `chest_${String(at[i]).padStart(3, '0')}ms_2x.png`);
    const label = Buffer.from(`<svg width="768" height="720"><rect width="145" height="37" fill="#16100d" fill-opacity="0.85"/><text x="12" y="27" fill="#ffd17c" font-family="sans-serif" font-size="25">+${at[i]} ms</text></svg>`);
    await sharp(file).extract({ left: Math.max(0, Math.min(meta.w - 384, Math.round(meta.x - 192))), top: Math.max(0, Math.min(meta.h - 360, Math.round(meta.y - 200))), width: 384, height: 360 }).resize(768, 720).composite([{ input: label }]).png().toFile(crop);
    contact.push({ offsetMs: at[i], ...meta, file, crop }); crops.push(crop);
    if (probe && at[i] >= 33) {
      const ground = await api.evalGame(() => {
        const K = window.__KCA, g = K.game, X = window.__MC;
        const p = g.camera.position.clone().set(X.f.pos.x - 1.5, X.f.pos.y, X.f.pos.z).project(g.camera);
        X.b.fireMesh.userData.blast.visible = false; g.renderer.render(0);
        return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight };
      });
      const base = await api.shot(`probe_${String(at[i]).padStart(3, '0')}ms_without-blast`);
      await api.evalGame(() => { const g = window.__KCA.game; window.__MC.b.fireMesh.userData.blast.visible = true; g.renderer.render(0); const grade=g.renderer.post?.grade; if(grade&&window.__MC.gradeUpdate) grade.update=window.__MC.gradeUpdate; });
      const normal = await sharp(file).removeAlpha().raw().toBuffer();
      const hidden = await sharp(base).removeAlpha().raw().toBuffer();
      const luma = (buf, idx) => buf[idx] * 0.2126 + buf[idx + 1] * 0.7152 + buf[idx + 2] * 0.0722;
      let sum = 0, groundSum = 0, groundN = 0, min = 255, max = 0, changed = 0, dark = 0, hot = 0, bright = 0, orange = 0, orangeNonDarkening = 0;
      const box = { x0: Math.max(0, Math.round(meta.x - 160)), x1: Math.min(meta.w, Math.round(meta.x + 240)), y0: Math.max(0, Math.round(meta.y - 210)), y1: Math.min(meta.h, Math.round(meta.y + 120)) };
      for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) {
        const j = (y * meta.w + x) * 3;
        if (Math.max(...[0, 1, 2].map(k => Math.abs(normal[j + k] - hidden[j + k]))) < 12) continue;
        const l = luma(normal, j); changed++; sum += l; min = Math.min(min, l); max = Math.max(max, l);
        if (l < luma(hidden, j) - 8) dark++;
        if (l > 210) hot++;
        if (l > luma(hidden, j) + 8) bright++;
        if (normal[j] > 130 && normal[j + 1] > 55 && normal[j] > normal[j + 1] * 1.12 && normal[j + 1] > normal[j + 2] * 1.25) {
          orange++;
          if (l >= luma(hidden, j) - 8) orangeNonDarkening++;
        }
      }
      for (let y = Math.max(0, Math.round(ground.y - 6)); y < Math.min(meta.h, Math.round(ground.y + 6)); y++) for (let x = Math.max(0, Math.round(ground.x - 15)); x < Math.min(meta.w, Math.round(ground.x + 15)); x++) { groundSum += luma(hidden, (y * meta.w + x) * 3); groundN++; }
      combustion.push({ offsetMs: at[i], mask: 'pixels changed >=12/255 when only private blast is hidden; bloom fringe included', changed, mean: sum / changed, min, max, darkeningPixels: dark, nearWhitePixels: hot, brighteningPixels: bright, orangePixels: orange, orangeNonDarkeningPixels: orangeNonDarkening, groundMean: groundSum / groundN, box });
    }
  }
  await sharp({ create: { width: 768 * 3, height: 720 * 4, channels: 3, background: '#111' } }).composite(crops.map((input, i) => ({ input, left: (i % 3) * 768, top: Math.floor(i / 3) * 720 }))).png().toFile(path.join(api.outDir, 'contact-strip-2x.png'));
  fs.copyFileSync(contact[1].file, path.join(api.outDir, 'peak_contact.png'));
  fs.copyFileSync(contact[1].crop, path.join(api.outDir, 'chest-2x.png'));
  await api.frames(Math.max(0, 72 - recorded), 33, 'ride');
  if (contact.some(s => s.projectileVisible || s.projectileLive || s.projectileOpacity !== 0)) throw new Error('Projectile shell survived contact');
  const p132 = combustion.find(x => x.offsetMs === 132), p198 = combustion.find(x => x.offsetMs === 198), p330 = combustion.find(x => x.offsetMs === 330);
  const smokeChecks = p132 && p198 && p330 ? {
    orangeNonDarkeningAt132: p132.orangeNonDarkeningPixels,
    brighteningAt132: p132.brighteningPixels,
    darkening198Over132: p198.darkeningPixels / Math.max(1, p132.darkeningPixels),
    changed330Over132: p330.changed / Math.max(1, p132.changed),
    pass: p132.orangeNonDarkeningPixels >= 100 && p198.darkeningPixels < p132.darkeningPixels * 0.5 && p330.changed < p132.changed * 0.1,
  } : null;
  fs.writeFileSync(path.join(api.outDir, 'contact.json'), JSON.stringify({ flight, smokeChecks, url: api.page.url(), pressToContactMs: elapsed, clipFrames: 72, stage, variant:Number(process.env.MC_VARIANT||0), combustion, sampling: 'first actual beast_fireball hit sampled at 60Hz; flight stills every 33.333ms plus first contact; contact offsets 0..330ms at 33ms. Paired normal/hidden renders hold the identical post grain clock (dt=0 otherwise advances grain). Shell hidden throughout', contact }, null, 2));
  if (process.env.MC_ASSERT === '1' && !smokeChecks?.pass) throw new Error('Smoke overlap/dissipation targets failed: ' + JSON.stringify(smokeChecks));
  api.log(JSON.stringify({ smokeChecks, pressToContactMs: elapsed, contact: contact.map(x => [x.offsetMs, x.tick, x.blastAgeMs]) }));
};
