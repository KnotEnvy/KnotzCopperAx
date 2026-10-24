// Deterministic blade-facing probe (owner: hero-weapons, C2 r4). Hero showcase with the GAME camera, side view:
//   FACING_CLIPS="light_1,light_2,light_3,heavy,run_attack,run,walk,idle" \
//   node tools/capture.mjs --url "/?mode=showcase&what=hero&id=seraphine&cam=game&yaw=90&spin=0" --scenario tools/scenarios/weapon_facing.mjs --out <dir>
// Plays each clip from frame 0 and, every 60 Hz tick, measures per weapon:  flat = |dot(weapon +Z (the flat normal), view dir)|
// (1 = flat to the camera, 0 = edge-on), bladeDeg = blade axis vs the screen plane, wpx = projected width at mid-blade,
// lpx = projected grip->tip length.  Summary per clip and weapon: mean / min flat, edge-on ticks (flat < 0.35 while the blade
// is within 55 deg of the screen plane), mean / min width px.  Writes facing.json; FACING_SHOTS=1 saves a frame per clip at
// its most edge-on tick (worst_<clip>.png) for inspection.
import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  const clips = (process.env.FACING_CLIPS || 'light_1,light_2,light_3,heavy,run_attack,jump_attack,run,walk,idle').split(',');
  const shots = process.env.FACING_SHOTS === '1';
  const measure = () => api.evalGame(() => {
    const K = window.__KCA, g = K.game, cam = g.camera, h = K.showcase.actor;
    const m = h.model; const T = cam.position.constructor; const W = window.innerWidth, H = window.innerHeight;
    cam.updateMatrixWorld();
    const viewDir = new T(0, 0, -1).applyQuaternion(cam.quaternion).normalize();
    const px = (v) => { const p = v.clone().project(cam); return [(p.x * 0.5 + 0.5) * W, (1 - (p.y * 0.5 + 0.5)) * H]; };
    const wp = (o) => { o.updateWorldMatrix(true, false); return new T().setFromMatrixPosition(o.matrixWorld); };
    const out = {};
    for (const hand of ['R', 'L']) {
      const src = hand === 'L' ? m.weaponL : m.weapon; if (!src) continue;
      src.updateWorldMatrix(true, true);
      const q = new src.quaternion.constructor(); src.getWorldQuaternion(q);
      const Y = new T(0, 1, 0).applyQuaternion(q).normalize(), Z = new T(0, 0, 1).applyQuaternion(q).normalize(), X = new T(1, 0, 0).applyQuaternion(q).normalize();
      const tipNode = src.getObjectByName('blade_tip') || src.getObjectByName('head_tip'), bitNode = src.getObjectByName('bit_edge');
      let maxY = 0, maxX = 0, maxZ = 0;
      src.traverse((o) => { if (o.isMesh && o.geometry) { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox; maxY = Math.max(maxY, b.max.y); maxX = Math.max(maxX, b.max.x, -b.min.x); maxZ = Math.max(maxZ, b.max.z, -b.min.z); } });
      const grip = wp(src), tip = tipNode ? wp(tipNode) : grip.clone().addScaledVector(Y, maxY), mid = grip.clone().lerp(tip, 0.5);
      const across = bitNode ? Z : X, half = bitNode ? maxZ : maxX;
      const a = px(mid.clone().addScaledVector(across, half)), b = px(mid.clone().addScaledVector(across, -half));
      const g0 = px(grip), t0 = px(tip);
      out[hand] = { flat: +Math.abs((bitNode ? X : Z).dot(viewDir)).toFixed(3), bladeDeg: +(Math.asin(Math.abs(Y.dot(viewDir))) * 180 / Math.PI).toFixed(1),
        wpx: +Math.hypot(a[0] - b[0], a[1] - b[1]).toFixed(1), lpx: +Math.hypot(t0[0] - g0[0], t0[1] - g0[1]).toFixed(1) };
    }
    return out;
  });
  const R = {};
  for (const clip of clips) {
    const n = await api.evalGame((c) => { const K = window.__KCA; K.showcase.play(c, { loop: false, fade: 0, restart: true }); const a = K.showcase.actor; const cl = K.game.anim.clip ? K.game.anim.clip(a.def.id, c) : null; return cl ? Math.round(cl.duration * 60) : 60; }, clip);
    const ticks = Math.min(120, Math.max(12, n || 60));
    const rows = [];
    let worst = null;
    await api.advance(1);
    for (let t = 0; t < ticks; t++) {
      const r = await measure(); r.t = t; rows.push(r);
      const f = Math.min(...['R', 'L'].filter((h) => r[h] && r[h].bladeDeg < 55).map((h) => r[h].flat), 1);
      if (worst === null || f < worst.f) worst = { f, t };
      if (t < ticks - 1) await api.advance(1000 / 60);
    }
    if (shots && worst) {
      await api.evalGame((c) => window.__KCA.showcase.play(c, { loop: false, fade: 0, restart: true }), clip);
      await api.advance(1); for (let left = worst.t; left > 0; left -= 8) await api.advance(Math.min(8, left) * (1000 / 60));
      await api.shot(`worst_${clip}`);
    }
    const S = {};
    for (const hand of ['R', 'L']) {
      const rs = rows.filter((r) => r[hand]); if (!rs.length) continue;
      const inPlane = rs.filter((r) => r[hand].bladeDeg < 55);
      const mean = (arr, f) => arr.length ? +(arr.reduce((a, r) => a + f(r), 0) / arr.length).toFixed(3) : null;
      S[hand] = { ticks: rs.length, inPlane: inPlane.length, flat_mean: mean(inPlane, (r) => r[hand].flat), flat_min: inPlane.length ? Math.min(...inPlane.map((r) => r[hand].flat)) : null,
        edgeOn: inPlane.filter((r) => r[hand].flat < 0.35).length, wpx_mean: mean(inPlane, (r) => r[hand].wpx), wpx_min: inPlane.length ? Math.min(...inPlane.map((r) => r[hand].wpx)) : null, lpx_mean: mean(rs, (r) => r[hand].lpx) };
    }
    R[clip] = { ticks, summary: S, worstTick: worst, rows };
    api.log(`${clip}: ` + Object.entries(S).map(([h, s]) => `${h} flat ${s.flat_mean} (min ${s.flat_min}) edgeOn ${s.edgeOn}/${s.inPlane} w ${s.wpx_mean}px (min ${s.wpx_min}) l ${s.lpx_mean}px`).join(' | '));
  }
  const all = {};
  for (const hand of ['R', 'L']) {
    const cs = Object.values(R).filter((c) => c.summary[hand]); if (!cs.length) continue;
    const ip = cs.reduce((a, c) => a + c.summary[hand].inPlane, 0), eo = cs.reduce((a, c) => a + c.summary[hand].edgeOn, 0);
    all[hand] = { inPlaneTicks: ip, edgeOnTicks: eo, edgeOnFrac: +(eo / Math.max(1, ip)).toFixed(3), flat_mean: +(cs.reduce((a, c) => a + (c.summary[hand].flat_mean || 0) * c.summary[hand].inPlane, 0) / Math.max(1, ip)).toFixed(3) };
  }
  api.log('ALL ' + JSON.stringify(all));
  fs.writeFileSync(path.join(api.outDir, 'facing.json'), JSON.stringify({ clips: R, all }, null, 1));
};
