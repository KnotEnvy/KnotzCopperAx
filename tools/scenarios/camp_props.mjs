// Camp prop close-ups (bonus-camp r10): free-camera stills of the authored camp kit (fire, bedrolls, logs, firewood, stump + axe, pines).
//   node tools/capture.mjs --url "/?mode=stage&stage=bonus&p1=gorrim&bot=1&camp=2" --scenario tools/scenarios/camp_props.mjs --out progress/tmp/bonus-camp-r10/props
// optional: --eval "window.__PROPS='fire,bed'" limits the views.
const VIEWS = {
  main: null,
  fire: { p: [0.5, 1.15, 3.1], t: [0, 0.62, -0.7], fov: 34 },
  fire_hi: { p: [1.4, 2.2, 3.4], t: [0, 0.5, -0.7], fov: 30 },
  bed_l: { p: [-1.0, 1.7, 2.7], t: [-2.55, 0.1, 0.55], fov: 36 },
  bed_r: { p: [4.4, 1.7, 2.7], t: [2.55, 0.1, 0.55], fov: 36 },
  logs: { p: [-0.2, 1.3, 0.9], t: [-1.3, 0.2, -2.25], fov: 36 },
  wood: { p: [5.6, 1.5, 0.9], t: [4.5, 0.25, -1.9], fov: 34 },
  stump: { p: [6.4, 1.2, -0.7], t: [5.4, 0.35, -2.9], fov: 32 },
  pines: { p: [0, 1.8, 6], t: [0, 4.2, -12], fov: 46 },
  pine_near: { p: [-7, 1.6, -1], t: [-14, 3.5, -8], fov: 40 },
  tent: { p: [-2.4, 1.5, 0.8], t: [-4.8, 0.9, -5.6], fov: 36 },
  cauldron: { p: [0.9, 1.1, 1.5], t: [0, 0.95, -0.7], fov: 24 },
};
export default async (api) => {
  await api.advance(5000);
  const want = (await api.evalGame(() => window.__PROPS || '')) || '';
  const names = want ? want.split(',') : Object.keys(VIEWS);
  for (const n of names) {
    const v = VIEWS[n]; if (v === undefined) continue;
    if (v) await api.evalGame((v) => { const r = window.__KCA.game.cameraRig; r.manual = true; const c = r.camera; c.fov = v.fov; c.position.set(...v.p); c.lookAt(...v.t); c.updateProjectionMatrix(); c.updateMatrixWorld(); }, v);
    await api.advance(60);
    await api.shot(n);
  }
};
