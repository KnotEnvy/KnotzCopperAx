// Machine facts shared by the tools: which OS, where Blender lives, and the environment GPU programs need.
// Supported: Linux on WSL2 (main dev box), native Linux, and Windows (the original laptop).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// The project's dev server. Its own port (not Vite's default 5173), because other projects on this machine use 5173.
export const KCA_PORT = Number(process.env.KCA_PORT || 5190);
export const KCA_HOST = process.env.KCA_HOST || `http://127.0.0.1:${KCA_PORT}`;

export const IS_WIN = process.platform === 'win32';
export const IS_WSL = process.platform === 'linux' && (!!process.env.WSL_DISTRO_NAME || fs.existsSync('/dev/dxg'));

/** Non-empty when this process runs inside a sandbox with its own PID namespace (e.g. Codex's default sandbox). From
 * there the shared dev server, the hidden display and other agents' processes are invisible, so the KCA tools can't work
 * and must not try to "repair" shared state. */
export function sandboxReason() {
  if (process.platform !== 'linux') return '';
  try {
    const init = fs.readFileSync('/proc/1/cmdline', 'utf8').split('\0')[0];
    if (!/(^|\/)(init|systemd)$/.test(init)) return `PID 1 is "${init}" (separate process namespace)`;
  } catch { return 'cannot read /proc/1'; }
  return '';
}
export const SANDBOX_HELP = 'The KCA tools need host access (no sandbox): run this agent with full access, not a sandboxed mode.';

/** Extra shared-library dirs for GPU programs: WSL's NVIDIA/D3D12 libs, plus Chromium's system libs if they were
 * unpacked without root (see tools/doctor.mjs). */
export function gpuLibDirs() {
  const dirs = [];
  if (IS_WSL && fs.existsSync('/usr/lib/wsl/lib')) dirs.push('/usr/lib/wsl/lib');
  const local = path.join(os.homedir(), '.local/kca-chromium-libs/root/usr/lib/x86_64-linux-gnu');
  if (fs.existsSync(local)) dirs.push(local);
  return dirs;
}
export function withLibPath(env = process.env) {
  const dirs = gpuLibDirs();
  if (!dirs.length) return { ...env };
  return { ...env, LD_LIBRARY_PATH: [...dirs, env.LD_LIBRARY_PATH].filter(Boolean).join(':') };
}

/** Blender executable: $BLENDER_EXE, else the standard install for this OS. */
export function blenderExe() {
  if (process.env.BLENDER_EXE) return process.env.BLENDER_EXE;
  if (IS_WIN) return 'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe';
  const local = path.join(os.homedir(), '.local/opt/blender-5.2.1-linux-x64/blender');
  return fs.existsSync(local) ? local : 'blender';
}

/**
 * Free memory (MemAvailable, MB) on Linux/WSL; Infinity where /proc/meminfo is missing. KCA_FAKE_MEMAVAIL_MB overrides
 * it for testing. Used by blender-run and capture to wait instead of starting a job that would push the machine into
 * swap (2026-10-23: two release bakes at 12 + 9 GB filled swap, load ~90, agents lost their connections).
 */
export function memAvailableMB() {
  if (process.env.KCA_FAKE_MEMAVAIL_MB) return Number(process.env.KCA_FAKE_MEMAVAIL_MB);
  try {
    const m = /MemAvailable:\s+(\d+)\s*kB/.exec(fs.readFileSync('/proc/meminfo', 'utf8'));
    return m ? Number(m[1]) / 1024 : Infinity;
  } catch { return Infinity; }
}

/**
 * One cheap read of the machine's memory state (MB; Linux/WSL — elsewhere availMB is Infinity and the rest 0):
 * MemAvailable, MemTotal, swap total/used, and memory pressure (PSI, /proc/pressure/memory: % of the last 10 s in which
 * at least one task (some) / every task (full) was stalled waiting for memory — > 10 % means the machine is thrashing).
 * Test overrides: KCA_FAKE_MEMAVAIL_MB, KCA_FAKE_SWAPUSED_MB, KCA_FAKE_MEMPSI.
 */
