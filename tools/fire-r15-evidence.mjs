// r15 shared-fire evidence: crops (1x / 2x nearest / greyscale), 12-tile sheets from evenly spaced MP4 frames, the stage-hit
// strip (crop follows the chest), the fireball strip and r14-vs-r15 panels. node tools/fire-r15-evidence.mjs
import sharp from 'sharp'; import fs from 'node:fs'; import path from 'node:path'; import { spawnSync } from 'node:child_process';
const R14='progress/shots/shared-fire-library/r14', O='progress/shots/shared-fire-library/r15';
const crop=(src,x,y,w,h,z=1,grey=false)=>{let s=sharp(src).extract({left:x,top:y,width:w,height:h}); if(z!==1) s=s.resize(w*z,h*z,{kernel:'nearest'}); if(grey) s=s.greyscale(); return s.png().toBuffer();};
async function row(out,tiles,{gap=6,labels=null}={}){const metas=await Promise.all(tiles.map(t=>sharp(t).metadata()));const H=Math.max(...metas.map(m=>m.height)),W=metas.reduce((a,m)=>a+m.width,0)+gap*(tiles.length-1);
  const comp=[];let x=0;tiles.forEach((t,i)=>{comp.push({input:t,left:x,top:0});if(labels){comp.push({input:Buffer.from(`<svg width="${metas[i].width}" height="22"><rect width="100%" height="22" fill="#000" opacity=".6"/><text x="6" y="16" font-family="sans-serif" font-size="14" fill="#fff">${labels[i]}</text></svg>`),left:x,top:0});}x+=metas[i].width+gap;});
  await sharp({create:{width:W,height:H,channels:3,background:'#111'}}).composite(comp).png().toFile(out);}
async function grid(out,tiles,cols,labels){const m=await sharp(tiles[0]).metadata();const rows=Math.ceil(tiles.length/cols);const comp=[];
  tiles.forEach((t,i)=>{const l=(i%cols)*(m.width+4),tp=Math.floor(i/cols)*(m.height+4);comp.push({input:t,left:l,top:tp});if(labels)comp.push({input:Buffer.from(`<svg width="120" height="20"><rect width="100%" height="20" fill="#000" opacity=".6"/><text x="5" y="15" font-family="sans-serif" font-size="13" fill="#fff">${labels[i]}</text></svg>`),left:l,top:tp});});
  await sharp({create:{width:cols*(m.width+4)-4,height:rows*(m.height+4)-4,channels:3,background:'#111'}}).composite(comp).png().toFile(out);}
function mp4frames(mp4,dir,n=12){fs.mkdirSync(dir,{recursive:true});const tot=+spawnSync('ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=nb_read_frames','-of','csv=p=0',mp4],{encoding:'utf8'}).stdout.trim();
  const idx=[...Array(n).keys()].map(i=>Math.round(i*(tot-1)/(n-1)));const sel=idx.map(i=>`eq(n\\,${i})`).join('+');
  const r=spawnSync('ffmpeg',['-y','-v','error','-i',mp4,'-vf',`select=${sel},scale=1600:900`,'-fps_mode','passthrough',path.join(dir,'f_%02d.png')],{encoding:'utf8'}); if(r.status) throw Error(r.stderr);return idx;}
