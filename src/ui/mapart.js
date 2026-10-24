// Vector furniture for the map interlude (ui/screens/map.js): the compass rose, the neatline border and the leagues ruler. Since r7 the
// realm itself is a rendered relief painting (blender/build_ui_map.py -> assets/ui/map_relief.webp); the r5/r6 hand-inked SVG vignettes
// (peaks, tortoise, keep, groves ...) that used to live here were retired with it. Palette: ink + parchment washes.
export const INK = '#4a2610';
const LIGHT = '#f0dcae';

const f = (n) => Math.round(n * 10) / 10;
const poly = (p) => 'M' + p.map(([x, y]) => `${f(x)} ${f(y)}`).join('L') + 'Z';

/** Eight-point compass rose with lit/shaded halves, graduated ring and fleur-de-lis north. */
export function compass(cx, cy, r) {
  let o = `<circle cx="${cx}" cy="${cy}" r="${r * 1.08}" fill="${LIGHT}" opacity=".55" stroke="${INK}" stroke-width="1.6"/><circle cx="${cx}" cy="${cy}" r="${r * 0.92}" fill="none" stroke="${INK}" stroke-width=".9"/>`;
  let ticks = '';
  for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2, r0 = r * 0.92, r1 = r * (i % 4 === 0 ? 1.08 : 1.0); ticks += `M${f(cx + Math.cos(a) * r0)} ${f(cy + Math.sin(a) * r0)}L${f(cx + Math.cos(a) * r1)} ${f(cy + Math.sin(a) * r1)}`; }
  o += `<path d="${ticks}" stroke="${INK}" stroke-width=".9"/>`;
  const ptn = (ang, len, wid, dark) => {
    const c = Math.cos(ang), s = Math.sin(ang), px = -s, py = c;
    const tip = [cx + c * len, cy + s * len], a = [cx + px * wid, cy + py * wid], b = [cx - px * wid, cy - py * wid];
    return `<path d="${poly([tip, a, [cx, cy]])}" fill="${dark ? INK : LIGHT}" stroke="${INK}" stroke-width="1.1" stroke-linejoin="round"/><path d="${poly([tip, b, [cx, cy]])}" fill="${dark ? LIGHT : INK}" stroke="${INK}" stroke-width="1.1" stroke-linejoin="round"/>`;
  };
  for (let i = 0; i < 4; i++) o += ptn(Math.PI / 4 + i * Math.PI / 2, r * 0.6, r * 0.13, i % 2);
  for (let i = 0; i < 4; i++) o += ptn(i * Math.PI / 2 - Math.PI / 2, r * 0.9, r * 0.17, i % 2);
  o += `<circle cx="${cx}" cy="${cy}" r="${r * 0.1}" fill="#a8261a" stroke="${INK}" stroke-width="1.2"/>`;
  o += `<path d="M${cx} ${f(cy - r * 1.3)}q${f(-r * .16)} ${f(r * .1)} ${f(-r * .08)} ${f(r * .2)}q${f(r * .08)} ${f(-r * .04)} ${f(r * .08)} ${f(-r * .1)}q0 ${f(r * .06)} ${f(r * .08)} ${f(r * .1)}q${f(r * .08)} ${f(-r * .1)} ${f(-r * .08)} ${f(-r * .2)}z" fill="${INK}"/>`;
  return o;
}

/** Neatline border: heavy + hairline rules with a chequered graduation ruler between them and quatrefoil corners. */
export function border(W = 1600, H = 900, m = 20) {
  const a = m, b = m + 9, wd = W - 2 * a, ht = H - 2 * a;
  let o = `<rect x="${a}" y="${a}" width="${wd}" height="${ht}" fill="none" stroke="${INK}" stroke-width="3"/><rect x="${b}" y="${b}" width="${wd - 18}" height="${ht - 18}" fill="none" stroke="${INK}" stroke-width="1"/>`;
  let blocks = '';
  const seg = 28;
  for (let x = a + 30, i = 0; x + seg <= W - a - 30; x += seg, i++) if (i % 2 === 0) blocks += `M${x} ${a + 1.5}h${seg}v6h${-seg}zM${x} ${H - a - 7.5}h${seg}v6h${-seg}z`;
  for (let y = a + 30, i = 0; y + seg <= H - a - 30; y += seg, i++) if (i % 2 === 0) blocks += `M${a + 1.5} ${y}h6v${seg}h-6zM${W - a - 7.5} ${y}h6v${seg}h-6z`;
  o += `<path d="${blocks}" fill="${INK}" opacity=".78"/>`;
  for (const [cx, cy] of [[a + 14, a + 14], [W - a - 14, a + 14], [a + 14, H - a - 14], [W - a - 14, H - a - 14]]) {
    o += `<circle cx="${cx}" cy="${cy}" r="14" fill="${LIGHT}" stroke="${INK}" stroke-width="2"/><circle cx="${cx}" cy="${cy}" r="9.5" fill="none" stroke="${INK}" stroke-width="1"/>`
      + [0, 1, 2, 3].map((k) => `<ellipse cx="${f(cx + Math.cos(k * Math.PI / 2) * 5)}" cy="${f(cy + Math.sin(k * Math.PI / 2) * 5)}" rx="4.4" ry="2.6" transform="rotate(${k * 90} ${f(cx + Math.cos(k * Math.PI / 2) * 5)} ${f(cy + Math.sin(k * Math.PI / 2) * 5)})" fill="#a8261a" stroke="${INK}" stroke-width=".8"/>`).join('')
      + `<circle cx="${cx}" cy="${cy}" r="2.2" fill="${INK}"/>`;
  }
  return o;
}

/** A leagues ruler (alternating blocks) with tick marks. */
export function scaleBar(x, y, w = 240) {
  let o = `<rect x="${x}" y="${y}" width="${w}" height="7" fill="none" stroke="${INK}" stroke-width="1.4"/>`;
  for (let i = 0; i < 6; i++) if (i % 2 === 0) o += `<rect x="${f(x + i * w / 6)}" y="${y}" width="${f(w / 6)}" height="7" fill="${INK}"/>`;
  for (let i = 0; i <= 6; i++) o += `<path d="M${f(x + i * w / 6)} ${y - 5}v5" stroke="${INK}" stroke-width="1.2"/>`;
  return o;
}

export const PALETTE = { INK, LIGHT };
