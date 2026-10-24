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
    window.__r2Hits=[];
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
  const hits=await api.evalGame(()=>window.__r2Hits);
  const starts=await api.evalGame(()=>window.__KCA.events('attackStart'));
  fs.writeFileSync(path.join(api.outDir,'contacts.json'),JSON.stringify({hits,starts},null,2));
  if(!hits.some(h=>h.attacker==='brann'&&h.moveId==='light_1'&&!h.blocked&&h.live>=4&&h.brains>=4))throw Error('No clean light_1 in four-live-brain brawl');
  if(!hits.some(h=>h.attacker==='brann'&&h.moveId==='light_2'&&!h.blocked))api.log('Missing light_2 — repeat required');
  if(!hits.some(h=>h.attacker==='brann'&&h.moveId==='light_3'&&!h.blocked))api.log('Missing light_3 — repeat required');
};
