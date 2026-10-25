// r12 shared-fire evidence: strips, 2x crops and r11-vs-r12 panels (sharp, nearest-neighbour; no GPU).
import sharp from 'sharp'; import fs from 'node:fs'; import path from 'node:path';
const R12='progress/shots/shared-fire-library/r12', R11='progress/qa/board-c2/shared-fire-library-r11';
const label=(w,h,t)=>Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="18" fill="#000" opacity=".7"/><text x="4" y="13" font-family="monospace" font-size="12" fill="#ffd">${t}</text></svg>`);
async function tile(file,box,scale,text){
  const img=sharp(file).extract({left:box[0],top:box[1],width:box[2],height:box[3]}).resize(box[2]*scale,box[3]*scale,{kernel:'nearest'});
  const buf=await img.png().toBuffer();
  return sharp(buf).composite([{input:label(box[2]*scale,box[3]*scale,text),top:0,left:0}]).png().toBuffer();
}
async function grid(tiles,w,h,cols,out){
  const rows=Math.ceil(tiles.length/cols);
  await sharp({create:{width:w*cols,height:h*rows,channels:3,background:'#000'}})
    .composite(tiles.map((t,i)=>({input:t,left:(i%cols)*w,top:Math.floor(i/cols)*h}))).png().toFile(out);
  console.log('wrote',out);
}
const ms=Array.from({length:16},(_,i)=>String(i*33).padStart(3,'0'));
// Body-follow crop box: the victim moves right with knockback, so track the chest from fire-timing.json.
async function strip(dir,prefix,timing,out,w=240,h=270,scale=1){
  const T=fs.existsSync(timing)?JSON.parse(fs.readFileSync(timing)):null;
  const tiles=[];
  for(const [i,m] of ms.entries()){
    const f=path.join(dir,`${prefix}-${m}ms.png`); if(!fs.existsSync(f)) continue;
    let cx=420; if(T&&T[i]&&T[i].screen) cx=T[i].screen[0];
    const box=[Math.max(0,Math.min(1600-w,Math.round(cx-w/2))),360,w,h];
    tiles.push(await tile(f,box,scale,`+${m}ms`));
  }
  await grid(tiles,w*scale,h*scale,8,out);
}
const job=process.argv[2]||'all';
if(job==='hit'||job==='all'){
  await strip(`${R12}/fire`,'fire',`${R12}/fire/screen.json`,`${R12}/fire-hit-strip-000-495ms.png`);
  await strip(`${R12}/fire`,'fire',`${R12}/fire/screen.json`,`${R12}/fire-hit-strip-2x.png`,240,270,2);
  const s=JSON.parse(fs.readFileSync(`${R12}/fire/screen.json`));
  const b=x=>[Math.round(x-100),370,200,240];
  await grid([await tile(`${R12}/fire/fire-099ms.png`,b(s[3].screen[0]),2,'r12 +99ms 2x')],400,480,1,`${R12}/fire-099ms-2x.png`);
  await grid([await tile(`${R12}/fire/fire-000ms.png`,[Math.round(s[0].screen[0]-170),370,240,240],2,'r12 +0ms ignition 2x')],480,480,1,`${R12}/fire-000ms-2x.png`);
  await grid([await tile(`${R11}/fire-hit/fire-099ms.png`,[300,380,200,240],2,'r11 +99ms 2x'),await tile(`${R12}/fire/fire-099ms.png`,b(s[3].screen[0]),2,'r12 +99ms 2x')],400,480,2,`${R12}/r11-vs-r12-hit.png`);
}
if(job==='ball'||job==='all'){
  const T=JSON.parse(fs.readFileSync(`${R12}/fireball/screen.json`));
  const tiles=[];
  for(const [i,m] of ms.entries()){const f=`${R12}/fireball/impact-${m}ms.png`;if(!fs.existsSync(f))continue;
    const cx=T[i]?.screen?.[0]??1160;tiles.push(await tile(f,[Math.max(0,Math.min(1360,Math.round(cx-120))),330,240,300],1,`+${m}ms`));}
  await grid(tiles,240,300,8,`${R12}/fireball-strip-000-495ms.png`);
}
if(job==='roof'||job==='all'){
  await grid([await tile(`${R12}/roof/roof-game.png`,[620,20,500,330],2,'r12 roof 2x')],1000,660,1,`${R12}/roof-hole-2x.png`);
  await grid([await tile(`${R11}/roof/roof-game.png`,[620,20,500,330],1,'r11 roof (game camera, 1x)'),await tile(`${R12}/roof/roof-game.png`,[620,20,500,330],1,'r12 roof (game camera, 1x)'),
    await tile(`${R11}/roof/roof-game.png`,[740,80,300,200],2,'r11 2x'),await tile(`${R12}/roof/roof-game.png`,[740,80,300,200],2,'r12 2x')].map(x=>x),600,400,2,`${R12}/r11-vs-r12-roof.png`);
  const fr=fs.readdirSync(`${R12}/roof`).filter(f=>/^roof_\d+\.png$/.test(f)).sort();
  const pick=fr.filter((_,i)=>i%Math.max(1,Math.floor(fr.length/6))===0).slice(0,6);
  await grid(await Promise.all(pick.map(f=>tile(`${R12}/roof/${f}`,[620,20,500,330],1,f))),500,330,3,`${R12}/roof-motion.png`);
}
if(job==='camp'||job==='all'){
  await grid([await tile(`${R12}/camp/camp-game.png`,[620,220,360,390],2,'r12 camp 2x')],720,780,1,`${R12}/campfire-flames-2x.png`);
  await grid([await tile(`${R11}/camp-still/shot.png`,[620,220,360,390],1,'r11 camp'),await tile(`${R12}/camp/camp-game.png`,[620,220,360,390],1,'r12 camp')],360,390,2,`${R12}/r11-vs-r12-camp.png`);
  const fr=fs.readdirSync(`${R12}/camp`).filter(f=>/^camp_\d+\.png$/.test(f)).sort().slice(0,10);
  await grid(await Promise.all(fr.map(f=>tile(`${R12}/camp/${f}`,[640,260,320,340],1,f))),320,340,5,`${R12}/camp-strip.png`);
}
