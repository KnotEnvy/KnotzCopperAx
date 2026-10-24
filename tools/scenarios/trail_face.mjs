// Trail self-occlusion sweep (owner: magic-vfx). Use with /?mode=showcase&what=moveset&id=<hero>.
// Steps the whole moveset loop and, on every frame where a weapon ribbon has geometry within ~0.5 m (projected) of
// the wielder's head, saves face_<i>.png and records the head's pixel position in faces.json (crop with
// scratchpad grid tooling). Also logs how many such frames there were.
import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  const faces = [];
  let leaks = 0;
  for (let i = 0; i < 330; i++) {
    await api.advance(33);
    const s = await api.evalGame(() => {
      const K = window.__KCA, g = K.game, t = g.vfx.trails, cam = g.camera;
      const h = K.showcase.actor;
      const bones = h.model && h.model.rigInfo && h.model.rigInfo.bones;
      const head = bones && bones.get('head') && bones.get('head').node;
      if (!head || !t.geo.drawRange.count) return null;
      const V = window.__V3 || (window.__V3 = new head.position.constructor());
      head.getWorldPosition(V); V.y += 0.08;
      const hp = V.clone().project(cam);
      const pos = t.aPos.array, n = t.geo.drawRange.count;
      const idx = t.geo.index.array;
      let near = 0;
      const W = window.innerWidth, H = window.innerHeight;
      const hx = (hp.x * 0.5 + 0.5) * W, hy = (1 - (hp.y * 0.5 + 0.5)) * H;
      const P = V.clone();
      for (let k = 0; k < n; k += 3) {
        const j = idx[k] * 3;
        P.set(pos[j], pos[j + 1], pos[j + 2]).project(cam);
        const x = (P.x * 0.5 + 0.5) * W, y = (1 - (P.y * 0.5 + 0.5)) * H;
        if (Math.hypot(x - hx, y - hy) < 70) {
          near++;
          // leak = the face itself is NOT fully inside the owner's self-mask capsule (same maths as the shader), so
          // a ribbon crossing it would paint over the face
          const bc = t.trails.find((q) => q.actor === h)?._bc;
          const V2 = V.clone().applyMatrix4(cam.matrixWorldInverse);
          if (bc && bc[4] > 0) {
            const px = V2.x / Math.max(0.05, -V2.z), py = V2.y / Math.max(0.05, -V2.z);
            const abx = bc[2] - bc[0], aby = bc[3] - bc[1];
            const hh = Math.max(0, Math.min(1, ((px - bc[0]) * abx + (py - bc[1]) * aby) / Math.max(1e-6, abx * abx + aby * aby)));
            const d = Math.hypot(px - bc[0] - abx * hh, py - bc[1] - aby * hh);
            const rr = bc[4] * (0.9 + 0.7 * hh);
            if (d > rr * 0.85 - bc[4] * 0.35) near += 1000;   // face (≈0.35 r wide) must sit inside the fully-masked core
          } else near += 1000;
          break;
        }
      }
      return near ? { x: Math.round(hx), y: Math.round(hy), leak: near >= 1000 } : null;
    });
    if (s) (s.leak ? leaks++ : 0);
    if (s && faces.length < 40) { const name = `face_${String(i).padStart(3, '0')}`; await api.shot(name); faces.push({ name, ...s }); }
  }
  fs.writeFileSync(path.join(api.outDir, 'faces.json'), JSON.stringify(faces));
  api.log(`frames with a ribbon near the head: ${faces.length}; unmasked-near-face frames (leaks): ${leaks}`);
};
