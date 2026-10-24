// Enemy wind-up telegraph at GAME distance (enemies-ai C2 r1): plays a stage with bot heroes and, each time an on-screen
// non-boss foe fires 'ai:telegraph', grabs the full frame (game camera) plus the foe's screen box, then a frame ~3 ticks
// later (the glint's peak). Crop the PNGs with the logged boxes (ffmpeg crop) to judge whether the tell reads.
//   node tools/capture.mjs --url "/?mode=stage&stage=1&p1=brann&bot=1" --scenario tools/scenarios/ai_tele.mjs --out <dir>
// Env: TELE_N (shots, default 4), TELE_SECONDS (give up after, default 90), TELE_KIND (only this kind: normal|heavy|…)
import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  const N = Number(process.env.TELE_N || 4), maxS = Number(process.env.TELE_SECONDS || 90), kind = process.env.TELE_KIND || '';
  const E = (fn, arg) => api.evalGame(fn, arg);
  await E((kind) => {
    const k = window.__KCA, g = k.game;
    if (k.debug && k.debug.god) k.debug.god(true);
    window.__TELE = { q: [] };
    g.bus.on('ai:telegraph', (ev) => {
      const a = ev.actor, c = g.cameraRig && g.cameraRig.camera;
      if (!a || !c || a.kind === 'boss' || (kind && ev.kind !== kind)) return;
      const V = c.position.constructor, W = window.innerWidth, H = window.innerHeight, h = a.height || 1.8;
      c.updateMatrixWorld();
      const p = (x, y, z) => { const v = new V(x, y, z).project(c); return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H]; };
      const [fx, fy] = p(a.pos.x, a.pos.y, a.pos.z), [, hy] = p(a.pos.x, a.pos.y + h, a.pos.z), [rx] = p(a.pos.x + 1, a.pos.y, a.pos.z);
      if (fx < 40 || fx > W - 40) return;
      window.__TELE.q.push({ tick: g.tick, id: a.id, type: a.typeId, tier: a.tier || '', kind: ev.kind, move: ev.moveId, box: [Math.round(fx), Math.round(fy), Math.round(hy), Math.round(rx - fx)] });
    });
  }, kind);
  const shots = [];
  let last = -1e9;
  for (let t = 0; t < maxS * 1000 && shots.length < N; t += 34) {
    await api.advance(34);
    const q = await E(() => { const q = window.__TELE.q.slice(); window.__TELE.q.length = 0; return q; });
    const ev = q.find((x) => x.tick - last > 240);
    if (!ev) continue;
    last = ev.tick;
    const i = shots.length;
    await api.shot(`tele_${i}_a`);
    await api.advance(34);
    await api.shot(`tele_${i}_b`);
    shots.push(ev);
    api.log(`TELE ${i} ${JSON.stringify(ev)}`);
  }
  fs.writeFileSync(path.join(api.outDir, 'ai_tele.json'), JSON.stringify({ shots, errors: (await E(() => window.__KCA.info().errors)).slice(-4) }, null, 1));
};
