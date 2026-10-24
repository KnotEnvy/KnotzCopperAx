// Black-frame hunt (bosses r10): steps a showcase at STEP ms for N frames from WARM ms, every frame records whether any
// boss cape vertex is NaN, the bus events seen (magic / boss), and the canvas mean (screenshot-based via frames()).
import fs from 'node:fs';
import path from 'node:path';
export default async (api) => {
  const N = Number(process.env.N || 60), STEP = Number(process.env.STEP || 33);
  await api.evalGame(() => {
    const g = window.__KCA.game; const L = window.__bf = { ev: [] };
    const orig = g.bus.emit.bind(g.bus);
    g.bus.emit = (name, p) => { if (/magic|spell|boss:|darken|cast/i.test(name)) L.ev.push([g.tick, name]); return orig(name, p); };
  });
  const rows = [];
  for (let i = 0; i < N; i++) {
    await api.frames(1, STEP);
    rows.push(await api.evalGame(() => {
      const g = window.__KCA.game; let nan = 0, capes = 0;
      g.scene.traverse((o) => { if (o.name === 'boss_cape') { capes++; const a = o.geometry.attributes.position.array; for (let k = 0; k < a.length; k++) if (!Number.isFinite(a[k])) { nan++; break; } const n = o.geometry.attributes.normal.array; for (let k = 0; k < n.length; k++) if (!Number.isFinite(n[k])) { nan++; break; } } });
      const p = g.renderer.post; const pu = p._pulse;
      return { tick: g.tick, capes, nan, exposure: +p.exposure.toFixed(3), pulse: pu ? [pu.ca, pu.flash, pu.desat] : null, ev: window.__bf.ev.splice(0) };
    }));
  }
  fs.writeFileSync(path.join(api.outDir, 'blackframe.json'), JSON.stringify(rows, null, 1));
};
