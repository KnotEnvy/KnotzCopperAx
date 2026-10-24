// Mount attack VFX close-up in the ride sandbox (mounts agent). Hero is put in the saddle, two straw marauders stand
// in range, the Light attack fires; frames cover the whole attack. Use:
//   node tools/capture.mjs --url "/?mode=showcase&what=mount&id=emberdrake&scene=ride" --scenario tools/scenarios/mounts_fx.mjs --sheet --out ...
// env FX_DX = "2.2,3.3" foe offsets (m ahead of the hero), FX_FRAMES (default 24), FX_STEP ms (default 33), FX_KEY (light),
//   FX_SKIP ms advanced after the press before the first frame.
export default async (api) => {
  const S = (fn, a) => api.evalGame(fn, a);
  const dx = (process.env.FX_DX || '2.6,3.6').split(',').map(Number);
  await S(() => window.__KCA.debug.god(true));
  await api.advance(300);
  await S(() => { const sc = window.__KCA.showcase, h = sc.hero, b = sc.beast(); const e = b.rider; if (e) { b.dismount({ knocked: true, silent: true }); e.remove(); } b.pos.x = h.pos.x + 0.6; b.pos.z = h.pos.z; b.mount(h, { force: true }); h.facing = 1; });
  await S((d) => { const sc = window.__KCA.showcase; return Promise.all(d.map((x, i) => sc.spawnFoe('marauder', x, i % 2 ? 0.3 : -0.1, 'straw'))); }, dx);
  await S(() => { for (const e of window.__KCA.showcase.foes()) { e.brain = null; } });
  await api.advance(150);
  api.log('seated=' + await S(() => !!window.__KCA.showcase.hero._seated));
  await api.press(1, process.env.FX_KEY || 'light', 60);
  if (process.env.FX_SKIP) await api.advance(Number(process.env.FX_SKIP)); // ms of game time before the frames
  await api.frames(Number(process.env.FX_FRAMES || 24), Number(process.env.FX_STEP || 33), 'fx');
  const st = await S(() => { const sc = window.__KCA.showcase, b = sc.beast(), g = window.__KCA.game; return { ...sc.state(), whip: !!(b && b._whip), trails: g.vfx.trails.trails.map((t) => t.actor.typeId + ':' + t.samples.length), shapes: g.vfx.shape.count, errors: (window.__KCA.info().errors || []).length }; });
  api.log(JSON.stringify(st));
};
