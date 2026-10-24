// Same game-camera target; 0..528ms at 33ms, including independently rising soot.
import fs from 'node:fs';
import path from 'node:path';
export default async api => {
  await api.evalGame(()=>window.__KCA.showcase.fire('magic_fire'));
  await api.frames(1,0,'hit');
  await api.shot('magic_fire_000ms');
  for(let i=1;i<=16;i++){
    await api.frames(1,33,'hit');
    await api.shot(`magic_fire_${String(i*33).padStart(3,'0')}ms`);
    if(i===8 || i===13){
      api.log(await api.evalGame(()=>{const v=window.__KCA.game.vfx;return {fire:v.fire.items.map(o=>({...o})),instances:v.fire.mesh.geometry.instanceCount};}));
      await api.evalGame(()=>{const v=window.__KCA.game.vfx;for(const o of v.fire.items)if(o.row===2){o.savedAlpha=o.alpha;o.alpha=0;}v.fire.update(0);});
      await api.advance(0);await api.shot(`soot-off-${i*33}ms`);
      await api.evalGame(()=>{const v=window.__KCA.game.vfx;for(const o of v.fire.items)if(o.row===2)o.alpha=o.savedAlpha;v.fire.update(0);});
    }
  }
  fs.writeFileSync(path.join(api.outDir,'fire.json'),JSON.stringify(await api.evalGame(()=>({errors:window.__KCA.info().errors,items:window.__KCA.game.vfx.fire.items.map(o=>({row:o.row,age:o.age,life:o.life,alpha:o.alpha}))})),null,2));
};
