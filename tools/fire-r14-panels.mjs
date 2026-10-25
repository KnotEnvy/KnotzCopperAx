// r14 shared-fire evidence: strips, 2x crops (+ greyscale), r13-vs-r14 panels at 1x AND 2x, clip sheets from evenly
// spaced MP4 frames, and a flame-ROI motion metric (sharp + ffmpeg; no GPU).
import sharp from 'sharp'; import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
const R='progress/shots/shared-fire-library/r14', P='progress/shots/shared-fire-library/r13', B='progress/qa/board-c2/shared-fire-library-r13';
const label=(w,h,t)=>Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="20" fill="#000" opacity=".7"/><text x="5" y="15" font-family="monospace" font-size="14" fill="#ffd">${t}</text></svg>`);
async function tile(file,box,scale,text,grey=false){
  let img=sharp(file).extract({left:box[0],top:box[1],width:box[2],height:box[3]}).resize(box[2]*scale,box[3]*scale,{kernel:'nearest'});
  if(grey) img=img.greyscale();
  const buf=await img.png().toBuffer();
  return text ? sharp(buf).composite([{input:label(box[2]*scale,box[3]*scale,text),top:0,left:0}]).png().toBuffer() : buf;
}
async function grid(tiles,w,h,cols,out,gap=4){
  const rows=Math.ceil(tiles.length/cols);
  await sharp({create:{width:w*cols+gap*(cols-1),height:h*rows+gap*(rows-1),channels:3,background:'#111'}})
    .composite(tiles.map((t,i)=>({input:t,left:(i%cols)*(w+gap),top:Math.floor(i/cols)*(h+gap)}))).png().toFile(out);
  console.log('wrote',out);
}
// Evenly spaced frames straight from the MP4 (not the capture's kept PNGs); the 1280x720 MP4 is scaled to the
// 1600x900 still geometry so the same crop boxes apply.
function mp4Frames(mp4,n,dir){
  fs.rmSync(dir,{recursive:true,force:true}); fs.mkdirSync(dir,{recursive:true});
  const total=+execFileSync('ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=nb_read_frames','-of','csv=p=0',mp4]).toString().trim();
  const idx=Array.from({length:n},(_,i)=>Math.round(i*(total-1)/(n-1)));
  execFileSync('ffmpeg',['-v','error','-i',mp4,'-vf',`select='${idx.map(i=>`eq(n\\,${i})`).join('+')}',scale=1600:900:flags=lanczos`,'-fps_mode','passthrough',path.join(dir,'f_%02d.png')]);
  return {total,idx,files:fs.readdirSync(dir).filter(f=>f.endsWith('.png')).sort().map(f=>path.join(dir,f))};
}
const ms=Array.from({length:16},(_,i)=>String(i*33).padStart(3,'0'));
// ---- Stage-mode fire hit: 16 frames following the chest, 2x at +0/+99 (the board's r13 box), r13 vs r14 2x.
const S=JSON.parse(fs.readFileSync(`${R}/stage-fire/screen.json`));
const sx=i=>Math.max(0,Math.min(1600-240,Math.round((S[i]?.screen?.[0]??120)-120)));
await grid(await Promise.all(ms.map((m,i)=>tile(`${R}/stage-fire/fire-${m}ms.png`,[sx(i),360,240,270],1,`+${m}ms`))),240,270,8,`${R}/stage-fire-strip-16.png`);
await grid([await tile(`${R}/stage-fire/fire-000ms.png`,[20,370,200,250],2,'r14 +0ms 2x'),await tile(`${R}/stage-fire/fire-099ms.png`,[20,370,200,250],2,'r14 +99ms 2x')],400,500,2,`${R}/stage-fire-2x-0-99ms.png`);
await grid([await tile(`${P}/stage-fire/fire-000ms.png`,[20,370,200,250],2,'r13 +0ms 2x'),await tile(`${R}/stage-fire/fire-000ms.png`,[20,370,200,250],2,'r14 +0ms 2x'),
  await tile(`${P}/stage-fire/fire-099ms.png`,[20,370,200,250],2,'r13 +99ms 2x'),await tile(`${R}/stage-fire/fire-099ms.png`,[20,370,200,250],2,'r14 +99ms 2x')],400,500,2,`${R}/r13-vs-r14-hit-2x.png`);
await grid([await tile(`${P}/stage-fire/fire-000ms.png`,[0,300,360,360],1,'r13 +0ms 1x'),await tile(`${R}/stage-fire/fire-000ms.png`,[0,300,360,360],1,'r14 +0ms 1x'),
  await tile(`${P}/stage-fire/fire-099ms.png`,[0,300,360,360],1,'r13 +99ms 1x'),await tile(`${R}/stage-fire/fire-099ms.png`,[0,300,360,360],1,'r14 +99ms 1x')],360,360,4,`${R}/r13-vs-r14-hit-1x.png`);
// ---- Mounted fireball: the board's 480x270 box, 16 frames; r13 vs r14 contact + fall frames.
await grid(await Promise.all(ms.map(m=>tile(`${R}/fireball/impact-${m}ms.png`,[1040,330,480,270],1,`+${m}ms`))),480,270,4,`${R}/fireball-strip-crop-16.png`);
await grid(await Promise.all(['000','033','066','099'].map(m=>tile(`${R}/fireball/impact-${m}ms.png`,[1050,400,220,200],2,`r14 +${m}ms 2x`))),440,400,4,`${R}/fireball-ignition-2x.png`);
await grid([await tile(`${P}/fireball/impact-000ms.png`,[1040,330,480,270],1,'r13 +0ms'),await tile(`${R}/fireball/impact-000ms.png`,[1040,330,480,270],1,'r14 +0ms'),
  await tile(`${P}/fireball/impact-198ms.png`,[1040,330,480,270],1,'r13 +198ms'),await tile(`${R}/fireball/impact-198ms.png`,[1040,330,480,270],1,'r14 +198ms'),
  await tile(`${P}/fireball/impact-330ms.png`,[1040,330,480,270],1,'r13 +330ms (body down)'),await tile(`${R}/fireball/impact-330ms.png`,[1040,330,480,270],1,'r14 +330ms (body down)')],480,270,2,`${R}/r13-vs-r14-fireball-1x.png`);
// ---- Roof: 2x hole crop (+ greyscale), r13 vs r14 at 1x and 2x, sheet of 12 evenly spaced MP4 frames.
await grid([await tile(`${R}/roof/roof-game.png`,[830,80,200,180],2,'r14 roof hole 2x'),await tile(`${R}/roof/roof-game.png`,[830,80,200,180],2,'greyscale',true)],400,360,2,`${R}/roof-hole-2x.png`);
await grid([await tile(`${B}/roof/roof-game.png`,[620,20,500,330],1,'r13 roof 1x'),await tile(`${R}/roof/roof-game.png`,[620,20,500,330],1,'r14 roof 1x')],500,330,2,`${R}/r13-vs-r14-roof-1x.png`);
await grid([await tile(`${B}/roof/roof-game.png`,[830,80,200,180],2,'r13 2x'),await tile(`${R}/roof/roof-game.png`,[830,80,200,180],2,'r14 2x')],400,360,2,`${R}/r13-vs-r14-roof-2x.png`);
const rf=mp4Frames(`${R}/roof/clip.mp4`,12,`${R}/roof/mp4-12`);
await grid(await Promise.all(rf.files.map((f,i)=>tile(f,[760,40,360,260],1,`${i} (mp4 f${rf.idx[i]}/${rf.total})`))),360,260,4,`${R}/roof-clip-sheet-12.png`);
// ---- Camp: 2x (+ greyscale), r13 vs r14 1x/2x, sheet of 12 evenly spaced MP4 frames.
await grid([await tile(`${R}/camp/camp-game.png`,[700,290,210,240],2,'r14 camp 2x')],420,480,1,`${R}/camp-flames-2x.png`);
await grid([await tile(`${R}/camp/camp-game.png`,[700,290,210,240],2,'r14 camp 2x greyscale',true)],420,480,1,`${R}/camp-flames-2x-grey.png`);
await grid([await tile(`${B}/camp/camp-game.png`,[700,290,210,240],2,'r13 2x grey',true),await tile(`${R}/camp/camp-game.png`,[700,290,210,240],2,'r14 2x grey',true)],420,480,2,`${R}/r13-vs-r14-camp-2x-grey.png`);
await grid([await tile(`${B}/camp/camp-game.png`,[700,290,210,240],2,'r13 2x'),await tile(`${R}/camp/camp-game.png`,[700,290,210,240],2,'r14 2x')],420,480,2,`${R}/r13-vs-r14-camp-2x.png`);
await grid([await tile(`${B}/camp/camp-game.png`,[560,250,480,330],1,'r13 camp 1x'),await tile(`${R}/camp/camp-game.png`,[560,250,480,330],1,'r14 camp 1x')],480,330,2,`${R}/r13-vs-r14-camp-1x.png`);
const cf=mp4Frames(`${R}/camp/clip.mp4`,12,`${R}/camp/mp4-12`);
await grid(await Promise.all(cf.files.map((f,i)=>tile(f,[640,230,320,340],1,`${i} (mp4 f${cf.idx[i]}/${cf.total})`))),320,340,6,`${R}/camp-clip-sheet-12.png`);
// ---- Flame-ROI motion (mean |luma diff| between consecutive evenly spaced MP4 frames, flame box only), r13 vs r14.
async function roiMotion(files,box){
  const lum=await Promise.all(files.map(f=>sharp(f).extract({left:box[0],top:box[1],width:box[2],height:box[3]}).greyscale().raw().toBuffer()));
  const d=[];for(let i=1;i<lum.length;i++){let s=0;for(let k=0;k<lum[i].length;k++)s+=Math.abs(lum[i][k]-lum[i-1][k]);d.push(s/lum[i].length);}
  d.sort((a,b)=>a-b);return {frames:files.length,median:+d[Math.floor(d.length/2)].toFixed(2),mean:+(d.reduce((a,b)=>a+b,0)/d.length).toFixed(2)};
}
const r13roof=mp4Frames(`${B}/roof/roof-clip.mp4`,12,`progress/tmp/fire-r14/r13roof-mp4`), r13camp=mp4Frames(`${B}/camp/camp-clip.mp4`,12,`progress/tmp/fire-r14/r13camp-mp4`);
const motion={note:'12 evenly spaced MP4 frames per clip; mean |luma diff| inside the flame box',
  roofHole:{box:[830,80,200,180],r13:await roiMotion(r13roof.files,[830,80,200,180]),r14:await roiMotion(rf.files,[830,80,200,180])},
  camp:{box:[700,290,210,240],r13:await roiMotion(r13camp.files,[700,290,210,240]),r14:await roiMotion(cf.files,[700,290,210,240])}};
fs.writeFileSync(`${R}/flame-motion.json`,JSON.stringify(motion,null,2));console.log(JSON.stringify(motion));
