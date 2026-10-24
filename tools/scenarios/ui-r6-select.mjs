// ui-flow r6 evidence: settled character-select stills + hand close-ups (capture.mjs scenario).
//   node tools/capture.mjs --url "/?mode=title" --scenario tools/scenarios/ui-r6-select.mjs --out progress/shots/ui-flow/r6/select --timeout 180000
// Settle rule: after the set exists wait 1.5 s of rendered game time; after a READY lock wait 0.7 s (stamp spring + hero
// victory clip started) but < 1.4 s (the sim-clock 84-tick confirm delay hands over to the map).
export default async (api) => {
  const E = (fn, arg) => api.evalGame(fn, arg);
  const flow = () => E(() => window.__KCA.game.flow.state);
  const press = async (p, a, wait = 250) => { await api.press(p, a, 60); await api.advance(wait); };
  const until = async (fn, ms = 20000, step = 250) => { for (let t = 0; t < ms; t += step) { if (await fn()) return true; await api.advance(step); } return false; };
  // CSS transitions/animations run on WALL-clock time (the capture clock only drives rAF), so a shot right after a press catches
  // READY stamps / toasts mid-fade (the r5 "ghost READY"). settle() waits until every finite CSS animation has finished.
  const settle = () => api.page.evaluate(async () => {
    const fin = () => document.getAnimations().filter((a) => a.effect && a.effect.getComputedTiming().iterations !== Infinity && a.playState === 'running');
    for (let i = 0; i < 40 && fin().length; i++) await Promise.all(fin().map((a) => a.finished.catch(() => {})));
    await new Promise((r) => setTimeout(r, 120));
  });
  const shot = async (n) => { await settle(); await api.shot(n); };
  const cam = (c) => E((c) => { window.__KCA_SELECT_CAM = c; }, c);
  const hasSet = () => E(() => !!window.__KCA.game.renderer.scene.getObjectByName('selectSet'));
  await api.advance(800);
  await press(1, 'start', 600);
  await press(1, 'light', 400);
  await until(async () => (await flow()) === 'select');
  await until(hasSet, 30000);
  await api.advance(1500);
  await shot('select_1p');
  // hand close-ups (centre hero = Seraphine's hand, left hand) at the real fov, camera pulled in; UI hidden for the 2x view
  await E(() => { document.querySelector('.kca-ui').style.visibility = 'hidden'; });
  const R = Number(process.env.HAND_CAM_T || 0);
  await cam({ pos: [0.6, 2.6, 6.2], look: [0, 1.9, 0], fov: 38 }); await api.advance(500); await shot('hand_center_close');
  await cam({ pos: [-3.0, 2.8, 7.5], look: [-3.5, 1.7, 0], fov: 34 }); await api.advance(500); await shot('hand_left_close');
  await cam({ pos: [0.2, 7.0, 6.5], look: [0, 1.3, 0], fov: 38 }); await api.advance(500); await shot('hand_center_top');
  await cam({ pos: [4.2, 3.0, 2.2], look: [0, 1.4, 0], fov: 36 }); await api.advance(500); await shot('hand_center_side');
  await cam({ pos: [0.2, 3.4, 4.8], look: [0, 1.2, 0], fov: 30 }); await api.advance(500); await shot('hand_center_palm');
  await cam(null); await E(() => { document.querySelector('.kca-ui').style.visibility = ''; });
  await api.advance(400);
  await press(2, 'start', 300);
  await press(1, 'light', 700);                          // P1 READY (Brann)
  await shot('select_p1_ready');
  await press(2, 'left'); await press(2, 'left');        // P2 cursor onto Brann → TAKEN toast
  await press(2, 'light', 500);
  await shot('select_duplicate_pick');
  await api.advance(1800);                               // toast (1.6 s) expires
  await press(2, 'right', 300);
  await api.advance(400);
  await shot('select_p1_ready_p2_choosing');
  await press(2, 'light', 700);                          // P2 READY (Seraphine) → both ready, map hand-over in 1.4 s
  await shot('select_both_ready');
  const info = await E(() => window.__KCA.info());
  if (info.errors && info.errors.length) api.log('ERRORS ' + JSON.stringify(info.errors.slice(0, 3)));
};
