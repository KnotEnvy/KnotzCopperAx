// r12: actual CombatSystem fire hit + knockback (showcase), 0-594 ms at 33 ms; procedural body fire on bones.
import fs from 'node:fs';import path from 'node:path';
export default async api=>{
 await api.evalGame(()=>{const k=window.__KCA,g=k.game,sc=k.showcase;
  sc.foe.puppet=false;sc.foe.brain=null;sc.foe.invuln=0;sc.foe.hitstop=0;
  window.__fireHit=g.combat.applyHit(sc.hero,sc.foe,{damage:1,level:'magic',element:'fire',knockback:6,hitstun:32,hitstop:0},{moveId:'fire_attachment_probe',dir:1});
  g.renderer.render(0);
 });
 if(!await api.evalGame(()=>window.__fireHit))throw Error('Fire probe did not apply an actual CombatSystem hit');
 const samples=[];
 for(let i=0;i<=18;i++){
  if(i)await api.advance(33);
  await api.frames(1,0,'fire');await api.shot(`fire-${String(i*33).padStart(3,'0')}ms`);
  samples.push(await api.evalGame(ms=>{const g=window.__KCA.game,sc=window.__KCA.showcase,chest=sc.foe.modelRoot.getObjectByName('chest');
   const q=chest.getWorldPosition(g.camera.position.clone()).project(g.camera);
   return {ms,screen:[(q.x+1)*800,(1-q.y)*450],items:g.vfx.fire.items.map(o=>({row:o.row,seed:o.seed,age:o.age,life:o.life,pos:[...o.pos],size:[...o.size],attached:!!o.follow})),
    chest:chest.getWorldPosition(g.camera.position.clone()).toArray(),foe:sc.foe.pos.toArray(),errors:window.__KCA.info().errors};},i*33));
 }
 fs.writeFileSync(path.join(api.outDir,'fire-timing.json'),JSON.stringify(samples,null,2));
 fs.writeFileSync(path.join(api.outDir,'screen.json'),JSON.stringify(samples.map(s=>({ms:s.ms,screen:s.screen}))));
 if(Math.abs(samples.at(-1).foe[0]-samples[0].foe[0])<.3)throw Error('Knockback evidence must move the body');
};
