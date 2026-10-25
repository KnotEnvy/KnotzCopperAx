// Machine-wide resource locks shared by every agent and session working on KnotzCopperAx.
// Lock files live in progress/locks/, which Vite ignores, so they never trigger reloads.
// A lock records the holder's PID and PID namespace, and its holder touches the file every 15 s (heartbeat).
// Stale = (same PID namespace and the PID is dead) or (other namespace and no heartbeat for 60 s). The namespace rule
// matters for sandboxed agents (e.g. Codex), which can't see host PIDs: without it they'd treat every live lock as stale.
//
// Waiting (C2 r13, after the 23 Oct overload): waiters queue in arrival order (`<name>-wait-<pid>-<n>.ticket`) and only
// the oldest waiter tries to take a free slot, so a short job is no longer starved by later arrivals. Waiters sleep on a
// directory watch (inotify) and wake the moment a slot is released or the queue moves; the fallback poll backs off from
// pollMs to 15 s. The expensive checks (extraBusy: memory gate, Blender count) run only when a slot is actually free and
// this waiter is at the head of the queue — never in every waiter on every poll. Grants are staggered per family
// (capture 10 s, blender 30 s; KCA_CAPTURE_STAGGER_MS / KCA_BLENDER_STAGGER_MS): a new job does not start until the
// previous one has had time to allocate, so the memory gate reads memory after each launch instead of six browsers
// starting in the same second. Old waiters (still running pre-r13 code) ignore the queue; they just keep polling.
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
const num = (v, d) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
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
 * keeps waiting), so the running holders drain and the claimant gets them all. The claimant's own acquire() calls pass
 * (they also skip the queue and the stagger). Returns release(). Only one claim at a time (a second claimant waits for the
 * first). Stale (dead pid / >1 h) ignored.
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
function liveClaim(name) {
  const file = path.join(LOCK_DIR, `${name}.want`);
  const w = readLock(file);
  return w && !lockIsStale(file, w) && Date.now() - Date.parse(w.since || 0) < 3600e3 ? w : null;
}
function wantedByOther(name) { const w = liveClaim(name); return !!(w && w.pid !== process.pid); }
function holdsClaim(name) { const w = liveClaim(name); return !!(w && w.pid === process.pid); }

// ---- the wait queue ----------------------------------------------------------------------------------------------
let ticketSeq = 0;
const TICKET_RE = (name) => new RegExp(`^${name.replace(/[^\w]/g, '\\$&')}-wait-\\d+-\\d+\\.ticket$`);
/** Live waiters of a family, oldest first: [{ file, pid, since, seq, what, owner }]. Removes stale tickets it finds. */
export function waiters(name) {
  const re = TICKET_RE(name);
  let names = [];
  try { names = fs.readdirSync(LOCK_DIR); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (!re.test(n)) continue;
    const file = path.join(LOCK_DIR, n);
    const t = readLock(file);
    if (lockIsStale(file, t)) { if (t || ageMs(file) > 5000) { try { fs.unlinkSync(file); } catch {} } continue; }
    if (t) out.push({ file, ...t });
  }
  return out.sort(ticketOrder);
}
function ticketOrder(a, b) { return (a.since - b.since) || (a.pid - b.pid) || (a.seq - b.seq); }

/** Wake-up source: resolves wait() early when a slot / ticket / claim file of this family is created or removed. */
function familyWatch(name) {
  const re = new RegExp(`^${name.replace(/[^\w]/g, '\\$&')}(-\\d+\\.lock|-wait-\\d+-\\d+\\.ticket|\\.want)$`);
  let wake = null, watcher = null, pending = false;
  try {
    watcher = fs.watch(LOCK_DIR, { persistent: false }, (ev, f) => {
      // 'change' = heartbeats/content writes: ignore. 'rename' = create / delete / atomic replace.
      if (ev !== 'rename' || (f && !re.test(String(f)))) return;
      if (wake) { const w = wake; wake = null; w(); } else pending = true;
    });
    watcher.on('error', () => { try { watcher.close(); } catch {} watcher = null; });
  } catch { watcher = null; } // no inotify (limit reached / unsupported): plain polling
  return {
    get live() { return !!watcher; },
    wait(ms) {
      if (pending) { pending = false; return Promise.resolve(true); }
      return new Promise((r) => {
        const t = setTimeout(() => { wake = null; r(false); }, ms);
        wake = () => { clearTimeout(t); r(true); };
      });
    },
    close() { try { watcher && watcher.close(); } catch {} watcher = null; },
  };
}

const FAMILY_STAGGER = { capture: ['KCA_CAPTURE_STAGGER_MS', 10000], blender: ['KCA_BLENDER_STAGGER_MS', 30000] };

