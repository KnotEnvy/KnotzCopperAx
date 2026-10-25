// r15 shared-fire: side-by-side crops of two stills (same box), at a given zoom (nearest). node fire-r15-pair.mjs out x y w h zoom a.png b.png [c.png...]
import sharp from 'sharp';
const [,,out,x,y,w,h,z,...srcs]=process.argv; const b={left:+x,top:+y,width:+w,height:+h}, W=+w*+z, H=+h*+z;
const tiles=await Promise.all(srcs.map(s=>sharp(s).extract(b).resize(W,H,{kernel:'nearest'}).png().toBuffer()));
await sharp({create:{width:(W+6)*tiles.length-6,height:H,channels:3,background:'#111'}}).composite(tiles.map((t,i)=>({input:t,left:i*(W+6),top:0}))).png().toFile(out);
