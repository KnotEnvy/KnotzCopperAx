// Boss DOMINANCE QA (bosses agent, r4 critic gap "the boss loses the silhouette fight"). GPU-independent: every number
// comes from scene state + CPU raycasts, so it is stable on a busy machine (no fps / wall-clock dependence).
// Use with /?mode=stage&stage=<n>&p1=brann&p2=gorrim&bot=1&screen=<boss screen>. God bots; kills the regular wave
// foes until the boss spawns, then samples every STEP s (default 1) until boss:finaleDone or MAX s:
//   ratio    projected screen height of the lead boss silhouette (incl. its mount) / the tallest hero's (≥ 1.5 wanted)
//   vis      share of a GRID (default 5×8) of points over the boss's projected body box NOT covered by a nearer
//            hero / enemy body box or an unfaded foreground stage bbox (analytic, conservative: boxes over-cover
//            silhouettes); heroOcc / stageOcc / otherOcc = covered by a hero / foreground stage mesh / other actor
//   fx       lead boss centre screen-x fraction; mounted = the lead member rides a beast (wyrm rider)
// Shots at AT (s after spawn). Writes boss_dom.json { summary, samples[] }.
import fs from 'node:fs';
import path from 'node:path';

export async function installBossDominance(api, GRID = [5, 8]) {
  await api.evalGame(async (grid) => {
    const K = window.__KCA, g = K.game; K.debug.god(true);
    const res = performance.getEntriesByType('resource').map((r) => r.name).find((n) => /\/three\.js|three\.module\.js|deps\/three/.test(n));
    const THREE = res ? await import(res) : null;
    const B = window.__bd = { done: false, S: [], err: THREE ? null : 'no three module' };
    g.bus.on('boss:finaleDone', () => { B.done = true; });
    if (!THREE) return;
    const rc = new THREE.Raycaster(); rc.params.Points.threshold = 0; rc.params.Line.threshold = 0;
    const v = new THREE.Vector3(), box = new THREE.Box3(), ndc = new THREE.Vector2();
    const owner = new Map();   // mesh → 'boss' | 'hero' | 'actor'
    const visibleChain = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
    const meshes = (root, out = []) => { if (root) root.traverse((o) => { if ((o.isMesh || o.isSkinnedMesh) && visibleChain(o)) out.push(o); }); return out; };
    const rect = (list) => {   // screen rect of a set of meshes (world bbox corners → pixels)
      const W = g.renderer.width, H = g.renderer.height; let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const o of list) {
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
        for (let i = 0; i < 8; i++) {
          v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(g.camera);
          const px = (v.x + 1) / 2 * W, py = (1 - v.y) / 2 * H; x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
        }
      }
      return { x0, x1, y0, y1, h: y1 - y0 };
    };
    // skinned / morph bounding boxes are bind-pose: use the actor's logical height for the projected height instead
    const pxHeight = (a, extra = 0) => {
      const top = (a.height || 2) + extra; const H = g.renderer.height;
      v.set(a.pos.x, a.pos.y, a.pos.z).project(g.camera); const yb = (1 - v.y) / 2 * H;
      v.set(a.pos.x, a.pos.y + top, a.pos.z).project(g.camera); return yb - (1 - v.y) / 2 * H;
    };
    B.sample = () => {
      const cam = g._bossCam; if (!cam) return null;
      const mem = cam.members().filter((m) => m && m.alive && !m.removed && m.view && m.view.visible !== false);
      if (!mem.length) return null;
      g.scene.updateMatrixWorld(true);
      const lead = mem[0];
      const heroes = g.world.query({ kind: 'hero' }).filter((h) => h && !h.removed && h.view);
      owner.clear();
      const bossMesh = [];
      for (const m of mem) { for (const o of meshes(m.view)) { owner.set(o, 'boss'); if (m === lead) bossMesh.push(o); } if (m.mountedOn) for (const o of meshes(m.mountedOn.view)) { owner.set(o, 'boss'); if (m === lead) bossMesh.push(o); } }
      for (const h of heroes) for (const o of meshes(h.view)) owner.set(o, 'hero');
      for (const a of g.world.query({})) if (a && a.view && !heroes.includes(a) && !mem.includes(a)) for (const o of meshes(a.view)) if (!owner.has(o)) owner.set(o, 'actor');
      // ANALYTIC occlusion (r4: CPU raycasts against skinned meshes crashed the tab): every actor = a projected
      // body box (pos, height, ~0.55×height wide); stage occluders = projected world bboxes of unfaded foreground
      // stage meshes (camera side of the band, taller than knee height); a grid over the boss box counts which is
      // nearest to the camera at each point.
      const W = g.renderer.width, H = g.renderer.height, cp = g.camera.position;
      const actorBox = (a, extra = 0, wk = 0.28) => { const h = (a.height || 2) + extra, hw = Math.max(a.radius || 0.4, h * wk); box.min.set(a.pos.x - hw, a.pos.y, a.pos.z - 0.3); box.max.set(a.pos.x + hw, a.pos.y + h, a.pos.z + 0.3); return box; };
      const rectB = (b) => { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (let i = 0; i < 8; i++) { v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(g.camera); const px = (v.x + 1) / 2 * W, py = (1 - v.y) / 2 * H; x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); } return { x0, x1, y0, y1 }; };
      const dist = (b) => { const cx = (b.min.x + b.max.x) / 2, cy = (b.min.y + b.max.y) / 2, cz = b.max.z; return Math.hypot(cx - cp.x, cy - cp.y, cz - cp.z); };
      const mtl = lead.mountedOn;
      const bb = actorBox(lead, mtl ? (mtl.saddleY || 1.2) : 0, mtl ? 0.34 : 0.28).clone();
      const r = rectB(bb), bossD = dist(bb);
      const occ = [];
      for (const h of heroes) { const b = actorBox(h); if (dist(b) < bossD - 0.2) occ.push({ k: 'hero', r: rectB(b), nm: h.typeId }); }
      for (const a of g.world.query({ team: 'enemies' })) if (a && a.alive && !mem.includes(a) && a.view) { const b = actorBox(a); if (dist(b) < bossD - 0.2) occ.push({ k: 'actor', r: rectB(b), nm: a.typeId }); }
      // r9: a RIDERLESS beast (the Wyrm Rider knocked off her wyrm) is an occluder of its rider when it is nearer the
      // camera (r8 counted it as 'boss', so she could lie hidden behind it at vis 0.99). Box = world bbox of its meshes,
      // depth clamped to ±0.7 m around the beast so the near face is its flank, not the splayed tail.
      if (!lead.mountedOn && g.mounts && g.mounts.list) for (const m of g.mounts.list()) {
        if (!m || m.removed || m.rider || !m.view || m.view.visible === false) continue;
        const mb = new THREE.Box3(), tb = new THREE.Box3();
        for (const o of meshes(m.view)) { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); mb.union(tb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld)); }
        if (mb.isEmpty()) continue;
        mb.min.z = Math.max(mb.min.z, m.pos.z - 0.7); mb.max.z = Math.min(mb.max.z, m.pos.z + 0.7);
        if (dist(mb) < bossD - 0.2) occ.push({ k: 'mount', r: rectB(mb), nm: m.typeId || 'mount' });
      }
      const band = g.world.band;
      let magicSeen = 0, magicFaded = 0;
      g.scene.traverse((o) => {
        if (!(o.isMesh || o.isInstancedMesh) || o.isSkinnedMesh || !visibleChain(o)) return;
        for (let p = o; p; p = p.parent) if (p.userData && p.userData.actor) return;
        const mt = Array.isArray(o.material) ? o.material[0] : o.material;
        const magic = o.userData.magicOccluder || /^magic_(spike|column|boulder|fist)$/.test(o.name);
        if (!magic && (!mt || mt.blending === THREE.AdditiveBlending || mt.blending === 2 || mt.depthWrite === false || (mt.transparent && (mt.opacity ?? 1) < 0.5))) return;
        const test = (b, index = 0, worldMatrix = o.matrixWorld) => {
          if (magic) {
            magicSeen++;
            const opacity = o.userData.magicOpacity?.[index] ?? mt?.opacity ?? 1;
            const sampleOpacity = o.userData.magicSampleOpacity;
            if (sampleOpacity && o.userData.magicProtectedOpacity?.[index] < .5) magicFaded++;
            let clear = null;
            if (opacity < 0.5) {
              magicFaded++;
              const pr = o.userData.magicProtectRects, k = index * 4;
              if (!pr) return;
              // Local actor fade: exposed stone stays opaque. Only discount samples inside the shader's mask.
              clear = { x0: (pr[k] + 1) * W / 2, x1: (pr[k + 2] + 1) * W / 2,
                y0: (1 - pr[k + 3]) * H / 2, y1: (1 - pr[k + 1]) * H / 2 };
            }
            // Magic can occlude inside the combat band. Do not apply the stage foreground-only filter.
            if (b.max.y >= 0.5) {
              const stoneBox = o.geometry.boundingBox.clone(), matrix = worldMatrix.clone(), inverse = matrix.clone().invert(), ray = new THREE.Ray(), hit = new THREE.Vector3(), bodyHit = new THREE.Vector3();
              occ.push({ k: 'magic', r: rectB(b), nm: o.name, clear,
                coverage: sampleOpacity ? (px, py) => sampleOpacity(index, px / W * 2 - 1, 1 - py / H * 2) : null,
                // A tall rock's box-centre distance is not its depth at a fighter's torso.
                // Compare ray/box entry depths per sample; no skinned-mesh CPU raycasts.
                inFront: (px, py) => {
                  v.set(px / W * 2 - 1, 1 - py / H * 2, .5).unproject(g.camera);
                  ray.origin.copy(cp); ray.direction.copy(v).sub(cp).normalize();
                  const body = ray.intersectBox(bb, bodyHit);
                  ray.applyMatrix4(inverse);
                  const stone = ray.intersectBox(stoneBox, hit);
                  return !!(body && stone && hit.applyMatrix4(matrix).distanceTo(cp) < bodyHit.distanceTo(cp) - .08);
                } });
            }
            return;
          }
          if (b.max.y < 0.9 || b.min.z < band.zMin) return;
          const cz = (b.min.z + b.max.z) / 2;
          if (!(b.min.z > band.zMax + 0.25 || cz > band.zMax + 1)) return;
          if (dist(b) >= bossD) return;
          occ.push({ k: 'stage', r: rectB(b), nm: o.name || (o.parent && o.parent.name) || '?' });
        };
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        if (o.isInstancedMesh) { if (o.count > 64) return; const m4 = new THREE.Matrix4(); for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m4); if (m4.elements[0] === 0 && m4.elements[5] === 0) continue; test(box.copy(o.geometry.boundingBox).applyMatrix4(m4).applyMatrix4(o.matrixWorld), i, new THREE.Matrix4().multiplyMatrices(o.matrixWorld, m4)); } }
        else test(box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld));
      });
      const rr = { x0: Math.max(0, r.x0), x1: Math.min(W, r.x1), y0: Math.max(0, r.y0), y1: Math.min(H, r.y1) };
      const c = { boss: 0, hero: 0, stage: 0, magic: 0, actor: 0, mount: 0, miss: 0 }, names = {};
      const pri = { hero: 1, mount: 1, actor: 2, stage: 0, magic: 0 };
      if (rr.x1 > rr.x0 && rr.y1 > rr.y0) for (let i = 0; i < grid[0]; i++) for (let j = 0; j < grid[1]; j++) {
        const px = rr.x0 + (i + 0.5) / grid[0] * (rr.x1 - rr.x0), py = rr.y0 + (j + 0.5) / grid[1] * (rr.y1 - rr.y0);
        let f = 'boss';
        for (const q of occ) if (px > q.r.x0 && px < q.r.x1 && py > q.r.y0 && py < q.r.y1) {
          if (q.coverage && q.coverage(px, py) < .5) continue;
          if (q.inFront && !q.inFront(px, py)) continue;
          if (q.clear && px > q.clear.x0 && px < q.clear.x1 && py > q.clear.y0 && py < q.clear.y1) continue;
          if (f === 'boss' || pri[q.k] < pri[f]) f = q.k;
          if (q.k === 'stage' || q.k === 'magic') names[q.nm] = (names[q.nm] || 0) + 1;
        }
        c[f]++;
      }
      c.miss = 0;
      void rc; void ndc; void owner; void rect; void bossMesh;
      const tot = c.boss + c.hero + c.stage + c.magic + c.actor + c.mount;
      const mt = lead.mountedOn;
      const bossPx = pxHeight(lead, mt ? (mt.saddleY || 1.2) * (mt.modelScale || 1) : 0);
      const hh = Math.max(1, ...heroes.map((h) => pxHeight(h)));
      const heightPct = +(100 * bossPx / H).toFixed(1);
      const edgeDist = +(Math.min(r.x0 / W, (W - r.x1) / W, r.y0 / H, (H - r.y1) / H)).toFixed(3);
      const edgeDistX = +(Math.min(r.x0 / W, (W - r.x1) / W)).toFixed(3);
      const inFrame = r.x0 >= 0 && r.x1 <= W && r.y0 >= 0 && r.y1 <= H ? 1 : 0;
      const hIn = heroes.length ? +(heroes.filter((h) => { v.set(h.pos.x, h.pos.y + (h.height || 2) * 0.5, h.pos.z).project(g.camera); return v.x >= -1 && v.x <= 1 && v.y >= -1 && v.y <= 1; }).length / heroes.length).toFixed(2) : 1;
      const bEl = document.querySelector('.kca-boss');
      const banner = bEl ? { opacity: +(Number(getComputedStyle(bEl).opacity) || 0).toFixed(2), t: +(Number(bEl.dataset.t) || 0).toFixed(2) } : null;
      // r10: `.kca-boss` is the INTRO TITLE CARD (UI.bossCard, ~2.5 s, removed after) — NOT the HP/name bar, which is
      // `.kca-bosshp.on` (hpBar below). The card is expected at ~t1–3 s and gone by t5.
      const hpEl = document.querySelector('.kca-bosshp'); const hpBar = hpEl && hpEl.classList.contains('on') ? 1 : 0;
      const s = { t: +(g.tick / 60).toFixed(1), fx: +(((r.x0 + r.x1) / 2) / W).toFixed(3), ratio: +(bossPx / hh).toFixed(2), bossPx: Math.round(bossPx), heroPx: Math.round(hh),
        heightPct, box: [Math.round(r.x0), Math.round(r.y0), Math.round(r.x1), Math.round(r.y1)], edgeDist, edgeDistX, inFrame, heroesInFrame: hIn, banner, hpBar,
        magicOcc: tot ? +(c.magic / tot).toFixed(2) : null, magicSeen, magicFaded,
        vis: tot ? +(c.boss / tot).toFixed(2) : null, heroOcc: tot ? +(c.hero / tot).toFixed(2) : null, stageOcc: tot ? +(c.stage / tot).toFixed(2) : null, otherOcc: tot ? +(c.actor / tot).toFixed(2) : null, mountOcc: tot ? +(c.mount / tot).toFixed(2) : null,
        mounted: lead.mountedOn ? 1 : 0, lead: lead.typeId + (lead.tier ? ':' + lead.tier : ''), n: mem.length, pz: lead.poise ? +lead.poise.frac.toFixed(2) : null };
      // foreground stage cover of the WHOLE frame (clipped bbox areas, unfaded occluders only) + what the fader holds
      let fg = 0; for (const q of occ) if (q.k === 'stage') { const a = Math.max(0, Math.min(W, q.r.x1) - Math.max(0, q.r.x0)) * Math.max(0, Math.min(H, q.r.y1) - Math.max(0, q.r.y0)); fg += a / (W * H); }
      s.fgFrame = +Math.min(1, fg).toFixed(3);
      { const rg = g.cameraRig, lk = rg.lock, lm = rg.limits; s.cam = [+rg.focus.x.toFixed(1), lk ? [+lk.xMin.toFixed(1), +lk.xMax.toFixed(1)] : null, lm ? [+lm.xMin.toFixed(1), +lm.xMax.toFixed(1)] : null, +(cam.halfWidth || 0).toFixed(1)];
        s.xs = [+lead.pos.x.toFixed(1), ...heroes.map((h) => +h.pos.x.toFixed(1) + (h.alive === false ? 'd' : ''))]; s.st = lead.fsm && lead.fsm.name; }
      const oc = cam.occluders; s.faded = oc && oc.list ? oc.list.size : 0;
      if (g.mounts && g.mounts.list) { const L = g.mounts.list(); if (L.length) s.beasts = L.map((m) => [m.mode, m.rider ? m.rider.typeId : null, +Math.hypot(m.pos.x - lead.pos.x, m.pos.z - lead.pos.z).toFixed(1), (m.noMount.get(lead.id) || 0) - g.tick, lead.controllable ? 1 : 0, lead.fsm && lead.fsm.name]); }
      // r9 spacing (Morvane "downed-hero pile"): nearest summoned minion to a LYING hero's body centre / to the lead boss,
      // and the lead boss to a lying hero (m, x/z ellipse-free plain distances). null when no minion / nobody down.
      { const lying = heroes.filter((h) => h.fsm && h.fsm.is('down', 'knockdown', 'getup', 'dead')).map((h) => ({ x: h.pos.x - (h.facing || 1) * (h.height || 1.9) * 0.2, z: h.pos.z }));
        const mins = lead.minions ? [...lead.minions].filter((m) => m && m.alive && !m.removed && m.grounded !== false && !(m.fsm && m.fsm.is('knockdown', 'down', 'getup', 'dead', 'thrown', 'grabbed', 'hitstun', 'enter'))) : [];   // standing skeletons only (knocked bodies can't be steered)
        const dd = (a, p) => Math.hypot(a.pos.x - p.x, (a.pos.z - p.z) * 1.6);
        s.down = lying.length; s.minions = mins.length;
        s.minToDown = lying.length && mins.length ? +Math.min(...mins.flatMap((m) => lying.map((L) => dd(m, L)))).toFixed(2) : null;
        s.minToBoss = mins.length ? +Math.min(...mins.map((m) => dd(m, lead.pos))).toFixed(2) : null;
        s.bossToDown = lying.length ? +Math.min(...lying.map((L) => dd(lead, L))).toFixed(2) : null;
        // r10: EVERY boss member (group bosses) + every beast body vs every lying hero, and lying heroes vs each other
        const bodies = [...mem.filter((m) => !m.mountedOn), ...((g.mounts && g.mounts.list) ? g.mounts.list().filter((m) => m && !m.removed) : [])];
        s.anyBossToDown = lying.length && bodies.length ? +Math.min(...bodies.flatMap((b) => lying.map((L) => dd(b, L)))).toFixed(2) : null;
        s.downToDown = lying.length > 1 ? +dd({ pos: lying[0] }, lying[1]).toFixed(2) : null;
        if (lying.length) s.hs = heroes.map((h) => h.fsm && h.fsm.name); }
      if (c.stage || c.magic) s.stageHit = Object.entries(names).sort((a, b) => b[1] - a[1]).slice(0, 3);
      B.S.push(s); return s;
    };
  }, GRID);
}

