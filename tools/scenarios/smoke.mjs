// Smoke scenario: the game loads, a hero walks (x and depth), attacks, jumps and lands — all through the
// real input path (window.__KCA.input → virtual device → PlayerInput, same as keyboard/gamepad).
//
//   node tools/capture.mjs --url "/?mode=stage&stage=1&p1=brann" --scenario tools/scenarios/smoke.mjs --sheet --out progress/tmp/smoke
//
// Throws (→ capture reports "CAPTURE FAILED" in pageErrors, exit code 3) if an expectation fails.
export default async (api) => {
  const info = () => api.evalGame(() => window.__KCA.info());
  const hero = async () => (await info()).heroes.find((h) => h.player === 1);
  const expect = (cond, msg) => { if (!cond) throw new Error('smoke: ' + msg); api.log('ok  ' + msg); };

  // Movement smoke, not an AI test: park the enemies' brains (stage waves still spawn) so a swing can't knock the hero out of a jump.
  await api.evalGame(() => { const g = window.__KCA.game; g.addSystem({ name: 'smoke-calm', order: 1, update() { for (const e of g.world.query({ team: 'enemies' })) e.brain = null; } }); });
  const i0 = await info();
  expect(i0.ready && i0.heroes.length >= 1, `mode '${i0.mode}' ready with a P1 hero (${i0.heroes.map((h) => h.hero).join(',')})`);
  const h0 = await hero();
  await api.evalGame(() => window.__KCA.debug.god(true));

  // Walk right.
  await api.hold(1, 'right', true);
  await api.frames(3, 200, 'walk');
  await api.hold(1, 'right', false);
  const h1 = await hero();
  expect(h1.x > h0.x + 0.8, `walked right (${h0.x} → ${h1.x})`);

  // Walk toward the camera (depth).
  await api.hold(1, 'down', true);
  await api.advance(350);
  await api.hold(1, 'down', false);
  const h2 = await hero();
  expect(h2.z > h1.z + 0.3, `walked in depth (${h1.z} → ${h2.z})`);

  // Attack.
  await api.press(1, 'light', 50);
  await api.frames(2, 80, 'attack');
  const events = await api.evalGame(() => window.__KCA.events('attackStart').map((e) => e.summary.moveId));
  expect(events.includes('light_1'), 'light_1 started from a Light press');
  await api.advance(400);

  // Jump + land.
  await api.press(1, 'jump', 50);
  await api.advance(200);
  const h3 = await hero();
  expect(h3.y > 0.8, `airborne after Jump (y = ${h3.y})`);
  await api.frames(2, 120, 'jump');
  await api.advance(700);
  const h4 = await hero();
  expect(h4.y === 0, `landed (y = ${h4.y}, state ${h4.state})`);

  const fin = await info();
  expect(fin.errors.length === 0, `no runtime errors (${fin.errors.length})`);
  api.log(`perf: drawCalls ${fin.drawCalls} · triangles ${fin.triangles} · geometries ${fin.geometries} · textures ${fin.textures} · programs ${fin.programs}`);
  await api.shot('smoke_end');
};
