// what=ui&id=<screen> — a UI screen in isolation (over a stage backdrop where it belongs), with sample data.
// ids: hud · go · card · boss · gameover · demo · title (&menu=1) · select · pause · options · tally · map (&to=N)
//      ranking · highscore · entry · type (lettering/ornament sheet)
import { registries } from '../../core/registries.js';
import { HERO_IDS } from '../../core/config.js';

export function sampleRun(stages = 3, perfect = false) {
  // Varied showcase data: per-stage score gains differ (stages weigh more, bonus camps are small), so the ranking ledger never shows a column of identical rows.
  const gain = (id, i, p) => (id === 'bonus' ? 6400 + ((i * 3) % 4) * 1750 : 29800 + ((i * 7) % 5) * 5150 + i * 3100) + p * (1900 + ((i * 5) % 3) * 640);
  const run0 = [0, 0];
  const mk = (id, num, i) => ({ id, num, t0: 0, time: 150 + i * 40, cleared: true, screens: 5,
    players: [0, 1].map((p) => { const start = run0[p], end = (run0[p] += gain(id, i, p)); return { active: true, hero: p ? 'seraphine' : 'brann', kills: 22 + i * 6 - p * 4 + (id === 'bonus' ? -14 : 0), killValue: (22 + i * 6) * 1.3, ringouts: i, deaths: perfect ? 0 : (i + p) % 3 === 0 ? 1 : 0,
      pots: 3 + i, food: 1, damage: perfect ? 0 : 20 + i * 12, cleanScreens: 2, bestCombo: 18 + i * 7, scoreStart: start, scoreEnd: end }; }) });
  const out = [];
  for (let i = 0; i < stages; i++) { out.push(mk(String(i + 1), i + 1, i)); if (i < stages - 1) out.push(mk('bonus', 0, i)); }
  return { stages: out, startedAt: 0 };
}

