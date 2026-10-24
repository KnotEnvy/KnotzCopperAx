// Parchment-map interlude (DESIGN §10): an inked map of the realm unrolls; the route already travelled is drawn in
// ink, the next leg animates from the last location to the next with a knot marker, the destination's sigil pulses
// and its name is forged beneath. opts: { from: 0..5 (0 = the road's start), to: 1..5, onDone() }
// r7: the realm is a RENDERED relief painting (blender/build_ui_map.py: modelled terrain with real mountains, a lake, rivers, forests,
// the burning Ashen Wilds, Shellback's tortoise carrying its village, eagle peaks, Serpent Keep, the serpent throne; ink outlines +
// hatching + parchment grade) behind two thin <svg> layers: the static furniture (neatline, compass, scale, route so far) and the
// animated leg + crisp label plaques. The sheet lies on a baked oak desk under a lamp (see styles.js .kca-map).
import { forge } from '../lettering.js';
import { knot } from '../art.js';
import { h, CONFIRM } from '../widgets.js';
import * as A from '../mapart.js';

const INK = A.INK;
export const LOCATIONS = [
  { id: 0, name: 'The Old Road', x: 110, y: 790 },
  { id: 1, name: 'The Ashen Wilds', x: 270, y: 640, icon: 'village', r: 70 },
  { id: 2, name: 'Shellback Crossing', x: 612, y: 540, icon: 'tortoise', r: 96 },
  { id: 3, name: 'Eaglespine Skies', x: 880, y: 270, icon: 'peaks', r: 125 },
  { id: 4, name: 'Serpent Keep Gates', x: 1171, y: 552, icon: 'keep', r: 70 },
  { id: 5, name: 'Throne of Coils', x: 1396, y: 306, icon: 'throne', r: 84 },
];
const CAMPS = [[160, 730], [420, 600], [725, 400], [1040, 395], [1280, 360]];
// Label plaques: every location name sits on an opaque swallowtail ribbon drawn ABOVE all map linework (outside the
// ink filter, so letters stay crisp), on the side of its icon that no route leg uses; a dotted leader tick ties each
// plaque to its vignette. cx/cy = plaque centre in 1600x900 map units. Eaglespine's plaque keeps its LEFT edge fixed
// (right of the range, left of the coast) and refits to the measured text.
const EAGLE_LEFT = 1030;
const LABEL_AT = { 1: [270, 506], 2: [820, 630], 3: [null, 262], 4: [1171, 606], 5: [1240, 162] };
const PLQ_H = 30;
const estW = (name) => Math.round(name.length * 12.6 + 44);
export function plaquePath(cx, cy, w) {
  const a = cx - w / 2, b = cx + w / 2, t = cy - PLQ_H / 2, u = cy + PLQ_H / 2;
  return `M${a} ${t}H${b}L${b - 9} ${cy}L${b} ${u}H${a}L${a + 9} ${cy}Z`;
}
function labelPos(L) {
  const [cx, cy] = LABEL_AT[L.id];
  return cx == null ? [EAGLE_LEFT + estW(L.name) / 2, cy] : [cx, cy]; // Eaglespine: left edge fixed
}
/** Leader tick from a plaque's edge toward its vignette (null when the plaque already touches it). */
function leader(L) {
  const [cx, cy] = labelPos(L), w = estW(L.name);
  const dx = L.x - cx, dy = L.y - cy, len = Math.hypot(dx, dy);
  const s = Math.min(Math.abs(dx) > 1e-6 ? (w / 2) / Math.abs(dx) : 1e9, Math.abs(dy) > 1e-6 ? (PLQ_H / 2) / Math.abs(dy) : 1e9);
  const sx = cx + dx * s, sy = cy + dy * s, ex = L.x - (dx / len) * L.r, ey = L.y - (dy / len) * L.r;
  if (Math.hypot(ex - sx, ey - sy) < 16 || (ex - sx) * dx + (ey - sy) * dy <= 0) return '';
  return `<path d="M${sx.toFixed(1)} ${sy.toFixed(1)}L${ex.toFixed(1)} ${ey.toFixed(1)}" stroke="${INK}" stroke-width="1.7" stroke-dasharray="1.5 4.5" stroke-linecap="round" fill="none"/><path d="M${(ex - 4).toFixed(1)} ${ey.toFixed(1)}l4 -4 4 4 -4 4z" fill="#a8261a" stroke="${INK}" stroke-width="1"/>`;
}

