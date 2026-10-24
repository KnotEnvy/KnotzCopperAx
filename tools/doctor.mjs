#!/usr/bin/env node
// doctor — check that this machine can run the KnotzCopperAx toolchain, and clean up leftovers.
//
//   node tools/doctor.mjs              check everything (≈10 s): deps, GPU browser, ffmpeg, Blender + CUDA, dev server,
//                                      memory / swap / VRAM, Blender jobs (silent logs), queues, locks, stray processes
//   node tools/doctor.mjs --quick      skip the slow checks (GPU browser launch, Blender)
//   node tools/doctor.mjs --cleanup    also kill ORPHANED tool processes (a browser or Blender whose launching tool has
//                                      died) and remove stale lock files. Never touches live tool runs, the dev server,
//                                      or anything that isn't ours.
//   node tools/doctor.mjs --stop-display   stop the shared hidden X display (restarts on the next browser launch)
//
// Exit code 1 if a required check fails.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { IS_WIN, IS_WSL, KCA_HOST, KCA_PORT, blenderExe, runningBlenders, withLibPath, sandboxReason, SANDBOX_HELP, memState, gpuMem } from './lib/platform.mjs';
import { LOCK_DIR, lockIsStale } from './lib/locks.mjs';
import { blenderJobs, queue, STALL_MIN } from './lib/jobs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const quick = args.has('--quick');
let failed = 0;
const row = (ok, name, detail = '') => { if (ok === false) failed++; console.log(`${ok === true ? ' ok ' : ok === false ? 'FAIL' : 'warn'}  ${name.padEnd(22)} ${detail}`); };
const sh = (cmd, a, o = {}) => spawnSync(cmd, a, { encoding: 'utf8', ...o });

if (args.has('--stop-display')) {
  const { stopDisplay } = await import('./lib/xdisplay.mjs');
  const pid = stopDisplay();
  console.log(pid ? `stopped Xvfb (pid ${pid})` : 'no shared display running');
  process.exit(0);
}

console.log(`KnotzCopperAx doctor · ${IS_WIN ? 'Windows' : IS_WSL ? 'Linux (WSL2)' : 'Linux'} · ${os.cpus().length} threads · ${Math.round(os.totalmem() / 2 ** 30)} GB\n`);

const sandbox = sandboxReason();
if (sandbox) row(false, 'environment', `SANDBOXED: ${sandbox}. ${SANDBOX_HELP} Results below (server, locks, processes) are not trustworthy from here.`);

// ---- dependencies
row(Number(process.versions.node.split('.')[0]) >= 22, 'node', process.versions.node);
row(fs.existsSync(path.join(ROOT, 'node_modules/playwright')) && fs.existsSync(path.join(ROOT, 'node_modules/vite')), 'node_modules', 'run `npm install` if this fails');
if (!IS_WIN) {
  let chrome = null;
  try { chrome = (await import('playwright')).chromium.executablePath(); } catch {}
  if (!chrome || !fs.existsSync(chrome)) row(false, 'chromium', 'run `npx playwright install chromium`');
  else {
    const missing = (sh('ldd', [chrome], { env: withLibPath() }).stdout || '').split('\n').filter((l) => /not found/.test(l)).map((l) => l.trim().split(' ')[0]);
    row(!missing.length, 'chromium libs', missing.length ? `missing ${missing.join(', ')}: run \`sudo npx playwright install-deps chromium\`` : path.basename(path.dirname(path.dirname(chrome))));
  }
  row(!sh('which', ['Xvfb']).status, 'Xvfb', 'hidden display for GPU browsers (apt package xvfb)');
  { const { displayPid, DISPLAY_NUM } = await import('./lib/xdisplay.mjs'); const p = displayPid();
    row(p ? true : 'warn', 'shared display', p ? `:${DISPLAY_NUM} up${p > 0 ? ` (pid ${p})` : ' (pid unknown: lock file missing)'}` : `:${DISPLAY_NUM} not running (starts on the next browser launch)`); }
}
const ff = sh('ffmpeg', ['-hide_banner', '-encoders']);
row(ff.status === 0 && /libx264/.test(ff.stdout) ? true : 'warn', 'ffmpeg + libx264', ff.status === 0 ? (/libx264/.test(ff.stdout) ? 'MP4 clips ok' : 'no libx264: --mp4 fails') : 'not on PATH: capture --mp4 fails');

