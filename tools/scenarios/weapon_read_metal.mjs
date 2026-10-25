// Weapon-read probe with depth-tested blade-only pixel masks. QA only, no runtime hook.
// Mask R = local along-blade coordinate; G = across-blade; B = 255 (covered); A = 255.
// The stage's opaque depth is rendered first so body/foe-occluded pixels aren't measured.
import fs from 'node:fs';
import path from 'node:path';
import readProbe from './weapon_read_probe.mjs';
import anchors from './weapon_anchors.mjs';
export default async api => {
  const grab = async opts => {
    const result = await api.page.screenshot(opts);
    if (!/frame_\d+\.png$/.test(opts.path)) return result;
    const masks = await bladeMasks(api);
    const frame=path.basename(opts.path).match(/frame_(\d+)/)[1];
    for(const [hand,data] of Object.entries(masks))fs.writeFileSync(path.join(api.outDir,`mask_${hand}_${frame}.png`),Buffer.from(data,'base64'));
    return result;
  };
  const page=new Proxy(api.page,{get(target,key){return key==='screenshot'?grab:typeof target[key]==='function'?target[key].bind(target):target[key];}});
  await readProbe({...api,page});
  await anchors(api);
};

export async function bladeMasks(api, heroId = null) {
  return api.evalGame(async heroId => {
      const T = await import('/node_modules/three/build/three.module.js');
      const g=__KCA.game, r=g.renderer.webgl, h=g.world.query({kind:'hero'}).find(h=>!heroId||h.def?.id===heroId||h.id===heroId);
      if (!h?.model) return {};
      const width=window.innerWidth,height=window.innerHeight;
      const rt=new T.WebGLRenderTarget(width,height,{minFilter:T.NearestFilter,magFilter:T.NearestFilter});
      const old=r.getRenderTarget(), clr=r.getClearColor(new T.Color()), alpha=r.getClearAlpha(), auto=r.autoClear;
      const shadow=r.shadowMap.autoUpdate; r.shadowMap.autoUpdate=false;
      const out={};
      try {
        for(const hand of ['R','L']){
          const w=hand==='L'?h.model.weaponL:h.model.weapon;if(!w)continue;
          const axe=!!w.getObjectByName('bit_edge');const len=axe ? .819 : (w.getObjectByName('blade_tip')?.position.y || .936);
          const s=new T.Scene();const mats=[];
          w.updateWorldMatrix(true,true);
          w.traverse(o=>{if(!o.isMesh)return;
            const m=new T.ShaderMaterial({vertexShader:`varying vec3 p; void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
              fragmentShader:`varying vec3 p; void main(){if(p.y<${axe?'.38':'.20'})discard;${!axe&&len>1.1?'if(abs(p.x)>.13)discard;':''}gl_FragColor=vec4(p.y/${len},.5+p.${axe?'z':'x'}/.8,1.,1.);}`,
              side:o.material.side,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}); mats.push(m);
            const c=new T.Mesh(o.geometry,m);c.matrixAutoUpdate=false;c.matrix.copy(o.matrixWorld);s.add(c);
          });
          r.setRenderTarget(rt);r.autoClear=true;r.render(g.renderer.scene,g.camera);
          r.autoClear=false;r.setClearColor(0,0);r.clear(true,false,false);r.render(s,g.camera);
          const raw=new Uint8Array(width*height*4);r.readRenderTargetPixels(rt,0,0,width,height,raw);
          const cv=document.createElement('canvas');cv.width=width;cv.height=height;const ctx=cv.getContext('2d');const im=ctx.createImageData(width,height);
          for(let y=0;y<height;y++)im.data.set(raw.subarray(y*width*4,(y+1)*width*4),(height-y-1)*width*4);
          ctx.putImageData(im,0,0);out[hand]=cv.toDataURL('image/png').split(',')[1];mats.forEach(m=>m.dispose());
        }
      } finally {r.setRenderTarget(old);r.setClearColor(clr,alpha);r.autoClear=auto;r.shadowMap.autoUpdate=shadow;rt.dispose();}
      return out;
  }, heroId);
}
