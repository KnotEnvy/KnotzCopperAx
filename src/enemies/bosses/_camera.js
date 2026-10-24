// Boss-fight camera mode (bosses agent; CameraRig.setMode API). Started by the hook runner when a boss wave spawns and
// held until the finale token dies (or the boss leaves the world — continue/stage change). Critic r2: in 3/5 in-stage
// fights the boss sat on/over the right edge of the frame (arena locks end at the stage edge and bosses back into it).
//   - framing target: the centroid of every live hero + boss member, biased toward the lead boss + arena centre;
//   - the lead boss's 3D box is kept inside the central band of the frame (≥ 34 % height, ≥ 8 % margin from frame edges),
//     every hero/boss inside 90 % (pull-out capped so the boss never shrinks below ~34 % of frame height);
//   - arena + view "soft walls": once a boss member has walked into the arena it cannot back further than the point where
//     the locked/current camera holds its full silhouette comfortably inside the frame.
//   const cam = bossCam(game, { lead, members, arena: [x0, x1], wallLeft = .35, wallRight = .65 }) · cam.stop()
import { clamp, damp, lerp } from '../../core/math.js';
import { fadeOccluders } from './_occluders.js';
import * as THREE from 'three';

const INNER = 0.44, EDGE = 0.88, BIAS = 0.08, LEADPULL = 0.65;
// Focal framing: lead feet at FEET ndc (−1 bottom), lead silhouette ≈ SPAN of frame height; every combatant's feet
// above BOT, head below TOPN (ndc); lead-boss camera depth in [DMIN, dMaxCap] so boss height stays ≥ 34 % of frame.
const FEET = -0.60, SPAN = 0.50, BOT = 0.84, TOPN = 0.80, DMIN = 7.4, DMAXK = 1.12;

