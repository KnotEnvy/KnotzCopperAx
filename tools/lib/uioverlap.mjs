// UI text-overlap detector (ui-flow r5). Collects the bounding box of every VISIBLE text item on the page — real text
// nodes (Range rects), SVG <text>, and forged lettering (`.forge[aria-label]`) — and reports pairs that intersect, plus
// text that leaves the viewport. Catches the defect class "a toast / stamp / debug label sits on top of other copy".
//   import { COLLECT, analyse } from '../lib/uioverlap.mjs';
//   const items = await page.evaluate(COLLECT);   const { overlaps, offscreen } = analyse(items);
// Exemption: put `data-overlap-ok` on an element (or ancestor) whose text is allowed to sit on top of other text
// (e.g. a deliberate ghost/echo layer). Nothing in the shipped UI should need it.

/** Runs INSIDE the page (self-contained; no closures). Async: forged lettering is measured by its INK (alpha bbox of the
 *  rasterised glyph image), because the <img>/<span> box carries large glow/rim padding. Returns [{ text, cls, l, t, r, b, w, h }]. */
export const COLLECT = async () => {
  const out = [];
  const vis = (el) => {
    let op = 1;
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      op *= parseFloat(cs.opacity);
      if (e.hasAttribute && e.hasAttribute('data-overlap-ok')) return false;
    }
    return op > 0.2;
  };
  const clsOf = (el) => {
    const parts = [];
    for (let e = el, n = 0; e && e !== document.body && n < 3; e = e.parentElement, n++) parts.push(e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : ''));
    return parts.join(' < ');
  };
  const push = (text, el, rc) => {
    if (rc.width < 2 || rc.height < 2) return;
    out.push({ text: String(text).replace(/\s+/g, ' ').trim().slice(0, 60), cls: clsOf(el), l: rc.left, t: rc.top, r: rc.right, b: rc.bottom, w: rc.width, h: rc.height });
  };
  // forged lettering (ink bbox)
  const inkCache = new Map();
  const ink = async (f) => {
    const rc = f.getBoundingClientRect(), img = f.tagName === 'IMG' ? f : f.querySelector('img');
    if (!img || !img.src) return rc;
    let box = inkCache.get(img.src);
    if (!box) {
      box = [0, 0, 1, 1];
      try {
        if (!img.complete || !img.naturalWidth) await img.decode();
        const cw = 512, ch = Math.max(8, Math.round(cw * (img.naturalHeight / img.naturalWidth)));
        const c = document.createElement('canvas'); c.width = cw; c.height = ch;
        const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, cw, ch);
        const d = g.getImageData(0, 0, cw, ch).data;
        let x0 = cw, y0 = ch, x1 = -1, y1 = -1;
        for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (d[(y * cw + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        if (x1 >= 0) box = [x0 / cw, y0 / ch, (x1 + 1) / cw, (y1 + 1) / ch];
      } catch (e) { /* tainted/undecodable: fall back to the full box */ }
      inkCache.set(img.src, box);
    }
    return { left: rc.left + rc.width * box[0], top: rc.top + rc.height * box[1], right: rc.left + rc.width * box[2], bottom: rc.top + rc.height * box[3], width: rc.width * (box[2] - box[0]), height: rc.height * (box[3] - box[1]) };
  };
  for (const f of document.querySelectorAll('.forge[aria-label]')) if (vis(f) && !f.closest('.kca-sr')) push(f.getAttribute('aria-label'), f, await ink(f));
  // text nodes (skip anything inside a forge, scripts, styles, canvas)
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const s = n.nodeValue;
    if (!s || !s.trim()) continue;
    const el = n.parentElement;
    if (!el || /^(SCRIPT|STYLE|TITLE|NOSCRIPT)$/i.test(el.tagName) || el.closest('.forge, canvas, .kca-sr')) continue;
    if (!vis(el)) continue;
    range.selectNodeContents(n);
    // one rect per wrapped line (a wrapped paragraph's union box would swallow its neighbours)
    for (const rc of range.getClientRects()) push(s, el, rc);
  }
  return out;
};

/** Node-side analysis. opts.tol: min overlap in px on x; opts.tolY: fraction of the shorter box's height on y. */
export function analyse(items, { width = 1600, height = 900, tol = 2, tolY = 0.3, edge = 2 } = {}) {
  const overlaps = [], offscreen = [];
  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    if (a.l < -edge || a.t < -edge || a.r > width + edge || a.b > height + edge) offscreen.push(a);
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j];
      const ix = Math.min(a.r, b.r) - Math.max(a.l, b.l);
      const iy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
      if (ix > tol && iy > Math.min(a.h, b.h) * tolY) overlaps.push({ a, b, ix: +ix.toFixed(1), iy: +iy.toFixed(1) });
    }
  }
  return { overlaps, offscreen, count: items.length };
}

const short = (i) => `"${i.text}" [${i.cls}] (${Math.round(i.l)},${Math.round(i.t)} ${Math.round(i.w)}x${Math.round(i.h)})`;
export const describe = (res) => [
  ...res.overlaps.map((o) => `OVERLAP ${o.ix}x${o.iy}px: ${short(o.a)}  ×  ${short(o.b)}`),
  ...res.offscreen.map((o) => `OFFSCREEN: ${short(o)}`),
];

/** One-call helper for a Playwright page. Returns { pass, count, problems[] }. */
export async function checkPage(page, opts = {}) {
  const vp = page.viewportSize() || { width: 1600, height: 900 };
  const items = await page.evaluate(COLLECT);
  const res = analyse(items, { width: vp.width, height: vp.height, ...opts });
  const problems = describe(res);
  return { pass: problems.length === 0, count: res.count, problems };
}

/** r6 settle rule: CSS transitions/animations run on the WALL clock (the capture clock only drives rAF), so wait until every
 *  FINITE CSS animation/transition in the page has finished (infinite loops like the PRESS START pulse are ignored), then 150 ms. */
export async function settleCss(page, maxLoops = 40) {
  await page.evaluate(async (maxLoops) => {
    // r7: baked art images (map relief, desk) must be decoded before a shot, then their opacity transition finishes below
    await Promise.race([Promise.all([...document.images].filter((i) => !i.complete).map((i) => new Promise((r) => { i.addEventListener('load', r); i.addEventListener('error', r); }))), new Promise((r) => setTimeout(r, 8000))]);
    await new Promise((r) => setTimeout(r, 60));
    const fin = () => document.getAnimations().filter((a) => a.effect && a.effect.getComputedTiming().iterations !== Infinity && a.playState === 'running');
    for (let i = 0; i < maxLoops && fin().length; i++) await Promise.all(fin().map((a) => a.finished.catch(() => {})));
    await new Promise((r) => setTimeout(r, 150));
  }, maxLoops);
}
