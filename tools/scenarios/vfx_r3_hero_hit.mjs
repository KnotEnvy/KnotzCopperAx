// Enemy AI attacks a standing hero through the real CombatSystem. HP only extended for observation.
import fs from 'node:fs';
import path from 'node:path';
export default async api=>{
  await api.evalGame(async()=>{
    const k=window.__KCA,g=k.game,h=g.world.query({kind:'hero'})[0];
    h.godMode=false;h.hp=h.maxHp;h.invuln=0;h.pots=0;h.pos.set(8.2,0,.6);h.prevPos.copy(h.pos);h.facing=1;
    const e=await k.debug.spawn('marauder',9.6,.6,{tier:'rust'});e.facing=-1;
    window.__heroContacts=[];window.__heroProbes=[];
    g.vfx.contactProbe=({target,flash,point,moveId})=>{
      if(target.kind!=='hero')return;
      const cam=g.camera,project=p=>{const v=cam.position.clone().set(p.x,p.y,p.z).project(cam);return [(v.x+1)*800,(1-v.y)*450];};
      const f=project(flash),corners=target.hurtboxes().flatMap(b=>[b.minX,b.maxX].flatMap(x=>[b.minY,b.maxY].flatMap(y=>[b.minZ,b.maxZ].map(z=>project({x,y,z})))));
      const rect=[Math.min(...corners.map(p=>p[0])),Math.max(...corners.map(p=>p[0])),Math.min(...corners.map(p=>p[1])),Math.max(...corners.map(p=>p[1]))];
      window.__heroProbes.push({moveId,point,flash,screen:f,hurtProjection:rect,screenDistancePx:Math.hypot(Math.max(rect[0]-f[0],0,f[0]-rect[1]),Math.max(rect[2]-f[1],0,f[1]-rect[3]))});
    };
    g.bus.on('hit',e=>{if(e.target===h)window.__heroContacts.push({tick:g.tick,moveId:e.moveId,attacker:e.attacker.typeId,kind:e.attacker.kind,target:e.target.typeId,blocked:!!e.blocked,point:e.point});});
    g.cameraRig.snap();
  });
  for(let i=0;i<120;i++){
    await api.advance(33);
    if(await api.evalGame(()=>window.__heroContacts.length)){
      break;
    }
  }
  const result=await api.evalGame(()=>({contacts:window.__heroContacts,probes:window.__heroProbes}));
  fs.writeFileSync(path.join(api.outDir,'hero-contact.json'),JSON.stringify(result,null,2));
  await api.shot('hero-contact');
  if(!result.contacts.length)throw Error('Enemy never hit hero');
  if(result.probes.some(p=>p.screenDistancePx>.01))throw Error('Hero flash outside hurtbox');
};
