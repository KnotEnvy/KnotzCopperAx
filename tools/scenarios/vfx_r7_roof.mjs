// Inspect the existing Stage 1 fire API at its consumer-owned anchors; no scene edits.
import fs from 'node:fs';import path from 'node:path';
export default async api=>{
 await api.evalGame(()=>{document.querySelectorAll('.kca-card').forEach(e=>e.style.display='none');});
 await api.shot('roof-game');
 const report=await api.evalGame(()=>{const g=window.__KCA.game,pools=[];g.scene.traverse(o=>{if(o.name==='s1AuthoredFire')pools.push({name:o.name,instances:o.geometry.instanceCount,attributes:{frame:Array.from(o.geometry.attributes.iFrame.array.slice(0,o.geometry.instanceCount*4)),position:Array.from(o.geometry.attributes.iPosition.array.slice(0,o.geometry.instanceCount*4))}});});return {pools,errors:window.__KCA.info().errors};});
 fs.writeFileSync(path.join(api.outDir,'roof-api.json'),JSON.stringify(report,null,2));
};
