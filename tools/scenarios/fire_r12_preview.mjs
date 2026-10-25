// r12 shared-fire: isolated procedural flame sheet over black (shape/value check only; not game lighting/post).
export default async api=>{
 for(const [name,time] of [['proc-a',3.0],['proc-b',3.4],['proc-c',7.7]]){
  await api.evalGame(async time=>{
   const THREE=await import('/node_modules/.vite/deps/three.js').catch(()=>null)||window.__THREE;
   const {FirePool}=await import('/src/vfx/fireLib.js');
   const g=window.__KCA.game,gl=g.renderer.webgl;
   const T=window.__fireTHREE||(window.__fireTHREE=g.scene.constructor);
   if(!window.__fp){
    const scene=new g.scene.constructor();
    const pool=new FirePool({capacity:64,name:'preview'});scene.add(pool.mesh);pool.clear();
    const cols=[-6.5,-3.9,-1.3,1.3,3.9,6.5];
    cols.forEach((x,i)=>pool.emit({clip:'blaze',pos:[x,2.3,0],size:[2.0,3.0],loop:true,seed:i*.173+.05,core:.7,radiance:1.25}));
    cols.forEach((x,i)=>pool.emit({clip:'burn',pos:[x,-.6,0],size:[2.1,2.4],loop:true,seed:i*.291+.11,core:.7,radiance:1.25}));
    cols.forEach((x,i)=>{ if(i===0) pool.emit({clip:'ignite',pos:[x,-3.5,0],size:[2.2,2.2],loop:true,seed:.3,core:1.2,radiance:1.6});
     else if(i===5) pool.emit({clip:'glow',pos:[x,-3.5,0],size:[2.2,2.2],loop:true,seed:.3,additive:true});
     else {const o=pool.emit({clip:'burn',pos:[x,-3.6,0],size:[2.0,2.2],loop:true,seed:.41,core:.7,radiance:1.25});o.burnFix=(i-1)*.18;} });
    const cam=new (Object.getPrototypeOf(g.camera).constructor===Object?null:g.camera.constructor)(30,16/9,.1,100);
    cam.position.set(0,0,19);cam.lookAt(0,0,0);
    window.__fp={scene,pool,cam};
   }
   const {scene,pool,cam}=window.__fp;
   pool.time=time;pool.update(0);
   // erosion preview: write burn amount directly
   const A=pool.attributes;pool.items.forEach((o,i)=>{if(o.burnFix!==undefined){A.iLife.setX(i,o.burnFix);A.iLife.needsUpdate=true;}});
   g.renderer.render(0);
   gl.setRenderTarget(null);gl.autoClear=false;gl.setClearColor(0x000000,1);gl.clear();gl.render(scene,cam);
  },time);
  await api.shot(name);
 }
};
