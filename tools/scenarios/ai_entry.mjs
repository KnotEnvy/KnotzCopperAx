// Entry-to-engagement probe (enemies-ai r7): runs a stage with the hero bot and records, per enemy, the tick it first
// stands inside the camera frame and the tick of its own first attack start, plus the per-wave latency from the
// wave's first on-screen entrant to the first attack start by ANY foe of that wave. Also a timeline of states in a
// window (AI_WIN="from,to" seconds) for debugging arrivals.
//   node tools/capture.mjs --url "/?mode=stage&stage=1&p1=brann&bot=1&capture=1" --scenario tools/scenarios/ai_entry.mjs --out <dir>
// Env: AI_SECONDS (default 40), AI_WIN (default "18,26"), AI_FLAGS (director A/B hooks, JSON).
// Writes ai_entry.json: foes [{id,type,spawnT,visT,atkT,lat}], waves [{first,visT,atkT,lat}], firstLat (s), timeline.
import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  const secs = Number(process.env.AI_SECONDS || 40);
  const win = (process.env.AI_WIN || '18,26').split(',').map(Number);
  const E = (fn, arg) => api.evalGame(fn, arg);
  if (process.env.AI_FLAGS) await E((f) => Object.assign(window.__KCA.game.ai.director, f), JSON.parse(process.env.AI_FLAGS));
  await E((w) => {
    const k = window.__KCA, g = k.game;
    if (k.debug && k.debug.god) k.debug.god(true);
    const S = (window.__ENTRY = { foes: {}, waves: [], timeline: [] });
    let wave = null, lastVis = -9999;
    const t0 = g.tick;
    const sample = () => {
      const c = g.cameraRig && g.cameraRig.camera;
      const vr = g.cameraRig && g.cameraRig.visibleRange ? g.cameraRig.visibleRange(0) : { xMin: -9, xMax: 9 };
      const P = (e) => (c ? c.position.x + (e.pos.x - c.position.x) * c.position.z / (c.position.z - e.pos.z) : e.pos.x);
      for (const e of g.world.query({ team: 'enemies' })) {
        if (e.kind === 'boss' || e.kind === 'mount') continue;
        let f = S.foes[e.id];
        if (!f) f = S.foes[e.id] = { id: e.id, type: e.typeId, tier: e.tier, spawnT: g.tick - t0, visT: null, atkT: null, wave: null };
        const px = P(e);
        if (f.visT == null && e.alive && px > vr.xMin + 0.5 && px < vr.xMax - 0.5) {
          f.visT = g.tick - t0;
          if (e.typeId !== 'thief') { // thieves never attack: not a wave's fighter
            if (!wave || f.visT - lastVis > 240) { wave = { first: e.id, type: e.typeId, visT: f.visT, atkT: null, n: 0 }; S.waves.push(wave); }
            f.wave = S.waves.length - 1; wave.n++;
            lastVis = f.visT;
          }
        }
        if (f.atkT == null && e.fsm && e.fsm.is('attack')) {
          f.atkT = g.tick - t0;
          const wv = f.wave != null ? S.waves[f.wave] : null;
          if (wv && wv.atkT == null) wv.atkT = f.atkT;
        }
      }
      const ts = (g.tick - t0) / 60;
      if (ts >= w[0] && ts <= w[1] && g.tick % 15 === 0) {
        const tk = g.ai && g.ai.tokens;
        S.timeline.push([+ts.toFixed(2), g.world.query({ kind: 'hero' }).map((h) => [+h.pos.x.toFixed(1), +h.pos.z.toFixed(1), h.fsm && h.fsm.name]),
          g.world.query({ team: 'enemies' }).filter((e) => e.alive).map((e) => [e.id, e.typeId[0], e.fsm && e.fsm.name, e.brain && e.brain.mode, +e.pos.x.toFixed(1), +e.pos.z.toFixed(1), +P(e).toFixed(1), tk && tk.has && tk.has(e) ? 'T' : '', e.aiHold === g.tick ? 'H' : '', e.vanguard ? 'V' : '', e.aiWhy || '', e.enterTarget ? [e.enterTarget.delay0 ?? null, e.enterTarget.delay ?? null, e.enterTarget.spMul ? +e.enterTarget.spMul.toFixed(2) : null] : null])]);
      }
    };
    const sys = { name: 'entry-probe', order: 99, update: sample };
    if (g.addSystem) g.addSystem(sys); else if (g.systems) g.systems.push(sys);
  }, win);
  const step = 5000;
  for (let t = 0; t < secs * 1000; t += step) await api.advance(step);
  const r = await E(() => {
    const S = window.__ENTRY;
    const foes = Object.values(S.foes).map((f) => ({ ...f, lat: f.visT != null && f.atkT != null ? +((f.atkT - f.visT) / 60).toFixed(2) : null }));
    const waves = S.waves.map((w) => ({ ...w, lat: w.atkT != null ? +((w.atkT - w.visT) / 60).toFixed(2) : null }));
    const lats = waves.map((w) => w.lat).filter((x) => x != null);
    return { foes, waves, firstLat: waves.length ? waves[0].lat : null, maxLat: lats.length ? Math.max(...lats) : null, meanLat: lats.length ? +(lats.reduce((a, b) => a + b, 0) / lats.length).toFixed(2) : null, timeline: S.timeline };
  });
  api.log('ENTRY waves ' + JSON.stringify(r.waves) + ' firstLat ' + r.firstLat + ' maxLat ' + r.maxLat + ' meanLat ' + r.meanLat);
  fs.writeFileSync(path.join(api.outDir, 'ai_entry.json'), JSON.stringify(r, null, 1));
};
