// Weapon-vs-socket frame probe (owner: hero-weapons): angle between the socket's +Y and the weapon node's +Y (the
// trail assumes they coincide) in idle and at several frames of light_1 / heavy. Writes frame.json.
import fs from 'node:fs';
import path from 'node:path';
export default async (api) => {
  const samples = [];
  const probe = (label) => api.evalGame((label) => {
    const k = window.__KCA; const h = k.showcase.actor; const m = h.model; const out = { label, hands: {} };
    for (const hand of ['R', 'L']) {
      const src = hand === 'L' ? m.weaponL : m.weapon; const sock = m.sockets && m.sockets[hand]; if (!src || !sock) continue;
      sock.updateWorldMatrix(true, true);
      const Y = (o) => { const e = o.matrixWorld.elements; const v = [e[4], e[5], e[6]]; const n = Math.hypot(...v); return v.map((x) => x / n); };
      const a = Y(sock), b = Y(src); const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const q = src.quaternion; const e = src.rotation;
      out.hands[hand] = { angleDeg: +(Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI).toFixed(1), localEulerDeg: [e.x, e.y, e.z].map((v) => +(v * 180 / Math.PI).toFixed(1)), parentIsSocket: src.parent === sock, pos: src.position.toArray().map((v) => +v.toFixed(3)) };
    }
    return out;
  }, label);
  await api.advance(300); samples.push(await probe('idle'));
  for (const clip of ['light_1', 'heavy']) {
    for (const f of [4, 8, 12, 18]) {
      await api.evalGame((c) => window.__KCA.showcase.play(c, { loop: false, fade: 0, restart: true }), clip);
      for (let left = f; left > 0; left -= 8) await api.advance(Math.min(8, left) * (1000 / 60));
      samples.push(await probe(`${clip} f${f}`));
    }
  }
  for (const s of samples) api.log(JSON.stringify(s));
  fs.writeFileSync(path.join(api.outDir, 'frame.json'), JSON.stringify(samples, null, 2));
};
