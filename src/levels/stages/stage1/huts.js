// Smouldering thatched huts (procedural, per-hut seed): hewn timber frame (posts, sills, plates, braces, gable
// trusses, rafters, ridge), wattle-and-daub panels (one broken, sooted), a thick lumpy thatch roof with jagged
// eaves and a burnt-through COLLAPSE hole whose edges glow with embers, fallen rafters, a doorway with firelight.
// Fire/smoke/glow emitters are pushed into the shared fire kit; `lights` collects candidate spots for the pooled
// flicker lights. Each hut = 3 draw calls (wood, daub, thatch).
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { timber, panel, tube, merge, xform, rngFrom, V3, smooth, fbm2 } from './geo.js';

function thatchSlope(o, rng, side) {
  const { w, d, wallH, rise, ov, gov, hole } = o;
  const H = wallH + rise, eaveY = wallH - .28, eaveZ = side * (d / 2 + ov);
  const Dv = V3(0, eaveY - H, eaveZ).normalize();
  const Nn = V3(0, Math.abs(Dv.z), side * Math.abs(Dv.y)).normalize();
  const slopeLen = Math.hypot(eaveY - H, eaveZ), Lu = w + gov * 2;
  const nu = Math.ceil(Lu / .16), nv = Math.ceil(slopeLen / .16), seed = rng.next() * 100;
  const holeOn = hole && hole.side === side;
  const holeF = (u, v) => {
    if (!holeOn) return 9;
    const du = (u - hole.u) / hole.ru, dv = (v - hole.v * slopeLen) / hole.rv;
    const rag = (fbm2(u * 2.2 + seed, v * 2.1, 4, 3) - .5) * .4;
    const main = Math.hypot(du, dv) + rag;
    // A narrow collapsed run reaches the eave; the roof no longer ends in one
    // uninterrupted rectangular skirt below a round cookie-cutter opening.
    const notch = Math.max(Math.abs(u - hole.u - .22 * Math.sin(v * 2.7)) / .44,
      (hole.v * slopeLen + .35 - v) / .4 + 1) + rag;
    return Math.min(main, notch);
  };
  const make = (u, v) => {
    const hf = holeF(u,v), sag = holeOn ? (1 - smooth(1,1.7,hf)) * .15 : 0;
    const bulge = (fbm2(u*1.1+seed,v*1.1,5,3)-.5)*.09;
    const top = V3(u,H,0).addScaledVector(Dv,v).addScaledVector(Nn,.1+bulge-sag);
    const patch = smooth(.4,.7,fbm2(u*.5+seed,v*.5,8,3))*o.char;
    const burnt = holeOn ? 1-smooth(1.02,1.65,hf) : 0;
    const ember = holeOn ? (1-smooth(1.03,1.32,hf)) * (.4+.6*fbm2(u*7,v*5,29,2)) : 0;
    const spill = holeOn ? 1-smooth(1.0,2.05,hf) : 0;
    return { u,v,hf,top,bot:top.clone().addScaledVector(Nn,-(.24-.1*v/slopeLen)),
      mask:[Math.min(1,burnt+patch),ember,spill,1] };
  };
  const rows=[];
  for(let j=0;j<=nv;j++) for(let i=0;i<=nu;i++) {
    const u=-Lu/2+i/nu*Lu;
    const v=j/nv*(slopeLen+(fbm2(u*3.4+seed,side*3,2,2)-.5)*.42);
    rows.push(make(u,v));
  }
  const pos=[],uv=[],mask=[],rim=[];
  const vert=(a, bottom=false, cutEdge=false)=>{const p=bottom?a.bot:a.top;pos.push(p.x,p.y,p.z);uv.push(a.u+(cutEdge?1000:0),a.v);mask.push(...a.mask);};
  const face=(poly,bottom=false)=>{
    if(poly.length<3)return;
    for(let k=1;k<poly.length-1;k++){
      const tri=[poly[0],poly[k],poly[k+1]];
      const normal=tri[1].top.clone().sub(tri[0].top).cross(tri[2].top.clone().sub(tri[0].top));
      if((normal.dot(Nn)<0)!==bottom) [tri[1],tri[2]]=[tri[2],tri[1]];
      for(const a of tri)vert(a,bottom);
    }
  };
  const edge=(a,b)=>{vert(a,false,true);vert(a,true,true);vert(b,false,true);vert(b,false,true);vert(a,true,true);vert(b,true,true);};
  const cross=(a,b)=>{
    // Refine the actual irregular contour, rather than leaving square missing cells.
    let lo=a,hi=b;
    for(let k=0;k<6;k++) {const mid=make((lo.u+hi.u)/2,(lo.v+hi.v)/2);if((mid.hf>=1)===(lo.hf>=1))lo=mid;else hi=mid;}
    return make((lo.u+hi.u)/2,(lo.v+hi.v)/2);
  };
  const clip=tri=>{
    const poly=[],cut=[];
    for(let k=0;k<3;k++){
      const a=tri[k],b=tri[(k+1)%3],A=a.hf>=1,B=b.hf>=1;
      if(A)poly.push(a);
      if(A!==B){const c=cross(a,b);poly.push(c);cut.push(c);}
    }
    face(poly);face(poly,true);
    if(cut.length===2){edge(cut[0],cut[1]);rim.push(cut[0].top.clone());}
  };
  const at=(i,j)=>rows[j*(nu+1)+i];
  for(let j=0;j<nv;j++)for(let i=0;i<nu;i++){
    const a=at(i,j),b=at(i+1,j),c=at(i,j+1),e=at(i+1,j+1);
    clip([a,c,b]);clip([b,c,e]);
  }
  const outer=(a,b)=>{if(a.hf>=1&&b.hf>=1)edge(a,b);else if((a.hf>=1)!==(b.hf>=1)){const c=cross(a,b);edge(a.hf>=1?a:c,b.hf>=1?b:c);}};
  for(let i=0;i<nu;i++)outer(at(i,nv),at(i+1,nv));
  for(let j=0;j<nv;j++){outer(at(0,j),at(0,j+1));outer(at(nu,j),at(nu,j+1));}
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  g.setAttribute('kmask',new THREE.Float32BufferAttribute(mask,4));
  const roof = mergeVertices(g, 1e-4); g.dispose(); roof.computeVertexNormals();
  return {geos:[roof],rim,H,slopeLen,Dv,Nn};
}

