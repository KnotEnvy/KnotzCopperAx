// Actual mounted projectile contact, sampled from its hit tick rather than a fixed late delay.
import fs from 'node:fs';import path from 'node:path';
export default async api=>{
 await api.evalGame(()=>window.__KCA.debug.god(true));await api.advance(300);
 await api.evalGame(async()=>{const sc=window.__KCA.showcase,g=window.__KCA.game,h=sc.hero,b=sc.beast();if(b.rider){const e=b.rider;b.dismount({knocked:true,silent:true});e.remove();}b.pos.x=h.pos.x+.6;b.pos.z=h.pos.z;b.mount(h,{force:true});h.facing=1;await sc.spawnFoe('marauder',4.2,-.1,'straw');for(const e of sc.foes()){e.brain=null;e.hp=e.maxHp=999;}
  window.__ballHits=[];g.bus.on('hit',e=>{if(e.moveId==='beast_fireball')window.__ballHits.push({tick:g.tick,moveId:e.moveId,point:e.point&&{...e.point},target:e.target.pos.toArray()});});});
 await api.advance(150);await api.press(1,'light',60);
 for(let i=0;i<160;i++){await api.advance(1000/60);if(await api.evalGame(()=>window.__ballHits.length))break;}
 if(!await api.evalGame(()=>window.__ballHits.length))throw Error('No actual fireball contact');
 const samples=[];
 for(let i=0;i<16;i++){
  if(i)await api.advance(33);await api.frames(1,0,'impact');await api.shot(`impact-${String(i*33).padStart(3,'0')}ms`);
  samples.push(await api.evalGame(ms=>{const g=window.__KCA.game,foe=window.__KCA.showcase.foes()[0],chest=foe?.modelRoot?.getObjectByName('chest');return {ms,target:foe?.pos.toArray(),chest:chest?.getWorldPosition(g.camera.position.clone()).toArray(),flames:g.vfx.fire.items.filter(o=>o.row===1).map(o=>({pos:[...o.pos],life:o.life,age:o.age,phase:o.phase,attached:!!o.follow}))};},i*33));
 }
 fs.writeFileSync(path.join(api.outDir,'attachment.json'),JSON.stringify(samples,null,2));
 const data=await api.evalGame(()=>({hits:window.__ballHits,errors:window.__KCA.info().errors}));
 fs.writeFileSync(path.join(api.outDir,'contact.json'),JSON.stringify(data,null,2));
};