// C2 r13 options: span (lead height as a fraction of the frame, default SPAN) · viewMaxX / viewMinX (world x the frame
// edge may not pass at the lead's depth — stage 3: keep the eagle's head out of the boss shot). &bossframe=0 = ignore.
const SADDLE_OLD = typeof location !== 'undefined' && /[?&]saddlefix=0/.test(location.search);
const FRAME_OFF = typeof location !== 'undefined' && /[?&]bossframe=0/.test(location.search);
export function bossCam(game, { lead, members, arena, wallLeft = 0.35, wallRight = 0.65, span = SPAN, viewMaxX = null, viewMinX = null } = {}) {
  if (FRAME_OFF) { span = SPAN; viewMaxX = null; viewMinX = null; }
  const rig = game.cameraRig;
  if (!rig || !rig.setMode || !lead) return { stop() {} };
  const list = () => (members ? (typeof members === 'function' ? members() : members) : (lead.members || [lead]));
  const base = rig.base;
  const framing = { distance: base.distance, height: base.height, lookHeight: base.lookHeight, fov: base.fov };
  // stage pitch lowered 1.5° (a more heroic, upward-leaning view of the boss), kept within 5–9°
  const pitch = clamp(Math.atan2(base.height - base.lookHeight, base.distance) - 0.026, 0.087, 0.157);
  let depth = null, breath = 0;
  const offBus = [];
  if (game.bus && game.bus.on) for (const ev of ['boss:summon', 'boss:rally', 'boss:phaseShift', 'boss:eruption', 'boss:corrupt'])
    offBus.push(game.bus.on(ev, () => { breath = 1.4; }));
  const inside = new WeakSet();
  let stopped = false, hwNow = null;
  const stats = { pushes: 0, pushM: 0, maxStep: 0 };   // soft-wall corrections (QA: boss_fight.mjs reads g._bossCam.stats)
  const occ = game.params && game.params.get && game.params.get('bossfade') === '0' ? null : fadeOccluders(game, { members: () => list() });
  const dt = 1 / 60;
  const space = !(game.params && game.params.get && game.params.get('bossspace') === '0');
  // SPACING RULE (critic r3: heroes standing in the lane in front of the boss hid it): a hero that stands between the
  // camera and a boss member — out of that boss's attack lane (|dz| > LANE, so he could not hit it anyway) and over
  // its screen body (|dx| < body half-width) — is eased sideways out of the boss's silhouette at ≤ PUSH m/s (like a
  // soft body block). Heroes fighting IN the lane, grabbed or behind the boss are never moved.
  const LANE = 0.45, PUSH = 2.6;
  const spacing = (B, H) => {
    const cz = game.camera ? game.camera.position.z : 99;
    for (const m of B) {
      const side = Math.sign(cz - m.pos.z) || 1;
      const half = Math.max(0.75, (m.radius || 0.5) * 1.4) + 0.3 + (m.mountedOn ? 0.5 : 0);
      for (const h of H) {
        const dz = (h.pos.z - m.pos.z) * side;
        if (dz < LANE || dz > 3.2 || h.mountedOn && h.mountedOn === m.mountedOn) continue;
        const dx = h.pos.x - m.pos.x, ax = Math.abs(dx);
        if (ax >= half) continue;
        const lk = rig.lock, mid = lk ? (lk.xMin + lk.xMax) / 2 : m.pos.x;
        const dir = ax > 0.05 ? Math.sign(dx) : (m.pos.x < mid ? 1 : -1);
        const step = Math.min(half - ax, PUSH * dt * (0.4 + 0.6 * (1 - ax / half)));
        h.pos.x += dir * step;
      }
    }
  };
  const visible = (m) => m && m.alive !== false && !m.removed && (!m.view || m.view.visible !== false);
  const gone = () => {
    if (lead.token ? !lead.token.alive : lead.removed) return true;
    const L = list();
    return !L.length || L.every((m) => !m || m.removed || (m.world && m.world !== game.world));
  };
  const top = (a) => {
    const mt = a.mountedOn;
    // C2 r13: saddleY is already world-scale (wyrm_rider scaleBeast multiplies it) — × modelScale framed the Wyrm Rider
    // ~1 m taller than she is (smaller in frame). &saddlefix=0 = old.
    const extra = mt ? (mt.saddleY || 1.2) * (SADDLE_OLD ? (mt.modelScale || 1) : 1) : 0;
    let t = (a.pos.y || 0) + (a.height || 2) + extra;
    if (mt && mt.pos) t = Math.max(t, (mt.pos.y || 0) + (mt.height || 0));
    return t;
  };
  const syncDramas = (Hb, c, fz, Dc, hC) => {
    if (!Array.isArray(rig._dramas)) return;
    for (const dr of rig._dramas) {
      if (!dr || !dr.opts) continue;
      if (dr.priority < 0 && dr.opts.focus) {
        if (dr._origFocusX === undefined) dr._origFocusX = dr.opts.focus.x;
        dr.opts.focus.x = c;
      } else if (dr.priority === 0) {
        // Hero spell drama during a boss fight: keep the boss+hero framing focus and cap pull-out so the boss stays readable
        dr.opts.focus = { x: c, y: 0, z: fz };
        if (dr.opts.distance !== undefined) dr.opts.distance = Math.min(dr.opts.distance, Dc * 1.1);
        if (dr.opts.height !== undefined) dr.opts.height = Math.min(dr.opts.height, hC + 0.8);
      } else if (dr.priority >= 4) {
        const minD = Hb / (Math.tan(((dr.opts.fov || 30) * Math.PI / 180) / 2) * 1.32);
        if (dr.opts.distance !== undefined && dr.opts.distance < minD) dr.opts.distance = minD;
        if (dr.opts.lookHeight !== undefined && Hb > 3.3) dr.opts.lookHeight = Math.max(dr.opts.lookHeight, Hb * 0.46);
      }
    }
  };
  const mode = {
    framing, blend: 0.7, id: 'boss',
    desired(d) {
      if (stopped || rig.manual) return null;
      if (gone()) { api.stop(); return null; }
      const B = list().filter(visible);
      if (!B.length) return null;
      const H = game.world.query({ kind: 'hero' }).filter((h) => h && !h.removed && h.alive !== false);
      if (space) spacing(B, H);
      const lk = rig.lock || (arena ? { xMin: arena[0], xMax: arena[1] } : null);
      const mid = lk ? (lk.xMin + lk.xMax) / 2 : null;
      const all = [...B, ...H];
      let xMin = Infinity, xMax = -Infinity, cx = 0, cz = 0;
      for (const a of all) { xMin = Math.min(xMin, a.pos.x); xMax = Math.max(xMax, a.pos.x); cx += a.pos.x; cz += a.pos.z; }
      cx /= all.length; cz /= all.length;
      const lb = (lead.members ? B[0] : (visible(lead) ? lead : B[0]));
      const Hb = Math.max(1.8, top(lb));
      const tf = Math.tan((framing.fov * Math.PI / 180) / 2), asp = (game.camera && game.camera.aspect) || 16 / 9;
      const dMax = Math.max(DMIN + 1, Math.min(base.distance * DMAXK, Hb / (tf * 0.68)));
      const fz = rig.focus ? rig.focus.z : cz, zb = lb.pos.z;
      const off = Math.atan(-FEET * tf);                      // angle of the lead's feet below the view axis
      let dd = clamp(Hb / (tf * span * 2), DMIN, dMax);       // lead-boss depth for the target span
      let c = lerp(cx, lb.pos.x, LEADPULL);
      if (mid !== null) c = lerp(c, mid, BIAS);
      if (lk) { const hw0 = rig.halfWidth(framing); c = clamp(c, lk.xMin + hw0, Math.max(lk.xMin + hw0, lk.xMax - hw0)); }
      const spreadX = (xMax - xMin) / 2 + 0.9;
      const ok = (dist) => {
        const h = dist * Math.tan(pitch + off), D = dist - (fz - zb);
        for (const a of all) {
          const da = Math.max(2.2, D + fz - a.pos.z), daF = Math.max(2.0, da - 0.35), y0 = a.pos.y || 0;
          if (Math.tan(Math.atan((h - y0) / daF) - pitch) / tf > BOT) return false;         // feet below the frame
          if (Math.tan(pitch - Math.atan((h - top(a)) / daF)) / tf > TOPN) return false;    // head above the frame
          if (spreadX > EDGE * Math.hypot(da, h - top(a) * 0.5) * tf * asp) return false;
        }
        return true;
      };
      for (let i = 0; i < 16 && dd < dMax && !ok(dd); i++) dd = Math.min(dMax, dd * 1.04);
      if (breath > 0) { dd = Math.min(dMax, dd * (1 + 0.08 * Math.min(1, breath / 0.4))); breath -= dt; }
      depth = depth === null ? dd : damp(depth, dd, dd > depth ? 3.6 : 1.8, dt);
      const hC = depth * Math.tan(pitch + off), Dc = Math.max(4, depth - (fz - zb));
      framing.distance = damp(framing.distance, Dc, 3.6, dt);
      framing.height = damp(framing.height, hC, 3.6, dt);
      framing.lookHeight = damp(framing.lookHeight, hC - Dc * Math.tan(pitch), 3.6, dt);
      const hw = rig.halfWidth(framing);
      const hwLead = Math.max(2.5, rig.halfWidth(framing, (zb + 0.3) - fz));
      const bodyW = Math.max(0.9, (lb.height || 2.8) * (lb.mountedOn ? 0.36 : 0.30));
      const maxOff = Math.max(0.5, INNER * hwLead - bodyW * 0.5);
      hwNow = hw;
      const bl = lb.pos.x;
      // constraints: lead boss's full box inside the centre band, everyone inside the outer band
      const lo = Math.max(bl - maxOff, xMax + 0.6 - EDGE * hw), hi = Math.min(bl + maxOff, xMin - 0.6 + EDGE * hw);
      c = lo <= hi ? clamp(c, lo, hi) : clamp(c, bl - maxOff, bl + maxOff);
      if (lk) c = clamp(c, lk.xMin + hw, Math.max(lk.xMin + hw, lk.xMax - hw));
      if (viewMaxX !== null || viewMinX !== null) {
        // the limits never cut a member (r13 resume): a mounted member reaches ~3 m (wyrm tail), a foot boss 1.4 m
        let rR = -Infinity, rL = Infinity;
        for (const m of list()) { if (!m || m.removed || m.alive === false) continue; const k = (m.mountedOn ? 3.0 : 1.4) + 0.3; rR = Math.max(rR, m.pos.x + k); rL = Math.min(rL, m.pos.x - k); }
        if (viewMaxX !== null) c = Math.min(c, Math.max(viewMaxX, rR) - hwLead);
        if (viewMinX !== null) c = Math.max(c, Math.min(viewMinX, rL) + hwLead);
      }
      const targetZ = lerp(d.z, cz, 0.5);
      syncDramas(Hb, c, targetZ, Dc, hC);
      // arena + camera-view soft walls (keeps boss 3D bounding box inside the frame even in wide arenas)
      const wl = lk ? lk.xMin + hw * 2 * wallLeft + 0.4 : -Infinity;
      const wr = lk ? lk.xMax - hw * 2 * (1 - wallRight) - 0.4 : Infinity;
      const fxCam = rig.focus && Number.isFinite(rig.focus.x) ? lerp(rig.focus.x, c, 0.35) : c;
      for (const m of B) {
        const x = m.pos.x;
        const hwM = Math.max(2.5, rig.halfWidth(rig.current || framing, (m.pos.z + 0.3) - fz));
        const mBodyW = Math.max(0.85, (m.height || 2.8) * (m.mountedOn ? 0.36 : 0.30));
        const pad = m === lb ? Math.max(0.55, hwM * 0.22) : Math.max(0.4, hwM * 0.14);
        const vwL = fxCam - hwM + mBodyW + pad, vwR = fxCam + hwM - mBodyW - pad;
        const loX = lk && wl < wr ? Math.max(wl, vwL) : vwL, hiX = lk && wl < wr ? Math.min(wr, vwR) : vwR;
        const minX = loX <= hiX ? loX : (vwL <= vwR ? vwL : fxCam - 0.4);
        const maxX = loX <= hiX ? hiX : (vwL <= vwR ? vwR : fxCam + 0.4);
        if (!inside.has(m)) {
          if ((x >= minX && x <= maxX) || (m.fsm && !m.fsm.is('enter', 'bossWait', 'bossIntro'))) inside.add(m);
          else continue;
        }
        if (x > maxX || x < minX) {
          const cl = clamp(x, minX, maxX);
          const hardL = fxCam - hwM + mBodyW + 0.16, hardR = fxCam + hwM - mBodyW - 0.16;
          const nx = clamp(Math.abs(x - cl) > 0.35 ? x + Math.sign(cl - x) * 0.22 : cl, hardL, hardR);
          const st = Math.abs(nx - x); stats.pushes++; stats.pushM += st; if (st > stats.maxStep) stats.maxStep = st;
          m.pos.x = nx; if (m.vel && Math.sign(m.vel.x) === Math.sign(x - nx)) m.vel.x = 0;
          const mt = m.mountedOn; if (mt && mt.pos) mt.pos.x = nx;
        }
      }
      return { x: c, z: targetZ };
    },
  };
  const api = {
    mode, lead, members: () => list(),
    get halfWidth() { return hwNow; },
    stats,
    occluders: occ,
    stop() {
      if (stopped) return;
      stopped = true;
      if (Array.isArray(rig._dramas)) for (const dr of rig._dramas) if (dr && dr.opts && dr.opts.focus && dr._origFocusX !== undefined) dr.opts.focus.x = dr._origFocusX;
      for (const f of offBus) try { f && f(); } catch (e) { /* */ }
      if (occ) { occ.stop(); if (game.removeSystem) game.removeSystem('boss.occluders'); }
      rig.clearMode(mode);
      if (game._bossCam === api) game._bossCam = null;
    },
  };
  // the fader runs as its own system: intro / drama cameras override this mode's desired() but must fade too
  if (occ && game.addSystem) game.addSystem({
    name: 'boss.occluders', order: 95,
    update: () => {
      if (stopped) return;
      if (gone()) { api.stop(); return; }
      const B = list().filter(visible);
      if (B.length) {
        const lb = (lead.members ? B[0] : (visible(lead) ? lead : B[0]));
        syncDramas(Math.max(1.8, top(lb)), rig.focus ? rig.focus.x : lb.pos.x, rig.focus ? rig.focus.z : lb.pos.z, framing.distance, framing.height);
      }
      occ.update(dt);
    },
  });
  rig.setMode(mode);
  game._bossCam = api;
  return api;
}

