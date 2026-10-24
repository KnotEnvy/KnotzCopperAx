// Pale spawn figure (perf-1650, wave C2 r1): replay the Heroes team's rim_drama probe exactly (its drama cameras move
// the spawn edge, so wave 2 lands where it did in their run), then run pale_figure.mjs on the final frame.
//   node tools/capture.mjs --url "/?mode=stage&stage=1&p1=seraphine" --scenario tools/scenarios/pale_figure_rim.mjs --warm 1500 --out <dir>
import rim from './rim_drama.mjs';
import pale from './pale_figure.mjs';

export default async (api) => {
  await rim(api);
  process.env.PALE_SETUP = 'none';
  if (!process.env.PALE_SETTLE) process.env.PALE_SETTLE = '17';
  await pale(api);
};
