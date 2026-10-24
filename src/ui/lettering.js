// Forged lettering — the KnotzCopperAx display face, drawn as vector strokes (no font files, crisp at any size).
// Chiselled Roman capitals on a 100-unit cap height: heavy stems, thin bars, octagonal "hammered" rounds, flat
// clipped apexes and wedge serifs. Rendered to inline SVG with a metal gradient, an embossed bevel
// (feSpecularLighting), a dark forged rim and an optional travelling glint.
//
//   forge('GAME OVER', { metal: 'gold', height: 120, track: 10, glint: true, className: 'x' }) → '<svg …>'
//   metals: copper | gold | bronze | ivory | iron | ember | p1 | p2        measure(text, track) → width in units
const S = 16, R = 14, M = 12, T = 9;
const V = (x, y0 = 0, y1 = 100) => [S, [[x, y0], [x, y1]]];
const ser = (...xs) => xs.map((x) => (Array.isArray(x) ? x : [x, 100]));

/** Glyphs: [advanceWidth, strokes[[width, points]], serifs[[x, y(0|100)]]] */
const G = {
  A: [80, [[R, [[4, 106], [40, -8], [76, 106]]], [T, [[20, 68], [60, 68]]]], ser(4, 76)],
  B: [68, [V(9), [M, [[9, 6], [46, 6], [58, 17], [58, 38], [48, 48], [9, 48]]], [M, [[9, 48], [50, 48], [63, 59], [63, 83], [52, 94], [9, 94]]]], ser([9, 0], 9)],
  C: [70, [[R, [[67, 22], [54, 7], [19, 7], [7, 19], [7, 81], [19, 93], [54, 93], [67, 78]]]], []],
  D: [74, [V(9), [R, [[9, 7], [46, 7], [66, 26], [66, 74], [46, 93], [9, 93]]]], ser([9, 0], 9)],
  E: [62, [V(9), [T, [[9, 4.5], [58, 4.5]]], [T, [[9, 49], [46, 49]]], [T, [[9, 95.5], [60, 95.5]]], [T, [[57, 0], [57, 18]]], [T, [[59, 82], [59, 100]]]], ser([9, 0], 9)],
  F: [60, [V(9), [T, [[9, 4.5], [56, 4.5]]], [T, [[9, 50], [46, 50]]], [T, [[55, 0], [55, 18]]]], ser([9, 0], 9)],
  G: [74, [[R, [[67, 22], [54, 7], [19, 7], [7, 19], [7, 81], [19, 93], [54, 93], [66, 82], [66, 54]]], [T, [[40, 56], [72, 56]]]], []],
  H: [76, [V(9), V(66), [T, [[9, 50], [66, 50]]]], ser([9, 0], [66, 0], 9, 66)],
  I: [32, [V(16)], ser([16, 0], 16)],
  J: [50, [[S, [[38, 0], [38, 80], [25, 93], [6, 93]]]], ser([38, 0])],
  K: [72, [V(9), [R, [[11, 60], [66, -4]]], [R, [[30, 40], [70, 104]]]], ser([9, 0], 9, [64, 0], 68)],
  L: [60, [V(9), [T, [[9, 95.5], [60, 95.5]]], [T, [[58, 82], [58, 100]]]], ser([9, 0])],
  M: [90, [V(8), V(82), [R, [[10, -6], [45, 84], [80, -6]]]], ser(8, 82)],
  N: [76, [V(9), V(67), [R, [[9, -8], [67, 108]]]], ser(9, [67, 0])],
  O: [78, [[R, [[21, 7], [57, 7], [71, 21], [71, 79], [57, 93], [21, 93], [7, 79], [7, 21], [21, 7]]]], []],
  P: [66, [V(9), [M, [[9, 6], [46, 6], [60, 19], [60, 42], [47, 55], [9, 55]]]], ser([9, 0], 9)],
  Q: [78, [[R, [[21, 7], [57, 7], [71, 21], [71, 79], [57, 93], [21, 93], [7, 79], [7, 21], [21, 7]]], [R, [[44, 76], [74, 108]]]], []],
  R: [72, [V(9), [M, [[9, 6], [46, 6], [60, 19], [60, 42], [47, 55], [9, 55]]], [R, [[34, 55], [68, 104]]]], ser([9, 0], 9, 68)],
  S: [64, [[R, [[58, 20], [46, 7], [17, 7], [6, 18], [6, 38], [17, 48], [46, 52], [57, 63], [57, 82], [46, 93], [15, 93], [4, 80]]]], []],
  T: [72, [V(36), [T, [[0, 4.5], [72, 4.5]]], [T, [[3, 0], [3, 18]]], [T, [[69, 0], [69, 18]]]], ser(36)],
  U: [76, [[S, [[9, 0], [9, 78], [23, 92], [53, 92], [67, 78], [67, 0]]]], ser([9, 0], [67, 0])],
  V: [80, [[R, [[3, -8], [40, 108], [77, -8]]]], ser([5, 0], [75, 0])],
  W: [108, [[R, [[2, -8], [28, 108], [54, 18], [80, 108], [106, -8]]]], ser([4, 0], [104, 0])],
  X: [76, [[R, [[6, -4], [70, 104]]], [R, [[70, -4], [6, 104]]]], ser([6, 0], [70, 0], 6, 70)],
  Y: [76, [[R, [[5, -6], [38, 52], [71, -6]]], V(38, 50, 100)], ser([6, 0], [70, 0], 38)],
  Z: [66, [[T, [[4, 4.5], [62, 4.5]]], [R, [[59, 8], [7, 92]]], [T, [[4, 95.5], [64, 95.5]]], [T, [[5, 0], [5, 18]]], [T, [[63, 82], [63, 100]]]], []],
  0: [68, [[R, [[19, 7], [49, 7], [61, 19], [61, 81], [49, 93], [19, 93], [7, 81], [7, 19], [19, 7]]]], []],
  1: [46, [V(27), [T, [[27, 6], [9, 22]]], [T, [[8, 95.5], [46, 95.5]]]], []],
  2: [64, [[R, [[6, 22], [18, 7], [45, 7], [57, 19], [57, 40], [11, 92], [62, 92]]]], []],
  3: [64, [[R, [[6, 19], [18, 7], [45, 7], [57, 19], [57, 37], [45, 49], [24, 49]]], [R, [[44, 49], [58, 61], [58, 81], [46, 93], [18, 93], [5, 81]]]], []],
  4: [66, [V(46), [R, [[46, 6], [6, 70], [64, 70]]]], ser(46)],
  5: [64, [[R, [[57, 7], [11, 7], [9, 47], [45, 45], [58, 57], [58, 81], [46, 93], [18, 93], [5, 82]]]], []],
  6: [64, [[R, [[53, 12], [41, 7], [19, 7], [7, 20], [7, 80], [19, 93], [46, 93], [58, 81], [58, 58], [46, 47], [19, 47], [7, 56]]]], []],
  7: [62, [[R, [[4, 7], [57, 7], [24, 106]]]], []],
  8: [64, [[R, [[18, 7], [46, 7], [56, 17], [56, 38], [46, 48], [18, 48], [8, 38], [8, 17], [18, 7]]], [R, [[16, 48], [48, 48], [59, 59], [59, 82], [48, 93], [16, 93], [5, 82], [5, 59], [16, 48]]]], []],
  9: [64, [[R, [[10, 88], [22, 93], [45, 93], [57, 80], [57, 20], [45, 7], [18, 7], [6, 19], [6, 42], [18, 53], [45, 53], [57, 44]]]], []],
  ' ': [34, [], []],
  '-': [40, [[M, [[5, 58], [35, 58]]]], []],
  '—': [76, [[M, [[4, 58], [72, 58]]]], []],
  '.': [26, [[S, [[13, 84], [13, 100]]]], []],
  ',': [26, [[S, [[14, 84], [14, 100]]], [T, [[16, 98], [8, 112]]]], []],
  ':': [26, [[S, [[13, 36], [13, 52]]], [S, [[13, 84], [13, 100]]]], []],
  '!': [30, [[S, [[15, 0], [15, 66]]], [S, [[15, 84], [15, 100]]]], []],
  '?': [60, [[R, [[5, 20], [17, 7], [42, 7], [54, 19], [54, 36], [30, 54], [30, 70]]], [S, [[30, 84], [30, 100]]]], []],
  "'": [24, [[S, [[12, 0], [12, 30]]]], []],
  '+': [60, [[T, [[30, 32], [30, 84]]], [T, [[6, 58], [54, 58]]]], []],
  '/': [50, [[R, [[46, -4], [4, 104]]]], []],
  '×': [56, [[R, [[10, 36], [46, 84]]], [R, [[46, 36], [10, 84]]]], []],
  '>': [54, [[R, [[8, 24], [44, 58], [8, 92]]]], []],
  '<': [54, [[R, [[46, 24], [10, 58], [46, 92]]]], []],
  '→': [76, [[M, [[4, 58], [62, 58]]], [R, [[40, 32], [66, 58], [40, 84]]]], []],
  '%': [72, [[T, [[62, 4], [10, 96]]], [T, [[10, 10], [24, 10], [24, 34], [10, 34], [10, 10]]], [T, [[48, 66], [62, 66], [62, 90], [48, 90], [48, 66]]]], []],
  '#': [66, [[T, [[26, 10], [20, 92]]], [T, [[48, 10], [42, 92]]], [T, [[8, 38], [60, 38]]], [T, [[6, 66], [58, 66]]]], []],
};
G['0'] = G[0];