/** C2 r12 boss reveal camera (board r11: Morvane revealed back-on behind the card, heroes half-cut, a 5.4 m punch snap):
 *  a priority-4 drama whose focus / distance follow the boss AND every hero each tick — everyone inside ~90 % of the
 *  width, the centre biased toward the boss, the boss ≤ `fill` of the frame height and his feet ≈ 72-75 % down (clear of
 *  the lower-third name card) — through a longer lens from further back (heroes nearer the lens no longer dwarf him),
 *  orbited `yaw`° toward the heroes' side. Blends in/out; d.tick() each sim tick (the intro script calls it). */
export function revealCam(b, { yaw = 12, fov = 24, fill = 0.54, bias = 0.4, dMin = 11, dMax = 21, lookK = 0.5, lift = 0.15, out = 0.6 } = {}) {
  const g = b.game, rig = g.cameraRig;
  if (!rig || !rig.drama) return null;
  const tf = Math.tan(fov * Math.PI / 360);
  const focus = { x: b.pos.x, y: 0, z: b.pos.z };
  const o = { focus, distance: 12, height: 2.6, fov, lookHeight: b.height * 0.42, yaw: yaw * (b.facing || -1), in: 0.75, out, hold: null, priority: 4 };
  let init = false;
  const cc = {};
  const d = rig.drama(o);
  d.tick = () => {
    const asp = (g.camera && g.camera.aspect) || 16 / 9, H = Math.max(2.4, b.height);
    const hs = g.world.query({ kind: 'hero' }).filter((h) => h && !h.removed && h.alive !== false);
    let x0 = b.pos.x - 1.3, x1 = b.pos.x + 1.3;
    for (const h of hs) { x0 = Math.min(x0, h.pos.x - 0.8); x1 = Math.max(x1, h.pos.x + 0.8); }
    const cx = (x0 + x1) / 2 + (b.pos.x - (x0 + x1) / 2) * bias;
    const hw = Math.max(cx - x0, x1 - cx) / 0.9;
    const dist = Math.max(dMin, Math.min(dMax, Math.max(hw / (tf * asp), H / (fill * 2 * tf))));
    const fz = b.pos.z + 0.2;
    if (!init) { init = true; focus.x = cx; focus.z = fz; o.distance = dist; }
    const kk = 1 - Math.exp(-2.4 / 60);
    focus.x += (cx - focus.x) * kk; focus.z += (fz - focus.z) * kk;
    o.distance += (dist - o.distance) * kk;
    o.lookHeight = H * lookK - o.distance * tf * lift;
    o.height = o.lookHeight + 0.55;
    const drop = cardClear(g, [b], cc, { distance: o.distance, fov });   // C2 r13: feet clear of the card band
    o.lookHeight -= drop; o.height -= drop;
  };
  return d;
}