export default {
  id: 'ui',
  async setup(ctx) {
    const { params, game } = ctx;
    const id = params.id || 'hud';
    const ui = game.ui;
    const p = (k, d) => (params.get ? params.get(k, d) : d);
    const heroes = async () => (await Promise.all(HERO_IDS.map((h) => registries.heroes.load(h)))).filter(Boolean);
    const wide = () => { game.cameraRig.focus.set(8, 0, 0); game.cameraRig.drama({ distance: 24, height: 7.5, fov: 30, lookHeight: 3.2, in: 0.001, hold: null }); game.cameraRig.snap(); };
    const withHud = async () => {
      await ctx.stage(p('stage', 'stage1'));
      const h1 = await ctx.hero('brann', { x: 2, z: 0, puppet: true, playerIndex: 0 });
      const h2 = await ctx.hero('seraphine', { x: 4, z: 0.8, puppet: true, playerIndex: 1 });
      game.session.join(0, 'brann'); game.session.players[0].actor = h1; game.session.players[0].score = 48250;
      game.session.join(1, 'seraphine'); game.session.players[1].actor = h2; game.session.players[1].score = 12900; game.session.players[1].lives = 2;
      h1.hp = 30; h1.pots = 3; h2.hp = 11; h2.pots = 6;
      ctx.gameCam([h1, h2]);
      ui.hud.show(true);
      return [h1, h2];
    };
    if (['hud', 'go', 'card', 'boss', 'gameover', 'demo', 'pause', 'tally'].includes(id)) {
      const [h1, h2] = await withHud();
      if (ui.hud && ui.hud.setStage) ui.hud.setStage(Number(p('stage', 1)), p('sname', 'Ashen Wilds'));
      if (id === 'go') ui.go(true);
      if (id === 'card') ui.card('STAGE 1', 'The Ashen Wilds', 999);
      if (id === 'boss') ui.bossCard('THE BRUTE BROTHERS', 'Butchers of the Ashen Wilds', 999);
      if (id === 'gameover') ui.card('YOUR LEGEND ENDS HERE', 'GAME OVER', 999, { big: true });
      if (id === 'demo') ui.demo(true);
      if (id === 'pause') await ui.show('pause', {});
      if (id === 'tally') { const run = sampleRun(Number(p('stage', 1))); await ui.show('tally', { rec: run.stages[run.stages.length - 1], players: [0, 1], t0: Number(p('t', 0)), onDone() {} }); }
      if (id === 'hud') {
        game.bus.emit('combo', { player: 0, count: 14, rank: 'B', multiplier: 1.5 });
        game.bus.emit('combo', { player: 1, count: 52, rank: 'KNOT', multiplier: 3 });
        if (p('cont', null)) { game.session.players[1].continueTimer = 6.5; }
      }
      ctx.expose({ heroes: [h1, h2] });
    } else if (id === 'title' || id === 'highscore' || id === 'entry' || id === 'options') {
      await ctx.stage('stage1'); wide();
      if (id === 'title') { const s = await ui.show('title', { onSelect() {}, skipPress: !!p('menu', null) }); ctx.expose({ screen: s }); }
      if (id === 'options') await ui.show('options', { onClose() {} });
      if (id === 'highscore') await ui.show('highscore', { entries: [], hold: 1e9, onDone() {} });
      if (id === 'entry') await ui.show('highscore', { entries: [{ player: 0, score: 187650, hero: 'gorrim', stage: '4' }], anyPlayer: true, hold: 1e9, onDone() {} });
    } else if (id === 'select') {
      const s = await ui.show('select', { heroes: await heroes(), onConfirm() {}, onBack() {}, noTimer: !!p('notimer', null) });
      await s.ready; // the 3D barrow set builds asynchronously: without this the first frames are a black void
      ctx.expose({ screen: s });
    } else if (id === 'map') {
      await ui.show('map', { t0: Number(p('t', 0)), to: Number(p('to', 2)), from: p('from', null) != null ? Number(p('from', 0)) : undefined, onDone() {} });
    } else if (id === 'ranking') {
      await ui.show('ranking', { run: sampleRun(Number(p('stages', 5)), !!p('perfect', null)), players: [0], heroes: { 0: 'brann' }, t0: Number(p('t', 0)), onDone() {} });
    } else if (id === 'type') {
      const { forge } = await import('../../ui/lettering.js');
      const art = await import('../../ui/art.js');
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;inset:0;background:#120a06;display:flex;flex-direction:column;gap:18px;align-items:center;justify-content:center;pointer-events:none';
      const row = (html) => `<div style="display:flex;gap:26px;align-items:center">${html}</div>`;
      el.innerHTML = row(`<span style="height:90px;display:inline-flex">${forge('ABCDEFGHIJKLM', { metal: 'copper', glint: 3 }).replace('class="forge', 'style="height:90px" class="forge')}</span>`)
        + row(forge('NOPQRSTUVWXYZ', { metal: 'gold' }).replace('class="forge', 'style="height:90px" class="forge'))
        + row(forge('0123456789 !?.,:-+/→%#', { metal: 'bronze' }).replace('class="forge', 'style="height:70px" class="forge'))
        + row(['copper', 'gold', 'bronze', 'ivory', 'iron', 'ember', 'p1', 'p2'].map((m) => forge(m, { metal: m }).replace('class="forge', 'style="height:44px" class="forge')).join(''))
        + row(art.knot({ size: 120 }) + art.corner({ size: 80 }) + art.crest('brann', { size: 90 }) + art.crest('seraphine', { size: 90 }) + art.crest('gorrim', { size: 90 }) + art.sword({ size: 160 }) + `<span style="width:30px;height:40px;display:inline-block">${art.pot({ full: true })}</span>`)
        + row(art.braid({ length: 900, height: 22 }));
      ui.screenLayer.appendChild(el);
    }
    // No ctx.label here: the showcase caption is a fixed bottom-left overlay and it sat on top of real UI copy
    // (title 'TOP LEGEND'). The id is in the URL / document title instead.
    document.title = `KCA ui · ${id}`;
  },
};
