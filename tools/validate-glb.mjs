#!/usr/bin/env node
// KnotzCopperAx GLB contract validator (no dependencies).
//
//   node tools/validate-glb.mjs public/assets/models/hero_brann.glb [--kind character|weapon|prop]
//        [--height 1.95] [--height-tol 0.05] [--tris 30000] [--tex 2048] [--json]
//   node tools/validate-glb.mjs public/assets/models/weapon_grudgebrand.glb --kind weapon --tris 3000
//
// character: exact bone names + hierarchy of docs/ARCHITECTURE.md §2 (+ optional chains), no '.' in names,
//            root at origin, hips at pelvis height, faces +Z, left side on +X, A-pose arm angle, feet on Y=0,
//            height, triangle budget, texture sizes (power of two, <= max), skin weights (normalised, <= 4
//            influences, every vertex weighted, sockets carry no weight, no vertex bound to a far-away joint).
// weapon:    triangle budget, grip at origin, blade along +Y, textures.
// Prints a report (or JSON with --json); exit code 1 when any check fails.
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = { _: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2), n = argv[i + 1];
    if (n === undefined || n.startsWith('--')) opt[k] = true; else { opt[k] = n; i++; }
  } else opt._.push(a);
}
const file = opt._[0];
if (!file) { console.error('usage: node tools/validate-glb.mjs <file.glb> [--kind character|weapon] ...'); process.exit(2); }
const kind = opt.kind || (/weapon_/.test(path.basename(file)) ? 'weapon' : 'character');
// Budgets: heroes + bosses 75 000 (owner 2026-10-26), other characters 30 000, weapons 3 000.
const heroOrBoss = /^(hero|boss)_/.test(path.basename(file)) && kind === 'character';
const maxTris = Number(opt.tris || (kind === 'weapon' ? 3000 : heroOrBoss ? 75000 : 30000));
const maxTex = Number(opt.tex || 2048);
const expH = opt.height !== undefined ? Number(opt.height) : null;
const hTol = Number(opt['height-tol'] || 0.05);

// ------------------------------------------------------------------------------------------ GLB parsing
const buf = fs.readFileSync(file);
if (buf.readUInt32LE(0) !== 0x46546c67) fail('not a GLB (bad magic)');
let off = 12, json = null, bin = null;
while (off < buf.length) {
  const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
  const data = buf.subarray(off + 8, off + 8 + len);
  if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
  else if (type === 0x004e4942) bin = data;
  off += 8 + len;
}
function fail(m) { console.error('FATAL:', m); process.exit(1); }
if (!json) fail('no JSON chunk');

const CT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function accessor(i) {
  const a = json.accessors[i];
  const bv = json.bufferViews[a.bufferView];
  const T = CT[a.componentType], nc = NC[a.type];
  const stride = bv.byteStride || T.BYTES_PER_ELEMENT * nc;
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = new Float64Array(a.count * nc);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const rd = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
  for (let k = 0; k < a.count; k++) for (let c = 0; c < nc; c++) {
    let v = dv[rd](base + k * stride + c * T.BYTES_PER_ELEMENT, true);
    if (a.normalized) v /= { 5121: 255, 5123: 65535, 5120: 127, 5122: 32767 }[a.componentType] || 1;
    out[k * nc + c] = v;
  }
  return { data: out, count: a.count, nc, min: a.min, max: a.max };
}

// matrices (column-major 4x4 like glTF)
const I4 = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s;
  }
  return o;
}
function trs(n) {
  if (n.matrix) return n.matrix.slice();
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale || [1, 1, 1];
  const [tx, ty, tz] = n.translation || [0, 0, 0];
  return [(1 - 2 * (y * y + z * z)) * sx, (2 * (x * y + z * w)) * sx, (2 * (x * z - y * w)) * sx, 0,
    (2 * (x * y - z * w)) * sy, (1 - 2 * (x * x + z * z)) * sy, (2 * (y * z + x * w)) * sy, 0,
    (2 * (x * z + y * w)) * sz, (2 * (y * z - x * w)) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
}
const xf = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];

