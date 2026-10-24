// Untouched camp gameplay/bot/HUD/fire; record connecting hits and contact frames.
import fs from 'node:fs';import path from 'node:path';
export default async api=>{
  await api.evalGame(()=>{const g=window.__KCA.game;window.__campHits=[];g.bus.on('hit',e=>window.__campHits.push({tick:g.tick,moveId:e.moveId,target:e.target?.typeId,point:e.point&&{...e.point},blocked:!!e.blocked}));});
  let seen=0;
  for(let i=0;i<520;i++){
    await api.advance(1000/60);
    const hits=await api.evalGame(()=>window.__campHits);
    if(hits.length>seen){await api.shot(`camp-hit-${seen}`);seen=hits.length;}
    if(seen>=4)break;
  }
  const hits=await api.evalGame(()=>window.__campHits);
  fs.writeFileSync(path.join(api.outDir,'camp-hits.json'),JSON.stringify(hits,null,2));
  if(!hits.length)throw Error('No natural camp hit');
};
