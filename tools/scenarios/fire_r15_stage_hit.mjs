// r15 copy of fire_r13_stage_hit (adds +50/+150 ms stills off the 33 ms clip grid). r13 builder copy of the QA runner probe (not shipped); adds the chest screen position per sample: STAGE-mode magic-fire hit through the real CombatSystem on the nearest live stage-1 enemy.
// Same hit payload as the builder's showcase probe (tools/scenarios/fire_r12_hit.mjs), sampled 0..495 ms every 33 ms.
import fs from 'node:fs';
import path from 'node:path';
export default async (api) => {
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    await api.advance(200);
    ready = await api.evalGame(() => window.__KCA.game.world.query({ team: 'enemies' }).some((e) => e.alive));
  }
  if (!ready) throw Error('No live stage-1 enemy to hit');
  await api.evalGame(() => {
    const g = window.__KCA.game;
    const hero = g.world.query({ kind: 'hero' }).find((h) => h.playerIndex === 0) || g.world.query({ kind: 'hero' })[0];
    const foes = g.world.query({ team: 'enemies' }).filter((e) => e.alive);
    const foe = foes.sort((a, b) => Math.abs(a.pos.x - hero.pos.x) - Math.abs(b.pos.x - hero.pos.x))[0];
    foe.brain = null; foe.invuln = 0; foe.hitstop = 0; foe.hp = foe.maxHp = 999;
    window.__qaFoe = foe.id; window.__qaHero = hero.id;
    window.__qaHit = g.combat.applyHit(hero, foe, { damage: 1, level: 'magic', element: 'fire', knockback: 6, hitstun: 32, hitstop: 0 }, { moveId: 'fire_attachment_probe', dir: hero.pos.x < foe.pos.x ? 1 : -1 });
    g.renderer.render(0);
  });
  if (!await api.evalGame(() => window.__qaHit)) throw Error('Stage fire probe did not apply a CombatSystem hit');
  const samples = [];
  const times = [...Array(19).keys()].map((i) => i * 33).concat([50, 150]).sort((a, b) => a - b);
  let now = 0;
  for (const ms of times) {
    if (ms > now) { await api.advance(ms - now); now = ms; }
    if (ms % 33 === 0) await api.frames(1, 0, 'stagefire');
    await api.shot(`fire-${String(ms).padStart(3, '0')}ms`);
    const i = ms;
    samples.push(await api.evalGame((ms) => {
      const g = window.__KCA.game, foe = g.world.query({ team: 'enemies' }).find((e) => e.id === window.__qaFoe);
      const chest = foe && foe.modelRoot && foe.modelRoot.getObjectByName('chest');
      return { ms, foe: foe ? foe.pos.toArray() : null, chest: chest ? chest.getWorldPosition(g.camera.position.clone()).toArray() : null,
        screen: chest ? (() => { const q = chest.getWorldPosition(g.camera.position.clone()).project(g.camera); return [(q.x + 1) * 800, (1 - q.y) * 450]; })() : null,
        fire: g.vfx.fire.items.length, errors: window.__KCA.info().errors };
    }, i));
  }
  fs.writeFileSync(path.join(api.outDir, 'stage-fire-timing.json'), JSON.stringify(samples, null, 2));
  fs.writeFileSync(path.join(api.outDir, 'screen.json'), JSON.stringify(samples.map((s) => ({ ms: s.ms, screen: s.screen }))));
};
