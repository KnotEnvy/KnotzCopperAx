// Memory gate for every job that starts something big on the shared machine: a Blender build (tools/blender-run.mjs) or
// a GPU browser (tools/capture.mjs and anything else that takes a 'capture' slot).
//
// Why (2026-10-23): two release bakes grew to 12 + 9 GB while 6 capture browsers ran; swap filled, load reached 60-98 and
// most agents lost their API connection. A gate that only looks at free memory "now" lets jobs start that have not
// grown yet, so this one also counts what the running jobs are still expected to take:
//
//   usable   = MemAvailable − KCA_SWAP_WEIGHT (0.5) × swap used − reserved
//   reserved = Σ over running Blenders: max(0, expected peak − current RSS)
//            + Σ over captures younger than KCA_CAPTURE_RAMP_MS (120 s): KCA_CAPTURE_RAMP_MB (1500; a stage page settles
//              at ~1.5-2 GB PSS for its whole browser, measured 2026-10-24 over 212 browsers: p50 1.45 GB, p90 2.0 GB)
//
// A Blender's expected peak: `blender-run --mem-mb N` if given, else the LEARNED peak of the same script (+ mode) from its
// previous runs (blender-peaks.json beside the locks: every wrapper records its Blender's peak RSS when it exits), else a
// guess from the label (release 16 GB, fast/preview 6 GB, other 10 GB; 2026-10-24 measured: Varkhul release 17-18 GB,
// Varkhul fast 10 GB, Seraphine release 5.8 GB, Seraphine fast 2.4 GB).
//
// A job starts only when usable ≥ its need — capture KCA_CAPTURE_MIN_FREE_MB (4000); Blender max(KCA_BLENDER_MIN_FREE_MB
// (14000), its own expected peak + KCA_BLENDER_HEADROOM_MB (4000)), never more than 80 % of RAM — memory pressure is low
// (PSI "some" avg10 < KCA_MEM_PSI_MAX = 10 %: above that the machine is already thrashing) and the GPU has
// KCA_MIN_VRAM_FREE_MB (1024) free. Every number is printed in the waiting message.
import fs from 'node:fs';
import path from 'node:path';
import { LOCK_DIR, lockIsStale } from './locks.mjs';
import { memState, procMem, gpuMem } from './platform.mjs';

const num = (v, d) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
const gb = (mb) => (mb / 1024).toFixed(1);
export const PEAKS_FILE = path.join(LOCK_DIR, 'blender-peaks.json');

// ---- learned Blender peaks ---------------------------------------------------------------------------------------
/** Identify a Blender job for the peak history: the -P script's file name, the mode (release / fast / preview / draft /
 * quick, from the script args after `--`) and the full script-arg string. */
export function blenderJobKey(blenderArgs = []) {
  const p = blenderArgs.indexOf('-P') >= 0 ? blenderArgs.indexOf('-P') : blenderArgs.indexOf('--python');
  const script = p >= 0 && blenderArgs[p + 1] ? path.basename(String(blenderArgs[p + 1])) : '';
  const sep = blenderArgs.indexOf('--');
  const tail = sep >= 0 ? blenderArgs.slice(sep + 1).map(String) : [];
  const m = tail.join(' ').match(/--?(release|fast|preview|draft|quick)\b/i);
  return { script, mode: m ? m[1].toLowerCase() : '', args: tail.join(' ').slice(0, 200) };
}
function readPeaks() { try { const j = JSON.parse(fs.readFileSync(PEAKS_FILE, 'utf8')); return Array.isArray(j.runs) ? j.runs : []; } catch { return []; } }
/** Learned peak (MB) for a job key: the max of the last 5 successful runs of the same script + args, else of the same
 * script + mode; +10 %. */
