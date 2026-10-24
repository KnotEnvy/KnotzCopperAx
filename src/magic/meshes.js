// Procedural spell props (magic-owned): lit instanced stone (earth spikes, basalt columns, boulders, the titan
// fist) with glowing element veins, and an emissive lightning-hammer. One InstancedMesh per prop kind, lazily built
// and kept for the session (a draw call only while something is alive; columns use three instanced variants).
//
//   const f = rockField(vfx, 'spike'|'column'|'boulder'|'chip'|'fist', { glow: '#7cff9a' })
//   f.add({ pos:{x,y,z}, scale:[sx,sy,sz], yaw, tilt:[x,z], rise, hold, sink, delay, vel:[..], gravity, spin:[..],
//           onLand(inst), sinkDepth, crumble }) → inst (crumble: shrink/break in place instead of sinking)
//   f.glow(v)   vein emissive (0..)       energyHammer() → { mesh, material } (lathed storm-cage hammer, uniforms uT/uA/uCol/uHot/uInk)
import * as THREE from 'three';
import { stoneMaterial, stoneSightlines, preloadStoneSurface } from './_earthStone.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();

function hash3(x, y, z) { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); }

/** Jitter every vertex by a position hash (seams stay closed), then recompute flat normals. */
function roughen(geo, amt, { keepBase = false, yScale = 1 } = {}) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = Math.round(x * 1000) * 0.001, l = Math.round(y * 1000) * 0.001, m = Math.round(z * 1000) * 0.001;
    const base = keepBase && y < 0.02 ? 0.25 : 1;
    p.setXYZ(i, x + (hash3(k, l, m) - 0.5) * amt * base, y + (hash3(l, m, k) - 0.5) * amt * yScale * base, z + (hash3(m, k, l) - 0.5) * amt * base);
  }
  geo.computeVertexNormals();
  return geo;
}

let _veinTex = null;
function veinTexture() {
  if (_veinTex) return _veinTex;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
  let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.lineCap = 'round';
  // Sparse, broken rune fissures: dark recess, warm amber glow, thin hot interior.
  for (let i = 0; i < 4; i++) {
    const points = []; let x = rnd() * 256, y = rnd() * 256;
    for (let k = 0; k < 6; k++) { points.push([x, y]); x += (rnd() - 0.5) * 34; y += 13 + rnd() * 12; }
    for (let pass = 0; pass < 2; pass++) {
      g.beginPath(); points.forEach(([px, py], k) => k ? g.lineTo(px, py) : g.moveTo(px, py));
      g.strokeStyle = pass ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.12)';
      g.lineWidth = pass ? 1.8 : 5; g.stroke();
    }
    // Chiselled rune cross-stroke; interrupted instead of a web of identical neon lines.
    const [px, py] = points[2]; g.beginPath(); g.moveTo(px - 7, py - 6); g.lineTo(px + 7, py + 3); g.lineTo(px - 3, py + 12);
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 2.4; g.stroke();
  }
  _veinTex = new THREE.CanvasTexture(c);
  _veinTex.wrapS = _veinTex.wrapT = THREE.RepeatWrapping;
  return _veinTex;
}

