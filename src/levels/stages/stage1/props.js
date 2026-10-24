// Stage 1 props: boulders (3 displaced variants, instanced), broken rail/wattle fences along the road verge,
// a wrecked cart, barrels, stumps. Wood pieces merge into one mesh per material.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { timber, tube, panel, merge, rngFrom, V3, fbm2, vnoise } from './geo.js';
import { terrainH } from './terrain.js';
import { groundZones } from './groundZones.js';

export function rockGeometry(seed, detail = 3) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.getAttribute('position'), v = new THREE.Vector3();
  const rs = seed * 7.13;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = fbm2(v.x * 1.3 + rs, v.y * 1.3 + v.z * 0.7, seed, 4);
    const facet = Math.round(vnoise(v.x * 2.5 + rs, v.z * 2.5 - v.y, seed + 3) * 3) / 3;
    v.multiplyScalar(0.72 + n * 0.5 + facet * 0.12);
    v.y = v.y > 0 ? v.y * 0.95 : v.y * 0.35;
    p.setXYZ(i, v.x * (1 + (seed % 3) * 0.12), v.y, v.z * 0.85);
  }
  // IcosahedronGeometry is non-indexed: recomputing normals on it made every
  // triangle flat. Weld positions first so the rounded crown shades continuously.
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  const rounded = mergeVertices(g, 1e-4); g.dispose();
  rounded.computeVertexNormals();
  return rounded;
}

