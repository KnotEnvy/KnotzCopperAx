// Shared hidden X display for GPU browsers on Linux / WSL2.
//
// Headless Chromium on WSL2 can't reach the GPU (there is no DRM render node, so surfaceless EGL finds no device and
// falls back to SwiftShader). Headed Chromium on an X display does reach it through Mesa's d3d12 driver
// (ANGLE → OpenGL 4.6 → D3D12 → the real NVIDIA GPU). So every tool runs a headed browser on ONE shared Xvfb display,
// which nobody sees. The display is shared infrastructure, like the :5190 dev server: it is started on first use and
// left running (≈30 MB). `node tools/doctor.mjs --stop-display` stops it.
import fs from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { acquire, pidAlive } from './locks.mjs';
import { sandboxReason, SANDBOX_HELP } from './platform.mjs';

export const DISPLAY_NUM = Number(process.env.KCA_XVFB_DISPLAY || 99);
const LOCK = `/tmp/.X${DISPLAY_NUM}-lock`;
const SOCKET = `/tmp/.X11-unix/X${DISPLAY_NUM}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// On WSL2 /tmp/.X11-unix is a read-only mount owned by WSLg, so Xvfb can't create its socket file there and listens
// only on the abstract socket "@/tmp/.X11-unix/X<n>" (which X clients try first anyway).
function listening() {
  if (fs.existsSync(SOCKET)) return true;
  try { return fs.readFileSync('/proc/net/unix', 'utf8').includes(`@${SOCKET}`); } catch { return false; }
}

/** PID of the running shared Xvfb, or 0. The socket answering is what counts: the lock file can go missing (another
 * process deleted it) while the server is fine, and then the PID is looked up by name. -1 = up, PID unknown. */
export function displayPid() {
  if (!listening()) return 0;
  try {
    const pid = Number(fs.readFileSync(LOCK, 'utf8').trim());
    if (pidAlive(pid)) return pid;
  } catch {}
  try {
    const m = execFileSync('pgrep', ['-xa', 'Xvfb'], { encoding: 'utf8' }).split('\n').find((l) => l.includes(` :${DISPLAY_NUM} `) || l.endsWith(` :${DISPLAY_NUM}`));
    if (m) return Number(m.split(' ')[0]);
  } catch {}
  return -1;
}

/** Make sure the shared display is up; returns the DISPLAY string (":99"). */
export async function ensureDisplay() {
  if (displayPid()) return `:${DISPLAY_NUM}`;
  // In a sandbox the shared display's PID and socket are invisible: never delete its lock or start a rival server.
  const sb = sandboxReason();
  if (sb) throw new Error(`cannot reach the shared display :${DISPLAY_NUM} from a sandbox (${sb}). ${SANDBOX_HELP}`);
  const release = await acquire('xvfb', { info: { what: 'starting Xvfb :' + DISPLAY_NUM }, quiet: true, waitMaxMs: 60e3 });
  try {
    if (displayPid()) return `:${DISPLAY_NUM}`;
    // A stale lock from a dead Xvfb blocks a restart. Only remove it when nothing answers on the display AND its PID is
    // dead (we are not sandboxed, checked above, so the PID is visible).
    try { if (fs.existsSync(LOCK) && !listening() && !pidAlive(Number(fs.readFileSync(LOCK, 'utf8').trim()))) fs.unlinkSync(LOCK); } catch {}
    // Large screen so any viewport (up to 4K plus browser chrome) fits.
    const child = spawn('Xvfb', [`:${DISPLAY_NUM}`, '-screen', '0', '3840x2160x24', '-nolisten', 'tcp', '-noreset'], { detached: true, stdio: 'ignore' });
    child.unref();
    for (let i = 0; i < 100; i++) { if (displayPid()) return `:${DISPLAY_NUM}`; await sleep(100); }
    throw new Error(`Xvfb :${DISPLAY_NUM} did not start (is the xvfb package installed?)`);
  } finally { release(); }
}

export function stopDisplay() {
  const pid = displayPid();
  if (pid > 0) { try { process.kill(pid, 'SIGTERM'); } catch {} }
  return pid;
}
