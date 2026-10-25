// r13 fire regression (r12 contract + r13 checks: body-axis lean/compression, local roof glow, shader rules): procedural body fire rides its bones through knockback,
// burns away gradually then retires; roof fuel stays on the actual mesh; seeds are valid; attributes finite; capacity holds.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {emitHutFire,finishHutFuel} from '../src/levels/stages/stage1/roofFire.js';
THREE.TextureLoader.prototype.load=(_,done)=>{const t=new THREE.Texture();queueMicrotask(()=>done(t));return t;};
const {FirePool,preloadFireLibrary,FIRE_CLIPS}=await import('../src/vfx/fireLib.js');await preloadFireLibrary();
const pool=new FirePool({capacity:16});pool.clear();
const body=new THREE.Object3D();
for(const [n,y,x] of [['hips',.95,0],['chest',1.1,0],['forearm_R',1.0,.3],['upperarm_L',1.3,-.25],['thigh_R',.7,.1]]){const b=new THREE.Object3D();b.name=n;b.position.set(x,y,0);body.add(b);}
pool.emitCombustion({pos:[0,1.1,.6],target:{modelRoot:body},scale:1,dir:1});
const items=[...pool.items], origin=new Map(items.map(o=>[o,[...o.pos]]));
const rows=items.map(o=>o.row);
assert.ok(rows.includes(FIRE_CLIPS.ignite),'ignition burst on the contact frame');
assert.ok(rows.filter(r=>r===FIRE_CLIPS.burn).length>=2 && rows.filter(r=>r===FIRE_CLIPS.blaze).length>=4,'torso sheets + limb/hip tongues');
assert.ok(items.every(o=>o.seed>=0&&o.seed<1),'seeds in [0,1)');
assert.equal(new Set(items.filter(o=>o.row>=8).map(o=>o.seed.toFixed(4))).size,items.filter(o=>o.row>=8).length,'every procedural instance has its own seed');
body.position.set(2,-.5,.2);body.updateMatrixWorld(true);pool.update(.150);
for(const o of pool.items.filter(o=>o.age>=0)){assert.ok(o.follow,'attached');const s=origin.get(o);for(let a=0;a<3;a++)assert.ok(Math.abs(o.pos[a]-s[a]-[2,-.5,.2][a])<1e-6,'rides the body');}
// Burn-away: erosion of the chest sheet rises monotonically; its alpha then decreases; all retire.
const sheet=pool.items.find(o=>o.row===FIRE_CLIPS.burn),idx=()=>pool.items.filter(o=>o.age>=0).indexOf(sheet);
const burn=[],alpha=[];for(let i=0;i<12;i++){pool.update(.033);const k=idx();if(k<0)break;burn.push(pool.attributes.iLife.getX(k));alpha.push(pool.attributes.iTint.getW(k));}
assert.ok(burn.every((b,i)=>i===0||b>burn[i-1]),'burn-away increases every sample');
const late=alpha.slice(-3);assert.ok(late.every((a,i)=>i===0||a<late[i-1]),'final alpha fade decreases');
pool.update(1);assert.equal(pool.items.length,0,'all transient layers retire');pool.dispose();
// r13: a body going horizontal leans its flames along the body and compresses them (shorter, wider).
const p2=new FirePool({capacity:16});p2.clear();
const body2=new THREE.Object3D();for(const [n,y,x] of [['hips',.95,0],['chest',1.4,0]]){const b=new THREE.Object3D();b.name=n;b.position.set(x,y,0);body2.add(b);}
body2.updateMatrixWorld(true);p2.emitCombustion({pos:[0,1.4,.6],target:{modelRoot:body2},scale:1,dir:1});
p2.update(.03);const live=()=>p2.items.filter(o=>o.age>=0&&o.tilt);const sh0=live().map(o=>[o,p2.attributes.iFrame.getY(p2.items.filter(q=>q.age>=0).indexOf(o))]);
assert.ok(sh0.length>=2,'body flames carry the chest-hips axis');
const up0=live().map(o=>p2.attributes.iPosition.getW(p2.items.filter(q=>q.age>=0).indexOf(o)));
assert.ok(up0.every(r=>Math.abs(r)<.05),'upright body: upright flames');
body2.getObjectByName('chest').position.set(.45,.95,0);body2.updateMatrixWorld(true);p2.time+=1e-3;p2.update(1e-6);
for(const [o,h0] of sh0){const k=p2.items.filter(q=>q.age>=0).indexOf(o);
  assert.ok(p2.attributes.iPosition.getW(k)<-.5,'horizontal body: flame leans toward the chest side');
  assert.ok(p2.attributes.iFrame.getY(k)<h0*.6,'horizontal body: flame compressed along the body');}
