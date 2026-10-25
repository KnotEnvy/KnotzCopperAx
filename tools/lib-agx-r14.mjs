// JS port of three.js AgXToneMapping (the post chain tonemap) for offline colour checks (r14 fire contract).
// JS port of three's AgXToneMapping (as used by the post chain) to design fire ramp colours offline.
const mul=(m,v)=>[0,1,2].map(r=>m[0][r]*v[0]+m[1][r]*v[1]+m[2][r]*v[2]); // m = columns
const S2R=[[0.6274,0.0691,0.0164],[0.3293,0.9195,0.0880],[0.0433,0.0113,0.8956]];
const R2S=[[1.6605,-0.1246,-0.0182],[-0.5876,1.1329,-0.1006],[-0.0728,-0.0083,1.1187]];
const IN=[[0.856627153315983,0.137318972929847,0.11189821299995],[0.0951212405381588,0.761241990602591,0.0767994186031903],[0.0482516061458583,0.101439036467562,0.811302368396859]];
const OUT=[[1.1271005818144368,-0.1413297634984383,-0.14132976349843826],[-0.11060664309660323,1.157823702216272,-0.11060664309660294],[-0.016493938717834573,-0.016493938717834257,1.2519364065950405]];
const mn=-12.47393,mx=4.026069;
const sig=x=>{const x2=x*x,x4=x2*x2;return 15.5*x4*x2-40.14*x4*x+31.96*x4-6.868*x2*x+.4298*x2+.1191*x-.00232;};
export function agx(c){let v=mul(IN,mul(S2R,c));v=v.map(x=>Math.min(1,Math.max(0,(Math.log2(Math.max(x,1e-10))-mn)/(mx-mn)))).map(sig);v=mul(OUT,v).map(x=>Math.pow(Math.max(0,x),2.2));v=mul(R2S,v);return v.map(x=>Math.min(1,Math.max(0,x)));}
const srgb=x=>x<=.0031308?12.92*x:1.055*Math.pow(x,1/2.4)-.055;
export function show(c){const o=agx(c).map(srgb).map(x=>Math.round(x*255));const [r,g,b]=o;const mxx=Math.max(r,g,b),mnn=Math.min(r,g,b);const h=mxx===mnn?0:mxx===r?60*(((g-b)/(mxx-mnn))%6):mxx===g?60*((b-r)/(mxx-mnn)+2):60*((r-g)/(mxx-mnn)+4);return `${c.map(x=>x.toFixed(3)).join(',')} -> rgb(${o}) hue ${h.toFixed(0)} sat ${(mxx?(mxx-mnn)/mxx:0).toFixed(2)} val ${mxx}`;}
