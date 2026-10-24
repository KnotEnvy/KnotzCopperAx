import fs from 'node:fs'; import path from 'node:path';
export default async api=>{
 await api.evalGame(async()=>{
  const k=window.__KCA,g=k.game;g.levels.scriptEnabled=false;
  for(const e of g.world.query({team:'enemies'}))e.remove();
  const h=g.world.query({kind:'hero'})[0];g.bots.detach(h);k.input.releaseAll();h.pos.set(2.0,0,0);h.prevPos.copy(h.pos);h.vel.set(0,0,0);h.facing=1;h.godMode=true;h.endMove();h.fsm.go('idle');
  const spawned=await k.debug.spawn('thief',2.8,0,{tier:'blue'});
  const foe=g.world.byId.get(spawned.id);foe.brain=null;foe.pos.set(2.8,0,0);foe.prevPos.copy(foe.pos);foe.vel.set(0,0,0);foe.hp=foe.maxHp=999;foe.fsm.go('idle');
  window.__kickHits=[];window.__kickDebrisStart=g.vfx.debris.n;
  g.bus.on('hit',e=>{if(e.target?.typeId==='thief')window.__kickHits.push({tick:g.tick,moveId:e.moveId,point:e.point&&{...e.point},chips:g.vfx.debris.n});});
  g.cameraRig.snap();
 });
 api.page.setDefaultTimeout(90000);
 // Real input advances the close chain. Stop at the exact kick contact tick, before its star decays.
 for(let i=0;i<320;i++){
   if(i%10===0)await api.press(1,'light',50);
   await api.advance(1000/60);
   if(await api.evalGame(()=>window.__kickHits.some(h=>h.moveId==='close_finisher')))break;
 }
 await api.evalGame(()=>{document.querySelectorAll('.kca-card,.kca-camp-banner').forEach(e=>e.style.display='none');});
 await api.shot('kick-contact-000ms');
 for(let i=1;i<5;i++){await api.advance(33);await api.shot(`kick-contact-${String(i*33).padStart(3,'0')}ms`);}
 const found=await api.evalGame(()=>window.__kickHits);
 const debrisStart=await api.evalGame(()=>window.__kickDebrisStart),debrisEnd=await api.evalGame(()=>window.__KCA.game.vfx.debris.n);
 await api.shot('kick-final');
 fs.writeFileSync(path.join(api.outDir,'kick.json'),JSON.stringify({hits:found,debrisStart,debrisEnd},null,2));
 if(!found.some(h=>h.moveId==='close_finisher'))throw Error('No real close_finisher kick hit on thief');
 // Light chain can shed metal; reject stone rather than all physical fragments.
 if(await api.evalGame(()=>Array.from(window.__KCA.game.vfx.debris.kind.slice(0,window.__KCA.game.vfx.debris.n)).some(k=>k!==4)))throw Error('Non-metal debris during kick chain');
};
