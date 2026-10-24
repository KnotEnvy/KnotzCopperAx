// Input-driven jab in the real stage/HUD/camera, centred for contact readability.
// URL /?mode=stage&stage=2&p1=brann&seed=1&drs=0 ; --warm 8000
// Existing wave is removed ONLY in this QA harness; normal CombatSystem hit detection/damage/FX are untouched.
import fs from 'node:fs';
import path from 'node:path';
export default async api => {
  await api.evalGame(async () => {
    const k=window.__KCA,g=k.game;
    g.levels.scriptEnabled=false;g.levels.phase='idle';
    for(const e of g.world.query({team:'enemies'}))e.remove();
    const h=g.world.query({kind:'hero'})[0];
    h.pos.set(8.2,0,0.6);h.prevPos.copy(h.pos);h.vel.set(0,0,0);h.facing=1;h.godMode=true;
    await k.debug.spawn('marauder',9.5,0.6,{tier:'rust'});
    const e=g.world.query({team:'enemies'}).at(-1);e.brain=null;e.hp=e.maxHp=999;e.fsm.go('idle');
    window.__lightEvidence=[];
    g.bus.on('hit',e=>window.__lightEvidence.push({tick:g.tick,time:g.time,moveId:e.moveId,level:e.level,hp:e.target?.hp,blocked:!!e.blocked,point:e.point&&{...e.point}}));
    g.cameraRig.snap();
  });
  await api.advance(300);
  await api.press(1,'light',50);
  let seen=0;
  for(let i=0;i<54;i++){
    if(i===19||i===37)await api.press(1,'light',50);
    await api.frames(1,33,'jab');
    const ev=await api.evalGame(()=>window.__lightEvidence);
    if(ev.length>seen){await api.shot(`contact_${i}`); if(seen===0)await api.shot('light_gameplay');seen=ev.length;api.log(ev.at(-1));}
  }
  const ev=await api.evalGame(()=>window.__lightEvidence);
  fs.writeFileSync(path.join(api.outDir,'connecting-hits.json'),JSON.stringify(ev,null,2));
  if(!ev.some(x=>x.level==='light'&&!x.blocked))throw Error('No connecting light hit');
};
