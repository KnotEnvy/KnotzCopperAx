#!/usr/bin/env node
// doctor — check that this machine can run the KnotzCopperAx toolchain, and clean up leftovers.
//
//   node tools/doctor.mjs              check everything (≈10 s): deps, GPU browser, ffmpeg, Blender + CUDA, dev server,
//                                      locks, stray processes
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
import { IS_WIN, IS_WSL, KCA_HOST, KCA_PORT, blenderExe, runningBlenders, withLibPath, sandboxReason, SANDBOX_HELP } from './lib/platform.mjs';
import { LOCK_DIR, lockIsStale } from './lib/locks.mjs';

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
  try {
    const { launchBrowser, gpuRenderer, isSoftwareRenderer } = await import('./lib/browser.mjs');
    const b = await launchBrowser({ tool: 'doctor' });
    const p = await b.newPage();
    const r = await gpuRenderer(p);
    const timer = await p.evaluate(() => !!document.createElement('canvas').getContext('webgl2')?.getExtension('EXT_disjoint_timer_query_webgl2'));
    await b.close();
    row(!isSoftwareRenderer(r), 'GPU browser', r);
    row(timer ? true : 'warn', 'GPU timer queries', timer ? 'perfbench GPU timing available' : 'missing: perfbench can only report budgets');
  } catch (e) { row(false, 'GPU browser', e.message.split('\n')[0]); }
}

// ---- Blender
if (!quick) {
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

// ---- locks + strays
const locks = fs.existsSync(LOCK_DIR) ? fs.readdirSync(LOCK_DIR).filter((f) => /\.(lock|want|child)$/.test(f)) : [];
const stale = [];
for (const f of locks) {
  // a .child file (Blender PID) belongs to its wrapper's lock: stale when that lock is gone
  const stale1 = f.endsWith('.child') ? !fs.existsSync(path.join(LOCK_DIR, f.replace(/\.child$/, '.lock'))) : lockIsStale(path.join(LOCK_DIR, f));
  if (stale1) stale.push(f);
}
row(stale.length ? 'warn' : true, 'locks', `${locks.length - stale.length} held${stale.length ? `, ${stale.length} stale (${stale.join(', ')})` : ''}`);

// Orphans (Linux): a tool browser (main process, carries --kca-tool=) or Blender whose parent is no longer a node tool.
const orphans = [];
if (!IS_WIN) {
  const ps = sh('ps', ['-eo', 'pid=,ppid=,etimes=,args=']).stdout.split('\n').map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean)
    .map(([, pid, ppid, et, cmd]) => ({ pid: +pid, ppid: +ppid, age: +et, cmd }));
  const byPid = new Map(ps.map((p) => [p.pid, p]));
  const isNodeTool = (p) => p && /\bnode\b/.test(p.cmd) && /tools\//.test(p.cmd);
  for (const p of ps) {
    const browserMain = /--kca-tool=/.test(p.cmd) && !/--type=/.test(p.cmd);
    const blender = new Set(runningBlenders()).has(p.pid);
    if (!browserMain && !blender) continue;
    if (!isNodeTool(byPid.get(p.ppid))) orphans.push({ ...p, kind: browserMain ? `browser ${(p.cmd.match(/--kca-tool=(\S+)/) || [])[1]}` : 'blender' });
  }
  const live = ps.filter((p) => /--kca-tool=/.test(p.cmd) && !/--type=/.test(p.cmd)).length;
  row(orphans.length ? 'warn' : true, 'tool processes', `${live} browser(s), ${runningBlenders().length} blender(s) running${orphans.length ? `; ORPHANED: ${orphans.map((o) => `${o.kind} pid ${o.pid} (${Math.round(o.age / 60)} min)`).join(', ')}` : ''}`);
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