/** C2 r12 reveal stand-off: heroes walking in during a boss reveal stop ≥ gap m short of him (a soft wall — he is
 *  untouchable during the intro anyway) and ease into his depth lane (±0.8 m; a hero far in front read 1.6× his size),
 *  so nobody stands across his body under the name card. Call once per intro tick. */
export function introStandoff(b, t, gap = 3.4) {
  if (t < 2) return;
  for (const h of b.game.world.query({ kind: 'hero' })) {
    if (!h || h.removed || h.alive === false) continue;
    const dx = h.pos.x - b.pos.x, side = Math.sign(dx) || (b.facing || -1);
    if (Math.abs(dx) < gap) {
      const nx = b.pos.x + side * gap;
      h.pos.x += Math.sign(nx - h.pos.x) * Math.min(Math.abs(nx - h.pos.x), 0.09);
      if (h.vel && Math.sign(h.vel.x) === -side) h.vel.x = 0;
    }
    const tz = Math.max(b.pos.z - 0.7, Math.min(b.pos.z + 0.9, h.pos.z));
    if (Math.abs(tz - h.pos.z) > 1e-3) h.pos.z += Math.sign(tz - h.pos.z) * Math.min(Math.abs(tz - h.pos.z), 0.035);
  }
}

/** C2 r13 card clearance (board r12: the stage-1 lower-third covered 27–30 % of the Brutes' box): the boss name card is a
 *  skewed band (styles.js .kca-boss: top 75 %, 108 px, skewY(-4°) about its left edge → its top edge climbs to the right).
 *  Each intro tick this measures, through the camera of the last frame, how far every boss's FEET sit below the band's top
 *  edge at the boss's own screen x, and returns a camera DROP (m) — applied to both the camera height and the look height
 *  (a pure vertical shift, same pitch) — that lifts the bosses clear of it, capped so no boss head rises into the top HUD
 *  strip (10 %). Damped (no pop); relaxes when there is room. Uses the live band rect once the card exists, the CSS
 *  geometry before. state = {} per intro. `&cardclear=0` disables. */
