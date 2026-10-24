// Compose existing capture PNGs for hitfx review; never opens a browser.
// node tools/vfx-hitfx-evidence.mjs progress/shots/vfx-hitfx/r5
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const root=process.argv[2]||'progress/shots/vfx-hitfx/r5';
const motifs=fs.existsSync(path.join(root,'motifs-final','report.json'))?'motifs-final':'motifs';
const kinds=['light','heavy','knockdown','ko','otg','magic_fire','magic_earth','magic_storm'];
const label=(s,w)=>Buffer.from(`<svg width="${w}" height="25"><rect width="100%" height="100%" fill="#15100d"/><text x="8" y="18" font-family="sans-serif" font-size="15" fill="#ffe8c4">${s}</text></svg>`);
for(const [suffix,time] of [['a',33],['b',133]]){
 const layers=[];
 for(let i=0;i<kinds.length;i++){
  const x=(i%4)*480,y=Math.floor(i/4)*295;
  layers.push({input:label(`${kinds[i]} +${time}ms`,480),left:x,top:y});
  layers.push({input:await sharp(path.join(root,motifs,`${kinds[i]}_${suffix}.png`)).resize(480,270).toBuffer(),left:x,top:y+25});
 }
 await sharp({create:{width:1920,height:590,channels:3,background:'#15100d'}}).composite(layers).png().toFile(path.join(root,`contact_eight_${time}ms.png`));
 await sharp(path.join(root,motifs,`magic_fire_${suffix}.png`)).extract({left:700,top:180,width:430,height:540}).resize(860,1080).png().toFile(path.join(root,`magic_fire_${time}ms_crop2x.png`));
}
const layers=[];
for(let st=1;st<=2;st++)for(let i=0;i<2;i++){
 const time=i?33:0,x=i*640,y=(st-1)*385;
 layers.push({input:label(`Stage ${st} · contact +${time}ms`,640),left:x,top:y});
 layers.push({input:await sharp(path.join(root,`light-stage${st}`,`contact_${time}ms.png`)).resize(640,360).toBuffer(),left:x,top:y+25});
}
await sharp({create:{width:1280,height:770,channels:3,background:'#15100d'}}).composite(layers).png().toFile(path.join(root,'gameplay_contacts.png'));
fs.writeFileSync(path.join(root,'evidence-files.json'),JSON.stringify({motifs:kinds,times:[33,133],gameplayStages:[1,2],gameplayTimes:[0,33]},null,2));
console.log('Evidence sheets and fire crops:',root);

const brawl=path.join(root,'brawl-stage2');
if(fs.existsSync(brawl)){
 const hits=fs.readdirSync(brawl).filter(f=>/^hit_.*png$/.test(f)).sort();
 const comp=[];
 for(let i=0;i<hits.length;i++){
  const x=(i%4)*480,y=Math.floor(i/4)*295;
  comp.push({input:label(hits[i].replace('.png',''),480),left:x,top:y});
  comp.push({input:await sharp(path.join(brawl,hits[i])).resize(480,270).toBuffer(),left:x,top:y+25});
 }
 await sharp({create:{width:1920,height:Math.ceil(hits.length/4)*295,channels:3,background:'#15100d'}}).composite(comp).png().toFile(path.join(brawl,'connecting-hits-sheet.png'));
 const flagged=[18,19,20,21,28,29,30,31,57,58,59,60,88,89,90,91,92,93,94,95,96,97,98,99,112,113,114];
 const spikes=[];
 for(let i=0;i<flagged.length;i++){
  const f=flagged[i],x=(i%6)*384,y=Math.floor(i/6)*241;
  spikes.push({input:label(`frame ${f}`,384),left:x,top:y});
  spikes.push({input:await sharp(path.join(brawl,`brawl_${String(f).padStart(4,'0')}.png`)).resize(384,216).toBuffer(),left:x,top:y+25});
 }
 await sharp({create:{width:2304,height:Math.ceil(flagged.length/6)*241,channels:3,background:'#15100d'}}).composite(spikes).png().toFile(path.join(brawl,'spike-inspection.png'));
}
