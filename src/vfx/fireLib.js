// Shared authored flipbooks: one atlas, one premultiplied material, one instanced draw per pool.
import * as THREE from 'three';

export const FIRE_CLIPS = Object.freeze({ flame: 0, fireBurst: 1, smoke: 2, embers: 3, slash: 4, blunt: 5, knockdown: 6, storm: 7 });
let atlas, ready;
export function preloadFireLibrary() {
  if (!ready) {
    ready = new Promise((resolve, reject) => {
      atlas = new THREE.TextureLoader().load('/assets/vfx/fire-hit-atlas.png', resolve, undefined, reject);
    });
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.generateMipmaps = true; // padded cells + bounded gradients keep mip footprints inside each clip
    atlas.wrapS = atlas.wrapT = THREE.ClampToEdgeWrapping;
    atlas.minFilter = THREE.LinearMipmapLinearFilter; atlas.magFilter = THREE.LinearFilter;
  }
  return ready;
}

const VERT = /* glsl */`
attribute vec4 iPosition; // centre xyz, rotation
attribute vec4 iFrame; // width, height, frame, row
attribute vec4 iTint; // linear tint, opacity
attribute vec4 iLife; // erosion, HDR hot core, ground fade, floor y
attribute vec4 iExtra; // additive, rooted base, radiance ceiling, mirror sign + silhouette skew
varying vec4 vExtra;
varying vec2 vUv; varying vec4 vFrame; varying vec4 vTint; varying vec4 vLife;
varying float vY; varying float vDepth;
void main() {
  vUv=vec2(iExtra.w<0. ? 1.-uv.x : uv.x,uv.y); vFrame=iFrame; vTint=iTint; vLife=iLife; vExtra=iExtra;
  vec4 p=modelViewMatrix*vec4(iPosition.xyz,1.);
  float c=cos(iPosition.w),s=sin(iPosition.w);
  vec2 q=position.xy*iFrame.xy;
  q.x+=q.y*(abs(iExtra.w)-1.);
  vec2 rotated=vec2(c*q.x-s*q.y,s*q.x+c*q.y);
  p.xy+=rotated;
  // Camera up/right transformed to world: analytical soft ground intersection, no extra pass.
  vY=iPosition.y+viewMatrix[1][1]*rotated.y+viewMatrix[1][0]*rotated.x;
  vDepth=-p.z;
  gl_Position=projectionMatrix*p;
}`;
const FRAG = /* glsl */`
uniform sampler2D uAtlas; uniform sampler2D uDepth;
uniform vec4 uDepthInfo; // enabled, camera near, far, softness metres
uniform vec2 uViewport;
uniform float uFade;
varying vec4 vExtra;
varying vec2 vUv; varying vec4 vFrame; varying vec4 vTint; varying vec4 vLife;
varying float vY; varying float vDepth;
float eyeDepth(float z) { return uDepthInfo.y*uDepthInfo.z/(uDepthInfo.z-z*(uDepthInfo.z-uDepthInfo.y)); }
vec4 frame(float f) {
  // Smooth transparent padding + RGB bleed; clamp to texel centres inside this cell.
  // Bound to mip 3: the eight-pixel gutter remains at least one texel wide.
  vec2 p=vec2(mod(f,8.),7.-vFrame.w)+clamp(vUv,vec2(.5/256.),vec2(255.5/256.));
  vec2 dx=dFdx(vUv)/8.,dy=dFdy(vUv)/8.;
  float footprint=max(length(dx),length(dy))*2048.;
  float limit=min(1.,8./max(footprint,.001));
  return textureGrad(uAtlas,p/8.,dx*limit,dy*limit);
}
void main() {
  float f=floor(vFrame.z), k=fract(vFrame.z);
  vec4 a=frame(f), b=frame(mod(f+1.,8.));
  // Interpolate premultiplied samples: transparent texels cannot introduce dark seams.
  vec4 tex=mix(vec4(a.rgb*a.a,a.a),vec4(b.rgb*b.a,b.a),k);
  float alpha=tex.a;
  vec3 color=tex.rgb/max(alpha,.0001);
  float erode=smoothstep(vLife.x,vLife.x+.09,alpha);
  float visibility=vTint.a*uFade;
  if(vLife.z>0.) visibility*=smoothstep(vLife.w,vLife.w+vLife.z,vY);
  if(uDepthInfo.x>.5) visibility*=clamp((eyeDepth(texture2D(uDepth,gl_FragCoord.xy/uViewport).r)-vDepth)/uDepthInfo.w,0.,1.);
  alpha*=erode*visibility;
  // Continuous premultiplied falloff; no alpha-test contour on impact silhouettes.
  float hot=smoothstep(.55,.92,min(color.r,min(color.g,color.b)));
  // Preserve near-white thermal roots; tint belongs to cool paint, not the hot core.
  color*=mix(vTint.rgb,vec3(1.),hot);
  // Impact paint must retain its orange/yellow structure through the scene bloom threshold.
  // Per-instance ceiling: ambient fire/embers retain their established HDR range.
  if(vExtra.z>0.) color*=min(1.,vExtra.z/max(.0001,max(color.r,max(color.g,color.b))));
  // Cap painted orange structure BEFORE emission. Capping after this term turned the
  // white contact into .95 linear grey below the stage's 1.7 bloom threshold.
  // Only the authored ivory kernel receives HDR; its lifetime is bounded on the CPU.
  color*=1.+hot*vLife.y;
  // Rooted roof flames emerge from a dark brown/red combustion bed in the thatch.
  float root=min(1.,vExtra.y)*(1.-smoothstep(.12,.44,vUv.y));
  color=mix(color,vec3(.035,.006,.001)+color*vec3(.15,.025,.006),root);
  alpha*=mix(1.,smoothstep(.025,.075,vUv.y),min(1.,vExtra.y));
  if(vExtra.y>1.5) {
    // Short ragged fuel patch, not a border around the aperture. Its centre sits
    // on the consumer's exact edge floor; isolated bright fissures cross dark char.
    float n=sin(vUv.x*43.+sin(vUv.y*29.)*2.1)*sin(vUv.x*71.-vUv.y*37.);
    float bed=(1.-smoothstep(.31,.49,abs(vUv.x-.5)+n*.025))
      *smoothstep(.06,.20,vUv.y)*(1.-smoothstep(.48,.66,vUv.y+n*.035));
    float coal=smoothstep(.64,.94,n)*(.58+.42*sin(vFrame.z*.8+vUv.x*17.));
    vec3 fuel=vec3(.027,.004,.001)+vec3(2.8,.48,.012)*coal;
    float cover=bed*.88*visibility;
    color=(color*alpha+fuel*cover*(1.-alpha))/max(.0001,alpha+cover*(1.-alpha));
    alpha+=cover*(1.-alpha);
  }
  // Invisible padded texels need not shade/blend. Threshold is below one alpha byte;
  // the visible premultiplied edge remains continuous (no opaque silhouette cutout).
  if(alpha < .002) discard;
  // One material/draw: zero destination attenuation for hot arcs/fire, normal alpha for smoke.
  gl_FragColor=vec4(color*alpha,alpha*(1.-vExtra.x));
}`;