// ---- camp
fs.copyFileSync(`${O}/camp/still-a.png`,`${O}/camp/camp-game.png`);
const CB=[700,290,210,240];
await row(`${O}/camp-flames-2x.png`,[await crop(`${O}/camp/still-a.png`,...CB,2),await crop(`${O}/camp/still-a.png`,...CB,2,true)]);
await row(`${O}/camp-flames-1x.png`,[await crop(`${O}/camp/still-a.png`,...CB),await crop(`${O}/camp/still-b.png`,...CB),await crop(`${O}/camp/still-c.png`,...CB)],{labels:['r15 a','+170 ms','+340 ms']});
await row(`${O}/r14-vs-r15-camp-1x.png`,[await crop(`${R14}/camp/camp-game.png`,560,250,480,330),await crop(`${O}/camp/still-a.png`,560,250,480,330)],{labels:['r14','r15']});
await row(`${O}/r14-vs-r15-camp-2x.png`,[await crop(`${R14}/camp/camp-game.png`,...CB,2),await crop(`${O}/camp/still-a.png`,...CB,2)],{labels:['r14','r15']});
await row(`${O}/r14-vs-r15-camp-2x-grey.png`,[await crop(`${R14}/camp/camp-game.png`,...CB,2,true),await crop(`${O}/camp/still-a.png`,...CB,2,true)],{labels:['r14','r15']});
let idx=mp4frames(`${O}/camp/clip.mp4`,`${O}/camp/mp4-12`);
await grid(`${O}/camp-clip-sheet-12.png`,await Promise.all(idx.map((_,i)=>crop(`${O}/camp/mp4-12/f_${String(i+1).padStart(2,'0')}.png`,640,230,320,340))),6,idx.map(i=>'frame '+i));
// ---- roof
fs.copyFileSync(`${O}/roof/still-a.png`,`${O}/roof/roof-game.png`);
const RB=[830,80,200,180];
await row(`${O}/roof-hole-2x.png`,[await crop(`${O}/roof/still-a.png`,...RB,2),await crop(`${O}/roof/still-a.png`,...RB,2,true)]);
await row(`${O}/roof-hole-1x.png`,[await crop(`${O}/roof/still-a.png`,...RB),await crop(`${O}/roof/still-b.png`,...RB),await crop(`${O}/roof/still-c.png`,...RB)],{labels:['r15 a','+170 ms','+340 ms']});
await row(`${O}/r14-vs-r15-roof-1x.png`,[await crop(`${R14}/roof/roof-game.png`,620,20,500,330),await crop(`${O}/roof/still-a.png`,620,20,500,330)],{labels:['r14','r15']});
await row(`${O}/r14-vs-r15-roof-2x.png`,[await crop(`${R14}/roof/roof-game.png`,...RB,2),await crop(`${O}/roof/still-a.png`,...RB,2)],{labels:['r14','r15']});
idx=mp4frames(`${O}/roof/clip.mp4`,`${O}/roof/mp4-12`);
await grid(`${O}/roof-clip-sheet-12.png`,await Promise.all(idx.map((_,i)=>crop(`${O}/roof/mp4-12/f_${String(i+1).padStart(2,'0')}.png`,760,40,360,260))),6,idx.map(i=>'frame '+i));
// ---- stage hit: 16 frames +0..+495, 240x300 crop centred on the chest
const T=JSON.parse(fs.readFileSync(`${O}/stage-fire/stage-fire-timing.json`,'utf8'));
const st=[];for(let i=0;i<16;i++){const ms=i*33,s=T.find(q=>q.ms===ms).screen;const x=Math.max(0,Math.min(1600-240,Math.round(s[0]-120))),y=Math.max(0,Math.min(900-300,Math.round(s[1]-170)));st.push(await crop(`${O}/stage-fire/fire-${String(ms).padStart(3,'0')}ms.png`,x,y,240,300));}
await grid(`${O}/stage-fire-strip-16.png`,st,8,[...Array(16).keys()].map(i=>'+'+i*33+' ms'));
await row(`${O}/r14-vs-r15-hit-1x.png`,[await crop(`${R14}/stage-fire/fire-000ms.png`,0,300,360,360),await crop(`${O}/stage-fire/fire-000ms.png`,0,300,360,360),await crop(`${R14}/stage-fire/fire-099ms.png`,0,300,360,360),await crop(`${O}/stage-fire/fire-099ms.png`,0,300,360,360)],{labels:['r14 +0','r15 +0','r14 +99','r15 +99']});
await row(`${O}/r14-vs-r15-hit-2x-99-165.png`,[await crop(`${R14}/stage-fire/fire-099ms.png`,20,370,200,250,2),await crop(`${O}/stage-fire/fire-099ms.png`,20,370,200,250,2),await crop(`${R14}/stage-fire/fire-165ms.png`,20,370,200,250,2),await crop(`${O}/stage-fire/fire-165ms.png`,20,370,200,250,2)],{labels:['r14 +99','r15 +99','r14 +165','r15 +165']});
// ---- fireball
const fb=[];for(let i=0;i<16;i++) fb.push(await crop(`${O}/fireball/impact-${String(i*33).padStart(3,'0')}ms.png`,1040,330,480,270));
await grid(`${O}/fireball-strip-crop-16.png`,fb,4,[...Array(16).keys()].map(i=>'+'+i*33+' ms'));
await row(`${O}/fireball-ignition-2x.png`,await Promise.all([0,33,66,99].map(ms=>crop(`${O}/fireball/impact-${String(ms).padStart(3,'0')}ms.png`,1050,400,220,200,2))),{labels:['+0','+33','+66','+99']});
const fbp=[];for(const ms of ['000','099','198','330']) for(const d of [R14,O]) fbp.push(await crop(`${d}/fireball/impact-${ms}ms.png`,1040,330,480,270));
await grid(`${O}/r14-vs-r15-fireball-1x.png`,fbp,2,['r14 +0','r15 +0','r14 +99','r15 +99','r14 +198','r15 +198','r14 +330','r15 +330']);
console.log('evidence ok');
