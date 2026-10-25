import fs from 'node:fs';import path from 'node:path';
import roof from './vfx_r10_roof.mjs';
export default async api=>{
 await api.evalGame(()=>document.querySelectorAll('.kca-hud').forEach(e=>e.style.display='none'));
 await roof(api);
 const data=await api.evalGame(()=>{const g=window.__KCA.game,roof=g.scene.getObjectByName('s1RoofFuel'),pool=window.__roofPool,A=pool.geometry.attributes;
  return {fuel:roof?{triangles:roof.geometry.attributes.position.count/3,patches:roof.userData.firePatches,sharedMaterial:roof.material===pool.material}:null,
   billboardCoalCards:Array.from({length:pool.geometry.instanceCount},(_,i)=>A.iExtra.getY(i)).filter(v=>v>1.5).length,
   instances:pool.geometry.instanceCount,errors:window.__KCA.info().errors};});
 if(!data.fuel?.sharedMaterial||data.billboardCoalCards)throw Error('Roof fuel must be conformed geometry in the shared material, without coal cards');
 fs.writeFileSync(path.join(api.outDir,'roof-seating.json'),JSON.stringify(data,null,2));
};
