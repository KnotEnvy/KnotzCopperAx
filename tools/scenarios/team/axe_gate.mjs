// AXE GATE (Gorrim team r25, anim role; adapted from blade_gate.mjs for the two-handed Copper Ax).
//   NODE tools/capture.mjs --host http://127.0.0.1:5190 --url "/?mode=stage&stage=duel&p1=gorrim&mute&capture=1&drs=0" \
//     --warm 0 --scenario tools/scenarios/team/axe_gate.mjs --out <dir>
// Optional env: HERO_GLB=<scratch hero_gorrim.glb> (routed, public/ untouched), GATE_STEP_MS (default 33).
// Sequence (Duel, god mode, enemies held away): idle 1 s → double-tap run right 1.2 s → stop → idle 1 s → walk left
// 1 s → double-tap run left 1.2 s → stop → idle 1 s. Every frame, the weapon 'weapon_copperax' is sampled in its own
// frame: the haft (y -0.46 butt .. 0.795 head_tip) and the double-bit head (y 0.40..0.72 × z ±0.36, bit_edge at
// y 0.56 z ±0.36). PASS = lowest axe-head point > 0.05 m above the floor every frame, no weapon sample inside a shin
// capsule (knee → ankle, r 0.08 m) or the head sphere (head bone + 0.06 m up, r 0.13 m) — "body crossings" — and
// the haft direction (hero body frame) turns ≤ 720 deg/s inside every idle/walk/run transition window.
// Writes gate.json (per frame + summary) and strip_<n>_<from>-<to>.png (8 evenly spaced frames, 0..560 ms after each
// locomotion state change, cropped around the hero).
import fs from 'node:fs';
import path from 'node:path';

const STEP = +(process.env.GATE_STEP_MS || 33);
const SHIN_R = 0.08, HEAD_R = 0.13, MIN_HEAD = 0.05, MAX_DEG_S = 720;
const WIN = [-0.1, 0.6];      // transition window (s) around a state change
const STRIP_MS = 560;

