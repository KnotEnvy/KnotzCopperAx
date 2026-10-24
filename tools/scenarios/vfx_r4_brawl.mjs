// Arranged starting positions, FOUR live brains, real virtual-device input and unchanged CombatSystem.
// Retains stage waves/camera/HUD. HP999 + player godmode only keep the diagnostic running.
import fs from 'node:fs';
import path from 'node:path';
export default async api => {
  await api.evalGame(async()=>{
    const k=window.__KCA,g=k.game;k.debug.god(true);
    while(g.world.query({team:'enemies'}).length<4)await k.debug.spawn('marauder',12,0,{tier:'rust'});
    const heroes=g.world.query({kind:'hero'}),h=heroes[0];
    h.pos.set(8.2,0,.6);h.prevPos.copy(h.pos);h.vel.set(0,0,0);h.facing=1;h.godMode=true;h.pots=0;
    for(const other of heroes.slice(1)){other.pos.set(12,0,-1.6);other.prevPos.copy(other.pos);other.godMode=true;other.pots=0;g.bots.attach(other,{skill:.8});}
    const foes=g.world.query({team:'enemies'});
    const positions=[[9.95,.6],[11.0,1.5],[12,-1.6],[7.0,-1.3]];
    foes.forEach((e,i)=>{e.pos.set(positions[i%4][0],0,positions[i%4][1]);e.prevPos.copy(e.pos);e.vel.set(0,0,0);e.hp=e.maxHp=999;e.fsm.go('idle');});
    window.__r2Hits=[]; window.__contactProbes=[];
    g.vfx.contactProbe = ({target,moveId,point,flash,kind}) => {
      if(!target?.hurtboxes)return;
      const boxes=target.hurtboxes().map(b=>({...b})), cam=g.camera;
      const project=p=>{const v=cam.position.clone().set(p.x,p.y,p.z).project(cam);return [(v.x+1)*800,(1-v.y)*450];};
      const f=project(flash);
      const points=boxes.flatMap(b=>[b.minX,b.maxX].flatMap(x=>[b.minY,b.maxY].flatMap(y=>[b.minZ,b.maxZ].map(z=>project({x,y,z})))));
      const rect={minX:Math.min(...points.map(p=>p[0])),maxX:Math.max(...points.map(p=>p[0])),minY:Math.min(...points.map(p=>p[1])),maxY:Math.max(...points.map(p=>p[1]))};
      const dx=Math.max(rect.minX-f[0],0,f[0]-rect.maxX),dy=Math.max(rect.minY-f[1],0,f[1]-rect.maxY);
      window.__contactProbes.push({tick:g.tick,moveId,kind,target:target.typeId,targetKind:target.kind,point,flash,screen:f,hurtProjection:rect,screenDistancePx:Math.hypot(dx,dy),worldDistance:Math.min(...boxes.map(b=>Math.hypot(Math.max(b.minX-point.x,0,point.x-b.maxX),Math.max(b.minY-point.y,0,point.y-b.maxY),Math.max(b.minZ-point.z,0,point.z-b.maxZ))))});
    };
    g.bus.on('hit',e=>{const sw=g.vfx.trails.swingDir(e.attacker);window.__r2Hits.push({tick:g.tick,time:g.time,moveId:e.moveId,
      attacker:e.attacker?.typeId,target:e.target?.typeId,player:e.attacker===g.world.query({kind:'hero'})[0]?1:2,level:e.level,blocked:!!e.blocked,hp:e.target?.hp,
      point:e.point&&{...e.point},swing:sw&&{...sw},knockdown:!!e.knockdown,
      live:g.world.query({team:'enemies'}).filter(x=>x.hp>0).length,brains:g.world.query({team:'enemies'}).filter(x=>!!x.brain&&x.hp>0).length,
      fire:g.vfx.fire.items.filter(o=>o.age<=.001).map(o=>({row:o.row,rot:o.rot,life:o.life})),chips:g.vfx.debris.n});});
    g.cameraRig.snap();
  });
  await api.advance(66);
  let last=0;
  for(let frame=0;frame<66;frame++){
    if([0,6,12,34,40,46,68,74,80].includes(frame))await api.press(1,'light',50);
    await api.frames(1,33,'brawl');
    const hits=await api.evalGame(()=>window.__r2Hits);
    if(hits.length>last){for(const h of hits.slice(last))api.log({frame,...h});await api.shot(`contact_${frame}_${hits.at(-1).moveId}`);last=hits.length;}
  }
  // Re-space the same four live foes for a real uncharged Heavy at contact+0.
  await api.advance(1000);
  await api.evalGame(()=>{
    const g=window.__KCA.game,h=g.world.query({kind:'hero'})[0];
    h.pos.set(8.2,0,.6);h.prevPos.copy(h.pos);h.vel.set(0,0,0);h.fsm.go('idle');h.facing=1;
    g.world.query({team:'enemies'}).forEach((e,i)=>{
      const positions=[[9.6,.6],[11,1.5],[12,-1.6],[7,-1.3]],p=positions[i%4];
      e.pos.set(p[0],0,p[1]);e.prevPos.copy(e.pos);e.vel.set(0,0,0);e.fsm.go('idle');e.hitstop=0;
    });
    g.cameraRig.snap();
  });
  await api.press(1,'heavy',50);
  for(let i=0;i<80;i++){
    await api.advance(1000/60);
    const h=await api.evalGame(()=>window.__r2Hits.find(h=>h.attacker==='brann'&&h.moveId.startsWith('heavy')));
    if(h){await api.shot('heavy-contact-000ms');for(let j=1;j<=6;j++){await api.advance(33);await api.shot(`heavy-contact-${String(j*33).padStart(3,'0')}ms`);}break;}
  }
  const hits=await api.evalGame(()=>window.__r2Hits);
  if(!hits.some(h=>h.attacker==='brann'&&h.moveId.startsWith('heavy')))throw Error('No actual heavy in brawl');
  const probes=await api.evalGame(()=>window.__contactProbes);
  fs.writeFileSync(path.join(api.outDir,'flash-placement.json'),JSON.stringify(probes,null,2));
  api.log({flashPlacement:probes});
  if(probes.some(p=>p.screenDistancePx>.01))throw Error('Flash outside victim hurt projection');
  for(const move of ['light_1','light_2','light_3'])if(!probes.some(p=>p.moveId===move))throw Error('Missing placement probe '+move);
  const starts=await api.evalGame(()=>window.__KCA.events('attackStart'));
  fs.writeFileSync(path.join(api.outDir,'contacts.json'),JSON.stringify({hits,starts},null,2));
  if(!hits.some(h=>h.attacker==='brann'&&h.moveId==='light_1'&&!h.blocked&&h.live>=4&&h.brains>=4))throw Error('No clean light_1 in four-live-brain brawl');
  if(!hits.some(h=>h.attacker==='brann'&&h.moveId==='light_2'&&!h.blocked))api.log('Missing light_2 — repeat required');
  if(!hits.some(h=>h.attacker==='brann'&&h.moveId==='light_3'&&!h.blocked))api.log('Missing light_3 — repeat required');
};
