// r15 fire regression (r14 contract + r15 checks: spread from the contact in distance order, grow-in, sub-tongue shape rules, camp layout, instance budget). r14: ignition owns the +0 frame, AgX value ladder of the ramp; body sheets start at +30/+40 ms): procedural body fire rides its bones through knockback,
// burns away gradually then retires; roof fuel stays on the actual mesh; seeds are valid; attributes finite; capacity holds.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {agx} from './lib-agx-r14.mjs';
import {emitHutFire,finishHutFuel} from '../src/levels/stages/stage1/roofFire.js';
THREE.TextureLoader.prototype.load=(_,done)=>{const t=new THREE.Texture();queueMicrotask(()=>done(t));return t;};
const {FirePool,preloadFireLibrary,FIRE_CLIPS}=await import('../src/vfx/fireLib.js');await preloadFireLibrary();
const pool=new FirePool({capacity:16});pool.clear();
const body=new THREE.Object3D();
for(const [n,y,x] of [['hips',.95,0],['chest',1.1,0],['forearm_R',1.0,.3],['upperarm_L',1.3,-.25],['thigh_R',.7,.1]]){const b=new THREE.Object3D();b.name=n;b.position.set(x,y,0);body.add(b);}
pool.emitCombustion({pos:[0,1.1,.6],target:{modelRoot:body},scale:1,dir:1});
// r14: the +0 ms frame belongs to the ignition burst alone (body sheets/tongues start a beat later).
const live0=pool.items.filter(o=>o.age>=0&&o.row>=8);
assert.deepEqual(live0.map(o=>o.row),[FIRE_CLIPS.ignite],'only the ignition burst is live at +0 ms');
// (r15 spread checks run on a fuller skeleton below)
assert.ok(live0[0].core>=1,'ignition core hotter than the sustained burn');
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
p2.update(.05);const live=()=>p2.items.filter(o=>o.age>=0&&o.tilt);const sh0=live().map(o=>[o,p2.attributes.iFrame.getY(p2.items.filter(q=>q.age>=0).indexOf(o))]);
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
// r14: the ramp is a VALUE ladder that survives the AgX post: dark/saturated reds+orange low, bright core on top.
const ramp=src.slice(src.indexOf('vec3 fireRamp('),src.indexOf('vec4 procFire('));
const stops=[...ramp.matchAll(/vec3\(([-.\d]+),([-.\d]+),([-.\d]+)\)/g)].map(m=>[+m[1],+m[2],+m[3]]);
assert.ok(stops.length>=6,'ramp has >= 6 stops');
const srgb=x=>x<=.0031308?12.92*x:1.055*Math.pow(x,1/2.4)-.055;
const out=stops.map(c=>agx(c).map(srgb)),val=out.map(o=>Math.max(...o)),sat=out.map(o=>(Math.max(...o)-Math.min(...o))/Math.max(1e-6,Math.max(...o)));
assert.ok(val.every((v,i)=>i===0||v>val[i-1]),'ramp stops rise monotonically in displayed value');
assert.ok(sat.slice(0,4).every(x=>x>=.65),'tips/red/orange stops stay saturated through AgX (>= .65)');
assert.ok(val[0]<.40&&val.at(-1)>=.85,'value range: dark tips < .40, core >= .85 displayed');
assert.ok(/pOcc/.test(proc)&&/alpha\*\(1\.-vExtra\.x\)\*pOcc/.test(src),'temperature-driven occlusion term kept');
// ---- r15 checks
// Shape: union of sub-tongues + shared root mass (smooth union), full-width dissolve islands, threshold-shifted holes,
// tongues occlude (pOcc floor >= .9 on the flame path), no derivative ops (checked above).
assert.ok(/for\(int i=0;i<4;i\+\+\)/.test(proc)&&/float nT=sheet \? 4\. : 3\.;/.test(proc),'2-4 sub-tongues per card (3 blaze / 4 sheet)');
assert.ok(/F=max\(F,rm\)\+hk\*hk/.test(proc),'smooth union with the shared root mass');
assert.ok(/float keep=smoothstep\(0\.,/.test(proc)&&/alpha\*=keep\*\(1\.-hole\)/.test(proc),'tip dissolve cuts full-width islands (alpha keep mask)');
assert.ok(/float gv=gap-\(1\.-holeZone\)/.test(proc)&&/float hole=smoothstep\(thr,thr\+max\(px\*\.6,\.015\),gv\)/.test(proc),'holes: threshold shifted off the outline, crisp edge');
const occ=[...proc.matchAll(/pOcc=mix\(([\d.]+),1\.,/g)].map(m=>+m[1]);assert.ok(occ.at(-1)>=.9,'flame bodies occlude (pOcc floor >= .9)');
// Spread: parts catch in order of screen-plane distance from the body-anchored contact; torso first; <= ~150 ms.
const p3=new FirePool({capacity:96});p3.clear();const body3=new THREE.Object3D();
for(const [n,y,x] of [['hips',.95,0],['chest',1.25,0],['upperarm_R',1.4,.25],['upperarm_L',1.4,-.25],['forearm_R',1.1,.38],['forearm_L',1.1,-.38],['thigh_R',.7,.12],['thigh_L',.7,-.12]]){const b=new THREE.Object3D();b.name=n;b.position.set(x,y,0);body3.add(b);}
body3.updateMatrixWorld(true);const before=p3.items.length;p3.emitCombustion({pos:[.35,1.2,.6],target:{modelRoot:body3},scale:1,dir:1});
const all3=p3.items.slice(before),flames3=all3.filter(o=>o.row===FIRE_CLIPS.burn||o.row===FIRE_CLIPS.blaze);
const delay=o=>-o.age, dist=o=>Math.hypot(o.pos[0]-.2,o.pos[1]-1.25);
const torso=flames3.filter(o=>o.row===FIRE_CLIPS.burn), limbs3=flames3.filter(o=>o.row===FIRE_CLIPS.blaze&&o.size[0]<=.31);
assert.ok(Math.max(...torso.map(delay))<=Math.min(...limbs3.map(delay))+.02,'torso catches before the limbs');
assert.ok(Math.max(...flames3.map(delay))<=.17&&Math.min(...flames3.map(delay))>=.02,'every part catches between +20 and ~+150 ms');
assert.ok(new Set(flames3.map(o=>delay(o).toFixed(3))).size>=5,'staggered catch times (a visible spread, not one beat)');
const flashes3=all3.filter(o=>o.row===FIRE_CLIPS.ignite).slice(1);assert.ok(flashes3.length>=1&&flashes3.length<=4,'1-4 small catch flashes on the first limbs');
assert.ok(all3.length<=24,'one combustion <= 24 instances (pool 96 = 4 burning victims)');
// Grow-in: a catching flame licks up from .35 of its height to full over growIn.
const g0=flames3.find(o=>o.growIn>0);p3.update(delay(g0)+1e-4);let k3=p3.items.filter(q=>q.age>=0).indexOf(g0);const h0=p3.attributes.iFrame.getY(k3);
p3.update(g0.growIn+.01);k3=p3.items.filter(q=>q.age>=0).indexOf(g0);const h1=p3.attributes.iFrame.getY(k3);
assert.ok(h0<h1*.45&&h1>0,'catching flame grows in from its root');
assert.equal(new Set(all3.filter(o=>o.row>=8).map(o=>o.seed.toFixed(4))).size,all3.filter(o=>o.row>=8).length,'unique seeds on the full skeleton too');
p3.dispose();
// Camp: four rooted cards (char/ember roots), roots on the coals, one in front of the pot (pot radius .24).
const camp=fs.readFileSync('src/levels/stages/bonus/campfire.js','utf8');
const L=JSON.parse('['+camp.match(/const L = \[([\s\S]*?)\];/)[1].replace(/(^|[,\[\s])\.(\d)/g,'$10.$2').replace(/-\.(\d)/g,'-0.$1')+']');
assert.equal(L.length,4,'four camp cards (fewer overlaps)');assert.ok(/rooted: true/.test(camp),'camp tongues rooted (charred roots)');
assert.ok(L.every(r=>r[6]<=.14),'camp roots sit on the coals (<= .14 m)');assert.ok(L.some(r=>r[1]>.3),'a camp tongue stands in front of the pot');
assert.ok(/if\(root>0\.\) \{[\s\S]*?fuelNoise/.test(src),'proc roots: char broken by ember specks');
const result={pass:true,stops:{val:val.map(v=>+v.toFixed(3)),sat:sat.map(v=>+v.toFixed(3))},checks:['r15: 2-4 sub-tongues + smooth root union','r15: full-width dissolve islands','r15: threshold-shifted crisp holes','r15: flame bodies occlude (pOcc >= .9)','r15: torso catches before limbs, all parts +20..~150 ms, >= 5 catch times','r15: 1-4 catch flashes','r15: <= 24 instances per combustion','r15: grow-in from the root','r15: unique seeds on a full skeleton','r15: camp 4 rooted cards, roots on coals, one in front of the pot','r15: char/ember roots','ignition alone at +0 ms (core >= 1)','ramp = AgX value ladder (monotonic value, saturated low stops, dark tips/bright core)','temperature-driven occlusion term kept','body flames lean + compress along a horizontal body','local roof radiance patches','no derivatives in procFire / no band steps / vProc per vertex','ignition + torso sheets + limb/hip tongues','unique per-instance seeds in [0,1)','body-relative fire during knockback (all bones)','monotonic burn-away + final alpha fade','all transient layers retire','roof tongues','fuel vertices on rotated roof','no atlas-row aliasing (negative x seeds)','finite attributes, capacity, teardown'],burn,alpha};
fs.mkdirSync('progress/shots/shared-fire-library/r15',{recursive:true});
fs.writeFileSync('progress/shots/shared-fire-library/r15/contracts.json',JSON.stringify(result,null,2));console.log(result.pass,result.checks.length,'checks');
