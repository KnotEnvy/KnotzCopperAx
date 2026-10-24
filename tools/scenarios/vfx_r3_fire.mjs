import fs from 'node:fs';
import path from 'node:path';
export default async api => {
  await api.evalGame(()=>window.__KCA.showcase.fire('magic_fire'));
  for(let i=0;i<20;i++){
    await api.frames(1,33,'hit');
    await api.shot(`magic_fire_${String((i+1)*33).padStart(3,'0')}ms`);
  }
  fs.writeFileSync(path.join(api.outDir,'fire.json'),JSON.stringify(await api.evalGame(()=>({errors:window.__KCA.info().errors,fire:window.__KCA.game.vfx.fire.items.map(o=>({row:o.row,age:o.age,life:o.life,alpha:o.alpha}))})),null,2));
};
