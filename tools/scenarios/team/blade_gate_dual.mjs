// BLADE GATE — DUAL (Seraphine team r24, anim role). Hero-generic dual-blade version of blade_gate.mjs (Brann r19),
// plus the braid angle probe and the flying-kick (run_attack) probe in the same Duel run.
//   HERO=seraphine [HERO_GLB=<scratch .glb>] NODE tools/capture.mjs --host http://127.0.0.1:5190 \
//     --url "/?mode=stage&stage=duel&p1=seraphine&mute&capture=1&drs=0" --warm 0 \
//     --scenario tools/scenarios/team/blade_gate_dual.mjs --out <dir>
// Env: HERO (default seraphine), HERO_GLB (routes /assets/models/hero_<HERO>.glb; public/ untouched), GATE_STEP_MS (33),
//      GATE_SHOTS=0 (skip screenshots + strips: metrics only, faster).
// Sequence (Duel, god mode, enemies held away): idle 1 s → run right 1.2 s → stop → idle 1 s → walk left 1 s (facing
// flip) → run left 1.2 s → stop → idle 1 s → tap right (facing flip) → idle 1 s → run right → light = run_attack
// (flying kick) → idle. Every frame, per blade (R = socket_hand_R weapon, L = socket_hand_L weapon): tip / guard / pommel
// world positions (tip/pommel = the weapon's own local bounding box ends along +Y), distance to every leg capsule (thigh
// r .085, shin r .07); hair_1..hair_5 (+ the extrapolated tip) vs down; arm segments; feet; state + clip.
// PASS (blades) = both tips > 0.05 m every frame and no blade segment inside any shin/thigh capsule outside attacks; the
// max tip angular speed (body frame) in locomotion transition windows is reported (whip_ok ≤ 720 deg/s), not gating. Braid: angle from down per frame, settle after stops / facing flips (max angle in [+0.5 s, +1.0 s]),
// min braid-to-arm distance. Kick: min sole height over the run_attack frames, apex, and limb-into-torso distance.
// r29 (anim): loincloth drape — kilt_F/B chain joints (+ tips) vs the thigh/shin capsules every frame (summary.loincloth: min
// clearance in locomotion and in the kick, penetration counts, angle from down, settle after stops/flips; pass = 0 penetrations
// and settle <= 30 deg). kilt_L/R are reported too when a rig has them weighted (Seraphine r29: unused).
// Writes gate.json (summary + per-frame rows) and, unless GATE_SHOTS=0, strip_<n>_<from>-<to>.png (8 evenly spaced
// frames 0..560 ms after each state change, cropped around the hero).
import fs from 'node:fs';
import path from 'node:path';

const HERO = process.env.HERO || 'seraphine';
const STEP = +(process.env.GATE_STEP_MS || 33);
const SHOTS = process.env.GATE_SHOTS !== '0';
const SHIN_R = 0.07, THIGH_R = 0.085;
const MIN_TIP = 0.05;
const MAX_DEG_S = 720;
const WIN = [-0.1, 0.6];
const STRIP_MS = 560;

