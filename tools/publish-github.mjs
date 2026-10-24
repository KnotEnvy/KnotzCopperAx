#!/usr/bin/env node
// Publish the GAME to GitHub's `main` branch: game code, shipped assets, supporting tools, the Blender pipeline
// scripts, build config and the core design/tech docs. Process material stays local only: captures, board evidence,
// reference screenshots and concept sheets, notes, progress page, build logs/reports (owner rule, 2026-10-24).
//
// Local `master` keeps everything. This script builds `main` from a COMMITTED ref (default master) with a temporary
// git index, so it never touches the working tree or the real index — safe while builders are editing files.
//
//   node tools/publish-github.mjs                 → dry run: what would be published (counts, sizes, chunks)
//   node tools/publish-github.mjs --commit        → add one commit on local `main` (skipped if nothing changed)
//   node tools/publish-github.mjs --commit --push → … and push it (origin main)
//   options: --from <ref> (default master) · --chunks (first publish: one commit + push per chunk so every push stays
//            small) · --remote <name> (default origin) · --message "<subject>"
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (k) => argv.includes(k);
const val = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const FROM = val('--from', 'master');
const REMOTE = val('--remote', 'origin');
const BRANCH = 'main';
const TRAILER = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>';

const git = (args, opts = {}) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 1 << 30, ...opts });
const tryGit = (args) => { try { return git(args, { stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };

// What ships. Everything else in master (progress/, refs/, docs/notes, docs/refs, logs, reports, scratch) stays local.
const INCLUDE = [
  /^src\//,
  /^public\/assets\//,
  /^tools\//,
  /^blender\/[^/]+\.(py|mjs)$/,
  /^blender\/lib\//,
  /^(index\.html|package\.json|package-lock\.json|\.gitignore)$/,
  /^vite[^/]*\.config\.(js|mjs)$/,
  /^docs\/(DESIGN|ARCHITECTURE|ENGINE_API|ART_PIPELINE|PERF|ASSET_SOURCES|GOLDEN_AXE_NOTES)\.md$/,
];
const EXCLUDE = [/\/__pycache__\//, /\.(pyc|log|mp4|webm|mov|gif|blend|blend1)$/i, /^public\/_bench\//];
const ships = (p) => INCLUDE.some((r) => r.test(p)) && !EXCLUDE.some((r) => r.test(p));

// First-publish chunks (cumulative; the last one takes everything left so nothing can be missed).
const asset = (p, prefixes) => /^public\/assets\/(models|textures)\//.test(p) && prefixes.some((x) => path.basename(p).startsWith(x));
const CHUNKS = [
  { name: 'code, tools, pipeline scripts, build config, docs, fonts/UI/VFX', test: (p) => !/^public\/assets\/(models|textures)\//.test(p) },
  { name: 'hero, weapon and UI models + textures', test: (p) => asset(p, ['hero_', 'weapon_', 'ui_', 'brann_', 'gorrim_', 'seraphine_']) },
  { name: 'enemy models + textures', test: (p) => asset(p, ['enemy_']) },
  { name: 'boss and mount models + textures', test: (p) => asset(p, ['boss_', 'mount_']) },
  { name: 'stage, magic and effect models + textures (and anything left)', test: () => true },
];

// ---- read the source tree --------------------------------------------------------------------------------------
const fromSha = git(['rev-parse', '--verify', `${FROM}^{commit}`]).trim();
const fromSubject = git(['log', '-1', '--format=%s', fromSha]).trim();
const entries = git(['ls-tree', '-r', '-z', '-l', fromSha]).split('\0').filter(Boolean).map((line) => {
  const tab = line.indexOf('\t');
  const [mode, type, sha, size] = line.slice(0, tab).split(/\s+/);
  return { mode, type, sha, size: Number(size) || 0, path: line.slice(tab + 1) };
});
const shipped = entries.filter((e) => e.type === 'blob' && ships(e.path));
const left = entries.filter((e) => !(e.type === 'blob' && ships(e.path)));
const mb = (n) => (n / 1e6).toFixed(1) + ' MB';
const sum = (list) => list.reduce((s, e) => s + e.size, 0);

const byTop = {};
for (const e of left) { const k = e.path.split('/').slice(0, e.path.startsWith('docs/') ? 2 : 1).join('/'); byTop[k] = (byTop[k] || 0) + e.size; }
console.log(`source ${FROM} ${fromSha.slice(0, 8)} "${fromSubject}"`);
console.log(`publish: ${shipped.length} files, ${mb(sum(shipped))}   ·   stays local: ${left.length} files, ${mb(sum(left))}`);
console.log('  stays local by folder: ' + Object.entries(byTop).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${mb(v)}`).join(', '));

// ---- build trees with a private index --------------------------------------------------------------------------
const tmpIndex = path.join(os.tmpdir(), `kca-publish-${process.pid}.index`);
function treeOf(list) {
  try { fs.rmSync(tmpIndex, { force: true }); } catch {}
  const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
  git(['read-tree', '--empty'], { env });
  const info = list.map((e) => `${e.mode} ${e.sha}\t${e.path}`).join('\0') + '\0';
  git(['update-index', '-z', '--index-info'], { env, input: info });
  const tree = git(['write-tree'], { env }).trim();
  fs.rmSync(tmpIndex, { force: true });
  return tree;
}

let parent = tryGit(['rev-parse', '--verify', `refs/heads/${BRANCH}^{commit}`]);
const plans = [];
if (has('--chunks')) {
  if (parent) { console.error(`--chunks is for the first publish only; refs/heads/${BRANCH} already exists`); process.exit(2); }
  const taken = new Set();
  for (const [i, c] of CHUNKS.entries()) {
    const add = shipped.filter((e) => !taken.has(e.path) && c.test(e.path));
    add.forEach((e) => taken.add(e.path));
    plans.push({ subject: `Publish ${i + 1}/${CHUNKS.length}: ${c.name}`, files: shipped.filter((e) => taken.has(e.path)), added: add });
  }
} else {
  plans.push({ subject: val('--message', `Publish ${fromSha.slice(0, 8)}: ${fromSubject}`), files: shipped, added: shipped });
}
for (const p of plans) console.log(`  ${p.subject} — +${p.added.length} files, +${mb(sum(p.added))} (total ${p.files.length})`);
if (!has('--commit')) { console.log('dry run (add --commit [--push])'); process.exit(0); }

// ---- commit (and push) -----------------------------------------------------------------------------------------
for (const p of plans) {
  const tree = treeOf(p.files);
  if (parent && git(['rev-parse', `${parent}^{tree}`]).trim() === tree) { console.log(`unchanged — nothing to publish (${p.subject})`); continue; }
  const body = `${p.subject}\n\nBuilt from ${FROM} ${fromSha.slice(0, 12)} ("${fromSubject}") by tools/publish-github.mjs:\ngame code, shipped assets, tools, pipeline scripts, build config and core docs only.\n\n${TRAILER}\n`;
  const msgFile = path.join(os.tmpdir(), `kca-publish-${process.pid}.msg`);
  fs.writeFileSync(msgFile, body);
  const commit = git(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-F', msgFile]).trim();
  fs.rmSync(msgFile, { force: true });
  git(['update-ref', `refs/heads/${BRANCH}`, commit, ...(parent ? [parent] : [])]);
  console.log(`committed ${commit.slice(0, 8)} on ${BRANCH}: ${p.subject}`);
  parent = commit;
  if (has('--push')) {
    execFileSync('git', ['-C', root, 'push', REMOTE, `${commit}:refs/heads/${BRANCH}`], { stdio: 'inherit' });
    console.log(`pushed ${commit.slice(0, 8)} → ${REMOTE}/${BRANCH}`);
  }
}