export default async (api) => {
  const AT = (process.env.AT || '').split(',').filter(Boolean).map(Number), MAX = Number(process.env.MAX || 100), STEP = Number(process.env.STEP || 1);
  const GRID = (process.env.GRID || '5x8').split('x').map(Number);
  await installBossDominance(api, GRID);
  let spawnT = null;
  for (let i = 0; i < 240 && spawnT === null; i++) {
    await api.advance(500);
    spawnT = await api.evalGame(() => {
      const K = window.__KCA, g = K.game;
      if (g._bossCam) return g.tick / 60;
      for (const e of g.world.query({ team: 'enemies' })) if (e.alive && !e.inStage) K.debug.kill(e.id);
      return null;
    });
  }
  if (spawnT === null) throw new Error('no boss');
  api.log('boss spawn @' + spawnT);
  const shots = [...AT];
  let t = 0;
  while (t < MAX) {
    await api.advance(STEP * 1000); t += STEP;
    const done = await api.evalGame(() => { const B = window.__bd; try { B.sample && B.sample(); } catch (e) { B.err = String(e && e.stack || e).slice(0, 300); } return B.done; });
    if (shots.length && t >= shots[0]) await api.shot('t' + shots.shift());
    if (done) break;
  }
  const out = await api.evalGame((spT) => {
    const B = window.__bd, S = B.S.filter((s) => s.vis !== null);
    const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : null; };
    const avg = (k) => S.length ? +(S.reduce((q, s) => q + s[k], 0) / S.length).toFixed(3) : null;
    // r7 (poise): lead-boss STATE shares over the fight (samples inside the intro / phase-shift script excluded)
    const SK = ['bossWait', 'bossIntro', 'phaseShift', 'enter', 'bossDying', 'dead', 'bones', 'reform'], ST = B.S.filter((s) => s.st && !SK.includes(s.st));
    const sp = (names) => ST.length ? +(100 * ST.filter((s) => names.includes(s.st)).length / ST.length).toFixed(1) : null;
    const stc = {}; for (const s of ST) stc[s.st] = (stc[s.st] || 0) + 1;
    const nearAt = (sec) => {
      let best = null, bd = 999;
      for (const s of B.S) { const d = Math.abs((s.t - spT) - sec); if (d < bd) { bd = d; best = s; } }
      return best ? best.banner : null;
    };
    const BS = B.S.filter((s) => s.banner && s.banner.opacity > 0.05);
    const bannerSeen = BS.length ? { n: BS.length, firstT: +(BS[0].t - spT).toFixed(1), lastT: +(BS[BS.length - 1].t - spT).toFixed(1), maxOpacity: Math.max(...BS.map((s) => s.banner.opacity)) } : null;
    const AB = B.S.filter((s) => s.anyBossToDown != null), DD = B.S.filter((s) => s.downToDown != null);
    return { err: B.err, done: B.done, n: B.S.length,
      summary: { groundedPct: sp(['knockdown', 'down', 'getup', 'unhorsed']), stunnedPct: sp(['hitstun', 'block', 'grabbed', 'thrown', 'stagger']), attackPct: sp(['attack', 'clinch']), threatPct: sp(['attack', 'clinch', 'walk', 'idle', 'pause']), states: stc,
        heightPctMin: B.S.length ? Math.min(...B.S.map((s) => s.heightPct)) : null,
        heightPctMed: med(B.S.map((s) => s.heightPct)),
        pctHeightGe25: B.S.length ? +(100 * B.S.filter((s) => s.heightPct >= 25).length / B.S.length).toFixed(1) : null,
        pctBoxInFrame: B.S.length ? +(100 * B.S.filter((s) => s.inFrame).length / B.S.length).toFixed(1) : null,
        edgeDistMin: B.S.length ? Math.min(...B.S.map((s) => s.edgeDist)) : null,
        edgeDistMed: med(B.S.map((s) => s.edgeDist)),
        pctHeroesInFrame: B.S.length ? +(100 * B.S.reduce((q, s) => q + (s.heroesInFrame ?? 1), 0) / B.S.length).toFixed(1) : null,
        bannerAt: { t5: nearAt(5), t15: nearAt(15), t30: nearAt(30) }, bannerSeen,
        pctHpBar: B.S.length ? +(100 * B.S.filter((s) => s.hpBar).length / B.S.length).toFixed(1) : null,
        onLying: { samplesDown: AB.length, anyBossToDownMin: AB.length ? Math.min(...AB.map((s) => s.anyBossToDown)) : null,
          pctAnyBossToDownLt1: AB.length ? +(100 * AB.filter((s) => s.anyBossToDown < 1).length / AB.length).toFixed(1) : null,
          samplesTwoDown: DD.length, pctDownStackLt1: DD.length ? +(100 * DD.filter((s) => s.downToDown < 1).length / DD.length).toFixed(1) : null },
        ratioMed: med(B.S.map((s) => s.ratio)), ratioMin: Math.min(...B.S.map((s) => s.ratio)), pctRatioLt15: +(100 * B.S.filter((s) => s.ratio < 1.5).length / Math.max(1, B.S.length)).toFixed(1),
        vis: avg('vis'), heroOcc: avg('heroOcc'), stageOcc: avg('stageOcc'), magicOcc: avg('magicOcc'), otherOcc: avg('otherOcc'),
        pctVisLt60: +(100 * S.filter((s) => s.vis < 0.6).length / Math.max(1, S.length)).toFixed(1),
        fgFrame: B.S.length ? +(B.S.reduce((q, s) => q + (s.fgFrame || 0), 0) / B.S.length).toFixed(3) : null, fgFrameMax: Math.max(0, ...B.S.map((s) => s.fgFrame || 0)),
        fadedMax: Math.max(0, ...B.S.map((s) => s.faded || 0)),
        mounted: B.S.length ? +(B.S.reduce((q, s) => q + s.mounted, 0) / B.S.length).toFixed(2) : null,
        fxMin: Math.min(...B.S.map((s) => s.fx)), fxMax: Math.max(...B.S.map((s) => s.fx)),
        mountOcc: avg('mountOcc'), visMinUnmounted: (() => { const U = S.filter((s) => !s.mounted && s.lead && /viper/.test(s.lead)); return U.length ? Math.min(...U.map((s) => s.vis)) : null; })(),
        spacing: (() => { const D = B.S.filter((s) => s.minToDown != null), M = B.S.filter((s) => s.minToBoss != null), BD = B.S.filter((s) => s.bossToDown != null);
          return { samplesDownWithMinions: D.length, minToDownMin: D.length ? Math.min(...D.map((s) => s.minToDown)) : null, pctMinToDownLt1: D.length ? +(100 * D.filter((s) => s.minToDown < 1).length / D.length).toFixed(1) : null,
            minToBossMin: M.length ? Math.min(...M.map((s) => s.minToBoss)) : null, pctMinToBossLt1: M.length ? +(100 * M.filter((s) => s.minToBoss < 1).length / M.length).toFixed(1) : null,
            bossToDownMin: BD.length ? Math.min(...BD.map((s) => s.bossToDown)) : null, pctBossToDownLt1: BD.length ? +(100 * BD.filter((s) => s.bossToDown < 1).length / BD.length).toFixed(1) : null }; })() },
      samples: B.S };
  }, spawnT);
  out.fightS = t;
  api.log(JSON.stringify(out.summary) + ' n=' + out.n + ' err=' + out.err);
  fs.writeFileSync(path.join(api.outDir, 'boss_dom.json'), JSON.stringify(out, null, 1));
};
