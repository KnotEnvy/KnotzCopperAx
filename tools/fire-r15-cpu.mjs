// r15 shared-fire: CPU port of procFire's blaze/burn path (fireLib.js) for fast SHAPE iteration without a GPU capture.
// Composites over a night backdrop and runs the AgX port (tools/lib-agx-r14.mjs). Keep in sync with the GLSL by hand.
// Harness only: tools/fire-r15-cpu-body.mjs supplies P.body and renders.
import sharp from 'sharp';
import { agx } from './lib-agx-r14.mjs';
const [,,out='/tmp/fire-cpu.png',T0='3.0',CW='90',CH='150',ST='0']=process.argv;
const fract=x=>x-Math.floor(x), mix=(a,b,t)=>a+(b-a)*t, clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const smoothstep=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
function hash(px,py){let qx=fract(px*.1031),qy=fract(py*.1031),qz=fract(px*.1031);const d=qx*(qy+33.33)+qy*(qz+33.33)+qz*(qx+33.33);qx+=d;qy+=d;qz+=d;return fract((qx+qy)*qz);}
function noise(x,y){const ix=Math.floor(x),iy=Math.floor(y);let fx=x-ix,fy=y-iy;fx=fx*fx*(3-2*fx);fy=fy*fy*(3-2*fy);
  return mix(mix(hash(ix,iy),hash(ix+1,iy),fx),mix(hash(ix,iy+1),hash(ix+1,iy+1),fx),fy);}
const noise1=p=>{const i=Math.floor(p);let f=p-i;f=f*f*(3-2*f);return mix(hash(i,7),hash(i+1,7),f);};
function ramp(T,hdr){let c=[.060,.0015,0];const m=(c2,t)=>{c=c.map((v,i)=>mix(v,c2[i],t));};
  m([.17,.010,0],smoothstep(.02,.22,T));m([.36,.050,0],smoothstep(.22,.42,T));m([.58,.10,0],smoothstep(.42,.62,T));
  m([1.10,.30,0],smoothstep(.70,.84,T));m([1.9*hdr,1.25*hdr,.40*hdr],smoothstep(.86,.98,T));return c;}
export const P={}; // tweakables
export function shape(u,v,seed,style,burn,px,core,time,cardH){
  const s=seed*71.3, t=time*(1.05+.5*fract(seed*7.31))+seed*23.;
  // vertex vProc
  const tv=t; const vProc=[noise(s+9.,tv*.55)-.5,(noise(s*2.,tv*.8)-.5)*2.8,.70+.24*noise(s*1.7,tv*1.7)+.10*noise(s+4.,tv*4.6)];
  let x=u*2-1, y=v; const hdr=.80+.30*core; const sheet=style>.5, sh=sheet?1:0;
  y/=vProc[2]; if(y>1) return null;
  const lean=(fract(seed*3.17)-.5)*.5;
  const bend=(noise1(y*1.3-t*1.1+s*3.7)-.5)*1.6*y*y+vProc[0]*.5*y+lean*y*y;
  const w1=noise(x*1.6+s,y*2.0-t*2.4);
  const xw=x+bend+(w1-.5)*.55*(.12+y);
  return P.body({x,y,xw,t,s,seed,sh,sheet,vProc,burn,px,hdr,cardH});
}
export const env={noise,noise1,fract,mix,clamp,smoothstep,ramp};
export async function render(outPath,{time=+T0,cw=+CW,ch=+CH,style=+ST,seeds=[.05,.223,.396,.569,.742,.915],times=null}={}){
  const cols=seeds.length, rows=(times||[time]).length, W=cw*cols, H=ch*rows, buf=Buffer.alloc(W*H*3);
  const bg=[.012,.010,.028];
  (times||[time]).forEach((tm,r)=>seeds.forEach((sd,ci)=>{
    const px=(1/cw+1/ch)*2.6+.002;
    for(let j=0;j<ch;j++)for(let i=0;i<cw;i++){
      const u=(i+.5)/cw, v=1-(j+.5)/ch; const o=shape(u,v,sd,style,0,px,.7,tm,ch/100);
      let c=bg; if(o){const [cr,cg,cb,a,occ]=o; c=[cr*a+bg[0]*(1-a*occ),cg*a+bg[1]*(1-a*occ),cb*a+bg[2]*(1-a*occ)];}
      const d=agx(c).map(x=>Math.round(255*(x<=.0031308?12.92*x:1.055*Math.pow(x,1/2.4)-.055)));
      const k=((r*ch+j)*W+ci*cw+i)*3; buf[k]=d[0];buf[k+1]=d[1];buf[k+2]=d[2];
    }}));
  await sharp(buf,{raw:{width:W,height:H,channels:3}}).png().toFile(outPath);
}
