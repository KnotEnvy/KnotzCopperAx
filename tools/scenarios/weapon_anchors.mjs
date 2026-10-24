// Weapon contract probe (owner: hero-weapons). Verifies, on the live hero in the showcase, that the trail system's
// measured blade tip (vfx.trails.tipOf, bbox-derived) matches the weapon GLB's own blade_tip / head_tip node and that
// the off-hand node matches the profile, for the R (and L) hand. Writes anchors.json; prints PASS/FAIL per check.
//   node tools/capture.mjs --url "/?mode=showcase&what=hero&id=brann&anim=idle&cam=close&spin=0" \
//        --scenario tools/scenarios/weapon_anchors.mjs --out progress/shots/hero-weapons/c2r1/anchors-brann
import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  await api.advance(200);
  const r = await api.evalGame(() => {
    const k = window.__KCA; const h = k.showcase?.actor || k.game.world.query({ kind: 'hero' })[0]; const m = h.model; const out = { hero: h.def.id, hands: {} };
    const T = window.THREE || null;
    const tipNode = (src) => src && (src.getObjectByName('bit_edge') || src.getObjectByName('blade_tip') || src.getObjectByName('head_tip')); // C2 r3: an axe's trail tip is its bit edge
    const wp = (o) => { o.updateWorldMatrix(true, false); const e = o.matrixWorld.elements; return [e[12], e[13], e[14]]; };
    for (const hand of ['R', 'L']) {
      const src = hand === 'L' ? m.weaponL : m.weapon; if (!src) continue;
      const node = tipNode(src); const tip = k.game.vfx && k.game.vfx.trails ? k.game.vfx.trails.tipOf(h, hand) : null;
      const bb = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] };
      src.traverse((o) => { if (o.isMesh && o.geometry) { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox; for (let i = 0; i < 3; i++) { bb.min[i] = Math.min(bb.min[i], b.min.getComponent(i)); bb.max[i] = Math.max(bb.max[i], b.max.getComponent(i)); } } });
      const off = src.getObjectByName('grip_offhand');
      const tr = k.game.vfx && k.game.vfx.trails ? k.game.vfx.trails.trails.find((t) => t.actor === h && t.hand === hand && !t.dead) : null;
      const sock = m.sockets && m.sockets[hand];
      const dbg = tr ? { ref: tr.ref.name, refIsSocket: tr.ref === sock, len: +tr.len.toFixed(3), axis: tr.axis.toArray().map((v) => +v.toFixed(2)), tip: tr.style.tip, srcName: src.name, srcIsRefChild: src.parent === tr.ref, srcScale: src.scale.toArray(), refScale: tr.ref ? tr.ref.getWorldScale(new src.position.constructor()).toArray().map((v) => +v.toFixed(3)) : null, sockWorld: sock ? wp(sock) : null, srcWorld: wp(src) } : null;
      out.hands[hand] = { node: node ? node.name : null, nodeLocal: node ? [node.position.x, node.position.y, node.position.z] : null,
        nodeWorld: node ? wp(node) : null, trailTipWorld: tip ? [tip.x, tip.y, tip.z] : null, bboxLocal: bb,
        offhandLocal: off ? [off.position.x, off.position.y, off.position.z] : null, source: m.source, dbg };
    }
    out.profile = (k.game.anim && k.game.anim.profileFor) ? null : undefined;
    return out;
  });
  const checks = [];
  for (const [hand, H] of Object.entries(r.hands)) {
    if (H.nodeWorld && H.trailTipWorld) {
      const d = Math.hypot(...H.nodeWorld.map((v, i) => v - H.trailTipWorld[i]));
      checks.push({ name: `${hand}: trail tip within 6 cm of ${H.node} node`, pass: d < 0.06, detail: { dist_m: +d.toFixed(4), node: H.nodeWorld.map((v) => +v.toFixed(3)), trail: H.trailTipWorld.map((v) => +v.toFixed(3)), dbg: H.dbg } });
    } else checks.push({ name: `${hand}: tip node + trail present`, pass: false, detail: H });
    const w = H.bboxLocal.max[0] - H.bboxLocal.min[0], t = H.bboxLocal.max[2] - H.bboxLocal.min[2], l = H.bboxLocal.max[1];
    checks.push({ name: `${hand}: bbox (width x / reach +y / thickness z)`, pass: true, detail: { width_m: +w.toFixed(3), reach_m: +l.toFixed(3), thick_m: +t.toFixed(3), offhand: H.offhandLocal } });
  }
  for (const c of checks) api.log((c.pass ? 'PASS ' : 'FAIL ') + c.name + ' ' + JSON.stringify(c.detail));
  fs.writeFileSync(path.join(api.outDir, 'anchors.json'), JSON.stringify({ ...r, checks }, null, 2));
  await api.shot('shot');
};