function spikeGeo() {
  const g = new THREE.ConeGeometry(0.34, 1.9, 5, 4, false);
  g.translate(0, 0.95, 0);
  return roughen(g.toNonIndexed(), 0.12, { keepBase: true });
}
function columnGeo() {
  // Three offset basalt splinters form a fractured mass; gaps and unequal summits supply real fracture depth.
  const pieces = [];
  for (let j = 0; j < 3; j++) {
    const h = [1, 0.72, 0.54][j], a = j * 2.4, d = j ? 0.42 : 0;
    const g = new THREE.CylinderGeometry(j ? 0.22 : 0.3, j ? 0.29 : 0.38, h, 5, 6, false);
    g.translate(Math.cos(a) * d, h * 0.5, Math.sin(a) * d);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), band = Math.round(y / h * 6);
      // Unequal fault offsets make actual ledges and a slanting cleaved crown, rather than painted flat slabs.
      if (y > h - 0.01) p.setY(i, h + p.getX(i) * 0.28 - p.getZ(i) * 0.19);
      if (band > 0 && band < 6) {
        const step = band % 2 ? 1.08 : 0.89;
        p.setX(i, (p.getX(i) - Math.cos(a) * d) * step + Math.cos(a) * d + (band % 2 ? 0.025 : -0.025));
        p.setZ(i, (p.getZ(i) - Math.sin(a) * d) * step + Math.sin(a) * d);
      }
    }
    pieces.push(roughen(g.toNonIndexed(), 0.075, { keepBase: true, yScale: 0.6 }));
  }
  return boxUV(mergeGeometries(pieces), 1.35);
}
function boulderGeo() {
  // Large unequal angular masses, with recessed fracture rims in the same opaque stone draw.
  const core=roughen(new THREE.IcosahedronGeometry(1,2),.32).scale(1.04,.86,.92);
  const shoulder=roughen(new THREE.IcosahedronGeometry(.62,1),.20).translate(-.60,.12,.22);
  const heel=roughen(new THREE.IcosahedronGeometry(.57,1),.18).translate(.42,.25,-.54);
  return fracturedRock(boxUV(mergeGeometries([core,shoulder,heel].map(g=>g.index?g.toNonIndexed():g)),1.4),1.6);
}
function fracturedRock(geo, frequency = 2.4, titan = false) {
  const p=geo.attributes.position, n=geo.attributes.normal;
  const heat=new Float32Array(p.count), bounce=new Float32Array(p.count), colors=new Float32Array(p.count*3);
  for(let i=0;i<p.count;i++) {
    const x=p.getX(i)*frequency,y=p.getY(i)*frequency,z=p.getZ(i)*frequency;
    let first=1e6,second=1e6,shade=1;
    for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++) for(let dz=-1;dz<=1;dz++) {
      const cx=Math.floor(x)+dx,cy=Math.floor(y)+dy,cz=Math.floor(z)+dz;
      const sx=cx+.15+hash3(cx,cy,cz)*.7,sy=cy+.15+hash3(cy,cz,cx)*.7,sz=cz+.15+hash3(cz,cx,cy)*.7;
      const d=(x-sx)**2+(y-sy)**2+(z-sz)**2;
      if(d<first) {second=first;first=d;shade=.58+hash3(cx+9,cy,cz)*.4;} else if(d<second)second=d;
    }
    const distance=(Math.sqrt(second)-Math.sqrt(first))/frequency;
    const seam=Math.max(0,1-distance/(titan ? .026 : .055)), recess=seam*seam*(titan ? .025 : .048);
    p.setXYZ(i,p.getX(i)-n.getX(i)*recess,p.getY(i)-n.getY(i)*recess,p.getZ(i)-n.getZ(i)*recess);
    heat[i]=Math.pow(seam,2)*(titan ? .33 : .40+.24*hash3(Math.floor(x),Math.floor(y),Math.floor(z)));
    bounce[i]=Math.exp(-distance/(titan ? .055 : .12))*(titan ? .10 : .30);
    colors.set([shade,shade,shade],i*3);
  }
  geo.setAttribute('color',new THREE.BufferAttribute(colors,3));
  geo.setAttribute('aStoneHeat',new THREE.BufferAttribute(heat,1));
  geo.setAttribute('aStoneBounce',new THREE.BufferAttribute(bounce,1));
  geo.computeVertexNormals();geo.computeBoundingBox();geo.computeBoundingSphere();
  return geo;
}
function chipGeo() {
  // Equant broken basalt, broad shaded faces and bevels rather than thin flat splinters.
  const g = new THREE.CylinderGeometry(0.39, 0.47, 0.94, 6, 2, false);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), edge = Math.abs(y) > .4;
    if (edge) { p.setX(i, p.getX(i) * .78); p.setZ(i, p.getZ(i) * .78); }
    if (y > 0) p.setY(i, y + p.getX(i) * .23 - p.getZ(i) * .31);
  }
  return boxUV(roughen(g.toNonIndexed(), .065), 1.1);
}

