// r13 shared-fire evidence: strips, 2x crops, r12-vs-r13 panels at 2x and a flame-ROI motion metric (sharp; no GPU).
import sharp from 'sharp'; import fs from 'node:fs'; import path from 'node:path';
const R='progress/shots/shared-fire-library/r13', B='progress/qa/board-c2/shared-fire-library-r12';
const label=(w,h,t)=>Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="20" fill="#000" opacity=".7"/><text x="5" y="15" font-family="monospace" font-size="14" fill="#ffd">${t}</text></svg>`);
async function tile(file,box,scale,text){
  const buf=await sharp(file).extract({left:box[0],top:box[1],width:box[2],height:box[3]}).resize(box[2]*scale,box[3]*scale,{kernel:'nearest'}).png().toBuffer();
  return text ? sharp(buf).composite([{input:label(box[2]*scale,box[3]*scale,text),top:0,left:0}]).png().toBuffer() : buf;
}
async function grid(tiles,w,h,cols,out,gap=4){
  const rows=Math.ceil(tiles.length/cols);
  await sharp({create:{width:w*cols+gap*(cols-1),height:h*rows+gap*(rows-1),channels:3,background:'#111'}})
    .composite(tiles.map((t,i)=>({input:t,left:(i%cols)*(w+gap),top:Math.floor(i/cols)*(h+gap)}))).png().toFile(out);
  console.log('wrote',out);
}
const ms=Array.from({length:16},(_,i)=>String(i*33).padStart(3,'0'));
// Stage-mode fire hit: 16 frames following the chest, then 2x at +0/+99 (same box as the board's r12 crop).
const S=JSON.parse(fs.readFileSync(`${R}/stage-fire/screen.json`));
const sx=i=>Math.max(0,Math.min(1600-240,Math.round((S[i]?.screen?.[0]??120)-120)));
await grid(await Promise.all(ms.map((m,i)=>tile(`${R}/stage-fire/fire-${m}ms.png`,[sx(i),360,240,270],1,`+${m}ms`))),240,270,8,`${R}/stage-fire-strip-16.png`);
await grid([await tile(`${R}/stage-fire/fire-000ms.png`,[20,370,200,250],2,'r13 +0ms 2x'),await tile(`${R}/stage-fire/fire-099ms.png`,[20,370,200,250],2,'r13 +99ms 2x')],400,500,2,`${R}/stage-fire-2x-0-99ms.png`);
await grid([await tile(`${B}/stage-fire-hit/fire-000ms.png`,[20,370,200,250],2,'r12 +0ms 2x'),await tile(`${R}/stage-fire/fire-000ms.png`,[20,370,200,250],2,'r13 +0ms 2x'),
  await tile(`${B}/stage-fire-hit/fire-099ms.png`,[20,370,200,250],2,'r12 +99ms 2x'),await tile(`${R}/stage-fire/fire-099ms.png`,[20,370,200,250],2,'r13 +99ms 2x')],400,500,2,`${R}/r12-vs-r13-hit-2x.png`);
// Mounted fireball: same 480x270 crop as the board strip.
await grid(await Promise.all(ms.map(m=>tile(`${R}/fireball/impact-${m}ms.png`,[1040,330,480,270],1,`+${m}ms`))),480,270,4,`${R}/fireball-strip-crop-16.png`);
await grid([await tile(`${B}/fireball/impact-198ms.png`,[1040,330,480,270],1,'r12 +198ms'),await tile(`${R}/fireball/impact-198ms.png`,[1040,330,480,270],1,'r13 +198ms'),
  await tile(`${B}/fireball/impact-330ms.png`,[1040,330,480,270],1,'r12 +330ms (body down)'),await tile(`${R}/fireball/impact-330ms.png`,[1040,330,480,270],1,'r13 +330ms (body down)')],480,270,2,`${R}/r12-vs-r13-fall.png`);
// Roof: 2x hole crop + r12/r13 panel + 12 clip tiles.
await grid([await tile(`${R}/roof/roof-game.png`,[830,80,200,180],2,'r13 roof hole 2x')],400,360,1,`${R}/roof-hole-2x.png`);
await grid([await tile(`${B}/roof/roof-game.png`,[620,20,500,330],1,'r12 roof 1x'),await tile(`${R}/roof/roof-game.png`,[620,20,500,330],1,'r13 roof 1x')],500,330,2,`${R}/r12-vs-r13-roof-1x.png`);
await grid([await tile(`${B}/roof/roof-game.png`,[830,80,200,180],2,'r12 2x'),await tile(`${R}/roof/roof-game.png`,[830,80,200,180],2,'r13 2x')],400,360,2,`${R}/r12-vs-r13-roof-2x.png`);
const rf=fs.readdirSync(`${R}/roof`).filter(f=>/^roof_\d+\.png$/.test(f)).sort();
await grid(await Promise.all(rf.map((f,i)=>tile(`${R}/roof/${f}`,[760,40,360,260],1,`${i}`))),360,260,4,`${R}/roof-clip-12.png`);
// Camp.
await grid([await tile(`${R}/camp/camp-game.png`,[700,290,210,240],2,'r13 camp 2x')],420,480,1,`${R}/camp-flames-2x.png`);
await grid([await tile(`${B}/camp-still/shot.png`,[700,290,210,240],2,'r12 2x'),await tile(`${R}/camp/camp-game.png`,[700,290,210,240],2,'r13 2x')],420,480,2,`${R}/r12-vs-r13-camp-2x.png`);
await grid([await tile(`${B}/camp-still/shot.png`,[560,250,480,330],1,'r12 camp 1x'),await tile(`${R}/camp/camp-game.png`,[560,250,480,330],1,'r13 camp 1x')],480,330,2,`${R}/r12-vs-r13-camp-1x.png`);
const cf=fs.readdirSync(`${R}/camp`).filter(f=>/^camp_\d+\.png$/.test(f)).sort();
await grid(await Promise.all(cf.map((f,i)=>tile(`${R}/camp/${f}`,[640,230,320,340],1,`${i}`))),320,340,6,`${R}/camp-clip-tiles.png`);
// Flame-ROI motion: mean |luma diff| between consecutive kept clip frames inside the roof hole / camp flames only.
async function roiMotion(dir,prefix,box){
  const fr=fs.readdirSync(dir).filter(f=>new RegExp(`^${prefix}_\\d+\\.png$`).test(f)).sort();
  const lum=await Promise.all(fr.map(f=>sharp(path.join(dir,f)).extract({left:box[0],top:box[1],width:box[2],height:box[3]}).greyscale().raw().toBuffer()));
  const d=[];for(let i=1;i<lum.length;i++){let s=0;for(let k=0;k<lum[i].length;k++)s+=Math.abs(lum[i][k]-lum[i-1][k]);d.push(s/lum[i].length);}
  d.sort((a,b)=>a-b);return {frames:fr.length,median:+d[Math.floor(d.length/2)].toFixed(2),mean:+(d.reduce((a,b)=>a+b,0)/d.length).toFixed(2)};
}
const motion={roofHole:{box:[830,80,200,180],r12:await roiMotion(`progress/shots/shared-fire-library/r12/roof`,'roof',[830,80,200,180]),r13:await roiMotion(`${R}/roof`,'roof',[830,80,200,180])},
  camp:{box:[700,290,210,240],r12:await roiMotion(`progress/shots/shared-fire-library/r12/camp`,'camp',[700,290,210,240]),r13:await roiMotion(`${R}/camp`,'camp',[700,290,210,240])}};
fs.writeFileSync(`${R}/flame-motion.json`,JSON.stringify(motion,null,2));console.log(JSON.stringify(motion));
