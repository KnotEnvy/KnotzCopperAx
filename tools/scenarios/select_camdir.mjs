// Probe: camera direction in each select hero's CHARACTER space (+X fwd, +Y up, +Z right), so a select pose can aim
// a weapon flat at the camera. Logs per hero; writes camdir.json.
import fs from 'node:fs'; import path from 'node:path';
export default async (api) => {
  await api.advance(300);
  const r = await api.evalGame(() => {
    const k = window.__KCA; const s = k.showcase; const scr = s.screen; const set = scr && (scr.set || scr._set);
    const cam = k.game.cameraRig.camera; const out = { heroes: [] };
    const list = (k.game.world && k.game.world.actors) || [];
    for (const h of list) {
      if (!h.def || !h.model || !h.model.root) continue;
      const root = h.model.root; root.updateWorldMatrix(true, false);
      const q = root.getWorldQuaternion(new cam.quaternion.constructor()).invert();
      const p = root.getWorldPosition(new cam.position.constructor());
      const d = cam.position.clone().sub(p).normalize().applyQuaternion(q); // model space
      // model→char: (x,y,z)_char = (z, y, -x)_model
      out.heroes.push({ id: h.def.id, facing: h.facing, yaw: h.visualYaw, camChar: [d.z, d.y, -d.x].map((v) => +v.toFixed(3)), camPos: cam.position.toArray().map((v) => +v.toFixed(2)), heroPos: p.toArray().map((v) => +v.toFixed(2)) });
    }
    return out;
  });
  api.log(JSON.stringify(r));
  fs.writeFileSync(path.join(api.outDir, 'camdir.json'), JSON.stringify(r, null, 2));
  await api.shot('shot');
};