const nodes = json.nodes || [];
const parent = new Array(nodes.length).fill(-1);
nodes.forEach((n, i) => (n.children || []).forEach((c) => (parent[c] = i)));
const world = new Array(nodes.length);
function W(i) { if (world[i]) return world[i]; const l = trs(nodes[i]); world[i] = parent[i] >= 0 ? mul(W(parent[i]), l) : l; return world[i]; }
const byName = new Map();
nodes.forEach((n, i) => { if (n.name) byName.set(n.name, i); });
const pos = (name) => { const i = byName.get(name); return i === undefined ? null : xf(W(i), [0, 0, 0]); };

// ------------------------------------------------------------------------------------------ checks
const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail });
const f3 = (v) => (v ? v.map((x) => x.toFixed(3)).join(', ') : 'n/a');

// geometry stats
let tris = 0, minY = Infinity, maxY = -Infinity, minP = [Infinity, Infinity, Infinity], maxP = [-Infinity, -Infinity, -Infinity];
let weightIssues = { unweighted: 0, badSum: 0, socket: 0, far: 0, verts: 0, maxInf: 0, farJoints: {} };
const meshNodes = nodes.map((n, i) => [n, i]).filter(([n]) => n.mesh !== undefined);
for (const [n, ni] of meshNodes) {
  const mesh = json.meshes[n.mesh];
  const skin = n.skin !== undefined ? json.skins[n.skin] : null;
  let M = W(ni);
  let jointW = null, ibm = null;
  if (skin) {
    ibm = skin.inverseBindMatrices !== undefined ? accessor(skin.inverseBindMatrices).data : null;
    jointW = skin.joints.map((j) => W(j));
    // bind-pose world of a skinned vertex = jointWorld · IBM · p (identical for every joint at rest)
    const ib0 = ibm ? Array.from(ibm.slice(0, 16)) : I4();
    M = mul(jointW[0], ib0);
  }
  for (const prim of mesh.primitives) {
    const P = accessor(prim.attributes.POSITION);
    const mode = prim.mode === undefined ? 4 : prim.mode;
    const nIdx = prim.indices !== undefined ? json.accessors[prim.indices].count : P.count;
    if (mode === 4) tris += nIdx / 3;
    const pts = [];
    for (let k = 0; k < P.count; k++) {
      const p = xf(M, [P.data[k * 3], P.data[k * 3 + 1], P.data[k * 3 + 2]]);
      pts.push(p);
      for (let c = 0; c < 3; c++) { minP[c] = Math.min(minP[c], p[c]); maxP[c] = Math.max(maxP[c], p[c]); }
    }
    if (skin && prim.attributes.JOINTS_0 !== undefined) {
      const J = accessor(prim.attributes.JOINTS_0).data, Wt = accessor(prim.attributes.WEIGHTS_0).data;
      const jointPos = skin.joints.map((j) => xf(W(j), [0, 0, 0]));
      const jointName = skin.joints.map((j) => nodes[j].name || '');
      for (let k = 0; k < P.count; k++) {
        let s = 0, best = -1, bw = 0, ninf = 0;
        for (let c = 0; c < 4; c++) {
          const w = Wt[k * 4 + c]; s += w;
          if (w > 0) { ninf++; if (jointName[J[k * 4 + c]].startsWith('socket')) weightIssues.socket++; }
          if (w > bw) { bw = w; best = J[k * 4 + c]; }
        }
        weightIssues.verts++;
        weightIssues.maxInf = Math.max(weightIssues.maxInf, ninf);
        if (s < 1e-4) weightIssues.unweighted++;
        else if (Math.abs(s - 1) > 0.02) weightIssues.badSum++;
        if (best >= 0) {
          const jp = jointPos[best], p = pts[k];
          const d = Math.hypot(p[0] - jp[0], p[1] - jp[1], p[2] - jp[2]);
          if (d > 0.75) { weightIssues.far++; const jn = jointName[best]; weightIssues.farJoints[jn] = (weightIssues.farJoints[jn] || 0) + 1; }
        }
      }
    }
  }
}
minY = minP[1]; maxY = maxP[1];
const height = maxY - minY;
check('triangle budget', tris <= maxTris, `${tris} tris (max ${maxTris})`);

