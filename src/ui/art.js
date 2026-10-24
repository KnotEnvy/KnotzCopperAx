// Ornament library (inline SVG, generated): true over/under knotwork (painter-sorted 3D curves), braided borders,
// corner knots, sword cursor, magic-pot icon, hero crests. Everything is vector, crisp at any DPI.
//   knot({ size, band, metal })      trefoil "Knotz" emblem          braid({ length, height, twists })  plait strip
//   braidURI(...)                    data: URI for CSS backgrounds    corner()  sword()  pot(full)  crest(heroId)
const METAL = {
  copper: { hi: '#ffd6a0', mid: '#d07a3a', lo: '#6a2c0c', edge: '#1c0a03' },
  gold: { hi: '#fff0b0', mid: '#e0a032', lo: '#6a3c08', edge: '#1c0e02' },
  bronze: { hi: '#e8cc98', mid: '#a67a44', lo: '#4a3018', edge: '#140c05' },
  iron: { hi: '#d8e0ea', mid: '#7a8694', lo: '#2c333c', edge: '#0a0c10' },
};
let uid = 0;

/** Painter-sorted tube drawing of a closed/open 3D polyline: [[x, y, z], ...] → SVG group string. */
function tube(pts, { band = 8, metal = 'copper', gid, closed = true, seg = 3 } = {}) {
  const m = METAL[metal] || METAL.copper;
  const segs = [];
  const n = pts.length - (closed ? 0 : 1);
  for (let i = 0; i < n; i += seg) {
    const run = [];
    for (let k = 0; k <= seg + 1 && i + k <= (closed ? pts.length : pts.length - 1); k++) run.push(pts[(i + k) % pts.length]);
    if (run.length < 2) continue;
    const z = run.reduce((s, p) => s + p[2], 0) / run.length;
    segs.push({ z, d: run.map((p, j) => `${j ? 'L' : 'M'}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join('') });
  }
  segs.sort((a, b) => a.z - b.z);
  // Each segment: dark edge, band body (gradient across), thin highlight — drawn in depth order → real over/under.
  return segs.map((s) => `<path d="${s.d}" stroke="${m.edge}" stroke-width="${band + 3.2}" /><path d="${s.d}" stroke="url(#${gid})" stroke-width="${band}" /><path d="${s.d}" stroke="${m.hi}" stroke-opacity=".55" stroke-width="${band * 0.18}" />`).join('');
}
const grad = (gid, metal) => { const m = METAL[metal] || METAL.copper; return `<linearGradient id="${gid}" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="${m.hi}"/><stop offset=".45" stop-color="${m.mid}"/><stop offset="1" stop-color="${m.lo}"/></linearGradient>`; };
const svgOpen = (vb, cls, style = '') => `<svg class="${cls}" viewBox="${vb}" style="${style}" xmlns="http://www.w3.org/2000/svg" fill="none" stroke-linecap="round" stroke-linejoin="round">`;

/** Trefoil knot emblem (the "Knotz" mark). */
export function knot({ size = 64, band = 7, metal = 'copper', className = 'orn-knot', ring = true } = {}) {
  const gid = `kg${++uid}`, pts = [];
  const N = 180;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    pts.push([50 + 13.5 * (Math.sin(t) + 2 * Math.sin(2 * t)), 52 + 13.5 * (Math.cos(t) - 2 * Math.cos(2 * t)), -Math.sin(3 * t)]);
  }
  let ringSvg = '';
  if (ring) {
    const rp = []; for (let i = 0; i < 120; i++) { const t = (i / 120) * Math.PI * 2; rp.push([50 + 44 * Math.cos(t), 52 + 44 * Math.sin(t), Math.sin(t * 6) * 0.9]); }
    ringSvg = tube(rp, { band: band * 0.55, metal, gid, seg: 2 });
  }
  return `${svgOpen('0 0 100 104', className, `width:${size}px;height:${size * 1.04}px`)}<defs>${grad(gid, metal)}</defs>${ringSvg}${tube(pts, { band, metal, gid })}</svg>`;
}

/** Two-strand plait (braided border). length in units (height 20). */
export function braid({ length = 400, height = 20, twists = null, metal = 'bronze', band = 5.5, className = 'orn-braid', style = '' } = {}) {
  const gid = `bg${++uid}`;
  const tw = twists || Math.round(length / 26);
  const strand = (ph) => { const p = []; const N = tw * 24; for (let i = 0; i <= N; i++) { const u = i / N, a = u * tw * Math.PI * 2 + ph; p.push([u * length, height / 2 + Math.sin(a) * (height / 2 - band / 2 - 1), Math.cos(a)]); } return p; };
  const both = [...strand(0).map((p) => [...p, 0]), ...strand(Math.PI).map((p) => [...p, 1])];
  // Sort per segment across both strands.
  const segs = [];
  for (const s of [strand(0), strand(Math.PI)]) for (let i = 0; i < s.length - 1; i += 2) { const r = s.slice(i, i + 3); segs.push({ z: (r[0][2] + r[r.length - 1][2]) / 2, d: r.map((p, j) => `${j ? 'L' : 'M'}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join('') }); }
  segs.sort((a, b) => a.z - b.z);
  const m = METAL[metal] || METAL.bronze;
  void both;
  const body = segs.map((s) => `<path d="${s.d}" stroke="${m.edge}" stroke-width="${band + 2.6}"/><path d="${s.d}" stroke="url(#${gid})" stroke-width="${band}"/><path d="${s.d}" stroke="${m.hi}" stroke-opacity=".5" stroke-width="${band * 0.2}"/>`).join('');
  return `${svgOpen(`0 0 ${length} ${height}`, className, style)}<defs>${grad(gid, metal)}</defs>${body}</svg>`;
}
export const braidURI = (o = {}) => `url("data:image/svg+xml;utf8,${encodeURIComponent(braid({ ...o, className: '' }))}")`;

/** Corner knot (interlaced loop for panel corners). */
export function corner({ size = 34, metal = 'bronze', className = 'orn-corner' } = {}) {
  const gid = `cg${++uid}`, pts = [];
  for (let i = 0; i < 160; i++) {
    const t = (i / 160) * Math.PI * 2;
    // Figure-eight-ish loop knot (Lissajous 2:3) with depth alternating at crossings.
    pts.push([50 + 34 * Math.sin(2 * t), 50 + 34 * Math.sin(3 * t + Math.PI / 4), Math.cos(5 * t)]);
  }
  return `${svgOpen('0 0 100 100', className, `width:${size}px;height:${size}px`)}<defs>${grad(gid, metal)}</defs>${tube(pts, { band: 9, metal, gid })}</svg>`;
}

/** Sword cursor (points right). */
export function sword({ size = 60, className = 'orn-sword' } = {}) {
  const g = `sg${++uid}`;
  return `<svg class="${className}" viewBox="0 0 120 30" style="width:${size}px;height:${size / 4}px" xmlns="http://www.w3.org/2000/svg">
<defs><linearGradient id="${g}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".48" stop-color="#c8d4e0"/><stop offset=".52" stop-color="#6a7888"/><stop offset="1" stop-color="#b8c6d4"/></linearGradient>
<linearGradient id="${g}h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe7a0"/><stop offset=".5" stop-color="#d08a2a"/><stop offset="1" stop-color="#5a2c08"/></linearGradient></defs>
<path d="M40 11 L108 11 L118 15 L108 19 L40 19 Z" fill="url(#${g}b)" stroke="#141a22" stroke-width="1.6"/>
<path d="M44 15 L106 15" stroke="#8a98a8" stroke-width="1"/>
<rect x="32" y="3" width="8" height="24" rx="2" fill="url(#${g}h)" stroke="#1c0c02" stroke-width="1.6"/>
<rect x="12" y="11.5" width="21" height="7" rx="2" fill="#4a2a14" stroke="#1c0c02" stroke-width="1.4"/>
<path d="M14 12 L16 18 M19 12 L21 18 M24 12 L26 18 M29 12 L31 18" stroke="#8a5a2a" stroke-width="1"/>
<circle cx="8" cy="15" r="6" fill="url(#${g}h)" stroke="#1c0c02" stroke-width="1.6"/></svg>`;
}

/** Magic pot (flask) icon. */
export function pot({ full = true, className = 'orn-pot' } = {}) {
  const g = `pg${++uid}`;
  return `<svg class="${className}" viewBox="0 0 20 26" xmlns="http://www.w3.org/2000/svg">
<defs><radialGradient id="${g}" cx=".38" cy=".42" r=".7"><stop offset="0" stop-color="${full ? '#e4f6ff' : '#3a3246'}"/><stop offset=".45" stop-color="${full ? '#3f8cff' : '#1e1828'}"/><stop offset="1" stop-color="${full ? '#0f2a78' : '#0c0a12'}"/></radialGradient></defs>
<path d="M7 2 H13 V6 C13 7 18 9 18 16 C18 22 14 25 10 25 C6 25 2 22 2 16 C2 9 7 7 7 6 Z" fill="url(#${g})" stroke="${full ? '#bfe2ff' : '#4a4058'}" stroke-width="1.4"/>
<rect x="6" y="1" width="8" height="3" rx="1" fill="#8a5a2a" stroke="#2a1606" stroke-width=".8"/>
${full ? '<path d="M6 12 C5 15 5 18 7 21" stroke="#fff" stroke-opacity=".7" stroke-width="1.3" fill="none" stroke-linecap="round"/>' : ''}</svg>`;
}

/** Heraldic crest per hero: weapon silhouette over an element glyph. Used as a portrait fallback / select badge. */
export function crest(heroId, { size = 64, className = 'orn-crest' } = {}) {
  const g = `cr${++uid}`;
  const C = { brann: ['#d4814a', '#6a2c0c'], seraphine: ['#ff6a40', '#6a1408'], gorrim: ['#7ab8ea', '#12304c'] }[heroId] || ['#c8874a', '#3a2010'];
  const weapon = {
    brann: '<path d="M50 10 L56 18 L56 70 L44 70 L44 18 Z" fill="#dfe6ee" stroke="#141a22" stroke-width="2"/><rect x="32" y="68" width="36" height="7" rx="2" fill="#d09a4a" stroke="#1c0c02" stroke-width="2"/><rect x="46" y="75" width="8" height="14" fill="#5a3418" stroke="#1c0c02" stroke-width="2"/>',
    seraphine: '<path d="M30 20 Q52 44 64 82" stroke="#141a22" stroke-width="8" fill="none"/><path d="M30 20 Q52 44 64 82" stroke="#e6ecf2" stroke-width="4.5" fill="none"/><path d="M70 20 Q48 44 36 82" stroke="#141a22" stroke-width="8" fill="none"/><path d="M70 20 Q48 44 36 82" stroke="#e6ecf2" stroke-width="4.5" fill="none"/><circle cx="64" cy="82" r="5" fill="#d09a4a" stroke="#1c0c02" stroke-width="2"/><circle cx="36" cy="82" r="5" fill="#d09a4a" stroke="#1c0c02" stroke-width="2"/>',
    gorrim: '<rect x="47" y="18" width="7" height="70" rx="2" fill="#6a3c1c" stroke="#1c0c02" stroke-width="2"/><path d="M52 20 C70 16 80 26 80 44 C72 40 62 40 53 44 Z" fill="#e0884a" stroke="#2a0e02" stroke-width="2.4"/><path d="M50 20 C32 16 22 26 22 44 C30 40 40 40 49 44 Z" fill="#c86a30" stroke="#2a0e02" stroke-width="2.4"/>',
  }[heroId] || '';
  return `<svg class="${className}" viewBox="0 0 100 100" style="width:${size}px;height:${size}px" xmlns="http://www.w3.org/2000/svg">
<defs><radialGradient id="${g}" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="${C[0]}"/><stop offset="1" stop-color="${C[1]}"/></radialGradient></defs>
<path d="M50 4 L90 16 L86 60 C82 78 66 90 50 97 C34 90 18 78 14 60 L10 16 Z" fill="url(#${g})" stroke="#1a0c04" stroke-width="4"/>
<path d="M50 10 L84 20 L80 59 C77 74 64 84 50 90 C36 84 23 74 20 59 L16 20 Z" fill="none" stroke="#ffd9a0" stroke-opacity=".45" stroke-width="1.6"/>${weapon}</svg>`;
}

/** Ornamental rule: braid with a central knot. */
export function rule({ width = 520, metal = 'bronze', className = 'orn-rule' } = {}) {
  const half = braid({ length: width / 2 - 24, height: 14, metal, band: 4, className: 'orn-rule-b' });
  return `<div class="${className}">${half}${knot({ size: 34, band: 8, metal: metal === 'bronze' ? 'copper' : metal, ring: false, className: 'orn-rule-k' })}${half.replace('orn-rule-b', 'orn-rule-b flip')}</div>`;
}
