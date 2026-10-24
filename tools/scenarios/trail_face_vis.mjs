// Visible-ribbon / blade-glint vs face sweep (owner: heroes-anim, wave C1). Use with /?mode=showcase&what=moveset&id=<hero>.
//   node tools/capture.mjs --url "/?mode=showcase&what=moveset&id=seraphine" --scenario tools/scenarios/trail_face_vis.mjs --warm 800 --out <dir>
// Stricter than trail_face.mjs: it replicates the Trails.js fragment maths (crescent alpha profile × self-mask
// capsule fade) in JS for sample points ACROSS each ribbon segment, so it measures what is actually drawn, not just
// where the geometry is. A TRAIL LEAK = a sample with effective alpha > TRAIL_AMIN (default 0.08) inside the head disc
// (radius TRAIL_HEAD_R m, default 0.13, around the head bone + 0.08 m).
// C1 r4 (board r3: "the face problem moved from the trail to the BLADE"): every frame ALSO
//   (a) projects each weapon's grip->tip segment and flags frames where a blade passes inside the head disc IN FRONT
//       of the head (bladeFrames), and
//   (b) reads the rendered frame back (TRAIL_PIX=0 to skip) and counts HOT pixels (luma > TRAIL_HOT_T, default 215)
//       inside the head disc: a frame with more than TRAIL_HOT_N (default 10) hot pixels is a HOT-OVER-FACE frame
//       whatever draws it (blade glint, ribbon, spark) -- tagged 'blade' when a blade is over the head, else 'other'.
// Steps TRAIL_FRAMES frames (default 600 × 33 ms = the whole move list), saves up to 24 flagged frames
// (leak_<i>.png / hot_<i>.png) and writes vis.json + a summary line.
import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  const N = Number(process.env.TRAIL_FRAMES || 600);
  const AMIN = Number(process.env.TRAIL_AMIN || 0.08);
  const HEAD_R = Number(process.env.TRAIL_HEAD_R || 0.13);
  const PIX = process.env.TRAIL_PIX !== '0';
  const HOT_T = Number(process.env.TRAIL_HOT_T || 215);
  const HOT_N = Number(process.env.TRAIL_HOT_N || 10);
  const NEAR = Number(process.env.TRAIL_NEAR || 0); // > 0: also save frames whose nearest visible ribbon sample is < NEAR head radii (near_<i>.png)
  let sharp = null;
  if (PIX) { try { sharp = (await import('sharp')).default; } catch (e) { api.log('trail_face_vis: sharp unavailable, pixel readback off'); } }
  const rows = [];
  let leakFrames = 0, nearFrames = 0, bladeFrames = 0, hotFrames = 0, hotBlade = 0, worst = null, worstHot = null, saved = 0;
  for (let i = 0; i < N; i++) {
    await api.advance(33);
    const s = await api.evalGame(([amin, headR]) => {
      const K = window.__KCA, g = K.game, t = g.vfx.trails, cam = g.camera;
      const h = K.showcase.actor;
      const bones = h.model && h.model.rigInfo && h.model.rigInfo.bones;
      const head = bones && bones.get('head') && bones.get('head').node;
      if (!head) return null;
      const T = head.position.constructor;
      const hw = new T(); head.getWorldPosition(hw); hw.y += 0.08;
      cam.updateMatrixWorld();
      const hv = hw.clone().applyMatrix4(cam.matrixWorldInverse);
      const hz = Math.max(0.05, -hv.z);
      const hpx = hv.x / hz, hpy = hv.y / hz, hr = headR / hz;
      const hp = hw.clone().project(cam);
      const W = window.innerWidth, H = window.innerHeight;
      const sx = Math.round((hp.x * 0.5 + 0.5) * W), sy = Math.round((1 - (hp.y * 0.5 + 0.5)) * H);
      // head radius in screen px: project a point one headR to the camera's right of the head centre
      const right = new T(1, 0, 0).applyQuaternion(cam.quaternion);
      const hp2 = hw.clone().addScaledVector(right, headR).project(cam);
      const rpx = Math.abs((hp2.x - hp.x) * 0.5 * W);
      const smooth = (e0, e1, x) => { const u = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return u * u * (3 - 2 * u); };
      // ---- (a) blades: grip->tip segment of each weapon in projected space
      const blades = [];
      let bladeMinD = 1e9, bladeFront = false;
      const M4 = cam.matrixWorldInverse.constructor;
      for (const w of [h.model && h.model.weapon, h.model && h.model.weaponL]) {
        if (!w) continue;
        if (!w.userData.__bladeAxis) {
          w.updateWorldMatrix(true, true);
          const inv = new M4().copy(w.matrixWorld).invert();
          const bb = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] };
          w.traverse((m) => {
            if (!m.isMesh || !m.geometry) return;
            if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
            const b = m.geometry.boundingBox, mm = new M4().multiplyMatrices(inv, m.matrixWorld);
            for (const cx of [b.min.x, b.max.x]) for (const cy of [b.min.y, b.max.y]) for (const cz of [b.min.z, b.max.z]) {
              const p = new T(cx, cy, cz).applyMatrix4(mm);
              for (let k = 0; k < 3; k++) { const v = p.getComponent(k); if (v < bb.min[k]) bb.min[k] = v; if (v > bb.max[k]) bb.max[k] = v; }
            }
          });
          const ext = [[bb.max[0], 0, 1], [-bb.min[0], 0, -1], [bb.max[1], 1, 1], [-bb.min[1], 1, -1], [bb.max[2], 2, 1], [-bb.min[2], 2, -1]];
          let bi = 0; for (let k = 1; k < 6; k++) if (ext[k][0] > ext[bi][0]) bi = k;
          const ax = new T(); ax.setComponent(ext[bi][1], ext[bi][2]);
          w.userData.__bladeAxis = { axis: ax, len: ext[bi][0] };
        }
        const { axis, len } = w.userData.__bladeAxis;
        const b0 = new T(0, 0, 0).applyMatrix4(w.matrixWorld).applyMatrix4(cam.matrixWorldInverse);
        const b1 = axis.clone().multiplyScalar(len).applyMatrix4(w.matrixWorld).applyMatrix4(cam.matrixWorldInverse);
        const z0 = Math.max(0.05, -b0.z), z1 = Math.max(0.05, -b1.z);
        const ax0 = b0.x / z0, ay0 = b0.y / z0, ax1 = b1.x / z1, ay1 = b1.y / z1;
        const dx = ax1 - ax0, dy = ay1 - ay0;
        const tt = Math.max(0, Math.min(1, ((hpx - ax0) * dx + (hpy - ay0) * dy) / Math.max(1e-9, dx * dx + dy * dy)));
        const d = Math.hypot(hpx - ax0 - dx * tt, hpy - ay0 - dy * tt) / hr;
        const zAt = z0 + (z1 - z0) * tt;
        const front = zAt < hz + headR;           // nearer to the camera than the far side of the head
        blades.push({ d: +d.toFixed(2), front });
        if (d < bladeMinD) { bladeMinD = d; bladeFront = front; }
      }
      // ---- (b) ribbon samples (unchanged r3 maths + the r4 wider mask band)
      let minD = 1e9, vis = 0, leaks = 0, maxA = 0, bcOff = 0;
      if (t.geo.drawRange.count) {
        const pos = t.aPos.array, col = t.aCol.array, uv = t.aUv.array, bod = t.aBody.array;
        const n = t.geo.drawRange.count, idx = t.geo.index.array;
        const P0 = new T(), P1 = new T(), Q = new T();
        const seen = new Set();
        for (let k = 0; k < n; k++) {
          const vi = idx[k] & ~1;          // pair (inner edge = even, tip edge = odd)
          if (seen.has(vi)) continue; seen.add(vi);
          const a0 = col[vi * 4 + 3], a1 = col[(vi + 1) * 4 + 3];
          const u = uv[vi * 3];            // 0 head .. 1 tail
          const rz = uv[vi * 3 + 2];
          if (rz <= 0) bcOff++;
          P0.set(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]).applyMatrix4(cam.matrixWorldInverse);
          P1.set(pos[vi * 3 + 3], pos[vi * 3 + 4], pos[vi * 3 + 5]).applyMatrix4(cam.matrixWorldInverse);
          for (const v of [0.3, 0.5, 0.7, 0.85, 0.97]) {
            Q.lerpVectors(P0, P1, v);
            const z = Math.max(0.05, -Q.z), px = Q.x / z, py = Q.y / z;
            const edge = smooth(0, 0.55, v) * (1 - smooth(0.93, 1, v));
            const body = Math.pow(smooth(0.02, 0.95, v), 1.6);
            const onset = 0.35 + 0.65 * smooth(0, 0.07, u);
            let a = (a0 + (a1 - a0) * v) * edge * body * onset * (1 - u * 0.45);
            if (rz > 0) {
              const ax = bod[vi * 4], ay = bod[vi * 4 + 1], bx = bod[vi * 4 + 2], by = bod[vi * 4 + 3];
              const abx = bx - ax, aby = by - ay;
              const hh = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / Math.max(1e-6, abx * abx + aby * aby)));
              const d = Math.hypot(px - ax - abx * hh, py - ay - aby * hh);
              const rr = rz * (0.9 + 0.7 * hh);
              a *= smooth(rr * 0.7, rr * 1.8, d);
            }
            if (a < amin) continue;
            vis++;
            const dh = Math.hypot(px - hpx, py - hpy) / hr;
            if (dh < minD) minD = dh;
            if (dh < 1) { leaks++; if (a > maxA) maxA = a; }
          }
        }
      }
      const atk = h.attack ? (h.attack.id || '?') : (h.fsm ? h.fsm.name : null); // C1 r5: move id (was def.id = always '?')
      return { x: sx, y: sy, rpx: Math.round(rpx), vis, minD: vis ? +minD.toFixed(2) : null, leaks, maxA: +maxA.toFixed(2), bcOff,
               bladeMinD: blades.length ? +bladeMinD.toFixed(2) : null, bladeFront, blades, atk };
    }, [AMIN, HEAD_R]);
    if (!s) continue;
    const row = { i, ...s };
    const bladeOver = s.bladeMinD !== null && s.bladeMinD < 1 && s.bladeFront;
    if (bladeOver) bladeFrames++;
    if (s.vis && s.minD < 2.5) nearFrames++;
    if (s.leaks) { leakFrames++; if (!worst || s.maxA > worst.maxA) worst = row; }
    if (sharp) {
      const buf = await api.page.screenshot({ type: 'png' });
      const r = Math.max(4, Math.round(s.rpx)), x0 = Math.max(0, s.x - r), y0 = Math.max(0, s.y - r);
      const meta = await sharp(buf).metadata();
      const w = Math.min(2 * r, meta.width - x0), hgt = Math.min(2 * r, meta.height - y0);
      let hot = 0;
      if (w > 0 && hgt > 0) {
        const { data, info } = await sharp(buf).extract({ left: x0, top: y0, width: w, height: hgt }).raw().toBuffer({ resolveWithObject: true });
        for (let yy = 0; yy < info.height; yy++) for (let xx = 0; xx < info.width; xx++) {
          const ddx = xx + x0 - s.x, ddy = yy + y0 - s.y;
          if (ddx * ddx + ddy * ddy > r * r) continue;
          const o = (yy * info.width + xx) * info.channels;
          if (0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2] > HOT_T) hot++;
        }
      }
      row.hot = hot;
      if (hot > HOT_N) {
        hotFrames++; row.hotTag = bladeOver ? 'blade' : 'other'; if (bladeOver) hotBlade++;
        if (!worstHot || hot > worstHot.hot) worstHot = row;
        if (saved < 24) { row.shot = `hot_${String(i).padStart(3, '0')}`; fs.writeFileSync(path.join(api.outDir, row.shot + '.png'), buf); saved++; }
      }
    }
    if (s.leaks && !row.shot && saved < 24) { row.shot = `leak_${String(i).padStart(3, '0')}`; await api.shot(row.shot); saved++; }
    if (NEAR > 0 && s.vis && s.minD < NEAR && !row.shot && saved < 24) { row.shot = `near_${String(i).padStart(3, '0')}`; await api.shot(row.shot); saved++; }
    rows.push(row);
  }
  fs.writeFileSync(path.join(api.outDir, 'vis.json'), JSON.stringify({ frames: N, nearFrames, leakFrames, bladeFrames, hotFrames, hotBlade, hotT: HOT_T, hotN: HOT_N, worst, worstHot, rows }));
  api.log(`trail_face_vis: ${N} frames, ribbon-near-head frames (<2.5 head radii): ${nearFrames}, LEAK frames (visible ribbon inside the head disc): ${leakFrames}` + (worst ? ` worst i=${worst.i} maxA=${worst.maxA} minD=${worst.minD}` : '') +
          `; blade-over-head frames: ${bladeFrames}; HOT-over-face frames (> ${HOT_N} px with luma > ${HOT_T} in the head disc): ${hotFrames} (blade ${hotBlade}, other ${hotFrames - hotBlade})` + (worstHot ? ` worst i=${worstHot.i} hot=${worstHot.hot} tag=${worstHot.hotTag} atk=${worstHot.atk}` : ''));
};
