// Probe (owner: hero-weapons, C2 r3): what pose the select-set heroes (or the showcase actor) actually hold — current
// clip, RigPost meta / grip stats, the weapon haft + bit directions in CHARACTER space and the hand positions relative
// to the chest. Writes pose.json. Use on "/?mode=showcase&what=ui&id=select&notimer=1" or a hero showcase page.
import fs from 'node:fs'; import path from 'node:path';
export default async (api) => {
  await api.advance(600);
  const r = await api.evalGame(() => {
    const k = window.__KCA; const out = [];
    const list = (k.game.world && k.game.world.actors) || [];
    const sc = k.showcase && k.showcase.actor ? [k.showcase.actor] : [];
    for (const h of [...list, ...sc]) {
      if (!h || !h.def || !h.model || !h.model.root || h.kind !== 'hero') continue;
      const root = h.model.root; root.updateWorldMatrix(true, true);
      const Qi = root.getWorldQuaternion(new h.model.root.quaternion.constructor()).invert();
      const toChar = (v) => { const m = v.clone().applyQuaternion(Qi); return [-m.z, m.y, m.x].map((x) => +x.toFixed(3)); }; // model→char: (x,y,z)_char = (-z, y, x)_model? ARCH: char→model (x,y,z)→(−z,y,x) so model→char = (z, y, −x)
      const toChar2 = (v) => { const m = v.clone().applyQuaternion(Qi); return [m.z, m.y, -m.x].map((x) => +x.toFixed(3)); };
      const an = h.animator || {}; const rp = an.post || an.rigPost || null;
      const w = h.model.weapon; const P = new w.position.constructor();
      const haft = new w.position.constructor(0, 1, 0).applyQuaternion(w.getWorldQuaternion(new w.quaternion.constructor()));
      const bit = new w.position.constructor(0, 0, 1).applyQuaternion(w.getWorldQuaternion(new w.quaternion.constructor()));
      const bones = h.model.rigInfo && h.model.rigInfo.bones;
      const wpos = (n) => { const b = bones && bones.get(n); if (!b) return null; return b.node.getWorldPosition(P.clone()); };
      const chest = wpos('chest'), hr = wpos('hand_R'), hl = wpos('hand_L');
      const rel = (a) => (a && chest) ? toChar2(a.clone().sub(chest)) : null;
      out.push({ id: h.def.id, fsm: h.fsm && h.fsm.name, cur: an.current && (an.current.name || an.current.clip || an.current), curName: an.currentName || an.clipName || (an.state && an.state.name), keys: Object.keys(an).slice(0, 40),
        meta: rp && rp.meta, stats: rp && rp.stats, haftChar: toChar2(haft), bitChar: toChar2(bit), handR_rel_chest: rel(hr), handL_rel_chest: rel(hl), visualYaw: h.visualYaw, cheatYaw: h.cheatYaw, facing: h.facing });
    }
    return out;
  });
  api.log(JSON.stringify(r));
  fs.writeFileSync(path.join(api.outDir, 'pose.json'), JSON.stringify(r, null, 2));
  await api.shot('shot');
};
