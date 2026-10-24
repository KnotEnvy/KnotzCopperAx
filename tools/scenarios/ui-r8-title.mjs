// ui-flow r8 evidence: title (PRESS START) + mode menu stills, settled (CSS animations finished) before each shot.
//   node tools/capture.mjs --url "/?mode=title" --scenario tools/scenarios/ui-r8-title.mjs --out progress/shots/ui-flow/r8/title --timeout 180000
import { settleCss } from '../lib/uioverlap.mjs';

export default async (api) => {
  const press = async (p, a, wait = 250) => { await api.press(p, a, 60); await api.advance(wait); };
  await api.advance(800);
  await api.page.waitForTimeout(600);
  await settleCss(api.page);
  await api.shot('01_title');
  await press(1, 'start', 600);
  await press(1, 'down'); await press(1, 'down'); await press(1, 'up'); await press(1, 'up');
  await api.page.waitForTimeout(600);
  await settleCss(api.page);
  await api.shot('02_menu');
};