const METALS = {
  copper: [['0', '#fff1cf'], ['.22', '#ffc27a'], ['.46', '#d0692c'], ['.5', '#6b2808'], ['.56', '#a8471a'], ['.78', '#f09a55'], ['1', '#ffd9a0']],
  gold: [['0', '#fffbe0'], ['.25', '#ffe27a'], ['.47', '#e39b2a'], ['.51', '#7a3f08'], ['.58', '#b56a14'], ['.8', '#ffc948'], ['1', '#fff0b0']],
  bronze: [['0', '#f3dcb4'], ['.3', '#c99a62'], ['.5', '#6d4a26'], ['.55', '#4a3018'], ['.8', '#a67c4a'], ['1', '#e8c898']],
  ivory: [['0', '#fffaf0'], ['.45', '#f1e3c4'], ['.55', '#cbb28a'], ['1', '#f6ead0']],
  iron: [['0', '#e8eef4'], ['.4', '#9aa6b4'], ['.52', '#3c444e'], ['.6', '#5a6470'], ['1', '#c8d2dc']],
  ember: [['0', '#fff3c0'], ['.35', '#ffb040'], ['.55', '#e8501a'], ['.62', '#8a1e06'], ['1', '#ff8a3a']],
  p1: [['0', '#fff0d8'], ['.4', '#ffb86a'], ['.55', '#c85a1c'], ['1', '#ffd49a']],
  p2: [['0', '#eaf6ff'], ['.4', '#8ccaff'], ['.55', '#2a6ab0'], ['1', '#c4e4ff']],
};
const RIMS = { copper: '#3a1404', gold: '#3a1e02', bronze: '#241408', ivory: '#3a2a14', iron: '#12161c', ember: '#380a02', p1: '#3a1404', p2: '#081a34' };

