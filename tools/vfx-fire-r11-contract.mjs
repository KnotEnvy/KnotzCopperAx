// Fire-only regression: surface seating, finite bounded instances, attachment and gradual retirement.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {emitHutFire,finishHutFuel} from '../src/levels/stages/stage1/roofFire.js';
THREE.TextureLoader.prototype.load=(_,done)=>{const t=new THREE.Texture();queueMicrotask(()=>done(t));return t;};
const {FirePool,preloadFireLibrary}=await import('../src/vfx/fireLib.js');await preloadFireLibrary();
const pool=new FirePool({capacity:8});pool.clear();
const body=new THREE.Object3D(),chest=new THREE.Object3D();chest.name='chest';chest.position.y=1;body.add(chest);
pool.emitCombustion({pos:[0,1,0],target:{modelRoot:body}});
const origin=pool.items.map(o=>[...o.pos]);body.position.set(2,-.5,.2);pool.update(.264);
pool.items.forEach((o,i)=>{assert.ok(o.follow);for(let a=0;a<3;a++)assert.ok(Math.abs(o.pos[a]-origin[i][a]-[2,-.5,.2][a])<1e-6);});
const fade=[];for(let i=0;i<5;i++){pool.update(.033);fade.push(pool.attributes.iTint.getW(0));}
assert.ok(fade.every((a,i)=>i===0||a<fade[i-1]),'five decreasing alpha samples');
pool.update(1);assert.equal(pool.items.length,0);pool.dispose();
// A sloping test roof rotated in the world. Anchors must project to the actual mesh.
const group=new THREE.Group(),geo=new THREE.PlaneGeometry(5,4);geo.rotateX(-Math.PI*.30);geo.translate(0,3,0);
const mesh=new THREE.Mesh(geo,new THREE.MeshBasicMaterial());mesh.name='hutBaked';group.add(mesh);group.position.set(4,1,-6);group.rotation.y=.3;group.updateMatrixWorld(true);
const point=new THREE.Vector3(.3,3,0).applyMatrix4(group.matrixWorld);
const roof=new FirePool({capacity:4});roof.clear();emitHutFire(roof,{group,flames:[{p:point,h:1,w:.7,seed:.7}]});
assert.equal(roof.items.length,1);
const fuel=finishHutFuel(roof);assert.ok(fuel);assert.equal(fuel.material,roof.mesh.material);
const normal=new THREE.Vector3(0,0,1).applyAxisAngle(new THREE.Vector3(1,0,0),-Math.PI*.30).applyAxisAngle(new THREE.Vector3(0,1,0),.3);
const vertices=fuel.geometry.attributes.position;
for(let i=0;i<vertices.count;i++) {
 const v=new THREE.Vector3().fromBufferAttribute(vertices,i);
 assert.ok(Math.abs(v.sub(point).dot(normal)-.025)<1e-5,'all decal vertices remain on actual roof');
}
assert.equal(fuel.geometry.attributes.iSurface.getW(0),2);
fuel.geometry.dispose();
for(const a of Object.values(roof.attributes))assert.ok([...a.array].every(Number.isFinite));
roof.emit();roof.emit();roof.emit();assert.equal(roof.emit(),null);roof.clear();assert.equal(roof.mesh.geometry.instanceCount,0);roof.dispose();geo.dispose();mesh.material.dispose();
const result={pass:true,checks:['surface-normal fuel seating on rotated roof','finite GPU attributes and capacity','body-relative flame/soot/embers during knockback','five decreasing fade samples','all transient layers retire','pool teardown'],fade};
fs.writeFileSync('progress/shots/shared-fire-library/r11/contracts.json',JSON.stringify(result,null,2));console.log(result);
