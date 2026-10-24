// ui-flow r8 evidence: one settled still of a showcase page. Env SHOT = output name (no extension).
// 600 ms wall wait so CSS animations have started, then settleCss (every finite CSS animation/transition + <img> decode done) before the shot.
//   SHOT=map_to5 node tools/capture.mjs --url "/?mode=showcase&what=ui&id=map&to=5&t=5.5&capture=1" --scenario tools/scenarios/ui-r8-settled.mjs --out progress/shots/ui-flow/r8/map
import { settleCss } from '../lib/uioverlap.mjs';

export default async (api) => {
  await api.page.waitForTimeout(600);
  await settleCss(api.page);
  await api.shot(process.env.SHOT);
};
