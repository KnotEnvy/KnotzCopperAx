// One fire event at the game camera; matched-pose library-off frames support pixel counts.
import fs from 'node:fs';
import path from 'node:path';
export default async api=>{
  await api.evalGame(()=>window.__KCA.showcase.fire('magic_fire'));
  const samples=[];
  for(let i=0;i<=16;i++){
    if(i)await api.advance(33);
    await api.frames(1,0,'fire');
    await api.shot(`fire-${String(i*33).padStart(3,'0')}ms`);
    samples.push(await api.evalGame(ms=>{const g=window.__KCA.game,sc=window.__KCA.showcase;return {ms,items:g.vfx.fire.items.map(o=>({row:o.row,age:o.age,life:o.life,alpha:o.alpha,pos:o.pos,size:o.size,phase:o.phase,attached:!!o.follow})),foe:sc.foe.pos.toArray(),errors:window.__KCA.info().errors};},i*33));
    await api.evalGame(()=>{const g=window.__KCA.game;g.vfx.fire.mesh.visible=false;g.renderer.render(0);});
    await api.shot(`off-${String(i*33).padStart(3,'0')}ms`);
    await api.evalGame(()=>{const g=window.__KCA.game;g.vfx.fire.mesh.visible=true;g.renderer.render(0);});
  }
  fs.writeFileSync(path.join(api.outDir,'fire-timing.json'),JSON.stringify(samples,null,2));
};
