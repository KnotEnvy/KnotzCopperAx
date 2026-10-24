import fs from 'node:fs';
import path from 'node:path';
export default async api=>{
  api.page.setDefaultTimeout(90000);
  await api.evalGame(()=>window.__KCA.showcase.fire('magic_storm'));
  for(let i=0;i<5;i++){
    await api.advance(i ? 33 : 0);
    await api.shot(`storm-${String(i*33).padStart(3,'0')}ms`);
  }
  await api.advance(700);
  await api.evalGame(()=>{const k=window.__KCA;k.game.vfx.spawn('time_ripple',{actor:k.showcase.hero});});
  await api.advance(0);await api.shot('dodge-000ms');
  await api.advance(66);await api.shot('dodge-066ms');
  await api.advance(99);await api.shot('dodge-165ms');
  fs.writeFileSync(path.join(api.outDir,'state.json'),JSON.stringify(await api.evalGame(()=>({errors:window.__KCA.info().errors,lights:window.__KCA.game.vfx.lights.map(s=>s.light.intensity)})),null,2));
};