let uid = 0;
export function measure(text, track = 8) {
  let w = 0;
  for (const ch of String(text).toUpperCase()) w += (G[ch] || G[' '])[0] + track;
  return Math.max(0, w - track);
}

/** Path data per stroke width for a text run (widths are the keys). */
function layout(text, track) {
  const byW = new Map(); const serifs = [];
  let x = 0;
  for (const ch of String(text).toUpperCase()) {
    const g = G[ch] || G[' '];
    for (const [w, pts] of g[1]) {
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${(p[0] + x).toFixed(1)} ${p[1]}`).join('');
      byW.set(w, (byW.get(w) || '') + d);
    }
    for (const [sx, sy] of g[2]) serifs.push([sx + x, sy]);
    x += g[0] + track;
  }
  // Wedge serifs: short tapered bars at stem ends (drawn as filled trapezoids).
  let sd = '';
  for (const [sx, sy] of serifs) {
    const hw = 13, tip = 5, inY = sy === 0 ? 7 : 93, edge = sy === 0 ? 0 : 100;
    sd += `M${sx - hw} ${edge}L${sx + hw} ${edge}L${sx + hw - tip} ${(edge + inY) / 2}L${sx + 4} ${inY + (sy === 0 ? 4 : -4)}L${sx - 4} ${inY + (sy === 0 ? 4 : -4)}L${sx - hw + tip} ${(edge + inY) / 2}Z`;
  }
  return { byW, sd, width: Math.max(1, x - track) };
}

// perf-1650 r2: forge() no longer inlines the SVG into the page. An inline SVG with feSpecularLighting is re-rasterised
// by the GPU process (RasterDecoder) every time anything in its tile changes, and the SMIL glint changed it EVERY frame:
// at 1080p that raster ate ~50 % of the GPU-process main thread and halved the WebGL frame rate. Now the static
// lettering is an <img> of the same SVG (rasterised once per size and cached), and the glint is a CSS transform
// animation on a masked overlay (compositor-only, zero raster). Same pixels; forgeSVG() still returns the inline SVG.
const _urls = new Map();
const svgUrl = (svg) => { let u = _urls.get(svg); if (!u) { u = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; if (_urls.size > 400) _urls.clear(); _urls.set(svg, u); } return u; };
let _cssDone = false;
function forgeCSS() {
  if (_cssDone || typeof document === 'undefined') return;
  _cssDone = true;
  const st = document.createElement('style');
  st.id = 'kca-forge-css';
  st.textContent = `span.forge { position: relative; line-height: 0; }
span.forge > img, img.forge-i { position: absolute; inset: 0; width: 100%; height: 100%; display: block; pointer-events: none; }
img.forge { object-fit: fill; }
.forge-gl { position: absolute; inset: 0; overflow: hidden; pointer-events: none; -webkit-mask-size: 100% 100%; mask-size: 100% 100%; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat; }
.forge-gl > b { position: absolute; left: 0; top: 0; width: 100%; height: 100%; will-change: transform;
  background: linear-gradient(106deg, rgba(255,255,255,0) 45%, rgba(255,251,232,.95) 50%, rgba(255,255,255,0) 55%);
  animation: kca-forge-glint var(--gd, 4.5s) linear infinite; transform: translateX(-110%); }
@keyframes kca-forge-glint { 0% { transform: translateX(-110%); } 40% { transform: translateX(110%); } 100% { transform: translateX(110%); } }`;
  (document.head || document.documentElement).appendChild(st);
}

/**
 * Forged lettering as page markup (an <img> of the SVG, + a compositor glint overlay when opts.glint). Same options
 * and output size/CSS hooks (class "forge forge-<metal> <className>") as forgeSVG().
 */
export function forge(text, opts = {}) {
  forgeCSS();
  const { metal = 'copper', glint = false, className = '', title = null } = opts;
  const P = forgeParts(text, { ...opts, glint: false });
  const label = (title || text).replace(/"/g, '');
  const src = svgUrl(P.svg);
  if (!glint) return `<img class="forge forge-${metal} ${className}" src="${src}" style="${P.style}" role="img" alt="" aria-label="${label}" draggable="false" decoding="sync">`;
  const glintDur = typeof glint === 'number' ? glint : 4.5;
  const mask = svgUrl(P.mask);
  return `<span class="forge forge-${metal} ${className}" style="${P.style}" role="img" aria-label="${label}"><img class="forge-i" src="${src}" alt="" draggable="false" decoding="sync"><i class="forge-gl" style="-webkit-mask-image:url('${mask}');mask-image:url('${mask}');--gd:${glintDur}s"><b></b></i></span>`;
}

/** Glint-free SVG string + CSS size style + the glint mask SVG (shared by forge / forgeSVG). */
function forgeParts(text, opts) {
  const { metal = 'copper', height = null, track = 8, rim = 7, bevel = 1 } = opts;
  const id = 'f'; // standalone image documents: fixed ids keep identical lettering byte-identical (one cached raster)
  const { byW, sd, width } = layout(text, track);
  const pad = rim + 4;
  const H = 100 + pad * 2 + (opts.descender ? 12 : 0);
  const vb = `${-pad} ${-pad} ${width + pad * 2} ${H}`;
  const stops = (METALS[metal] || METALS.copper).map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('');
  const strokes = (delta, attrs) => [...byW].map(([w, d]) => `<path d="${d}" stroke-width="${w + delta}" ${attrs}/>`).join('');
  const common = 'fill="none" stroke-linejoin="miter" stroke-miterlimit="6" stroke-linecap="butt"';
  const ar = `aspect-ratio:${(width + pad * 2).toFixed(1)}/${H}`;
  const style = height ? `height:${height}px;width:auto;${ar}` : ar;
  const rimC = RIMS[metal] || '#2a1204';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${(width + pad * 2).toFixed(1)}" height="${H}" preserveAspectRatio="none"><defs><linearGradient id="${id}m" x1="0" y1="0" x2="0" y2="100" gradientUnits="userSpaceOnUse">${stops}</linearGradient><clipPath id="${id}c"><rect x="${-pad}" y="0" width="${width + pad * 2}" height="100"/></clipPath><clipPath id="${id}o"><rect x="${-pad}" y="${-rim * 0.6}" width="${width + pad * 2}" height="${100 + rim * 1.2}"/></clipPath><filter id="${id}b" x="-5%" y="-10%" width="110%" height="120%"><feGaussianBlur in="SourceAlpha" stdDeviation="${1.6 * bevel}" result="bl"/><feSpecularLighting in="bl" surfaceScale="${3.2 * bevel}" specularConstant="1.05" specularExponent="18" lighting-color="#fff4dc" result="sp"><feDistantLight azimuth="235" elevation="48"/></feSpecularLighting><feComposite in="sp" in2="SourceAlpha" operator="in" result="spc"/><feComposite in="SourceGraphic" in2="spc" operator="arithmetic" k1="0" k2="1" k3="0.85" k4="0"/></filter></defs><g clip-path="url(#${id}o)" stroke="${rimC}">${strokes(rim * 2, common)}<path d="${sd}" fill="${rimC}" stroke-width="${rim * 2}" stroke-linejoin="miter"/></g><g clip-path="url(#${id}c)" filter="url(#${id}b)"><g stroke="url(#${id}m)">${strokes(0, common)}</g><path d="${sd}" fill="url(#${id}m)"/></g></svg>`;
  const mask = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${(width + pad * 2).toFixed(1)}" height="${H}" preserveAspectRatio="none"><defs><clipPath id="c"><rect x="${-pad}" y="0" width="${width + pad * 2}" height="100"/></clipPath></defs><g clip-path="url(#c)" stroke="#fff">${strokes(-3, common)}<path d="${sd}" fill="#fff"/></g></svg>`;
  return { svg, mask, style };
}

/**
 * Forged SVG lettering (inline <svg>, kept for tools/showcases). opts: { metal, height (css px, or null → 1em),
 * track (units), glint (bool|seconds), className, rim (units of dark rim), bevel (0..2), shadow (bool) }
 */
export function forgeSVG(text, opts = {}) {
  const { metal = 'copper', height = null, track = 8, glint = false, className = '', rim = 7, bevel = 1, title = null } = opts;
  const id = `fg${++uid}`;
  const { byW, sd, width } = layout(text, track);
  const pad = rim + 4;
  const vb = `${-pad} ${-pad} ${width + pad * 2} ${100 + pad * 2 + (opts.descender ? 12 : 0)}`;
  const stops = (METALS[metal] || METALS.copper).map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('');
  const strokes = (delta, attrs) => [...byW].map(([w, d]) => `<path d="${d}" stroke-width="${w + delta}" ${attrs}/>`).join('');
  const common = 'fill="none" stroke-linejoin="miter" stroke-miterlimit="6" stroke-linecap="butt"';
  const glintDur = typeof glint === 'number' ? glint : 4.5;
  const ar = `aspect-ratio:${(width + pad * 2).toFixed(1)}/${100 + pad * 2 + (opts.descender ? 12 : 0)}`;
  const style = height ? `height:${height}px;width:auto;${ar}` : ar; // CSS sets height (default 1em) and width:auto
  const rimC = RIMS[metal] || '#2a1204';
  return (`<svg class="forge forge-${metal} ${className}" viewBox="${vb}" style="${style}" role="img" aria-label="${(title || text).replace(/"/g, '')}" xmlns="http://www.w3.org/2000/svg">
<defs>
  <linearGradient id="${id}m" x1="0" y1="0" x2="0" y2="100" gradientUnits="userSpaceOnUse">${stops}</linearGradient>
  <clipPath id="${id}c"><rect x="${-pad}" y="0" width="${width + pad * 2}" height="100"/></clipPath>
  <clipPath id="${id}o"><rect x="${-pad}" y="${-rim * 0.6}" width="${width + pad * 2}" height="${100 + rim * 1.2}"/></clipPath>
  <filter id="${id}b" x="-5%" y="-10%" width="110%" height="120%">
    <feGaussianBlur in="SourceAlpha" stdDeviation="${1.6 * bevel}" result="bl"/>
    <feSpecularLighting in="bl" surfaceScale="${3.2 * bevel}" specularConstant="1.05" specularExponent="18" lighting-color="#fff4dc" result="sp">
      <feDistantLight azimuth="235" elevation="48"/></feSpecularLighting>
    <feComposite in="sp" in2="SourceAlpha" operator="in" result="spc"/>
    <feComposite in="SourceGraphic" in2="spc" operator="arithmetic" k1="0" k2="1" k3="0.85" k4="0"/>
  </filter>
  ${glint ? `<linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="0.35"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fffbe8" stop-opacity=".95"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <mask id="${id}k" maskUnits="userSpaceOnUse" x="${-pad}" y="${-pad}" width="${width + pad * 2}" height="${100 + pad * 2}"><g clip-path="url(#${id}c)" stroke="#fff">${strokes(-3, common)}<path d="${sd}" fill="#fff"/></g></mask>` : ''}
</defs>
<g clip-path="url(#${id}o)" stroke="${rimC}">${strokes(rim * 2, common)}<path d="${sd}" fill="${rimC}" stroke-width="${rim * 2}" stroke-linejoin="miter"/></g>
<g clip-path="url(#${id}c)" filter="url(#${id}b)"><g stroke="url(#${id}m)">${strokes(0, common)}</g><path d="${sd}" fill="url(#${id}m)"/></g>
${glint ? `<g mask="url(#${id}k)"><rect x="${-width}" y="-20" width="${width}" height="140" fill="url(#${id}g)"><animate attributeName="x" values="${-width * 1.1};${width * 1.1};${width * 1.1}" keyTimes="0;0.4;1" dur="${glintDur}s" repeatCount="indefinite"/></rect></g>` : ''}
</svg>`).replace(/>\s+</g, '><'); // no whitespace text nodes: element.textContent stays clean
}

export const GLYPHS = Object.keys(G);