function fistGeo() {
  // Stone titan fist, knuckles down (+Y up the forearm). ~1 unit = 1 m at scale 1; instance scale ~3.
  const parts = [];
  const box = (w, h, d, x, y, z, rx = 0, rz = 0) => { const b = new THREE.BoxGeometry(w, h, d, 2, 2, 2); b.rotateX(rx); b.rotateZ(rz); b.translate(x, y, z); parts.push(b); };
  box(1.5, 1.0, 1.2, 0, 0.75, 0);                                    // palm block
  for (let i = 0; i < 4; i++) {                                        // curled fingers: knuckle row at the bottom
    const x = -0.56 + i * 0.37;
    box(0.34, 0.42, 0.5, x, 0.2, 0.36, 0.2);
    box(0.32, 0.36, 0.42, x, 0.12, -0.08, -0.3);
  }
  box(0.4, 0.75, 0.42, 0.86, 0.6, 0.25, 0.3, -0.5);                   // thumb
  const arm = new THREE.CylinderGeometry(0.62, 0.8, 5.5, 7, 6); arm.translate(0, 3.9, -0.05); parts.push(arm);
  const bands = new THREE.TorusGeometry(0.72, 0.1, 5, 9); bands.rotateX(Math.PI / 2); bands.translate(0, 2.2, -0.05); parts.push(bands);
  const g = mergeGeometries(parts.map((q) => q.toNonIndexed()));
  return roughen(g, 0.09);
}

const GEOS = { spike: spikeGeo, column: columnGeo, boulder: boulderGeo, chip: chipGeo, fist: fistGeo };

