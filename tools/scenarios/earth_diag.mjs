// r18 diagnosis: freeze the T2 column hold (stage 1) and re-render the SAME frame with single warm terms removed,
// plus a column mask (columns hidden) so face pixels can be measured per variant. Writes diag.json.
// EARTH_DIAG_TIER=2 (default) | 4 (fist at impact+N frames, EARTH_DIAG_AT ms after cast).
import fs from 'node:fs';
import path from 'node:path';
export default async (api) => {
  const tier = +(process.env.EARTH_DIAG_TIER || 2);
  await api.evalGame(() => {
    const K = window.__KCA, g = K.game; K.debug.god(true);
    const h = g.world.query({ kind: 'hero' })[0]; g.bots.detach(h); K.input.releaseAll(); h.fsm.go('idle');
  });
  await api.advance(4000);
  await api.evalGame(t => window.__KCA.debug.cast(1, t), tier);
  if (tier === 4) {
    await api.advance(+(process.env.EARTH_DIAG_AT || 2000));
    await api.shot('fist');
    return;
  }
  // Advance in 33 ms steps until the standing column height peaks.
  let best = 0, bestI = -1;
  const score = () => api.evalGame(() => {
    let s = 0; window.__KCA.game.vfx.group.traverse(m => {
      if (m.name !== 'magic_column' || !m.visible) return;
      const c = m.geometry.attributes.aStoneCollapse;
      for (let j = 0; j < m.count; j++) if (!(c.getX(j) > 0)) s += Math.abs(m.instanceMatrix.array[j * 16 + 5]);
    }); return s;
  });
  for (let i = 0; i < 60; i++) {
    await api.advance(33);
    const s = await score();
    if (s > best) { best = s; bestI = i; } else if (bestI >= 0 && i - bestI >= 3 && s < best * .97) break;
  }
  // step back is impossible; we are within ~3 frames after the peak (still a hold).
  const variants = {
    base: '',
    spillOff: 'spill',
    magmaOff: 'gain',
    lightsOff: 'lights',
    allWarmOff: 'spill,gain,lights',
  };
  const out = {};
  // EARTH_DIAG_LOOKS='[{"name":"t1","tint":"#7a808a","fill":.3}]': re-render the same frozen hold with column tint/fill.
  for (const look of JSON.parse(process.env.EARTH_DIAG_LOOKS || '[]')) {
    await api.evalGame(look => {
      const g = window.__KCA.game, saved = window.__diagLook || (window.__diagLook = {});
      g.vfx.group.traverse(m => {
        if (m.name !== 'magic_column') return;
        if (!saved[m.uuid]) saved[m.uuid] = [m.material.color.getHex(), m.material.userData.stoneFill.value];
        m.material.color.set(look.tint || saved[m.uuid][0]); m.material.userData.stoneFill.value = look.fill ?? saved[m.uuid][1];
      });
      g.renderer.render(0);
    }, look);
    await api.shot('look-' + look.name);
  }
  await api.evalGame(() => { const g = window.__KCA.game, saved = window.__diagLook || {};
    g.vfx.group.traverse(m => { if (saved[m.uuid]) { m.material.color.setHex(saved[m.uuid][0]); m.material.userData.stoneFill.value = saved[m.uuid][1]; } }); });
  for (const [name, mode] of Object.entries(variants)) {
    await api.evalGame(mode => {
      const g = window.__KCA.game, saved = window.__diagSaved || (window.__diagSaved = {});
      g.vfx.group.traverse(m => {
        if (!m.name?.startsWith('magic_') || !m.material?.userData?.stoneHeatGain) return;
        const b = m.geometry.attributes.aStoneBounce;
        if (b && !saved[m.uuid + 'b']) saved[m.uuid + 'b'] = b.array.slice();
        if (!saved[m.uuid + 'g']) saved[m.uuid + 'g'] = m.material.userData.stoneHeatGain.value;
        if (b) { b.array.set(mode.includes('spill') ? new Float32Array(b.array.length) : saved[m.uuid + 'b']); b.needsUpdate = true; }
        m.material.userData.stoneHeatGain.value = mode.includes('gain') ? 0 : saved[m.uuid + 'g'];
      });
      if (!saved.lights) saved.lights = g.vfx.lights.map(s => s.light.intensity), saved.spell = g.magic.light.intensity;
      g.vfx.lights.forEach((s, i) => { s.light.intensity = mode.includes('lights') ? 0 : saved.lights[i]; });
      g.magic.light.intensity = mode.includes('lights') ? 0 : saved.spell;
      g.renderer.render(0);
    }, mode);
    await api.shot(name);
  }
  await api.evalGame(() => { window.__KCA.game.vfx.group.traverse(m => { if (m.name === 'magic_column') m.visible = false; }); window.__KCA.game.renderer.render(0); });
  await api.shot('mask');
  out.peak = { best, bestI };
  fs.writeFileSync(path.join(api.outDir, 'diag.json'), JSON.stringify(out, null, 2));
};
