// Fire-only seating on the approved baked hut: never changes its geometry/materials.
import * as THREE from 'three';

// Clip a source triangle in the patch's tangent plane; interpolated points remain
// on that source triangle. Fuel cannot bridge the aperture or hang beyond an eave.
function clipPatch(vertices, centre, normal, width, height) {
  const right=new THREE.Vector3().crossVectors(normal,new THREE.Vector3(0,0,1)).normalize();
  const up=new THREE.Vector3().crossVectors(normal,right);
  let polygon=vertices.map(p=>{const d=p.clone().sub(centre);return {p:p.clone(),u:d.dot(right)/width+.5,v:d.dot(up)/height+.5};});
  for(const [axis,bound,sign] of [['u',0,1],['u',1,-1],['v',0,1],['v',1,-1]]) {
    const next=[];
    for(let i=0;i<polygon.length;i++) {
      const a=polygon[i],b=polygon[(i+1)%polygon.length];
      const da=(a[axis]-bound)*sign,db=(b[axis]-bound)*sign;
      if(da>=0)next.push(a);
      if((da>=0)!==(db>=0)) {
        const t=da/(da-db);next.push({p:a.p.clone().lerp(b.p,t),u:a.u+(b.u-a.u)*t,v:a.v+(b.v-a.v)*t});
      }
    }
    polygon=next;if(!polygon.length)break;
  }
  return polygon;
}

