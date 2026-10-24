#!/usr/bin/env node
// Prune capture bloat while keeping everything the live progress page needs.
//
//   node tools/prune-progress.mjs            → DRY RUN: prints what would be deleted and how much space it frees
//   node tools/prune-progress.mjs --apply    → actually delete
//   options: --keep-days N   also keep unreferenced files modified in the last N days (default 1, so the current wave's evidence survives)
//            --no-bench      don't clear public/_bench (perf A/B builds)
//
// KEEPS: progress/index.html, manifest.json, log.json, items/*.json, every file referenced by an item
//        (shots, clips, history shots), progress/qa/**/*.mjs|.js|.cjs scripts, progress/locks/.
// DELETES: progress/tmp/**, unreferenced files under progress/shots/**, progress/compare/**, progress/qa/** outputs,
//          public/_bench/** (perf builds, rebuilt on demand), root scratchpad/**, blender/out/*.log older than keep-days,
//          and truncates progress/devserver.log.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const keepDays = Number(args[args.indexOf('--keep-days') + 1]) || (args.includes('--keep-days') ? 0 : 1);
const clearBench = !args.includes('--no-bench');
const cutoff = Date.now() - keepDays * 86400e3;
const rel = (p) => path.relative(root, p).replace(/\\/g, '/');

// 1. Everything referenced by progress items.
const keep = new Set();
const itemsDir = path.join(root, 'progress', 'items');
for (const f of fs.existsSync(itemsDir) ? fs.readdirSync(itemsDir) : []) {
  if (!f.endsWith('.json')) continue;
  try {
    const it = JSON.parse(fs.readFileSync(path.join(itemsDir, f), 'utf8'));
    for (const p of [...(it.shots || []), ...(it.clips || []), ...(it.history || []).map((h) => h.shot)]) if (p) keep.add(String(p).replace(/\\/g, '/').replace(/^\/+/, ''));
  } catch {}
}
for (const p of ['progress/index.html', 'progress/manifest.json', 'progress/log.json']) keep.add(p);

let bytes = 0, files = 0; const byArea = {};
function consider(abs, area, { respectAge = true } = {}) {
  const r = rel(abs);
  if (keep.has(r)) return;
  let st; try { st = fs.statSync(abs); } catch { return; }
  if (respectAge && st.mtimeMs > cutoff) return;
  bytes += st.size; files++; byArea[area] = (byArea[area] || 0) + st.size;
  if (APPLY) { try { fs.rmSync(abs, { force: true }); } catch {} }
}
function walk(dir, fn) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, fn); else fn(p); }
}
function pruneEmptyDirs(dir) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) if (e.isDirectory()) pruneEmptyDirs(path.join(dir, e.name));
  try { if (APPLY && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir); } catch {}
}

const P = (...s) => path.join(root, ...s);
walk(P('progress', 'tmp'), (f) => consider(f, 'progress/tmp'));
walk(P('progress', 'shots'), (f) => consider(f, 'progress/shots (unreferenced)'));
walk(P('progress', 'compare'), (f) => consider(f, 'progress/compare'));
walk(P('progress', 'audio'), (f) => consider(f, 'progress/audio renders'));
walk(P('progress', 'qa'), (f) => { if (!/\.(mjs|cjs|js)$/.test(f)) consider(f, 'progress/qa outputs'); });
if (clearBench) walk(P('public', '_bench'), (f) => consider(f, 'public/_bench', { respectAge: false }));
walk(P('scratchpad'), (f) => consider(f, 'scratchpad'));
walk(P('blender', 'out'), (f) => { if (f.endsWith('.log')) consider(f, 'blender/out logs'); });
const devlog = P('progress', 'devserver.log');
try { const st = fs.statSync(devlog); if (st.size > 1e6) { bytes += st.size; byArea['devserver.log (truncate)'] = st.size; if (APPLY) fs.writeFileSync(devlog, ''); } } catch {}

for (const d of ['tmp', 'shots', 'compare', 'qa', 'audio']) pruneEmptyDirs(P('progress', d));
if (clearBench) pruneEmptyDirs(P('public', '_bench'));
pruneEmptyDirs(P('scratchpad'));

const mb = (b) => (b / 1048576).toFixed(1) + ' MB';
console.log(`${APPLY ? 'DELETED' : 'Would delete'} ${files} files, ${mb(bytes)} (keeping ${keep.size} referenced progress files; unreferenced files newer than ${keepDays} day(s) kept)`);
for (const [a, b] of Object.entries(byArea).sort((x, y) => y[1] - x[1])) console.log(`  ${a.padEnd(32)} ${mb(b)}`);
if (!APPLY) console.log('Re-run with --apply to delete.');
