// Wave C1 (perf): stills of the stage title card's wipe at fixed wall-clock times (CSS animations run in real time).
//   node tools/capture.mjs --realtime --url "/?mode=stage&stage=1&p1=brann" --scenario tools/scenarios/cardwipe.mjs --out <dir>
// env CW_TIMES=150,300,450,600,900,1400 (ms after ui.card()), CW_BIG=1 → the GAME OVER (big) card
import path from 'node:path';
export default async (api) => {
  const { page } = api;
  const times = String(process.env.CW_TIMES || '150,300,450,600,900,1400').split(',').map(Number);
  await page.waitForTimeout(6000); // the stage's own card is gone after 3.2 s
  await page.evaluate((big) => { const ui = window.__KCA.game.ui; window.__CW0 = performance.now(); if (big) ui.card('', 'GAME OVER', 4, { big: true }); else ui.card('STAGE 1', 'The Ashen Wilds', 3.2); }, process.env.CW_BIG === '1');
  for (const t of times) {
    await page.waitForFunction((t) => performance.now() - window.__CW0 >= t, t, { polling: 5 });
    await page.screenshot({ path: path.join(api.outDir, `card_${String(t).padStart(4, '0')}.png`), clip: { x: 300, y: 170, width: 1000, height: 300 } });
  }
};