export function learnedPeakMB(key) {
  if (!key || !key.script) return null;
  const runs = readPeaks().filter((r) => r.script === key.script && !r.code); // a failed run's peak says little
  const pick = (list) => (list.length ? Math.max(...list.slice(-5).map((r) => r.peakMB)) : null);
  const exact = pick(runs.filter((r) => r.args === key.args));
  if (exact) return { mb: Math.round(exact * 1.1), src: 'learned (same args)' };
  const mode = pick(runs.filter((r) => r.mode === key.mode));
  if (mode) return { mb: Math.round(mode * 1.1), src: `learned (${key.mode || 'default'} mode)` };
  return null;
}
/** Append one finished run (atomic write; the history keeps the last 300 runs). */
export function recordPeak(key, peakMB, minutes, code) {
  if (!key || !key.script || !(peakMB > 0)) return;
  try {
    const runs = readPeaks();
    runs.push({ script: key.script, mode: key.mode, args: key.args, peakMB: Math.round(peakMB), min: +minutes.toFixed(1), code, at: new Date().toISOString() });
    const tmp = `${PEAKS_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ about: 'peak RSS of finished Blender jobs (tools/blender-run.mjs); read by tools/lib/memgate.mjs', runs: runs.slice(-300) }, null, 0));
    fs.renameSync(tmp, PEAKS_FILE);
  } catch { /* history is best effort */ }
}

/** Expected peak RSS (MB) of a Blender job: declared (--mem-mb) / learned / label guess. lock = its lock info. */
export function blenderPeakMB(lock) {
  if (lock && Number(lock.memMB) > 0) return Number(lock.memMB);
  const what = String((lock && lock.what) || '');
  if (/release|\brel\d*\b/i.test(what)) return num(process.env.KCA_BLENDER_PEAK_RELEASE_MB, 16000);
  if (/\b(fast|preview|draft|quick)\d*\b/i.test(what)) return num(process.env.KCA_BLENDER_PEAK_FAST_MB, 6000);
  return num(process.env.KCA_BLENDER_PEAK_MB, 10000);
}
/** Expected peak for a NEW job (before it has a lock): { mb, src }. */
export function expectedBlenderPeak({ declaredMB, key, what }) {
  if (declaredMB > 0) return { mb: declaredMB, src: 'declared (--mem-mb)' };
  const l = learnedPeakMB(key);
  if (l) return l;
  return { mb: blenderPeakMB({ what: `${what || ''} ${key && key.mode ? key.mode : ''}` }), src: 'guessed from the label' };
}

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }

/** Memory still promised to running jobs (MB) + a short description. Reads only the lock files and /proc of the holders. */
export function reservedMB({ exceptPid = process.pid } = {}) {
  let total = 0; const parts = [];
  let names = [];
  try { names = fs.readdirSync(LOCK_DIR); } catch { return { total, parts }; }
  const now = Date.now();
  const rampMs = num(process.env.KCA_CAPTURE_RAMP_MS, 120000), rampMB = num(process.env.KCA_CAPTURE_RAMP_MB, 1500);
  for (const n of names) {
    const m = /^(blender|capture)-(\d+)\.lock$/.exec(n);
    if (!m) continue;
    const file = path.join(LOCK_DIR, n);
    const cur = readJson(file);
    if (!cur || cur.pid === exceptPid || cur.holdOnly || lockIsStale(file, cur)) continue;
    if (m[1] === 'blender') {
      const child = Number(cur.child) || Number((() => { try { return fs.readFileSync(path.join(LOCK_DIR, `blender-${m[2]}.child`), 'utf8'); } catch { return 0; } })());
      const pm = child ? procMem(child) : null;
      const peak = blenderPeakMB(cur);
      const r = Math.max(0, peak - (pm ? pm.rssMB : 0));
      if (r > 0) { total += r; parts.push(`blender ${child || cur.pid} ${gb(r)}`); }
    } else if (now - Date.parse(cur.started || 0) < rampMs) {
      total += rampMB; parts.push(`new capture ${cur.pid} ${gb(rampMB)}`);
    }
  }
  return { total, parts };
}

/**
 * Check the gate once. Returns { ok, reason, usableMB, minMB, state } — reason is a one-line explanation when !ok.
 * kind: 'blender' | 'capture'. needMB: this job's own need (default: the kind's minimum).
 */
export function checkMemory(kind, { needMB } = {}) {
  const e = process.env;
  const floor = kind === 'blender' ? num(e.KCA_BLENDER_MIN_FREE_MB, 14000) : num(e.KCA_CAPTURE_MIN_FREE_MB, 4000);
  const envName = kind === 'blender' ? 'KCA_BLENDER_MIN_FREE_MB' : 'KCA_CAPTURE_MIN_FREE_MB';
  const st = memState();
  let minMB = Math.max(floor, needMB || 0);
  if (st.totalMB > 0) minMB = Math.min(minMB, Math.max(floor, 0.8 * st.totalMB)); // a need above 80 % of RAM would wait forever
  if (!Number.isFinite(st.availMB)) return { ok: true, reason: '', usableMB: Infinity, minMB, state: st }; // no /proc (Windows)
  const swapW = num(e.KCA_SWAP_WEIGHT, 0.5);
  const res = reservedMB();
  const usableMB = st.availMB - swapW * st.swapUsedMB - res.total;
  if (usableMB < minMB) {
    const detail = [`MemAvailable ${gb(st.availMB)}`];
    if (st.swapUsedMB >= 64 && swapW > 0) detail.push(`${swapW} × ${gb(st.swapUsedMB)} swap used`);
    if (res.total > 0) detail.push(`${gb(res.total)} still expected by running jobs (${res.parts.join(', ')})`);
    const why = minMB > floor ? `this job's expected peak + headroom` : envName;
    return { ok: false, usableMB, minMB, state: st, reason: `waiting for memory: ${gb(usableMB)} GB usable (${detail.join(' − ')}), need ${gb(minMB)} GB (${why})` };
  }
  const psiMax = num(e.KCA_MEM_PSI_MAX, 10);
  if (st.psi && psiMax > 0 && st.psiSome10 >= psiMax) {
    return { ok: false, usableMB, minMB, state: st, reason: `waiting for memory: the machine is swapping/thrashing (memory pressure ${st.psiSome10} % of the last 10 s ≥ ${psiMax} %, KCA_MEM_PSI_MAX)` };
  }
  const vramMin = num(e.KCA_MIN_VRAM_FREE_MB, 1024);
  if (vramMin > 0) {
    const g = gpuMem();
    if (g && g.totalMB - g.usedMB < vramMin) {
      return { ok: false, usableMB, minMB, state: st, reason: `waiting for GPU memory: ${g.totalMB - g.usedMB} MB free of ${g.totalMB} MB, need ${vramMin} MB (KCA_MIN_VRAM_FREE_MB)` };
    }
  }
  return { ok: true, reason: '', usableMB, minMB, state: st };
}

/**
 * An `extraBusy` callback for locks.acquire(): returns false when the job may start, else the reason string. Logs the
 * reason to stderr at most once a minute with the given prefix (e.g. "[capture]").
 */
export function memGate(kind, { prefix = `[${kind}]`, quiet = false, needMB } = {}) {
  let lastLog = 0, lastReason = '';
  return async () => {
    const r = checkMemory(kind, { needMB });
    if (r.ok) return false;
    if (!quiet && (Date.now() - lastLog > 60000 || r.reason.split(':')[0] !== lastReason)) {
      lastLog = Date.now(); lastReason = r.reason.split(':')[0];
      console.error(`${prefix} ${r.reason}`);
    }
    return r.reason;
  };
}
