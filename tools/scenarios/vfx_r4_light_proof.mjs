// Real input contact, then two renders of the SAME pose with only pooled pop lights toggled.
import fs from 'node:fs';import path from 'node:path';
export default async api=>{
  await api.evalGame(async()=>{
    const k=window.__KCA,g=k.game;g.levels.scriptEnabled=false;g.levels.phase='idle';
    for(const e of g.world.query({team:'enemies'}))e.remove();
    const h=g.world.query({kind:'hero'})[0];h.pos.set(8.2,0,.6);h.prevPos.copy(h.pos);h.vel.set(0,0,0);h.facing=1;h.godMode=true;
    await k.debug.spawn('marauder',9.5,.6,{tier:'rust'});const foe=g.world.query({team:'enemies'}).at(-1);foe.brain=null;foe.hp=foe.maxHp=999;
    window.__proof=[];g.bus.on('hit',e=>window.__proof.push({tick:g.tick,point:{...e.point},hp:e.target.hp}));g.cameraRig.snap();
  });
  await api.advance(300);await api.press(1,'light',50);
  for(let i=0;i<50;i++){await api.advance(1000/60);if(await api.evalGame(()=>window.__proof.length))break;}
  if(!await api.evalGame(()=>window.__proof.length))throw Error('No light proof contact');
  await api.shot('contact-light-on');
  const data=await api.evalGame(()=>{
    const g=window.__KCA.game;const project=p=>{const q=g.camera.position.clone().set(p.x,p.y,p.z).project(g.camera);return [(q.x+1)*800,(1-q.y)*450];};
    const p=window.__proof[0].point;window.__proofLights=g.vfx.lights.map(s=>s.light.intensity);const lights=g.vfx.lights.map(s=>({intensity:s.light.intensity,position:s.light.position.toArray(),distance:s.light.distance}));
    for(const s of g.vfx.lights)s.light.intensity=0;g.renderer.render(0);
    return {hits:window.__proof,lights,floorScreen:project({x:p.x,y:.02,z:p.z+.35}),bodyScreen:project(p)};
  });
  await api.shot('contact-light-off');
  await api.evalGame(()=>{const g=window.__KCA.game;g.vfx.lights.forEach((s,i)=>s.light.intensity=window.__proofLights[i]);g.renderer.render(0);});
  await api.shot('contact-light-restored');
  fs.writeFileSync(path.join(api.outDir,'light-proof.json'),JSON.stringify(data,null,2));
};
