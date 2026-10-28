// BLADE GATE (Brann team r19, anim role). Reusable capture scenario:
//   NODE tools/capture.mjs --host http://127.0.0.1:5190 --url "/?mode=stage&stage=duel&p1=brann&mute&capture=1&drs=0" \
//     --warm 0 --scenario progress/tmp/brann_team/anim/blade_gate.mjs --out <dir>
// Optional env: BRANN_GLB=<scratch hero_brann.glb> (routed, public/ untouched), GATE_STEP_MS (default 33).
// Sequence (Duel, god mode, enemies held away): idle 1 s → double-tap run right 1.2 s → stop → idle 1 s →
// walk left 1 s → double-tap run left 1.2 s → stop → idle 1 s. Every frame: blade tip / guard / pommel world
// positions, shin capsules (knee → ankle), state + clip. PASS = tip height > 0.05 m every frame, blade segment never
// within the FRONT shin capsule, max tip angular speed ≤ 720 deg/s inside every transition window.
// Writes gate.json (per frame + summary) and strip_<n>_<from>-<to>.png (8 evenly spaced frames, 0..560 ms after
// each locomotion state change, cropped around the hero).
import fs from 'node:fs';
import path from 'node:path';

const STEP = +(process.env.GATE_STEP_MS || 33);
const SHIN_R = 0.08;          // shin + boot capsule radius (m)
const MIN_TIP = 0.05;
const MAX_DEG_S = 720;
const WIN = [-0.1, 0.6];      // transition window (s) around a state change
const STRIP_MS = 560;