// r8: legs that reach / leave Serpent Keep are explicit waypoint paths that skirt the keep + its moat (the keep art fills x 1095-1245,
// y 395-510 with the moat out to x 1075-1265; the Gates node is the drawbridge head at its south side) instead of cutting across it.
const WAYPOINTS = {
  // r9: Shellback — the X sits on the shell's lower flank (not on the village crown), the road arrives along the lake's south shore and leaves
  // round the tortoise's chin and up the east bank, so the dashes never cross the shell village or the head.
  1: [[270, 640], [340, 630], [420, 600], [490, 594], [556, 578], [612, 540]],
  2: [[612, 540], [652, 588], [730, 588], [800, 570], [834, 496], [816, 424], [818, 350], [880, 270]],
  3: [[880, 270], [960, 335], [1040, 395], [1052, 470], [1078, 538], [1124, 568], [1171, 552]],
  4: [[1171, 552], [1236, 590], [1304, 548], [1310, 452], [1286, 372], [1334, 330], [1396, 306]],
};
/** Catmull-Rom through points → cubic-Bézier SVG path. */
function smoothPath(pts) {
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    d += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0]} ${p2[1]}`;
  }
  return d;
}
function legPath(a, b) {
  if (WAYPOINTS[a]) return smoothPath(WAYPOINTS[a]);
  const A_ = LOCATIONS[a], B = LOCATIONS[b], C = CAMPS[a] || [(A_.x + B.x) / 2, (A_.y + B.y) / 2];
  // Through the camp point with gentle bends (quadratic chain).
  return `M${A_.x} ${A_.y} Q${(A_.x + C[0]) / 2 + 20} ${(A_.y + C[1]) / 2 + 26} ${C[0]} ${C[1]} T${B.x} ${B.y}`;
}

// r7: the realm itself is a RENDERED relief painting (blender/build_ui_map.py: modelled terrain, mountains, lake, forests, the burning
// village, the Shellback tortoise carrying its village, eagles, Serpent Keep, the serpent throne — lit by a low sun, ink-outlined and
// hatched) shipped as assets/ui/map_relief.webp. The vector layers here only carry what must stay crisp or animate: the neatline,
// compass, scale bar, the inked route (travelled / ahead), the crossed-out places already visited and the pulsing destination ring.
const RELIEF = `${(import.meta.env && import.meta.env.BASE_URL) || '/'}assets/ui/map_relief.webp`;

export function mapSVG(from, to) {
  const legs = [];
  for (let i = 0; i < 5; i++) legs.push(legPath(i, i + 1));
  const done = legs.slice(0, from).map((d) => `<path d="${d}" stroke="${INK}" stroke-width="3.2" stroke-dasharray="10 8" fill="none" stroke-linecap="round"/>`).join('');
  const future = legs.slice(to).map((d) => `<path d="${d}" stroke="${INK}" stroke-width="2" stroke-dasharray="2 9" fill="none" stroke-linecap="round" opacity=".5"/>`).join('');
  const seen = LOCATIONS.slice(1).filter((L) => L.id <= from).map((L) => `<g class="loc seen" data-id="${L.id}"><path d="M${L.x - 15} ${L.y - 6} l30 16 M${L.x + 15} ${L.y - 6} l-30 16" stroke="#8a1a08" stroke-width="4.5" opacity=".85" stroke-linecap="round"/></g>`).join('');
  const dest = LOCATIONS[to];
  const ring = `<g class="ring" transform="translate(${dest.x} ${dest.y})"><circle r="${dest.r * 0.75}" fill="none" stroke="#a8261a" stroke-width="2.6" stroke-dasharray="3 7" stroke-linecap="round" opacity=".85"/><circle class="pulse" r="${dest.r * 0.75}" fill="none" stroke="#e8b04a" stroke-width="2.4"/></g>`;
  const labels = LOCATIONS.slice(1).map((L) => {
    const [cx, cy] = labelPos(L), w = estW(L.name), nx = L.id === to;
    return `<g class="lbl${nx ? ' next' : ''}" data-id="${L.id}" data-cx="${cx}" data-cy="${cy}">
      <ellipse class="halo" cx="${cx}" cy="${cy}" rx="${w / 2 + 26}" ry="${PLQ_H / 2 + 14}" fill="url(#lblHalo)"/>${leader(L)}
      <path class="plq" d="${plaquePath(cx, cy + 2.5, w)}" fill="${INK}" opacity=".35"/>
      <path class="plq" d="${plaquePath(cx, cy, w)}" fill="${nx ? '#f4e6c0' : '#ecdcb4'}" stroke="${nx ? '#8a1a08' : INK}" stroke-width="${nx ? 2.4 : 1.8}" stroke-linejoin="round"/>
      <path class="plq in" d="${plaquePath(cx, cy, w - 14)}" transform="translate(${cx} ${cy}) scale(1 .72) translate(${-cx} ${-cy})" fill="none" stroke="${INK}" stroke-width=".8" opacity=".55"/>
      <text x="${cx}" y="${cy + 6.5}" text-anchor="middle" font-family="EB Garamond, Palatino Linotype, Book Antiqua, Georgia, serif" font-size="19" font-variant="small-caps" letter-spacing="3" fill="${nx ? '#6a1406' : INK}">${L.name}</text></g>`;
  }).join('');
  const ns = 'xmlns="http://www.w3.org/2000/svg"';
  const defs = `<defs><filter id="mapInk"><feTurbulence type="fractalNoise" baseFrequency=".04" numOctaves="2" seed="3"/><feDisplacementMap in="SourceGraphic" scale="3"/></filter></defs>`;
  const topDefs = `<defs><radialGradient id="lblHalo"><stop offset="0" stop-color="#ead8a6" stop-opacity=".95"/><stop offset=".6" stop-color="#ead8a6" stop-opacity=".92"/><stop offset="1" stop-color="#ead8a6" stop-opacity="0"/></radialGradient>
    <filter id="mapInkLeg"><feTurbulence type="fractalNoise" baseFrequency=".04" numOctaves="2" seed="3"/><feDisplacementMap in="SourceGraphic" scale="3"/></filter>
    <mask id="legMask"><path class="legmask" d="${legs[Math.max(0, to - 1)]}" stroke="#fff" stroke-width="14" fill="none"/></mask></defs>`;
  const base = `<img class="relief" alt="" src="${RELIEF}" decoding="async" draggable="false"><svg class="mapsvg base" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" ${ns}>${defs}
  <g filter="url(#mapInk)">${done}${future}${A.compass(150, 176, 54)}${A.scaleBar(1212, 850, 160)}${seen}</g>${A.border()}</svg>`;
  const top = `<svg class="mapsvg top" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" ${ns}>${topDefs}${ring}
    <g filter="url(#mapInkLeg)"><path class="leg" d="${legs[Math.max(0, to - 1)]}" stroke="#8a1a08" stroke-width="4.2" stroke-dasharray="12 8" fill="none" stroke-linecap="round" mask="url(#legMask)"/></g>
    <g class="labels">${labels}</g></svg>`;
  return base + top;
}

export default {
  id: 'map',
  create(ui, opts = {}) {
    const to = Math.max(1, Math.min(5, Number(opts.to) || 1));
    const from = Math.max(0, Math.min(to - 1, opts.from != null ? Number(opts.from) : to - 1));
    const L = LOCATIONS[to];
    const el = h(`<div class="kca-map"><div class="desk"></div><div class="deskshadow"></div><div class="sheet kca-parch">${mapSVG(from, to)}<div class="lamp"></div><div class="wear"></div>
      <div class="title">${forge('THE ROAD TO THE SERPENT THRONE', { metal: 'bronze', track: 12 })}</div>
      <div class="marker" style="position:absolute;left:0;top:0;width:54px;height:56px;transform:translate(-100px,-100px)">${knot({ size: 54, band: 8, metal: 'copper', ring: false })}</div>
      <div class="cap"><div class="k">Stage ${to}</div>${forge(L.name, { metal: 'copper', track: 12, glint: 2.4 })}</div></div></div>`);
    const sheet = el.querySelector('.sheet');
    const rel = el.querySelector('img.relief');
    if (rel) { const on = () => rel.classList.add('on'); if (rel.complete && rel.naturalWidth) on(); else { rel.addEventListener('load', on); rel.addEventListener('error', on); } }
    const mask = el.querySelector('.legmask'), marker = el.querySelector('.marker'), cap = el.querySelector('.cap');
    const svg = el.querySelector('svg.mapsvg');
    let len = 0; try { len = mask.getTotalLength(); } catch { len = 800; }
    mask.style.strokeDasharray = `${len} ${len}`; mask.style.strokeDashoffset = String(len);
    cap.style.opacity = '0';
    // Refit each plaque to its measured text (the estimate only has to be close enough for the first frame).
    let fitted = false;
    const fit = () => {
      if (fitted) return;
      for (const g of el.querySelectorAll('g.lbl')) {
        const tx = g.querySelector('text'); let tw = 0; try { tw = tx.getComputedTextLength(); } catch { return; }
        if (!tw) return;
        let cx = Number(g.dataset.cx); const cy = Number(g.dataset.cy), w = Math.ceil(tw + 46);
        const L = LOCATIONS[Number(g.dataset.id)];
        if (LABEL_AT[L.id][0] == null) cx = EAGLE_LEFT + w / 2; // keep the Eaglespine plaque's left edge fixed
        tx.setAttribute('x', cx);
        const hl = g.querySelector('ellipse.halo'); hl.setAttribute('cx', cx); hl.setAttribute('rx', w / 2 + 26);
        const ps = g.querySelectorAll('path.plq');
        ps[0].setAttribute('d', plaquePath(cx, cy + 2.5, w)); ps[1].setAttribute('d', plaquePath(cx, cy, w));
        ps[2].setAttribute('d', plaquePath(cx, cy, w - 14)); ps[2].setAttribute('transform', `translate(${cx} ${cy}) scale(1 .72) translate(${-cx} ${-cy})`);
      }
      fitted = true;
    };
    let t = 0, finished = false;
    const T0 = 1.0, T1 = 3.6, END = 6.2;
    if (opts.t0) t = Math.min(opts.t0, END - 0.5); // showcase: preview a later moment
    const done = () => { if (finished) return; finished = true; if (opts.onDone) opts.onDone(); };
    const step = () => {
      fit();
      const k = Math.max(0, Math.min(1, (t - T0) / (T1 - T0)));
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      mask.style.strokeDashoffset = String(len * (1 - e));
      try {
        const pt = mask.getPointAtLength(len * e);
        const r = svg.getBoundingClientRect(), sr = sheet.getBoundingClientRect();
        const sc = Math.max(r.width / 1600, r.height / 900), ox = (r.width - 1600 * sc) / 2, oy = (r.height - 900 * sc) / 2;
        const uz = ui.zoom || 1; // rects are visual px; the marker lives inside the zoomed layer
        marker.style.transform = `translate(${(r.left - sr.left + ox + pt.x * sc) / uz - 27}px, ${(r.top - sr.top + oy + pt.y * sc) / uz - 60}px)`;
      } catch { /* not laid out yet */ }
      cap.style.opacity = String(Math.max(0, Math.min(1, (t - T1 + 0.3) / 0.5)));
      cap.style.transform = `translateY(${(1 - Math.min(1, Math.max(0, (t - T1 + 0.3) / 0.5))) * 16}px)`;
    };
    requestAnimationFrame(step);
    return {
      el,
      update(dt) { if (finished) return; t += Math.min(dt, 0.5); step(); if (t > END) done(); },
      onAction(player, action) { if (CONFIRM.includes(action)) { if (t < T1) t = T1; else done(); } return true; },
    };
  },
};
