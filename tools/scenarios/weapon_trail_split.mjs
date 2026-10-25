// Trail vs blade SPLIT probe (owner: hero-weapons, wave C2 r11). QA only, no runtime hook.
// Same input sequence as weapon_read_probe.mjs. On frames SPLIT_FRAMES (default 18-26) the SAME pose is re-rendered
// (renderer.render(0): no tick) as noTrail (vfx_trails mesh hidden) and noBlades (both hero weapons hidden), next to the
// shipped frame_<n>.png -> split_<variant>_<frame>.png. Tells a trail ribbon from a blade seen at a grazing angle.
//   SPLIT_FRAMES=18-26 node tools/capture.mjs --url "/?mode=stage&stage=1&p1=seraphine&bot=1" --warm 8000 \
//     --scenario tools/scenarios/weapon_trail_split.mjs --frames 40 --step 33 --out progress/shots/hero-weapons/c2r11/split
import path from 'node:path';
import readProbe from './weapon_read_probe.mjs';

const [F0, F1] = (process.env.SPLIT_FRAMES || '18-26').split('-').map(Number);

export default async (api) => {
  const grab = async (opts) => {
    const result = await api.page.screenshot(opts);
    const m = path.basename(opts.path).match(/^frame_(\d+)\.png$/);
    if (!m || +m[1] < F0 || +m[1] > (F1 ?? F0)) return result;
    for (const v of ['noTrail', 'noBlades']) {
      await api.evalGame((v) => {
        const g = __KCA.game, h = g.world.query({ kind: 'hero' })[0];
        const tr = g.renderer.scene.getObjectByName('vfx_trails');
        window.__split = { tr: tr ? tr.visible : null, w: [h.model.weapon && h.model.weapon.visible, h.model.weaponL && h.model.weaponL.visible] };
        if (v === 'noTrail' && tr) tr.visible = false;
        if (v === 'noBlades') { if (h.model.weapon) h.model.weapon.visible = false; if (h.model.weaponL) h.model.weaponL.visible = false; }
        g.renderer.render(0);
      }, v);
      await api.page.screenshot({ path: path.join(api.outDir, `split_${v}_${m[1]}.png`) });
      await api.evalGame(() => {
        const g = __KCA.game, h = g.world.query({ kind: 'hero' })[0], s = window.__split;
        const tr = g.renderer.scene.getObjectByName('vfx_trails');
        if (tr && s.tr !== null) tr.visible = s.tr;
        if (h.model.weapon) h.model.weapon.visible = s.w[0]; if (h.model.weaponL) h.model.weaponL.visible = s.w[1];
        g.renderer.render(0);
      });
    }
    return result;
  };
  const page = new Proxy(api.page, { get(t, k) { return k === 'screenshot' ? grab : typeof t[k] === 'function' ? t[k].bind(t) : t[k]; } });
  await readProbe({ ...api, page });
};