export function buildHut(o, rng0) {
  if (o.kit) return buildBakedHut(o); // Stage2 also consumes the original procedural kit.
  const rng = rngFrom(o.seed ?? 1);
  const w = o.w ?? 5.4, d = o.d ?? 3.9, wallH = o.wallH ?? 2.05, rise = o.rise ?? 2.5, ov = o.ov ?? 0.55, gov = 0.4;
  const burn = o.burning ?? 1, char = o.char ?? 0.78, gutted = !!o.gutted;
  const H = wallH + rise;
  const wood = [], daub = [], thatch = [];
  const out = { flames: [], smoke: [], glows: [], lights: [], sparks: [] };
  const wm = (base, emb = 0) => (t) => [Math.min(1, base + (rng.next() - 0.5) * 0.2 + t * 0.15), emb, 0, 1];
  const T = (a, b, r, extra = {}) => wood.push(timber(a, b, { r, r2: r * 0.92, rng, mask: wm(char * 0.8, extra.emb ?? 0), sides: 6, ...extra }));
  // ---- frame
  const hx = w / 2, hz = d / 2;
  const posts = [[-hx, -hz], [hx, -hz], [-hx, hz], [hx, hz], [-w / 6, hz], [w / 6, hz], [-w / 6, -hz], [w / 6, -hz], [-hx, 0], [hx, 0]];
  const lostPost = gutted ? 2 : -1;
  posts.forEach(([x, z], i) => {
    if (i === lostPost) { T(V3(x, -0.1, z), V3(x + 0.05, 0.9, z), 0.12, { broken: 0.25, emb: 0.9 }); return; }
    const hTop = gutted && i % 3 === 0 ? wallH * (0.45 + rng.next() * 0.4) : wallH + 0.05;
    T(V3(x, -0.1, z), V3(x + (rng.next() - 0.5) * 0.06, hTop, z + (rng.next() - 0.5) * 0.06), 0.12, gutted && hTop < wallH ? { broken: 0.2, emb: 0.8 } : {});
  });
  // sills + plates
  for (const z of [-hz, hz]) { T(V3(-hx - 0.2, 0.14, z), V3(hx + 0.2, 0.14, z), 0.09); if (!gutted || z < 0) T(V3(-hx - 0.25, wallH, z), V3(hx + 0.25, wallH, z), 0.1); }
  for (const x of [-hx, hx]) { T(V3(x, 0.14, -hz - 0.2), V3(x, 0.14, hz + 0.2), 0.09); T(V3(x, wallH, -hz - 0.25), V3(x, wallH, hz + 0.25), 0.1); }
  // braces in the outer bays
  T(V3(-hx, 0.2, hz), V3(-w / 6, wallH - 0.1, hz), 0.06);
  T(V3(hx, 0.2, hz), V3(w / 6, wallH - 0.1, hz), 0.06);
  T(V3(-hx, 0.2, -hz), V3(-hx, wallH - 0.1, 0), 0.06);
  // gable trusses + ridge
  const holeSide = o.collapse > 0 ? (o.holeEnd ?? 1) : 0;
  for (const x of [-hx, hx]) {
    const broken = gutted || (holeSide !== 0 && Math.sign(x) === holeSide && o.collapse > 0.6);
    T(V3(x, wallH + 0.05, -hz - ov * 0.6), V3(x, broken ? H - 0.9 : H, 0), 0.085, broken ? { broken: 0.2, emb: 0.9 } : {});
    if (!broken) T(V3(x, wallH + 0.05, hz + ov * 0.6), V3(x, H, 0), 0.085);
    if (!gutted) T(V3(x, wallH, 0), V3(x, H - 0.05, 0), 0.07);
  }
  if (!gutted) T(V3(-hx - 0.5, H + 0.02, 0), V3(hx + (holeSide > 0 && o.collapse > 0.6 ? 0.2 : 0.5), H + 0.02, 0), 0.1);
  // common rafters (show through the hole)
  if (!gutted) for (let x = -hx + 0.7; x < hx - 0.3; x += 0.75) for (const s of [-1, 1]) {
    const inHole = o.collapse > 0 && s === 1 && Math.abs(x - (o.holeU ?? hx * 0.4)) < 1.6;
    if (inHole && rng.next() < 0.6) {
      // snapped rafter hanging into the hut
      T(V3(x, H - 0.1, 0.1), V3(x + 0.1, wallH + 0.3, hz * 0.55), 0.05, { broken: 0.15, emb: 1 });
      continue;
    }
    T(V3(x, H - 0.12, 0), V3(x, wallH - 0.15, s * (hz + ov * 0.8)), 0.05);
  }
  // ---- walls (daub panels between posts, 0.1 thick), front has the doorway + a burnt-through panel
  const soot = (t) => [smooth(0.3, 1.0, t) * 0.7 + 0.1, 0, 0, 1];
  const P = (x0, x1, y0, y1, z, rot = 0, mask = soot) => {
    const g = panel(Math.abs(x1 - x0) - 0.14, y1 - y0, 0.1, { mask: (t) => mask(t) });
    if (rot) { g.rotateY(rot); g.translate(z, (y0 + y1) / 2, (x0 + x1) / 2); } else g.translate((x0 + x1) / 2, (y0 + y1) / 2, z);
    daub.push(g);
  };
  if (!gutted) {
    P(-hx, -w / 6, 0.2, wallH, hz);                              // front left bay
    P(-w / 6, w / 6, 1.75, wallH, hz);                           // above the doorway
    P(w / 6, hx, 0.2, wallH * (0.45 + rng.next() * 0.2), hz, 0, (t) => [0.6 + t * 0.4, 0, 0, 1]);  // burnt-through
    // exposed wattle weave above the broken panel
    for (let y = wallH * 0.62; y < wallH - 0.1; y += 0.16) wood.push(timber(V3(w / 6 + 0.1, y, hz), V3(hx - 0.1, y + (rng.next() - 0.5) * 0.05, hz + 0.02), { r: 0.018, sides: 4, seg: 3, bow: 0.04, rng, mask: () => [0.9, rng.next() < 0.3 ? 1 : 0, 0, 1] }));
    for (let x = w / 6 + 0.25; x < hx - 0.1; x += 0.3) wood.push(timber(V3(x, wallH * 0.5, hz), V3(x, wallH - 0.05, hz), { r: 0.022, sides: 4, seg: 2, rng, mask: () => [0.95, 0.5, 0, 1] }));
    P(-hx, hx, 0.2, wallH, -hz);                                 // back
    P(-hz, 0, 0.2, wallH, -hx, Math.PI / 2); P(0, hz, 0.2, wallH, -hx, Math.PI / 2);
    P(-hz, 0, 0.2, wallH, hx, Math.PI / 2); P(0, hz, 0.2, wallH * 0.7, hx, Math.PI / 2);
    // gable triangles (daub) at both ends
    for (const x of [-hx, hx]) {
      if (holeSide !== 0 && Math.sign(x) === holeSide && o.collapse > 0.6) continue;
      const tri = new THREE.BufferGeometry();
      const pts = [0, wallH, -hz, 0, wallH, hz, 0, H - 0.12, 0];
      tri.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      tri.setAttribute('uv', new THREE.Float32BufferAttribute([-hz, wallH, hz, wallH, 0, H], 2));
      tri.setAttribute('kmask', new THREE.Float32BufferAttribute([0.5, 0, 0, 1, 0.5, 0, 0, 1, 0.9, 0, 0, 1], 4));
      tri.setIndex(x > 0 ? [0, 2, 1] : [0, 1, 2]);
      tri.computeVertexNormals();
      tri.translate(x, 0, 0);
      daub.push(tri);
    }
    // dark interior backdrop behind the doorway (reads as a deep burnt room with fire inside)
    const back = panel(w - 0.4, wallH, 0.05, { mask: () => [1, 0, 0, 1] }); back.translate(0, wallH / 2, -hz + 0.3); daub.push(back);
  }
  // ---- roof
  let rim = [];
  if (!gutted) {
    const hole = o.collapse > 0 ? { side: 1, u: o.holeU ?? hx * 0.4, v: o.holeV ?? 0.45, ru: 1.0 + o.collapse * 1.25, rv: 0.65 + o.collapse * 0.8 } : null;
    for (const side of [1, -1]) {
      const s = thatchSlope({ w, d, wallH, rise, ov, gov, hole, char }, rng, side);
      thatch.push(...s.geos);
      if (side === 1) {
        rim = s.rim;
        // Split reed ends catch ember light along the torn opening. Merged into
        // the existing wood mesh; they break the silhouette without alpha layers.
        const stride = Math.max(1, Math.floor(rim.length / 22));
        for (let i = 0; i < rim.length; i += stride) {
          const p = rim[i], end = p.clone().addScaledVector(s.Dv, .10 + rng.next() * .20);
          end.y -= rng.next() * .07;
          T(p, end, .012, { r2: .003, sides: 3, seg: 1, broken: .04, mask: () => [.88, .15, 0, 1] });
        }
      }
    }
    // ridge cap bundle
    const rp = [], rr = [];
    for (let i = 0; i <= 12; i++) { const x = -hx - gov + (i / 12) * (w + gov * 2); rp.push(V3(x, H + 0.1 + Math.sin(i * 1.7) * 0.02, 0)); rr.push(0.2 + Math.sin(i * 2.3) * 0.02); }
    thatch.push(tube(rp, rr, { sides: 7, rng, jitter: 0.12, mask: (t) => [smooth(0.55, 0.9, t) * (holeSide > 0 ? 0.8 : 0.2), 0, 0, 1] }));
  } else {
    // gutted: a few charred roof remnants
    T(V3(-hx, wallH, hz), V3(-hx * 0.2, H * 0.8, 0.2), 0.07, { broken: 0.2, emb: 1 });
    T(V3(hx * 0.3, 0.15, hz + 0.6), V3(hx * 0.9, wallH * 0.9, -hz * 0.3), 0.1, { emb: 0.6 });
  }
  // fallen beams at the base
  for (let i = 0; i < 3; i++) {
    const x = (rng.next() - 0.3) * w, z = hz + 0.4 + rng.next() * 0.9;
    T(V3(x, 0.08, z), V3(x + (rng.next() - 0.5) * 2.4, 0.1 + rng.next() * 0.5, z - 0.5 - rng.next()), 0.08 + rng.next() * 0.05, { emb: rng.next() < 0.5 ? 0.8 : 0 });
  }
  // ---- fire emitters (local space; transformed below)
  if (burn > 0) {
    const rimPts = rim.length ? rim : [V3(0, H - 0.4, hz * 0.3)];
    const nF = gutted ? 3 : Math.round(2 + burn * 4);
    for (let i = 0; i < nF; i++) {
      const p = rimPts[Math.floor(((i + .25 + rng.next() * .5) / nF) * rimPts.length) % rimPts.length];
      const h = (.8 + rng.next() * 1.05) * (.6 + burn * .5);
      out.flames.push({ p: p.clone().add(V3(0, -.09, .035)), h, w: h * (.40 + rng.next() * .28),
        I: 3 + rng.next() * 2, seed: rng.next(), speed: .7 + rng.next() * .65 });
    }
    if (!gutted) {
      out.flames.push({ p: V3(-0.2, 0, -hz + 0.6), h: 1.4, I: 3.5 }, { p: V3(0.4, 0, -hz + 0.9), h: 1.0, I: 3 });   // inside, seen through the door
      out.glows.push({ p: V3(0, 0.9, hz + 0.1), s: 3.2, c: '#ff5a1a', I: 0.8 });
    }
    const c = rimPts.reduce((a, b) => a.add(b), V3()).multiplyScalar(1 / rimPts.length);
    out.glows.push({ p: c.clone().add(V3(0, 0.6, 0.2)), s: 3.8 + burn, c: '#ff6a24', I: 0.22 });
    out.smoke.push({ p: c.clone().add(V3(0, 0.6, 0)), puffs: gutted ? 6 : 10, rise: gutted ? 7 : 11, size: [1.1, gutted ? 3.8 : 6.0], opacity: gutted ? 0.47 : 0.7, life: 7 });   // perf-1650 r3: was 10/18 puffs (S1 od p95 hot spot)
    out.sparks.push({ p: c.clone(), rate: gutted ? 10 : 22 });
    out.lights.push(c.clone().add(V3(0, 0.3, 1.2)));
  }
  // ---- assemble
  const grp = new THREE.Group(); grp.name = 'hut';
  const mats = o.mats;
  const add = (list, mat, name) => { const g = merge(list); if (!g) return; const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; m.name = name; grp.add(m); };
  add(wood, mats.wood, 'hutWood'); add(daub, mats.daub, 'hutDaub'); add(thatch, mats.thatch, 'hutThatch');
  grp.position.set(o.x, o.y ?? 0, o.z); grp.rotation.y = o.yaw ?? 0;
  grp.updateMatrixWorld(true);
  const toW = (p) => p.clone().applyMatrix4(grp.matrixWorld);
  for (const k of ['flames', 'smoke', 'glows', 'sparks']) for (const e of out[k]) e.p = toW(e.p);
  out.lights = out.lights.map(toW);
  out.group = grp;
  return out;
}

