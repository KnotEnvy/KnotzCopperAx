// One way to launch a GPU browser for every KnotzCopperAx tool (capture, perfbench, scenarios, audits).
//
//   import { launchBrowser, gpuRenderer } from './lib/browser.mjs';
//   const browser = await launchBrowser({ args: ['--autoplay-policy=no-user-gesture-required'] });
//
// Windows: headless Edge on ANGLE/D3D11 (the original laptop setup).
// Linux / WSL2: Playwright's Chromium, HEADED on the shared hidden Xvfb display (tools/lib/xdisplay.mjs). Headless
//   Chromium can't reach the GPU on WSL2 and silently falls back to SwiftShader (CPU), which is useless for judging
//   visuals or performance. Headed on X it renders through ANGLE → OpenGL → Mesa d3d12 → the real NVIDIA GPU.
//   Nothing appears on screen.
// gpu: false → plain headless (no GPU needed, e.g. audio rendering).
// Each browser gets a `--kca-tool=<name>` marker so `node tools/doctor.mjs` can find strays.
//
// GPU resets (C2 r13): Windows resets the GPU when one piece of GPU work runs > 2 s (TDR: System log nvlddmkm 153 +
// LiveKernelEvent 141; 2026-10-23: 21 resets, also one at 00:10 on the quiet 24th). The 17 captures started 02:25-02:31 on
// the 23rd, right after one, all came up on SwiftShader (CPU); running pages lose their WebGL context or read back striped
// garbage (tools/capture.mjs flags both). So on Linux a GPU launch now checks the renderer on a blank page and, if it is a CPU
// fallback, closes the browser, waits (20 / 40 / 60 s) and relaunches (KCA_GPU_RETRIES, default 3; 0 = off). The last
// attempt is returned as is — callers still flag a CPU renderer. --disable-gpu-process-crash-limit keeps Chromium
// retrying the real GPU after a reset instead of switching a running browser to SwiftShader for good.
import path from 'node:path';
import { chromium } from 'playwright';
import { IS_WIN, IS_WSL, withLibPath } from './platform.mjs';
import { ensureDisplay } from './xdisplay.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const closeCapped = (b) => Promise.race([b.close().catch(() => {}), sleep(15000)]);
/** Renderer string of a fresh blank page in this browser (closed again). */
async function probeRenderer(browser) {
  let ctx = null;
  try { ctx = await browser.newContext(); return await gpuRenderer(await ctx.newPage()); }
  catch (e) { return 'unknown (' + String(e && e.message || e).split('\n')[0] + ')'; }
  finally { if (ctx) await Promise.race([ctx.close().catch(() => {}), sleep(10000)]); }
}

// Every browser shares one display, so windows overlap. Without these Chromium treats covered windows as hidden and
// throttles their rAF / timers, which would freeze captures and skew perf numbers.
const NO_THROTTLE = ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];

export async function launchBrowser({ args = [], gpu = true, tool = path.basename(process.argv[1] || 'kca', '.mjs'), ...rest } = {}) {
  const marker = `--kca-tool=${tool}`;
  if (IS_WIN) {
    return chromium.launch({ headless: true, channel: 'msedge', ...rest,
      args: [...(gpu ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : []), ...NO_THROTTLE, ...args, marker] });
  }
  const env = withLibPath(rest.env || process.env);
  // Chromium's singleton socket lives in TMPDIR and must fit a 108-byte unix socket path; some agent harnesses
  // (Antigravity) set a long per-session TMPDIR, which makes Chromium abort with "Socket path too long".
  if (env.TMPDIR && env.TMPDIR.length > 60) env.TMPDIR = '/tmp';
  if (!gpu) return chromium.launch({ headless: true, ...rest, env, args: [...NO_THROTTLE, ...args, marker] });
  env.DISPLAY = await ensureDisplay();
  delete env.WAYLAND_DISPLAY; // force X11 on the hidden display, never the user's WSLg desktop
  if (IS_WSL) { env.GALLIUM_DRIVER = 'd3d12'; env.MESA_D3D12_DEFAULT_ADAPTER_NAME ||= 'NVIDIA'; }
  const launch = () => chromium.launch({ ...rest, headless: false, env,
    args: ['--ozone-platform=x11', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-process-crash-limit', '--window-position=0,0', ...NO_THROTTLE, ...args, marker] });
  const retries = Math.max(0, Number(process.env.KCA_GPU_RETRIES ?? 3) || 0);
  let browser = await launch();
  for (let attempt = 1; attempt <= retries; attempt++) {
    const r = await probeRenderer(browser);
    if (!isSoftwareRenderer(r)) break;
    const wait = 20 * attempt;
    console.error(`[browser] ${tool}: the GPU browser came up on a CPU renderer (${r}) — usually just after a GPU reset (Windows TDR). Relaunching in ${wait} s (${attempt}/${retries}).`);
    await closeCapped(browser);
    await sleep(wait * 1000);
    browser = await launch();
  }
  return browser;
}

/** WebGL renderer string of a page, e.g. "ANGLE (Microsoft Corporation, D3D12 (NVIDIA GeForce RTX 5070), OpenGL 4.6)". */
export async function gpuRenderer(page) {
  try {
    return await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return 'NO WEBGL2';
      const e = gl.getExtension('WEBGL_debug_renderer_info');
      return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    });
  } catch (e) { return 'unknown (' + e.message.split('\n')[0] + ')'; }
}

/** True when the renderer is a CPU fallback (SwiftShader / llvmpipe): captures look wrong and perf numbers are meaningless. */
export const isSoftwareRenderer = (r) => /swiftshader|llvmpipe|softpipe|software/i.test(String(r));
