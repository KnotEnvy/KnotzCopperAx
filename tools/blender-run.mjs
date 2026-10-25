#!/usr/bin/env node
// The ONLY sanctioned way to run Blender for KnotzCopperAx. It caps how many Blender processes run machine-wide
// (KCA_BLENDER_SLOTS, default 3 = the owner's hard cap) and a new build also waits until enough memory is usable: at least
// KCA_BLENDER_MIN_FREE_MB (default 14000), more for a job known to be big — see tools/lib/memgate.mjs (free memory minus
// what the running jobs are still expected to grow by). Callers queue on progress/locks/blender-<i>.lock, first come
// first served.
//
//   node tools/blender-run.mjs [--log <file>] [--what "<short label>"] [--owner <agent/item id>] [--mem-mb <peak MB>] -- <blender args…>
//   e.g. node tools/blender-run.mjs --log blender/out/gorrim_rel.log --what "gorrim release" --owner hero-gorrim -- -b --factory-startup -P blender/build_hero_gorrim.py -- --release
//   node tools/blender-run.mjs --status        (who holds the slots: runtime, Blender RSS, minutes since its last output; the queue; memory)
//
// Blender: $BLENDER_EXE, else Linux Blender 5.2.1 in ~/.local/opt (WSL2 / Linux) or the standard Windows install.
// On WSL2 the wrapper adds WSL's NVIDIA libs and sets KCA_CYCLES_DEVICE=CUDA (blender/lib/pipeline.py reads it):
// OptiX lists the GPU there but can't create a context, while CUDA bakes work.
// The wrapper also waits while the machine already runs as many Blenders as there are slots (counting ones started by
// hand or by a crashed wrapper). Its exit code is Blender's exit code. To run it in the background, launch THIS wrapper
// in the background. Never call blender directly. Stopping the wrapper (Ctrl-C / kill <wrapper pid>) stops its Blender too.
//
// Memory: each job reserves (expected peak − current RSS) so later jobs don't start into memory it is about to use. The
// expected peak is --mem-mb if given, else what the same script (+ args / mode) peaked at in its previous runs (every
// wrapper records its Blender's peak RSS on exit), else a guess from the label: "release" 16000, "fast"/"preview" 6000,
// otherwise 10000 MB.
//
// Watchdog (with --log): every 60 s one "[kca-watchdog]" line goes into the log (Blender RSS + swap, CPU %, MemAvailable,
// swap used, memory pressure, VRAM, minutes since Blender last printed). If Blender prints nothing for 45 min
// (KCA_BLENDER_STALL_MIN) a loud "[kca-watchdog] STALL" line is written (log + stderr, again every 15 min). The job is
// NOT killed — its owner decides.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquire, LOCK_DIR } from './lib/locks.mjs';
import { IS_WSL, blenderExe, runningBlenders, withLibPath, memState, procMem, procCpuSec, gpuMem } from './lib/platform.mjs';
import { memGate, blenderJobKey, expectedBlenderPeak, recordPeak } from './lib/memgate.mjs';
import { blenderJobs, queue, STALL_MIN } from './lib/jobs.mjs';

// A wrapper whose launching session died must not crash on a write to a closed pipe (its Blender would follow).
process.stdout.on('error', () => {}); process.stderr.on('error', () => {});

const SLOTS = Math.min(3, Number(process.env.KCA_BLENDER_SLOTS || 3)); // owner rule: never more than 3 Blenders
const WATCH_MS = Math.max(1000, Number(process.env.KCA_BLENDER_WATCH_MS || 60000));
const HEADROOM_MB = Number(process.env.KCA_BLENDER_HEADROOM_MB || 4000);
const BLENDER = blenderExe();
const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const own = sep >= 0 ? argv.slice(0, sep) : argv;
const blenderArgs = sep >= 0 ? argv.slice(sep + 1) : [];
const opt = {};
for (let i = 0; i < own.length; i++) {
  if (!own[i].startsWith('--')) continue;
  const k = own[i].slice(2); const v = own[i + 1] && !own[i + 1].startsWith('--') ? own[++i] : true;
  opt[k] = v;
}
const gb = (mb) => (mb == null ? '?' : (mb / 1024).toFixed(1));
const isoNow = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

