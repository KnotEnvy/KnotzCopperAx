// Select-set diagnostic: keep the real camera/lights/stand poses, tilt only weapon
// meshes ±18 degrees about local Z through their grip to verify reflection travel (not gameplay animation).
import fs from 'node:fs';
export default async api => {
 const rows=[];
 await api.evalGame(()=>{
  const found=[];for(const h of __KCA.game.world.query({kind:'hero'}))for(const o of [h.model?.weapon,h.model?.weaponL])if(o)found.push({o,z:o.rotation.z});
  if(found.length!==4)throw new Error('select rotation requires four weapon roots, got '+found.length);
  window.__weaponTurn=found;
 });
 for(let i=0;i<12;i++){
  await api.evalGame(i=>{for(const {o,z} of window.__weaponTurn){o.rotation.z=z+(i/11-.5)*Math.PI/5;o.updateMatrix();o.updateMatrixWorld(true);}},i);
  await api.advance(0);rows.push(await api.evalGame(()=>window.__weaponTurn.map(({o})=>({name:o.name,z:o.rotation.z,matrix:o.matrix.elements.slice()}))));await api.shot(`turn_${String(i).padStart(2,'0')}`);
 }
 const count=await api.evalGame(()=>{for(const {o,z} of window.__weaponTurn){o.rotation.z=z;o.updateMatrix();o.updateMatrixWorld(true);}const n=window.__weaponTurn.length;delete window.__weaponTurn;return n;});
 if(rows[0].some((r,i)=>JSON.stringify(r.matrix)===JSON.stringify(rows.at(-1)[i].matrix)))throw new Error('weapon root matrix did not rotate');
 fs.writeFileSync(api.outDir+'/rotation.json',JSON.stringify(rows,null,2));
 api.log(`diagnostic rotation: ${count} weapon meshes, local-Z tilt -18 to +18 degrees`);
};