export default async (api) => {
  const GLB = process.env.HERO_GLB;
  // CAND=<clip.js>: route src/anim/clips/hero_gorrim.js to a private candidate (iterate without touching the shared tree)
  if (process.env.CAND) { const body = fs.readFileSync(process.env.CAND); await api.page.route('**/src/anim/clips/hero_gorrim.js*', (r) => r.fulfill({ body, contentType: 'text/javascript' })); }
  if (GLB || process.env.CAND) {
    if (GLB) await api.page.route('**/assets/models/hero_gorrim.glb*', (r) => r.fulfill({ body: fs.readFileSync(GLB), contentType: 'model/gltf-binary' }));
    await api.page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  }
  await api.page.waitForFunction(() => window.__KCA?.ready, null, { timeout: 180000 });
  await api.page.evaluate(() => window.__KCA.ready);
  await api.page.evaluate(() => window.__KCA.setManualClock(true));
  await api.evalGame(() => {
    const k = window.__KCA, g = k.game;
    k.debug.god(true);
    window.__gateSide = -1;
    g.addSystem({ name: 'axe-gate-space', order: 30, update() {
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
    const r = await api.evalGame(([label, SHIN_R, HEAD_R]) => {
      const k = window.__KCA, g = k.game, h = g.world.query({ kind: 'hero' })[0];
      const root = h.modelRoot || h.view;
      root.updateMatrixWorld(true);
      const V = g.camera.position.constructor, Q = g.camera.quaternion.constructor;
      const by = (n) => root.getObjectByName(n);
      const wpn = by('weapon_copperax');
      const W = (o, x = 0, y = 0, z = 0) => o.localToWorld(new V(x, y, z));
      const out = { label, t: +g.time.toFixed(4), state: h.fsm.name, clip: h.animator.name, pos: h.pos.toArray().map((x) => +x.toFixed(4)), facing: h.facing };
      const pts = [];
      for (let y = -0.46; y <= 0.8; y += 0.05) pts.push([0, y, 0, y >= 0.38 ? 1 : 0]);
      for (const y of [0.4, 0.48, 0.56, 0.64, 0.72]) for (let z = -0.36; z <= 0.361; z += 0.09) pts.push([0, y, z, 1]);
      const P = pts.map(([x, y, z, hd]) => ({ w: W(wpn, x, y, z), hd }));
      const floor = h.pos.y;
      out.headMin = +Math.min(...P.filter((p) => p.hd).map((p) => p.w.y - floor)).toFixed(4);
      out.wpnMin = +Math.min(...P.map((p) => p.w.y - floor)).toFixed(4);
      const up = new V(0, 1, 0);
      const headC = by('head').getWorldPosition(new V()).addScaledVector(up, 0.06);
      out.headClear = +(Math.min(...P.map((p) => p.w.distanceTo(headC))) - HEAD_R).toFixed(4);
      const seg = (p, a, b) => { const ab = b.clone().sub(a); const u = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq())); return p.distanceTo(a.clone().addScaledVector(ab, u)); };
      for (const s of ['L', 'R']) {
        const a = by('shin_' + s).getWorldPosition(new V()), b = by('foot_' + s).getWorldPosition(new V());
        out['shinClear' + s] = +(Math.min(...P.map((p) => seg(p.w, a, b))) - SHIN_R).toFixed(4);
      }
      // haft direction in the hero's body frame (turning around is not "whip")
      const hd = W(wpn, 0, 0.56, 0).sub(W(wpn, 0, 0, 0)).normalize().applyQuaternion(root.getWorldQuaternion(new Q()).invert());
      out.hLocal = [hd.x, hd.y, hd.z];
      const c = by('hips') ? by('hips').getWorldPosition(new V()) : h.pos.clone();
      c.project(g.camera);
      const el = g.renderer?.domElement || document.querySelector('canvas');
      out.scr = [Math.round((c.x * 0.5 + 0.5) * (el?.clientWidth || 1600)), Math.round((-c.y * 0.5 + 0.5) * (el?.clientHeight || 900))];
      return out;
    }, [label, SHIN_R, HEAD_R]);
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
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const changes = [];
  for (let i = 1; i < rows.length; i++) if (rows[i].state !== rows[i - 1].state) changes.push({ i, from: rows[i - 1].state, to: rows[i].state, t: rows[i].t });
  const loco = new Set(['idle', 'walk', 'run']);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    r.cross = r.headClear < 0 || r.shinClearL < 0 || r.shinClearR < 0;
    if (i > 0) {
      const p = rows[i - 1], dt = r.t - p.t;
      r.degS = dt > 0 ? +(Math.acos(Math.min(1, Math.max(-1, dot(r.hLocal, p.hLocal)))) * 180 / Math.PI / dt).toFixed(1) : 0;
    } else r.degS = 0;
    r.inWin = changes.some((c) => loco.has(c.from) && loco.has(c.to) && r.t >= c.t + WIN[0] && r.t <= c.t + WIN[1]);
  }
  const winRows = rows.filter((r) => r.inWin);
  const summary = {
    step_ms: STEP, frames: rows.length, glb: GLB || 'public/assets/models/hero_gorrim.glb',
    min_head_m: Math.min(...rows.map((r) => r.headMin)),
    min_head_frame: rows.reduce((m, r) => (r.headMin < m.headMin ? r : m)).frame,
    min_weapon_m: Math.min(...rows.map((r) => r.wpnMin)),
    body_crossings: rows.filter((r) => r.cross).length,
    head_crossings: rows.filter((r) => r.headClear < 0).length,
    shin_crossings: rows.filter((r) => r.shinClearL < 0 || r.shinClearR < 0).length,
    min_head_clear_m: Math.min(...rows.map((r) => r.headClear)),
    min_shin_clear_m: Math.min(...rows.map((r) => Math.min(r.shinClearL, r.shinClearR))),
    max_deg_s_transitions: Math.max(0, ...winRows.map((r) => r.degS)),
    max_deg_s_all: Math.max(...rows.map((r) => r.degS)),
    changes,
    states: [...new Set(rows.map((r) => r.state))],
  };
  summary.pass = summary.min_head_m > MIN_HEAD && summary.body_crossings === 0 && summary.max_deg_s_transitions <= MAX_DEG_S;
  summary.transitions = changes.filter((c) => loco.has(c.from) && loco.has(c.to)).map((c) => {
    const w = rows.filter((r) => r.t >= c.t + WIN[0] && r.t <= c.t + WIN[1]);
    return { from: c.from, to: c.to, frame: c.i, min_head_m: Math.min(...w.map((r) => r.headMin)), max_deg_s: Math.max(...w.map((r) => r.degS)),
      crossings: w.filter((r) => r.cross).length };
  });

  // ------------------------------------------------------------------ strips
  const sharp = (await import('sharp')).default;
  const CW = 380, CH = 440, SC = 1.4;
  let n = 0;
  for (const c of changes) {
    if (!(loco.has(c.from) && loco.has(c.to))) continue;
    const picks = [];
    for (let k = 0; k < 8; k++) {
      const tt = c.t - STEP / 1000 + (k * STRIP_MS) / 7000;
      picks.push(rows.reduce((m, x) => (Math.abs(x.t - tt) < Math.abs(m.t - tt) ? x : m)));
    }
    const tiles = await Promise.all(picks.map(async (r, k) => {
      const left = Math.round(Math.max(0, Math.min(1600 - CW, r.scr[0] - CW / 2))), top = Math.round(Math.max(0, Math.min(900 - CH, r.scr[1] - CH * 0.55)));
      const OW = Math.round(CW * SC), OH = Math.round(CH * SC);
      const good = r.headMin > MIN_HEAD && !r.cross;
      const lab = `<svg width="${OW}" height="40"><rect width="100%" height="100%" fill="#000a"/><text x="8" y="27" font-size="22" fill="${good ? '#7f7' : '#f66'}" font-family="monospace">f${r.frame} +${Math.round((r.t - c.t) * 1000)}ms head ${r.headMin.toFixed(2)}m ${Math.round(r.degS)}°/s</text></svg>`;
      const buf = await sharp(await sharp(r.img).extract({ left, top, width: CW, height: CH }).resize(OW, OH).toBuffer()).composite([{ input: Buffer.from(lab), top: 0, left: 0 }]).png().toBuffer();
      return { input: buf, left: k * (OW + 4), top: 0 };
    }));
    await sharp({ create: { width: 8 * (Math.round(CW * SC) + 4) - 4, height: Math.round(CH * SC), channels: 3, background: '#111' } }).composite(tiles).png().toFile(path.join(api.outDir, `strip_${n++}_${c.from}-${c.to}.png`));
  }
  for (const r of rows) delete r.img;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.writeFileSync(path.join(api.outDir, 'gate.json'), JSON.stringify({ summary, rows }, null, 1));
  api.log(JSON.stringify({ pass: summary.pass, min_head_m: summary.min_head_m, body_crossings: summary.body_crossings, max_deg_s: summary.max_deg_s_transitions, transitions: summary.transitions }));
};
