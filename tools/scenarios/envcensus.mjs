// perf-1650 r4: what does the env draw per frame? Census of envGroup meshes: count, instanced, distinct materials / programs,
// transparent, shadow casters; plus the same for actors. Answers "env = 6 ms of renderer.render JS in the S2 boss: how many
// draws / program switches is that?".   env EC_BOSS=1 teleports to the boss first.
export default async function (api) {
  const { page, log, advance } = api;
  await advance(2500);
  if (process.env.EC_BOSS === '1') {
    await page.evaluate(() => {
      const g = window.__KCA.game, L = g.levels, d = window.__KCA.debug;
      d.god(true);
      const last = L.screens.length - 1;
      for (let k = L.screenIndex; k < last; k++) { d.kill('enemies'); L.waveActors.clear(); }
      for (const h of g.world.query({ kind: 'hero' })) h.pos.x = L.screens[last].x[0] + 3;
      L.pendingSpawns = 0; L.waveActors.clear(); L.enterScreen(last);
      if (g.cameraRig && g.cameraRig.snap) g.cameraRig.snap();
      L.waveActors.clear(); L.pendingSpawns = 0; L.waveIndex = (L.screens[last].waves || []).length - 1; L.nextWave();
    });
    await advance(9000);
  }
  const res = await page.evaluate(() => {
    const g = window.__KCA.game, R = g.renderer, W = R.webgl;
    const vis = (o) => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
    const census = (root) => {
      const c = { meshes: 0, instanced: 0, skinned: 0, transparent: 0, casters: 0, tris: 0, mats: new Set(), progs: new Set(), byProg: new Map() };
      root.traverse((o) => {
        if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite) || !vis(o)) return;
        c.meshes++; if (o.isInstancedMesh) c.instanced++; if (o.isSkinnedMesh) c.skinned++; if (o.castShadow) c.casters++;
        for (const m of [].concat(o.material || [])) { if (!m) continue; c.mats.add(m.uuid); if (m.transparent) c.transparent++;
          const pr = W.properties.get(m), cp = pr && pr.currentProgram; if (cp) { c.progs.add(cp.cacheKey); const k = (cp.name || '?') + ' …' + String(cp.cacheKey).slice(-28); c.byProg.set(k, (c.byProg.get(k) || 0) + 1); } }
        const gm = o.geometry; if (gm) c.tris += (gm.index ? gm.index.count : (gm.attributes.position ? gm.attributes.position.count : 0)) / 3 * (o.isInstancedMesh ? o.count : 1);
      });
      return { meshes: c.meshes, instanced: c.instanced, skinned: c.skinned, transparent: c.transparent, casters: c.casters, kTris: Math.round(c.tris / 1000), materials: c.mats.size, programs: c.progs.size, topPrograms: [...c.byProg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${v}× ${k}`) };
    };
    return { env: census(R.envGroup), world: census(R.scene), calls: R.frameInfo.calls };
  });
  log('ENV   ' + JSON.stringify(res.env));
  log('SCENE ' + JSON.stringify(res.world));
  log('frame draw calls ' + res.calls);
}
