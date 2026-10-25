// r15 shared-fire: contact strip of crops. Usage: node strip.mjs out x y w h cols file...
import sharp from 'sharp';
const [,,out,x,y,w,h,cols,...f]=process.argv;const W=+w,H=+h,C=+cols,R=Math.ceil(f.length/C);
const t=await Promise.all(f.map(s=>sharp(s).extract({left:+x,top:+y,width:W,height:H}).png().toBuffer()));
await sharp({create:{width:C*W,height:R*H,channels:3,background:'#000'}}).composite(t.map((b,i)=>({input:b,left:(i%C)*W,top:Math.floor(i/C)*H}))).png().toFile(out);
