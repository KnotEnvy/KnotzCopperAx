// C2 r2: game-camera 33ms progression, plus debris regression and exact authored-pool ages.
import fs from 'node:fs';
import path from 'node:path';
export default async api => {
  const kinds=['light','heavy','knockdown','magic_fire','magic_storm','magic_earth','block','otg','throw','ko'];
  const results=[];
  for(const kind of kinds){
    await api.evalGame(k=>{const v=window.__KCA.game.vfx;v.fire.clear();window.__KCA.showcase.fire(k);},kind);
    for(let i=0;i<=9;i++){
      await api.advance(i ? 33 : 0);
      await api.shot(`${kind}_${String(i*33).padStart(3,'0')}ms`);
      results.push(await api.evalGame(({kind,i})=>{const v=window.__KCA.game.vfx;return {kind,ms:i*33,fire:v.fire.items.map(o=>({row:o.row,age:o.age,rot:o.rot,life:o.life})),chips:v.debris.n};},{kind,i}));
    }
    for(let i=0;i<40;i++)await api.advance(33);
  }
  fs.writeFileSync(path.join(api.outDir,'motifs.json'),JSON.stringify(results,null,2));
};
