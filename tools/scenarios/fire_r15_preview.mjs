// r15 shared-fire (copy of fire_r14_preview, DOM overlays hidden): isolated procedural flames over a black card IN FRONT OF THE GAME CAMERA, rendered through the
// real post chain (AgX tonemap, grade, bloom) - the value/saturation check r13's raw preview could not show.
// Row 1 blaze seeds, row 2 burn sheets, row 3 ignite at age 0/33/66 ms + burn-away .2/.4 + roof glow.
export default async api=>{
 await api.page.evaluate(()=>{for(const e of document.body.querySelectorAll('body > *:not(canvas)')) if(!e.querySelector('canvas')) e.style.visibility='hidden';});
 for(const [name,time] of [['proc-a',3.0],['proc-b',3.2],['proc-c',7.7]]){
  await api.evalGame(async time=>{
   const {FirePool}=await import('/src/vfx/fireLib.js');
   const g=window.__KCA.game, cam=g.camera;
   if(!window.__fp){
    const D=14, half=D*Math.tan(cam.fov*Math.PI/360), u=half/4.5; // u: 1 unit = 1/9 of the view height
    const fwd=cam.getWorldDirection(cam.position.clone());
    const right=fwd.clone().cross(cam.up).normalize(), up=right.clone().cross(fwd);
    const at=(x,y,dz=0)=>cam.position.clone().addScaledVector(fwd,D+dz).addScaledVector(right,x*u).addScaledVector(up,y*u).toArray();
    // Black backdrop: hide the stage, clear to black; the post chain (AgX/grade/bloom) still runs.
    for(const c of g.scene.children) c.visible=false;
    g.scene.background=null; g.renderer.webgl.setClearColor(0x000000,1);
    const pool=new FirePool({capacity:64,name:'preview'}); pool.mesh.material.depthTest=false; g.scene.add(pool.mesh); pool.clear();
    const cols=[-6.5,-3.9,-1.3,1.3,3.9,6.5];
    cols.forEach((x,i)=>pool.emit({clip:'blaze',pos:at(x,2.5),size:[2.0*u,3.0*u],loop:true,seed:i*.173+.05,core:.7}));
    cols.forEach((x,i)=>pool.emit({clip:'burn',pos:at(x,-.4),size:[2.1*u,2.4*u],loop:true,seed:i*.291+.11,core:.8}));
    cols.forEach((x,i)=>{ const p=at(x,-3.3);
     if(i<3){const o=pool.emit({clip:'ignite',pos:p,size:[2.2*u,2.2*u],loop:true,seed:.3,core:1.1,mirror:1});o.burnFix=.6*i*.33;}
     else if(i===5) pool.emit({clip:'glow',pos:p,size:[2.2*u,2.2*u],loop:true,seed:.3,additive:true,tint:'#ffb070',alpha:.6});
     else {const o=pool.emit({clip:'burn',pos:p,size:[2.0*u,2.2*u],loop:true,seed:.41,core:.8});o.burnFix=(i-2)*.2;} });
    window.__fp={pool};
   }
   const {pool}=window.__fp;
   pool.time=time;pool.update(0);
   const A=pool.attributes;pool.items.forEach((o,i)=>{if(o.burnFix!==undefined){A.iLife.setX(i,o.burnFix);A.iLife.needsUpdate=true;}});
   g.renderer.render(0); g.renderer.render(0);
  },time);
  await api.shot(name);
 }
};
