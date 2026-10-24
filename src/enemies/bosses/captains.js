// Boss encounter: HOLLOW KNIGHT CAPTAINS (stage 2, tortoise-shell shrine). Two elite Hollow Knights (Col. Patina in
// crimson, Gen. Oxide in gold: dedicated 3 m boss bodies types/boss_captain.js on the knight kit + ai/behaviours/knight.js — frontal guard, halberd sweeps, counters,
// pincer from both sides) marching in from both flanks as one group boss. Showcase: &id=captains&scene=fight
import { spawnEnemy } from '../spawnEnemy.js';
import { groupBoss } from './_group.js';
import { bossRim } from './_look.js';
import { initPoise, soloMercy } from './_poise.js';
import * as THREE from 'three';
import { reportError } from '../../core/log.js';

const BEAT_OFF = typeof location !== 'undefined' && /[?&]captainbeat=0/.test(location.search);
const _bx = new THREE.Box3();
/** C2 r13 entrance beat under the name card (board r12: both captains stood idle the whole card interval): one stride
 *  forward (root driven f4-22 to match the clip's planted feet), the tower shield slammed into the floor at f26 with a
 *  dust ring + puffs at the shield's lower rim and a short thud shake, then the plume toss (anim/clips/boss_captain.js
 *  shield_plant). Patina leads, Oxide answers 12 ticks later. &captainbeat=0 = the r12 taunt. */
function plantBeat(game, m, k) {
  if (!m || !m.alive || m.removed) return;
  if (k === 0) { if (m.pause) m.pause(78, { anim: 'shield_plant', face: true, duration: 76 / 60 }); }
  if (!m.fsm || !m.fsm.is('pause')) return;
  m.pauseVx = k >= 4 && k < 22 ? 1.5 : 0;
  if (k === 26) {
    let x = m.pos.x + (m.facing || 1) * 0.8, y = 0.02, z = m.pos.z;
    try { if (m._shield) { _bx.setFromObject(m._shield); if (!_bx.isEmpty()) { x = (_bx.min.x + _bx.max.x) / 2; z = (_bx.min.z + _bx.max.z) / 2; y = Math.max(0.02, _bx.min.y); } } } catch (e) { reportError('captains.shieldBox', e); }
    const v = game.vfx;
    if (v && v.spawn) {
      v.spawn('dust', { pos: { x, y: 0, z }, amount: 1.3, kind: 'land' });
      v.spawn('land_impact', { actor: { pos: { x, y: 0, z }, facing: m.facing }, speed: 9, body: true });
    }
    if (game.cameraRig && game.cameraRig.shake) game.cameraRig.shake(0.2);
    if (game.audio && game.audio.play) try { game.audio.play('land_heavy', { volume: 0.7, pitch: 0.75, bus: 'sfx' }); } catch (e) { /* optional */ }
    m._plantY = y;
  }
}

const NAME = 'Hollow Knight Captains', TITLE = 'Oathbound of the Drowned Shrine';

export default {
  id: 'captains',
  name: NAME,
  title: TITLE,
  stage: 'stage2',
  arenaX: 63,
  async encounter(game, ctx = {}) {
    const x = ctx.x ?? 0;
    const vis = game.cameraRig && game.cameraRig.visibleRange ? game.cameraRig.visibleRange(0) : { xMin: x - 9, xMax: x + 9 };
    const two = game.world.query({ kind: 'hero' }).length > 1;
    const cx = (vis.xMin + vis.xMax) / 2;
    const spec = [
      { tier: 'patina', elite: 3, x: cx + 3.8, to: cx + 2.4, z: 0.8, facing: -1 },
      { tier: 'oxide', elite: 4, x: cx - 3.8, to: cx - 2.4, z: -1.0, facing: 1 },
    ];
    const members = [];
    for (const s of spec) {
      const e = await spawnEnemy(game, 'boss_captain', { x: s.x, z: s.z, facing: s.facing, tier: s.tier, elite: s.elite, hp: Math.round((two ? 1.5 : 1) * 190), enterFrom: { x: s.to, z: s.z } });
      if (e) {   // r4: dedicated 3 m boss bodies (types/boss_captain.js)
        bossRim(e.modelRoot || e.view, 1.35);
        // r7 poise: armoured halberd swings, tiny flinches, stagger only after a real combo, quick counter-thrust when a hero is in reach
        initPoise(e, { max: 58, immune: 540, counter: 'counter', counterReach: 3.2, counterDz: 1.0, stagger: { ticks: 88, mul: 1.4, shove: 2.6 } }, { wrap: true });
        soloMercy(e, 0.72);   // r7: armoured captains cost a lone hero ~2 lives in the solo probe
        members.push(e);
      }
    }
    const G = groupBoss(game, { name: NAME, title: TITLE, typeId: 'knight', members, element: 'storm' });
    return {
      lead: G.proxy, actors: members, tokens: [G.token], group: G,
      begin() {
        const focus = { pos: { x: cx, y: 0, z: 0 } };
        if (BEAT_OFF) {
          G.run(G.intro({ focus, ticks: 128, distance: 12.5, announceAt: 58, onBeat(t) {
            if (t === 50) for (const m of members) if (m.alive && m.pause) m.pause(50, { anim: 'taunt', face: true });
            if (t === 62 && game.cameraRig && game.cameraRig.shake) game.cameraRig.shake(0.35);
          } }));
          return;
        }
        // the card goes up at t 52 as Patina starts her stride; both beats finish under it; the intro holds to t 172
        G.run(G.intro({ focus, ticks: 172, distance: 12.5, announceAt: 52, onBeat(t) {
          plantBeat(game, members[0], t - 54);
          plantBeat(game, members[1], t - 66);
        } }));
      },
    };
  },
  async create(game, opts = {}) { const enc = await this.encounter(game, opts); enc.begin(); return enc.actors[0]; },
};
