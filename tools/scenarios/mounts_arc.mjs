// Real Fireball path + combat probe: both facings, 6 m shots, max-range misses, short/airborne eligibility.
import fs from 'node:fs';
import path from 'node:path';
export default async api => {
  const result = await api.evalGame(async () => {
    const K=window.__KCA,g=K.game,b=K.showcase.beast(),h=K.showcase.hero;
    const {Fireball}=await import('/src/mounts/breath.js');
    K.debug.god(true);g.bots.detach(h);
    if(b.rider){const old=b.rider;b.dismount({knocked:true,silent:true});if(old!==h)old.remove();}
    b.mount(h,{force:true});
    const rows=[],hits=[],curves=[];
    for(const dir of [1,-1]) {
      for(const foe of K.showcase.foes()) foe.remove();
      const target=await K.showcase.spawnFoe('marauder',0,0,'straw');
      target.brain=null;target.pos.set(h.pos.x+dir*6,0,h.pos.z);target.view.position.copy(target.pos);target.view.updateMatrixWorld(true);
      const f=new Fireball(g,b,{x:h.pos.x,y:1.2,z:h.pos.z,dir,speed:11.5,range:22});
      for(let i=0;i<=120;i++) {
        if(i) f.integrate(f.arcDistance/11.5/120);
        if(i%30===0) rows.push({dir,t:i/120,x:f.pos.x,y:f.pos.y,travel:f.travel,arcDistance:f.arcDistance,arcHeight:f.arcHeight,endY:f.endY,range:f.range,damage:f.hitData.damage});
      }
      curves.push({dir,arcDistance:f.arcDistance,lift:f.arcHeight,endY:f.endY,pass:f.arcHeight>=1&&f.arcDistance<6});f.remove();
      for(const airborne of [false,true]) {
        target.hp=26;target.alive=true;target.invuln=0;target.hitstop=0;target.hurtable=true;target.height=1;
        target.pos.set(h.pos.x+dir*3,airborne?1.3:0,h.pos.z);target.fsm.go('idle');
        const shot=new Fireball(g,b,{x:target.pos.x,y:1.2,z:target.pos.z,dir,speed:11.5,range:22});
        shot.pos.y=2.8;shot.prevPos.copy(shot.pos);const hp=target.hp;shot.update(0);
        hits.push({dir,airborne,hit:shot.removed&&target.hp<hp,hpBefore:hp,hpAfter:target.hp,launchY:shot.launchY,visualY:shot.pos.y});shot.remove();
      }
      target.remove();
      const miss=new Fireball(g,b,{x:h.pos.x,y:1.2,z:h.pos.z,dir,speed:11.5,range:22});
      miss.integrate(22/11.5);curves.push({dir,miss:true,range:miss.range,arcDistance:miss.arcDistance,endY:miss.pos.y,pass:miss.arcDistance===22&&Math.abs(miss.pos.y-1.2)<1e-8});miss.remove();
    }
    const formula=rows.every(r=>Math.abs(r.y-(1.2+(r.endY-1.2)*r.t+4*r.arcHeight*r.t*(1-r.t)))<1e-8&&r.range===22&&r.damage===8);
    return {rows,hits,curves,pass:formula&&curves.every(x=>x.pass)&&hits.every(x=>x.hit),note:'Visual arc fit to first eligible collision plane; authoritative horizontal lane, speed, damage and range retained.'};
  });
  fs.writeFileSync(path.join(api.outDir,'arc.json'),JSON.stringify(result,null,2));api.log(JSON.stringify(result));
  if(!result.pass)throw Error('Cinderwyrm arc/collision contract failed');
};