// ---- dev server
let serverOk = false;
try { serverOk = (await fetch(KCA_HOST + '/', { signal: AbortSignal.timeout(3000) })).ok; } catch {}
let serverDetail = serverOk ? KCA_HOST : `not running: start it with \`npm run dev\` (port ${KCA_PORT})`;
if (serverOk && !IS_WIN) {
  try { // is it THIS project's server?
    const pid = (sh('ss', ['-ltnpH', `sport = :${KCA_PORT}`]).stdout.match(/pid=(\d+)/) || [])[1];
    const cwd = pid && fs.realpathSync(`/proc/${pid}/cwd`);
    if (cwd && cwd !== fs.realpathSync(ROOT)) { serverOk = false; serverDetail = `port ${KCA_PORT} is used by ANOTHER project (${cwd}); set KCA_PORT`; }
    else if (pid) serverDetail += ` (pid ${pid})`;
  } catch {}
}
row(serverOk ? true : 'warn', 'dev server', serverDetail);

// ---- GPU browser
if (!quick) {
  // a browser like any other: it takes a capture slot (queue + memory gate), or is skipped when none frees up in 45 s
  let releaseSlot = null;
  try { const { acquire } = await import('./lib/locks.mjs'); releaseSlot = await acquire('capture', { slots: Number(process.env.KCA_CAPTURE_SLOTS || 6), info: { what: 'doctor GPU check' }, quiet: true, waitMaxMs: 45000 }); } catch {}
  if (!releaseSlot) row('warn', 'GPU browser', 'skipped: no free capture slot within 45 s (busy machine) — run doctor again later');
  else try {
    const { launchBrowser, gpuRenderer, isSoftwareRenderer } = await import('./lib/browser.mjs');
    const b = await launchBrowser({ tool: 'doctor' });
    const p = await b.newPage();
    const r = await gpuRenderer(p);
    const timer = await p.evaluate(() => !!document.createElement('canvas').getContext('webgl2')?.getExtension('EXT_disjoint_timer_query_webgl2'));
    await b.close();
    row(!isSoftwareRenderer(r), 'GPU browser', r);
    row(timer ? true : 'warn', 'GPU timer queries', timer ? 'perfbench GPU timing available' : 'missing: perfbench can only report budgets');
  } catch (e) { row(false, 'GPU browser', e.message.split('\n')[0]); }
  finally { if (releaseSlot) releaseSlot(); }
}

// ---- Blender (two short Blender runs outside the wrapper: skipped while the machine is at the owner's 3-Blender cap)
if (!quick && runningBlenders().length >= 3) row('warn', 'blender', 'check skipped: 3 Blenders already running (owner cap) — run doctor again later');
else if (!quick) {
  const exe = blenderExe();
  const v = sh(exe, ['--version'], { env: withLibPath() });
  if (v.status !== 0) row(false, 'blender', `${exe} not runnable (set BLENDER_EXE)`);
  else {
    row(true, 'blender', `${(v.stdout.split('\n')[0] || '').trim()} · ${exe}`);
    const probe = 'import bpy\np=bpy.context.preferences.addons["cycles"].preferences\nfor t in ("OPTIX","CUDA"):\n  try:\n    p.compute_device_type=t; p.refresh_devices(); print("KCADEV", t, [d.name for d in p.devices if d.type==t])\n  except Exception as e: print("KCADEV", t, [])';
    const d = sh(exe, ['-b', '--factory-startup', '--python-expr', probe], { env: withLibPath(), timeout: 120000 });
    const devs = Object.fromEntries((d.stdout || '').split('\n').filter((l) => l.startsWith('KCADEV')).map((l) => [l.split(' ')[1], l.slice(l.indexOf('[')).trim()]));
    const cuda = devs.CUDA && devs.CUDA !== '[]';
    row(cuda ? true : 'warn', 'blender GPU bakes', `CUDA ${devs.CUDA || '?'} · OptiX ${devs.OPTIX || '?'}${IS_WSL ? ' (wrapper forces CUDA on WSL2)' : ''}`);
  }
}

