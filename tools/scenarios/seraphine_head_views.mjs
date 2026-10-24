// One browser, four verified yaw views. Use showcase hero/seraphine, cam=face, spin=0.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

export default async function (api) {
  const views = [];
  for (const yaw of [0, 35, 90, 180]) {
    await api.evalGame(y => window.__KCA.showcase.setYaw(y), yaw);
    await api.advance(100);
    const actual = await api.evalGame(() => {
      const a = window.__KCA.showcase.actor;
      return { yaw: a.body.rotation.y * 180 / Math.PI, matrix: a.body.matrixWorld.toArray() };
    });
    if (Math.abs(actual.yaw - yaw) > 0.01) throw new Error(`Requested yaw ${yaw}, got ${actual.yaw}`);
    const name = `yaw${yaw}`;
    await api.shot(name);
    await sharp(path.join(api.outDir, `${name}.png`))
      .extract({ left: 580, top: 190, width: 500, height: 520 })
      .resize(1000, 1040, { kernel: 'nearest' }).png()
      .toFile(path.join(api.outDir, `${name}_2x.png`));
    views.push({ requested: yaw, ...actual, shot: `${name}.png`, crop: `${name}_2x.png` });
    api.log(`verified head yaw ${yaw}: ${actual.yaw.toFixed(3)}`);
  }
  fs.writeFileSync(path.join(api.outDir, 'yaw_verification.json'), JSON.stringify(views, null, 2));
}