if (opt.status) {
  const m = memState(); const g = gpuMem();
  console.log(JSON.stringify({ blender: BLENDER, slots: SLOTS, lock: blenderJobs(SLOTS), runningBlenderPids: runningBlenders(), queue: queue('blender'),
    memory: { availableMB: Math.round(m.availMB), totalMB: Math.round(m.totalMB), swapUsedMB: Math.round(m.swapUsedMB), swapTotalMB: Math.round(m.swapTotalMB), psiSome10: m.psiSome10, vram: g } }, null, 2));
  process.exit(0);
}
if (!blenderArgs.length) { console.error('usage: node tools/blender-run.mjs [--log f] [--what label] [--owner id] [--mem-mb N] -- <blender args>'); process.exit(2); }

const logPath = opt.log ? path.resolve(opt.log) : '';
const what = opt.what || blenderArgs.join(' ').slice(0, 120);
const jobKey = blenderJobKey(blenderArgs);
const peak = expectedBlenderPeak({ declaredMB: Number(opt['mem-mb']) > 0 ? Number(opt['mem-mb']) : 0, key: jobKey, what });
const gate = memGate('blender', { prefix: '[blender-run]', needMB: peak.mb + HEADROOM_MB });
const release = await acquire('blender', {
  slots: SLOTS,
  // gpu:false = a CPU render (KCA_CYCLES_DEVICE=CPU): exempt from the capture/Blender GPU turn-taking in lib/locks.mjs
  info: { owner: opt.owner || process.env.KCA_OWNER || '', what, log: logPath, memMB: peak.mb, memSrc: peak.src, script: jobKey.script, ppid: process.ppid, ...(String(process.env.KCA_CYCLES_DEVICE || '').toUpperCase() === 'CPU' ? { gpu: false } : {}) },
  pollMs: Math.max(100, Number(opt['poll-ms']) || 5000),
  signals: false, // handled below: a stopped wrapper stops its Blender
  // Also wait while the machine is already at the cap (unmanaged Blenders count too), or while memory is short.
  // Only evaluated when a slot is free and this job is first in the queue.
  extraBusy: async () => {
    const n = runningBlenders().length;
    if (n >= SLOTS) return `${n} Blender processes already running machine-wide (cap ${SLOTS})`;
    return gate();
  },
});
const childFile = path.join(LOCK_DIR, `blender-${release.slot ?? 0}.child`);

let out = 'inherit';
let logStream = null;
if (logPath) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  logStream = fs.createWriteStream(logPath, { flags: 'a' });
  out = 'pipe';
}
const env = withLibPath(process.env);
if (IS_WSL && !env.KCA_CYCLES_DEVICE) env.KCA_CYCLES_DEVICE = 'CUDA';
console.error(`[blender-run] slot ${release.slot ?? 0}/${SLOTS} acquired (expected peak ${gb(peak.mb)} GB, ${peak.src}) → ${BLENDER} ${blenderArgs.join(' ')}`);
const child = spawn(BLENDER, blenderArgs, { stdio: ['ignore', out, out], windowsHide: true, env });
child.on('error', (e) => {
  console.error(`[blender-run] could not start Blender (${BLENDER}): ${e.message}. Set BLENDER_EXE or see tools/doctor.mjs.`);
  release(); try { fs.unlinkSync(childFile); } catch {}
  process.exit(127);
});
// Blender uses every core for minutes. Below-normal priority keeps the game's browsers and agents responsive; builds only
// slow down while the CPU is contended, they never stop.
try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* best effort */ }
if (child.pid) fs.writeFileSync(childFile, String(child.pid));

