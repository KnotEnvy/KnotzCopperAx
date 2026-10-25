// quick 2x crops (+ greyscale) for iteration: node crops.mjs <png> <out> x y w h
import sharp from 'sharp';
const [,,src,out,x,y,w,h]=process.argv; const b={left:+x,top:+y,width:+w,height:+h};
const c=await sharp(src).extract(b).resize(+w*2,+h*2,{kernel:'nearest'}).png().toBuffer();
const g=await sharp(c).greyscale().png().toBuffer();
await sharp({create:{width:+w*4+4,height:+h*2,channels:3,background:'#111'}}).composite([{input:c,left:0,top:0},{input:g,left:+w*2+4,top:0}]).png().toFile(out);
