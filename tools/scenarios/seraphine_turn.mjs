// Explicit half-turn: yaw in the URL disables automatic spin, so set and verify every frame.
import fs from 'node:fs';
import path from 'node:path';
export default async function (api) {
  const samples = [];
  for (let i = 0; i <= 60; i++) {
    const yaw = i * 3;
    await api.evalGame(y => window.__KCA.showcase.setYaw(y), yaw);
    await api.frames(1, 33);
    const actual = await api.evalGame(() => window.__KCA.showcase.actor.body.rotation.y * 180 / Math.PI);
    if (Math.abs(actual - yaw) > 0.01) throw new Error(`Turn yaw ${actual}, expected ${yaw}`);
    samples.push(actual);
  }
  fs.writeFileSync(path.join(api.outDir, 'turn_yaws.json'), JSON.stringify(samples));
}