// ---- output + watchdog
const t0 = Date.now();
let lastOut = Date.now(), atLineStart = true, lastStall = 0, lastCpu = procCpuSec(child.pid), lastTick = Date.now(), peakMB = 0;
if (logStream) {
  // Never let a log write error stall Blender: keep draining its pipes even if the file can't be written.
  logStream.on('error', (e) => { console.error(`[blender-run] log write failed (${e.message}); Blender output is dropped from now on`); child.stdout.unpipe(); child.stderr.unpipe(); child.stdout.resume(); child.stderr.resume(); logStream = null; });
  const onData = (chunk) => { lastOut = Date.now(); atLineStart = chunk[chunk.length - 1] === 10; };
  child.stdout.on('data', onData); child.stderr.on('data', onData);
  child.stdout.pipe(logStream, { end: false }); child.stderr.pipe(logStream, { end: false });
}
const writeLog = (line) => { if (!logStream) return; logStream.write((atLineStart ? '' : '\n') + line + '\n'); atLineStart = true; };
function watchdog(first = false) {
  try {
    const now = Date.now();
    const pm = procMem(child.pid); const cpu = procCpuSec(child.pid);
    if (pm) peakMB = Math.max(peakMB, pm.hwmMB || pm.rssMB);
    const cpuPct = cpu != null && lastCpu != null && now > lastTick ? Math.round((cpu - lastCpu) / ((now - lastTick) / 1000) * 100) : null;
    lastCpu = cpu; lastTick = now;
    const m = memState(); const g = gpuMem();
    const silentMin = (now - lastOut) / 60000;
    const parts = [`blender pid ${child.pid}`, `up ${((now - t0) / 60000).toFixed(1)} min`,
      `rss ${gb(pm && pm.rssMB)} GB (peak ${gb(peakMB)}, swap ${gb(pm && pm.swapMB)})`, `cpu ${cpuPct ?? '?'} %`,
      `MemAvailable ${gb(m.availMB)} GB`, `swap used ${gb(m.swapUsedMB)}/${gb(m.swapTotalMB)} GB`, `mem pressure ${m.psiSome10} %`,
      g ? `VRAM ${gb(g.usedMB)}/${gb(g.totalMB)} GB` : 'VRAM ?'];
    if (logStream) parts.push(`last Blender output ${silentMin.toFixed(1)} min ago`);
    writeLog(`[kca-watchdog ${isoNow()}] ${first ? `started · expected peak ${gb(peak.mb)} GB (${peak.src}) · ` : ''}${parts.join(' · ')}`);
    const stalled = !!logStream && silentMin >= STALL_MIN;
    if (stalled && (!lastStall || now - lastStall >= 15 * 60000)) {
      lastStall = now;
      const s = `[kca-watchdog ${isoNow()}] !!!!!!!! STALL: Blender pid ${child.pid} has printed nothing for ${Math.round(silentMin)} min (cpu ${cpuPct ?? '?'} %, rss ${gb(pm && pm.rssMB)} GB, MemAvailable ${gb(m.availMB)} GB, swap ${gb(m.swapUsedMB)} GB). NOT killed. Owner: check it; post it on docs/notes/_coord-C2.md with the PID; stop only your own job (kill the wrapper pid ${process.pid}).`;
      writeLog(s); console.error(s);
    }
    release.update({ child: child.pid, lastOut: logStream ? new Date(lastOut).toISOString() : undefined, rssMB: pm ? Math.round(pm.rssMB) : null, peakRssMB: Math.round(peakMB), swapMB: pm ? Math.round(pm.swapMB) : null, cpuPct, watch: new Date(now).toISOString(), stalled });
  } catch { /* the watchdog must never take the job down */ }
}
let watchTimer = null, peakTimer = null;
if (child.pid) {
  watchdog(true); watchTimer = setInterval(watchdog, WATCH_MS); watchTimer.unref();
  // VmHWM (peak RSS) is lost once Blender exits: read it every 5 s (one small /proc read) so the recorded peak is exact
  peakTimer = setInterval(() => { const pm = procMem(child.pid); if (pm) peakMB = Math.max(peakMB, pm.hwmMB || pm.rssMB); }, 5000); peakTimer.unref();
}

// ---- stopping: forward the signal, give Blender 10 s, then SIGKILL; the slot is released when it has exited
let stopping = '';
const stop = (sig) => {
  if (stopping) return; stopping = sig;
  console.error(`[blender-run] ${sig}: stopping Blender pid ${child.pid}`);
  try { child.kill('SIGTERM'); } catch {}
  setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 10000).unref();
};
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => stop(sig));
// Free the slot the moment Blender exits; finish the log once its pipes are drained ('close'), or after 10 s at most
// (a grandchild that inherited the pipes can keep them open).
let exitCode = null, exitLine = '';
const finish = () => {
  if (logStream) {
    const ls = logStream; writeLog(exitLine); logStream = null;
    ls.end(() => process.exit(exitCode)); setTimeout(() => process.exit(exitCode), 5000).unref();
  } else process.exit(exitCode);
};
child.on('exit', (code, sig) => {
  clearInterval(watchTimer); clearInterval(peakTimer);
  release();
  try { fs.unlinkSync(childFile); } catch {}
  const minutes = (Date.now() - t0) / 60000;
  console.error(`[blender-run] blender exited code=${code} sig=${sig || ''}`);
  exitCode = stopping ? 130 : (code ?? 1);
  exitLine = `[kca-watchdog ${isoNow()}] blender exited code=${code} sig=${sig || ''} after ${minutes.toFixed(1)} min · peak rss ${gb(peakMB)} GB`;
  // learn this script's real peak for the memory gate (a job stopped in its first minute says little: skip it)
  if (!stopping || minutes > 1) recordPeak(jobKey, peakMB, minutes, exitCode);
  setTimeout(finish, 10000);
});
child.on('close', () => { if (exitCode !== null) finish(); });