export class FirePool {
  constructor({ capacity = 96, fade = { value: 1 }, name = 'authored_fire' } = {}) {
    preloadFireLibrary();
    this.capacity = capacity; this.items = [];
    const geo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
    this.attributes = {};
    for (const key of ['iPosition', 'iFrame', 'iTint', 'iLife', 'iExtra']) {
      const attr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(key, attr); this.attributes[key] = attr;
    }
    geo.instanceCount = 0;
    const material = new THREE.ShaderMaterial({ name: 'shared_fire_flipbook', vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uAtlas: { value: atlas }, uFade: fade, uDepth: { value: null }, uDepthInfo: { value: new THREE.Vector4(0,.1,100,.2) }, uViewport: { value: new THREE.Vector2(1600,900) } },
      transparent: true, depthWrite: false, premultipliedAlpha: true, blending: THREE.NormalBlending, toneMapped: false,
    });
    this.mesh = new THREE.Mesh(geo, material); this.mesh.name = name; this.mesh.frustumCulled = false; this.mesh.renderOrder = 7;
    this.mesh.onBeforeRender = r => material.uniforms.uViewport.value.set(r.domElement.width,r.domElement.height);
    // Compile during normal stage warmup even when no hits have happened.
    this.emit({ clip: 'embers', pos: [0,-100,0], size: [0,0], loop: true });
  }
  /** Optional PREVIOUS/opaque depth texture (never the active draw target). No render pass is created. */
  setDepth(texture, camera, softness = .2) {
    const u=this.mesh.material.uniforms;
    u.uDepth.value=texture;
    if (!texture) { u.uDepthInfo.value.x=0; return; }
    u.uDepthInfo.value.set(1,camera.near,camera.far,Math.max(.001,softness));
  }
  /** Root is a real frayed straw-edge anchor; no interpolation across an empty roof hole.
   *  The short, wide combustion layer follows that edge below an unequal climbing tongue.
   *  Both layers use the existing draw/atlas. Returns handles for consumer teardown/tuning.
   */
  emitRoofEdge({ pos = [0,0,0], height = 1.4, width = height*.6, phase = 0, life = .9,
    tint = '#ffc078', alpha = .9 } = {}) {
    const common={clip:'flame',loop:true,rooted:true,spread:false,tint,core:.27,alpha,life,phase,
      floor:pos[1]-.06*height,soft:.16*height};
    const tongue=this.emit({...common,pos:[pos[0],pos[1]+height*.40,pos[2]],size:[width*1.1,height*1.12]});
    const bed=this.emit({...common,emberBed:true,pos:[pos[0],pos[1]+height*.10,pos[2]+.015],
      size:[width*1.7,height*.34],phase:phase+.31,core:.08,alpha:alpha*.85});
    return {bed,tongue};
  }
  /** Coherent impact combustion. Flame centres follow the posed chest through knockback;
   * unequal frame offsets, dimensions and lifetimes avoid repeated floating stamps. */
  emitCombustion({pos=[0,1,0],target=null,scale=1,dir=1}={}) {
    const node=target?.modelRoot?.getObjectByName('chest') || target?.modelRoot;
    let follow=null;
    if(node) {
      const initial=node.getWorldPosition(new THREE.Vector3()), current=new THREE.Vector3();
      follow=()=>node.getWorldPosition(current).sub(initial);
    } else if(target?.pos) {
      const initial=target.pos.clone(),current=new THREE.Vector3();
      follow=()=>current.copy(target.pos).sub(initial);
    }
    const handles=[];
    for(const [x,y,w,h,phase,life,mirror,skew] of [
      [0,0,1.20,1.40,0,.355,dir,-.17],
      [-.24,-.15,.72,.86,.23,.280,-dir,.26],
      [.24,.09,.58,1.02,.44,.310,dir,.12]]) {
      handles.push(this.emit({clip:'fireBurst',pos:[pos[0]+x*dir*scale,pos[1]+y*scale,pos[2]+.025],
        size:[w*scale,h*scale],phase,life,mirror,skew,follow,core:1.8,radiance:1.8,
        erosion:0,rot:dir*(phase-.15)*.34,grow:-.12,growY:.08}));
    }
    this.emit({clip:'smoke',pos:[pos[0],pos[1]+.12,pos[2]-.08],size:[1.45*scale,1.8*scale],
      life:.54,delay:.075,fadeIn:.06,core:0,alpha:.85,vel:[dir*.18,.55,0],grow:.45});
    return handles;
  }
  emit({ clip = 'flame', pos = [0,0,0], size = [1,1], life = .4, loop = false, phase = 0,
    rot = 0, tint = '#ffffff', alpha = 1, core = .65, erosion = .15, vel = [0,0,0], grow = 0, soft = 0, floor = 0, delay = 0, spin = 0, growY = grow,
    additive = false, rooted = false, spread = true, emberBed = false, fadeIn = 0, radiance = 0, mirror = 1, skew = 0, follow = null } = {}) {
    if (!(clip in FIRE_CLIPS)) throw new Error(`Unknown fire clip: ${clip}`);
    if (this.items.length >= this.capacity) return null;
    // Existing roof anchors keep their floor/contact. Fill the burning edge with
    // a wider three-lobe cluster; no interpolation/geometry across the aperture.
    if (rooted && clip==='flame' && !emberBed) {
      size=[size[0]*1.95,size[1]*1.38];
      pos=[pos[0],pos[1]+size[1]*.025,pos[2]];
    }
    if (loop && clip==='smoke') {
      // The tall roof plume must crest the roofline; its lower companion stays in the hole.
      if(size[1]>=4) { pos=[pos[0],pos[1]+size[1]*.22,pos[2]]; size=[size[0],size[1]*1.18]; }
      size=[size[0]*1.38,size[1]]; alpha=Math.min(1,alpha*1.45);
    }
    const c = new THREE.Color(tint);
    if(loop && clip==='smoke') c.lerp(new THREE.Color('#ffffff'),.65);
    const o={ row: FIRE_CLIPS[clip], pos:[...pos], size:[...size], life:Math.max(.001,life), loop, phase:((phase%1)+1)%1, rot,
      tint:[c.r,c.g,c.b], alpha, core, erosion, vel:[...vel], grow, growY, spin, soft, floor, additive, rooted, emberBed, fadeIn, radiance, mirror, follow, origin:follow ? [...pos] : null, skew:Math.max(-.4,Math.min(.4,skew)), age:-delay };
    this.items.push(o);
    // Existing roof consumers already supply the exact frayed edge's floor/anchor.
    // Give each a low combustion bed without requiring stage-source changes.
    // Reserve the climbing tongue first; a full pool drops only the secondary bed.
    if(rooted && spread && clip==='flame' && loop && this.items.length<this.capacity) {
      this.emit({clip:'flame',rooted:true,spread:false,emberBed:true,loop:true,
        pos:[pos[0],floor+size[1]*.14,pos[2]+.015],size:[size[0]*1.6,size[1]*.30],
        life,phase:phase+.31,tint,alpha:alpha*.82,core:.08,soft:soft*.5,floor,radiance});
    }
    this.update(0); return o;
  }
  update(dt) {
    const A=this.attributes; let n=0;
    for(let i=0;i<this.items.length;i++) {
      const o=this.items[i]; o.age+=dt;
      if(!o.loop && o.age>=o.life) { this.items.splice(i--,1); continue; }
      if(o.age<0) continue;
      const t=o.loop ? ((o.age/o.life+o.phase)%1) : Math.min(1,o.age/o.life);
      const impact=o.row===FIRE_CLIPS.slash || o.row===FIRE_CLIPS.blunt;
      const frame=o.loop ? t*8 : impact ? Math.min(3,o.age/.033) : Math.min(6.999,(o.row===FIRE_CLIPS.fireBurst ? o.phase+(1-o.phase)*t : t)*7);
      if(o.follow) {
        const delta=o.follow();
        if(delta) for(let axis=0;axis<3;axis++) o.pos[axis]=o.origin[axis]+delta.getComponent(axis);
      }
      const growth=1+o.grow*t;
      A.iPosition.setXYZW(n,o.pos[0]+o.vel[0]*o.age,o.pos[1]+o.vel[1]*o.age,o.pos[2]+o.vel[2]*o.age,o.rot+o.spin*o.age);
      A.iFrame.setXYZW(n,o.size[0]*growth,o.size[1]*(1+o.growY*t),Math.min(7.999,frame),o.row);
      const onset=o.fadeIn>0 ? Math.min(1,o.age/o.fadeIn) : 1;
      A.iTint.setXYZW(n,o.tint[0],o.tint[1],o.tint[2],o.alpha*onset*(o.loop ? 1 : 1-Math.max(0,(t-.65)/.35)));
      A.iExtra.setXYZW(n,o.additive ? 1 : 0,o.emberBed ? 2 : o.rooted ? 1 : 0,o.radiance,(o.mirror<0 ? -1 : 1)*(1+o.skew));
      const cool=Math.max(0,Math.min(1,(o.age-.030)/.035));
      const heat=impact ? 1-cool*cool*(3-2*cool) : 1;
      A.iLife.setXYZW(n,o.loop ? 0 : o.erosion*t,o.core*heat,o.soft,o.floor); n++;
    }
    this.mesh.geometry.instanceCount=n;
    for(const a of Object.values(A)) a.needsUpdate=true;
  }
  clear() { this.items.length=0; this.mesh.geometry.instanceCount=0; }
  dispose() { this.clear(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
