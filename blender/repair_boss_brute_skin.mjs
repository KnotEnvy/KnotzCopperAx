// Boss-only export skin polish: continuous body blends + separate rigid spring-pelt panels.
// All geometry, UVs, colours, images, rest bones, sockets and attack timings are preserved.
import fs from 'node:fs';
const names=process.argv.slice(2);const reports={};
for(const file of names){
 const b=fs.readFileSync(file),jl=b.readUInt32LE(12),j=JSON.parse(b.subarray(20,20+jl).toString()),bs=20+jl+8,dims={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16},size={5121:1,5123:2,5125:4,5126:4},methods={5121:'readUInt8',5123:'readUInt16LE',5125:'readUInt32LE',5126:'readFloatLE'};
 const read=i=>{const a=j.accessors[i],v=j.bufferViews[a.bufferView],d=dims[a.type],w=size[a.componentType];return Array.from({length:a.count},(_,k)=>Array.from({length:d},(_,c)=>b[methods[a.componentType]](bs+(v.byteOffset||0)+(a.byteOffset||0)+k*(v.byteStride||d*w)+c*w)));};
 const p=j.meshes[0].primitives[0],P=read(p.attributes.POSITION),I=read(p.indices).flat(),J=read(p.attributes.JOINTS_0),W=read(p.attributes.WEIGHTS_0),boneNames=j.skins[0].joints.map(i=>j.nodes[i].name),nb=boneNames.length,K=file.includes('_mog')?1.55:1.6;
 const ids=new Map(),verts=[],map=[];P.forEach((p,i)=>{const k=p.join(',');if(!ids.has(k)){ids.set(k,verts.length);verts.push({p,src:[],adj:new Set(),w:new Float64Array(nb)});}const v=ids.get(k);map[i]=v;verts[v].src.push(i);for(let q=0;q<4;q++)verts[v].w[J[i][q]]=W[i][q];});
 for(let t=0;t<I.length;t+=3){const a=I.slice(t,t+3).map(i=>map[i]);for(const[x,y]of [[a[0],a[1]],[a[1],a[2]],[a[2],a[0]]]){verts[x].adj.add(y);verts[y].adj.add(x);}}
 const seen=new Set(),comps=[];for(let n=0;n<verts.length;n++){if(seen.has(n))continue;const stack=[n],a=[];seen.add(n);while(stack.length){const v=stack.pop();a.push(v);for(const q of verts[v].adj)if(!seen.has(q)){seen.add(q);stack.push(q);}}comps.push(a);}comps.sort((a,b)=>b.length-a.length);
 const idx=n=>boneNames.indexOf(n),head=idx('head'),neck=idx('neck'),chest=idx('chest'),hips=idx('hips');let collar=0,skirt=0;
 const smooth=(x,a,c)=>{const t=Math.max(0,Math.min(1,(x-a)/(c-a)));return t*t*(3-2*t);};
 for(const id of comps[0]){const v=verts[id],[x,y,z]=v.p.map(p=>p/K),keep=Math.max(smooth(y,1.70,1.86),smooth(z,.14,.27)),loss=v.w[head]*(1-keep);if(loss>.0001){v.w[head]-=loss;v.w[neck]+=loss*.6;v.w[chest]+=loss*.4;collar++;}
  // Crotch forms stay with the pelvis when both upper thighs spread in a step.
  const f=(1-smooth(Math.abs(x),.07,.15))*smooth(y,.70,.82)*(1-smooth(y,.98,1.06))*(1-smooth(Math.abs(z),.24,.36));if(f>0)for(let k=0;k<nb;k++)v.w[k]=v.w[k]*(1-f)+(k===hips?f:0);
 }
 const body=new Set(comps[0]);for(let it=0;it<10;it++){const next=new Map();for(const id of body){const v=verts[id],s=new Float64Array(v.w);let n=1;for(const q of v.adj){const u=verts[q];if(Math.hypot(...u.p.map((x,i)=>x-v.p[i]))>.12)continue;for(let k=0;k<nb;k++)s[k]+=u.w[k];n++;}for(let k=0;k<nb;k++)s[k]=v.w[k]*.35+s[k]/n*.65;next.set(id,s);}for(const[id,w]of next)verts[id].w=w;}
 for(const c of comps.slice(1)){const sums=new Float64Array(nb);for(const id of c)for(let k=0;k<nb;k++)sums[k]+=verts[id].w[k];const ks=boneNames.map((n,i)=>n.startsWith('kilt_')?sums[i]:0);if(Math.max(...ks)<.01)continue;const win=ks.indexOf(Math.max(...ks)),panel=boneNames[win].slice(5,6),bone=idx(`kilt_${panel}_2`);for(const id of c){verts[id].w.fill(0);verts[id].w[bone]=1;skirt++;}}
 const ja=j.accessors[p.attributes.JOINTS_0],wa=j.accessors[p.attributes.WEIGHTS_0],jv=j.bufferViews[ja.bufferView],wv=j.bufferViews[wa.bufferView],js=size[ja.componentType],jw=ja.componentType===5121?'writeUInt8':ja.componentType===5123?'writeUInt16LE':'writeUInt32LE';
 for(const v of verts){const top=[...v.w].map((w,i)=>({w,i})).filter(x=>x.w>1e-6).sort((a,b)=>b.w-a.w).slice(0,4),sum=top.reduce((s,x)=>s+x.w,0);for(const old of v.src)for(let q=0;q<4;q++){const x=top[q]||{w:0,i:0};b[jw](x.i,bs+(jv.byteOffset||0)+(ja.byteOffset||0)+old*(jv.byteStride||4*js)+q*js);b.writeFloatLE(x.w/sum,bs+(wv.byteOffset||0)+(wa.byteOffset||0)+old*(wv.byteStride||16)+q*4);}}
 fs.writeFileSync(file,b);reports[file]={collarVerticesReblended:collar,bodySmoothingPasses:10,peltVerticesOnOwnSpringPanel:skirt,geometryUVImagesRigUntouched:true};
}console.log(JSON.stringify(reports,null,2));
