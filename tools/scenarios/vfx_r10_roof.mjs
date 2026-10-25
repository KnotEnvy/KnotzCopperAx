// Real stage-1 game camera, existing roof anchors/props, full 48-frame fire loop.
import fs from 'node:fs';import path from 'node:path';
import roof from './vfx_r8_roof.mjs';
export default async api=>{
 await roof(api);
 const samples=[];
 for(let i=0;i<48;i++){
  if(i)await api.advance(33);
  await api.frames(1,0,'roof');
  samples.push(await api.evalGame(ms=>{const g=window.__KCA.game,A=window.__roofPool.geometry.attributes,n=window.__roofPool.geometry.instanceCount;
   return {ms,instances:n,layers:Array.from({length:n},(_,i)=>({row:A.iFrame.getW(i),pos:[A.iPosition.getX(i),A.iPosition.getY(i),A.iPosition.getZ(i)],size:[A.iFrame.getX(i),A.iFrame.getY(i)],frame:A.iFrame.getZ(i),alpha:A.iTint.getW(i)})),errors:window.__KCA.info().errors};},i*33));
 }
 fs.writeFileSync(path.join(api.outDir,'roof-timing.json'),JSON.stringify(samples,null,2));
};
