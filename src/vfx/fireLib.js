// Shared authored flipbooks: one atlas, one premultiplied material, one instanced draw per pool.
import * as THREE from 'three';

export const FIRE_CLIPS = Object.freeze({ flame: 0, fireBurst: 1, smoke: 2, embers: 3, slash: 4, blunt: 5, knockdown: 6, storm: 7,
  // r12 procedural combustion (same program): rows >= 8 are evaluated in the shader, the fraction carries a per-instance seed.
  blaze: 8, burn: 9, ignite: 10, glow: 11 });
const PROC = 8;
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
attribute vec4 iSurface; // world surface normal, enabled for roof-conformed fuel patches
attribute vec4 iExtra; // additive, rooted base, radiance ceiling, mirror sign + silhouette skew
uniform float uTime;
varying vec4 vExtra; varying vec3 vProc;
varying vec2 vUv; varying vec4 vFrame; varying vec4 vTint; varying vec4 vLife;
varying float vY; varying float vDepth;
float vHash(vec2 p) { vec3 q=fract(vec3(p.xyx)*.1031); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z); }
float vNoise(float a,float b) {
  vec2 p=vec2(a,b),i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(vHash(i),vHash(i+vec2(1.,0.)),f.x),mix(vHash(i+vec2(0.,1.)),vHash(i+vec2(1.,1.)),f.x),f.y);
}
void main() {
  vUv=vec2(iExtra.w<0. ? 1.-uv.x : uv.x,uv.y); vFrame=iFrame; vTint=iTint; vLife=iLife; vExtra=iExtra;
  // r13 per-instance motion, constant across the card (computed per vertex, not per pixel): slow
  // lateral sway, tongue-split phase, and a licking height pulse so flames grow and drop back
  // instead of holding one stretched ribbon.
  vProc=vec3(0.,0.,1.);
  if(iFrame.w>7.5) {
    float seed=fract(iFrame.w+.001), s=seed*71.3, t=uTime*(1.05+.5*fract(seed*7.31))+seed*23.;
    vProc=vec3(vNoise(s+9.,t*.55)-.5,(vNoise(s*2.,t*.8)-.5)*2.8,
      .70+.24*vNoise(s*1.7,t*1.7)+.10*vNoise(s+4.,t*4.6));
  }
  vec4 p=modelViewMatrix*vec4(iPosition.xyz,1.);
  float c=cos(iPosition.w),s=sin(iPosition.w);
  vec2 q=position.xy*iFrame.xy;
  q.x+=q.y*(abs(iExtra.w)-1.);
  vec2 rotated=vec2(c*q.x-s*q.y,s*q.x+c*q.y);
  p.xy+=rotated;
  // Camera up/right transformed to world: analytical soft ground intersection, no extra pass.
  vY=iPosition.y+viewMatrix[1][1]*rotated.y+viewMatrix[1][0]*rotated.x;
  if(iSurface.w<-.5) {
    // Signed height above the real roof plane: fade the root along the slope,
    // not a camera-horizontal cut. Camera-facing cards otherwise lean through eaves.
    vec3 delta=vec3(dot(vec2(viewMatrix[0][0],viewMatrix[0][1]),rotated),
      dot(vec2(viewMatrix[1][0],viewMatrix[1][1]),rotated),
      dot(vec2(viewMatrix[2][0],viewMatrix[2][1]),rotated));
    vY=vLife.w+dot(iSurface.xyz,delta+vec3(0.,iPosition.y-vLife.w,0.));
  }
  if(iSurface.w>.5) {
    vec3 normal=normalize(iSurface.xyz);
    vec3 right=normalize(cross(normal,vec3(0.,0.,1.)));
    vec3 up=cross(normal,right);
    vec3 world=iPosition.xyz+right*rotated.x+up*rotated.y;
    p=modelViewMatrix*vec4(world,1.);
    vY=world.y;
  }
  if(iSurface.w>1.5) { // Shared-material, mesh-conformed roof fuel vertices.
    p=modelViewMatrix*vec4(position,1.); vY=position.y;
  }
  vDepth=-p.z;
  gl_Position=projectionMatrix*p;
}`;
const FRAG = /* glsl */`
uniform sampler2D uAtlas; uniform sampler2D uDepth;
uniform vec4 uDepthInfo; // enabled, camera near, far, softness metres
uniform vec2 uViewport;
uniform float uFade; uniform float uTime;
varying vec4 vExtra; varying vec3 vProc;
varying vec2 vUv; varying vec4 vFrame; varying vec4 vTint; varying vec4 vLife;
varying float vY; varying float vDepth;
float pHash(vec2 p) { vec3 q=fract(vec3(p.xyx)*.1031); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z); }
float pNoise(vec2 p) {
  vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(pHash(i),pHash(i+vec2(1.,0.)),f.x),mix(pHash(i+vec2(0.,1.)),pHash(i+vec2(1.,1.)),f.x),f.y);
}
float pNoise1(float p) { float i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(pHash(vec2(i,7.)),pHash(vec2(i+1.,7.)),f); }
float band(float v,float edge,float aa) { return smoothstep(edge-aa,edge+aa,v); }
// Procedural combustion (r13 rendering): an envelope eroded by rising, domain-warped multi-octave
// noise. The edge is a soft noise threshold (licking sub-tongues, no outline band), the fill is
// ONE continuous temperature ramp (no posterized steps), transparency holes open and rise through
// the body, hot cores are small discontinuous streaks, and tips tear into separate fragments.
// style 0 blaze (tongue cluster), 1 burn (body sheet), 2 ignite (contact burst), 3 glow.
float pHot, pOcc;
// r14: authored against the AgX post (it turns bright linear orange into peach: .95,.25 -> rgb 208,147,89).
// Saturated colour only exists at low/mid value, so the ramp is a VALUE ladder: transparent dark red tips ->
// red -> burnt orange body -> amber -> a small HDR yellow-white core. hdr scales the top stop (instance core).
vec3 fireRamp(float T,float hdr) {
  vec3 c=mix(vec3(.060,.0015,0.),vec3(.17,.010,0.),smoothstep(.02,.22,T));
  c=mix(c,vec3(.36,.050,0.),smoothstep(.22,.42,T));
  c=mix(c,vec3(.58,.10,0.),smoothstep(.42,.62,T));
  c=mix(c,vec3(1.10,.30,.0),smoothstep(.70,.84,T));
  return mix(c,vec3(1.9,1.25,.40)*hdr,smoothstep(.86,.98,T));
}
vec4 procFire(vec2 uv,float seed,float style,float burn,float px,float core) {
  float s=seed*71.3, t=uTime*(1.05+.5*fract(seed*7.31))+seed*23.;
  float x=uv.x*2.-1., y=uv.y;
  // Sustained flames stay just under the bloom threshold (a bloomed small core read as a light bulb);
  // the ignition passes hdr*1.6 and blooms.
  float hdr=.80+.30*core;
  pHot=0.; pOcc=1.;
  if(style>2.5) { // radiance on thatch/stones: broken warm patches, additive
    vec2 p=vec2(x,y*2.-1.); float r=length(p);
    float n=pNoise(vec2(x*3.1+s,y*4.3-t*.7));
    float g=(1.-smoothstep(.0,1.,r+(n-.5)*.55))*(.55+.45*n);
    g*=g;
    return vec4(vec3(1.,.16,.012)*g,g);
  }
  if(style>1.5) {
    // Ignition (+0 ms contact): a compact white-hot core with many spikes radiating from the contact,
    // biased up and along the hit; the burn-away (age) cools the core first, then retracts the tongues.
    vec2 p=vec2(x,y*2.-1.); float r=length(p)+.0001, a=atan(p.y,p.x);
    vec2 dirn=p/r;
    float wob=pNoise(dirn*1.7+vec2(s,s*.37));
    // r15: a sharp star (9-13 narrow spikes of uneven length round a small white core) instead of 4-6 soft lobes.
    float sp=.5+.5*cos(a*floor(9.+4.*fract(seed*5.3))+s+wob*4.); // integer count: no seam at a=pi
    sp*=sp; sp*=sp;
    float spikes=sp*(.30+.70*pNoise(dirn*2.6+vec2(-s,s)))+.10*wob;
    float bias=1.+.30*p.y/r+.22*p.x/r;
    float n=pNoise(p*3.4+vec2(s,-t*2.5));
    float reach=(.26+.80*spikes)*bias;
    float cool=burn*burn*2.6; // quadratic: still white-hot at +33 ms, cooled and retracting by +66
    float F=1.-r/reach-(n-.5)*.30-cool*.9;
    float T=clamp(F*1.0+.12+(.30-r)*1.2-cool*1.6,0.,1.);
    vec3 c=fireRamp(T,hdr*1.35);
    pOcc=mix(.40,1.,smoothstep(.2,.7,T));
    return vec4(c,smoothstep(0.,max(px*1.,.02),F)*mix(.45,1.,smoothstep(.05,.40,T)));
  }
  bool sheet=style>.5;
  float sh=sheet ? 1. : 0.; // body sheets: more, narrower sub-tongues
  // Height pulse (vertex): the flame licks up and drops back inside its card.
  y/=vProc.z;
  if(y>1.) return vec4(0.);
  // Large slow lick plus a low-frequency domain warp; lateral motion grows with height (S-curves).
  float lean=(fract(seed*3.17)-.5)*.5;
  float bend=(pNoise1(y*1.3-t*1.1+s*3.7)-.5)*1.6*y*y+vProc.x*.5*y+lean*y*y;
  float w1=pNoise(vec2(x*1.6+s,y*2.0-t*2.4));
  // r15: plus a fast hook wiggle. Displacement keeps a tongue's width (subtracting noise thins it to slivers).
  float xw=x+bend+(w1-.5)*.55*(.12+y)+sin(y*8.-t*4.3+x*1.7+s)*.07*y;
  // r15 SHAPE: the card is the union of 2-4 curling sub-tongues standing on one shared hot root mass.
  // The clefts between them run down to ~35 % of the height, each tongue has its own height, curl and lick,
  // and the flanks narrow to pointed tips. F = normalised distance into the nearest tongue (1 = its spine);
  // yr = height relative to that tongue's tip.
  float nT=sheet ? 4. : 3.;
  float dom=floor(fract(seed*4.73)*nT);
  float F=-9., yr=1.;
  for(int i=0;i<4;i++) {
    float fi=float(i);
    if(fi>=nT) break;
    float h=fract(seed*(7.13+fi*3.71)+fi*.37);
    float ht=(fi==dom ? .97 : .48+.36*h)*(.88+.12*sin(t*(2.1+1.3*h)+fi*2.3));
    float off=((fi+.5)/nT*2.-1.)*(.50+.12*sh)+(h-.5)*.16;
    // Roots converge into the shared mass; the curl wave travels up the tongue and grows with height.
    float cx=off*(.32+.68*smoothstep(.05,.55,y))+sin(y*(5.+3.*h)-t*(2.0+.8*h)+fi*1.9)*.16*y;
    float q=min(y/ht,1.);
    float wi=(.42-.07*sh)*(1.-.16*h)*pow(1.-q,.6)*(1.-.3*q)+.0001;
    float fi2=1.-abs(xw-cx)/wi;
    if(fi2>F) { F=fi2; yr=y/ht; }
  }
  // Shared root mass: wide and hot at the fuel, narrowing to nothing by ~1/3 of the height.
  float rootH=.34-.04*sh;
  float rm=1.-abs(xw)/((.70+.06*sh)*pow(max(0.,1.-y/rootH),.7)+.0001);
  float hk=max(.35-abs(F-rm),0.);
  F=max(F,rm)+hk*hk*.7; // smooth union: a fillet where a tongue leaves the mass, not a seam
  // Outside the reach of the erosion noise nothing can burn: skip the remaining work (perf).
  if(F<-.45) return vec4(0.);
  // Moderate rag sized for the GAME camera: big rising lobes + one ridged medium octave for notches.
  float k=clamp(vFrame.y*.40,.85,1.35);
  float n1=pNoise(vec2(xw*1.9*k+s*3.,y*2.3*k-t*2.5));
  float n2=pNoise(vec2(xw*4.3*k-s,y*4.4*k-t*3.9));
  float ridge=1.-abs(n2*2.-1.);
  F+=(n1-.5)*mix(.22,.38,y)+(ridge-.55)*mix(.14,.30,y)-.04*y;
  // Burn-away dies back toward the roots: tips go first, ragged by the same noise.
  F-=burn*(.25+.50*n1+1.1*y);
  // Eroded away: most of each card. Skip the hole/streak noises there (perf).
  if(F<=0.) return vec4(0.);
  // Tips DISSOLVE over the top half of every tongue: full-width cuts (a fast rising noise blended with the
  // tongue field) split the tip into pointed islands that rise and fade - detached fragments, not slivers.
  float D=smoothstep(.50,1.,yr);
  float cut=.18+.62*D;
  float kv=1.;
  if(D>0.) kv=pNoise(vec2(xw*3.0*k+s*1.3,y*4.0*k-t*4.6))-cut+(F-.35)*.9;
  float keep=smoothstep(0.,max(px*1.5,.03),kv);
  // Perforation: enclosed, crisp, fully transparent holes, vertically elongated, kept off the outline
  // (threshold shifted, not masked, so their edges stay organic); rims cool to red.
  float gap=pNoise(vec2(xw*5.0*k+s*.7,y*3.4*k-t*2.7))+(n2-.5)*.20;
  float holeZone=smoothstep(.16,.34,y)*(1.-smoothstep(.86,1.,yr));
  float thr=.60-.04*sh;
  float gv=gap-(1.-holeZone)*.6-(1.-smoothstep(.22,.45,F))*.6;
  float hole=smoothstep(thr,thr+max(px*.6,.015),gv);
  // Temperature = distance into the tongue + heat pooled LOW at the base (cubic), carried up by short vertical
  // streaks, cooler toward the card sides: the white-hot zone stays a small low core, the bodies orange.
  float streak=pNoise(vec2(xw*4.6+s,y*1.5-t*2.9));
  float yb=1.-y;
  // Small limb/hip tongues (< ~1 m) run cooler: a yellow root on a 15 px tongue reads as a dot.
  float small=1.-smoothstep(.35,1.1,vFrame.y);
  float T=min(F,1.)*.64+.06-abs(xw)*.14-small*.10+yb*yb*yb*.42*(.2+1.6*streak)-.30*y-.22*D+(streak-.5)*.55*yb+(ridge-.5)*.14
    -smoothstep(thr-.06,thr,gv)*.30-(1.-smoothstep(0.,.15,kv))*D*.35;
  T=clamp(T,0.,1.);
  vec3 c=fireRamp(T,hdr);
  // Crisp 1-px silhouette, dense to the edge so each tongue reads as one solid shape (no soft translucent rim);
  // only the coolest dark-red wisps and the dissolving tips/fragments fade out.
  float alpha=smoothstep(0.,max(px*.8,.012),F)*mix(.90,1.,smoothstep(.08,.30,T))*smoothstep(.02,.14,T);
  float rootA=smoothstep(0.,.06+.16*ridge+.10*small,y);
  alpha*=keep*(1.-hole)*rootA*(1.-.90*smoothstep(.70,1.05,yr));
  // r15: tongues occlude what is behind them (r13/r14's low-occlusion cool parts summed overlaps into a flat
  // light-amber sheet and made the bodies look see-through); only the thin red rim stays slightly additive.
  pOcc=mix(.93,1.,smoothstep(.10,.40,T));
  pHot=smoothstep(.85,1.,T);
  return vec4(c,alpha);
}
float eyeDepth(float z) { return uDepthInfo.y*uDepthInfo.z/(uDepthInfo.z-z*(uDepthInfo.z-uDepthInfo.y)); }
vec4 frame(float f,vec2 gx,vec2 gy) {
  // Smooth transparent padding + RGB bleed; clamp to texel centres inside this cell.
  // Bound to mip 3: the eight-pixel gutter remains at least one texel wide.
  vec2 p=vec2(mod(f,8.),7.-floor(vFrame.w+.001))+clamp(vUv,vec2(.5/256.),vec2(255.5/256.));
  vec2 dx=gx/8.,dy=gy/8.;
  float footprint=max(length(dx),length(dy))*2048.;
  float limit=min(1.,8./max(footprint,.001));
  return textureGrad(uAtlas,p/8.,dx*limit,dy*limit);
}
float fuelHash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float fuelNoise(vec2 p) {
  vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(fuelHash(i),fuelHash(i+vec2(1.,0.)),f.x),
    mix(fuelHash(i+vec2(0.,1.)),fuelHash(i+vec2(1.,1.)),f.x),f.y);
}
void main() {
  // All screen derivatives are taken here, outside the proc/atlas branch: no implicit-gradient op
  // inside either side, so the D3D/ANGLE compiler keeps a real branch instead of running both.
  vec2 gx=dFdx(vUv), gy=dFdy(vUv);
  float px=length(abs(gx)+abs(gy))*2.6+.002;
  float row=floor(vFrame.w+.001);
  float alpha, erode=1., hot;
  pOcc=1.;
  vec3 color;
  if(row>7.5) {
    vec4 pf=procFire(vUv,fract(vFrame.w+.001),row-8.,vLife.x,px,vLife.y);
    color=pf.rgb; alpha=pf.a;
  } else {
    float f=floor(vFrame.z), k=fract(vFrame.z);
    vec4 a=frame(f,gx,gy), b=frame(mod(f+1.,8.),gx,gy);
    // Interpolate premultiplied samples: transparent texels cannot introduce dark seams.
    vec4 tex=mix(vec4(a.rgb*a.a,a.a),vec4(b.rgb*b.a,b.a),k);
    alpha=tex.a;
    color=tex.rgb/max(alpha,.0001);
    erode=smoothstep(vLife.x,vLife.x+.09,alpha);
  }
  float visibility=vTint.a*uFade;
  if(vLife.z>0.) visibility*=smoothstep(vLife.w,vLife.w+vLife.z,vY);
  if(uDepthInfo.x>.5) visibility*=clamp((eyeDepth(texture2D(uDepth,gl_FragCoord.xy/uViewport).r)-vDepth)/uDepthInfo.w,0.,1.);
  alpha*=erode*visibility;
  // Continuous premultiplied falloff; no alpha-test contour on impact silhouettes.
  // r14: procedural flames/ignition carry their own value ladder + HDR core (procFire); only atlas
  // paint and the radiance glow take the instance tint, ceiling and hot-kernel emission below.
  float procF=step(7.5,row)*(1.-step(10.5,row));
  hot=row>7.5 ? pHot : smoothstep(.55,.92,min(color.r,min(color.g,color.b)));
  // Preserve near-white thermal roots; tint belongs to cool paint, not the hot core.
  vec3 painted=color*mix(vTint.rgb,vec3(1.),hot);
  // Impact paint must retain its orange/yellow structure through the scene bloom threshold.
  // Per-instance ceiling: ambient fire/embers retain their established HDR range.
  if(vExtra.z>0.) painted*=min(1.,vExtra.z/max(.0001,max(painted.r,max(painted.g,painted.b))));
  // Cap painted orange structure BEFORE emission. Capping after this term turned the
  // white contact into .95 linear grey below the stage's 1.7 bloom threshold.
  // Only the authored ivory kernel receives HDR; its lifetime is bounded on the CPU.
  painted*=1.+hot*vLife.y;
  color=mix(painted,color,procF);
  // Rooted roof flames emerge from a dark brown/red combustion bed in the thatch (thinner on proc tongues).
  float root=min(1.,vExtra.y)*(1.-smoothstep(.04,mix(.18,.10,procF),vUv.y));
  if(root>0.) {
    // r15: char/ember texture where proc flames meet their fuel: dark char broken by small incandescent specks.
    vec3 charC=vec3(.035,.006,.001)+color*vec3(.15,.025,.006);
    float ek=fuelNoise(vUv*vec2(17.,11.)+vec2(fract(vFrame.w)*31.,-uTime*.35));
    color=mix(color,mix(charC,vec3(1.3,.32,.02),smoothstep(.60,.74,ek)*procF),root);
  }
  alpha*=mix(1.,smoothstep(.025,.075,vUv.y),min(1.,vExtra.y));
  if(vExtra.y>1.5) {
    // Broad carbon with irregular incandescent pockets, no ring/cell outlines.
    vec2 q=vUv*vec2(11.,13.);
    float coarse=fuelNoise(q),fine=fuelNoise(q*2.7+8.3);
    float ember=smoothstep(.46,.78,coarse*.78+fine*.22);
    float fissure=smoothstep(.58,.77,fine)*smoothstep(.43,.70,coarse);
    float edge=length((vUv-vec2(.5))/vec2(.49,.47));
    float bed=1.-smoothstep(.58,1.,edge+(coarse-.5)*.18);
    color=vec3(.018,.004,.002)+vec3(.72,.065,.002)*ember+vec3(.60,.16,.008)*fissure;
    alpha=bed*.88*visibility;
  }
  // Invisible padded texels need not shade/blend. Threshold is below one alpha byte;
  // the visible premultiplied edge remains continuous (no opaque silhouette cutout).
  if(alpha < .002) discard;
  // One material/draw: zero destination attenuation for hot arcs/fire, normal alpha for smoke.
  // Procedural flames: cool red parts occlude less than they emit (pOcc), so overlaps brighten.
  gl_FragColor=vec4(color*alpha,alpha*(1.-vExtra.x)*pOcc);
}`;

export class FirePool {
  constructor({ capacity = 96, fade = { value: 1 }, name = 'authored_fire' } = {}) {
    preloadFireLibrary();
    this.capacity = capacity; this.items = [];
    const geo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
    this.attributes = {};
    for (const key of ['iPosition', 'iFrame', 'iTint', 'iLife', 'iExtra', 'iSurface']) {
      const attr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(key, attr); this.attributes[key] = attr;
    }
    geo.instanceCount = 0;
    const material = new THREE.ShaderMaterial({ name: 'shared_fire_flipbook', vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uAtlas: { value: atlas }, uFade: fade, uTime: { value: 0 }, uDepth: { value: null }, uDepthInfo: { value: new THREE.Vector4(0,.1,100,.2) }, uViewport: { value: new THREE.Vector2(1600,900) } },
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
  /** Roof fuel lies on the supplied surface normal; tongues rise through its charred edge.
   * Uses the same instanced material as hits/camp, with no extra draw or program. */
  emitRoofEdge({ pos = [0,0,0], normal = [0,1,0], height = 1.4, width = height*.6, phase = 0, life = .9,
    tint = '#ffc8a4', alpha = .93, fuel = true } = {}) {
    const bed=fuel ? this.emit({clip:'flame',loop:true,emberBed:true,spread:false,
      pos:pos.map((v,i)=>v+normal[i]*.025),surface:normal,size:[width*1.9,Math.max(.70,width*1.5)],
      life,phase,alpha:.9,core:0}) : null;
    const rootZ=pos[2]-height*.18;
    const roofY=pos[1]-normal[2]/Math.max(.1,normal[1])*(rootZ-pos[2]);
    const tongue=this.emit({clip:'blaze',loop:true,rooted:true,spread:false,tint,core:.65,alpha,life,phase,seed:(phase*7.13+pos[0]*.37)%1,radiance:1.3,
      pos:[pos[0],roofY+height*(.31-.13*normal[2]/Math.max(.1,normal[1]))-.04,rootZ],size:[width*1.65,height],rootNormal:normal,
      mirror:phase>.5?-1:1,skew:(phase-.5)*.35,soft:height*.18,floor:roofY-.06});
    return {bed,tongue};
  }
  /** Body combustion (r12): procedural sheets/tongues ride 2-4 posed bones (chest, hips, near arm and
   * thigh), so the fire hugs the torso and limbs instead of standing beside them. A ragged ignition
   * burst owns the +0 ms contact frame; sheets then burn away (erosion) into attached embers and soot. */
  emitCombustion({pos=[0,1,0],target=null,scale=1,dir=1}={}) {
    const root=target?.modelRoot;
    const tracker=(name)=>{
      const node=root?.getObjectByName(name);
      if(node) {
        const initial=node.getWorldPosition(new THREE.Vector3()),current=new THREE.Vector3();
        return {at:initial.clone(),follow:()=>node.getWorldPosition(current).sub(initial)};
      }
      return null;
    };
    let chest=tracker('chest');
    if(!chest && target?.pos) {
      const initial=target.pos.clone(),current=new THREE.Vector3();
      chest={at:new THREE.Vector3(...pos),follow:()=>current.copy(target.pos).sub(initial)};
    }
    if(!chest) chest={at:new THREE.Vector3(...pos),follow:null};
    const follow=chest.follow, k=scale;
    // r13: the body's chest-hips axis (one read per frame, shared by every body flame). Flames lean
    // with it and compress along it as the body falls, so a knocked-down victim burns ALONG the body.
    const chestNode=root?.getObjectByName('chest'), hipsNode=root?.getObjectByName('hips');
    let tiltAt=-1, tiltVal=0;
    const va=new THREE.Vector3(), vb=new THREE.Vector3();
    const tilt=chestNode && hipsNode ? ()=>{
      if(tiltAt!==this.time) { tiltAt=this.time; chestNode.getWorldPosition(va); hipsNode.getWorldPosition(vb); tiltVal=Math.atan2(va.x-vb.x,va.y-vb.y); }
      return tiltVal;
    } : null;
    const seed=(this._seed=(this._seed||0)+1)*.618034;
    const s=i=>((seed+i*.381966)%1);
    const parts=[];
    // Ignition: one bright ragged burst on the contact point, gone by ~100 ms.
    // r13: hot but shaped (granular core, capped HDR), not a white mass over the torso.
    // r14: the +0 ms frame belongs to a compact white-hot core with tongues radiating from the contact (along
    // the hit); it cools and retracts by ~+66 ms while the body sheets catch (they start a beat later).
    // Pushed .24 m toward the camera: the soft-depth fade ate a burst sitting on the chest surface (fireball +0).
    this.emit({clip:'ignite',pos:[pos[0],pos[1],pos[2]+.24],size:[1.15*k,1.15*k],life:.11,follow,seed:s(0),mirror:dir,
      core:1.1,erosion:.6,fadeStart:.45,grow:.45});
    // r15 SPREAD: each part catches after a delay set by its screen-plane distance from the contact point
    // (chest ~+30 ms, hips/arms ~+60-110, far limbs ~+150 ms), grows in from a short lick (growIn) and the
    // first limbs flash a small catch burst as they light, so the burn visibly runs out from the hit
    // across the torso and limbs instead of appearing at the waist. Every part uses the same eroded
    // sub-tongue shape (procFire), not a smooth strip.
    // The contact point can sit ~.5 m off the chest (in front/beside the body): the spread starts on the body, at the
    // chest pulled at most .2 m toward the contact (screen plane).
    const P0=new THREE.Vector3(...pos), c0=chest.at, off=Math.hypot(P0.x-c0.x,P0.y-c0.y), pull=Math.min(1,.2*k/Math.max(1e-4,off));
    const O={x:c0.x+(P0.x-c0.x)*pull,y:c0.y+(P0.y-c0.y)*pull};
    const catchAt=at=>Math.min(.15,.025+Math.hypot(at.x-O.x,at.y-O.y)*.19/Math.max(.6,k));
    let flashes=0;
    const flash=(at,f,delay)=>{ if(flashes++>=4) return;
      this.emit({clip:'ignite',pos:[at.x,at.y,at.z+.22],size:[.50*k,.50*k],life:.075,delay,follow:f,seed:s(20+flashes),mirror:dir,
        core:.9,erosion:.7,fadeStart:.35,grow:.35}); };
    // Torso: a sheet on the chest front and a taller one behind the body whose tongues show
    // at the silhouette (depth from the bone, not the contact point which sits in front). r15: the front sheet
    // and hip tongues sit further forward (.44/.38 m): on heavy bodies the belly depth-tested them away.
    const c=chest.at;
    const burn=(clip,o)=>{const it=this.emit({clip,fallShrink:true,core:.8,radiance:1.25,erosion:.34,fadeStart:.80,growY:.12,growIn:.07,tint:'#ffc4a0',...o}); if(it) it.tilt=tilt; parts.push(it);};
    const dc=catchAt(c);
    burn('burn',{pos:[c.x,c.y+.20*k,c.z+.44],size:[.82*k,1.00*k],life:.56,delay:dc,fadeIn:.04,follow,seed:s(1),mirror:dir,core:.9});
    // r15: a small cluster on the chest front itself (the wide front sheet is dragged aside by knockback travel).
    burn('blaze',{pos:[c.x+dir*.04*k,c.y+.02*k,c.z+.48],size:[.40*k,.58*k],life:.50,delay:dc+.02,follow,seed:s(30),mirror:-dir,core:.8});
    // r13: the back sheet is shorter and wider (more, smaller tongues), no single dominant ribbon.
    burn('burn',{pos:[c.x-dir*.06*k,c.y+.26*k,c.z-.22],size:[1.08*k,1.10*k],life:.60,delay:dc+.012,fadeIn:.04,follow,seed:s(2),mirror:-dir,core:.5});
    const hips=tracker('hips');
    const h=hips ? hips.at : new THREE.Vector3(c.x,c.y-.12*k,c.z);
    const dh=catchAt(h);
    for(const [dx,w,hh,dl] of [[-.11,.34,.56,0],[.12,.30,.48,.015]])
      burn('blaze',{pos:[h.x+dx*k,h.y+hh*.30*k,h.z+.38],size:[w*k,hh*k],life:.46,delay:dh+dl,follow:hips?.follow||follow,seed:s(parts.length+3),mirror:dx<0?1:-1});
    // Limbs: shoulders, arms and thighs catch in order of distance from the contact.
    const limbs=[['upperarm_R',.30,.54],['upperarm_L',.30,.54],['forearm_R',.28,.50],['forearm_L',.26,.46],['thigh_R',.30,.48],['thigh_L',.28,.44]]
      .map(([name,w,hh])=>{const b=tracker(name); return b && {b,w,hh,d:catchAt(b.at)};}).filter(Boolean).sort((p,q)=>p.d-q.d);
    for(const {b,w,hh,d} of limbs) {
      flash(b.at,b.follow,d-.01);
      burn('blaze',{pos:[b.at.x,b.at.y+hh*.30*k,b.at.z+.16],size:[w*k,hh*k],life:.44,delay:d,follow:b.follow,seed:s(parts.length+4),erosion:.5});
    }
    const residue=this.emit({clip:'embers',pos:[pos[0],pos[1]-.20*scale,pos[2]+.04],
      size:[.80*scale,.85*scale],life:.43,delay:.24,fadeIn:.08,follow,core:.35,alpha:.72,grow:-.30});
    this.emit({clip:'smoke',pos:[pos[0],pos[1]+.12*scale,pos[2]+.025],size:[1.05*scale,1.75*scale],
      life:.64,delay:.18,fadeIn:.12,follow,core:0,alpha:.52,vel:[0,.32,0],grow:.24});
    return [parts[0],residue];
  }

  emit({ clip = 'flame', pos = [0,0,0], size = [1,1], life = .4, loop = false, phase = 0,
    rot = 0, tint = '#ffffff', alpha = 1, core = .65, erosion = .15, vel = [0,0,0], grow = 0, soft = 0, floor = 0, delay = 0, spin = 0, growY = grow,
    additive = false, rooted = false, spread = true, emberBed = false, fadeIn = 0, fadeStart = .65, radiance = 0, mirror = 1, skew = 0, follow = null, surface = null, rootNormal = null, seed = null, fallShrink = false, keepTint = false, growIn = 0 } = {}) {
    if (!(clip in FIRE_CLIPS)) throw new Error(`Unknown fire clip: ${clip}`);
    if (this.items.length >= this.capacity) return null;
    if (loop && clip==='smoke') {
      // The tall roof plume must crest the roofline; its lower companion stays in the hole.
      if(size[1]>=4) { pos=[pos[0],pos[1]-.40,pos[2]+.08]; size=[size[0]*1.12,size[1]*1.10]; }
      size=[size[0]*1.38,size[1]]; alpha=Math.min(1,alpha*1.45);
    }
    const c = new THREE.Color(tint);
    if(loop && clip==='smoke' && !keepTint) c.lerp(new THREE.Color('#ffffff'),.82);
    const o={ row: FIRE_CLIPS[clip], pos:[...pos], size:[...size], life:Math.max(.001,life), loop, phase:((phase%1)+1)%1, rot,
      tint:[c.r,c.g,c.b], alpha, core, erosion, vel:[...vel], grow, growY, spin, soft, floor, additive, rooted, emberBed, fadeIn, fadeStart, radiance, mirror, follow, surface, rootNormal, origin:follow ? [...pos] : null, fallShrink, growIn, seed:(((seed ?? (this._seed=(this._seed||0)+1)*.754877)%1)+1)%1, skew:Math.max(-.4,Math.min(.4,skew)), age:-delay };
    this.items.push(o);
    this.update(0); return o;
  }
  update(dt) {
    const A=this.attributes; let n=0;
    this.time=(this.time||0)+dt; this.mesh.material.uniforms.uTime.value=this.time%600;
    for(let i=0;i<this.items.length;i++) {
      const o=this.items[i]; o.age+=dt;
      if(!o.loop && o.age>=o.life) { this.items.splice(i--,1); continue; }
      if(o.age<0) continue;
      const t=o.loop ? ((o.age/o.life+o.phase)%1) : Math.min(1,o.age/o.life);
      const impact=o.row===FIRE_CLIPS.slash || o.row===FIRE_CLIPS.blunt;
      const frame=o.loop ? t*8 : impact ? Math.min(3,o.age/.033) : Math.min(6.999,(o.row===FIRE_CLIPS.fireBurst ? o.phase+(1-o.phase)*t : t)*7);
      let hk=1, wk=1, lean=0;
      if(o.follow) {
        const px=o.pos[0], delta=o.follow();
        if(delta) for(let axis=0;axis<3;axis++) o.pos[axis]=o.origin[axis]+delta.getComponent(axis);
        // Upright body fire shortens toward its root when the body falls (no tips hanging in the air).
        if(delta && o.fallShrink) hk=Math.max(.35,1+Math.min(0,delta.y)*1.15);
        if(o.tilt) {
          // r13: lean with the body axis and compress along it (shorter, wider, more tongues hugging
          // the body as it goes horizontal); fast travel drags the flames back against the motion.
          const a=o.tilt(), dead=Math.sign(a)*Math.max(0,Math.abs(a)-.12), tf=Math.min(1,Math.abs(Math.sin(dead)));
          hk*=1-.6*tf; wk=1+.5*tf;
          if(dt>0) o.drag=(o.drag||0)*.7+.3*Math.max(-.4,Math.min(.4,(o.pos[0]-px)/dt*.045));
          lean=-dead*.62+(o.drag||0);
        }
      }
      // r15: a catching flame licks up from its root over growIn seconds (the spread reads as growth).
      if(o.growIn>0) hk*=Math.min(1,.35+.65*o.age/o.growIn);
      const growth=1+o.grow*t, fullH=o.size[1]*(1+o.growY*t), h=fullH*hk;
      // Pivot on the root: the card centre sits half its (shrunk) height from the root along its lean.
      A.iPosition.setXYZW(n,o.pos[0]+o.vel[0]*o.age-Math.sin(lean)*h*.5,o.pos[1]+o.vel[1]*o.age-fullH*.5+Math.cos(lean)*h*.5,o.pos[2]+o.vel[2]*o.age,o.rot+o.spin*o.age+lean);
      A.iFrame.setXYZW(n,o.size[0]*growth*wk,h,Math.min(7.999,frame),o.row>=PROC ? o.row+(o.seed%1)*.98 : o.row);
      const onset=o.fadeIn>0 ? Math.min(1,o.age/o.fadeIn) : 1;
      A.iTint.setXYZW(n,o.tint[0],o.tint[1],o.tint[2],o.alpha*onset*(o.loop ? 1 : 1-Math.max(0,(t-o.fadeStart)/Math.max(.001,1-o.fadeStart))));
      A.iSurface.setXYZW(n,...(o.surface || o.rootNormal || [0,1,0]),o.surface ? 1 : o.rootNormal ? -1 : 0);
      A.iExtra.setXYZW(n,o.additive ? 1 : 0,o.emberBed ? 2 : o.rooted ? 1 : 0,o.radiance,(o.mirror<0 ? -1 : 1)*(1+o.skew));
      const cool=Math.max(0,Math.min(1,(o.age-(o.row===FIRE_CLIPS.blunt ? .066 : .045))/.040));
      const heat=impact ? 1-cool*cool*(3-2*cool) : 1;
      A.iLife.setXYZW(n,o.loop ? 0 : o.erosion*t,o.core*heat,o.soft,o.floor); n++;
    }
    this.mesh.geometry.instanceCount=n;
    for(const a of Object.values(A)) a.needsUpdate=true;
  }
  clear() { this.items.length=0; this.mesh.geometry.instanceCount=0; }
  dispose() { this.clear(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
