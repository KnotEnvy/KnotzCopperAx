// Earth-family geometry/metadata check; no browser, no edits to published assets.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const out = process.argv[2] || 'progress/shots/magic-vfx/c2r13/assets.json';
const names = ['magic_basalt0','magic_basalt1','magic_basalt2','magic_earth_chip','magic_earth_boulder','magic_earth_fist'];
const rows = names.map(name => {
  const b=fs.readFileSync(`public/assets/models/${name}.glb`);
  const jl=b.readUInt32LE(12), doc=JSON.parse(b.subarray(20,20+jl).toString()), bin=b.subarray(28+jl);
  const read=id=> {
    const a=doc.accessors[id], v=doc.bufferViews[a.bufferView], size={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type];
    const width={5126:4,5125:4,5123:2,5121:1}[a.componentType], stride=v.byteStride||width*size;
    const fn={5126:'readFloatLE',5125:'readUInt32LE',5123:'readUInt16LE',5121:'readUInt8'}[a.componentType];
    return Array.from({length:a.count},(_,i)=>Array.from({length:size},(_,j)=>bin[fn]((v.byteOffset||0)+(a.byteOffset||0)+i*stride+j*width)));
  };
  const p=doc.meshes[0].primitives[0], at=Object.fromEntries(Object.entries(p.attributes).map(([k,v])=>[k,read(v)]));
  const indices=read(p.indices).flat(), positions=at.POSITION, uv=at.TEXCOORD_1, chunks=at.TEXCOORD_3;
  const key=i=>positions[i].map(n=>Math.round(n*1e6)).join(',')+':'+Math.round((1-chunks[i][1])*1000);
  const edges=new Map();
  for(let i=0;i<indices.length;i+=3) for(let e=0;e<3;e++) {
    const a=key(indices[i+e]), b=key(indices[i+(e+1)%3]);
    const k=a<b?a+'|'+b:b+'|'+a;edges.set(k,(edges.get(k)||0)+1);
  }
  const heats=uv.map(v=>v[0]), heights=positions.map(v=>v[1]);
  const maxY=Math.max(...heights), minY=Math.min(...heights);
  const maxHeat=(low,high)=>Math.max(0,...heats.filter((h,i)=>heights[i]>=low&&heights[i]<=high));
  const row={name,triangles:indices.length/3,vertices:positions.length,chunks:new Set(chunks.map(v=>v[1])).size,
    nonmanifoldEdges:[...edges.values()].filter(n=>n!==2).length,
    finite:Object.values(at).every(v=>v.flat().every(Number.isFinite)),
    heatMin:Math.min(...heats),heatMax:Math.max(...heats),baseHeat:maxHeat(minY,minY+(maxY-minY)*.2),crownHeat:maxHeat(maxY-(maxY-minY)*.2,maxY)};
  row.pass=row.finite&&row.nonmanifoldEdges===0&&row.triangles<16000;
  if(name.startsWith('magic_basalt')) row.pass&&=row.heatMin<-.8&&row.baseHeat>row.crownHeat&&row.chunks===28;
  return row;
});
const textures=[];
for(const file of ['magic_earth_normal.png','magic_earth_ao.png']) {
  const stats=await sharp('public/assets/textures/'+file).stats();
  textures.push({file,std:stats.channels.map(c=>c.stdev),min:stats.channels.map(c=>c.min)});
}
const result={pass:rows.every(r=>r.pass)&&textures.every(t=>t.std[0]>1),assets:rows,textures};
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2));
console.log(JSON.stringify(result));if(!result.pass)process.exitCode=1;
