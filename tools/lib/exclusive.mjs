// perf-1650 r4: hold EVERY other capture slot so a real-time measurement runs with no other headless game on the
// shared GPU. capture.mjs already holds one slot; this takes the remaining (KCA_CAPTURE_SLOTS − 1), waiting for
// the other agents' captures to finish (max PB_EXCL_WAIT s per slot, default 900). Returns release() or null on failure.
import { acquire, claimPriority } from './locks.mjs';

export async function takeOtherSlots(what = 'exclusive') {
  const slots = Number(process.env.KCA_CAPTURE_SLOTS || 6), rel = [];
  let unclaim = null;
  try {
    // priority claim: other captures started from now on leave the free slots to us, so the running ones drain
    unclaim = await claimPriority('capture', { info: { what, owner: 'perf-1650' } });
    for (let i = 1; i < slots; i++) rel.push(await acquire('capture', { slots, waitMaxMs: Number(process.env.PB_EXCL_WAIT || 900) * 1000, info: { what: `${what} (slot ${i + 1}/${slots})`, owner: 'perf-1650' } }));
    unclaim(); // all slots are ours now
    return () => { for (const r of rel) r(); };
  } catch (e) { for (const r of rel) r(); if (unclaim) unclaim(); console.log('[exclusive] not taken: ' + e.message); return null; }
}

/**
 * Raise every process of this page's browser (browser, GPU, renderers) to ABOVE_NORMAL for a real-time measurement. The
 * shared laptop has 8 logical CPUs and a Blender build (34 threads) + several agents' node/Claude processes keep them
 * saturated; a normal-priority renderer / GPU main thread then misses whole seconds (bench S5 combat: one 2.6 s rAF gap with
 * 20 ms of JS, exclusive capture slots, no program / texture / GC event). perfbench already does this for its own browsers.
 */
export async function boostBrowser(page) {
  try {
    const os = await import('node:os');
    const cdp = await page.context().browser().newBrowserCDPSession();
    const info = await cdp.send('SystemInfo.getProcessInfo');
    let n = 0;
    for (const p of info.processInfo) { try { os.setPriority(p.id, os.constants.priority.PRIORITY_ABOVE_NORMAL); n++; } catch (e) { /* not ours / denied */ } }
    return n;
  } catch (e) { return 0; }
}
