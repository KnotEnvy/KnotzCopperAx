// Machine-wide resource locks shared by every agent and session working on KnotzCopperAx.
// Lock files live in progress/locks/, which Vite ignores, so they never trigger reloads.
// A lock records the holder's PID and PID namespace, and its holder touches the file every 15 s (heartbeat).
// Stale = (same PID namespace and the PID is dead) or (other namespace and no heartbeat for 60 s). The namespace rule
// matters for sandboxed agents (e.g. Codex), which can't see host PIDs: without it they'd treat every live lock as stale.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LOCK_DIR = path.join(root, 'progress', 'locks');
fs.mkdirSync(LOCK_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let PID_NS = '';
try { PID_NS = fs.readlinkSync('/proc/self/ns/pid'); } catch { /* not Linux */ }
export const MY_PID_NS = PID_NS;
const HEARTBEAT_MS = 15000, HEARTBEAT_STALE_MS = 60000;
function heartbeat(file) {
  const t = setInterval(() => { try { const now = new Date(); fs.utimesSync(file, now, now); } catch {} }, HEARTBEAT_MS);
  t.unref();
  return () => clearInterval(t);
}
function ageMs(file) { try { return Date.now() - fs.statSync(file).mtimeMs; } catch { return Infinity; } }
/** Is this lock file stale? (see the header) */
export function lockIsStale(file, cur = readLock(file)) {
  // an unparsable file is usually a lock another process JUST created (open 'wx' then write): stale only after 5 s
  if (!cur) return ageMs(file) > 5000;
  const sameNs = !cur.pidns || !PID_NS || cur.pidns === PID_NS;
  return sameNs ? !pidAlive(cur.pid) : ageMs(file) > HEARTBEAT_STALE_MS;
}

export function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function readLock(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function tryCreate(file, info) {
  try {
    const fd = fs.openSync(file, 'wx');
    fs.writeSync(fd, JSON.stringify(info));
    fs.closeSync(fd);
    return true;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    if (lockIsStale(file)) { // stale → remove and let the caller retry
      try { fs.unlinkSync(file); } catch {}
    }
    return false;
  }
}

/**
 * Priority claim (perf-1650 r4): a real-time measurement needs EVERY slot at once, but slots free up one at a time and
 * the polling free-for-all starves it (a 5-stage bench waited 20 min and gave up). claimPriority(name) writes
 * `<name>.want`; while a LIVE claim by another process exists, acquire() of that family does not take a free slot (it
 * keeps polling), so the running holders drain and the claimant gets them all. The claimant's own acquire() calls pass.
 * Returns release(). Only one claim at a time (a second claimant waits for the first). Stale (dead pid / >1 h) ignored.
 */
export async function claimPriority(name, { info = {}, pollMs = 3000, waitMaxMs = 3600e3 } = {}) {
  const file = path.join(LOCK_DIR, `${name}.want`);
  const t0 = Date.now();
  for (;;) {
    if (tryCreate(file, { pid: process.pid, pidns: PID_NS, since: new Date().toISOString(), ...info })) break;
    const cur = readLock(file);
    if (cur && cur.pid === process.pid) break; // already ours (capture.mjs claims at start, the scenario claims again)
    if (cur && Date.now() - Date.parse(cur.since || 0) > 3600e3) { try { fs.unlinkSync(file); } catch {} continue; }
    if (Date.now() - t0 > waitMaxMs) throw new Error(`timed out waiting to claim priority on "${name}"`);
    await sleep(pollMs);
  }
  let done = false;
  const stopBeat = heartbeat(file);
  const release = () => { if (done) return; done = true; stopBeat(); const cur = readLock(file); if (cur && cur.pid === process.pid) { try { fs.unlinkSync(file); } catch {} } };
  process.once('exit', release);
  return release;
}
function wantedByOther(name) {
  const w = readLock(path.join(LOCK_DIR, `${name}.want`));
  return !!(w && w.pid !== process.pid && !lockIsStale(path.join(LOCK_DIR, `${name}.want`), w) && Date.now() - Date.parse(w.since || 0) < 3600e3);
}

/**
 * Acquire one of `slots` interchangeable slots named `${name}-<i>.lock` (slots=1 → an exclusive lock).
 * Resolves to a release() function. Waits (polling) until a slot frees up; logs while waiting.
 */
export async function acquire(name, { slots = 1, info = {}, pollMs = 3000, waitMaxMs = 6 * 3600e3, quiet = false, extraBusy = null } = {}) {
  const t0 = Date.now();
  let lastLog = 0;
  for (;;) {
    const busyElsewhere = extraBusy ? await extraBusy() : false;
    const yielding = !busyElsewhere && wantedByOther(name); // another process holds a priority claim: leave the free slots to it
    if (!busyElsewhere && !yielding) {
      for (let i = 0; i < slots; i++) {
        const file = path.join(LOCK_DIR, `${name}-${i}.lock`);
        const data = { pid: process.pid, pidns: PID_NS, started: new Date().toISOString(), cwd: process.cwd(), ...info };
        if (tryCreate(file, data)) {
          let released = false;
          const stopBeat = heartbeat(file);
          const release = () => {
            if (released) return; released = true; stopBeat();
            const cur = readLock(file);
            if (cur && cur.pid === process.pid) { try { fs.unlinkSync(file); } catch {} }
          };
          process.once('exit', release);
          for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.once(sig, () => { release(); process.exit(130); });
          release.slot = i;
          return release;
        }
      }
    }
    if (Date.now() - t0 > waitMaxMs) throw new Error(`timed out waiting for lock "${name}"`);
    if (!quiet && Date.now() - lastLog > 30000) {
      lastLog = Date.now();
      const holders = [];
      for (let i = 0; i < slots; i++) { const h = readLock(path.join(LOCK_DIR, `${name}-${i}.lock`)); if (h) holders.push(`${h.pid}${h.owner ? ' ' + h.owner : ''}${h.what ? ' (' + h.what + ')' : ''}`); }
      console.error(`[locks] waiting for "${name}" (${slots} slot${slots > 1 ? 's' : ''}; held by ${holders.join(', ') || (busyElsewhere ? 'an unmanaged process' : '?')}${yielding ? '; yielding to an exclusive (priority) request' : ''}) — ${Math.round((Date.now() - t0) / 1000)} s`);
    }
    await sleep(pollMs);
  }
}

/** Describe current holders of a lock family (for --status). */
export function status(name, slots = 1) {
  const out = [];
  for (let i = 0; i < slots; i++) {
    const file = path.join(LOCK_DIR, `${name}-${i}.lock`);
    const h = readLock(file);
    if (h) out.push({ slot: i, ...h, alive: !lockIsStale(file, h) });
  }
  return out;
}
