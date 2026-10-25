// Real stage1 bot fight with frame-by-frame move/hitstop evidence for clip review.
// Use p1=seraphine&bot=1&pots=0&seed=1, warm8000, --mp4 --sheet --keep-frames.
import fs from 'node:fs';
import path from 'node:path';
export default async api => {
  await api.evalGame(() => window.__KCA.debug.god(true));
  let found = false;
  for (let i=0; i<120; i++) {
    found = await api.evalGame(() => {
      const g=window.__KCA.game,h=g.world.query({kind:'hero'})[0];
      return !!h?.attack && g.world.query({team:'enemies'}).some(e=>e.alive);
    });
    if(found) break;
    await api.advance(100);
  }
  if(!found) throw new Error('No live Seraphine attack within 12s; reject empty combat clip');
  const frames=[];
  for(let frame=0;frame<90;frame++) {
    await api.frames(1,33);
    frames.push(await api.evalGame(frame=>{
      const g=window.__KCA.game,h=g.world.query({kind:'hero'})[0];
      return {frame,move:h.moveId,state:h.fsm.name,attackFrame:h.attack?.frame??null,
        hitstop:g.freeze,actorHitstop:h.hitstop,
        enemies:g.world.query({team:'enemies'}).filter(e=>e.alive).length};
    },frame));
  }
  await api.shot('stage_combat');
  fs.writeFileSync(path.join(api.outDir,'combat_frames.json'),JSON.stringify(frames,null,2));
};