// ---- GPU turn-taking between captures and Blender (owner rule 2026-10-25) ------------------------------------------
// 11 of the 12 Windows GPU resets (TDR) on 24 Oct happened while a Blender CUDA bake shared the GPU with capture browsers,
// and every corrupted capture lined up with one. So the two families take turns on the GPU: a capture (any 'capture'
// slot: capture.mjs, perfbench, ui-overlap, glboot, ...) does not start while a Blender GPU job holds a 'blender' slot,
// and a Blender GPU job does not start while captures hold slots. Several captures still run together, and up to 3
// Blenders together. Cross-family order is arrival order (queue tickets), so neither side starves: a later capture
// waits behind an earlier queued Blender job, and that Blender job waits only for the captures already running/queued.
// Blender jobs that render on the CPU (lock info gpu:false — blender-run sets it for KCA_CYCLES_DEVICE=CPU) are exempt.
// KCA_GPU_SHARE=1 disables the rule for one process (emergency only).
const GPU_PEER = { capture: 'blender', blender: 'capture' };
function gpuPeerBusy(name, me, info) {
  if (name === 'blender' && info.gpu === false) return '';
  const peer = GPU_PEER[name];
  const re = new RegExp(`^${peer}-\\d+\\.lock$`);
  let names = [];
  try { names = fs.readdirSync(LOCK_DIR); } catch { return ''; }
  let running = 0;
  for (const n of names) {
    if (!re.test(n)) continue;
    const file = path.join(LOCK_DIR, n);
    const cur = readLock(file);
    if (!cur || lockIsStale(file, cur)) continue;
    if (peer === 'blender' && cur.gpu === false) continue;
    running++;
  }
  const s = (k) => (k > 1 ? 's' : '');
  if (running) {
    return name === 'capture'
      ? `paused: ${running} Blender GPU job${s(running)} running — captures wait while Blender uses the GPU (owner rule 2026-10-25, prevents GPU resets)`
      : `waiting for ${running} capture/browser job${s(running)} to finish — Blender GPU jobs start when the GPU is free of captures (owner rule 2026-10-25)`;
  }
  const earlier = waiters(peer).filter((t) => (peer !== 'blender' || t.gpu !== false) && ticketOrder(t, me) < 0).length;
  if (earlier) {
    return name === 'capture'
      ? `paused: ${earlier} earlier Blender GPU job${s(earlier)} queued — it goes first (owner rule 2026-10-25)`
      : `waiting: ${earlier} earlier capture job${s(earlier)} queued ahead (owner rule 2026-10-25)`;
  }
  return '';
}

/**
 * Acquire one of `slots` interchangeable slots named `${name}-<i>.lock` (slots=1 → an exclusive lock).
 * Resolves to a release() function (release.slot = index, release.file = lock path, release.update(fields) = atomically
 * add fields to the lock file, e.g. live status). Waits until a slot frees up; logs while waiting (with the reason).
 * Options: pollMs (first fallback poll; backs off ×1.5 to maxPollMs 15 s), waitMaxMs, quiet, extraBusy (async () =>
 * false | true | "reason": checked only when this waiter could otherwise take a free slot), staggerMs (family default
 * above), queue (true: FIFO with other r13+ waiters), signals (true: SIGINT/SIGTERM/SIGHUP release the slot and exit 130;
 * false: the caller handles signals itself). Family 'capture' without an extraBusy gets the memory gate
 * (tools/lib/memgate.mjs) unless memGate: false. info.holdOnly: true marks a slot taken only to keep others out (an
 * exclusive measurement's extra slots): no memory gate, no stagger, and the gate does not reserve memory for it.
 */