// textures
const texInfo = [];
for (const img of json.images || []) {
  let w = 0, h = 0, fmt = img.mimeType || '?';
  if (img.bufferView !== undefined) {
    const bv = json.bufferViews[img.bufferView];
    const b = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
    [w, h] = imageSize(b);
  }
  texInfo.push({ name: img.name || '', fmt, w, h });
}
function imageSize(b) {
  if (b[0] === 0x89 && b[1] === 0x50) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o < b.length) {
      if (b[o] !== 0xff) { o++; continue; }
      const m = b[o + 1], L = b.readUInt16BE(o + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [b.readUInt16BE(o + 7), b.readUInt16BE(o + 5)];
      o += 2 + L;
    }
  }
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const f = b.toString('ascii', 12, 16);
    if (f === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
    if (f === 'VP8L') { const v = b.readUInt32LE(21); return [1 + (v & 0x3fff), 1 + ((v >> 14) & 0x3fff)]; }
    if (f === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  }
  return [0, 0];
}
const pot = (x) => x > 0 && (x & (x - 1)) === 0;
check('textures embedded', texInfo.length > 0 || kind === 'prop', `${texInfo.length} images: ${texInfo.map((t) => `${t.fmt.replace('image/', '')} ${t.w}x${t.h}`).join(', ')}`);
check('texture sizes', texInfo.every((t) => t.w <= maxTex && t.h <= maxTex && pot(t.w) && pot(t.h)), `max ${maxTex}, power of two`);
check('no dots in node names', nodes.every((n) => !(n.name || '').includes('.')), nodes.filter((n) => (n.name || '').includes('.')).map((n) => n.name).join(' '));

