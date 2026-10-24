#!/usr/bin/env node
// clipcheck — automatic glitch screen for a capture clip (replaces a "clip screener" model: no model here can watch video).
//
//   node tools/clipcheck.mjs <clip.mp4 | capture dir> [--json] [--freeze 0.25] [--spike 3] [--flash 25]
//
// Measures every frame with ffmpeg (luma mean, contrast range, and the mean absolute difference to the previous
// frame, on a 320-px grey copy) and flags:
//   freeze  — a frame (or run of frames) identical to the previous one (diff < --freeze) while the clip around it moves:
//             frozen animation, a stalled render, or capture/encode duplicates
//   spike   — a frame that changes > --spike × the clip's median change (and > 6): pops, teleports, camera cuts, or
//             legitimately big hits — look at the timestamp before calling it a bug
//   flash   — the whole frame's brightness jumps by > --flash (0–255) vs the previous frame: white-outs, magic flashes,
//             blown-out bloom, black frames
//   blank   — an almost uniform frame (luma range < 12): black/white screens, a missing render
// Exit code 0 always (it reports, it doesn't judge). Output: a short report, or JSON with --json. Writes
// clipcheck.json next to the clip.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const opt = {};
const pos = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) { const k = argv[i].slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; opt[k] = v; }
  else pos.push(argv[i]);
}
let clip = pos[0];
if (!clip) { console.error('usage: node tools/clipcheck.mjs <clip.mp4 | capture dir> [--json]'); process.exit(2); }
if (fs.existsSync(clip) && fs.statSync(clip).isDirectory()) clip = path.join(clip, 'clip.mp4');
if (!fs.existsSync(clip)) { console.error(`no clip at ${clip}`); process.exit(2); }
const FREEZE = Number(opt.freeze ?? 0.25), SPIKE = Number(opt.spike ?? 3), FLASH = Number(opt.flash ?? 25);

// One ffmpeg pass: per-frame stats of the frame itself (YAVG, YMIN, YMAX) and of its difference to the previous frame.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcheck-'));
const fA = path.join(tmp, 'frame.txt'), fB = path.join(tmp, 'diff.txt');
const graph = `[0:v]scale=320:-2,format=gray,split[a][b];` +
  `[a]signalstats,metadata=mode=print:file=${fA}[ao];` +
  `[b]tblend=all_mode=difference,signalstats,metadata=mode=print:file=${fB}[bo]`;
const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', clip, '-filter_complex', graph, '-map', '[ao]', '-f', 'null', '-', '-map', '[bo]', '-f', 'null', '-'], { encoding: 'utf8' });
if (r.status !== 0) { console.error('ffmpeg failed: ' + (r.stderr || '').slice(0, 400)); process.exit(1); }

// metadata=print writes "frame:N pts:… pts_time:T" followed by "lavfi.signalstats.KEY=value" lines.
function parse(file) {
  const out = [];
  let cur = null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^frame:(\d+)\s+pts:\S+\s+pts_time:(\S+)/.exec(line);
    if (m) { cur = { i: Number(m[1]), t: Number(m[2]) }; out.push(cur); continue; }
    const k = /^lavfi\.signalstats\.(\w+)=(\S+)/.exec(line);
    if (k && cur) cur[k[1]] = Number(k[2]);
  }
  return out;
}
const frames = parse(fA);
const diffs = parse(fB); // tblend output frame k = |frame k+1 − frame k|
fs.rmSync(tmp, { recursive: true, force: true });

const n = frames.length;
const change = new Array(n).fill(null); // change[i] = mean |frame i − frame i−1|
for (let k = 0; k < diffs.length && k + 1 < n; k++) change[k + 1] = diffs[k].YAVG;
const sorted = change.filter((v) => v != null).sort((a, b) => a - b);
const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
const r2 = (v) => Math.round(v * 100) / 100;

const issues = [];
// freezes: consecutive near-zero-change frames while the clip overall moves (median > 1)
for (let i = 1; i < n; i++) {
  if (change[i] == null || change[i] >= FREEZE || median <= 1) continue;
  let j = i;
  while (j + 1 < n && change[j + 1] != null && change[j + 1] < FREEZE) j++;
  issues.push({ type: 'freeze', at: r2(frames[i].t), frames: [i, j], detail: `${j - i + 1} frame(s) identical to the previous one (clip median change ${r2(median)})` });
  i = j;
}
for (let i = 1; i < n; i++) {
  if (change[i] != null && median > 0 && change[i] > SPIKE * median && change[i] > 6) {
    issues.push({ type: 'spike', at: r2(frames[i].t), frames: [i, i], detail: `change ${r2(change[i])} = ${r2(change[i] / median)}× the median (pop, cut, teleport, or a big hit)` });
  }
  const dL = frames[i].YAVG - frames[i - 1].YAVG;
  if (Math.abs(dL) > FLASH) issues.push({ type: 'flash', at: r2(frames[i].t), frames: [i, i], detail: `whole-frame brightness ${dL > 0 ? '+' : ''}${r2(dL)} (${r2(frames[i - 1].YAVG)} → ${r2(frames[i].YAVG)})` });
}
for (const f of frames) {
  if (f.YMAX - f.YMIN < 12) issues.push({ type: 'blank', at: r2(f.t), frames: [f.i, f.i], detail: `almost uniform frame (luma ${f.YMIN}–${f.YMAX})` });
}
issues.sort((a, b) => a.at - b.at);

const report = { clip, frames: n, duration: n ? r2(frames[n - 1].t) : 0, medianChange: r2(median), counts: {}, issues };
for (const t of ['freeze', 'spike', 'flash', 'blank']) report.counts[t] = issues.filter((x) => x.type === t).length;
fs.writeFileSync(path.join(path.dirname(clip), 'clipcheck.json'), JSON.stringify(report, null, 1));

if (opt.json) { console.log(JSON.stringify(report, null, 1)); process.exit(0); }
console.log(`clipcheck ${clip}: ${n} frames, ${report.duration}s, median change ${report.medianChange}`);
console.log(`  freeze ${report.counts.freeze} · spike ${report.counts.spike} · flash ${report.counts.flash} · blank ${report.counts.blank}`);
for (const x of issues.slice(0, 40)) console.log(`  ${String(x.at).padStart(6)}s  ${x.type.padEnd(6)} frames ${x.frames[0]}${x.frames[1] !== x.frames[0] ? '–' + x.frames[1] : ''}: ${x.detail}`);
if (issues.length > 40) console.log(`  … ${issues.length - 40} more in clipcheck.json`);
