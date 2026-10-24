// what=ai&id=<scenario>[&hero=brann][&p2=seraphine][&difficulty=easy|normal|hard][&stage=<id>] — AI / encounter scenarios.
//   Each scenario sits in a real stage (r2): skeleton → stage2, the rest → stage1
//   mid-stage (x offset STAGE_AT); &stage=test restores the flat void.
//   thief     bot hero vs a blue pot thief running in (then a green meat thief): cackle, keep-away, kick spills, escape
//   camp      Thieves' Night: a resting hero with 5 pots; a blue thief sneaks in, steals 2 and bolts
//   marauder  bot hero vs the four marauder tiers (straw, rust, violet, iron) + an elite Sgt. Tarnish
//   skeleton  bot hero vs white skeletons RISING from the ground + a purple (Death Stab) — crumble / reassemble
//   knight    bot hero vs two Hollow Knights (frontal guard, halberd sweeps, counters)
//   ogre      bot hero vs the Brute Brothers (alternating lead, grab-and-toss, ground pound, enrage)
//   viper     bot hero vs three Viper Maidens (pokes, leaps, backflips, dash lunge)
//   crowd     mixed crowd: marauders + skeletons + viper + knight + a thief (the director's slots / tokens)
//   coop      two bot heroes vs a mixed crowd (co-op target splitting)
//   tokens    idle god-mode hero vs 6 marauders (see at most N attackers at a time)
//   duel      bot hero vs 1 elite iron marauder (Gen. Oxide)
// __KCA.showcase: tokens() → holders per hero, crowd() → per-enemy { type, state, mode, target, slot }, stats() → director stats
const SCEN = {
  thief: [['thief', 11, 0.4, { tier: 'blue', opts: { sack: 4 } }], ['@', 7, () => ['thief', -11, -0.8, { tier: 'green', opts: { sack: 3 } }]]],
  camp: [['thief', 11, 0.2, { tier: 'blue', opts: { steal: 2, sack: 1 } }]],
  marauder: [['marauder', 5, 0.6, { tier: 'straw' }], ['marauder', -5, -0.6, { tier: 'rust' }], ['marauder', 7, -1.2, { tier: 'violet' }], ['marauder', -7.5, 1.2, { tier: 'iron' }], ['marauder', 9, 0.2, { tier: 'rust', opts: { elite: 1 } }]],
  skeleton: [['skeleton', 3.2, -1.0, { opts: { rise: true } }], ['skeleton', -3.4, 0.8, { opts: { rise: true } }], ['@', 2.5, () => ['skeleton', 4.5, 1.2, { opts: { rise: true } }]], ['@', 5, () => ['skeleton', -4.8, -1.3, { tier: 'purple', opts: { rise: true } }]]],
  knight: [['knight', 5, 0.3, {}], ['knight', -6, -0.8, { tier: 'red' }]],
  ogre: [['ogre', 5.5, 0.5, { opts: { group: 'brutes' } }], ['ogre', -6, -0.8, { tier: 'silver', opts: { group: 'brutes' } }]],
  viper: [['viper', 5, 0.5, {}], ['viper', -5.5, -0.8, { tier: 'crimson' }], ['viper', 7.5, -1.4, { tier: 'dusk' }]],
  crowd: [['marauder', 5, 0.6, { tier: 'rust' }], ['marauder', -5, -0.6, { tier: 'violet' }], ['viper', 7, -1.2, {}], ['knight', -7.5, 1.0, {}], ['skeleton', 3.5, -1.3, { opts: { rise: true } }], ['@', 4, () => ['thief', 11, 0.9, { tier: 'blue' }]], ['@', 6, () => ['skeleton', -3.5, 1.2, { opts: { rise: true } }]]],
  coop: [['marauder', 6, 0.6, { tier: 'rust' }], ['marauder', 7, -1.0, { tier: 'straw' }], ['marauder', -6, -0.6, { tier: 'violet' }], ['viper', 8, 1.2, {}], ['skeleton', -4, 1.0, { opts: { rise: true } }], ['marauder', -8, -1.4, { tier: 'iron' }]],
  tokens: [[4, 0.5], [5, -1], [-4, 1], [-5, -0.5], [6, 1.5], [-6, -1.5]].map(([x, z]) => ['marauder', x, z, { tier: 'rust' }]),
  duel: [['marauder', 4.5, 0, { tier: 'iron', opts: { elite: 4 } }]],
};

const STAGE_FOR = { skeleton: 'stage2' }; // bonus (Thieves' Night) extents ±8 pin a fleeing thief on-screen → camp/thief use stage1
const STAGE_AT = { stage1: 22, stage2: 30, bonus: 0, test: 0 };

export default {
  id: 'ai',
  async setup(ctx) {
    const { params, game } = ctx;
    const id = SCEN[params.id] ? params.id : 'crowd';
    const stageId = params.get('stage', STAGE_FOR[id] || 'stage1');
    await ctx.stage(stageId);
    const ox = STAGE_AT[stageId] ?? 0;
    const h = await ctx.hero(params.get('hero', 'brann'), { x: ox, z: 0 });
    const heroes = [h];
    if (id === 'coop' || params.get('p2')) {
      const h2 = await ctx.hero(params.get('p2', 'seraphine'), { x: ox - 1.5, z: 0.9, playerIndex: 1 });
      heroes.push(h2);
    }
    h.godMode = id === 'tokens' || id === 'camp' || params.get('god') === '1';
    if (id === 'camp') { if (h.addPots) h.addPots(5); }
    else if (id !== 'tokens') for (const x of heroes) game.bots.attach(x, { skill: Number(params.get('skill', '0.85')) });
    const spawn = async ([type, x, z, o]) => ctx.enemy(type, { x: x + ox, z, tier: o.tier, opts: o.opts });
    for (const s of SCEN[id]) {
      if (s[0] === '@') ctx.after(s[1], () => { const p = spawn(s[2]()); if (game.track) game.track(p); });
      else await spawn(s);
    }
    ctx.gameCam(heroes, { lock: [ox - 12, ox + 12] });
    ctx.label(`ai · ${id}`);
    ctx.expose({
      tokens: () => [...game.ai.tokens.byTarget.values()].map((m) => m.size),
      crowd: () => game.world.query({ team: 'enemies' }).map((e) => ({ id: e.id, type: e.typeId, tier: e.tier, hp: e.hp, state: e.fsm.name, mode: e.brain && e.brain.mode, target: e.aiTarget && e.aiTarget.id, slot: e.aiSlot })),
      stats: () => ({ ...game.ai.director.stats }),
      heroes,
    });
  },
};