/** Box-projected UVs (per-face dominant axis) so the vein emissive map wraps a sculpted GLB without seams mattering. */
function boxUV(geo, scale = 0.5) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i += 3) {
    let nx = 0, ny = 0, nz = 0;
    for (let k = 0; k < 3; k++) { nx += Math.abs(n.getX(i + k)); ny += Math.abs(n.getY(i + k)); nz += Math.abs(n.getZ(i + k)); }
    for (let k = 0; k < 3; k++) {
      const x = p.getX(i + k), y = p.getY(i + k), z = p.getZ(i + k);
      const [u, v] = nx >= ny && nx >= nz ? [z, y] : ny >= nz ? [x, z] : [x, y];
      uv[(i + k) * 2] = u * scale; uv[(i + k) * 2 + 1] = v * scale;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** The fist and every earth tier share the sculpted/baked basalt family. */
export function preloadTitanFist(vfx) { return preloadBasalt(vfx); }
let basaltGLBs;
/** Three authored fracture silhouettes, instanced separately; one material program, no extra render pass. */
export async function preloadBasalt(vfx) {
  if (!basaltGLBs) basaltGLBs = import('three/addons/loaders/GLTFLoader.js').then(({ GLTFLoader }) =>
    Promise.all([0, 1, 2, 3, 4, 5].map(async variant => {
      const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL || '/'}assets/models/${['magic_basalt0', 'magic_basalt1', 'magic_basalt2', 'magic_earth_chip', 'magic_earth_boulder', 'magic_earth_fist'][variant]}.glb`);
      let geo;
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse(o => { if (!geo && o.isMesh) { geo = o.geometry.clone().applyMatrix4(o.matrixWorld); geo.userData.earthShardIndexCount = o.userData.earthShardIndexCount; } });
      const color = geo?.attributes.color_1 || geo?.attributes.color, uv = geo?.attributes.uv1;
      if (!color || !uv) throw new Error('Basalt fracture attributes missing');
      geo.setAttribute('aStoneHeat', new THREE.BufferAttribute(Float32Array.from({ length: uv.count }, (_, i) => uv.getX(i)), 1));
      geo.setAttribute('aStoneBounce', new THREE.BufferAttribute(Float32Array.from({ length: uv.count }, (_, i) => 1 - uv.getY(i)), 1));
      const xy = geo.attributes.uv2, zi = geo.attributes.uv3;
      if (!xy || !zi) throw new Error('Basalt chunk pivots missing');
      const pivots = new Float32Array(uv.count * 3), seeds = new Float32Array(uv.count);
      for (let i = 0; i < uv.count; i++) { pivots.set([xy.getX(i), zi.getX(i), -(1 - xy.getY(i))], i * 3); seeds[i] = 1 - zi.getY(i); }
      geo.setAttribute('aStonePivot', new THREE.BufferAttribute(pivots, 3));
      geo.setAttribute('aStoneSeed', new THREE.BufferAttribute(seeds, 1));
      const rgb = new Float32Array(color.count * 3);
      for (let i = 0; i < color.count; i++) rgb.set([color.getX(i), color.getY(i), color.getZ(i)], i * 3);
      geo.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
      return geo;
    })));
  const [geos] = await Promise.all([basaltGLBs, preloadStoneSurface()]);
  geos.slice(0, 3).forEach((g, variant) => rockField(vfx, 'column', { variant }).geometry(g.clone()));
  // Lower-cost pointed chipped rocks for the many T1/T4 fault spikes; full columns remain hero assets.
  const shard = geos[3].clone(), sp = shard.attributes.position;
  for (let i=0;i<sp.count;i++) {
    const taper=Math.max(.12,1-sp.getY(i)*.95);
    sp.setXYZ(i,sp.getX(i)*taper*.70,sp.getY(i)*1.9,sp.getZ(i)*taper*.70);
  }
  shard.computeVertexNormals(); shard.computeBoundingBox(); shard.computeBoundingSphere();
  rockField(vfx, 'spike').geometry(shard);
  rockField(vfx, 'boulder').geometry(geos[4].clone());
  rockField(vfx, 'fist').geometry(geos[5].clone());
  const chip = geos[3].clone(); chip.translate(0, -.40, 0); rockField(vfx, 'chip').geometry(chip);
}
const CAPS = { spike: 96, column: 40, boulder: 40, chip: 320, fist: 2 };
const TINT = { spike: '#737477', column: '#777e89', boulder: '#747476', chip: '#737478', fist: '#8b9099' };

const fields = new WeakMap();

export function rockField(vfx, kind, { glow = '#ffad42', variant = 0 } = {}) {
  let per = fields.get(vfx);
  if (!per) { per = {}; fields.set(vfx, per); }
  const key = kind === 'column' ? `column${variant}` : kind;
  if (per[key]) { per[key].mat.emissive.set(glow); return per[key]; }
  let geo = GEOS[kind]();
  const basalt = ['column', 'spike', 'boulder', 'chip', 'fist'].includes(kind);
  if (basalt) {
    if (!geo.attributes.color) geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(1), 3));
    if (!geo.attributes.aStoneHeat) geo.setAttribute('aStoneHeat', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count), 1));
  }
  const tex = veinTexture();
  const protect = kind === 'column' || kind === 'spike';
  const mat = stoneMaterial(TINT[kind], glow, tex, protect, basalt);
  const cap = CAPS[kind];
  const collapse = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2).setUsage(THREE.DynamicDrawUsage);
  const energy = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage);
  const defaults = next => {
    const count = next.attributes.position.count;
    for (const [key, size] of [['aStoneHeat',1],['aStoneBounce',1],['aStonePivot',3],['aStoneSeed',1]])
      if (!next.attributes[key]) next.setAttribute(key, new THREE.BufferAttribute(new Float32Array(count * size), size));
    next.setAttribute('aStoneCollapse', collapse); next.setAttribute('aStoneEnergy', energy);
  };
  if (basalt) defaults(geo);
  const sightlines = protect ? stoneSightlines(vfx) : null;
  const mesh = new THREE.InstancedMesh(geo, mat, cap);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0; mesh.visible = false; mesh.frustumCulled = false;
  mesh.castShadow = !protect; mesh.receiveShadow = true;
  if (protect) mesh.renderOrder = -2; // opaque basalt before scenery: depth rejects the hidden ground/walls
  mesh.userData.magicOccluder = protect;
  mesh.userData.magicOpacity = new Float32Array(cap).fill(1);
  mesh.userData.magicDither = false; mesh.userData.magicMaskOnly = false;
  mesh.userData.magicDebrisStats = { bounces: 0, landings: 0 };
  mesh.userData.magicPlacement = { moved: 0, skipped: 0, retired: 0 };
  mesh.name = `magic_${kind}`; mesh.userData.basaltVariant = basalt ? variant : null;
  vfx.group.add(mesh);
  const list = [], rendered = [];
  let running = false;
  const f = {
    mesh, mat, list, glowV: 0,
    glow(v) { f.glowV = v; mat.emissiveIntensity = v; mat.userData.stoneHeatGain.value = Math.min(2, v); },
    geometry(next) {
      if (basalt) {
        defaults(next);
        if (!next.attributes.aStoneHeat) next.setAttribute('aStoneHeat', new THREE.BufferAttribute(new Float32Array(next.attributes.position.count), 1));
        if (!next.attributes.color) next.setAttribute('color', new THREE.BufferAttribute(new Float32Array(next.attributes.position.count * 3).fill(1), 3));
      }
      geo.dispose(); geo = next; mesh.geometry = next;
    },
    /** Erupt beside the contact, or behind it in depth. Never dissolve a stone over a body. */
    site(it) {
      if (!sightlines) return true;
      sightlines.prepare();
      _e.set(it.tilt[0], it.yaw, it.tilt[1]); _q.setFromEuler(_e); _s.fromArray(it.s);
      const x = it.x, z = it.z;
      if (it.contact) {
        for (const width of [1, .75, .5]) {
          // Test the actual breach crown, not a future full-height stone beside grounded fighters.
          _s.set(it.s[0] * width, .02, it.s[2] * width); _p.set(x, it.y, z); _m.compose(_p, _q, _s);
          if (!sightlines.blocked(geo, _m, it.contact)) { it.s = [it.s[0]*width,it.s[1],it.s[2]*width]; return true; }
        }
        // Co-located feet can make even a 2cm crown fail the conservative body box.
        // Start its narrow solid beneath the ground; the per-frame guard governs its emergence.
        it.s = [it.s[0] * .35, it.s[1], it.s[2] * .35]; return true;
      }
      for (const [dx, dz] of [[0, 0], [-1.25, -.35], [1.25, -.35], [0, -1.8], [-1.7, -1.5], [1.7, -1.5], [0, -3.2], [0, -4.6]]) {
        _p.set(x + dx, it.y, z + dz); _m.compose(_p, _q, _s);
        if (!sightlines.blocked(geo, _m, it.contact)) {
          it.x = x + dx; it.z = z + dz;
          if (dx || dz) mesh.userData.magicPlacement.moved++;
          return true;
        }
      }
      mesh.userData.magicPlacement.skipped++; return false;
    },
    /** Drop every instance now (vfx.clear() calls this via mesh.userData.vfxReset). */
    reset() { list.length = 0; mesh.count = 0; mesh.visible = false; running = false; f._em = null; },
    add(o) {
      if (list.length >= cap) list.shift();
      const inst = { x: o.pos.x, y: o.pos.y ?? 0, z: o.pos.z, s: o.scale || [1, 1, 1], yaw: o.yaw ?? vfx.rng.range(0, 6.28), tilt: o.tilt || [0, 0],
        rise: o.rise ?? 0.12, hold: o.hold ?? 1.2, sink: o.sink ?? 0.5, delay: o.delay ?? 0, t: 0, vel: o.vel ? [...o.vel] : null, gravity: o.gravity ?? 0,
        spin: o.spin || [0, 0, 0], rot: [0, 0, 0], onLand: o.onLand, landed: false, groundY: o.groundY ?? (o.pos.y ?? 0), depth: o.sinkDepth ?? (o.scale ? o.scale[1] : 1) * 1.1,
        contact: o.contact || null, fracture: !!o.fracture, simBreach: !!o.simBreach, startTick: vfx.game.tick, update: o.update || null, onBreach: o.onBreach, onCrumble: o.onCrumble, breached: false, fractured: false, crumble: !!o.crumble, bounce: o.bounce || 0, bounces: 0 };
      if (protect && !f.site(inst)) {
        inst.omitted = true;
        if (inst.onBreach) inst.onBreach(inst);
        return null;
      }
      list.push(inst);
      if (inst.simBreach) { inst.breached = true; if (inst.onBreach) inst.onBreach(inst); }
      // (re)start the driver; vfx.clear() drops emitters, so a stale `running` must not strand the field frozen
      if (!running || !vfx.emitters.includes(f._em)) { running = true; f._em = vfx.emitter(1e9, (u, dt) => f._tick(dt)); }
      return inst;
    },
    _tick(dt) {
      let n = 0;
      if (sightlines) sightlines.prepare();
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        if (it.culled) { list.splice(i--, 1); continue; }
        if (it.simBreach) it.t = (vfx.game.tick - it.startTick + 1) / 60;
        else it.t += dt;
        const a = it.t - it.delay;
        if (a < 0) continue;
        if (!it.breached) { it.breached = true; if (it.onBreach) it.onBreach(it); }
        // Release the actual cells as the rider begins falling, before a solid crown can cover its body.
        if (it.fracture && it.contact && !it.fractured && a > it.rise && it.contact.vel.y < 0) {
          it.hold = Math.max(0, a - it.rise); it.fractured = true;
          if (it.onCrumble) it.onCrumble(it);
        }
        if (it.onCrumble && a >= it.rise + it.hold) {
          if (!it.fractured) { it.fractured = true; it.onCrumble(it); }
          if (!it.fracture) { list.splice(i--, 1); continue; }
        }
        const end = it.rise + it.hold + it.sink;
        if (a > end) { list.splice(i--, 1); continue; }
        let oy = 0, sc = 1;
        if (it.vel && !it.landed) {
          it.vel[1] -= it.gravity * dt;
          it.x += it.vel[0] * dt; it.y += it.vel[1] * dt; it.z += it.vel[2] * dt;
          for (let k = 0; k < 3; k++) it.rot[k] += it.spin[k] * dt;
          if (it.y <= it.groundY && it.vel[1] < 0) {
            it.y = it.groundY;
            if (it.bounce && !it.bounces && it.vel[1] < -1.2) {
              it.vel[1] *= -it.bounce; it.vel[0] *= 0.5; it.vel[2] *= 0.5; it.bounces++; mesh.userData.magicDebrisStats.bounces++;
              for (let k = 0; k < 3; k++) it.spin[k] *= 0.45;
              if (it.onLand) try { it.onLand(it); } catch (e) { /* cosmetic */ }
            } else {
              mesh.userData.magicDebrisStats.landings++;
              it.landed = true; it.hold = Math.max(0, a - it.rise) + 0.24;
              if (!it.bounces && it.onLand) try { it.onLand(it); } catch (e) { /* cosmetic */ }
            }
          }
        } else if (!it.vel) {
          if (a < it.rise) { const k = a / it.rise; oy = -it.depth * (1 - (1 + 2.2 * (k - 1) ** 3 + 1.2 * (k - 1) ** 2)); }
        }
        if (it.update) it.update(it, a, dt);
        if (a > it.rise + it.hold) {
          const k = (a - it.rise - it.hold) / it.sink;
          if (it.fracture) { /* Rigid authored chunks fall in the vertex shader, preserving real interior faces. */ }
          else if (it.crumble) { sc = Math.max(0, 1 - k); it.rot[2] += dt * 0.8; }
          else { oy -= it.depth * k * k * 0.9; sc = 1 - k * 0.35; }
        }
        _e.set(it.tilt[0] + it.rot[0], it.yaw + it.rot[1], it.tilt[1] + it.rot[2]);
        _q.setFromEuler(_e);
        _s.set(it.s[0] * sc, it.s[1] * (it.vel || it.crumble ? sc : 1), it.s[2] * sc);
        // During launch the emerging crown follows the same simulated foot, preventing side eruptions.
        if (it.contact && !it.fractured && !it.contact.removed && it.contact.vel.y >= 0) {
          if (!geo.boundingBox) geo.computeBoundingBox();
          _s.y = Math.min(_s.y, Math.max(.015, ((it.contact.groundY || 0) + it.contact.pos.y - it.y - oy) / geo.boundingBox.max.y));
        }
        _p.set(it.x, it.y + oy, it.z);
        _m.compose(_p, _q, _s);
        // If a fighter later crosses a foreground rock, retire it below the ground as a whole.
        // Placement handles the eruption; this safety catch never creates a screen-space hole.
        if (sightlines && a > it.rise && sightlines.blocked(geo, _m, it.fractured || it.contact?.vel.y >= 0 ? it.contact : null)) {
          mesh.userData.magicPlacement.retired++; list.splice(i--, 1); continue;
        }
        if (basalt) {
          const fall = it.fractured ? Math.max(0, a - it.rise - it.hold) : 0;
          // Fracture faces stay orange then cool through red over ~0.6 s, including small airborne grit.
          const cooling = it.fracture ? fall : kind === 'chip' ? a * .55 : 0;
          energy.setX(n, (kind === 'chip' ? .92 : .94 + .06 * Math.exp(-a * 7)) * Math.exp(-cooling * 2.7));
          collapse.setXY(n, it.fracture ? fall : 0, it.groundY);
        }
        rendered[n] = it; mesh.setMatrixAt(n++, _m);
      }
      mesh.count = n; mesh.visible = n > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (basalt) { energy.needsUpdate = true; collapse.needsUpdate = true; }
      if (!list.length) { running = false; return false; }
      return true;
    },
  };
  // Camera drama is applied after VFX. Recheck its final view before submitting opaque stones.
  if (sightlines) vfx.game.addSystem({ name: `earthSightlines_${key}`, order: 88, render() {
    if (!mesh.visible) return;
    sightlines.prepare();
    for (let n = 0; n < mesh.count; n++) {
      mesh.getMatrixAt(n, _m);
      if (!sightlines.blocked(geo, _m, rendered[n]?.fractured || rendered[n]?.contact?.vel.y >= 0 ? rendered[n]?.contact : null)) continue;
      if (rendered[n]) rendered[n].culled = true;
      mesh.userData.magicPlacement.retired++;
      _m.makeScale(0, 0, 0); mesh.setMatrixAt(n, _m); mesh.instanceMatrix.needsUpdate = true;
    }
  } });
  mesh.userData.vfxReset = () => f.reset();
  per[key] = f;
  return f;
}

/** Storm-hammer mesh (Thunder Anvil). The head is a LATHED dwarf war-hammer (flared octagonal striking faces, pinched
 *  waist, centre collar), never a box; the shader draws it as a toon-banded storm CAGE: dim violet core, cel rim bands,
 *  a thin ink outline, and a crackling bolt lattice (8 jagged axial ribs + face rings, spiral-wrapped haft). */
export function energyHammer() {
  const P = [[0, -1.9], [0.62, -1.9], [0.86, -1.8], [0.98, -1.58], [0.98, -1.22], [0.84, -1.04], [0.74, -0.8], [0.7, -0.42],
    [0.8, -0.3], [0.82, 0], [0.8, 0.3], [0.7, 0.42], [0.74, 0.8], [0.84, 1.04], [0.98, 1.22], [0.98, 1.58], [0.86, 1.8], [0.62, 1.9], [0, 1.9]];
  const head = new THREE.LatheGeometry(P.map(([r, y]) => new THREE.Vector2(r, y)), 16);
  head.rotateZ(Math.PI / 2); head.rotateX(Math.PI / 16);
  const haft = new THREE.CylinderGeometry(0.2, 0.25, 4.6, 12, 10); haft.translate(0, 3.1, 0);
  const pom = new THREE.OctahedronGeometry(0.42, 1); pom.scale(1, 1.3, 1); pom.translate(0, 5.6, 0);
  const strip = (g) => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k); return n; };
  const geo = mergeGeometries([strip(head), strip(haft), strip(pom)]);
  const material = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uA: { value: 0 }, uCol: { value: new THREE.Color('#4a28e0') }, uHot: { value: new THREE.Color('#bfeaff') },
      uInk: { value: new THREE.Color('#05031c') } },
    vertexShader: `varying vec3 vP; varying vec3 vN; varying vec3 vV; varying vec2 vUv;
      void main(){ vP = position; vUv = uv; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uT; uniform float uA; uniform vec3 uCol; uniform vec3 uHot; uniform vec3 uInk; varying vec3 vP; varying vec3 vN; varying vec3 vV; varying vec2 vUv;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
      float n3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
      float line(float d, float w){ return 1.0 - smoothstep(w, w * 2.4, d); }
      void main(){
        float fres = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float haft = step(1.0, vP.y);
        float t = floor(uT * 20.0);                       // bolts re-jag at 20 Hz (hand-drawn crackle, not a smooth warp)
        // head: 8 jagged axial ribs + rings at the flares/collar; haft: a double spiral wrap
        float along = mix(vP.x, vP.y, haft);
        float jit = (n3(vec3(along * 7.0, vUv.x * 8.0, t)) - 0.5) * 0.9 + (abs(fract(along * 2.6 + t * 0.37) - 0.5) - 0.25) * 0.5;
        float rib = abs(fract(vUv.x * mix(8.0, 3.0, haft) + jit + mix(0.0, along * 0.9, haft)) - 0.5);
        float ribs = line(0.5 - rib, 0.016);
        float ax = abs(vP.x);
        float rings = (1.0 - haft) * line(min(min(abs(ax - 1.22), abs(ax - 1.58)), abs(ax - 0.36)) + (n3(vec3(vUv.x * 40.0, t, 1.0)) - 0.5) * 0.05, 0.012);
        float gate = step(0.38, n3(vec3(along * 1.6 - uT * 11.0, vUv.x * 8.0, 3.0)));   // crackle travels along the ribs
        float lat = max(ribs * gate, rings * (0.55 + 0.45 * gate));
        // toon bands: dim core, bright storm rim band, thin ink outline at the silhouette
        float band = fres < 0.45 ? 0.1 : (fres < 0.72 ? 0.35 : 1.0);
        float ink = smoothstep(0.84, 0.9, fres);
        vec3 body = mix(uCol * 0.6, mix(uCol, uHot, 0.35), step(0.7, fres)) * (0.35 + band);
        float a = 0.1 + band * 0.5;
        vec3 c = body * a;
        c = mix(c, uInk, ink); a = mix(a, 0.95, ink);
        float flick = 0.8 + 0.2 * sin(uT * 60.0 + along * 4.0);
        c += mix(uHot, vec3(1.0), 0.5) * lat * 2.6 * flick * (1.0 - ink); a = min(1.0, a + lat * 0.3);
        gl_FragColor = vec4(c * uA, a * uA);
      }`,
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, side: THREE.FrontSide,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.renderOrder = 18; mesh.frustumCulled = false;
  return { mesh, material };
}