const CARD_OFF = typeof location !== 'undefined' && /[?&]cardclear=0/.test(location.search);
const _cc = new THREE.Vector3();
export function cardBandTopFn(game) {
  const el = typeof document !== 'undefined' && document.querySelector('.kca-boss .band');
  const cv = game.renderer && game.renderer.webgl && game.renderer.webgl.domElement;
  if (el && cv && el.offsetHeight > 0) {
    const r = el.getBoundingClientRect(), c = cv.getBoundingClientRect();
    if (r.width > 4 && c.height > 0) {
      const rise = Math.max(0, r.height - el.offsetHeight);
      return (fx) => { const x = c.left + fx * c.width; return (r.top + rise * Math.max(0, Math.min(1, (r.right - x) / r.width)) - c.top) / c.height; };
    }
  }
  // CSS fallback (before the card exists): band spans -5 %..105 % of the width, top 75 %, skew 4° about its left edge
  const asp = (game.camera && game.camera.aspect) || 16 / 9, t4 = Math.tan(4 * Math.PI / 180);
  return (fx) => 0.75 - t4 * (fx + 0.05) * asp;
}
export function cardClear(game, actors, state, { distance = 12, fov = 30, margin = 0.02, headTop = 0.1, maxDrop = 1.8 } = {}) {
  if (CARD_OFF || !state) return 0;
  const cam = game.camera; if (!cam || !actors || !actors.length) return state.drop || 0;
  const top = cardBandTopFn(game);
  let over = -Infinity, room = Infinity;
  for (const a of actors) {
    if (!a || a.removed || a.alive === false || (a.view && a.view.visible === false)) continue;
    const mt = a.mountedOn, gp = mt && mt.pos ? mt.pos : a.pos;
    _cc.set(gp.x, 0, gp.z).project(cam);
    if (_cc.z > 1) continue;
    const fx = (_cc.x + 1) / 2, fy = (1 - _cc.y) / 2;
    over = Math.max(over, fy - (top(fx) - margin));
    const h = (a.pos.y || 0) + (a.height || 2) + (mt ? (mt.saddleY || 1.2) : 0);   // saddleY is already world-scale (scaleBeast scales it)
    _cc.set(a.pos.x, h, a.pos.z).project(cam);
    room = Math.min(room, (1 - _cc.y) / 2 - headTop);
  }
  if (!Number.isFinite(over)) return state.drop || 0;
  const m = 2 * distance * Math.tan(fov * Math.PI / 360);   // frame height (m) at the subject
  const d0 = state.drop || 0;
  let target = d0 + Math.min(over, Math.max(0, room)) * m;
  target = Math.max(0, Math.min(maxDrop, target));
  state.drop = d0 + (target - d0) * (1 - Math.exp(-3.2 / 60));
  return state.drop;
}
