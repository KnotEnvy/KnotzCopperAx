// Paired same-frame glint isolation: normal image, reflection-off image and depth-tested
// blade masks. Keeps lighting/body shading/pose constant; no clock advancement between images.
import fs from 'node:fs';
import path from 'node:path';
import metal from './weapon_read_metal.mjs';
export async function glintSwitch(api, enabled) {
 return api.evalGame(enabled => {
  const seen=new Set();
  for(const h of __KCA.game.world.query({kind:'hero'}))for(const w of [h.model?.weapon,h.model?.weaponL])w?.traverse(o=>{
   if(!o.isMesh)return;
   for(const m of Array.isArray(o.material)?o.material:[o.material]){
    if(seen.has(m))continue;seen.add(m);
    const u=m.userData.kcaWeaponGlintU;
    if(u)u.value.x=enabled?(m.userData.kcaWeaponGlint?.[0]||0):0;
   }
  });
 },enabled);
}
export default async api => {
 const signature=()=>api.evalGame(()=>JSON.stringify({tick:__KCA.game.tick,camera:__KCA.game.camera.matrixWorld.elements,
  weapons:__KCA.game.world.query({kind:'hero'}).flatMap(h=>[h.model?.weapon,h.model?.weaponL].filter(Boolean).map(w=>{w.updateWorldMatrix(true,true);return w.matrixWorld.elements.slice();}))}));
 const facing=[];
 const grab=async opts=>{
  const result=await api.page.screenshot(opts);
  if(!/frame_\d+\.png$/.test(opts.path))return result;
  const before=await signature();
  facing.push(await api.evalGame(()=>{
   const g=__KCA.game,V=g.camera.position.constructor,cam=g.camera;
   return g.world.query({kind:'hero'}).flatMap(h=>[h.model?.weapon,h.model?.weaponL].filter(Boolean).map(w=>{
    let mesh;w.traverse(o=>{if(o.isMesh)mesh=o;});if(!mesh)return null;
    mesh.updateWorldMatrix(true,false);const mat=mesh.matrixWorld,e=mat.elements,axe=!!w.getObjectByName('bit_edge');
    const n=new V().setFromMatrixColumn(mat,axe?0:2).normalize(),v=cam.position.clone().sub(new V().setFromMatrixPosition(mat)).normalize();
    return {hero:h.def.id,weapon:w.name,flatView:Math.abs(n.dot(v)),shape:mesh.material.userData.kcaWeaponShape};
   }));
  }));
  try {
   await glintSwitch(api,false);await api.evalGame(()=>__KCA.game.renderer.render(0));
   await api.page.screenshot({...opts,path:opts.path.replace('frame_','off_')});
  } finally {await glintSwitch(api,true);await api.evalGame(()=>__KCA.game.renderer.render(0));}
  if(before!==await signature())throw new Error("Reflection pair moved weapon/camera/tick: "+opts.path);
  return result;
 };
 const page=new Proxy(api.page,{get(t,k){return k==='screenshot'?grab:typeof t[k]==='function'?t[k].bind(t):t[k];}});
 await metal({...api,page});
 fs.writeFileSync(path.join(api.outDir,'reflection-facing.json'),JSON.stringify(facing,null,2));
 fs.writeFileSync(path.join(api.outDir,'reflection-method.json'),JSON.stringify({method:'same-frame glint uniform off/on; renderer-only redraw; weapon/camera matrices and tick asserted identical; unchanged body response; depth-tested blade masks',clockStepMs:Number(process.env.LHH_STEP||33)},null,2));
};
