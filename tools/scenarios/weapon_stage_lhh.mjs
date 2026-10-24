// Stage-1 weapon read clip (owner: hero-weapons): the board's framing — p1 warms up on stage 1, then light, light, heavy
// against whatever is in front, captured as a 75-frame 33 ms clip (sheet + mp4 via --sheet --mp4). Use --warm 8000.
//   node tools/capture.mjs --url "/?mode=stage&stage=1&p1=brann&bot=1" --warm 8000 --scenario tools/scenarios/weapon_stage_lhh.mjs \
//        --frames 75 --step 33 --sheet --mp4 --out progress/shots/hero-weapons/c2r2/stage1-brann
export default async (api) => {
  const n = Number(process.env.LHH_FRAMES || 75), step = Number(process.env.LHH_STEP || 33);
  await api.advance(400);
  api.press(0, 'light', 60); await api.advance(step * 12);
  api.press(0, 'light', 60); await api.advance(step * 2);
  // start the clip just before the second light lands, run through the heavy
  const p = api.frames(n, step);
  await api.advance(step * 10);
  api.press(0, 'heavy', 60);
  await p;
};
