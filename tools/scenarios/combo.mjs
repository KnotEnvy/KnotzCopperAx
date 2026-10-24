// Combo scenario: light string (3 hits, the last knocks down) + run (double-tap) attack + jump attack +
// Death Stab against training dummies, via __KCA.input. Produces a frame sheet (pass --sheet) and asserts that
// the moves started and CONNECTED (bus 'hit' events).
//
//   node tools/capture.mjs --url "/?mode=stage&stage=test&p1=brann" --scenario tools/scenarios/combo.mjs --sheet --out progress/tmp/combo
//   (works for p1=seraphine|gorrim too; stage=test gives a neutral lit floor)
export default async (api) => {
  const ev = (type) => api.evalGame((t) => window.__KCA.events(t), type);
  const hero = () => api.evalGame(() => window.__KCA.info().heroes.find((h) => h.player === 1));
  const expect = (cond, msg) => { if (!cond) throw new Error('combo: ' + msg); api.log('ok  ' + msg); };
  const hitsBy = async (moveId) => (await ev('hit')).filter((e) => e.summary.moveId === moveId && String(e.summary.attacker).startsWith('hero')).length;

  // Clean arena: remove the wave, god-mode the hero, drop two training dummies in front of it.
  await api.evalGame(() => { const k = window.__KCA; k.debug.god(true); k.game.levels.scriptEnabled = false; k.game.levels.phase = 'idle'; k.debug.kill('enemies'); });
  await api.advance(1600);
  const h = await hero();
  await api.evalGame(async ([x, z]) => {
    for (const a of window.__KCA.game.world.query({ team: 'enemies' })) a.remove();
    await window.__KCA.debug.spawn('dummy', x + 1.25, z);
    await window.__KCA.debug.spawn('dummy', x + 1.7, z + 0.35);
  }, [h.x, h.z]);
  await api.advance(300);

  // 1) Light string: tap Light on the rhythm of the cancel windows (buffered presses).
  for (let i = 0; i < 3; i++) {
    await api.press(1, 'light', 50);
    await api.frames(1, 100, 'string');
    await api.advance(90);
  }
  await api.frames(2, 150, 'string');
  const n1 = await hitsBy('light_1'), n2 = await hitsBy('light_2'), n3 = (await hitsBy('light_3')) + (await hitsBy('pommel_1'));
  if (!n3) api.log('debug: ' + JSON.stringify(await api.evalGame(() => window.__KCA.events().filter((e) => /attackStart|hit/.test(e.type)).map((e) => [e.tick, e.type, e.summary.moveId]))));
  expect(n1 >= 1, `light_1 connected (${n1})`);
  expect(n2 >= 1, `light_2 connected (${n2})`);
  expect(n3 >= 1, `string continued into the third hit (light_3/pommel_1: ${n3})`);
  const kd = (await ev('knockdown')).length;
  api.log(`knockdowns so far: ${kd}`);
  await api.advance(1200);

  // 2) Run attack: step back, double-tap right, hold, then Light.
  await api.evalGame(() => { const k = window.__KCA; const hh = k.game.world.query({ kind: 'hero' })[0]; const d = k.game.world.query({ team: 'enemies' })[0]; hh.pos.x = d.pos.x - 4.2; hh.pos.z = d.pos.z; hh.prevPos.copy(hh.pos); hh.facing = 1; });
  await api.advance(200);
  await api.press(1, 'right', 50);
  await api.advance(80);
  await api.hold(1, 'right', true);
  await api.advance(260);
  const hr = await hero();
  expect(hr.state === 'run', `double-tap → run (state ${hr.state})`);
  await api.press(1, 'light', 50);
  await api.frames(3, 100, 'run');
  await api.hold(1, 'right', false);
  await api.advance(800);
  if (!(await hitsBy('run_attack'))) api.log('debug: ' + JSON.stringify(await api.evalGame(() => ({ a: window.__KCA.debug.actors(), s: window.__KCA.events('attackStart').slice(-3), inv: window.__KCA.game.world.query({ team: 'enemies' }).map((e) => [e.invuln, e.fsm.name, e.hurtable]) }))));
  expect((await hitsBy('run_attack')) >= 1, 'run attack connected');
  await api.advance(1000);

  // 3) Jump attack: jump in place next to a dummy, Light on the way down.
  await api.evalGame(() => { const k = window.__KCA; const hh = k.game.world.query({ kind: 'hero' })[0]; const d = k.game.world.query({ team: 'enemies' })[0]; hh.pos.x = d.pos.x - 1.1; hh.pos.z = d.pos.z; hh.prevPos.copy(hh.pos); hh.facing = 1; });
  await api.advance(300);
  await api.press(1, 'jump', 50);
  await api.advance(330);
  await api.press(1, 'light', 50);
  await api.frames(3, 100, 'jumpatk');
  await api.advance(700);
  expect((await hitsBy('jump_attack')) >= 1, 'jump attack connected');
  await api.advance(1000);

  // 4) Death Stab: dash → jump → Light near the apex.
  await api.evalGame(() => { const k = window.__KCA; const hh = k.game.world.query({ kind: 'hero' })[0]; const d = k.game.world.query({ team: 'enemies' })[0]; hh.pos.x = d.pos.x - 6.2; hh.pos.z = d.pos.z; hh.prevPos.copy(hh.pos); hh.facing = 1; });
  await api.advance(200);
  await api.press(1, 'right', 50);
  await api.advance(80);
  await api.hold(1, 'right', true);
  await api.advance(300);
  await api.press(1, 'jump', 50);
  await api.advance(300);
  await api.press(1, 'light', 50);
  await api.hold(1, 'right', false);
  await api.frames(3, 100, 'deathstab');
  await api.advance(600);
  const starts = (await ev('attackStart')).map((e) => e.summary.moveId);
  api.log(`moves started: ${[...new Set(starts)].join(', ')}`);
  expect(starts.includes('death_stab') || starts.includes('run_jump_attack'), 'dash-jump attack started (death_stab / run_jump_attack)');

  const fin = await api.evalGame(() => window.__KCA.info());
  expect(fin.errors.length === 0, `no runtime errors (${fin.errors.length})`);
  api.log(`total hero hits: ${(await ev('hit')).filter((e) => String(e.summary.attacker).startsWith('hero')).length} · drawCalls ${fin.drawCalls} · triangles ${fin.triangles}`);
};
