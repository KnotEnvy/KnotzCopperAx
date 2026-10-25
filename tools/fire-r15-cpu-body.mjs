// r15 shared-fire: the blaze/burn body of procFire (fireLib.js) on the CPU, synced by hand to the r15 GLSL; tweak via V='{"key":value}'.
// node tools/fire-r15-cpu-body.mjs out.png   (env: CW CH card px, ST 0 blaze / 1 sheet, SEEDS, TIMES)
import { P, env, render } from './fire-r15-cpu.mjs';
const {noise,fract,mix,clamp,smoothstep,ramp}=env;
const V=JSON.parse(process.env.V||'{}'); const g=(k,d)=>V[k]??d;
P.body=({x,y,xw,t,s,seed,sh,sheet,vProc,burn,px,hdr,cardH})=>{
  // cheap hook wiggle (displacement keeps width; no slivers)
  xw+=Math.sin(y*g('wf',8.)-t*4.3+x*1.7+s)*g('wa',.07)*y;
  const nT=sheet?4:3, dom=Math.floor(fract(seed*4.73)*nT);
  let F=-9, yr=1;
  for(let i=0;i<nT;i++){
    const h=fract(seed*(7.13+i*3.71)+i*.37);
    const ht=(i===dom?.97:g('hmin',.48)+g('hvar',.36)*h)*(.88+.12*Math.sin(t*(2.1+1.3*h)+i*2.3));
    const off=((i+.5)/nT*2-1)*(g('spread',.50)+.12*sh)+(h-.5)*.16;
    const cx=off*(.32+.68*smoothstep(.05,.55,y))+Math.sin(y*(5+3*h)-t*(2.0+.8*h)+i*1.9)*g('curl',.16)*y;
    const q=Math.min(y/ht,1);
    const wi=(g('w0',.42)-.07*sh)*(1-.16*h)*Math.pow(Math.max(0,1-q),g('pw',.6))*(1-g('pq',.3)*q)+1e-4;
    const f=1-Math.abs(xw-cx)/wi;
    if(f>F){F=f;yr=y/ht;}
  }
  const rootH=g('rootH',.34)-.04*sh;
  const rm=1-Math.abs(xw)/((g('rootW',.70)+.06*sh)*Math.pow(Math.max(0,1-y/rootH),g('rp',.7))+1e-4);
  const hk=Math.max(g('fil',.35)-Math.abs(F-rm),0); F=Math.max(F,rm)+hk*hk*.7;
  if(F<-.45) return null;
  const k=clamp(cardH*.40,.85,1.35);
  const n1=noise(xw*1.9*k+s*3,y*2.3*k-t*2.5), n2=noise(xw*4.3*k-s,y*4.4*k-t*3.9), ridge=1-Math.abs(n2*2-1);
  F+=(n1-.5)*mix(g('r1a',.22),g('r1b',.38),y)+(ridge-.55)*mix(g('r2a',.14),g('r2b',.30),y)-.04*y;
  const D=smoothstep(g('d0',.50),1,yr);
  F-=burn*(.25+.50*n1+1.1*y);
  if(F<=0) return null;
  // Dissolve: full-width cuts across the top third -> stacked islands that rise (nd scrolls faster than the body).
  const nd=D>0?noise(xw*g('dx',3.0)*k+s*1.3,y*g('dy',4.0)*k-t*g('dt',4.6)):1;
  const cut=g('c0',.18)+g('c1',.62)*D;
  const kv=(nd-cut)+(F-g('kc',.35))*g('kf',.9);
  const keep=smoothstep(0,Math.max(px*1.5,.03),kv);
  const gap=noise(xw*g('gx',5.0)*k+s*.7,y*g('gy',3.4)*k-t*2.7)+(n2-.5)*.20;
  const holeZone=smoothstep(.16,.34,y)*(1-smoothstep(.86,1,yr));
  const thr=g('thr',.60)-.04*sh;
  const inner=smoothstep(g('i0',.22),g('i1',.45),F);
  const gv=gap-(1-holeZone)*.6-(1-inner)*.6;
  const hole=smoothstep(thr,thr+Math.max(px*.6,.015),gv);
  const streak=noise(xw*4.6+s,y*1.5-t*2.9), yb=1-y;
  const small=1-smoothstep(.35,1.1,cardH);
  let T=Math.min(F,1)*g('tF',.64)+g('tB',.06)-Math.abs(xw)*g('tX',.14)-small*.10+Math.pow(yb,g('tP',3))*g('tY',.42)*(.2+1.6*streak)-g('tH',.30)*y-.22*D+(streak-.5)*.55*yb+(ridge-.5)*.14
    -smoothstep(thr-.06,thr,gv)*.30-(1-smoothstep(0,.15,kv))*D*.35;
  T=clamp(T,0,1);
  const c=ramp(T,hdr);
  let a=smoothstep(0,Math.max(px*g('aw',.8),g('am',.012)),F)*mix(g('ar',.90),1,smoothstep(.08,.30,T))*smoothstep(.02,.14,T);
  const rootA=smoothstep(0,.06+.16*ridge+.10*small,y);
  a*=keep*(1-hole)*rootA*(1-g('tf',.90)*smoothstep(.70,1.05,yr));
  return [c[0],c[1],c[2],a,mix(.93,1,smoothstep(.10,.40,T))];
};
const out=process.argv[2]||'/tmp/fire-cpu.png';
await render(out,{seeds:JSON.parse(process.env.SEEDS||"[0.05,0.223,0.396,0.569,0.742,0.915]"),cw:+(process.env.CW||120),ch:+(process.env.CH||190),style:+(process.env.ST||0),times:JSON.parse(process.env.TIMES||'[3.0,3.2,7.7]')});
