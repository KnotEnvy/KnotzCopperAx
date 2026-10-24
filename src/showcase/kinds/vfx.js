// what=vfx&id=<effect>[&kind=light|heavy|knockdown|ko|block|otg|throw|magic][&hero=brann][&at=0.1][&every=0.8]
//          [&stage=stage1|test][&element=earth|fire|storm][&cam=close|game]
// Fires the effect repeatedly. Hit effects (hit_spark, or id=hits to cycle every weight) play against a real enemy
// with a hero attacker, and also run ScreenFx (victim flash, shake, CA) so the whole impact reads in context.
// Other ids fire at centre with generic opts (pos, point, dir, element, power, actor = the hero).
import { registries } from '../../core/registries.js';

// magic_<element> = a magic hit forced to that element (earth/fire/storm read side by side)
const HIT_KINDS = ['light', 'heavy', 'knockdown', 'ko', 'block', 'otg', 'throw', 'magic_earth', 'magic_fire', 'magic_storm'];

export default {
  id: 'vfx',
  async setup(ctx) {
    const { params, game } = ctx;
    const id = params.id || 'hit_spark';
    await ctx.stage(params.get('stage', 'stage1'));
    // Idle A/B proved the pale victim was the stage's actor key, before any hit/flash. Give this inspection
    // showcase a restrained key so material colour and a brief contact flash can both be assessed.
    // &lighting=stage restores the exact stage rig for comparison; real stage gameplay keeps its own rig.
    if (params.get('lighting') !== 'stage') {
      const light = game.renderer.lighting, p = light.preset;
      light.apply({ ...p, character: { ...p.character,
        key: { ...p.character.key, intensity: 1.15, wrap: 0.18, albedoFloor: 0.08, albedoLiftMax: 1.4 },
        ambientIntensity: 0.16, clamp: { knee: 0.55, max: 0.95 } } });
    }
    const hitMode = id === 'hit_spark' || id === 'hits';
    const heroId = params.get('hero', 'brann');
    const hero = await ctx.hero(heroId, { x: hitMode ? -1.0 : -1.6, puppet: true });
    const foe = hitMode ? await ctx.enemy('marauder', { x: 0.25, facing: -1, puppet: true }) : null;
    if (foe) foe.hp = foe.maxHp = 99999;
    const cam = params.get('cam', 'close');
    if (cam === 'game') ctx.gameCam([hero], {});
    else ctx.orbit({ target: [-0.2, 1.0, 0], distance: 7.5, height: 1.6, fov: 30 });
    let n = 0;
    const fire = (kindOverride) => { // eslint-disable-line prefer-const
      n++;
      let element = params.get('element') || undefined;
      if (hitMode) {
        let kind = kindOverride || params.get('kind') || (id === 'hits' ? HIT_KINDS[(n - 1) % HIT_KINDS.length] : (n % 2 ? 'light' : 'heavy'));
        if (kind.startsWith('magic_')) { element = kind.slice(6); kind = 'magic'; }
        const ev = {
          kind, point: { x: foe.pos.x - 0.15, y: kind === 'otg' || kind === 'throw' ? 0.35 : 1.15, z: foe.pos.z }, dir: 1, attacker: hero, target: foe,
          level: kind === 'magic' ? 'magic' : kind === 'light' ? 'light' : 'heavy', hitstop: kind === 'light' ? 5 : kind === 'ko' ? 12 : 8, element,
          hit: { shake: null, element }, blocked: kind === 'block', killed: kind === 'ko', moveId: kind === 'throw' ? 'throw' : kind === 'otg' ? 'death_stab' : 'x',
        };
        game.vfx.spawn('hit_spark', ev);
        game.vfx.screen.onHit(ev);
        foe.hitstop = ev.hitstop + 1;
        if (hero.play) hero.play(kind === 'light' ? 'light_1' : 'heavy', { restart: true });
      } else {
        const p = { x: 0, y: 0, z: 0 };
        // id=all: fire(effectId) spawns that effect (scenario lists), else cycles every registered effect
        const all = id === 'all', ids = registries.effects.ids().filter((e) => e !== 'all');
        const eid = all ? (kindOverride || ids[(n - 1) % ids.length]) : id;
        if (all) kindOverride = undefined;
        game.vfx.spawn(eid, { point: { x: 0, y: 1.1, z: 0 }, pos: p, from: { x: -0.6, y: 6, z: 0 }, to: p, dir: n % 4 < 2 ? 1 : -1, level: params.get('level') || 'heavy',
          element: element || ['earth', 'fire', 'storm'][n % 3], power: Number(params.get('power', 1 + (n % 4))), amount: 1.2, actor: hero, hero, kind: params.get('kind') || undefined, type: kindOverride || params.get('type') || undefined, level: 3, count: 12, force: true, delay: all ? 0 : undefined });
      }
    };
    ctx.after(Number(params.get('at', '0.1')), () => fire());
    ctx.every(Number(params.get('every', '0.8')), () => fire());
    ctx.label(`vfx · ${id}${params.get('kind') ? ' · ' + params.get('kind') : ''}`);
    ctx.expose({ fire, effects: () => registries.effects.ids(), kinds: () => HIT_KINDS.slice(), hero, foe });
  },
};