/** Placement and fire anchors come from the same Blender roof cut geometry. */
function buildBakedHut(o) {
  const group = new THREE.Group(); group.name = 'hut';
  const geometry = o.kit.geometries[`hut_${o.seed}`];
  if (!geometry) throw new Error(`Missing Blender hut ${o.seed}`);
  const mesh = new THREE.Mesh(geometry, o.kit.material);
  mesh.name = 'hutBaked'; mesh.castShadow = true; mesh.receiveShadow = true;
  const strawGeometry = o.kit.geometries[`straw_${o.seed}`];
  if (strawGeometry) {
    const straw = new THREE.Mesh(strawGeometry, o.kit.strawMaterial);
    straw.name = 'hutStrawCards'; straw.castShadow = new URLSearchParams(location.search).get('s1StrawShadow') === '1'; straw.receiveShadow = true;
    group.add(straw);
  }
  group.add(mesh); group.position.set(o.x, o.y || 0, o.z); group.rotation.y = o.yaw || 0;
  group.updateMatrixWorld(true);
  const local = o.kit.metadata.huts[o.seed].flames;
  const anchors = local.map(p => new THREE.Vector3(...p).applyMatrix4(group.matrixWorld));
  const rng = rngFrom(o.seed + 901), burn = o.burning || 0;
  const centre = anchors.reduce((v,p) => v.add(p), new THREE.Vector3()).multiplyScalar(1 / anchors.length);
  // Every flame root is an actual broken straw-edge point. Interpolating
  // separated contour anchors could put the root in empty aperture space.
  const flames = anchors.map((p,i) => {
    const h = [.58,1.65,.83,1.35,.48,.95][i % 6] * (.80+rng.next()*.35) * (.6+burn*.5);
    return { p: p.clone(), h, w:h*(.42+rng.next()*.22),
      I: 3 + rng.next()*1.5, seed:rng.next(), speed:.7+rng.next()*.6 };
  });
  if (!o.gutted) flames.push({p:V3(0,.45,0).applyMatrix4(group.matrixWorld),h:1.3,w:.65,I:3.5});
  return { group, flames,
    smoke:(o.kit.metadata.huts[o.seed].smoke || [local[0]]).map(p=>({p:new THREE.Vector3(...p).applyMatrix4(group.matrixWorld),puffs:5,rise:o.gutted?5:6,size:[.45,2.8],opacity:.38,life:5})),
    glows:[{p:V3(o.seed===11?.45:0,.7,(o.d||3.9)/2-.35).applyMatrix4(group.matrixWorld),s:o.seed===11?2.1:2.8,c:'#ff6924',I:o.seed===11?.32:.50}],
    sparks:[{p:centre.clone(),rate:o.gutted?5:9}],
    lights:[centre.clone().add(V3(0,.3,1.2))],
  };
}
