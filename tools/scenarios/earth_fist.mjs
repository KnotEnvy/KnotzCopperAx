// Release T4: the reaction subject must be visible at impact, including a lethal hit.
import fs from 'node:fs';
import path from 'node:path';

export default async api => {
  await api.evalGame(() => {
    const K=window.__KCA,g=K.game;K.debug.god(true);K.input.releaseAll();
    for(const h of g.world.query({kind:'hero'})){g.bots.detach(h);h.fsm.go('idle');}
    for(const e of g.world.query({team:'enemies'})){e.brain=null;e.hp=e.maxHp=1000;}
    window.__fistHits=[];window.__fistImpact=null;
    g.bus.on('magic:earthFistImpact',e=>window.__fistImpact=e);
    g.bus.on('hit',e=>{if(e.moveId==='magic_t4')window.__fistHits.push({target:e.target.id,damage:e.damage,killed:e.killed});});
  });
  await api.advance(4000);
  await api.evalGame(() => {
    const K=window.__KCA,g=K.game,h=g.world.query({kind:'hero'})[0];
    g.world.query({team:'enemies'}).forEach((e,i)=>{e.brain=null;e.fsm.go('idle');e.pos.set(h.pos.x+2+i*1.8,0,(i%3-1)*.7);e.vel.set(0,0,0);e.invuln=0;if(i===0)e.hp=1;});
    K.debug.cast(1,4);
  });
  const frames=[];let best=0,revealScore=0,readback=null;
  for(let i=0;i<150;i++) {
    await api.frames(1,33,'fist');
    const row=await api.evalGame(() => {
      const g=window.__KCA.game,c=g.magic.cutIn,a=c.active,impact=window.__fistImpact;
      const m=g.vfx.group.children.find(m=>m.name==='magic_fist');let score=0,topY=null;
      if(m?.visible)for(let j=0;j<m.count;j++){
        const x=m.instanceMatrix.array[j*16+13];score+=1/(1+Math.abs(x));
        if(!m.geometry.boundingBox)m.geometry.computeBoundingBox();
        const matrix=m.matrixWorld.clone().fromArray(m.instanceMatrix.array,j*16).premultiply(m.matrixWorld);
        const top=m.geometry.boundingBox.clone().applyMatrix4(matrix).max.y;
        topY=topY===null?top:Math.max(topY,top);
      }
      return {tick:g.tick,impact,score,topY,inset:!!a&&c.mesh.visible,fullyOpen:c.material.uniforms.uA.value>=.99,
        snapshot:!!a?.snapshot,removed:!!a?.target?.removed,trauma:g.cameraRig.trauma,exposure:g.renderer.exposureMul};
    });
    frames.push(row);
    if(row.impact&&row.tick<=row.impact.tick+8&&row.score>best){best=row.score;await api.shot('L4_peak');}
    if(!readback&&row.impact&&row.inset) {
      await api.shot('L4_impact');
      readback=await api.evalGame(() => {
        const g=window.__KCA.game,c=g.magic.cutIn,r=g.renderer.webgl,p=new Uint16Array(c.rt.width*c.rt.height*4);
        r.readRenderTargetPixels(c.rt,0,0,c.rt.width,c.rt.height,p);
        const colors=new Set();
        for(let y=50;y<242;y+=2)for(let x=300;x<724;x+=2){const i=(y*c.rt.width+x)*4;colors.add(p[i]+','+p[i+1]+','+p[i+2]);}
        return {centralDistinctColors:colors.size,pass:colors.size>128};
      });
    }
    if(!row.impact&&row.score>revealScore){revealScore=row.score;await api.shot('L4_reveal');}
  }
  const reveal=frames.map((f,i)=>({f,i})).filter(({f})=>!f.impact&&f.score>0).sort((a,b)=>Math.abs(a.f.score-1/3.8)-Math.abs(b.f.score-1/3.8))[0];
  if(reveal)fs.copyFileSync(path.join(api.outDir,'fist_'+String(reveal.i).padStart(4,'0')+'.png'),path.join(api.outDir,'L4_reveal.png'));
  const result=await api.evalGame(()=>({hits:window.__fistHits,errors:window.__KCA.info().errors}));
  const totals={};for(const h of result.hits)totals[h.target]=(totals[h.target]||0)+h.damage;
  const first=frames.find(f=>f.impact&&f.inset);
  result.frames=frames;result.readback=readback;result.totals=totals;
  const last=frames.filter(f=>f.score>0).at(-1);
  result.sink={lastTick:last?.tick,lastTopY:last?.topY,pass:Number.isFinite(last?.topY)&&last.topY<=.05};
  result.pass=!!first?.fullyOpen&&!!first?.snapshot&&!!readback?.pass&&result.sink.pass&&Object.keys(totals).length>0&&Object.values(totals).every(v=>v===24)&&!result.errors.length;
  fs.writeFileSync(path.join(api.outDir,'fist.json'),JSON.stringify(result,null,2));
  if(!result.pass)throw new Error('T4 reaction/24 damage check failed '+JSON.stringify({...result,frames:undefined}));
};