if (kind === 'character') {
  const REQ = { root: null, hips: 'root', spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck' };
  for (const s of ['L', 'R']) {
    Object.assign(REQ, { [`clavicle_${s}`]: 'chest', [`upperarm_${s}`]: `clavicle_${s}`, [`forearm_${s}`]: `upperarm_${s}`,
      [`hand_${s}`]: `forearm_${s}`, [`socket_hand_${s}`]: `hand_${s}`, [`thigh_${s}`]: 'hips', [`shin_${s}`]: `thigh_${s}`,
      [`foot_${s}`]: `shin_${s}`, [`toe_${s}`]: `foot_${s}` });
  }
  const pname = (name) => { const i = byName.get(name); return i === undefined || parent[i] < 0 ? null : nodes[parent[i]].name; };
  const missing = Object.keys(REQ).filter((n) => !byName.has(n));
  check('contract bones present', missing.length === 0, missing.length ? 'missing: ' + missing.join(' ') : `${Object.keys(REQ).length} bones`);
  const wrong = Object.entries(REQ).filter(([n, p]) => byName.has(n) && p && pname(n) !== p).map(([n, p]) => `${n}<-${pname(n)} (want ${p})`);
  check('contract hierarchy', wrong.length === 0, wrong.join('; '));
  // optional chains
  const optBad = [];
  const chainOK = (re, first) => {
    for (const [name] of byName) {
      const m = name.match(re);
      if (!m) continue;
      const i = Number(m[m.length - 1]);
      const want = i === 1 ? first(m) : name.replace(/_(\d+)$/, `_${i - 1}`);
      const got = pname(name);
      if (Array.isArray(want) ? !want.includes(got) : got !== want) optBad.push(`${name}<-${got}`);
    }
  };
  chainOK(/^hair_(\d+)$/, () => 'head');
  chainOK(/^beard_(\d+)$/, () => ['jaw', 'head']);
  chainOK(/^cape_(\d+)$/, () => 'chest');
  chainOK(/^kilt_([FBLR])_(\d+)$/, () => 'hips');
  if (byName.has('socket_back') && pname('socket_back') !== 'chest') optBad.push('socket_back<-' + pname('socket_back'));
  if (byName.has('jaw') && pname('jaw') !== 'head') optBad.push('jaw<-' + pname('jaw'));
  const extras = [...byName.keys()].filter((n) => /^(hair|beard|cape|tail)_\d+$|^kilt_[FBLR]_\d+$|^socket_back$|^jaw$/.test(n));
  check('optional chains', optBad.length === 0, optBad.length ? optBad.join('; ') : extras.join(' '));
  const root = pos('root'), hips = pos('hips');
  check('root at origin', root && Math.hypot(...root) < 0.01, f3(root));
  check('hips at pelvis height', hips && hips[1] > 0.4 * height && hips[1] < 0.62 * height, `hips y=${hips && hips[1].toFixed(3)} (${hips && (hips[1] / height).toFixed(2)} of height)`);
  const fL = pos('foot_L'), tL = pos('toe_L'), fR = pos('foot_R'), tR = pos('toe_R');
  check('faces +Z (toes forward)', fL && tL && fR && tR && tL[2] > fL[2] + 0.03 && tR[2] > fR[2] + 0.03, `foot_L ${f3(fL)} toe_L ${f3(tL)}`);
  const uL = pos('upperarm_L'), uR = pos('upperarm_R'), thL = pos('thigh_L');
  check('left side on +X', uL && uR && thL && uL[0] > 0.05 && uR[0] < -0.05 && thL[0] > 0, `upperarm_L x=${uL && uL[0].toFixed(3)} upperarm_R x=${uR && uR[0].toFixed(3)}`);
  const eL = pos('forearm_L');
  if (uL && eL) {
    const d = [eL[0] - uL[0], eL[1] - uL[1], eL[2] - uL[2]];
    const ang = (Math.atan2(-d[1], Math.hypot(d[0], d[2])) * 180) / Math.PI;
    check('A-pose (upper arm below horizontal)', ang > 25 && ang < 55, `${ang.toFixed(1)} deg`);
  }
  check('feet on ground (min Y ~ 0)', Math.abs(minY) < 0.015, `min Y ${minY.toFixed(4)}`);
  if (expH !== null) check('height', Math.abs(height - expH) <= hTol, `${height.toFixed(3)} m (want ${expH} ± ${hTol})`);
  else check('height plausible', height > 0.5 && height < 6, `${height.toFixed(3)} m`);
  const sk = json.skins || [];
  check('skinned', sk.length > 0, `${sk.length} skin(s), ${sk[0] ? sk[0].joints.length : 0} joints`);
  if (sk.length) {
    const wi = weightIssues;
    check('weights: every vertex weighted', wi.unweighted === 0, `${wi.unweighted}/${wi.verts} unweighted`);
    check('weights: normalised', wi.badSum === 0, `${wi.badSum} bad sums`);
    check('weights: <= 4 influences', wi.maxInf <= 4, `max ${wi.maxInf}`);
    check('weights: sockets carry none', wi.socket === 0, `${wi.socket} socket influences`);
    check('weights: no far-away joints', wi.far === 0, `${wi.far} verts > 0.75 m from their main joint ${JSON.stringify(wi.farJoints)}`);
  }
  check('bounds centred on X', Math.abs((minP[0] + maxP[0]) / 2) < 0.08, `x ${minP[0].toFixed(3)}..${maxP[0].toFixed(3)}`);
} else if (kind === 'weapon') {
  const lenY = maxP[1] - minP[1];
  check('grip at origin (origin inside bounds)', minP[1] < 0 && maxP[1] > 0 && minP[0] < 0.02 && maxP[0] > -0.02 && minP[2] < 0.02 && maxP[2] > -0.02,
    `bounds ${f3(minP)} .. ${f3(maxP)}`);
  check('blade along +Y', maxP[1] > 2.5 * Math.abs(minP[1]) && lenY > Math.max(maxP[0] - minP[0], maxP[2] - minP[2]),
    `+Y reach ${maxP[1].toFixed(3)} m, -Y (pommel) ${minP[1].toFixed(3)} m, length ${lenY.toFixed(3)} m`);
}

const summary = { file, kind, ok: checks.every((c) => c.ok), tris, height: +height.toFixed(3), minY: +minY.toFixed(4),
  bounds: { min: minP.map((v) => +v.toFixed(3)), max: maxP.map((v) => +v.toFixed(3)) }, textures: texInfo,
  nodes: nodes.length, meshes: (json.meshes || []).length, materials: (json.materials || []).length,
  extensions: json.extensionsUsed || [], sizeMB: +(buf.length / 1e6).toFixed(2), checks };
if (opt.json) console.log(JSON.stringify(summary, null, 2));
else {
  console.log(`${file}  [${kind}]  ${summary.sizeMB} MB  ${tris} tris  height ${height.toFixed(3)} m`);
  for (const c of checks) console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '  — ' + c.detail : ''}`);
  console.log(summary.ok ? 'OK' : 'FAILED');
}
process.exit(summary.ok ? 0 : 1);
