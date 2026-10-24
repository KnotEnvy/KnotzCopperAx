// enemies-ai C2 r3 (iter 13) PINNED-HERO probe (board r12: "all three 2P probes record zero pinned attack opportunities, so
// outerPinned = 0 does not exercise the veto; include a deliberate pinned-hero sequence with chain continuations").
// Stage mode with bot heroes. Hero 1 is HELD at the frame edge (frame fraction AI_PIN_F, default 0.07, side AI_PIN_SIDE
// -1 = left / 1 = right) every tick while its bot keeps fighting (attacks, dodges, throws — it just can't walk away), so the
// crowd keeps meeting a pinned hero. Every enemy attack start on that hero (chain continuations included: skeleton
// slash → slash_2, pslash_2..4) is classified by side: OUTER = the attacker stands between the hero and the near frame edge
// (the board's "outer side of a pinned hero" — must stay 0), INNER = the open side. Also counts what the director vetoed.
//   AI_WAVE=1 node tools/capture.mjs --url "/?mode=stage&stage=2&p1=gorrim&bot=1&botmagic=0&seed=7" \
//     --scenario tools/scenarios/ai_pinned.mjs --out <dir> [--sheet --mp4 with AI_FRAMES=120 AI_STEP=33]
// Env: AI_SECONDS (probe seconds, default 40), AI_WAVE (as ai_stage), AI_FRAMES / AI_STEP (frames captured AFTER the probe
// window, still pinned — evidence clip), AI_WARM (ms before measuring, default 1500).
// Writes ai_pinned.json: { starts, inner, outer, outerChain, chain, byMove, outerList, heroFrac {min,max,mean},
//   attackersInFrame (attack starts whose attacker centre is >= 0.4 m inside the frame), director { vetoPinned, vetoChain, vetoEdge,
//   sideRoom, roundFail } deltas, foesSeen }.
import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  const E = (fn, arg) => api.evalGame(fn, arg);
  const secs = Number(process.env.AI_SECONDS || 40), wave = Number(process.env.AI_WAVE || 0);
  const frames = Number(process.env.AI_FRAMES || 0), step = Number(process.env.AI_STEP || 33), warm = Number(process.env.AI_WARM || 1500);
  const pinF = Number(process.env.AI_PIN_F || 0.07), pinSide = Number(process.env.AI_PIN_SIDE || -1);
  await E(() => { const k = window.__KCA; if (k.debug && k.debug.god) k.debug.god(true); });
  if (wave > 0) {
    for (let i = 0; i < 60; i++) {
      await api.advance(500);
      if ((await E(() => window.__KCA.game.levels.waveIndex)) >= wave) break;
      if (i >= 3) await E(() => { const g = window.__KCA.game; for (const e of g.world.query({ team: 'enemies' })) if (e.alive && e.kind !== 'boss' && e.typeId !== 'thief' && !e.mountedOn && e.kind !== 'mount' && !(e.fsm && e.fsm.is('enter'))) window.__KCA.debug.kill(e.id); });
    }
  }
  await E(({ pinF, pinSide }) => {
    const g = window.__KCA.game, h = g.world.query({ kind: 'hero' })[0];
    const P = (window.__PIN = { h, starts: [], fr: [], on: false });
    const vrAt = (z) => { const c = g.cameraRig.camera, V = c.position.constructor; c.updateMatrixWorld(); const p0 = new V(c.position.x, 0, z).project(c).x, p1 = new V(c.position.x + 1, 0, z).project(c).x, sl = p1 - p0; return { a: c.position.x + (-1 - p0) / sl, b: c.position.x + (1 - p0) / sl }; };
    // hold the hero at the edge: every tick before physics (order -40) and again after it (order 30) — the bot still acts
    const hold = () => {
      if (!h.alive || h.removed || h.mountedOn || !(h.fsm && h.fsm.is('idle', 'walk', 'run', 'attack', 'block', 'hitstun', 'charge'))) return;
      const v = vrAt(h.pos.z), w = v.b - v.a, sc = g.world.screen || { xMin: -1e9, xMax: 1e9 };
      const x = pinSide < 0 ? v.a + pinF * w : v.b - pinF * w;
      h.pos.x = Math.max(sc.xMin, Math.min(sc.xMax, x)); if (h.vel) h.vel.x = 0;
    };
    g.addSystem({ name: 'pin-pre', order: -40, update: hold });
    g.addSystem({ name: 'pin-post', order: 30, update() { hold(); if (P.on && g.tick % 10 === 0) { const v = vrAt(h.pos.z); P.fr.push((h.pos.x - v.a) / (v.b - v.a)); } } });
    g.bus.on('attackStart', (ev) => {
      const a = ev.actor;
      if (!P.on || !a || a.team !== 'enemies' || a.kind === 'boss' || a.target !== h) return;
      const v = vrAt(h.pos.z), w = v.b - v.a, f = (h.pos.x - v.a) / w, near = f < 0.5 ? -1 : 1;
      const side = Math.sign(a.pos.x - h.pos.x) || 1, va = vrAt(a.pos.z), inset = Math.min(a.pos.x - va.a, va.b - a.pos.x);
      const chain = /_\d$/.test(ev.moveId || '');
      P.starts.push({ t: g.tick, id: a.id, type: a.typeId, move: ev.moveId, chain, f: +f.toFixed(3), outer: (f < 0.15 || f > 0.85) && side === near, side, dx: +(a.pos.x - h.pos.x).toFixed(2), dz: +(a.pos.z - h.pos.z).toFixed(2), inset: +inset.toFixed(2) });
    });
  }, { pinF, pinSide });
  await api.advance(warm);
  const s0 = await E(() => { const d = window.__KCA.game.ai.director; window.__PIN.on = true; window.__PIN.s0 = { ...d.stats }; return 1; });
  for (let t = 0; t < secs * 1000; t += 5000) await api.advance(Math.min(5000, secs * 1000 - t));
  const r = await E(() => {
    const P = window.__PIN, d = window.__KCA.game.ai.director, S = P.starts, dl = (k) => +(((d.stats[k] || 0) - (P.s0[k] || 0))).toFixed(0);
    const by = {}; for (const a of S) by[a.type + ':' + a.move] = (by[a.type + ':' + a.move] || 0) + 1;
    const fr = P.fr;
    return { starts: S.length, inner: S.filter((a) => !a.outer).length, outer: S.filter((a) => a.outer).length, chain: S.filter((a) => a.chain).length, outerChain: S.filter((a) => a.outer && a.chain).length,
      byMove: by, outerList: S.filter((a) => a.outer).slice(0, 12), attackersInFrame: S.filter((a) => a.inset >= 0.4).length,
      heroFrac: fr.length ? { min: +Math.min(...fr).toFixed(3), max: +Math.max(...fr).toFixed(3), mean: +(fr.reduce((m, x) => m + x, 0) / fr.length).toFixed(3) } : null,
      director: { vetoPinned: dl('vetoPinned'), vetoChain: dl('vetoChain'), vetoEdge: dl('vetoEdge'), sideRoom: dl('sideRoom'), roundFail: dl('roundFail'), flankX: dl('flankX') },
      list: S, errors: window.__KCA.info().errors.slice(-6) };
  });
  fs.writeFileSync(path.join(api.outDir, 'ai_pinned.json'), JSON.stringify(r, null, 1));
  api.log('PINNED ' + JSON.stringify({ ...r, list: r.list.length, outerList: r.outerList.length }));
  for (let i = 0; i < frames; i++) await api.frames(1, step);
};
