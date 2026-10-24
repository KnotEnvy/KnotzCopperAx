// In-stage stance check (bosses C2 r1): game-camera crops of the lead boss while it IDLES / WALKS / RUNS (the moments
// the board's "every boss stands the same way" was about), not mid-attack. Kills the screen's wave foes until the boss
// spawns (god bots), then samples every 0.25 s; a shot when the lead is in idle|walk|run|ride (mounted, not attacking)
// and ≥ GAP s since the last one, up to N shots or MAX s. Writes stance_<i>.png + stance_crops.png (crops around the
// projected boss box) + stance.json. Use with /?mode=stage&stage=<n>&p1=brann&p2=gorrim&bot=1&screen=<boss screen>.
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs';
export default async (api) => {
  const N = Number(process.env.N || 4), GAP = Number(process.env.GAP || 1.6), MAX = Number(process.env.MAX || 50);
  await api.evalGame(() => window.__KCA.debug.god(true));
  let spawned = false;
  for (let i = 0; i < 240 && !spawned; i++) {
    await api.advance(500);
    spawned = await api.evalGame(() => {
      const K = window.__KCA, g = K.game;
      if (g._bossCam) return true;
      for (const e of g.world.query({ team: 'enemies' })) if (e.alive && e.kind !== 'boss' && !e.def?.id?.startsWith('boss_') && e.typeId !== 'viper') K.debug.kill(e.id);
      return false;
    });
  }
  if (!spawned) throw new Error('no boss');
  const shots = [];
  let last = -99;
  for (let t = 0; t < MAX && shots.length < N; t += 0.25) {
    await api.advance(250);
    const s = await api.evalGame(() => {
      const g = window.__KCA.game, cam = g._bossCam; if (!cam) return null;
      const m = cam.members().filter((a) => a && a.alive && !a.removed)[0]; if (!m) return null;
      const st = m.fsm && m.fsm.name, clip = m.animator && m.animator.name;
      const W = g.renderer.width, H = g.renderer.height, v = g.camera.position.clone();
      const top = (m.height || 3) + (m.mountedOn ? (m.pos.y || 0) * 0 : 0);
      v.set(m.pos.x, m.pos.y, m.pos.z).project(g.camera); const x = (v.x + 1) / 2 * W, yb = (1 - v.y) / 2 * H;
      v.set(m.pos.x, m.pos.y + top, m.pos.z).project(g.camera); const yt = (1 - v.y) / 2 * H;
      const mount = m.mountedOn;
      let ym = yb;
      if (mount) { v.set(mount.pos.x, 0, mount.pos.z).project(g.camera); ym = (1 - v.y) / 2 * H; }
      return { st, clip, x, yb: Math.max(yb, ym), yt, mounted: !!mount, intro: !(m.introDone ?? true), t: g.tick / 60, type: m.typeId };
    });
    if (!s) continue;
    const ok = (s.mounted ? /ride_idle|idle|walk/.test(s.clip || '') && s.st !== 'attack' : /^(idle|walk|run|pause)$/.test(s.st) && /idle|walk|run/.test(s.clip || ''));
    if (ok && t - last >= GAP) {
      last = t;
      const f = `stance_${shots.length}`; await api.shot(f);
      shots.push({ ...s, file: path.join(api.outDir, f + '.png') });
    }
  }
  fs.writeFileSync(path.join(api.outDir, 'stance.json'), JSON.stringify(shots, null, 1));
  if (!shots.length) return;
  const CH = 640, CW = 520, comp = [];
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i], h = Math.max(120, s.yb - s.yt), k = CH / (h * 1.45);
    const meta = await sharp(s.file).metadata();
    const w = Math.round(CW / k), hh = Math.round(CH / k);
    const left = Math.max(0, Math.min(meta.width - w, Math.round(s.x - w / 2)));
    const top = Math.max(0, Math.min(meta.height - hh, Math.round(s.yb + h * 0.12 - hh)));
    const buf = await sharp(s.file).extract({ left, top, width: Math.min(w, meta.width), height: Math.min(hh, meta.height) }).resize(CW, CH).toBuffer();
    comp.push({ input: buf, left: i * CW, top: 0 });
  }
  await sharp({ create: { width: CW * shots.length, height: CH, channels: 3, background: '#000' } }).composite(comp).png().toFile(path.join(api.outDir, 'stance_crops.png'));
  api.log(JSON.stringify(shots.map((s) => [s.type, s.st, s.clip, +s.t.toFixed(1)])));
};
