// Deterministic MOVE strip with trail/blade split (owner: hero-weapons, wave C2 r11). QA only, no runtime hook.
// The light string only chains on hits, and the AI makes hit runs non-deterministic, so this scenario removes every foe and
// FORCE-PLAYS a list of the hero's moves (Combatant.startMove), one after another, capturing every step:
//   frame_<n>.png (shipped) + split_noTrail_<n>.png (vfx_trails hidden) + split_noBlades_<n>.png (hero weapons hidden),
// same pose each (renderer.render(0): no tick). probe.json rows: move, move frame, hand flats / grip / tip px.
//   MOVES=light_3,light_2,heavy STEP=33 node tools/capture.mjs --url "/?mode=stage&stage=1&p1=seraphine&bot=1" --warm 8000 \
//     --scenario tools/scenarios/weapon_move_split.mjs --out progress/shots/hero-weapons/c2r11/moves
// SPLIT=0 skips the split renders (plain strip).
import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  const moves = (process.env.MOVES || 'light_3,light_2,heavy').split(','), step = Number(process.env.STEP || 33), split = process.env.SPLIT !== '0';
  await api.evalGame(() => { const K = window.__KCA; for (const e of K.game.world.query({ team: 'enemies' })) if (e.alive) K.debug.kill(e.id); });
  await api.advance(600);
  const rows = []; let i = 0;
  const measure = () => api.evalGame(() => {
    const g = __KCA.game, cam = g.camera, h = g.world.query({ kind: 'hero' })[0], W = innerWidth, H = innerHeight;
    const px = (v) => { const p = v.clone().project(cam); return [+((p.x * 0.5 + 0.5) * W).toFixed(1), +((1 - (p.y * 0.5 + 0.5)) * H).toFixed(1)]; };
    const out = { move: h.attack ? h.attack.id : h.fsm.name, mf: h.attack ? h.attack.frame : null, hands: {} };
    const V = cam.position.constructor;
    for (const hand of ['R', 'L']) {
      const w = hand === 'L' ? h.model.weaponL : h.model.weapon; if (!w) continue;
      w.updateWorldMatrix(true, true);
      const tipN = w.getObjectByName('blade_tip') || w.getObjectByName('head_tip');
      const g0 = new V().setFromMatrixPosition(w.matrixWorld), t0 = tipN ? new V().setFromMatrixPosition(tipN.matrixWorld) : g0;
      const q = w.getWorldQuaternion(new w.quaternion.constructor()); const view = new V(0, 0, -1).applyQuaternion(cam.quaternion);
      out.hands[hand] = { gripPx: px(g0), tipPx: px(t0), flat: +Math.abs(new V(0, 0, 1).applyQuaternion(q).dot(view)).toFixed(3) };
    }
    return out;
  });
  const shotAll = async () => {
    const n = String(i).padStart(4, '0');
    const r = await measure(); r.frame = i; rows.push(r);
    await api.page.screenshot({ path: path.join(api.outDir, `frame_${n}.png`) });
    if (split) for (const v of ['noTrail', 'noBlades']) {
      await api.evalGame((v) => {
        const g = __KCA.game, h = g.world.query({ kind: 'hero' })[0], tr = g.renderer.scene.getObjectByName('vfx_trails');
        window.__split = { tr: tr ? tr.visible : null, w: [h.model.weapon && h.model.weapon.visible, h.model.weaponL && h.model.weaponL.visible] };
        if (v === 'noTrail' && tr) tr.visible = false;
        if (v === 'noBlades') { if (h.model.weapon) h.model.weapon.visible = false; if (h.model.weaponL) h.model.weaponL.visible = false; }
        g.renderer.render(0);
      }, v);
      await api.page.screenshot({ path: path.join(api.outDir, `split_${v}_${n}.png`) });
      await api.evalGame(() => {
        const g = __KCA.game, h = g.world.query({ kind: 'hero' })[0], s = window.__split, tr = g.renderer.scene.getObjectByName('vfx_trails');
        if (tr && s.tr !== null) tr.visible = s.tr;
        if (h.model.weapon) h.model.weapon.visible = s.w[0]; if (h.model.weaponL) h.model.weaponL.visible = s.w[1];
        g.renderer.render(0);
      });
    }
    api.log(`f${n} ${r.move}${r.mf != null ? '#' + r.mf : ''} ` + Object.entries(r.hands).map(([k, v]) => `${k} flat ${v.flat}`).join(' '));
    i++;
  };
  for (const id of moves) {
    const ok = await api.evalGame((id) => { const h = __KCA.game.world.query({ kind: 'hero' })[0]; return !!h.startMove(id); }, id);
    if (!ok) { api.log(`move ${id} not found`); continue; }
    for (let k = 0; k < 60; k++) {
      await api.advance(step); await shotAll();
      const busy = await api.evalGame(() => { const h = __KCA.game.world.query({ kind: 'hero' })[0]; return !!(h.attack && !h.attack.done); });
      if (!busy) break;
    }
    for (let k = 0; k < 3; k++) { await api.advance(step); await shotAll(); }
    await api.advance(300);
  }
  fs.writeFileSync(path.join(api.outDir, 'probe.json'), JSON.stringify({ rows }, null, 1));
};
