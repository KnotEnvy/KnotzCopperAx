// Mechanical crops/resizes of real game captures; no reconstructed or painted game pixels.
import fs from 'node:fs';import sharp from 'sharp';
const H='progress/shots/vfx-hitfx/r10',F='progress/shots/shared-fire-library/r4';
const label=(s,w)=>Buffer.from(`<svg width="${w}" height="28"><rect width="100%" height="100%" fill="#19131b"/><text x="8" y="20" font-family="sans-serif" font-size="14" fill="#ffefd7">${s.replaceAll('&','&amp;')}</text></svg>`);
async function sheet(file,tiles,cols=4,w=400,h=225){
 const composites=[];for(const [i,t]of tiles.entries()){
  const left=i%cols*w,top=Math.floor(i/cols)*(h+28);composites.push({input:label(t.label,w),left,top});
  let im=sharp(t.file);if(t.crop)im=im.extract(t.crop);
  composites.push({input:await im.resize(w,h,{fit:'contain',background:'#19131b'}).png().toBuffer(),left,top:top+28});
 }
 await sharp({create:{width:cols*w,height:Math.ceil(tiles.length/cols)*(h+28),channels:3,background:'#19131b'}}).composite(composites).png().toFile(file);
}
const B=`${H}/brawl-verified`,heavy=`${H}/heavy-brawl/heavy-contact-000ms.png`;
const light=`${B}/contact_3_light_1.png`;
for(const [kind,file]of [['light',light],['heavy',heavy]]){
 fs.copyFileSync(file,`${H}/${kind}-brawl-native.png`);
 await sharp(file).resize(400,225).png().toFile(`${H}/${kind}-brawl-400x225.png`);
 const crop=kind==='light'?{left:945,top:405,width:225,height:235}:{left:945,top:400,width:280,height:250};
 await sharp(file).extract(crop).resize(crop.width*2,crop.height*2).png().toFile(`${H}/${kind}-brawl-contact-2x.png`);
}
await sheet(`${H}/brawl-contacts.png`,[{file:light,label:'Light: real input / four live enemy brains'},{file:heavy,label:'Heavy: real input / immediate directional star'}],2,800,450);
const times=Array.from({length:16},(_,i)=>i*33),crop={left:265,top:285,width:250,height:370};
const source=(kind,ms)=>kind==='magic_fire'?`${F}/fire-verified/magic_fire_${String(ms).padStart(3,'0')}ms.png`:`${H}/motifs/${kind}_${String(ms).padStart(3,'0')}ms.png`;
for(const kind of ['light','heavy','knockdown','magic_fire','magic_storm','magic_earth','block','otg','throw','ko']){
 const tiles=times.map(ms=>({file:source(kind,ms),label:`${kind} +${ms}ms / game camera`}));
 await sheet(`${H}/${kind}-33ms-game-strip.png`,tiles);
 if(['magic_fire','light','heavy','magic_storm'].includes(kind))await sheet(`${H}/${kind}-2x-strip.png`,tiles.map(t=>({...t,crop})),4,500,740);
}
await sheet(`${H}/motifs-sheet.png`,['light','heavy','knockdown','magic_fire','magic_storm'].flatMap(kind=>[0,33,66,99,132].map(ms=>({file:source(kind,ms),crop,label:`${kind} +${ms}ms`}))),5,250,370);
await sheet(`${H}/brawl-chain-33ms-strip.png`,[3,9,17].flatMap((frame,i)=>Array.from({length:5},(_,j)=>({file:`${B}/brawl_${String(frame+j).padStart(4,'0')}.png`,label:`light_${i+1} +${j*33}ms; actual gameplay`}))),5);
await sheet(`${H}/heavy-brawl-33ms-strip.png`,Array.from({length:7},(_,i)=>({file:`${H}/heavy-brawl/heavy-contact-${String(i*33).padStart(3,'0')}ms.png`,label:`real heavy +${i*33}ms`})),4);
await sharp(`${F}/camp-final/frame_0000.png`).extract({left:675,top:165,width:290,height:425}).resize(580,850).png().toFile(`${F}/camp-2x.png`);
await sharp(`${F}/roof-final/shot.png`).extract({left:640,top:65,width:490,height:345}).resize(980,690).png().toFile(`${F}/roof-2x.png`);
await sheet(`${H}/board-gap-fixed.png`,[
 {file:'progress/qa/board-c2/vfx-hitfx-r9/crops/light_contact_2x.png',label:'Board r9: white disc erases contact'},
 {file:`${H}/light-brawl-contact-2x.png`,label:'r10: directional colored spikes; body visible'},
 {file:'progress/qa/board-c2/vfx-hitfx-r9/crops/heavy_contact_2x.png',label:'Board r9: same disc at heavy contact'},
 {file:`${H}/heavy-brawl-contact-2x.png`,label:'r10: larger immediate seven-spike heavy'},
 {file:'progress/qa/board-c2/shared-fire-library-r3/crop-magic-fire-contact-2x.png',label:'Board r3: round petals and bottom wedges'},
 {file:source('magic_fire',99),crop,label:'r4: small torn tongues with internal gaps'},
 {file:source('magic_fire',132),crop,label:'r4 +132ms: target readable through cooling fire'},
 {file:source('magic_fire',429),crop,label:'r4 +429ms: soot rises after combustion'},
 {file:`${F}/camp-2x.png`,label:'r4: continuous thinning camp plume'},
 {file:`${F}/roof-2x.png`,label:'r4: clustered burnt edges / one roof plume'}
 ],2,600,450);
console.log('Created native/400x225 brawl contacts, ten 33ms motif strips, fire/soot strip and board-gap panel.');
