// Wyrm Rider KNOCK-OFF QA (bosses r9). Use with /?mode=stage&stage=3&p1=brann&p2=gorrim&bot=1&screen=3 (or the
// showcase fight). God bots; kills the regular wave until the boss spawns, then samples every STEP s (default 0.25):
//   boss_dom sample (vis/heroOcc/mountOcc of the RIDER — while she is off the saddle the riderless wyrm counts as an
//   occluder when it is nearer the camera) + a knock-off trace (state, anim clip, pos, roll, mount pos/mode).
// Stills: SHOTS="0.2,0.5,0.9,1.5,2.5" s after each of the first CYC knock-offs (default 2) → k<cycle>_<sec>.png.
// Writes boss_wyrm_knock.json { summary { cycles, unmountedSamples, visMinUnmounted, pctVisGe60Unmounted, ... }, samples[], trace[] }.
import fs from 'node:fs';
import path from 'node:path';
import { installBossDominance } from './boss_dom.mjs';

export default async (api) => {
  const MAX = Number(process.env.MAX || 60), STEP = Number(process.env.STEP || 0.25), CYC = Number(process.env.CYC || 2);
  const SH = (process.env.SHOTS || '0.2,0.5,0.9,1.5,2.5').split(',').filter(Boolean).map(Number);
  const STOP = Number(process.env.STOP_CYCLES || 0);
  await installBossDominance(api);
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
  await api.evalGame(() => {
    const g = window.__KCA.game, W = window.__wk = { offs: [], trace: [] };
    g.bus.on('mounts:riderOff', (e) => { if (e && e.knocked && e.rider && e.rider.inStage !== undefined) W.offs.push(+(g.tick / 60).toFixed(2)); else if (e && e.knocked) W.offs.push(+(g.tick / 60).toFixed(2)); });
  });
  if (process.env.CLIP) {
    // 60-frame knock-off clip (--step 33 --mp4): warm into the fight with the rider seated, 8 lead-in frames, then a
    // scripted magic hit from P1 (in-game rule: magic always unseats her) so the knock-off lands at a known frame.
    for (let i = 0; i < 80; i++) {
      await api.advance(250);
      const ok = await api.evalGame((t0) => { const g = window.__KCA.game, r = g._bossCam && g._bossCam.members()[0]; return !!(r && r._seated && r.mountedOn && g.tick / 60 > t0 + Number(12)); }, spawnT);
      if (ok) break;
    }
    await api.frames(8, 33);
    const hit = await api.evalGame(() => {
      const g = window.__KCA.game, r = g._bossCam.members()[0], h = g.world.query({ kind: 'hero' })[0];
      const dir = Math.sign(r.pos.x - h.pos.x) || 1;
      return g.combat.applyHit(h, r, { damage: 10, knockback: 3, knockdown: true, hitstop: 6, level: 'magic' }, { moveId: 'qa_magic', dir });
    });
    api.log('scripted magic hit ' + hit);
    await api.frames(52, 33);
    return;
  }
  const pending = [];   // [tAbs, name]
  let seenOffs = 0, t = 0, cycles = 0;
  while (t < MAX) {
    const dueNext = pending.length ? pending[0][0] : Infinity;
    const r = await api.evalGame(() => {
      const g = window.__KCA.game, B = window.__bd, W = window.__wk;
      let s = null; try { s = B.sample && B.sample(); } catch (e) { B.err = String(e && e.stack || e).slice(0, 300); }
      const cam = g._bossCam, lead = cam && cam.members()[0];
      if (lead) {
        const m = g.mounts && g.mounts.list ? g.mounts.list()[0] : null;
        W.trace.push({ t: +(g.tick / 60).toFixed(2), st: lead.fsm && lead.fsm.name, clip: lead.animator && lead.animator.name, seated: !!lead._seated,
          p: [+lead.pos.x.toFixed(2), +lead.pos.y.toFixed(2), +lead.pos.z.toFixed(2)], roll: +(lead.roll || 0).toFixed(2), unh: lead._unhorsed ? 1 : 0,
          m: m ? [m.mode, +m.pos.x.toFixed(2), +m.pos.z.toFixed(2)] : null, vis: s ? s.vis : null, mo: s ? s.mountOcc : null });
      }
      return { now: g.tick / 60, offs: W.offs.slice(), done: B.done };
    });
    if (r.offs.length > seenOffs) {
      for (let k = seenOffs; k < r.offs.length; k++) { cycles++; if (cycles <= CYC) for (const d of SH) pending.push([r.offs[k] + d, `k${cycles}_${String(d).replace('.', 'p')}`]); }
      pending.sort((a, b) => a[0] - b[0]); seenOffs = r.offs.length;
    }
    while (pending.length && r.now >= pending[0][0] - 1e-3) await api.shot(pending.shift()[1]);
    if (r.done || (STOP && cycles >= STOP && !pending.length && r.now > r.offs[r.offs.length - 1] + 4)) break;
    let ms = STEP * 1000;
    if (pending.length) ms = Math.max(16, Math.min(ms, (pending[0][0] - r.now) * 1000));
    await api.advance(ms); t += ms / 1000;
    void dueNext;
  }
  const out = await api.evalGame(() => {
    const B = window.__bd, W = window.__wk;
    const U = B.S.filter((s) => s.vis !== null && !s.mounted);
    const M = B.S.filter((s) => s.vis !== null && s.mounted);
    const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : null; };
    return { err: B.err, offs: W.offs,
      summary: { cycles: W.offs.length, samples: B.S.length, unmountedSamples: U.length,
        visMinUnmounted: U.length ? Math.min(...U.map((s) => s.vis)) : null, visMedUnmounted: med(U.map((s) => s.vis)),
        pctVisGe60Unmounted: U.length ? +(100 * U.filter((s) => s.vis >= 0.6).length / U.length).toFixed(1) : null,
        mountOccMax: U.length ? Math.max(...U.map((s) => s.mountOcc || 0)) : null,
        visMedMounted: med(M.map((s) => s.vis)), heightPctMed: med(B.S.map((s) => s.heightPct)), pctBoxInFrame: B.S.length ? +(100 * B.S.filter((s) => s.inFrame).length / B.S.length).toFixed(1) : null,
        worstUnmounted: U.filter((s) => s.vis < 0.6).slice(0, 12).map((s) => ({ t: s.t, vis: s.vis, heroOcc: s.heroOcc, mountOcc: s.mountOcc, otherOcc: s.otherOcc, stageOcc: s.stageOcc, st: s.st })) },
      samples: B.S, trace: W.trace };
  });
  api.log(JSON.stringify(out.summary) + ' offs=' + JSON.stringify(out.offs) + ' err=' + out.err);
  fs.writeFileSync(path.join(api.outDir, 'boss_wyrm_knock.json'), JSON.stringify(out, null, 1));
};
