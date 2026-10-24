// Regression coverage for the board's contact, small-victim and floor-ripple failures.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { RNG } from '../src/core/rng.js';
import hit from '../src/vfx/effects/hit_spark.js';
import ripple from '../src/vfx/effects/time_ripple.js';
import { ScreenFx, HIT_JUICE } from '../src/vfx/ScreenFx.js';
import { bodyContact, frontContact } from '../src/vfx/contact.js';

const camera=new THREE.PerspectiveCamera(32,16/9,.1,100);
camera.position.set(0,4,18);camera.lookAt(0,1,0);camera.updateMatrixWorld();
const events=[];
const pool=name=>({emit:o=>events.push({pool:name,...o})});
const vfx={rng:new RNG(181),scale:1,game:{camera,tick:1,world:{}},camBasis:()=>({right:new THREE.Vector3(1,0,0),up:new THREE.Vector3(0,1,0),fwd:new THREE.Vector3(0,0,-1)}),
  groundY:()=>0,dustColor:()=>new THREE.Color('#5c4c3e'),shape:pool('shape'),shapeLit:pool('shapeLit'),fire:pool('fire'),add:pool('add'),alpha:pool('alpha'),debris:pool('debris'),
  light:(point,o)=>events.push({pool:'light',point,...o})};
const box={minX:-.3,maxX:.3,minY:0,maxY:1.8,minZ:-.25,maxZ:.25};
const target=()=>({typeId:'marauder',pos:new THREE.Vector3(),height:1.8,hurtboxes:()=>[box]});
const opts={point:{x:-1,y:1,z:0},dir:1,moveId:'light_1'};
hit.spawn(vfx,{...opts,target:target()});
const light=events.find(o=>o.pool==='fire'&&o.clip==='slash');
assert.ok(light&&light.size[0]>=1.7&&light.life<=.13&&light.core>=8,'directional light wedge lifetime and HDR core');
assert.ok(events.some(o=>o.pool==='light'&&o.point.y>.5&&o.life<=.08),'warm chest/floor light');
events.length=0;
for(let i=0;i<2;i++)hit.spawn(vfx,{...opts,target:target(),moveId:'heavy',knockdown:true});
const heavy=events.filter(o=>o.pool==='fire'&&o.clip==='blunt');
assert.equal(heavy.length,2);
assert.ok(heavy.every(o=>o.size[0]>light.size[0]&&o.life<=.15));
assert.notDeepEqual(heavy[0].size,heavy[1].size);
assert.notEqual(heavy[0].skew,heavy[1].skew,'simultaneous contacts have seeded deformation');
assert.ok(events.filter(o=>o.shape==='ring').every(o=>o.mode==='plane'&&o.pos[1]<.05&&o.life<=.15));
events.length=0;
hit.spawn(vfx,{...opts,target:target(),kind:'magic',element:'fire'});
const fire=events.find(o=>o.clip==='fireBurst'),smoke=events.find(o=>o.clip==='smoke');
assert.ok(fire.size[0]>=.8&&fire.size[0]<=1.4&&fire.pos[0]<0&&fire.life<=.37);
assert.ok(smoke.delay+smoke.life>=.45&&smoke.fadeIn>0&&smoke.vel[1]>0);
assert.ok(!events.some(o=>o.pool==='debris'&&o.kind!=='metal'),'non-earth hits cannot emit stone');
events.length=0;
hit.spawn(vfx,{...opts,target:target(),moveId:'close_finisher',knockdown:true});
assert.ok(events.some(o=>o.shape==='ring'&&o.mode!=='plane'&&o.life<=.08),'kick has a distinct compressed shock arc');
events.length=0;
ripple.spawn(vfx,{});
const rings=events.filter(o=>o.shape==='ring');
assert.equal(rings.length,2);
assert.ok(rings.every(o=>o.mode==='plane'&&o.pos[1]<.05&&o.life+(o.delay||0)<=.15),'dodge cannot create a dome');

let flash;
const juice=Object.create(ScreenFx.prototype);
juice.game={};juice.vfx={hitFlash:{hit:(t,p,o)=>{flash=o;}}};
juice.onHit({...opts,target:{...target(),typeId:'thief',height:1,flash(){}},knockdown:true});
assert.ok(flash.strength<=.16&&flash.radius<=.22&&flash.ticks<=2);
assert.ok(Object.values(HIT_JUICE).every(o=>o.ca<=.0008),'bound contact chromatic pulse');

let projections=0;
for(const p of [{x:-5,y:1,z:0},{x:5,y:4,z:2}]){
  const q=bodyContact({target:target(),point:p}),f=frontContact(q,camera,1.15);
  const a=new THREE.Vector3(q.x,q.y,q.z).project(camera),b=new THREE.Vector3(f.x,f.y,f.z).project(camera);
  assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<1e-12);projections++;
}
THREE.TextureLoader.prototype.load=(_,done)=>{const t=new THREE.Texture();queueMicrotask(()=>done(t));return t;};
const {FirePool,preloadFireLibrary}=await import('../src/vfx/fireLib.js');await preloadFireLibrary();
const p=new FirePool({capacity:3});p.clear();
p.emit({clip:'slash',life:.12,skew:.25,mirror:-1,radiance:.95});
p.emit({clip:'smoke',delay:.05,fadeIn:.1,life:.5,alpha:.6});
p.emit({clip:'flame',loop:true,rooted:true});
assert.equal(p.emit(),null);assert.equal(p.attributes.iExtra.getW(0),-1.25);
p.update(.1);assert.equal(p.attributes.iLife.getY(0),0,'impact HDR retires before 66ms');assert.ok(Math.abs(p.attributes.iTint.getW(1)-.3)<1e-6);
p.update(.033);assert.ok(p.items.every(o=>o.row!==4));
for(const a of Object.values(p.attributes))assert.ok([...a.array].every(Number.isFinite));
p.update(.6);assert.equal(p.items.length,1);p.dispose();
const roof=new FirePool({capacity:4});roof.clear();const anchor=[3,4,-2];const edge=roof.emitRoofEdge({pos:anchor,height:1.4,width:.8});assert.ok(edge.bed&&edge.tongue);assert.equal(roof.mesh.geometry.instanceCount,2);assert.ok(roof.items.every(o=>o.rooted&&o.pos[0]===anchor[0]));roof.dispose();
const result={pass:true,projections,checks:['light size/lifetime/light response','seeded heavy silhouettes','floor-only rings','bounded fire and lingering smoke','earth-only stone / metal physical fragments','kick core','small-victim exposure','chromatic pulse cap','foreground anchor invariance','instance skew/delay/capacity/teardown']};
fs.mkdirSync('progress/shots/shared-fire-library/r7',{recursive:true});
fs.writeFileSync('progress/shots/shared-fire-library/r7/contracts.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
