// Evidence composition only. Every source frame is an unmodified capture of the running game.
import fs from 'node:fs';
import sharp from 'sharp';
const H='progress/shots/vfx-hitfx/r9',F='progress/shots/shared-fire-library/r3';
const label=(text,w)=>Buffer.from(`<svg width="${w}" height="28"><rect width="100%" height="100%" fill="#18131d"/><text x="8" y="20" font-family="sans-serif" font-size="15" fill="#fff0d7">${text.replaceAll('&','&amp;')}</text></svg>`);
async function sheet(file,tiles,cols=4,w=480,h=270){
  const composites=[];
  for(const [i,t]of tiles.entries()){
    const left=i%cols*w,top=Math.floor(i/cols)*(h+28);
    composites.push({input:label(t.label,w),left,top});
    let im=sharp(t.file);if(t.crop)im=im.extract(t.crop);
    composites.push({input:await im.resize(w,h,{fit:'contain',background:'#18131d'}).png().toBuffer(),left,top:top+28});
  }
  await sharp({create:{width:cols*w,height:Math.ceil(tiles.length/cols)*(h+28),channels:3,background:'#18131d'}}).composite(composites).png().toFile(file);
}
const times=[0,33,66,99,132,165,198,231,264,330,429,495];
const source=(kind,ms)=>kind==='magic_fire'&&ms>0?`${F}/hit-soot-final/magic_fire_${String(ms).padStart(3,'0')}ms.png`:`${H}/motifs/${kind}_${String(ms).padStart(3,'0')}ms.png`;
for(const kind of ['light','heavy','knockdown','magic_fire','magic_storm','magic_earth','block','otg','throw','ko']){
  const tiles=times.map(ms=>({file:source(kind,ms),label:`${kind} +${ms}ms`}));
  await sheet(`${H}/${kind}-33ms-strip.png`,tiles);
  await sheet(`${H}/${kind}-2x-strip.png`,tiles.map(t=>({...t,crop:{left:220,top:325,width:300,height:340}})),4,600,680);
}
const bdir=`${H}/brawl`,probes=JSON.parse(fs.readFileSync(`${bdir}/flash-placement.json`)),tiles=[];
for(const move of ['light_1','light_2','light_3']){
  const name=fs.readdirSync(bdir).find(f=>new RegExp(`^contact_\\d+_${move}\\.png$`).test(f));
  const start=Number(name.match(/^contact_(\d+)/)[1]);
  for(let n=0;n<5;n++)tiles.push({file:`${bdir}/brawl_${String(start+n).padStart(4,'0')}.png`,label:`${move} contact +${n*33}ms; 4 live brains`} );
  const p=probes.find(p=>p.moveId===move),crop={left:Math.max(0,Math.min(1320,Math.round(p.screen[0]-140))),top:Math.max(0,Math.min(620,Math.round(p.screen[1]-140))),width:280,height:280};
  await sharp(`${bdir}/${name}`).extract(crop).resize(560,560).png().toFile(`${H}/${move}-contact-2x.png`);
}
await sheet(`${H}/brawl-chain-33ms-strip.png`,tiles,5);
await sharp(`${F}/camp/frame_0000.png`).extract({left:688,top:340,width:245,height:250}).resize(490,500).png().toFile(`${F}/camp/crop2x.png`);
await sheet(`${F}/camp-33ms-strip.png`,[0,3,6,9,12,15,18,21,24,27,30].map(i=>({file:`${F}/camp/frame_${String(i).padStart(4,'0')}.png`,label:`camp +${i*33}ms`,crop:{left:688,top:340,width:245,height:250}})),4,490,500);
await sheet(`${H}/board-gap-fixed.png`,[
  {file:'progress/qa/board-c2/vfx-hitfx-r8/crops/light_brawl_contact_2x.png',label:'Board r8: core in gap beside body'},
  {file:`${H}/light_1-contact-2x.png`,label:'r9: torso core; projection distance 0px'},
  {file:'progress/qa/board-c2/shared-fire-library-r2/crop-magic-fire-contact-2x.png',label:'Board r2: grey centre and pale erosion marks'},
  {file:source('magic_fire',99),crop:{left:220,top:325,width:300,height:340},label:'r3: hot combustion; soot underneath'},
  {file:'progress/qa/board-c2/shared-fire-library-r2/crop-campfire-flames-2x.png',label:'Board r2: constant envelope, smooth tongues'},
  {file:`${F}/camp/crop2x.png`,label:'r3: collapse/regrowth, filaments, curled plume'}
],2,600,500);
await sheet(`${H}/motifs-sheet.png`,['light','heavy','knockdown','magic_fire','magic_storm'].flatMap(kind=>[33,66,99,132,198].map(ms=>({file:source(kind,ms),crop:{left:220,top:325,width:300,height:340},label:`${kind} +${ms}ms`}))),5,300,340);
console.log('Created brawl/10 motif strips, final fire 2x strips, camp envelope strip and board-gap panel.');