export function scatterRocks(ctx, mat, placements, kit = null) {
  const variants = kit ? [0,1,2].map(i => kit.geometries[`stone_${i}`]) : [rockGeometry(1), rockGeometry(2), rockGeometry(5, 2)];
  if (kit) mat = kit.material;
  // The r12 split stones are already small convex meshes. Reuse their distinct
  // wedge/slab/block profiles for chips instead of rounded oval stand-ins.
  const chips = kit ? variants.map(source => {
    const g = source.clone(), p = g.getAttribute('position');
    const uv = new Float32Array(p.count * 2), colors = new Float32Array(p.count * 3);
    for(let i=0;i<p.count;i++) {
      // glTF flips Blender's V: the stone quadrant is lower-right at runtime.
      uv.set([.75+p.getX(i)*.18, .25-p.getY(i)*.18],i*2);
      const crown = THREE.MathUtils.clamp(p.getY(i),0,1);
      colors.set([.59+crown*.21,.63+crown*.16,.66+crown*.10],i*3);
    }
    g.setAttribute('uv',new THREE.BufferAttribute(uv,2));
    g.setAttribute('color',new THREE.BufferAttribute(colors,3));
    g.setAttribute('s1Ember',new THREE.BufferAttribute(new Float32Array(p.count),1));
    g.setAttribute('s1Warm',new THREE.BufferAttribute(new Float32Array(p.count),1));
    return g;
  }) : [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const meshes = [];
  [...variants,...chips].forEach((geo, vi) => {
    const chip = vi >= 3;
    const list = placements.filter((p) => p.v === vi % 3 && (!kit || (p.s < .18) === chip));
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    if (kit) {
      const tones = ['#d9c9b1','#a3afa6','#c4c2be','#958c86','#b2aa96'].map(c=>new THREE.Color(c));
      list.forEach((p,i)=>im.setColorAt(i,tones[Math.abs(Math.floor(p.x*17+p.z*23))%tones.length]));
    }
    list.forEach((p, i) => { e.set(p.tx || 0, p.yaw, p.tz || 0); q.setFromEuler(e); m4.compose(V3(p.x, p.y, p.z), q, V3(p.s * (p.sx || 1), p.s * (p.sy || 1), p.s)); im.setMatrixAt(i, m4); });
    im.castShadow = !chip; im.receiveShadow = true; im.computeBoundingSphere(); im.name = chip ? 'gravel' : 'rocks';
    ctx.group.add(im); meshes.push(im);
  });
  return meshes;
}

/** Wood props (fences, cart, barrels, stumps) → one merged mesh. Returns fire/smoke spots. */
export function buildWoodProps(ctx, mats, fx, rocks = [], huts = []) {
  const rng = rngFrom(53);
  const wood = [];
  const W = (a, b, r, o = {}) => wood.push(timber(a, b, { r, r2: r * 0.9, rng, sides: 5, seg: 3, mask: o.mask || (() => [0.35 + rng.next() * 0.3, 0, 0, 1]), ...o }));
  // Rail fences behind the belt (z ≈ -3.7) in broken runs; a low wattle run in front at the far left/right.
  const fenceRun = (x0, x1, z, broken) => {
    let lastTop = null;
    for (let x = x0; x <= x1; x += 2.1 + rng.next() * 0.4) {
      const lean = (rng.next() - 0.5) * 0.25;
      const h = 1.1 + rng.next() * 0.25;
      const snapped = broken && rng.next() < 0.3;
      const top = V3(x + lean * h, terrainH(x, z) + (snapped ? h * 0.5 : h), z + (rng.next() - 0.5) * 0.1);
      W(V3(x, terrainH(x, z) - 0.2, z), top, 0.07, snapped ? { broken: 0.12 } : {});
      if (lastTop && !snapped && rng.next() > (broken ? 0.35 : 0.1)) {
        for (const k of [0.9, 0.5]) {
          const a = V3(lastTop.x, lastTop.y * k - 0.05, lastTop.z + 0.06), b = V3(top.x, top.y * k - 0.05 + (rng.next() - 0.5) * 0.12, top.z + 0.06);
          W(a, b, 0.045, { seg: 4, bow: 0.04 });
        }
      } else if (lastTop && rng.next() < 0.6) {
        // a fallen rail on the ground
        const a = V3(lastTop.x + 0.2, 0.05, z + 0.4 + rng.next() * 0.5);
        W(a, a.clone().add(V3(1.7, 0.08, (rng.next() - 0.5) * 0.8)), 0.045);
      }
      lastTop = snapped ? null : top;
    }
  };
  fenceRun(-18, 2, -3.75, true); fenceRun(9, 15, -3.8, true); fenceRun(33, 45, -3.7, true); fenceRun(58, 76, -3.8, true);
  // Wrecked cart at the roadside (x ≈ 13, z ≈ -4.6): bed, one wheel on, one fallen, shafts in the dirt.
  const cx = 13.2, cz = -4.9;
  for (let i = 0; i < 6; i++) { const g = panel(2.6, 0.06, 0.26, { mask: () => [0.4 + i * 0.08, i > 3 ? 0.4 : 0, 0, 1] }); g.rotateX(0.02); g.rotateZ(0.22); g.translate(cx, 0.72 + 0.26 * 0.22 * 0, cz - 0.62 + i * 0.26); wood.push(g); }
  W(V3(cx - 1.3, 0.5, cz - 0.7), V3(cx + 1.3, 1.08, cz - 0.7), 0.06); W(V3(cx - 1.3, 0.5, cz + 0.8), V3(cx + 1.3, 1.08, cz + 0.8), 0.06);
  W(V3(cx + 1.2, 1.0, cz - 0.4), V3(cx + 3.4, 0.05, cz - 0.3), 0.05); W(V3(cx + 1.2, 1.0, cz + 0.5), V3(cx + 3.3, 0.05, cz + 0.9), 0.05, { broken: 0.1 });
  const wheel = (x, y, z, rx, ry) => {
    const pts = []; const rr = [];
    for (let i = 0; i <= 16; i++) { const a = (i / 16) * Math.PI * 2; pts.push(V3(Math.cos(a) * 0.62, Math.sin(a) * 0.62, 0)); rr.push(0.06); }
    const rim = tube(pts, rr, { sides: 5, cap: false, mask: () => [0.5, 0, 0, 1] });
    const parts = [rim];
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; parts.push(timber(V3(0, 0, 0), V3(Math.cos(a) * 0.6, Math.sin(a) * 0.6, 0), { r: 0.03, rng, sides: 4, seg: 1, mask: () => [0.4, 0, 0, 1] })); }
    parts.push(timber(V3(0, 0, -0.12), V3(0, 0, 0.12), { r: 0.1, rng, sides: 8, seg: 1 }));
    const g = merge(parts); g.rotateX(rx); g.rotateY(ry); g.translate(x, y, z); wood.push(g);
  };
  wheel(cx - 0.6, 0.62, cz + 0.95, 0, 0.05);
  wheel(cx - 2.3, 0.08, cz + 1.2, Math.PI / 2 - 0.12, 0.4);
  // Displaced cart remnants gather at two verge rock piles, below the actor band.
  wheel(24.0, terrainH(24.0,4.6)+.13, 4.6, Math.PI/2-.17, -.4);
  wheel(52.1, terrainH(52.1,4.7)+.16, 4.7, Math.PI/2-.28, .6);
  // Barrels / crates near huts and the cart
  const barrel = (x, z, tipped) => {
    const pts = [], rr = [];
    for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push(V3(0, t * 0.9, 0)); rr.push(0.3 + Math.sin(t * Math.PI) * 0.06); }
    const parts = [tube(pts, rr, { sides: 12, rng, mask: (t) => [0.08 + t * 0.35, 0, 0, 1] })];
    // iron hoops (charred-black bands)
    for (const hy of [0.12, 0.78]) { const hp = [], hr = []; for (let i = 0; i <= 14; i++) { const a = (i / 14) * Math.PI * 2; const R = 0.31 + Math.sin((hy / 0.9) * Math.PI) * 0.06; hp.push(V3(Math.cos(a) * R, hy, Math.sin(a) * R)); hr.push(0.018); } parts.push(tube(hp, hr, { sides: 4, cap: false, mask: () => [0.9, 0, 0, 1] })); }
    const g = merge(parts);
    if (tipped) { g.rotateZ(Math.PI / 2); g.translate(0.45, 0.33, 0); }
    g.rotateY(rng.next() * 6); g.translate(x, terrainH(x, z), z); wood.push(g);
  };
  barrel(10.6, -4.3, false); barrel(11.3, -3.9, true); barrel(45.5, -4.4, false); // Removed the isolated tipped barrel/hoop from screen 2.
  for (const [x, z] of [[46.3, -4.0], [7.8, -5.9]]) {
    // plank crate: slatted sides + corner battens
    const parts = [];
    for (let i = 0; i < 4; i++) { const s = panel(0.78, 0.16, 0.05, { mask: () => [0.12 + i * 0.05, 0, 0, 1] }); s.translate(0, 0.1 + i * 0.18, 0.37); for (let k = 0; k < 4; k++) { const c = s.clone(); c.rotateY((k * Math.PI) / 2); parts.push(c); } s.dispose(); }
    const lid = panel(0.8, 0.05, 0.8, { mask: () => [0.3, 0, 0, 1] }); lid.translate(0, 0.72, 0); parts.push(lid);
    for (const [cx, cz] of [[-0.38, -0.38], [0.38, -0.38], [-0.38, 0.38], [0.38, 0.38]]) { const b = panel(0.07, 0.74, 0.07, { mask: () => [0.25, 0, 0, 1] }); b.translate(cx, 0.37, cz); parts.push(b); }
    const g = merge(parts); g.rotateY(rng.next()); g.translate(x, terrainH(x, z), z); wood.push(g);
  }
  // Burnt stumps (a couple smoulder)
  for (const [x, z, sm] of [[-6, -5.5, 1], [21, -4.4, 0], [38, -5.2, 1], [52, 4.2, 0], [29, 4.8, 1]]) {
    const r = 0.25 + rng.next() * 0.15, h = 0.4 + rng.next() * 0.5;
    W(V3(x, terrainH(x, z) - 0.1, z), V3(x + 0.05, terrainH(x, z) + h, z), r, { sides: 7, broken: 0.15, mask: (t) => [0.6 + t * 0.4, t > 0.8 ? 0.9 : 0, 0, 1] });
    if (sm) fx.smoke([x, terrainH(x, z) + h + 0.1, z], { puffs: 7, rise: 3.5, size: [0.4, 1.8], opacity: 0.3, life: 5, warm: 0.5 });
  }
  // C1 r6: scattered collapsed rafters anchor the near-verge firelight pools.
  // Kept below boot height and outside the playable belt; merged into this draw.
  const coalRng = rngFrom(906);
  for (const x of [-12, -2.5, 12.5, 25, 39, 53, 69, 84]) {
    for (let i = 0; i < 4; i++) {
      const px = x + (coalRng.next() - 0.5) * 1.3, z = 3.85 + coalRng.next() * 0.9;
      const y = terrainH(px, z) + 0.055;
      W(V3(px, y, z), V3(px + 0.3 + coalRng.next() * 0.7, y + coalRng.next() * 0.06, z + (coalRng.next() - 0.5) * 0.7),
        0.04 + coalRng.next() * 0.025, { sides: 5, seg: 2, broken: 0.08, mask: t => [0.85, 0.3 + t * 0.25, 0, 1] });
    }
  }
  // Splintered boards gather around stones and ruined buildings, leaving the
  // walkable lane quiet. Existing wood draw, no transparent scorch decals.
  // C2 earth pre-board: near-verge stone piles stay mineral; thin charred splinters read as black spikes.
  const piles = rocks.filter(p => p.z <= 3.8 && p.z > 2.9 && p.s > .18).map(p => [p.x, p.z, p.s]);
  for (const h of huts) piles.push([h.x, h.z + 3.2, .7]);
  for (const [cx, cz, scale] of piles) {
    const angle = rng.next() * 6.28;
    for (let i = 0; i < 2 + Math.floor(scale * 2); i++) {
      const x = cx + (rng.next() - .5) * 1.8, z = cz + (rng.next() - .5) * .8;
      const y = terrainH(x, z) + .035, a = angle + (rng.next() - .5) * 1.2;
      const length = .24 + Math.pow(rng.next(), 2) * .65;
      // Broad flat fractured planks, not tapered four-sided spikes. Low ash-grey
      // char keeps their edges legible beside the rock and leaves gaps in the pile.
      const board = panel(length, .065, .12 + rng.next() * .10,
        { mask: () => [.42 + rng.next() * .14, 0, 0, 1] });
      const bp = board.getAttribute('position');
      for (let v = 0; v < bp.count; v++) if (bp.getX(v) > 0 && bp.getZ(v) > 0)
        bp.setX(v, bp.getX(v) - .055);
      board.computeVertexNormals(); board.rotateY(-a); board.rotateZ((rng.next()-.5)*.12);
      board.translate(x + Math.cos(a)*length*.5, y + .025, z + Math.sin(a)*length*.5);
      wood.push(board);
    }
  }
  // Low composed wreckage clusters at each screen's near corners. Planks,
  // snapped ceramic walls and loose reed fans remain below ankle height.
  const pottery=[];
  for(const [cx,cz] of [[1.2,5.3],[8.0,5.5],[20.2,5.2],[27.7,5.4],[40.3,5.3],[47.5,5.4]]) {
    for(let i=0;i<6;i++) {
      const x=cx+(rng.next()-.5)*1.6,z=cz+(rng.next()-.5)*.65;
      const board=panel(.4+rng.next()*.65,.075,.13+rng.next()*.09,{mask:()=>[.34,0,0,1]});
      board.rotateY(rng.next()*2.3);board.translate(x,terrainH(x,z)+.037,z);wood.push(board);
    }
    // Curved broken pot sections: open arcs with a pale fracture edge, no whole
    // prop/collision in the fighting belt. All shards merge into one draw.
    for(let i=0;i<4;i++) {
      const x=cx+(rng.next()-.5)*1.1,z=cz+(rng.next()-.5)*.8;
      const shard=new THREE.LatheGeometry([new THREE.Vector2(.17,.08),new THREE.Vector2(.24,-.08),new THREE.Vector2(.223,-.08),new THREE.Vector2(.153,.08),new THREE.Vector2(.17,.08)],7,0,1.1+rng.next()*.8);
      shard.rotateZ(.55+rng.next());shard.rotateY(rng.next()*6.28);
      shard.translate(x,terrainH(x,z)+.11,z);pottery.push(shard);
    }
    for(let i=0;i<16;i++) {
      const x=cx+.6+(rng.next()-.5)*.4,z=cz+(rng.next()-.5)*.3;
      W(V3(x,terrainH(x,z)+.025,z),V3(x+.3+rng.next()*.35,terrainH(x,z)+.04,z+(rng.next()-.5)*.3),.009,
        {seg:1,sides:3,mask:()=>[.55,0,0,1]});
    }
  }
  // Rough fired clay with mineral speckle and lighter exposed broken edges.
  const clayData=new Uint8Array(128*128*4);
  for(let i=0;i<128*128;i++) {
    const grit=rng.next(), tone=.65+grit*.5;
    clayData.set([107*tone,78*tone,53*tone,255],i*4);
  }
  const clayMap=new THREE.DataTexture(clayData,128,128);
  clayMap.colorSpace=THREE.SRGBColorSpace;clayMap.wrapS=clayMap.wrapT=THREE.RepeatWrapping;
  clayMap.generateMipmaps=true;clayMap.minFilter=THREE.LinearMipmapLinearFilter;
  clayMap.needsUpdate=true;
  const ceramicMat=new THREE.MeshLambertMaterial({map:clayMap,side:THREE.DoubleSide});
  ceramicMat.addEventListener('dispose',()=>clayMap.dispose());
  const ceramic=new THREE.Mesh(merge(pottery),ceramicMat);ceramic.receiveShadow=true;ceramic.castShadow=true;ceramic.name='brokenPotClusters';ctx.group.add(ceramic);
  // Thin fallen thatch gathers in ash drifts rather than uniform confetti.
  for (let i=0;i<150;i++) {
    const x=-14+rng.next()*90,z=3.0+rng.next()*3.5;
    if(rng.next()>groundZones(x,z).ash*.9) continue;
    const angle=rng.next()*1.2-.6;
    for(let j=0;j<5;j++) {
      const px=x+(rng.next()-.5)*.22,pz=z+(rng.next()-.5)*.16, y=terrainH(px,pz)+.018;
      const len=.16+rng.next()*.35;
      W(V3(px,y,pz),V3(px+len*Math.cos(angle),y+.012,pz+len*Math.sin(angle)),.009,
        {seg:1,sides:3,mask:()=>[.68,0,0,1]});
    }
  }
  const g = merge(wood);
  const m = new THREE.Mesh(g, mats.wood);
  m.castShadow = true; m.receiveShadow = true; m.name = 'woodProps';
  ctx.group.add(m);
  return m;
}
