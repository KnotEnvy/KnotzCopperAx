// Actual title→select, a stand frame and both-READY frame. Crop from posed
// screen bounds so UI camera revisions cannot silently cut off the hero.
import fs from 'node:fs';
import sharp from 'sharp';
export default async api=>{
 const E=(fn,arg)=>api.evalGame(fn,arg);
 const press=async(p,a,wait=250)=>{await api.press(p,a,60);await api.advance(wait);};
 const until=async fn=>{for(let i=0;i<120;i++){if(await fn())return;await api.advance(250);}throw new Error('Select did not become ready');};
 const settle=()=>api.page.evaluate(async()=>{
  const finite=()=>document.getAnimations().filter(a=>a.effect&&a.effect.getComputedTiming().iterations!==Infinity&&a.playState==='running');
  for(let i=0;i<40&&finite().length;i++)await Promise.all(finite().map(a=>a.finished.catch(()=>{})));
  await new Promise(r=>setTimeout(r,120));
 });
 await api.advance(800);await press(1,'start',600);await press(1,'light',400);
 await until(()=>E(()=>window.__KCA.game.flow.state==='select'&&window.__KCA.game.world.query({kind:'hero'}).length===3));
 await api.advance(1500);
 const probes=[];
 async function take(name){
  await settle();
  const proof=await E(()=>{
   const g=window.__KCA.game,h=g.world.query({kind:'hero'}).find(h=>h.def.id==='brann');
   if(!h)throw new Error('Brann missing from select');
   const bad=[],v=h.pos.clone();let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
   h.modelRoot.traverse(o=>{
    if(!o.matrixWorld.elements.every(Number.isFinite))bad.push(o.name);
    if(o.isSkinnedMesh&&!Array.from(o.skeleton.boneMatrices).every(Number.isFinite))bad.push(o.name+':boneMatrices');
    if(!o.isMesh)return;
    for(let i=0;i<o.geometry.attributes.position.count;i+=2){
     o.getVertexPosition(i,v).applyMatrix4(o.matrixWorld).project(g.camera);
     if(![v.x,v.y,v.z].every(Number.isFinite)){bad.push(o.name+':vertex');break;}
     if(v.z<-1||v.z>1)continue;
     const x=(v.x+1)*.5*innerWidth,y=(1-v.y)*.5*innerHeight;
     minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
    }
   });
   const left=Math.max(0,Math.floor(minX)-12),top=Math.max(0,Math.floor(minY)-12);
   return {flow:g.flow.state,source:h.model.source,clip:h.animator?.name,bad,box:{left,top,width:Math.min(innerWidth-left,Math.ceil(maxX)-left+12),height:Math.min(innerHeight-top,Math.ceil(maxY)-top+12)},camera:{position:g.camera.position.toArray(),fov:g.camera.fov}};
  });
  if(name==='select_both_ready'&&proof.clip!=='victory')throw new Error('READY lost Brann presentation clip: '+proof.clip);
  if(proof.bad.length||!Number.isFinite(proof.box.width)||proof.box.width<=0)throw new Error('Nonfinite select hero');
  await api.shot(name);
  await sharp(`${api.outDir}/${name}.png`).extract(proof.box).resize(proof.box.width*2,proof.box.height*2,{kernel:'nearest'}).png().toFile(`${api.outDir}/${name}_2x.png`);
  probes.push({name,...proof});
 }
 await take('select_stand');
 await press(2,'start',300);await press(2,'left',300); // default P2 Gorrim→Brann
 await press(1,'light',700);await press(2,'light',60);
 await take('select_both_ready');
 fs.writeFileSync(`${api.outDir}/select_proof.json`,JSON.stringify(probes,null,2));
};
