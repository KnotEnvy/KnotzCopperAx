// Clip contract: old (r18 copy) vs current src/anim/clips/hero_brann.js as parsed definitions.
// node progress/tmp/brann_team/anim/clip_contract.mjs [old] [new]  → prints JSON {total, changed, same, missing, added}
import path from 'node:path'; import fs from 'node:fs'; import { pathToFileURL } from 'node:url';
const root = process.cwd();
const oldF = process.argv[2] || 'progress/tmp/brann_team/anim/hero_brann.r18.js';
const newF = process.argv[3] || 'src/anim/clips/hero_brann.js';
// the r18 copy imports ./_kit.js etc. relative to src/anim/clips: load it from there under a temp name
const tmp = path.join(root, 'src/anim/clips/_contract_old_tmp.js');
fs.copyFileSync(oldF, tmp);
try {
  const A = (await import(pathToFileURL(tmp).href)).default.clips;
  const B = (await import(pathToFileURL(path.resolve(newF)).href + '?n')).default.clips;
  const ser = (o) => JSON.stringify(o, (k, v) => (typeof v === 'function' ? 'fn:' + v.toString() : typeof v === 'number' ? +v.toFixed(6) : v));
  const changed = [], same = [];
  for (const k of Object.keys(A)) if (k in B) (ser(A[k]) === ser(B[k]) ? same : changed).push(k);
  console.log(JSON.stringify({ total_old: Object.keys(A).length, total_new: Object.keys(B).length, changed, same: same.length,
    missing: Object.keys(A).filter((k) => !(k in B)), added: Object.keys(B).filter((k) => !(k in A)) }));
} finally { fs.rmSync(tmp, { force: true }); }
