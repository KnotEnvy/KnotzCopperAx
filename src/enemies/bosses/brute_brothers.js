// Boss encounter: THE BRUTE BROTHERS (stage 1; GA Bad Brothers). Two Ogre Brutes (types/ogre.js + ai/behaviours/ogre.js:
// alternating lead, ground-pound shockwaves, grab-and-toss, dash, the survivor ENRAGES) as one group boss: they wait
// until the grunts are dead (boss wave), stomp in from the right, pound the ground in unison (intro camera + card),
// then share one HUD boss bar; the last KO plays the defeat beat. Art: dedicated boss bodies (types/boss_brute.js:
// GOR the Anvil + MOG the Butcher, blender/build_boss_brutes.py) — the ogre fighter kit with boss-only art. Showcase: /?mode=showcase&what=boss&id=brute_brothers&scene=fight
import { spawnEnemy } from '../spawnEnemy.js';
import { groupBoss } from './_group.js';
import { bossLook, bossRim } from './_look.js';
import { initPoise, soloMercy } from './_poise.js';

const NAME = 'The Brute Brothers', TITLE = 'Butchers of the Ashen Wilds';

export default {
  id: 'brute_brothers',
  name: NAME,
  title: TITLE,
  stage: 'stage1',
  arenaX: 46,
  async encounter(game, ctx = {}) {
    const x = ctx.x ?? 0;
    const vis = game.cameraRig && game.cameraRig.visibleRange ? game.cameraRig.visibleRange(0) : { xMin: x - 9, xMax: x + 9 };
    const hs = game.world.query({ kind: 'hero' });
    const two = hs.length > 1;
    const hx = hs.length ? hs.reduce((s, h) => s + h.pos.x, 0) / hs.length : x - 4;
    const targetX = Math.min(x, hx + 4.6);
    // C2 r12 (board r11: "the Brute Brothers overlap each other in the intro"): a staggered pair — GOR in the front lane
    // a little left, MOG in the back lane 2.5 m to his right (was 1.5 m apart with MOG behind-left: one silhouette)
    const hp = two ? [450, 515] : [300, 340], tiers = ['gor', 'mog'], zs = [0.75, -0.7], dxs = [-0.9, 1.6];
    const members = [];
    for (let i = 0; i < 2; i++) {
      const tx = Math.min(vis.xMax - 2.0, targetX + dxs[i]), sx = Math.min(vis.xMax - 1.2, tx + 2.2 + i * 0.6);
      const e = await spawnEnemy(game, 'boss_brute', { x: sx, z: zs[i], facing: -1, tier: tiers[i], hp: Math.round(hp[i] * (two ? 1.5 : 1)), group: two ? 'brutes_' + tiers[i] : 'brutes', enterFrom: { x: tx, z: zs[i], fixed: true } });   // fixed: the director's entry lanes must not re-stack them
      if (e) {
        bossLook(e.modelRoot || e.view); bossRim(e.modelRoot || e.view, 1.35);
        // r7 poise: super-armour on every swing / pound / grab, 7-tick flinches, a stagger only after a real combo, armoured swing counter
        initPoise(e, { max: 76, immune: 540, counter: 'swing', counterReach: 2.4, stagger: { ticks: 84, mul: 1.4, shove: 2.6 } }, { wrap: true });
        soloMercy(e, 0.7);   // r7: armoured brutes hit a lone hero for ~2.9 lives in the solo probe
        members.push(e);
      }
    }
    // r7: with two heroes each brother runs its OWN ogre pair-group (ai/behaviours/ogre.js alternates the lead inside one group, which
    // left the lead brother attacking ~7 % of the fight while the partner 'menaced'); the survivor's enrage is triggered here instead.
    // A lone hero keeps the alternating pair (independent brothers cost the solo probe 2.1 lives vs 1.2).
    const sc = game.bus.scope();
    sc.on('boss:memberDown', ({ actor }) => { const o = members.find((m) => m !== actor && m.alive && !m.removed); if (o && o.brain && o.brain.enrage) o.brain.enrage(); });
    sc.on('boss:finaleDone', () => sc.dispose());
    const G = groupBoss(game, { name: NAME, title: TITLE, typeId: 'ogre', members, element: 'earth' });
    return {
      lead: G.proxy, actors: members, tokens: [G.token], group: G,
      begin() {
        const focus = { get pos() { const a = members.filter((m) => m.alive); return a.length ? { x: a.reduce((s, m) => s + m.pos.x, 0) / a.length, y: 0, z: 0 } : { x: targetX, y: 0, z: 0 }; } };
        G.run(G.intro({ focus, ticks: 132, announceAt: 62, onBeat(t) {
          if (t === 54) for (const m of members) if (m.alive && m.pause) m.pause(50, { anim: 'light_3', face: true });
          if (t === 70) {
            for (const m of members) if (m.alive && game.vfx && game.vfx.spawn) { const p = { x: m.pos.x + m.facing * 1.1, y: 0.02, z: m.pos.z }; game.vfx.spawn('fx_shockwave', { pos: p, radius: 2.6, element: 'earth', dust: true, debris: 10 }); game.vfx.spawn('fx_crack', { pos: p, radius: 1.3, element: 'earth' }); }
            if (game.cameraRig && game.cameraRig.shake) game.cameraRig.shake(0.7);
          }
        } }));
      },
    };
  },
  async create(game, opts = {}) { const enc = await this.encounter(game, opts); enc.begin(); return enc.actors[0]; },
};
