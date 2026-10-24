// Offline evidence composition only; all game frames come from tools/capture.mjs.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const H='progress/shots/vfx-hitfx/r8',F='progress/shots/shared-fire-library/r2';
const C=fs.existsSync(`${F}/camp-root-final/report.json`)?`${F}/camp-root-final`:`${F}/camp-final`;
const label=(txt,w)=>Buffer.from(`<svg width="${w}" height="27"><rect width="100%" height="100%" fill="#18131d"/><text x="8" y="19" font-family="sans-serif" font-size="15" fill="#fff0d7">${txt}</text></svg>`);
async function sheet(file,tiles,cols=tiles.length,w=640,h=360){
 const comps=[];
 for(const [i,t]of tiles.entries()){
  const x=(i%cols)*w,y=Math.floor(i/cols)*(h+27);
  comps.push({input:label(t.label,w),left:x,top:y});
  let input=sharp(t.file);if(t.crop)input=input.extract(t.crop);
  comps.push({input:await input.resize(w,h,{fit:'contain',background:'#18131d'}).png().toBuffer(),left:x,top:y+27});
 }
 await sharp({create:{width:w*cols,height:Math.ceil(tiles.length/cols)*(h+27),channels:3,background:'#18131d'}}).composite(comps).png().toFile(file);
}
const times=[0,33,66,99,132,165,198,264];
for(const kind of ['light','heavy','knockdown','magic_fire','magic_storm']){
 const tiles=times.map(ms=>({file:`${H}/motifs-final/${kind}_${String(ms).padStart(3,'0')}ms.png`,label:`${kind} +${ms}ms · game camera`}));
 await sheet(`${H}/${kind}-33ms-strip.png`,tiles,4);
 await sheet(`${H}/${kind}-2x-strip.png`,tiles.map(t=>({...t,crop:{left:220,top:325,width:300,height:340}})),4,600,680);
}
await sharp(`${C}/frame_0000.png`).extract({left:688,top:340,width:245,height:250}).resize(490,500).png().toFile(`${C}/crop2x.png`);
await sheet(`${F}/camp-33ms-strip.png`,[0,1,2,3,4,5,6,7].map(i=>({file:`${C}/frame_${String(i).padStart(4,'0')}.png`,label:`camp +${i*33}ms`})),4);
await sheet(`${F}/camp-crop-33ms-strip.png`,[0,1,2,3,4,5,6,7].map(i=>({file:`${C}/frame_${String(i).padStart(4,'0')}.png`,label:`camp +${i*33}ms · 2x`,crop:{left:688,top:340,width:245,height:250}})),4,490,500);
const bdir=`${H}/brawl-final`,b=JSON.parse(fs.readFileSync(`${bdir}/contacts.json`));
const chain=b.hits.filter(h=>h.attacker==='brann'&&/^light_[123]$/.test(h.moveId));
const tiles=[];
for(const move of ['light_1','light_2','light_3']){
 const name=fs.readdirSync(bdir).filter(f=>new RegExp(`^contact_\\d+_${move}\\.png$`).test(f)).sort((a,b)=>Number(a.match(/^contact_(\d+)/)[1])-Number(b.match(/^contact_(\d+)/)[1]))[0];
 if(!name)throw Error('Missing chain contact '+move);
 const start=Number(name.match(/^contact_(\d+)/)[1]);
 for(let n=0;n<5;n++)tiles.push({file:`${bdir}/brawl_${String(start+n).padStart(4,'0')}.png`,label:`${move} contact +${n*33}ms · four live brains`});
}
await sheet(`${H}/brawl-chain-33ms-strip.png`,tiles,5);
// Reference panel is an evidence comparison, never a shipped texture or UI.
const beforeCamp='progress/qa/board-c2/shared-fire-library-r1/crop-campfire-flames-2x.png';
const beforeHit='progress/qa/board-c2/vfx-hitfx-r7/crops/light_brawl_contact_2x.png';
const contact=fs.readdirSync(bdir).find(f=>/^contact_\d+_light_1\.png$/.test(f));
const hit=chain.find(h=>h.moveId==='light_1'),report=JSON.parse(fs.readFileSync(`${bdir}/report.json`));
// Whole-frame before/after avoids inventing a crop coordinate for the moving game camera.
await sheet(`${H}/board-gap-fixed.png`,[
 {file:beforeHit,label:'Board gap: rigid held crescent'},
 {file:`${bdir}/${contact}`,label:'r8: contact flash + blade direction + sparks',crop:{left:950,top:390,width:280,height:280}},
 {file:beforeCamp,label:'Board gap: outlined parallel tongues'},
 {file:`${C}/crop2x.png`,label:'r2: fused bright base + reshaping flames'}
],2,700,450);
const result={source:'real GPU captures; unchanged CombatSystem',chain:chain.map(h=>({move:h.moveId,tick:h.tick,live:h.live,brains:h.brains,swing:h.swing,fire:h.fire,chips:h.chips})),errors:report.pageErrors.concat(report.consoleErrors,report.info.errors)};
fs.writeFileSync(`${H}/chain-verification.json`,JSON.stringify(result,null,2));
console.log('Created motif/camp/brawl 33ms strips, 2x crops, and board-gap panel');
