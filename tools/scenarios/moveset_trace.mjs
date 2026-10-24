// Tick-by-tick state trace of the moveset showcase actor (owner: heroes-anim, wave C1 r5).
//   node tools/capture.mjs --url "/?mode=showcase&what=moveset&id=seraphine" --scenario tools/scenarios/moveset_trace.mjs --warm 0 --out <dir>
// Env: MS_FROM / MS_TO (game ticks, default 1280..1480). Logs every change of (fsm state, clip, move id) with pos.y /
// vel.y / x, plus hit / attackStart / land / dodge events in the window. Writes trace.json.
import fs from 'node:fs';
import path from 'node:path';
export default async (api) => {
  const FROM = Number(process.env.MS_FROM || 1280), TO = Number(process.env.MS_TO || 1480);
  const E = (fn, arg) => api.evalGame(fn, arg);
  const tick = () => E(() => window.__KCA.game.tick);
  let t = await tick();
  if (t < FROM) await api.advance((FROM - t) * 1000 / 60);
  const rows = [], changes = [];
  let last = '';
  for (let i = 0; i < TO - FROM; i++) {
    await api.advance(1000 / 60);
    const s = await E(() => {
      const K = window.__KCA, h = K.showcase.actor, g = K.game;
      const d = K.showcase.dummies || [];
      return { tick: g.tick, st: h.fsm.name, clip: h.animator && h.animator.cur ? h.animator.cur.name : null, move: h.attack ? h.attack.id : null, mf: h.attack ? h.attack.frame : null,
        x: +h.pos.x.toFixed(2), y: +h.pos.y.toFixed(2), vy: +h.vel.y.toFixed(2), vx: +h.vel.x.toFixed(2), gr: h.grounded, runJump: h.runJump, runDir: h.input.runDir, facing: h.facing,
        dum: d.map((e) => e.fsm.name + '@' + e.pos.x.toFixed(1)).join(' ') };
    });
    rows.push(s);
    const key = `${s.st}|${s.clip}|${s.move}`;
    if (key !== last) { changes.push(s); api.log(`t${s.tick} ${s.st} clip=${s.clip} move=${s.move} x=${s.x} y=${s.y} vy=${s.vy} runJump=${s.runJump} runDir=${s.runDir} face=${s.facing} dum=[${s.dum}]`); last = key; }
  }
  const evs = await E((since) => window.__KCA.events(null, since).filter((e) => /hit|attackStart|land|dodge|jump|knock/i.test(e.type)), FROM);
  for (const e of evs) api.log(`ev t${e.tick} ${e.type} ${JSON.stringify(e.summary).slice(0, 160)}`);
  fs.writeFileSync(path.join(api.outDir, 'trace.json'), JSON.stringify({ from: FROM, to: TO, changes, events: evs, rows }));
};