export function memState() {
  const st = { availMB: Infinity, totalMB: 0, swapTotalMB: 0, swapUsedMB: 0, psiSome10: 0, psiFull10: 0, psi: false };
  try {
    const mi = fs.readFileSync('/proc/meminfo', 'utf8');
    const kb = (k) => { const i = mi.indexOf(k + ':'); return i < 0 ? NaN : parseInt(mi.slice(i + k.length + 1), 10) / 1024; };
    st.availMB = kb('MemAvailable'); st.totalMB = kb('MemTotal');
    st.swapTotalMB = kb('SwapTotal') || 0; st.swapUsedMB = Math.max(0, st.swapTotalMB - (kb('SwapFree') || 0));
    if (!Number.isFinite(st.availMB)) st.availMB = Infinity;
  } catch { /* not Linux */ }
  try {
    const p = fs.readFileSync('/proc/pressure/memory', 'utf8');
    const some = /some avg10=([\d.]+)/.exec(p), full = /full avg10=([\d.]+)/.exec(p);
    st.psiSome10 = some ? Number(some[1]) : 0; st.psiFull10 = full ? Number(full[1]) : 0; st.psi = !!some;
  } catch { /* kernel without PSI */ }
  const e = process.env;
  if (e.KCA_FAKE_MEMAVAIL_MB) st.availMB = Number(e.KCA_FAKE_MEMAVAIL_MB);
  if (e.KCA_FAKE_SWAPUSED_MB) st.swapUsedMB = Number(e.KCA_FAKE_SWAPUSED_MB);
  if (e.KCA_FAKE_MEMPSI) { st.psiSome10 = Number(e.KCA_FAKE_MEMPSI); st.psi = true; }
  return st;
}

/** Resident, peak resident (VmHWM) and swapped memory of one process (MB) + its parent PID, or null when it is gone /
 * not Linux. */
export function procMem(pid) {
  try {
    const s = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const kb = (k) => { const i = s.indexOf('\n' + k + ':'); return i < 0 ? 0 : parseInt(s.slice(i + k.length + 2), 10) / 1024; };
    const pp = /\nPPid:\s+(\d+)/.exec(s);
    return { rssMB: kb('VmRSS'), hwmMB: kb('VmHWM'), swapMB: kb('VmSwap'), ppid: pp ? Number(pp[1]) : 0 };
  } catch { return null; }
}

/** CPU seconds (user + system) a process has used so far, or null. */
export function procCpuSec(pid) {
  try {
    const s = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const f = s.slice(s.lastIndexOf(')') + 2).split(' ');
    return (Number(f[11]) + Number(f[12])) / 100; // USER_HZ = 100 on Linux
  } catch { return null; }
}

let gpuMemCache = null;
/** Whole-GPU memory {usedMB, totalMB} from nvidia-smi (WSL / Linux / Windows), cached 10 s; null when unavailable. */
export function gpuMem() {
  if (process.env.KCA_FAKE_VRAMFREE_MB) return { usedMB: 12000 - Number(process.env.KCA_FAKE_VRAMFREE_MB), totalMB: 12000 };
  if (gpuMemCache && Date.now() - gpuMemCache.t < 10000) return gpuMemCache.v;
  let v = null;
  const exe = IS_WIN ? 'nvidia-smi.exe' : (fs.existsSync('/usr/lib/wsl/lib/nvidia-smi') ? '/usr/lib/wsl/lib/nvidia-smi' : 'nvidia-smi');
  try {
    const out = execFileSync(exe, ['--query-gpu=memory.used,memory.total', '--format=csv,noheader,nounits'], { encoding: 'utf8', timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const [u, t] = out.split('\n')[0].split(',').map((x) => Number(x.trim()));
    if (Number.isFinite(u) && Number.isFinite(t) && t > 0) v = { usedMB: u, totalMB: t };
  } catch { /* no NVIDIA tools */ }
  gpuMemCache = { t: Date.now(), v };
  return v;
}

/**
 * PIDs of every running Blender on this machine (ours or not). Linux: a scan of /proc/<pid>/stat (process name exactly
 * "blender", zombies skipped) — no child process, because waiting wrappers call this and a fork per poll is what made
 * them expensive on a machine deep in swap. KCA_BLENDER_COMM changes the name (tests use a fake Blender).
 */
export function runningBlenders() {
  try {
    if (IS_WIN) {
      const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq blender.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
      return out.split(/\r?\n/).filter((l) => /blender\.exe/i.test(l)).map((l) => Number(l.split('","')[1]));
    }
    const comm = process.env.KCA_BLENDER_COMM || 'blender';
    const want = `(${comm}) `;
    let dirs = null;
    try { dirs = fs.readdirSync('/proc'); } catch { /* no /proc: fall back to pgrep */ }
    if (dirs) {
      const pids = [];
      for (const d of dirs) {
        const c = d.charCodeAt(0);
        if (c < 48 || c > 57) continue; // only numeric entries are processes
        let s;
        try { s = fs.readFileSync(`/proc/${d}/stat`, 'latin1'); } catch { continue; } // exited meanwhile
        const i = s.indexOf(want);
        if (i < 0 || s.lastIndexOf(')') !== i + want.length - 2) continue; // name must match exactly
        if (s.charAt(i + want.length) === 'Z') continue; // zombie
        pids.push(Number(d));
      }
      return pids;
    }
    // -x: exact process name, so editors with "blender" in a path don't count
    return execFileSync('pgrep', ['-x', comm], { encoding: 'utf8' }).split(/\s+/).filter(Boolean).map(Number);
  } catch { return []; } // pgrep exits 1 when nothing matches
}
