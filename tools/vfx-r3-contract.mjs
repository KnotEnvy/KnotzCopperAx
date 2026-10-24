import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { bodyContact, frontContact } from '../src/vfx/contact.js';
// Texture transport is irrelevant to pool bookkeeping; exercise the real geometry/attributes/material.
THREE.TextureLoader.prototype.load = (_, done) => { const t=new THREE.Texture(); queueMicrotask(()=>done(t)); return t; };
const { FirePool, preloadFireLibrary } = await import('../src/vfx/fireLib.js');
await preloadFireLibrary();
const pool=new FirePool({capacity:3}); pool.clear();
pool.emit({clip:'slash',pos:[0,1,0],size:[2,1],life:.12,additive:true});
pool.emit({clip:'smoke',delay:.05,fadeIn:.1,life:.5,alpha:.6});
pool.emit({clip:'flame',loop:true,rooted:true,phase:-.2});
assert.equal(pool.emit(),null);
assert.equal(pool.mesh.geometry.instanceCount,2);
assert.equal(pool.attributes.iExtra.getX(0),1);
assert.equal(pool.attributes.iExtra.getY(1),1);
pool.update(.10);
assert.equal(pool.mesh.geometry.instanceCount,3);
assert.ok(Math.abs(pool.attributes.iTint.getW(1)-.30)<1e-6);
pool.update(.033);
assert.ok(pool.items.every(o=>o.row!==4),'light arc must be gone at133ms');
pool.update(.6);
assert.equal(pool.items.length,1); assert.equal(pool.items[0].rooted,true);
for(const a of Object.values(pool.attributes))assert.ok([...a.array].every(Number.isFinite));
pool.dispose();
const b={minX:9.7,maxX:10.3,minY:0,maxY:1.9,minZ:-.25,maxZ:.25};
const target={hurtboxes:()=>[b]};
// Regression: wildly misplaced combat midpoint, either attack direction and multiple camera angles.
let projections=0;
for(const raw of [{x:8,y:1,z:0},{x:12,y:1,z:0},{x:9,y:4,z:2}]){
  const q=bodyContact({target,point:raw});
  assert.ok(q.x>=b.minX&&q.x<=b.maxX&&q.y>=b.minY&&q.y<=b.maxY&&q.z>=b.minZ&&q.z<=b.maxZ);
  for(const pos of [[7,6,18],[15,4,12],[10,8,20]]){
    const cam=new THREE.PerspectiveCamera(32,16/9,.1,100);cam.position.set(...pos);cam.lookAt(10,1,0);cam.updateMatrixWorld();
    const f=frontContact(q,cam),v=new THREE.Vector3(q.x,q.y,q.z).project(cam),w=new THREE.Vector3(f.x,f.y,f.z).project(cam);
    assert.ok(Math.hypot(v.x-w.x,v.y-w.y)<1e-12,'foreground offset must preserve screen location'); projections++;
  }
}
const result={pass:true,projectionCases:projections,checks:['midpoint clamped to body','camera-ray projection invariance','delayed smoke fade-in','133ms arc retirement','rooted loop retention','capacity bound','finite attributes','teardown']};
fs.mkdirSync('progress/shots/shared-fire-library/r3',{recursive:true});
fs.writeFileSync('progress/shots/shared-fire-library/r3/contracts.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
