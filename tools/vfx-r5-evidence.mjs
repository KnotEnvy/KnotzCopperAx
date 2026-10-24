// Crops and labelled comparisons of real running-game pixels; no repainted effects.
import fs from 'node:fs';
import sharp from 'sharp';
const H='progress/shots/vfx-hitfx/r11',F='progress/shots/shared-fire-library/r5';
const read=f=>JSON.parse(fs.readFileSync(f));
const label=(s,w)=>Buffer.from(`<svg width="${w}" height="30"><rect width="100%" height="100%" fill="#19131b"/><text x="8" y="21" font-family="sans-serif" font-size="14" fill="#ffefd7">${s.replaceAll('&','&amp;').replaceAll('<','&lt;')}</text></svg>`);
async function sheet(file,tiles,cols=4,w=400,h=225){
  const parts=[];
  for(const [i,t]of tiles.entries()){
    const left=i%cols*w,top=Math.floor(i/cols)*(h+30);
    parts.push({input:label(t.label,w),left,top});
    let im=sharp(t.file);if(t.crop)im=im.extract(t.crop);
    parts.push({input:await im.resize(w,h,{fit:'contain',background:'#19131b'}).png().toBuffer(),left,top:top+30});
  }
  await sharp({create:{width:cols*w,height:Math.ceil(tiles.length/cols)*(h+30),channels:3,background:'#19131b'}}).composite(parts).png().toFile(file);
}
const light=`${H}/brawl-final/contact_3_light_1.png`,heavy=`${H}/heavy/heavy-contact-000ms.png`;
const lp=read(`${H}/brawl-final/flash-placement.json`).find(p=>p.moveId==='light_1'),hp=read(`${H}/heavy/contacts.json`).probes.find(p=>p.moveId==='heavy'&&p.targetKind!=='prop');
const region=p=>({left:Math.max(0,Math.min(1280,Math.round(p.screen[0]-160))),top:Math.max(0,Math.min(560,Math.round(p.screen[1]-165))),width:320,height:340});
for(const [kind,file,probe]of [['light',light,lp],['heavy',heavy,hp]]){
  fs.copyFileSync(file,`${H}/${kind}-brawl-native.png`);
  await sharp(file).resize(400,225).png().toFile(`${H}/${kind}-brawl-400x225.png`);
  await sharp(file).extract(region(probe)).resize(640,680,{kernel:'nearest'}).png().toFile(`${H}/${kind}-contact-2x.png`);
}
await sheet(`${H}/heavy-0-33-66-99ms.png`,[0,33,66,99].map(ms=>({file:`${H}/heavy/heavy-contact-${String(ms).padStart(3,'0')}ms.png`,label:`Real Heavy +${ms}ms / four live enemy brains`})),4);
await sheet(`${H}/heavy-contact-2x-strip.png`,[0,33,66,99,132,165,198].map(ms=>({file:`${H}/heavy/heavy-contact-${String(ms).padStart(3,'0')}ms.png`,crop:region(hp),label:`Heavy +${ms}ms`})),4,480,510);
await sheet(`${H}/light-chain.png`,[3,9,17].map((frame,i)=>({file:`${H}/brawl-final/contact_${frame}_light_${i+1}.png`,label:`Real Light ${i+1} / input + CombatSystem`})),3,533,300);
const fireCrop={left:265,top:285,width:250,height:370},fire=ms=>`${F}/fire/magic_fire_${String(ms).padStart(3,'0')}ms.png`;
const fireFrames=Array.from({length:16},(_,i)=>i*33);
await sheet(`${F}/fire-hit-0-495ms.png`,fireFrames.map(ms=>({file:fire(ms),label:`Fire hit +${ms}ms / game camera`})),4);
await sheet(`${F}/fire-hit-2x-strip.png`,fireFrames.map(ms=>({file:fire(ms),crop:fireCrop,label:`Fire +${ms}ms / unchanged camera`})),4,400,592);
await sharp(fire(0)).extract(fireCrop).resize(500,740,{kernel:'nearest'}).png().toFile(`${F}/fire-hit-contact-2x.png`);
await sharp(`${F}/camp-final/frame_0000.png`).extract({left:675,top:165,width:290,height:425}).resize(580,850,{kernel:'nearest'}).png().toFile(`${F}/camp-2x.png`);
await sharp(`${F}/roof/shot.png`).extract({left:640,top:65,width:490,height:345}).resize(980,690,{kernel:'nearest'}).png().toFile(`${F}/roof-2x.png`);
await sharp(`${H}/kick-verified/kick-contact-000ms.png`).extract({left:1060,top:350,width:400,height:310}).resize(800,620,{kernel:'nearest'}).png().toFile(`${H}/kick-2x.png`);
await sheet(`${H}/kick-33ms-strip.png`,[0,33,66,99,132].map(ms=>({file:`${H}/kick-verified/kick-contact-${String(ms).padStart(3,'0')}ms.png`,label:`Real close_finisher +${ms}ms / debris 0`})),3);
await sheet(`${H}/storm-and-dodge.png`,['storm-000ms','storm-033ms','storm-066ms','storm-099ms','dodge-000ms','dodge-066ms','dodge-165ms'].map(name=>({file:`${H}/storm/${name}.png`,label:name})),4);
await sheet(`${H}/board-gap-fixed.png`,[
  {file:'progress/qa/board-c2/vfx-hitfx-r10/light-400x225.png',label:'Board r10: thin light hit at 400x225'},
  {file:`${H}/light-brawl-400x225.png`,label:'r11: connected wedges visible at 400x225'},
  {file:'progress/qa/board-c2/vfx-hitfx-r10/heavy-400x225.png',label:'Board r10: perfect-dodge dome overlaps Heavy'},
  {file:`${H}/heavy-brawl-400x225.png`,label:'r11: Heavy dominant; dodge uses short floor rings'},
  {file:'progress/qa/board-c2/vfx-hitfx-r10/kick/kick-final.png',label:'Board r10: thief flash / no kick star'},
  {file:`${H}/kick-verified/kick-contact-000ms.png`,label:'r11: kick core / bounded small-victim flash'}
],2,600,338);
await sheet(`${F}/board-gap-fixed.png`,[
  {file:'progress/qa/board-c2/shared-fire-library-r4/fire-hit/hit-crop2x.png',label:'Board r4: joined luminous waist apron'},
  {file:fire(0),crop:fireCrop,label:'r5: staggered separated roots / strike-side offset'},
  {file:fire(66),crop:fireCrop,label:'r5 +66ms: face and chest remain visible'},
  {file:fire(264),crop:fireCrop,label:'r5 +264ms: dark brown soot after combustion'},
  {file:fire(429),crop:fireCrop,label:'r5 +429ms: soot still rises / low chromatic pulse'},
  {file:`${F}/camp-2x.png`,label:'r5: orange core / dark channels / sharp tips'},
  {file:'progress/qa/board-c2/shared-fire-library-r4/stage1-roof/shot.png',label:'Board r4: isolated pale-based roof tufts'},
  {file:`${F}/roof/shot.png`,label:'r5: dark roots on current Stages ember anchors'}
],2,600,450);
console.log('Created r11/r5 native, thumbnail, time-strip and board comparison evidence.');
