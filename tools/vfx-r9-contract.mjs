// Contact containment, held HDR, finite pools, moving combustion/soot, and earth regression.
import assert from 'node:assert/strict';import fs from 'node:fs';import * as THREE from 'three';
import {RNG} from '../src/core/rng.js';import hit from '../src/vfx/effects/hit_spark.js';
const camera=new THREE.PerspectiveCamera(32,16/9,.1,100);camera.position.set(0,4,18);camera.lookAt(0,1,0);camera.updateMatrixWorld();
const right=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0),up=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1),fwd=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,2).negate();
const events=[],pool=name=>({emit:o=>events.push({pool:name,...o})});
const vfx={rng:new RNG(181),scale:1,game:{camera,tick:1,world:{}},camBasis:()=>({right,up,fwd}),groundY:()=>0,dustColor:()=>new THREE.Color('#5c4c3e'),shape:pool('shape'),shapeLit:pool('shapeLit'),fire:{...pool('fire'),emitCombustion:o=>events.push({pool:'combustion',...o})},add:pool('add'),alpha:pool('alpha'),debris:pool('debris'),light:(point,o)=>events.push({pool:'light',point,...o})};
let fits=0;
for(const x of [-5,0,5])for(const height of [1,1.8,3.1])for(const moveId of ['light_1','heavy','close_finisher']){
 const b={minX:x-.4,maxX:x+.4,minY:0,maxY:height,minZ:-.25,maxZ:.25},t={pos:new THREE.Vector3(x,0,0),height,typeId:height===1?'thief':'marauder',hurtboxes:()=>[b]};
 events.length=0;vfx.game.tick+=10;hit.spawn(vfx,{target:t,point:{x:x-.12,y:height*.55,z:0},dir:1,moveId,knockdown:moveId!=='light_1'});
 const paint=events.find(o=>['slash','blunt'].includes(o.clip));assert.ok(paint,moveId);
 const corners=[b.minX,b.maxX].flatMap(x=>[b.minY,b.maxY].flatMap(y=>[b.minZ,b.maxZ].map(z=>new THREE.Vector3(x,y,z).project(camera))));
 const bounds={x:[Math.min(...corners.map(p=>p.x)),Math.max(...corners.map(p=>p.x))],y:[Math.min(...corners.map(p=>p.y)),Math.max(...corners.map(p=>p.y))]};
 for(const sx of [-.5,.5])for(const sy of [-.5,.5]){
  const xx=sx*paint.size[0],yy=sy*paint.size[1],a=paint.rot;
  const p=new THREE.Vector3(...paint.pos).addScaledVector(right,xx*Math.cos(a)-yy*Math.sin(a)).addScaledVector(up,xx*Math.sin(a)+yy*Math.cos(a)).project(camera);
  assert.ok(p.x>=bounds.x[0]-1e-6&&p.x<=bounds.x[1]+1e-6&&p.y>=bounds.y[0]-1e-6&&p.y<=bounds.y[1]+1e-6,moveId+' whole quad containment');
 }
 assert.equal(events.filter(o=>o.kind==='metal').length,moveId==='light_1'?3:5);fits++;
}
for(const element of ['earth','storm','fire']){
 events.length=0;vfx.game.tick+=10;hit.spawn(vfx,{target:{pos:new THREE.Vector3(),height:1.8},point:{x:0,y:1,z:0},kind:'magic',element});
 assert.equal(events.filter(o=>o.kind==='stone').length,element==='earth'?5:0,'earth-only stone ownership');
}
THREE.TextureLoader.prototype.load=(_,done)=>{const t=new THREE.Texture();queueMicrotask(()=>done(t));return t;};
const {FirePool,preloadFireLibrary}=await import('../src/vfx/fireLib.js');await preloadFireLibrary();
const p=new FirePool({capacity:3});p.clear();const slash=p.emit({clip:'slash',life:.132,core:6});
p.update(.033);assert.equal(p.attributes.iLife.getY(0),6,'light core holds through 33ms');p.update(.066);assert.equal(p.attributes.iLife.getY(0),0,'light cools by 99ms');p.clear();
p.emit({clip:'blunt',life:.165,core:7});p.update(.066);assert.equal(p.attributes.iLife.getY(0),7,'heavy core holds through 66ms');p.clear();
const body=new THREE.Object3D(),chest=new THREE.Object3D();chest.name='chest';chest.position.y=1;body.add(chest);
p.emitCombustion({pos:[0,1,0],target:{modelRoot:body}});assert.equal(p.items.length,3);assert.equal(p.emit(),null);
const start=p.items.map(o=>[...o.pos]);body.position.set(2,-.5,0);p.update(.264);
p.items.forEach((o,i)=>{assert.ok(o.follow,'flame, smoke and residue all follow');for(let axis=0;axis<3;axis++)assert.ok(Math.abs((o.pos[axis]-start[i][axis])-[2,-.5,0][axis])<1e-6);});
for(const a of Object.values(p.attributes))assert.ok([...a.array].every(Number.isFinite));
p.update(.5);assert.equal(p.items.length,0,'no retained body after expiry');p.dispose();
const roof=new FirePool({capacity:2});roof.clear();const edge=roof.emitRoofEdge({pos:[3,4,-2]});assert.ok(edge.bed&&edge.tongue);assert.equal(roof.items.length,2);roof.dispose();
const result={pass:true,containedContacts:fits,checks:['whole rotated light/heavy/kick quad inside hurt projection','3/5 readable metal chips','33ms light and66ms heavy HDR holds','attached flame/smoke/embers through moving chest','finite capacity/delay/expiry/teardown','earth-only stone path preserved','roof full-pool lifecycle']};
fs.mkdirSync('progress/shots/shared-fire-library/r9',{recursive:true});fs.writeFileSync('progress/shots/shared-fire-library/r9/contracts.json',JSON.stringify(result,null,2));console.log(result);