export function emitHutFire(pool, hut) {
  hut.group.updateMatrixWorld(true);
  const roof=hut.group.getObjectByName('hutBaked');
  const geometry=roof?.geometry;
  const triangles=[];
  if(geometry) {
    const position=geometry.attributes.position,index=geometry.index;
    const count=index ? index.count : position.count;
    for(let i=0;i<count;i+=3) {
      const vertices=[0,1,2].map(k=>new THREE.Vector3().fromBufferAttribute(position,index ? index.getX(i+k) : i+k).applyMatrix4(roof.matrixWorld));
      const tri=new THREE.Triangle(...vertices),normal=tri.getNormal(new THREE.Vector3());
      if(normal.y>.35) triangles.push({tri,normal,vertices});
    }
  }
  const q=new THREE.Vector3(),fuel=pool.roofFuel ||= {positions:[],uvs:[],patches:0};
  const anchors=[...hut.flames];
  // Add short intermediate fires only when projection finds real fuel nearby.
  // Their roots cannot occupy empty aperture space between the contour anchors.
  for(const [a,b] of [[0,1],[2,3],[4,5]]) {
    const left=hut.flames[a],right=hut.flames[b];
    if(!left || !right || left.p.y-hut.group.position.y<2 || right.p.y-hut.group.position.y<2)continue;
    anchors.push({p:left.p.clone().lerp(right.p,.5),h:1.0,w:.48,seed:(a*.173+.23)%1,maxDistance:.38});
  }
  // r12: the hole burns from inside. Tall blazes rooted below the roof (hidden by the real thatch
  // and walls through depth) fill the black aperture and rise out of it; no roof geometry changes.
  const roofAnchors=hut.flames.filter(f=>f.seed!==undefined && f.p.y-hut.group.position.y>2);
  if(roofAnchors.length>=2) {
    const c=roofAnchors.reduce((v,f)=>v.add(f.p),new THREE.Vector3()).multiplyScalar(1/roofAnchors.length);
    const spread=Math.max(...roofAnchors.map(f=>Math.abs(f.p.x-c.x)));
    const base=(hut.group.position.x*.173)%1;
    // r14: four overlapping tongues of clearly unequal height (r13's five read as strips side by side); each
    // forks into 2-3 sub-tongues in procFire, so the hole burns as one connected, changing mass.
    for(const [k,[dx,h,w,dy]] of [[0,2.85,1.30,-.55],[-.42,1.95,1.10,-.30],[.40,2.25,1.08,-.70],[.74,1.55,.88,-.20]].entries()) {
      const x=c.x+dx*Math.min(1.2,spread),ph=(base+k*.29)%1;
      pool.emit({clip:'blaze',loop:true,pos:[x,c.y+dy+h*.5,c.z-.25-.06*k],size:[w,h],life:1,phase:ph,seed:(ph*3.1+.07)%1,
        core:.7,radiance:1.3,alpha:.95,mirror:k%2?-1:1,tint:'#ffc8a4'});
    }
  }
  const glows=[];
  for(const [i,f] of anchors.entries()) {
    if(f.seed === undefined) { // Explicit doorway emitter, not a low broken roof edge.
      pool.emit({clip:'blaze',loop:true,pos:[f.p.x,f.p.y+f.h*.34,f.p.z],size:[f.w*1.4,f.h],phase:.3,core:.6,radiance:1.3,tint:'#ffc8a4'});
      continue;
    }
    let nearest=null,distance=Infinity;
    for(const surface of triangles) {
      surface.tri.closestPointToPoint(f.p,q);
      const d=q.distanceToSquared(f.p);
      if(d<distance) {distance=d;nearest={pos:q.clone(),normal:surface.normal};}
    }
    if(!nearest || distance>(f.maxDistance ?? .8)**2) continue;
    // r14: taller cards - the game-scale erosion leaves ~60 % of a card burning (r13 ~85 %).
    const phase=(f.seed ?? i*.317)%1,width=Math.max(.62,f.w*1.40),height=Math.max(1.25,f.h*2.1);
    pool.emitRoofEdge({pos:nearest.pos.toArray(),normal:nearest.normal.toArray(),fuel:false,
      height,width,phase,life:.70+phase*.55});
    // r12 volume: unequal satellite tongues along the same burning edge, each re-seated on
    // real roof fuel (never in the open aperture), plus a radiance pool lying on the thatch.
    const along=new THREE.Vector3().crossVectors(nearest.normal,new THREE.Vector3(0,0,1)).normalize();
    const extra=f.maxDistance ? [] : [[-.62,.62],[.58,.78]].slice(0,height>1.2 ? 2 : 1);
    for(const [k,[off,hk]] of extra.entries()) {
      const want=nearest.pos.clone().addScaledVector(along,off*width);
      let best=null,bd=Infinity;
      for(const surface of triangles) {
        if(surface.normal.dot(nearest.normal)<.8)continue;
        surface.tri.closestPointToPoint(want,q);const d=q.distanceToSquared(want);
        if(d<bd){bd=d;best={pos:q.clone(),normal:surface.normal};}
      }
      if(!best || bd>.09)continue;
      const ph=(phase+.37*(k+1))%1;
      pool.emitRoofEdge({pos:best.pos.toArray(),normal:best.normal.toArray(),fuel:false,
        height:height*hk*(.9+.25*ph),width:width*(.62+.2*ph),phase:ph,life:.62+ph*.5});
    }
    // r13: light stays local: a small broken radiance patch lies on the thatch at each burning edge
    // (no broad wash over the hut front).
    if(!f.maxDistance) glows.push({pos:nearest.pos.clone(),normal:nearest.normal.toArray(),height,width,phase});
    const pw=Math.max(1.05,width*2.1),ph=Math.max(.85,width*1.7);
    for(const surface of triangles) {
      // Exclude far pitch, interior floors and beams behind the selected surface.
      if(surface.normal.dot(nearest.normal)<.8)continue;
      surface.tri.closestPointToPoint(nearest.pos,q);
      if(q.distanceTo(nearest.pos)>Math.hypot(pw,ph)*.55)continue;
      if(Math.abs(q.clone().sub(nearest.pos).dot(nearest.normal))>.12)continue;
      const poly=clipPatch(surface.vertices,nearest.pos,nearest.normal,pw,ph);
      for(let k=1;k+1<poly.length;k++)for(const v of [poly[0],poly[k],poly[k+1]]) {
        fuel.positions.push(...v.p.clone().addScaledVector(surface.normal,.025).toArray());fuel.uvs.push(v.u,v.v);
      }
    }
    fuel.patches++;
  }
  // r14: radiance patches brighter (.42 -> .58) so light licks the thatch edges next to the flames.
  for(const g of glows) pool.emit({clip:'glow',loop:true,additive:true,surface:g.normal,
    pos:g.pos.addScaledVector(new THREE.Vector3(...g.normal),.05).add(new THREE.Vector3(0,.10,0)).toArray(),
    size:[Math.max(1.3,g.width*2.4),Math.max(1.0,g.width*1.7)],life:1,phase:g.phase,alpha:.58,tint:'#ffb070',core:0,seed:(g.phase*5.3+.11)%1});
}

export function finishHutFuel(pool) {
  const data=pool.roofFuel;if(!data?.positions.length)return null;
  const geo=new THREE.InstancedBufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(data.positions,3));
  geo.setAttribute('uv',new THREE.Float32BufferAttribute(data.uvs,2));
  const values={iPosition:[0,0,0,0],iFrame:[1,1,0,0],iTint:[1,1,1,1],iLife:[0,0,0,0],iExtra:[0,2,0,1],iSurface:[0,1,0,2]};
  for(const [key,value] of Object.entries(values))geo.setAttribute(key,new THREE.InstancedBufferAttribute(new Float32Array(value),4));
  geo.instanceCount=1;geo.computeBoundingSphere();
  // Same shader/material as the already prewarmed fire pool; one village-wide draw.
  const mesh=new THREE.Mesh(geo,pool.mesh.material);mesh.name='s1RoofFuel';mesh.renderOrder=6;
  mesh.userData.firePatches=data.patches;
  pool.roofFuel=null;return mesh;
}
