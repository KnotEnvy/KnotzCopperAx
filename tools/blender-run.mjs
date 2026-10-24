#!/usr/bin/env node
// The ONLY sanctioned way to run Blender for KnotzCopperAx. It caps how many Blender processes run machine-wide
// (KCA_BLENDER_SLOTS, default 3 = the owner's hard cap; a new build also waits until KCA_BLENDER_MIN_FREE_MB, default 14000, is free). Callers queue on progress/locks/blender-<i>.lock.
//
//   node tools/blender-run.mjs [--log <file>] [--what "<short label>"] [--owner <agent/item id>] -- <blender args…>
//   e.g. node tools/blender-run.mjs --log blender/out/gorrim_rel.log --what "gorrim release" --owner hero-gorrim -- -b --factory-startup -P blender/build_hero_gorrim.py -- --release
//   node tools/blender-run.mjs --status        (who holds the slots / which Blender processes are running)
//
// Blender: $BLENDER_EXE, else Linux Blender 5.2.1 in ~/.local/opt (WSL2 / Linux) or the standard Windows install.
// On WSL2 the wrapper adds WSL's NVIDIA libs and sets KCA_CYCLES_DEVICE=CUDA (blender/lib/pipeline.py reads it):
// OptiX lists the GPU there but can't create a context, while CUDA bakes work.
// The wrapper also waits while the machine already runs as many Blenders as there are slots (counting ones started by
// hand or by a crashed wrapper). Its exit code is Blender's exit code. To run it in the background, launch THIS wrapper
// in the background. Never call blender directly.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquire, status, LOCK_DIR } from './lib/locks.mjs';
import { IS_WSL, blenderExe, runningBlenders, withLibPath, memAvailableMB } from './lib/platform.mjs';

const SLOTS = Math.min(3, Number(process.env.KCA_BLENDER_SLOTS || 3)); // owner rule: never more than 3 Blenders
// A release bake can grow to ~12 GB. Only start when this much memory is free (KCA_BLENDER_MIN_FREE_MB overrides).
const MIN_FREE_MB = Number(process.env.KCA_BLENDER_MIN_FREE_MB || 14000);
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

if (opt.status) {
  console.log(JSON.stringify({ blender: BLENDER, slots: SLOTS, lock: status('blender', SLOTS), runningBlenderPids: runningBlenders() }, null, 2));
  process.exit(0);
}
if (!blenderArgs.length) { console.error('usage: node tools/blender-run.mjs [--log f] [--what label] [--owner id] -- <blender args>'); process.exit(2); }

let memWaitLogged = 0;
const release = await acquire('blender', {
  slots: SLOTS,
  info: { owner: opt.owner || process.env.KCA_OWNER || '', what: opt.what || blenderArgs.join(' ').slice(0, 120) },
  pollMs: Math.max(100, Number(opt['poll-ms']) || 5000),
  // Also wait while the machine is already at the cap (unmanaged Blenders count too), or while free memory is low.
  extraBusy: async () => {
    if (runningBlenders().length >= SLOTS) return true;
    const free = memAvailableMB();
    if (free >= MIN_FREE_MB) return false;
    if (!memWaitLogged || Date.now() - memWaitLogged > 60000) {
      memWaitLogged = Date.now();
      console.error(`[blender-run] waiting for memory: ${Math.round(free)} MB free, need ${MIN_FREE_MB} MB (KCA_BLENDER_MIN_FREE_MB)`);
    }
    return true;
  },
});
const childFile = path.join(LOCK_DIR, `blender-${release.slot ?? 0}.child`);

let out = 'inherit';
let logStream = null;
if (opt.log) {
  fs.mkdirSync(path.dirname(path.resolve(opt.log)), { recursive: true });
  logStream = fs.createWriteStream(opt.log, { flags: 'a' });
  out = 'pipe';
}
const env = withLibPath(process.env);
if (IS_WSL && !env.KCA_CYCLES_DEVICE) env.KCA_CYCLES_DEVICE = 'CUDA';
console.error(`[blender-run] slot ${release.slot ?? 0}/${SLOTS} acquired → ${BLENDER} ${blenderArgs.join(' ')}`);
const child = spawn(BLENDER, blenderArgs, { stdio: ['ignore', out, out], windowsHide: true, env });
child.on('error', (e) => {
  console.error(`[blender-run] could not start Blender (${BLENDER}): ${e.message}. Set BLENDER_EXE or see tools/doctor.mjs.`);
  release(); try { fs.unlinkSync(childFile); } catch {}
  process.exit(127);
});
// Blender uses every core for minutes. Below-normal priority keeps the game's browsers and agents responsive; builds only
// slow down while the CPU is contended, they never stop.
try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* best effort */ }
fs.writeFileSync(childFile, String(child.pid));
if (logStream) { child.stdout.pipe(logStream); child.stderr.pipe(logStream); }
const kill = () => { try { child.kill(); } catch {} };
process.on('SIGINT', kill); process.on('SIGTERM', kill);
child.on('exit', (code, sig) => {
  release();
  try { fs.unlinkSync(childFile); } catch {}
  console.error(`[blender-run] blender exited code=${code} sig=${sig || ''}`);
  if (logStream) logStream.end(() => process.exit(code ?? 1)); else process.exit(code ?? 1);
});
