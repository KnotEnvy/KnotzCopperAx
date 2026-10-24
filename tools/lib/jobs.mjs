// Live view of the Blender slots for `blender-run --status` and `doctor`: who holds each slot, how long it has run, the
// Blender's memory, how long ago it last printed anything (a silent log for 45 min = probably stalled) and whether the
// session that launched the wrapper is still there.
import fs from 'node:fs';
import path from 'node:path';
import { status, waiters, LOCK_DIR } from './locks.mjs';
import { procMem } from './platform.mjs';
import { blenderPeakMB } from './memgate.mjs';

export const STALL_MIN = Number(process.env.KCA_BLENDER_STALL_MIN || 45);

/** Minutes since a held slot's Blender last printed: the wrapper's own record (r13+ wrappers), else the mtime of the log
 * file the wrapper has open (older wrappers write nothing else into it). null when unknown (job without --log). */
export function lastOutputMin(h) {
  if (h.lastOut) return (Date.now() - Date.parse(h.lastOut)) / 60000;
  if (h.log === '') return null; // r13+ wrapper without --log
  let log = h.log;
  if (!log) { // pre-r13 wrapper: find the log file it has open (fd 3+; 0-2 are the wrapper's own stdio)
    try {
      for (const fd of fs.readdirSync(`/proc/${h.pid}/fd`)) {
        if (Number(fd) < 3) continue;
        const p = fs.readlinkSync(`/proc/${h.pid}/fd/${fd}`);
        if (/\.(log|txt)$/.test(p)) { log = p; break; }
      }
    } catch { /* not Linux / not visible */ }
  }
  if (!log) return null;
  try { return (Date.now() - fs.statSync(log).mtimeMs) / 60000; } catch { return null; }
}

/** Held Blender slots with runtimeMin, childPid, rssMB, swapMB, expectedPeakMB, log, lastOutputMinAgo, stalled, launcherGone. */
export function blenderJobs(slots = 3) {
  return status('blender', slots).map((h) => {
    let child = Number(h.child) || 0;
    if (!child) { try { child = Number(fs.readFileSync(path.join(LOCK_DIR, `blender-${h.slot}.child`), 'utf8')) || 0; } catch {} }
    const pm = child ? procMem(child) : null;
    const wrapper = procMem(h.pid);
    const silent = lastOutputMin(h);
    // r13+ wrappers record the PID of the process that started them; if their parent is no longer that process, the
    // launching session is gone (nobody is waiting for this job's result any more)
    const launcherGone = !!(h.ppid && wrapper && wrapper.ppid !== h.ppid);
    return { ...h, runtimeMin: +((Date.now() - Date.parse(h.started)) / 60000).toFixed(1), childPid: child || null,
      rssMB: pm ? Math.round(pm.rssMB) : null, swapMB: pm ? Math.round(pm.swapMB) : null, peakRssMB: pm ? Math.round(pm.hwmMB) : null,
      expectedPeakMB: blenderPeakMB(h), lastOutputMinAgo: silent == null ? null : +silent.toFixed(1),
      stalled: silent != null && silent >= STALL_MIN, launcherGone };
  });
}

/** Waiting jobs of a family, oldest first. */
export function queue(name) {
  return waiters(name).map((t) => ({ pid: t.pid, owner: t.owner, what: t.what, waitingMin: +((Date.now() - t.since) / 60000).toFixed(1) }));
}