export default async (api) => {
  const GLB = process.env.BRANN_GLB;
  if (GLB) {
    await api.page.route('**/assets/models/hero_brann.glb*', (r) => r.fulfill({ body: fs.readFileSync(GLB), contentType: 'model/gltf-binary' }));
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
  await api.advance(600);

  const tmp = path.join(api.outDir, '_frames');
  fs.mkdirSync(tmp, { recursive: true });
  const rows = [];
  const sample = async (label) => {
    await api.advance(STEP);
    const r = await api.evalGame((label) => {
      const k = window.__KCA, g = k.game, h = g.world.query({ kind: 'hero' })[0];
      const root = h.modelRoot || h.view;
      root.updateMatrixWorld(true);
      const W = (o, x = 0, y = 0, z = 0) => { const v = o.localToWorld(new o.position.constructor(x, y, z)); return [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)]; };
      const by = (n) => root.getObjectByName(n);
      const cam = g.camera;
      const tipN = by('blade_tip'), wpn = by('weapon_grudgebrand') || (tipN && tipN.parent);
      const out = { label, t: +g.time.toFixed(4), state: h.fsm.name, clip: h.animator.name, pos: h.pos.toArray().map((x) => +x.toFixed(4)), facing: h.facing };
      out.tip = tipN ? W(tipN) : null;
      out.guard = wpn ? W(wpn, 0, 0.05, 0) : null;
      out.pommel = wpn ? W(wpn, 0, -0.36, 0) : null;
      // blade dir in the hero's body frame (the hips' parent = model root incl. facing yaw), so turning around is not "whip"
      if (tipN && wpn) { const a = tipN.getWorldPosition(new cam.position.constructor()), b = wpn.localToWorld(new cam.position.constructor(0, 0.05, 0)); a.sub(b).normalize(); const q = root.getWorldQuaternion(new cam.quaternion.constructor()).invert(); a.applyQuaternion(q); out.bLocal = [a.x, a.y, a.z]; }
      for (const s of ['L', 'R']) { out['knee' + s] = W(by('shin_' + s)); out['ankle' + s] = W(by('foot_' + s)); }
      const c = by('hips') ? by('hips').getWorldPosition(new cam.position.constructor()) : h.pos.clone();
      c.project(cam);
      const el = g.renderer?.domElement || document.querySelector('canvas');
      out.scr = [Math.round((c.x * 0.5 + 0.5) * (el?.clientWidth || 1600)), Math.round((-c.y * 0.5 + 0.5) * (el?.clientHeight || 900))];
      return out;
    }, label);
    r.frame = rows.length;
    r.img = path.join(tmp, `f${String(r.frame).padStart(4, '0')}.jpg`);
    await api.page.screenshot({ path: r.img, type: 'jpeg', quality: 85 });
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
    t = (b * s + f) / e;
    if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    const c1 = p1.map((x, i) => x + d1[i] * s), c2 = p2.map((x, i) => x + d2[i] * t);
    return len(sub(c1, c2));
  };
  const changes = [];
  for (let i = 1; i < rows.length; i++) if (rows[i].state !== rows[i - 1].state) changes.push({ i, from: rows[i - 1].state, to: rows[i].state, t: rows[i].t });
  const loco = new Set(['idle', 'walk', 'run']);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const floor = r.pos[1];
    r.tipH = +(r.tip[1] - floor).toFixed(4);
    r.pommelH = +(r.pommel[1] - floor).toFixed(4);
    // front shin = the knee further along the facing direction
    const front = r.kneeL[0] * r.facing > r.kneeR[0] * r.facing ? 'L' : 'R';
    r.front = front;
    for (const s of ['L', 'R']) r['shinD' + s] = +(segDist(r.guard, r.tip, r['knee' + s], r['ankle' + s]) - SHIN_R).toFixed(4);
    r.frontCross = r['shinD' + front] < 0;
    const bd = sub(r.tip, r.guard), L = len(bd);
    r.bdir = bd.map((x) => x / L);
    if (i > 0) {
      const p = rows[i - 1], dt = r.t - p.t;
      const ang = Math.acos(Math.min(1, Math.max(-1, dot(r.bLocal, p.bLocal)))) * 180 / Math.PI;
      r.degSWorld = dt > 0 ? +(Math.acos(Math.min(1, Math.max(-1, dot(r.bdir, p.bdir)))) * 180 / Math.PI / dt).toFixed(1) : 0;
      r.degS = dt > 0 ? +(ang / dt).toFixed(1) : 0;
    } else r.degS = 0;
    r.inWin = changes.some((c) => loco.has(c.from) && loco.has(c.to) && r.t >= c.t + WIN[0] && r.t <= c.t + WIN[1]);
  }
  const winRows = rows.filter((r) => r.inWin);
  const summary = {
    step_ms: STEP, frames: rows.length, glb: GLB || 'public/assets/models/hero_brann.glb',
    min_tip_m: Math.min(...rows.map((r) => r.tipH)),
    min_tip_frame: rows.reduce((m, r) => (r.tipH < m.tipH ? r : m)).frame,
    min_pommel_m: Math.min(...rows.map((r) => r.pommelH)),
    front_shin_crossings: rows.filter((r) => r.frontCross).length,
    any_shin_crossings: rows.filter((r) => r.shinDL < 0 || r.shinDR < 0).length,
    min_front_shin_clear_m: Math.min(...rows.map((r) => r['shinD' + r.front])),
    max_tip_deg_s_transitions: Math.max(0, ...winRows.map((r) => r.degS)),
    max_tip_deg_s_all: Math.max(...rows.map((r) => r.degS)),
    max_tip_deg_s_world_incl_turns: Math.max(...rows.map((r) => r.degSWorld || 0)),
    changes,
    states: [...new Set(rows.map((r) => r.state))],
  };
  summary.pass = summary.min_tip_m > MIN_TIP && summary.front_shin_crossings === 0 && summary.max_tip_deg_s_transitions <= MAX_DEG_S;
  // per-transition breakdown
  summary.transitions = changes.filter((c) => loco.has(c.from) && loco.has(c.to)).map((c) => {
    const w = rows.filter((r) => r.t >= c.t + WIN[0] && r.t <= c.t + WIN[1]);
    return { from: c.from, to: c.to, frame: c.i, min_tip_m: Math.min(...w.map((r) => r.tipH)), max_deg_s: Math.max(...w.map((r) => r.degS)),
      min_front_shin_clear_m: Math.min(...w.map((r) => r['shinD' + r.front])) };
  });

  fs.writeFileSync(path.join(api.outDir, 'gate.json'), JSON.stringify({ summary, rows: rows.map(({ img, ...r }) => r) }, null, 1));
  // ------------------------------------------------------------------ strips
  const sharp = (await import('sharp')).default;
  const CW = 380, CH = 440, SC = 1.4;
  let n = 0;
  for (const c of changes) {
    if (!(loco.has(c.from) && loco.has(c.to))) continue;
    const picks = [];
    for (let k = 0; k < 8; k++) {
      const tt = c.t - STEP / 1000 + (k * STRIP_MS) / 7000;
      const r = rows.reduce((m, x) => (Math.abs(x.t - tt) < Math.abs(m.t - tt) ? x : m));
      picks.push(r);
    }
    const tiles = await Promise.all(picks.map(async (r, k) => {
      const left = Math.round(Math.max(0, Math.min(1600 - CW, r.scr[0] - CW / 2))), top = Math.round(Math.max(0, Math.min(900 - CH, r.scr[1] - CH * 0.55)));
      const label = `<svg width="${CW}" height="40"><rect width="100%" height="100%" fill="#000a"/><text x="8" y="27" font-size="22" fill="${r.tipH > MIN_TIP && !r.frontCross ? '#7f7' : '#f66'}" font-family="monospace">f${r.frame} +${Math.round((r.t - c.t) * 1000)}ms tip ${r.tipH.toFixed(2)}m ${Math.round(r.degS)}°/s</text></svg>`;
      const OW = Math.round(CW * SC), OH = Math.round(CH * SC);
      const lab = label.replaceAll(`width="${CW}"`, `width="${OW}"`);
      const buf = await sharp(await sharp(r.img).extract({ left, top, width: CW, height: CH }).resize(OW, OH).toBuffer()).composite([{ input: Buffer.from(lab), top: 0, left: 0 }]).png().toBuffer();
      return { input: buf, left: k * (OW + 4), top: 0 };
    }));
    const f = path.join(api.outDir, `strip_${n++}_${c.from}-${c.to}.png`);
    await sharp({ create: { width: 8 * (Math.round(CW * SC) + 4) - 4, height: Math.round(CH * SC), channels: 3, background: '#111' } }).composite(tiles).png().toFile(f);
  }
  for (const r of rows) delete r.img;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.writeFileSync(path.join(api.outDir, 'gate.json'), JSON.stringify({ summary, rows }, null, 1));
  api.log(JSON.stringify({ pass: summary.pass, min_tip_m: summary.min_tip_m, front_shin_crossings: summary.front_shin_crossings, max_deg_s: summary.max_tip_deg_s_transitions, transitions: summary.transitions }));
};
