#!/usr/bin/env node
// Updates the live progress page (progress/index.html reads progress/manifest.json + progress/items/<id>.json).
// Each item has its own JSON file so concurrent agents never clobber each other.
//
//   node tools/progress.mjs --item hero-brann --title "Hero: Brann" --wave B --status building --iter 2 \
//        --note "sculpting fur kilt" --shot progress/shots/hero-brann/r2/shot.png --clip progress/shots/hero-brann/r2/clip.mp4
//   node tools/progress.mjs --item hero-brann --status critic --iter 2 --score 6.5 --verdict FAIL --gap "hands are mittens"
//   node tools/progress.mjs --log "Wave B started"          (global log line)
//
// Status values: queued | building | critic | passed | failed | blocked
// Paths for --shot/--clip must be relative to the project root (they are served by vite at /<path>).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath decodes %20 (the project path contains a space; URL.pathname would write to "JavaScript%20Games").
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'progress');
const itemsDir = path.join(dir, 'items');
fs.mkdirSync(itemsDir, { recursive: true });
const argv = process.argv.slice(2);
const opt = {}; const multi = { shot: [], clip: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]; if (!a.startsWith('--')) continue;
  const k = a.slice(2); const v = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
  if (k in multi) multi[k].push(String(v).replace(/\\/g, '/')); else opt[k] = v;
}
const now = new Date().toISOString();
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const writeJSON = (p, v) => { const tmp = p + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(v, null, 2)); fs.renameSync(tmp, p); };

if (opt.log) {
  const logP = path.join(dir, 'log.json');
  for (let attempt = 0; attempt < 5; attempt++) {
    try { const log = readJSON(logP, []); log.unshift({ t: now, msg: String(opt.log) }); writeJSON(logP, log.slice(0, 200)); break; }
    catch { await new Promise((r) => setTimeout(r, 50 + Math.random() * 200)); }
  }
}
if (opt.item) {
  const id = String(opt.item).replace(/[^a-z0-9_-]/gi, '-');
  const p = path.join(itemsDir, id + '.json');
  const it = readJSON(p, { id, title: id, wave: '', status: 'queued', iter: 0, score: null, verdict: null, gap: '', note: '', shots: [], clips: [], history: [], created: now });
  for (const k of ['title', 'wave', 'status', 'note', 'gap', 'verdict', 'owner']) if (opt[k] !== undefined) it[k] = String(opt[k]);
  if (opt.iter !== undefined) it.iter = Number(opt.iter);
  if (opt.score !== undefined) it.score = Number(opt.score);
  if (multi.shot.length) it.shots = [...multi.shot, ...it.shots.filter((s) => !multi.shot.includes(s))].slice(0, 40);
  if (multi.clip.length) it.clips = [...multi.clip, ...it.clips.filter((s) => !multi.clip.includes(s))].slice(0, 12);
  if (opt.score !== undefined || opt.verdict !== undefined) {
    it.history.push({ t: now, iter: it.iter, score: it.score, verdict: it.verdict, gap: it.gap, shot: multi.shot[0] || it.shots[0] || null });
  }
  it.updated = now;
  writeJSON(p, it);
  const manP = path.join(dir, 'manifest.json');
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const man = readJSON(manP, { items: [] });
      if (!man.items.includes(id)) { man.items.push(id); writeJSON(manP, man); }
      break;
    } catch { await new Promise((r) => setTimeout(r, 50 + Math.random() * 200)); }
  }
  console.log('progress updated:', id, it.status, it.iter, it.score ?? '');
}
