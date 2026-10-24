// Weapon READ probe at the game camera (owner: hero-weapons, wave C2 r4). Same input script as weapon_stage_lhh.mjs
// (stage 1, bot, light-light-heavy, 75 x 33 ms frames) but every frame is ALSO measured in the page before the screenshot:
//   per weapon (R, L):  flat   = |dot(world flat normal (weapon +Z), camera view dir)|   1 = the FLAT faces the camera,
//                                                                                        0 = edge-on (a 1-2 px line)
//                       wpx    = projected blade width at mid-blade (px), lpx = projected grip->tip length (px)
//                       bladeDeg = angle between the blade axis and the screen plane (0 = in the screen plane)
//   per actor:          heroPx = projected head-to-foot height (px), facing, move / move frame / hitstop
//   Copper Ax (bit_edge node): the trail's newest sample tip vs the bit_edge node (world m and screen px), the number of live
//                       samples, and whether the newest samples are VISIBLE after the ribbon's self-mask (the capsule maths of
//                       src/vfx/Trails.js replicated: a sample fully inside the owner's hips->head capsule is faded to 0).
// Writes probe.json (rows + summary) and prints a summary; frames go to frame_0000.png.. like the lhh clip (use --sheet/--mp4).
//   node tools/capture.mjs --url "/?mode=stage&stage=1&p1=gorrim&bot=1" --warm 8000 --scenario tools/scenarios/weapon_read_probe.mjs \
//        --frames 75 --step 33 --sheet --mp4 --out progress/shots/hero-weapons/c2r4/probe-gorrim
import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  const n = Number(process.env.LHH_FRAMES || 75), step = Number(process.env.LHH_STEP || 33);
  const measure = () => api.evalGame(() => {
    const K = window.__KCA, g = K.game, cam = g.camera;
    const h = g.world.query({ kind: 'hero' })[0];
    if (!h || !h.model) return null;
    const m = h.model;
    const T = cam.position.constructor;
    const W = window.innerWidth, H = window.innerHeight;
    cam.updateMatrixWorld();
    const viewDir = new T(0, 0, -1).applyQuaternion(cam.quaternion).normalize();
    const px = (v) => { const p = v.clone().project(cam); return [+((p.x * 0.5 + 0.5) * W).toFixed(1), +((1 - (p.y * 0.5 + 0.5)) * H).toFixed(1)]; };
    const wp = (o) => { o.updateWorldMatrix(true, false); return new T().setFromMatrixPosition(o.matrixWorld); };
    const out = { tick: g.tick, facing: h.facing, st: h.fsm.name, move: h.attack ? h.attack.id : null, mf: h.attack ? h.attack.frame : null, hs: h.hitstop, hands: {} };
    const bones = m.rigInfo && m.rigInfo.bones;
    const head = bones && bones.get('head') && bones.get('head').node, hips = bones && bones.get('hips') && bones.get('hips').node;
    const footN = bones && (bones.get('foot_L') || bones.get('foot_R')); const foot = footN && footN.node;
    if (head && foot) { const a = px(wp(head)), b = px(wp(foot)); out.heroPx = +Math.abs(b[1] - a[1]).toFixed(1); out.headPx = a; }
    const tr = g.vfx && g.vfx.trails;
    for (const hand of ['R', 'L']) {
      const src = hand === 'L' ? m.weaponL : m.weapon; if (!src) continue;
      src.updateWorldMatrix(true, true);
      const q = new src.quaternion.constructor(); src.getWorldQuaternion(q);
      const Y = new T(0, 1, 0).applyQuaternion(q).normalize(), Z = new T(0, 0, 1).applyQuaternion(q).normalize(), X = new T(1, 0, 0).applyQuaternion(q).normalize();
      const tipNode = src.getObjectByName('blade_tip') || src.getObjectByName('head_tip');
      const bitNode = src.getObjectByName('bit_edge');
      // local bbox (mesh space -> weapon space; attachToSocket keeps meshes unscaled children)
      let maxY = 0, maxX = 0, maxZ = 0;
      src.traverse((o) => { if (o.isMesh && o.geometry) { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox; maxY = Math.max(maxY, b.max.y); maxX = Math.max(maxX, b.max.x, -b.min.x); maxZ = Math.max(maxZ, b.max.z, -b.min.z); } });
      const grip = wp(src);
      const tip = tipNode ? wp(tipNode) : grip.clone().addScaledVector(Y, maxY);
      const mid = grip.clone().lerp(tip, 0.5);
      const H1 = { flat: +Math.abs(Z.dot(viewDir)).toFixed(3), bladeDeg: +(Math.asin(Math.abs(Y.dot(viewDir))) * 180 / Math.PI).toFixed(1) };
      const g0 = px(grip), t0 = px(tip);
      H1.lpx = +Math.hypot(t0[0] - g0[0], t0[1] - g0[1]).toFixed(1);
      // width: for blades the across axis is X (edges); for the ax the bits run along Z (the broad face is X-facing)
      const across = bitNode ? Z : X, half = bitNode ? maxZ : maxX;
      const a = px(mid.clone().addScaledVector(across, half)), b = px(mid.clone().addScaledVector(across, -half));
      H1.wpx = +Math.hypot(a[0] - b[0], a[1] - b[1]).toFixed(1);
      if (bitNode) H1.flat = +Math.abs(X.dot(viewDir)).toFixed(3);   // the ax's broad face is the cheek (+-X)
      H1.gripPx = g0; H1.tipPx = t0;
      if (bitNode && tr) {
        const bit = wp(bitNode);
        const t = tr.trails.find((x) => x.actor === h && x.hand === hand && !x.dead);
        H1.bitPx = px(bit);
        if (t && t.samples.length) {
          const s0 = t.samples[0];
          H1.trail = { n: t.samples.length, emitting: !!(t.autoOn || t.until > g.time), age0: +s0.age.toFixed(3), sp0: +s0.sp.toFixed(2), tipPx: px(s0.t), dist_m: +s0.t.distanceTo(bit).toFixed(4) };
          H1.trail.dist_px = +Math.hypot(H1.trail.tipPx[0] - H1.bitPx[0], H1.trail.tipPx[1] - H1.bitPx[1]).toFixed(1);
          // self-mask check (fragment maths): capsule hips->head in projected view space, radius 0.36 L * maskScale
          if (hips && head) {
            const h0 = wp(hips), h1 = wp(head); const L = h0.distanceTo(h1);
            h0.y += L * 0.1; h1.y += L * 0.36;
            const r = Math.max(0.2, L * 0.36) * (t.style.maskScale ?? 1);
            const v0 = h0.clone().applyMatrix4(cam.matrixWorldInverse), v1 = h1.clone().applyMatrix4(cam.matrixWorldInverse);
            const z0 = Math.max(0.05, -v0.z), z1 = Math.max(0.05, -v1.z);
            const A = [v0.x / z0, v0.y / z0], B = [v1.x / z1, v1.y / z1], rr0 = r / ((z0 + z1) * 0.5);
            const vis = (p) => { const v = p.clone().applyMatrix4(cam.matrixWorldInverse); const z = Math.max(0.05, -v.z); const P = [v.x / z, v.y / z];
              const ab = [B[0] - A[0], B[1] - A[1]]; const hh = Math.max(0, Math.min(1, ((P[0] - A[0]) * ab[0] + (P[1] - A[1]) * ab[1]) / Math.max(1e-6, ab[0] * ab[0] + ab[1] * ab[1])));
              const d = Math.hypot(P[0] - A[0] - ab[0] * hh, P[1] - A[1] - ab[1] * hh); const rr = rr0 * (0.9 + 0.7 * hh);
              const u = Math.max(0, Math.min(1, (d - rr * 0.7) / (rr * 1.1))); return +(u * u * (3 - 2 * u)).toFixed(2); };
            H1.trail.maskVis = t.samples.slice(0, 4).map((s) => vis(s.t.clone().lerp(s.b, 0.35)));   // a point 35 % in from the bit toward the haft
            H1.trail.tipVis = t.samples.slice(0, 4).map((s) => vis(s.t));
          }
        } else H1.trail = null;
      }
      out.hands[hand] = H1;
    }
    return out;
  });
  const rows = [];
  await api.advance(400);
  api.press(0, 'light', 60); await api.advance(step * 12);
  api.press(0, 'light', 60); await api.advance(step * 2);
  let i = 0;
  const grab = async () => {
    const r = await measure(); if (r) { r.frame = i; rows.push(r); }
    const p = path.join(api.outDir, `frame_${String(i).padStart(4, '0')}.png`);
    await api.page.screenshot({ path: p }); i++;
  };
  for (let k = 0; k < 10; k++) { await api.advance(step); await grab(); }
  api.press(0, 'heavy', 60);
  while (i < n) { await api.advance(step); await grab(); }
  // ---- summary
  const sum = {};
  for (const hand of ['R', 'L']) {
    const rs = rows.filter((r) => r.hands[hand]); if (!rs.length) continue;
    const att = rs.filter((r) => r.move && !r.hs);
    const S = (arr, f) => arr.length ? +(arr.reduce((a, r) => a + f(r), 0) / arr.length).toFixed(3) : null;
    const mn = (arr, f) => arr.length ? +Math.min(...arr.map(f)).toFixed(3) : null;
    sum[hand] = { frames: rs.length, attackFrames: att.length, heroPx: S(rs, (r) => r.heroPx || 0),
      flat_mean_all: S(rs, (r) => r.hands[hand].flat), flat_mean_attack: S(att, (r) => r.hands[hand].flat), flat_min_attack: mn(att, (r) => r.hands[hand].flat),
      wpx_mean_attack: S(att, (r) => r.hands[hand].wpx), wpx_min_attack: mn(att, (r) => r.hands[hand].wpx), lpx_mean: S(rs, (r) => r.hands[hand].lpx),
      edgeOnAttackFrames: att.filter((r) => r.hands[hand].flat < 0.35).length };
    const tr = rs.filter((r) => r.hands[hand].trail && r.hands[hand].trail.emitting);
    if (tr.length) sum[hand].trail = { emittingFrames: tr.length, dist_m_max: Math.max(...tr.map((r) => r.hands[hand].trail.dist_m)), dist_px_max: Math.max(...tr.map((r) => r.hands[hand].trail.dist_px)),
      newestVisibleFrames: tr.filter((r) => r.hands[hand].trail.maskVis && r.hands[hand].trail.maskVis[0] > 0.3).length,
      anyOf4VisibleFrames: tr.filter((r) => r.hands[hand].trail.maskVis && r.hands[hand].trail.maskVis.some((v) => v > 0.3)).length };
  }
  for (const r of rows) {
    const hs = Object.entries(r.hands).map(([k, v]) => `${k}: flat ${v.flat} w ${v.wpx}px l ${v.lpx}px` + (v.trail ? ` trail n${v.trail.n} d${v.trail.dist_px}px vis[${(v.trail.maskVis || []).join(',')}]` : '')).join(' | ');
    api.log(`f${String(r.frame).padStart(2, '0')} ${r.move || r.st}${r.mf != null ? '#' + r.mf : ''}${r.hs ? ' HS' : ''} hero ${r.heroPx}px ${hs}`);
  }
  api.log('SUMMARY ' + JSON.stringify(sum));
  fs.writeFileSync(path.join(api.outDir, 'probe.json'), JSON.stringify({ rows, summary: sum }, null, 1));
};
