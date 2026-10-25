// Authored-pose inspection only. Real stage + real marauder at the game camera; AI/bot actors held in place.
// These controlled stills are labelled separately from the natural-event reaction MP4.
import fs from 'node:fs';
import path from 'node:path';
export default async api => {
  const E=(fn,arg)=>api.evalGame(fn,arg);
  for(let i=0;i<24;i++){await api.advance(500);if(await E(()=>window.__KCA.game.world.query({team:'enemies'}).some(e=>e.typeId==='marauder'&&e.alive)))break;}
  await api.advance(5500); // let the stage card clear and the complete opening wave arrive
  const info=await E(()=>{
    const g=window.__KCA.game, foes=g.world.query({team:'enemies'}).filter(e=>e.typeId==='marauder'&&e.alive), e=foes.find(e=>['rust','iron'].includes(e.tier))||foes[0];
    if(!e)throw Error('no marauder for pose inspection');
    for(const h of g.world.query({kind:'hero'})){g.bots.detach(h);h.godMode=true;h.stopMoving?.();}
    for(const o of g.world.query({team:'enemies'})){o.brain=null;o.stopMoving();o.fsm.go('idle');o.vel.set(0,0,0);}
    e.pos.x=g.world.query({kind:'hero'})[0].pos.x+3.4;e.pos.z=.2;e.prevPos.copy(e.pos);e.facing=-1;
    window.__POSE_FOE=e;return {id:e.id,type:e.typeId,controlled:true};
  });
  const rows=[];
  for(const pose of ['neutral','recoil','fear','rally','brace','circle']){
    await E(p=>{const e=window.__POSE_FOE;e.vel.set(0,0,0);e.fsm.go('idle');e.pause(120,{anim:p==='neutral'?'idle':'crowd_'+p,face:false,duration:p==='neutral'?undefined:.7,loop:p==='circle'});},pose);
    await api.advance(220);
    const box=await E(()=>{const e=window.__POSE_FOE,g=window.__KCA.game,c=g.cameraRig.camera,V=c.position.constructor;c.updateMatrixWorld();const p=new V(e.pos.x,e.pos.y,e.pos.z).project(c),q=new V(e.pos.x,e.pos.y+e.height,e.pos.z).project(c);return {foot:[(p.x+1)/2*innerWidth,(1-p.y)/2*innerHeight],head:[(q.x+1)/2*innerWidth,(1-q.y)/2*innerHeight],clip:e.animator.cur.name};});
    await api.shot('pose_'+pose);rows.push({pose,...box});
  }
  fs.writeFileSync(path.join(api.outDir,'poses.json'),JSON.stringify({label:'Controlled pose inspection; natural event clip is separate',...info,rows},null,2));
};