export async function acquire(name, { slots = 1, info = {}, pollMs = 3000, maxPollMs = 15000, waitMaxMs = 6 * 3600e3, quiet = false, extraBusy = null, staggerMs, queue = true, signals = true, memGate } = {}) {
  const t0 = Date.now();
  if (!extraBusy && name === 'capture' && memGate !== false && !info.holdOnly) {
    const { memGate: gate } = await import('./memgate.mjs');
    extraBusy = gate('capture', { prefix: '[locks]', quiet });
  }
  if (info.holdOnly) staggerMs = 0;
  if (staggerMs === undefined) { const f = FAMILY_STAGGER[name]; staggerMs = f ? num(process.env[f[0]], f[1]) : 0; }
  const slotFile = (i) => path.join(LOCK_DIR, `${name}-${i}.lock`);
  // queue ticket (FIFO among r13+ waiters); removed when we get a slot, give up, or exit
  let ticket = null;
  if (queue) {
    const me = { pid: process.pid, pidns: PID_NS, since: Date.now(), seq: ticketSeq++, what: info.what || '', owner: info.owner || '', ...(info.gpu === false ? { gpu: false } : {}) };
    const file = path.join(LOCK_DIR, `${name}-wait-${process.pid}-${me.seq}.ticket`);
    try { if (tryCreate(file, me)) ticket = { file, me, stopBeat: heartbeat(file) }; } catch { /* no ticket: wait unqueued (pre-r13 behaviour) */ }
  }
  const dropTicket = () => { if (!ticket) return; ticket.stopBeat(); try { fs.unlinkSync(ticket.file); } catch {} ticket = null; };
  process.once('exit', dropTicket);
  const watch = familyWatch(name);
  let lastLog = 0, interval = Math.max(100, pollMs), races = 0;
  try {
    for (;;) {
      // 1. cheap: which slots are free? (file reads + kill(pid, 0) only)
      const free = []; const holders = []; let mine = false, newest = 0;
      for (let i = 0; i < slots; i++) {
        const file = slotFile(i);
        const cur = readLock(file);
        if (!cur && ageMs(file) === Infinity) { free.push(i); continue; }
        if (lockIsStale(file, cur)) { free.push(i); continue; }
        if (!cur) continue; // being created right now
        holders.push(`${cur.pid}${cur.owner ? ' ' + cur.owner : ''}${cur.what ? ' (' + cur.what + ')' : ''}`);
        if (cur.pid === process.pid) mine = true;
        else if (!cur.holdOnly) newest = Math.max(newest, Date.parse(cur.started || 0) || 0);
      }
      let reason = '', sleepMs = interval;
      const claimant = holdsClaim(name);
      if (!free.length) reason = 'all slots busy';
      else if (wantedByOther(name)) reason = 'yielding to an exclusive (priority) request';
      else if (ticket && !claimant) {
        const q = waiters(name);
        const ahead = q.filter((t) => ticketOrder(t, ticket.me) < 0).length;
        if (ahead) reason = `queued, ${ahead} waiter${ahead > 1 ? 's' : ''} ahead`;
      }
      if (!reason && staggerMs > 0 && !mine && !claimant && newest && Date.now() - newest < staggerMs) {
        sleepMs = staggerMs - (Date.now() - newest) + 50;
        reason = `staggering starts: the last ${name} slot was granted ${((Date.now() - newest) / 1000).toFixed(1)} s ago (${staggerMs / 1000} s apart)`;
      }
      if (!reason && !info.holdOnly && GPU_PEER[name] && process.env.KCA_GPU_SHARE !== '1') {
        reason = gpuPeerBusy(name, ticket ? ticket.me : { since: t0, pid: process.pid, seq: -1 }, info);
      }
      if (!reason && extraBusy) {
        const busy = await extraBusy();
        if (busy) reason = typeof busy === 'string' ? busy : 'busy elsewhere (an unmanaged process)';
      }
      if (!reason) {
        for (const i of free) {
          const file = slotFile(i);
          const data = { pid: process.pid, pidns: PID_NS, started: new Date().toISOString(), cwd: process.cwd(), ...info };
          if (!tryCreate(file, data)) continue;
          dropTicket(); process.removeListener('exit', dropTicket); watch.close();
          return makeRelease(file, i, signals);
        }
        // lost the race (another process took it, or a stale file was just removed): re-check soon
        if (++races <= 3) continue;
        reason = 'slot taken by another process'; races = 0;
      }
      if (Date.now() - t0 > waitMaxMs) throw new Error(`timed out waiting for lock "${name}"`);
      if (!quiet && Date.now() - lastLog > 30000) {
        lastLog = Date.now();
        console.error(`[locks] waiting for "${name}" (${slots} slot${slots > 1 ? 's' : ''}; held by ${holders.join(', ') || '-'}; ${reason}) — ${Math.round((Date.now() - t0) / 1000)} s`);
      }
      // 2. sleep until a slot/queue change wakes us, or the (backed-off) poll fires
      const woke = await watch.wait(Math.max(50, Math.min(sleepMs, maxPollMs)));
      if (!woke) interval = Math.min(maxPollMs, Math.round(interval * 1.5));
    }
  } finally {
    watch.close();
    dropTicket(); process.removeListener('exit', dropTicket);
  }
}

function makeRelease(file, i, signals) {
  let released = false;
  const stopBeat = heartbeat(file);
  const release = () => {
    if (released) return; released = true; stopBeat();
    const cur = readLock(file);
    if (cur && cur.pid === process.pid) { try { fs.unlinkSync(file); } catch {} }
  };
  process.once('exit', release);
  if (signals) for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.once(sig, () => { release(); process.exit(130); });
  release.slot = i;
  release.file = file;
  /** Atomically merge fields into our lock file (tmp + rename: readers never see a partial file). */
  release.update = (fields) => {
    if (released) return false;
    const cur = readLock(file);
    if (!cur || cur.pid !== process.pid) return false;
    const tmp = path.join(LOCK_DIR, `.tmp-${process.pid}-${path.basename(file)}`);
    try { fs.writeFileSync(tmp, JSON.stringify({ ...cur, ...fields })); fs.renameSync(tmp, file); return true; } catch { try { fs.unlinkSync(tmp); } catch {} return false; }
  };
  return release;
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
