import fs from 'node:fs';import path from 'node:path';
export default async api=>{
 await api.evalGame(()=>{document.querySelectorAll('.kca-card').forEach(e=>e.style.display='none');});
 await api.shot('roof-game');
 const data=await api.evalGame(()=>{
  const g=window.__KCA.game,result=[];
  g.scene.traverse(o=>{
   if(o.name!=='s1AuthoredFire')return;
   const n=o.geometry.instanceCount,A=o.geometry.attributes;window.__roofPool=o;window.__roofAlpha=[];
   for(let i=0;i<n;i++)if(A.iFrame.getW(i)===2){
    const p=g.camera.position.clone().set(A.iPosition.getX(i),A.iPosition.getY(i),A.iPosition.getZ(i));
    const q=p.clone().project(g.camera);result.push({pos:p.toArray(),screen:[(q.x+1)*800,(1-q.y)*450],size:[A.iFrame.getX(i),A.iFrame.getY(i)]});
    window.__roofAlpha.push([i,A.iTint.getW(i)]);A.iTint.setW(i,0);
   }
   A.iTint.needsUpdate=true;
  });
  g.renderer.render(0);return {smoke:result,errors:window.__KCA.info().errors};
 });
 await api.shot('roof-smoke-off');
 await api.evalGame(()=>{const A=window.__roofPool.geometry.attributes;for(const [i,a]of window.__roofAlpha)A.iTint.setW(i,a);A.iTint.needsUpdate=true;window.__KCA.game.renderer.render(0);});
 await api.shot('roof-smoke-on');
 fs.writeFileSync(path.join(api.outDir,'roof-smoke.json'),JSON.stringify(data,null,2));
};
