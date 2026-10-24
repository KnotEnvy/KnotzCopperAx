// In-stage boss hook check (bosses agent). Use with /?mode=stage&stage=<n>&p1=..&p2=..&bot=1&screen=<boss screen>.
// God-mode heroes; clears the screen's regular waves (kills non-boss enemies until a bossIntro event fires), then
// shoots BOSS_AFTER (comma list of seconds after the intro, default "0.5,2.5") and reports the stage phase.
export default async (api) => {
  const after = (process.env.BOSS_AFTER || '0.5,2.5').split(',').map(Number);
  await api.evalGame(() => { window.__KCA.debug.god(true); });
  let intro = null;
  for (let i = 0; i < 90 && !intro; i++) {
    await api.advance(1000);
    intro = await api.evalGame(() => {
      const K = window.__KCA, g = K.game;
      const ev = K.events('bossIntro');
      if (ev.length) return ev[ev.length - 1];
      const bossWave = K.events('waveStart').some((e) => /boss/.test(JSON.stringify(e.summary || '')));
      if (!bossWave) for (const e of g.world.query({ team: 'enemies' })) if (e.kind !== 'boss' && e.alive && e.fsm && !e.fsm.is('enter')) K.debug.kill(e.id);
      return null;
    });
  }
  if (!intro) throw new Error('no bossIntro within 90 s');
  api.log(`bossIntro at tick ${intro.tick}: ${JSON.stringify(intro.summary)}`);
  let t = 0;
  for (const s of after) { await api.advance((s - t) * 1000); t = s; await api.shot(`intro_${String(s).replace('.', '_')}`); }
  const info = await api.evalGame(() => window.__KCA.info());
  api.log(`stage ${JSON.stringify(info.stage)} draws ${info.drawCalls} tris ${info.triangles} errors ${JSON.stringify(info.errors)}`);
};