export default async (api) => {
  const GLB = process.env.HERO_GLB;
  if (GLB) {
    const buf = fs.readFileSync(path.resolve(GLB));
    await api.page.route(`**/assets/models/hero_${HERO}.glb*`, (r) => r.fulfill({ body: buf, contentType: 'model/gltf-binary' }));
    await api.page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  }
  await api.page.waitForFunction(() => window.__KCA?.ready, null, { timeout: 180000 });
  await api.page.evaluate(() => window.__KCA.ready);
  await api.page.evaluate(() => window.__KCA.setManualClock(true));
  await api.evalGame(() => {
    const k = window.__KCA, g = k.game;
    k.debug.god(true);
    window.__gateSide = -1;
    g.addSystem({ name: 'blade-gate-space', order: 30, update() {
      const h = g.world.query({ kind: 'hero' })[0];
      for (const e of g.world.query({ team: 'enemies' })) { e.pos.x = (h ? h.pos.x : 0) + 11 * window.__gateSide; e.pos.z = 2.5; e.vel?.set(0, 0, 0); }
    } });
  });
  for (let i = 0; i < 90; i++) await api.advance(50);   // title card clears
  await api.evalGame(() => { const h = window.__KCA.game.world.query({ kind: 'hero' })[0]; h.pos.x = -6; h.pos.z = 0; h.vel.set(0, 0, 0); h.facing = 1; });
  // r30 (anim): the teleport above is a scenario artefact (no gameplay move) -> once the view has caught up with the jump, restart the
  // spring chains so the first samples do not measure a loincloth still swinging from it (r29 release: F drape 38 deg, -15 mm at frame 0).
  await api.advance(100);
  await api.evalGame(() => { const h = window.__KCA.game.world.query({ kind: 'hero' })[0]; if (h.animator?.post?.springs) h.animator.post.springs.reset(); });
  await api.advance(500);

  const tmp = path.join(api.outDir, '_frames');
  fs.mkdirSync(tmp, { recursive: true });
  const rows = [];
  const sample = async (label) => {
    await api.advance(STEP);
    const r = await api.evalGame((label) => {
      const k = window.__KCA, g = k.game, h = g.world.query({ kind: 'hero' })[0];
      const root = h.modelRoot || h.view;
      root.updateMatrixWorld(true);
      const V3 = g.camera.position.constructor, Q = g.camera.quaternion.constructor;
      const r4 = (v) => [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)];
      const W = (o, x = 0, y = 0, z = 0) => r4(o.localToWorld(new V3(x, y, z)));
      const by = (n) => root.getObjectByName(n);
      const weapon = (s) => { const sk = by('socket_hand_' + s); if (!sk) return null; for (const c of sk.children) if (!c.isBone && c.type !== 'Bone') return c; return null; };
      // weapon local extent along +Y (cached per weapon object)
      const ext = (w) => {
        if (w.userData.__gateExt) return w.userData.__gateExt;
        let lo = Infinity, hi = -Infinity; const inv = w.matrixWorld.clone().invert(), v = new V3();
        w.traverse((o) => { if (!o.isMesh) return; const p = o.geometry.attributes.position; for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).applyMatrix4(inv); lo = Math.min(lo, v.y); hi = Math.max(hi, v.y); } });
        return (w.userData.__gateExt = { lo, hi, name: w.name });
      };
      const out = { label, t: +g.time.toFixed(4), state: h.fsm.name, clip: h.animator.name, pos: h.pos.toArray().map((x) => +x.toFixed(4)), facing: h.facing };
      const qi = root.getWorldQuaternion(new Q()).invert();
      for (const s of ['R', 'L']) {
        const w = weapon(s);
        if (!w) { out['tip' + s] = null; continue; }
        const e = ext(w);
        out['wname' + s] = e.name;
        out['tip' + s] = W(w, 0, e.hi, 0);
        out['guard' + s] = W(w, 0, 0.05, 0);
        out['pommel' + s] = W(w, 0, e.lo, 0);
        const a = w.localToWorld(new V3(0, e.hi, 0)).sub(w.localToWorld(new V3(0, 0.05, 0))).normalize().applyQuaternion(qi);
        out['bLocal' + s] = [a.x, a.y, a.z];
      }
      for (const s of ['L', 'R']) {
        out['thigh' + s] = W(by('thigh_' + s)); out['knee' + s] = W(by('shin_' + s)); out['ankle' + s] = W(by('foot_' + s));
        out['toe' + s] = W(by('toe_' + s) || by('foot_' + s));
        out['ua' + s] = W(by('upperarm_' + s)); out['fa' + s] = W(by('forearm_' + s)); out['hand' + s] = W(by('hand_' + s));
      }
      out.hipsW = W(by('hips')); out.neckW = W(by('neck') || by('chest')); out.headW = W(by('head'));
      const hair = [];
      for (let i = 1; i <= 9; i++) { const b = by('hair_' + i); if (!b) break; hair.push(W(b)); }
      if (hair.length >= 2) { // extrapolate the last bone's tip (its length = previous segment)
        const a = hair[hair.length - 2], b = hair[hair.length - 1];
        hair.push(b.map((x, i) => +(x + (x - a[i])).toFixed(4)));
      }
      out.hair = hair;
      // r29 (anim): loincloth panels on kilt_F/B (kilt_L/R unused): chain joints + extrapolated tips, for the drape probe
      out.kilt = {};
      for (const ch of ['F', 'B', 'L', 'R']) {
        const pts = [];
        for (let i = 1; i <= 9; i++) { const b = by(`kilt_${ch}_${i}`); if (!b) break; pts.push(W(b)); }
        if (pts.length >= 2) { const a = pts[pts.length - 2], b = pts[pts.length - 1]; pts.push(b.map((x, i) => +(x + (x - a[i])).toFixed(4))); }
        if (pts.length) out.kilt[ch] = pts;
      }
      const c = by('hips') ? by('hips').getWorldPosition(new V3()) : h.pos.clone();
      c.project(g.camera);
      const el = g.renderer?.domElement || document.querySelector('canvas');
      out.scr = [Math.round((c.x * 0.5 + 0.5) * (el?.clientWidth || 1600)), Math.round((-c.y * 0.5 + 0.5) * (el?.clientHeight || 900))];
      return out;
    }, label);
    r.frame = rows.length;
    if (SHOTS) {
      r.img = path.join(tmp, `f${String(r.frame).padStart(4, '0')}.jpg`);
      await api.page.screenshot({ path: r.img, type: 'jpeg', quality: 85 });
    }
    rows.push(r);
  };
  const run = async (n, label) => { for (let i = 0; i < n; i++) await sample(label); };
  const N = (s) => Math.round((s * 1000) / STEP);

  await run(N(1), 'idle');
  await api.press(1, 'right', 35); await run(2, 'tap'); await api.hold(1, 'right', true);
  await run(N(1.2), 'run');
  await api.hold(1, 'right', false);
  await run(N(1.0), 'stop-idle');
  await api.evalGame(() => { window.__gateSide = 1; });
  await api.hold(1, 'left', true); await run(N(1.0), 'walk');
  await api.hold(1, 'left', false); await run(1, 'retap'); await api.press(1, 'left', 35); await run(2, 'tap2'); await api.hold(1, 'left', true);
  await run(N(1.2), 'run2');
  await api.hold(1, 'left', false);
  await run(N(1.0), 'stop-idle2');
  await api.evalGame(() => { window.__gateSide = -1; });
  await api.press(1, 'right', 60); await run(N(1.2), 'flip-idle');
  // flying kick
  await api.press(1, 'right', 35); await run(2, 'tap3'); await api.hold(1, 'right', true);
  await run(N(0.6), 'run3');
  await api.press(1, 'light', 60);
  await run(N(0.9), 'kick');
  await api.hold(1, 'right', false);
  await run(N(0.8), 'kick-idle');

  // ------------------------------------------------------------------ metrics
  const sub = (a, b) => a.map((x, i) => x - b[i]);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len = (a) => Math.hypot(...a);
  const segDist = (p1, q1, p2, q2) => {   // closest distance between segments (Ericson)
    const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
    const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
    let s, t;
    const c = dot(d1, r), b = dot(d1, d2), den = a * e - b * b;
    s = den > 1e-9 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
    t = e > 1e-12 ? (b * s + f) / e : 0;
    if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    const c1 = p1.map((x, i) => x + d1[i] * s), c2 = p2.map((x, i) => x + d2[i] * t);
    return len(sub(c1, c2));
  };
  const deg = (x) => (x * 180) / Math.PI;
  const changes = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].state !== rows[i - 1].state) changes.push({ i, from: rows[i - 1].state, to: rows[i].state, t: rows[i].t, kind: 'state' });
    else if (rows[i].facing !== rows[i - 1].facing) changes.push({ i, from: rows[i - 1].state, to: rows[i].state, t: rows[i].t, kind: 'flip' });
  }
  const loco = new Set(['idle', 'walk', 'run']);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const floor = r.pos[1];
    const front = r.kneeL[0] * r.facing > r.kneeR[0] * r.facing ? 'L' : 'R';
    r.front = front;
    for (const b of ['R', 'L']) {
      if (!r['tip' + b]) continue;
      r['tipH' + b] = +(r['tip' + b][1] - floor).toFixed(4);
      r['pommelH' + b] = +(r['pommel' + b][1] - floor).toFixed(4);
      for (const s of ['L', 'R']) {
        r[`shin${b}${s}`] = +(segDist(r['guard' + b], r['tip' + b], r['knee' + s], r['ankle' + s]) - SHIN_R).toFixed(4);
        r[`thigh${b}${s}`] = +(segDist(r['guard' + b], r['tip' + b], r['thigh' + s], r['knee' + s]) - THIGH_R).toFixed(4);
      }
      r['frontCross' + b] = r[`shin${b}${front}`] < 0;
      if (i > 0 && rows[i - 1]['bLocal' + b]) {
        const p = rows[i - 1], dt = r.t - p.t;
        r['degS' + b] = dt > 0 ? +(deg(Math.acos(Math.min(1, Math.max(-1, dot(r['bLocal' + b], p['bLocal' + b]))))) / dt).toFixed(1) : 0;
      } else r['degS' + b] = 0;
    }
    // braid: hair_1 → tip vs down; back = along -facing (world X), side = world Z (toward / away from the camera)
    if (r.hair && r.hair.length >= 2) {
      const v = sub(r.hair[r.hair.length - 1], r.hair[0]), L = len(v);
      r.braidDown = +deg(Math.acos(Math.min(1, Math.max(-1, -v[1] / L)))).toFixed(1);
      r.braidBack = +deg(Math.atan2(-v[0] * r.facing, -v[1])).toFixed(1);
      r.braidSide = +deg(Math.atan2(v[2], -v[1])).toFixed(1);
      let dArm = Infinity, armHit = '';
      for (let j = 1; j < r.hair.length; j++) for (const s of ['L', 'R']) for (const [a, b, nm] of [[r['ua' + s], r['fa' + s], 'upperarm'], [r['fa' + s], r['hand' + s], 'forearm']]) {
        const d = segDist(r.hair[j - 1], r.hair[j], a, b);
        if (d < dArm) { dArm = d; armHit = `${nm}_${s}@hair_${j}`; }
      }
      r.braidArm = +dArm.toFixed(4); r.braidArmAt = armHit;
      // r29 (front braid on a chain that pivots behind the head): the chain vs the TORSO axis (neck -> hips), sagittal (+ = the
      // chain further BACK than the torso axis = the plait pressed into the chest; - = lifted off it) and lateral (+ = toward +Z).
      const ax = sub(r.hipsW, r.neckW), La = len(ax);
      const fwd = [r.facing, 0, 0], side = [0, 0, 1];
      const vs = [dot(v, fwd), v[1], dot(v, side)].map((x) => x / L), as = [dot(ax, fwd), ax[1], dot(ax, side)].map((x) => x / La);
      r.braidTorso = +(deg(Math.atan2(-vs[0], -vs[1])) - deg(Math.atan2(-as[0], -as[1]))).toFixed(1);
      r.braidTorsoSide = +(deg(Math.atan2(vs[2], -vs[1])) - deg(Math.atan2(as[2], -as[1]))).toFixed(1);
    }
    // loincloth drape (r29): min clearance of every kilt_F/B segment from the thigh + shin capsules (negative = inside), angle from down
    if (r.kilt) {
      r.drape = {};
      for (const [ch, pts] of Object.entries(r.kilt)) {
        let dmin = Infinity, at = '';
        for (let j = 2; j < pts.length; j++) for (const s of ['L', 'R']) {   // j >= 2: the root segment is pinned under the belt
          const dt = segDist(pts[j - 1], pts[j], r['thigh' + s], r['knee' + s]) - THIGH_R;
          const ds = segDist(pts[j - 1], pts[j], r['knee' + s], r['ankle' + s]) - SHIN_R;
          if (dt < dmin) { dmin = dt; at = `thigh_${s}@${j}`; }
          if (ds < dmin) { dmin = ds; at = `shin_${s}@${j}`; }
        }
        const v = sub(pts[pts.length - 1], pts[0]), L = len(v);
        r.drape[ch] = { clear: +dmin.toFixed(4), at, down: +deg(Math.acos(Math.min(1, Math.max(-1, -v[1] / L)))).toFixed(1),
          back: +deg(Math.atan2(-v[0] * r.facing, -v[1])).toFixed(1) };
      }
    }
    // feet / kick
    r.soleL = +(Math.min(r.ankleL[1], r.toeL[1]) - floor).toFixed(4);
    r.soleR = +(Math.min(r.ankleR[1], r.toeR[1]) - floor).toFixed(4);
    r.hipsH = +(r.hipsW[1] - floor).toFixed(4);
    r.rootY = +floor.toFixed(4);
    let lt = Infinity;
    for (const s of ['L', 'R']) lt = Math.min(lt, segDist(r['knee' + s], r['ankle' + s], r.hipsW, r.neckW), segDist(r['fa' + s], r['hand' + s], r.hipsW, r.neckW));
    r.limbTorso = +lt.toFixed(4);
    r.inWin = changes.some((c) => c.kind === 'state' && loco.has(c.from) && loco.has(c.to) && r.t >= c.t + WIN[0] && r.t <= c.t + WIN[1]);
  }
  const blade = {};
  const legRows = rows.filter((r) => r.state !== 'run_attack' && !/attack|kick/.test(r.clip || ''));
  for (const b of ['R', 'L']) {
    const rr = rows.filter((r) => r['tip' + b]);
    if (!rr.length) continue;
    const lr = legRows.filter((r) => r['tip' + b]);
    const win = rr.filter((r) => r.inWin);
    blade[b] = {
      weapon: rr[0]['wname' + b],
      min_tip_m: Math.min(...rr.map((r) => r['tipH' + b])),
      min_tip_frame: rr.reduce((m, r) => (r['tipH' + b] < m['tipH' + b] ? r : m)).frame,
      min_pommel_m: Math.min(...rr.map((r) => r['pommelH' + b])),
      front_shin_crossings_loco: lr.filter((r) => r['frontCross' + b]).length,
      any_shin_contacts_loco: lr.filter((r) => r[`shin${b}L`] < 0 || r[`shin${b}R`] < 0).length,
      any_thigh_contacts_loco: lr.filter((r) => r[`thigh${b}L`] < 0 || r[`thigh${b}R`] < 0).length,
      min_shin_clear_m: Math.min(...lr.map((r) => Math.min(r[`shin${b}L`], r[`shin${b}R`]))),
      min_thigh_clear_m: Math.min(...lr.map((r) => Math.min(r[`thigh${b}L`], r[`thigh${b}R`]))),
      max_tip_deg_s_transitions: Math.max(0, ...win.map((r) => r['degS' + b])),
    };
    // r24 brief gate: tip > 0.05 m and never through a leg (shin or thigh capsule, either leg). Brann's 720 deg/s whip limit is
    // reported (whip_ok) but not gating: the dual-sabre front-guard → trailing-carry swap is a deliberate fast flourish.
    blade[b].whip_ok = blade[b].max_tip_deg_s_transitions <= MAX_DEG_S;
    blade[b].pass = blade[b].min_tip_m > MIN_TIP && blade[b].any_shin_contacts_loco === 0 && blade[b].any_thigh_contacts_loco === 0;
  }
  // braid settle after stops (→ idle) and facing flips
  // r29: only transitions whose idle holds >= 1 s count (a tap -> idle -> run within the window measured the run, not the settle)
  const stable = (c) => !changes.some((d) => d.i > c.i && d.t < c.t + 1.0);
  const settle = changes.filter((c) => (c.kind === 'flip' || (c.to === 'idle' && c.from !== 'idle')) && stable(c)).map((c) => {
    const w = rows.filter((r) => r.t >= c.t + 0.5 && r.t <= c.t + 1.0 && r.braidDown != null);
    const after = rows.filter((r) => r.t >= c.t && r.t <= c.t + 1.0);
    let tSettle = null;
    for (let j = 0; j < after.length; j++) if (after.slice(j).every((r) => r.braidDown <= 30)) { tSettle = +(after[j].t - c.t).toFixed(3); break; }
    return { kind: c.kind, from: c.from, to: c.to, frame: c.i, max_down_deg_0_5_1_0s: w.length ? Math.max(...w.map((r) => r.braidDown)) : null,
      peak_down_deg_0_1s: Math.max(...after.map((r) => r.braidDown ?? 0)), settle_s: tSettle };
  });
  const br = rows.filter((r) => r.braidDown != null);
  const byLabel = (re) => br.filter((r) => re.test(r.label));
  const stat = (rr, k) => rr.length ? { min: Math.min(...rr.map((r) => r[k])), max: Math.max(...rr.map((r) => r[k])), mean: +(rr.reduce((s, r) => s + r[k], 0) / rr.length).toFixed(1) } : null;
  const braid = {
    idle_down: stat(byLabel(/^idle$/), 'braidDown'), run_down: stat(byLabel(/^run/), 'braidDown'),
    run_back: stat(byLabel(/^run/), 'braidBack'), all_side_abs_max: Math.max(...br.map((r) => Math.abs(r.braidSide))),
    max_down_all: Math.max(...br.map((r) => r.braidDown)),
    min_arm_dist_m: Math.min(...br.map((r) => r.braidArm)), min_arm_at: br.reduce((m, r) => (r.braidArm < m.braidArm ? r : m)).braidArmAt,
    settle, settle_worst_deg: Math.max(0, ...settle.map((s) => s.max_down_deg_0_5_1_0s ?? 0)),
    // vs the torso axis (r29 front braid): idle mean = the rest offset; run/stops: max back (into the chest) and min (lifted)
    torso_idle: stat(byLabel(/^idle$/), 'braidTorso'), torso_run: stat(byLabel(/^run/), 'braidTorso'),
    torso_all: stat(br, 'braidTorso'), torso_side_all: stat(br, 'braidTorsoSide'),
    torso_stops: stat(byLabel(/stop|flip|kick-idle/), 'braidTorso'),
  };
  const kr = rows.filter((r) => r.state === 'run_attack' || /run_attack/.test(r.clip || ''));
  const kick = kr.length ? {
    frames: kr.length, clip: kr[0].clip,
    min_sole_m: Math.min(...kr.map((r) => Math.min(r.soleL, r.soleR))),
    sole_at_apex_m: (() => { const a = kr.reduce((m, r) => (r.rootY > m.rootY ? r : m)); return { rootY: a.rootY, soleL: a.soleL, soleR: a.soleR, frame: a.frame }; })(),
    max_root_rise_m: +(Math.max(...kr.map((r) => r.rootY)) - Math.min(...rows.map((r) => r.rootY))).toFixed(4),
    min_limb_torso_m: Math.min(...kr.map((r) => r.limbTorso)),
  } : { frames: 0, note: 'run_attack not reached' };
  // loincloth summary (r29): per kilt chain — min clearance in locomotion and in the kick, frames inside a thigh/shin capsule,
  // angle from down at idle / run, settle (max angle in [+0.5, +1.0 s] after stops and flips). Gate: no penetration (clear >= 0) in
  // idle/walk/run and in the kick (run_attack), settle <= 30 deg.
  const dr = rows.filter((r) => r.drape);
  const loincloth = {};
  for (const ch of Object.keys(dr[0]?.drape || {})) {
    const lr = dr.filter((r) => loco.has(r.state) && !/attack|kick/.test(r.clip || ''));
    const kr2 = dr.filter((r) => r.state === 'run_attack' || /run_attack/.test(r.clip || ''));
    const st = (rr) => rr.length ? +Math.min(...rr.map((r) => r.drape[ch].clear)).toFixed(4) : null;
    const ang = (rr) => rr.length ? { min: Math.min(...rr.map((r) => r.drape[ch].down)), max: Math.max(...rr.map((r) => r.drape[ch].down)), mean: +(rr.reduce((s, r) => s + r.drape[ch].down, 0) / rr.length).toFixed(1) } : null;
    const settleK = changes.filter((c) => (c.kind === 'flip' || (c.to === 'idle' && c.from !== 'idle')) && stable(c)).map((c) => {
      const w = dr.filter((r) => r.t >= c.t + 0.5 && r.t <= c.t + 1.0);
      return { from: c.from, to: c.to, kind: c.kind, frame: c.i, max_down_deg_0_5_1_0s: w.length ? Math.max(...w.map((r) => r.drape[ch].down)) : null };
    });
    loincloth[ch] = {
      min_clear_loco_m: st(lr), penetrations_loco: lr.filter((r) => r.drape[ch].clear < 0).length,
      min_clear_kick_m: st(kr2), penetrations_kick: kr2.filter((r) => r.drape[ch].clear < 0).length,
      min_clear_all_m: st(dr), min_at: dr.reduce((m, r) => (r.drape[ch].clear < m.drape[ch].clear ? r : m)).drape[ch].at,
      idle_down: ang(dr.filter((r) => /^idle$/.test(r.label))), run_down: ang(dr.filter((r) => /^run/.test(r.label))), max_down_all: Math.max(...dr.map((r) => r.drape[ch].down)),
      settle_worst_deg: Math.max(0, ...settleK.map((s) => s.max_down_deg_0_5_1_0s ?? 0)), settle: settleK,
    };
    loincloth[ch].pass = loincloth[ch].penetrations_loco === 0 && loincloth[ch].penetrations_kick === 0 && loincloth[ch].settle_worst_deg <= 30;
  }
  const summary = {
    hero: HERO, step_ms: STEP, frames: rows.length, glb: GLB || `public/assets/models/hero_${HERO}.glb`,
    blade, pass: Object.values(blade).length === 2 && Object.values(blade).every((b) => b.pass),
    braid, kick, loincloth,
    transitions: changes.filter((c) => c.kind === 'state' && loco.has(c.from) && loco.has(c.to)).map((c) => {
      const w = rows.filter((r) => r.t >= c.t + WIN[0] && r.t <= c.t + WIN[1]);
      const o = { from: c.from, to: c.to, frame: c.i };
      for (const b of ['R', 'L']) if (w[0]?.['tip' + b]) { o['min_tip_' + b] = Math.min(...w.map((r) => r['tipH' + b])); o['max_deg_s_' + b] = Math.max(...w.map((r) => r['degS' + b])); o['min_front_shin_' + b] = Math.min(...w.map((r) => r[`shin${b}${r.front}`])); }
      return o;
    }),
    changes, states: [...new Set(rows.map((r) => r.state))], clips: [...new Set(rows.map((r) => r.clip))],
  };
  // ------------------------------------------------------------------ strips
  if (SHOTS) {
    const sharp = (await import('sharp')).default;
    const CW = 380, CH = 440, SC = 1.2;
    let n = 0;
    for (const c of changes) {
      const picks = [];
      for (let k = 0; k < 8; k++) {
        const tt = c.t - STEP / 1000 + (k * STRIP_MS) / 7000;
        picks.push(rows.reduce((m, x) => (Math.abs(x.t - tt) < Math.abs(m.t - tt) ? x : m)));
      }
      const OW = Math.round(CW * SC), OH = Math.round(CH * SC);
      const tiles = await Promise.all(picks.map(async (r, k) => {
        const left = Math.round(Math.max(0, Math.min(1600 - CW, r.scr[0] - CW / 2))), top = Math.round(Math.max(0, Math.min(900 - CH, r.scr[1] - CH * 0.55)));
        const ok = (r.tipHR ?? 1) > MIN_TIP && (r.tipHL ?? 1) > MIN_TIP && !r.frontCrossR && !r.frontCrossL;
        const lab = `<svg width="${OW}" height="58"><rect width="100%" height="100%" fill="#000a"/><text x="8" y="24" font-size="20" fill="${ok ? '#7f7' : '#f66'}" font-family="monospace">f${r.frame} +${Math.round((r.t - c.t) * 1000)}ms ${r.clip}</text><text x="8" y="50" font-size="20" fill="${(r.braidDown ?? 0) <= 30 ? '#7cf' : '#fc6'}" font-family="monospace">tip R${(r.tipHR ?? 0).toFixed(2)} L${(r.tipHL ?? 0).toFixed(2)} braid ${Math.round(r.braidDown ?? 0)}°</text></svg>`;
        const buf = await sharp(await sharp(r.img).extract({ left, top, width: CW, height: CH }).resize(OW, OH).toBuffer()).composite([{ input: Buffer.from(lab), top: 0, left: 0 }]).png().toBuffer();
        return { input: buf, left: k * (OW + 4), top: 0 };
      }));
      const f = path.join(api.outDir, `strip_${String(n++).padStart(2, '0')}_${c.kind === 'flip' ? 'flip_' : ''}${c.from}-${c.to}.png`);
      await sharp({ create: { width: 8 * (OW + 4) - 4, height: OH, channels: 3, background: '#111' } }).composite(tiles).png().toFile(f);
    }
  }
  for (const r of rows) delete r.img;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.writeFileSync(path.join(api.outDir, 'gate.json'), JSON.stringify({ summary, rows }, null, 1));
  api.log(JSON.stringify({ pass: summary.pass, blade, braid: { ...braid, settle: undefined }, kick,
    loincloth: Object.fromEntries(Object.entries(loincloth).map(([k, v]) => [k, { ...v, settle: undefined }])) }));
};
