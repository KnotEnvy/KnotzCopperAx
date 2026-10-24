// Pale spawn figure probe (perf-1650, wave C2 r1). The Heroes team's rim_drama probe (stage 1, Seraphine, 2.5 m face
// camera) showed a flat cream-white horned humanoid at the right frame edge. This probe replays that setup and finds
// the object that draws it: render the frame, count "pale" pixels (bright, low-saturation cream) in a screen region,
// then hide scene subtrees one at a time (re-rendering the SAME sim frame) and descend into whichever subtree removes
// them, down to the mesh. Reports the mesh's chain, material, texture state, layers and owning actor.
//   node tools/capture.mjs --url "/?mode=stage&stage=1&p1=seraphine" --scenario tools/scenarios/pale_figure.mjs --warm 1500 --out <dir>
// env: PALE_CAM=dist:height:fov:look (default 2.5:1.6:30:1.45)  PALE_REGION=x0:x1:y0:y1 (fractions, default .86:1:.25:1)
//      PALE_SETTLE=ms (sim time after the camera cut, default 400)  PALE_WAIT=ms (extra sim time before the face camera)  PALE_SETUP=rim (default: replay rim_drama's setup — script off, enemies removed) | none (leave the game as is)
import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  const E = (fn, arg) => api.evalGame(fn, arg);
  const [dist, height, fov, look] = (process.env.PALE_CAM || '2.5:1.6:30:1.45').split(':').map(Number);
  const region = (process.env.PALE_REGION || '.86:1:.25:1').split(':').map(Number);
  const setup = process.env.PALE_SETUP || 'rim';
  const out = { cam: { dist, height, fov, look }, region, setup };
  if (setup === 'rim') {
    out.before = await E(() => {
      const K = window.__KCA, g = K.game;
      const list = g.world.actors.map((a) => `${a.kind}:${a.typeId || a.heroId || ''}#${a.id}`);
      if (g.levels) g.levels.scriptEnabled = false;
      for (const a of g.world.query({ team: 'enemies' })) a.remove();
      const h = g.world.query({ kind: 'hero' })[0];
      h.endMove(); h.fsm.go('idle'); h.vel.set(0, 0, 0); h.facing = -1;
      K.input.releaseAll();
      return { tick: g.tick, actors: list };
    });
    await api.advance(300);
  }
  // PALE_WAIT ms more (the rim_drama run reached the face camera ~2.4 s after its setup: wave 2 walks up meanwhile)
  if (+process.env.PALE_WAIT > 0) await api.advance(+process.env.PALE_WAIT);
  await E(([distance, height, fov, lookHeight]) => {
    const g = window.__KCA.game, h = g.world.query({ kind: 'hero' })[0];
    g.cameraRig.clearDrama();
    g.cameraRig.drama({ focus: h, distance, height, fov, lookHeight, in: 0.001, hold: null, priority: 9 });
  }, [dist, height, fov, look]);
  await api.advance(+(process.env.PALE_SETTLE || 400));
  await api.shot('face');
  // in-page: re-render the same sim frame with subtrees hidden, measure pale pixels in the region
  const res = await E(async (region) => {
    const K = window.__KCA, g = K.game, scene = g.renderer.scene, canvas = g.renderer.webgl.domElement;
    const c2 = document.createElement('canvas'); const ctx = c2.getContext('2d', { willReadFrequently: true });
    const measure = () => {
      g.renderFrame(Math.min(1, g.acc / (1 / 60)), 0);
      const W = canvas.width, H = canvas.height;
      const x0 = Math.floor(region[0] * W), x1 = Math.floor(region[1] * W), y0 = Math.floor(region[2] * H), y1 = Math.floor(region[3] * H);
      c2.width = x1 - x0; c2.height = y1 - y0;
      ctx.drawImage(canvas, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0);
      const d = ctx.getImageData(0, 0, x1 - x0, y1 - y0).data;
      let pale = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { const r = d[i], gg = d[i + 1], b = d[i + 2]; n++; if (r > 185 && gg > 165 && b > 120 && r - b < 90) pale++; }
      return pale / n;
    };
    const base = measure();
    const desc = (o) => `${o.type}:${o.name || '(anon)'}${o.isMesh ? '' : '[' + o.children.length + ']'}`;
    const steps = [];
    let node = scene, depth = 0;
    while (node && depth < 14) {
      const kids = node.children.filter((c) => c.visible);
      let best = null, bestDrop = 0;
      const tried = [];
      for (const c of kids) {
        c.visible = false; const v = measure(); c.visible = true;
        const drop = base - v; tried.push([desc(c), +v.toFixed(4)]);
        if (drop > bestDrop) { bestDrop = drop; best = c; }
      }
      steps.push({ at: desc(node), base: +base.toFixed(4), best: best ? desc(best) : null, drop: +bestDrop.toFixed(4), tried: tried.sort((a, b) => a[1] - b[1]).slice(0, 6) });
      if (!best || bestDrop < base * 0.3) break;
      node = best; depth++;
      if (!node.children.length) break;
    }
    // describe the culprit + its chain + owning actor
    const chain = []; for (let p = node; p; p = p.parent) chain.push(desc(p));
    const actor = g.world.actors.find((a) => { let hit = false; a.view && a.view.traverse((o) => { if (o === node) hit = true; }); return hit; });
    const meshes = [];
    node.traverse((o) => {
      if (!o.isMesh) return;
      const mats = [].concat(o.material).filter(Boolean);
      meshes.push({ name: o.name, type: o.type, skinned: !!o.isSkinnedMesh, visible: o.visible, layers: o.layers.mask, frustumCulled: o.frustumCulled, renderOrder: o.renderOrder,
        mats: mats.map((m) => ({ type: m.type, name: m.name, color: m.color && m.color.getHexString(), emissive: m.emissive && m.emissive.getHexString(), emissiveIntensity: m.emissiveIntensity,
          transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite, version: m.version, uuid: m.uuid.slice(0, 8), ud: Object.keys(m.userData || {}),
          map: m.map ? { w: m.map.image && m.map.image.width, h: m.map.image && m.map.image.height, ver: m.map.version, src: m.map.source && m.map.source.uuid.slice(0, 8), name: m.map.name } : null,
          normalMap: !!m.normalMap, roughnessMap: !!m.roughnessMap, hasOBC: !!m.onBeforeCompile && m.onBeforeCompile.toString().length })),
        ud: Object.keys(o.userData || {}) });
    });
    // world-space position of the culprit
    const p = new (scene.position.constructor)(); node.getWorldPosition(p);
    // every actor and where its view is
    const actors = g.world.actors.map((a) => { const wp = new (scene.position.constructor)(); if (a.view) a.view.getWorldPosition(wp); return { id: a.id, kind: a.kind, type: a.typeId || a.heroId, tier: a.tier || (a.def && a.def.tierId), state: a.fsm && a.fsm.state && (a.fsm.state.name || a.fsm.current), alive: a.alive, pos: [+a.pos.x.toFixed(2), +a.pos.y.toFixed(2), +a.pos.z.toFixed(2)], viewIn: !!(a.view && a.view.parent), viewWorld: [+wp.x.toFixed(2), +wp.y.toFixed(2), +wp.z.toFixed(2)], source: a.model && a.model.source }; });
    const cam = g.cameraRig.camera || g.camera;
    return { base, steps, chain, culprit: desc(node), culpritWorld: [p.x, p.y, p.z].map((v) => +v.toFixed(2)), actor: actor ? { id: actor.id, kind: actor.kind, type: actor.typeId, removed: actor.removed } : null,
      meshes: meshes.slice(0, 12), actors, tick: g.tick, cam: cam && [cam.position.x, cam.position.y, cam.position.z].map((v) => +v.toFixed(2)), canvas: [canvas.width, canvas.height] };
  }, region);
  Object.assign(out, res);
  fs.writeFileSync(path.join(api.outDir, 'pale_figure.json'), JSON.stringify(out, null, 1));
  api.log(`base pale fraction ${res.base.toFixed(4)} → culprit ${res.culprit} @ ${res.culpritWorld} actor ${JSON.stringify(res.actor)}`);
  api.log('chain: ' + res.chain.join(' < '));
};
