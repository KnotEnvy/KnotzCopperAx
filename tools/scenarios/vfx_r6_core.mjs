// Exact real-input contact. Sample the linear HDR render-pass input, then matched-pose light A/B.
import fs from 'node:fs';
import path from 'node:path';
export default async api => {
  await api.evalGame(async () => {
    const k=window.__KCA,g=k.game;
    while(g.world.query({team:'enemies'}).length<4) await k.debug.spawn('marauder',12,0,{tier:'rust'});
    const heroes=g.world.query({kind:'hero'}),h=heroes[0];
    h.pos.set(8.2,0,.6); h.prevPos.copy(h.pos); h.vel.set(0,0,0); h.facing=1; h.godMode=true; h.pots=0;
    for(const other of heroes.slice(1)){other.pos.set(12,0,-1.6);other.prevPos.copy(other.pos);other.godMode=true;other.pots=0;g.bots.attach(other,{skill:.8});}
    const positions=[[9.95,.6],[11,1.5],[12,-1.6],[7,-1.3]];
    g.world.query({team:'enemies'}).forEach((e,i)=>{e.pos.set(positions[i%4][0],0,positions[i%4][1]);e.prevPos.copy(e.pos);e.vel.set(0,0,0);e.hp=e.maxHp=999;e.fsm.go('idle');});
    const project=p=>{const v=g.camera.position.clone().set(p.x,p.y,p.z).project(g.camera);return [(v.x+1)*800,(1-v.y)*450];};
    window.__r6={hits:[],probes:[],hdr:[],project};
    g.vfx.contactProbe=({target,moveId,point,flash,kind})=>{
      const p=project(flash),boxes=target?.hurtboxes?.()||[];
      const corners=boxes.flatMap(b=>[b.minX,b.maxX].flatMap(x=>[b.minY,b.maxY].flatMap(y=>[b.minZ,b.maxZ].map(z=>project({x,y,z})))));
      const bounds={minX:Math.min(...corners.map(p=>p[0])),maxX:Math.max(...corners.map(p=>p[0])),minY:Math.min(...corners.map(p=>p[1])),maxY:Math.max(...corners.map(p=>p[1]))};
      window.__r6.probes.push({moveId,kind,point,flash,screen:p,bounds,distance:Math.hypot(Math.max(0,bounds.minX-p[0],p[0]-bounds.maxX),Math.max(0,bounds.minY-p[1],p[1]-bounds.maxY))});
    };
    g.bus.on('hit',e=>{window.__r6.hits.push({tick:g.tick,moveId:e.moveId,attacker:e.attacker?.typeId,hp:e.target.hp,live:g.world.query({team:'enemies'}).length,brains:g.world.query({team:'enemies'}).filter(a=>a.brain).length});window.__r6.target=e.target;});
    const rp=g.renderer.post.renderPass,orig=rp.render.bind(rp);
    const half=h=>{const e=(h>>10)&31,m=h&1023;return (h&32768?-1:1)*(e===0?m*2**-24:(1+m/1024)*2**(e-15));};
    rp.render=function(renderer,input,...args){
      const result=orig(renderer,input,...args),s=window.__r6;
      if(!s.want||!s.probes.length)return result;
      s.want=false;
      const [sx,sy]=s.project(s.probes[0].flash),cx=Math.round(sx*input.width/1600),cy=input.height-1-Math.round(sy*input.height/900),radius=5;
      const buffer=new Uint16Array((radius*2+1)**2*4);
      renderer.readRenderTargetPixels(input,cx-radius,cy-radius,radius*2+1,radius*2+1,buffer);
      const pixels=Array.from({length:buffer.length/4},(_,i)=>Array.from(buffer.slice(i*4,i*4+3),half));
      const center=pixels[(pixels.length-1)/2],lumas=pixels.map(p=>p[0]*.2126+p[1]*.7152+p[2]*.0722),post=g.renderer.post;
      s.hdr.push({label:s.label,screen:[sx,sy],rgb:center,linearLuma:center[0]*.2126+center[1]*.7152+center[2]*.0722,roiMaxLuma:Math.max(...lumas),aboveThreshold:lumas.filter(v=>v*post.exposure>post.bloom.luminanceMaterial.threshold).length,exposure:post.exposure,threshold:post.bloom.luminanceMaterial.threshold});
      return result;
    };
    g.cameraRig.snap();
  });
  await api.advance(66);await api.press(1,process.env.R6_MOVE||'light',50);
  for(let i=0;i<80;i++){await api.advance(1000/60);if(await api.evalGame(()=>window.__r6.hits.some(h=>h.attacker==='brann')))break;}
  if(!await api.evalGame(()=>window.__r6.hits.some(h=>h.attacker==='brann')))throw Error('No actual contact');
  for(let i=0;i<5;i++){
    if(i)await api.advance(33);
    await api.evalGame(label=>{const s=window.__r6;s.label=label;s.want=true;window.__KCA.game.renderer.render(0);},`${i*33}ms`);
    await api.shot(`contact-${String(i*33).padStart(3,'0')}ms`);
    if(i===0){
      await api.evalGame(()=>{const g=window.__KCA.game,s=window.__r6;s.lightValues=g.vfx.lights.map(x=>x.light.intensity);s.lights=g.vfx.lights.map(x=>({intensity:x.light.intensity,pos:x.light.position.toArray(),distance:x.light.distance,life:x.life}));
        const h=g.world.query({kind:'hero'})[0],t=s.target;s.bodyScreen=s.project({x:t.pos.x,y:t.pos.y+t.height*.60,z:t.pos.z+.25});
        const hand=h.model?.sockets?.R;s.armScreen=hand?s.project(hand.getWorldPosition(g.camera.position.clone())):s.project({x:h.pos.x+.4,y:1.3,z:h.pos.z});
        for(const x of g.vfx.lights)x.light.intensity=0;g.renderer.render(0);});
      await api.shot('contact-light-off');
      await api.evalGame(()=>{const g=window.__KCA.game;g.vfx.lights.forEach((x,i)=>x.light.intensity=window.__r6.lightValues[i]);g.renderer.render(0);});
      await api.shot('contact-light-on');
    }
  }
  const data=await api.evalGame(()=>{
    const s=window.__r6,g=window.__KCA.game,m=g.vfx.fire.mesh.material;
    return {hits:s.hits,probes:s.probes,hdr:s.hdr,lights:s.lights,bodyScreen:s.bodyScreen,armScreen:s.armScreen,lightAt132:g.vfx.lights.map(x=>x.light.intensity),pipeline:{blend:m.blending,premultiplied:m.premultipliedAlpha,toneMapped:m.toneMapped,depthTest:m.depthTest,depthWrite:m.depthWrite,fog:m.fog,fireOrder:g.vfx.fire.mesh.renderOrder,bladeOrder:g.vfx.trails.mesh.renderOrder},errors:window.__KCA.info().errors};
  });
  fs.writeFileSync(path.join(api.outDir,'core-probe.json'),JSON.stringify(data,null,2));api.log(data);
};
