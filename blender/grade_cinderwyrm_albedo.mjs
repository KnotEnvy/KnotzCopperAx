#!/usr/bin/env node
// Post-bake albedo grade for the Cinderwyrm (C2 r12, Enemy Art C) — run after blender/build_mount_cinderwyrm.py.
// Stage 3's bright sunset key lifted the baked hide (hue spread 0..15 deg after the noise mottling) to coral; ref = deep
// crimson. Only saturated (s > 0.45) hues -20..16 deg change: hue pulled toward ~2 deg (x HMUL + HADD), value ^VPOW x VMUL,
// saturation x SMUL. Amber belly / ember lines (hue >= 18), bone, leather, bronze untouched (smooth hue/sat feathering).
// Rewrites public/assets/textures/mount_cinderwyrm_albedo.png AND the embedded albedo image of
// public/assets/models/mount_cinderwyrm.glb (buffer views re-packed, 4-byte aligned). Idempotence guard: the GLB's
// asset.extras.kcaGrade marks a graded file (run again = no-op unless --force).
//   node blender/grade_cinderwyrm_albedo.mjs [--force]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GLB = process.env.CW_GLB || path.join(ROOT, 'public/assets/models/mount_cinderwyrm.glb');
const PNG = process.env.CW_PNG || path.join(ROOT, 'public/assets/textures/mount_cinderwyrm_albedo.png');
const VMUL = 0.82, VPOW = 1.1, SMUL = 1.05, HMUL = 0.35, HADD = 1.5, TAG = 'hide-grade-2';

function grade(px, ch) {
  let n = 0;
  for (let i = 0; i < px.length; i += ch) {
    const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (mx < 0.02 || d < 1e-5 || mx !== r) continue;
    let h = 60 * (((g - b) / d) % 6); if (h < 0) h += 360;
    const s = d / mx;
    // weight: full for hue -20..12 deg (hide reds/oranges), feathered to 0 at 16; amber belly / ember lines (>= 18) keep.
    const hd = h > 180 ? h - 360 : h;                      // -180..180, reds near 0
    const wh = hd < -25 || hd > 16 ? 0 : hd < -20 ? (hd + 25) / 5 : hd > 12 ? (16 - hd) / 4 : 1;
    const ws = Math.min(1, Math.max(0, (s - 0.45) / 0.15));
    const w = wh * ws; if (w <= 0) continue;
    const v2 = Math.pow(mx, VPOW) * VMUL, s2 = Math.min(1, s * SMUL);
    const hn = hd * HMUL + HADD;                           // pull orange-reds toward crimson
    const hh = ((hn % 360) + 360) % 360 / 60, c = v2 * s2, x = c * (1 - Math.abs((hh % 2) - 1)), m = v2 - c;
    let rr, gg, bb;
    if (hh < 1) [rr, gg, bb] = [c, x, 0]; else if (hh < 2) [rr, gg, bb] = [x, c, 0]; else if (hh < 3) [rr, gg, bb] = [0, c, x];
    else if (hh < 4) [rr, gg, bb] = [0, x, c]; else if (hh < 5) [rr, gg, bb] = [x, 0, c]; else [rr, gg, bb] = [c, 0, x];
    px[i] = Math.round(255 * (r + ((rr + m) - r) * w));
    px[i + 1] = Math.round(255 * (g + ((gg + m) - g) * w));
    px[i + 2] = Math.round(255 * (b + ((bb + m) - b) * w));
    n++;
  }
  return n;
}

const buf = fs.readFileSync(GLB);
const jlen = buf.readUInt32LE(12);
const json = JSON.parse(buf.subarray(20, 20 + jlen).toString('utf8'));
const binOff = 20 + jlen + 8, binLen = buf.readUInt32LE(20 + jlen);
const bin = buf.subarray(binOff, binOff + binLen);
json.asset.extras = json.asset.extras || {};
if (json.asset.extras.kcaGrade === TAG && !process.argv.includes('--force')) { console.log('already graded', TAG); process.exit(0); }
const imgIdx = json.images.findIndex((im) => /albedo/.test(im.name || ''));
if (imgIdx < 0) throw new Error('no albedo image in GLB');
const im = json.images[imgIdx], bv = json.bufferViews[im.bufferView];
const src = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
const { data, info } = await sharp(src).raw().toBuffer({ resolveWithObject: true });
const changed = grade(data, info.channels);
const fmt = (im.mimeType || '').includes('webp') ? 'webp' : 'png';
const enc = fmt === 'webp'
  ? await sharp(data, { raw: info }).webp({ quality: 90 }).toBuffer()
  : await sharp(data, { raw: info }).png().toBuffer();
// PNG copy in textures/ (same graded pixels)
await sharp(data, { raw: info }).png().toFile(PNG);
// repack buffer views with the new image
const parts = []; let off = 0;
json.bufferViews.forEach((v, i) => {
  const d = i === im.bufferView ? enc : bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
  const pad = (4 - (off % 4)) % 4; if (pad) { parts.push(Buffer.alloc(pad)); off += pad; }
  v.byteOffset = off; v.byteLength = d.length; parts.push(d); off += d.length;
});
const pad = (4 - (off % 4)) % 4; if (pad) { parts.push(Buffer.alloc(pad)); off += pad; }
json.buffers[0].byteLength = off;
json.asset.extras.kcaGrade = TAG;
let jbuf = Buffer.from(JSON.stringify(json), 'utf8');
const jpad = (4 - (jbuf.length % 4)) % 4; jbuf = Buffer.concat([jbuf, Buffer.alloc(jpad, 0x20)]);
const newBin = Buffer.concat(parts);
const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + jbuf.length + 8 + newBin.length, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(jbuf.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(newBin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
fs.writeFileSync(GLB, Buffer.concat([head, jh, jbuf, bh, newBin]));
console.log(`graded ${changed} px (${(100 * changed / (info.width * info.height)).toFixed(1)} %) ${info.width}x${info.height} ${fmt}; GLB ${(fs.statSync(GLB).size / 1e6).toFixed(2)} MB`);