p2.dispose();
// Rotated sloping test roof: roof flames + one radiance pool; fuel vertices remain on the actual mesh.
const group=new THREE.Group(),geo=new THREE.PlaneGeometry(5,4);geo.rotateX(-Math.PI*.30);geo.translate(0,3,0);
const mesh=new THREE.Mesh(geo,new THREE.MeshBasicMaterial());mesh.name='hutBaked';group.add(mesh);group.position.set(4,1,-6);group.rotation.y=.3;group.updateMatrixWorld(true);
const point=new THREE.Vector3(.3,3,0).applyMatrix4(group.matrixWorld);
const roof=new FirePool({capacity:8});roof.clear();emitHutFire(roof,{group,flames:[{p:point,h:1,w:.7,seed:.7}]});
assert.ok(roof.items.filter(o=>o.row===FIRE_CLIPS.blaze).length>=2,'main + satellite roof tongues');
const glows=roof.items.filter(o=>o.row===FIRE_CLIPS.glow);
assert.equal(glows.length,1,'one local radiance patch per burning roof anchor');
assert.ok(glows.every(o=>o.size[0]<=2.6&&o.size[1]<=1.8),'roof radiance is local (<= 2.6 x 1.8 m; r12 pool was >= 3.2 x 2.2)');
assert.ok(roof.items.every(o=>o.seed>=0&&o.seed<1),'roof seeds wrapped into [0,1) (negative world x)');
const fuel=finishHutFuel(roof);assert.ok(fuel);assert.equal(fuel.material,roof.mesh.material);
const normal=new THREE.Vector3(0,0,1).applyAxisAngle(new THREE.Vector3(1,0,0),-Math.PI*.30).applyAxisAngle(new THREE.Vector3(0,1,0),.3);
const vertices=fuel.geometry.attributes.position;
for(let i=0;i<vertices.count;i++){const v=new THREE.Vector3().fromBufferAttribute(vertices,i);assert.ok(Math.abs(v.sub(point).dot(normal)-.025)<1e-5,'decal vertices on actual roof');}
fuel.geometry.dispose();
for(const a of Object.values(roof.attributes))assert.ok([...a.array].every(Number.isFinite));
const rowsW=[...roof.attributes.iFrame.array].filter((_,i)=>i%4===3).slice(0,roof.mesh.geometry.instanceCount);
assert.ok(rowsW.every(w=>Number.isInteger(w)||Math.floor(w)>=8),'procedural rows never alias an atlas row');
roof.clear();for(let i=0;i<8;i++)roof.emit();assert.equal(roof.emit(),null);roof.clear();assert.equal(roof.mesh.geometry.instanceCount,0);roof.dispose();geo.dispose();mesh.material.dispose();
// Shader rules: no derivative op inside procFire (ANGLE/D3D would flatten the branch), per-instance motion in the vertex stage.
const src=fs.readFileSync('src/vfx/fireLib.js','utf8');const proc=src.slice(src.indexOf('vec4 procFire('),src.indexOf('float eyeDepth('));
assert.ok(!/dFd[xy]|fwidth/.test(proc),'no derivatives inside procFire');assert.ok(/varying vec3 vProc/.test(src)&&/uniform float uTime;\nvarying vec4 vExtra; varying vec3 vProc/.test(src),'vProc computed per vertex');
assert.ok(!/band\(/.test(proc),'no posterized band() steps in procedural fire');
const result={pass:true,checks:['body flames lean + compress along a horizontal body','local roof radiance patches','no derivatives in procFire / no band steps / vProc per vertex','ignition + torso sheets + limb/hip tongues','unique per-instance seeds in [0,1)','body-relative fire during knockback (all bones)','monotonic burn-away + final alpha fade','all transient layers retire','roof tongues','fuel vertices on rotated roof','no atlas-row aliasing (negative x seeds)','finite attributes, capacity, teardown'],burn,alpha};
fs.mkdirSync('progress/shots/shared-fire-library/r13',{recursive:true});
fs.writeFileSync('progress/shots/shared-fire-library/r13/contracts.json',JSON.stringify(result,null,2));console.log(result.pass,result.checks.length,'checks');
