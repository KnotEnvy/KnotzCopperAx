// Stage-camera idle evidence and posed skin check, with stage geometry/lighting intact.
import fs from 'node:fs';
import path from 'node:path';
export default async function (api) {
  await api.evalGame(() => {
    const k = window.__KCA;
    k.game.levels.scriptEnabled = false;
    k.game.levels.phase = 'idle';
    k.debug.god(true);
    for (const a of k.game.world.query({ team: 'enemies' })) a.remove();
    k.input.releaseAll();
    const h = k.game.world.query({ kind: 'hero' })[0];
    h.endMove(); h.fsm.go('idle'); h.vel.set(0, 0, 0);
  });
  await api.advance(300);
  const checks = [];
  for (let i = 0; i < 72; i++) {
    await api.frames(1, 33);
    if (i % 18 === 0) checks.push(...await api.evalGame(() => {
      const k = window.__KCA, h = k.game.world.query({ kind: 'hero' })[0], meshes = [];
      h.modelRoot.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
      const out = [];
      // The engine probe checks the FIRST skinned mesh, which is now hair in
      // this GLB. Select each mesh synchronously and restore flags before render.
      try {
        for (const target of meshes) {
          for (const mesh of meshes) mesh.isSkinnedMesh = mesh === target;
          out.push(k.debug.skinCheck('p1'));
        }
      } finally {
        for (const mesh of meshes) mesh.isSkinnedMesh = true;
      }
      return out;
    }));
  }
  fs.writeFileSync(path.join(api.outDir, 'idle_skin.json'), JSON.stringify(checks, null, 2));
  if (checks.length < 8 || new Set(checks.map(c => c?.mesh)).size < 2 || checks.some(c => !c || c.error || c.stretched !== 0)) {
    throw new Error('Seraphine idle skin check failed; see idle_skin.json');
  }
}
