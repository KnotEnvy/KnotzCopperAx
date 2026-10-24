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

/** PIDs of every running Blender on this machine (ours or not). */
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

export function runningBlenders() {
  try {
    if (IS_WIN) {
      const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq blender.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
      return out.split(/\r?\n/).filter((l) => /blender\.exe/i.test(l)).map((l) => Number(l.split('","')[1]));
    }
    // -x: exact process name, so editors with "blender" in a path don't count
    return execFileSync('pgrep', ['-x', 'blender'], { encoding: 'utf8' }).split(/\s+/).filter(Boolean).map(Number);
  } catch { return []; } // pgrep exits 1 when nothing matches
}