// ---- memory, Blender jobs, queues (C2 r13: the 23 Oct overload — swap full, 4 h bakes, agents disconnected)
{
  const m = memState(); const g = gpuMem();
  const gb = (mb) => (mb / 1024).toFixed(1);
  if (Number.isFinite(m.availMB)) {
    const swapPct = m.swapTotalMB ? m.swapUsedMB / m.swapTotalMB : 0;
    const bad = m.availMB < 4000 || swapPct > 0.5 || (m.psi && m.psiSome10 >= 10);
    row(bad ? 'warn' : true, 'memory', `${gb(m.availMB)} of ${gb(m.totalMB)} GB available · swap ${gb(m.swapUsedMB)}/${gb(m.swapTotalMB)} GB${m.psi ? ` · pressure ${m.psiSome10} %` : ''}${g ? ` · VRAM ${gb(g.usedMB)}/${gb(g.totalMB)} GB` : ''}${bad ? ' — new Blender/capture jobs will wait (tools/lib/memgate.mjs)' : ''}`);
  }
  const jobs = blenderJobs(3);
  for (const j of jobs) {
    const silent = j.lastOutputMinAgo;
    const where = j.alive ? '' : ' [STALE LOCK]';
    row(j.stalled ? 'warn' : true, `blender slot ${j.slot}`, `${j.owner || '?'} "${j.what || ''}" · wrapper ${j.pid} · ${Math.round(j.runtimeMin)} min${j.childPid ? ` · blender ${j.childPid}${j.rssMB != null ? ` ${gb(j.rssMB)} GB (peak ${gb(j.peakRssMB)}, expected ${gb(j.expectedPeakMB)})` : ' (gone)'}` : ''}${silent != null ? ` · last output ${silent < 1 ? '<1' : Math.round(silent)} min ago` : ' · no log'}${j.launcherGone ? ' · its launching session is gone' : ''}${j.stalled ? ` — SILENT > ${STALL_MIN} min: probably stalled; tell its owner (docs/notes/_coord-C2.md), never kill another team's job` : ''}${where}`);
  }
  const silentOnes = jobs.filter((j) => j.stalled && j.alive);
  if (silentOnes.length) row('warn', 'silent Blender logs', silentOnes.map((j) => `wrapper ${j.pid} (blender ${j.childPid || '?'}, ${j.owner || '?'}) silent ${Math.round(j.lastOutputMinAgo)} min`).join('; ') + ' — the wrapper writes a STALL line into its log; --cleanup never stops a live wrapper');
  const qb = queue('blender'), qc = queue('capture');
  if (qb.length || qc.length) row(true, 'queues', `blender ${qb.length} waiting${qb.length ? ` (oldest ${Math.round(qb[0].waitingMin)} min: ${qb[0].owner || qb[0].pid})` : ''} · capture ${qc.length} waiting`);
}

// GPU resets (Windows TDR: one piece of GPU work > 2 s) in the last 24 h. Each one breaks every browser on the GPU: lost
// WebGL contexts, striped screenshots, SwiftShader for browsers started right after (C2 r13, tools/capture.mjs flags them).
if (IS_WSL && !quick) {
  const ps = sh('powershell.exe', ['-NoProfile', '-Command', "Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='nvlddmkm'; StartTime=(Get-Date).AddHours(-24)} -ErrorAction SilentlyContinue | ForEach-Object { $_.TimeCreated.ToString('s') }"], { timeout: 30000 });
  if (ps.status === 0) {
    // the driver logs 2-3 events per reset, a few seconds apart: count resets, not events
    const ts = (ps.stdout || '').split(/\r?\n/).map((s) => Date.parse(s.trim())).filter(Number.isFinite).sort((a, b) => a - b);
    const resets = ts.filter((t, i) => i === 0 || t - ts[i - 1] > 30000);
    const last = resets.length ? new Date(resets[resets.length - 1]) : null;
    row(resets.length ? 'warn' : true, 'GPU resets (24 h)', resets.length ? `${resets.length} (last ${last.toTimeString().slice(0, 5)}, Windows nvlddmkm 153 / TDR): captures running at that moment are broken — rerun them` : 'none');
  }
}

// ---- locks + strays
const locks = fs.existsSync(LOCK_DIR) ? fs.readdirSync(LOCK_DIR).filter((f) => /\.(lock|want|child|ticket)$/.test(f) || f.startsWith('.tmp-')) : [];
const stale = [];
for (const f of locks) {
  const file = path.join(LOCK_DIR, f);
  let stale1;
  // a .child file (Blender PID) belongs to its wrapper's lock: stale when that lock is gone
  if (f.endsWith('.child')) stale1 = !fs.existsSync(path.join(LOCK_DIR, f.replace(/\.child$/, '.lock')));
  else if (f.startsWith('.tmp-')) { try { stale1 = Date.now() - fs.statSync(file).mtimeMs > 60000; } catch { stale1 = false; } } // a lock update interrupted mid-write
  else stale1 = lockIsStale(file);
  if (stale1) stale.push(f);
}
const nTickets = locks.filter((f) => f.endsWith('.ticket') && !stale.includes(f)).length;
row(stale.length ? 'warn' : true, 'locks', `${locks.length - stale.length - nTickets} held${nTickets ? `, ${nTickets} waiting` : ''}${stale.length ? `, ${stale.length} stale (${stale.join(', ')})` : ''}`);

// Orphans (Linux): a tool browser (main process, carries --kca-tool=) or Blender whose parent is no longer a node tool.
const orphans = [];
if (!IS_WIN) {
  const ps = sh('ps', ['-eo', 'pid=,ppid=,etimes=,args=']).stdout.split('\n').map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean)
    .map(([, pid, ppid, et, cmd]) => ({ pid: +pid, ppid: +ppid, age: +et, cmd }));
  const byPid = new Map(ps.map((p) => [p.pid, p]));
  const isNodeTool = (p) => p && /\bnode\b/.test(p.cmd) && /tools\//.test(p.cmd);
  const blenders = new Set(runningBlenders()); // once (it used to spawn one pgrep per process on the machine)
  for (const p of ps) {
    const browserMain = /--kca-tool=/.test(p.cmd) && !/--type=/.test(p.cmd);
    const blender = blenders.has(p.pid);
    if (!browserMain && !blender) continue;
    if (!isNodeTool(byPid.get(p.ppid))) orphans.push({ ...p, kind: browserMain ? `browser ${(p.cmd.match(/--kca-tool=(\S+)/) || [])[1]}` : 'blender' });
  }
  const live = ps.filter((p) => /--kca-tool=/.test(p.cmd) && !/--type=/.test(p.cmd)).length;
  row(orphans.length ? 'warn' : true, 'tool processes', `${live} browser(s), ${blenders.size} blender(s) running${orphans.length ? `; ORPHANED: ${orphans.map((o) => `${o.kind} pid ${o.pid} (${Math.round(o.age / 60)} min)`).join(', ')}` : ''}`);
}

if (args.has('--cleanup') && sandbox) console.log('\ncleanup skipped: sandboxed processes cannot judge other agents\' locks');
else if (args.has('--cleanup')) {
  for (const f of stale) { try { fs.unlinkSync(path.join(LOCK_DIR, f)); } catch {} }
  for (const o of orphans) {
    // the whole process group of a browser (GPU / renderer children) — they were all started by the dead tool
    try { process.kill(-o.pid, 'SIGTERM'); } catch { try { process.kill(o.pid, 'SIGTERM'); } catch {} }
  }
  console.log(`\ncleanup: removed ${stale.length} stale lock(s), stopped ${orphans.length} orphaned process(es)`);
} else if (stale.length || orphans.length) console.log('\nrun with --cleanup to remove stale locks and stop orphaned tool processes');

process.exit(failed ? 1 : 0);
