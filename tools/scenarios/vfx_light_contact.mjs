// Real input / CombatSystem contact; --warm 8000, stage=1 or 2. No synthetic HIT/FX.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
export default async api => {
  await api.evalGame(async () => {
    const k=window.__KCA,g=k.game;
    g.levels.scriptEnabled=false;g.levels.phase='idle';
    for(const a of g.world.query({team:'enemies'}))a.remove();
    const h=g.world.query({kind:'hero'})[0];
    h.pos.set(8.2,0,0.6);h.prevPos.copy(h.pos);h.vel.set(0,0,0);h.facing=1;h.godMode=true;
    await k.debug.spawn('marauder',9.5,0.6,{tier:'rust'});
    const foe=g.world.query({team:'enemies'}).at(-1);foe.brain=null;foe.hp=foe.maxHp=999;foe.fsm.go('idle');
    window.__lightEvidence=[];
    g.bus.on('hit',e=>window.__lightEvidence.push({tick:g.tick,time:g.time,moveId:e.moveId,level:e.level,hp:e.target?.hp,blocked:!!e.blocked,point:{...e.point}}));
    g.cameraRig.snap();
  });
  await api.advance(300);
  await api.shot('before');
  await api.press(1,'light',50);
  let hit;
  for(let i=0;i<45;i++){
    await api.advance(1000/60);
    const events=await api.evalGame(()=>window.__lightEvidence);
    if(events.length){hit=events[0];break;}
  }
  if(!hit||hit.blocked||hit.level!=='light')throw Error('No connecting real light');
  await api.shot('contact_0ms');
  const projection=await api.evalGame(()=>{
    const g=window.__KCA.game,p=window.__lightEvidence[0].point;
    const v=g.camera.position.clone().set(p.x,p.y,p.z).project(g.camera);
    return {x:(v.x*.5+.5)*1600,y:(-.5*v.y+.5)*900};
  });
  await api.advance(1000/30); await api.shot('contact_33ms');
  const left=Math.max(0,Math.min(1360,Math.round(projection.x-120))),top=Math.max(0,Math.min(660,Math.round(projection.y-120)));
  for(const name of ['before','contact_0ms','contact_33ms'])await sharp(path.join(api.outDir,name+'.png')).extract({left,top,width:240,height:240}).resize(720,720).png().toFile(path.join(api.outDir,name+'_crop3x.png'));
  fs.writeFileSync(path.join(api.outDir,'connecting-hits.json'),JSON.stringify({hit,projection,crop:{left,top,width:240,height:240}},null,2));
  api.log({hit,projection});
};
