// THE HOLLOW KNIGHT CAPTAINS' dedicated boss bodies (stage 2 boss; encounter src/enemies/bosses/captains.js).
// Same fighter as the regular Hollow Knight (types/knight.js: frontal guard, sweeps, reach thrust, armoured chop,
// counters; behaviour 'knight', knight anim clips) with boss art + a boss frame (critic r3: "stock 2.5 m knights"):
//   tier 'patina' — COL. PATINA the Oathbound: boss_captain_patina.glb (3.0 m native; crimson enamel, towering
//                   horsehair crest + swept iron wing-fins, x1.6 flanged pauldrons, crimson mantle + torn cape) +
//                   boss_captain_halberd_patina.glb ("Crimson Oath": bearded crescent + hooked beak, 3.4 m);
//   tier 'oxide'  — GEN. OXIDE the Gilded: boss_captain_oxide.glb (3.1 m; gilded plate, crowned helm with forward
//                   horns + trailing bone plume, x1.75 spiked pauldrons, black-violet mantle + cape) +
//                   boss_captain_halberd_oxide.glb ("Gilded Doom": double moon-crescent).
// Art: blender/build_boss_captains.py + blender/build_boss_weapons.py --only halberd_patina,halberd_oxide.
// Hit boxes / spacing grow ×REACH with the frame (the great-halberds are 1.6× the regular one) so the swings stay
// honest to what is drawn.
import knight from './knight.js';

const REACH = 1.3;
const D = Math.PI / 180;
const SHIELD_ROT = [0, 120 * D, 0];   // prop → socket_hand_L (tuned on the shield-forward guard, anim/clips/boss_captain.js)
const scaleBox = (b) => ({ ...b, x: b.x * REACH, y: (b.y || 0) * REACH, w: b.w * REACH, h: b.h * REACH, d: b.d * 1.1 });
const moves = {};
for (const [k, m] of Object.entries(knight.moves)) {
  moves[k] = { ...m, hits: (m.hits || []).map((h) => ({ ...h, box: h.box ? scaleBox(h.box) : h.box })), move: (m.move || []).map((s) => ({ ...s, speed: s.speed * 1.15 })) };
}

export default {
  ...knight,
  id: 'boss_captain',
  name: 'Hollow Knight Captain',
  animCharacter: 'boss_captain',   // C2 r1: own idle/walk (anim/clips/boss_captain.js); falls through to the generic set
  asset: 'boss_captain_patina',
  height: 3.0,
  radius: 0.58,
  weight: 2.2,
  mass: 4,
  speed: 2.0,
  moves,
  ai: { ...knight.ai, spacing: knight.ai.spacing * REACH, attackRange: knight.ai.attackRange * REACH, depthTol: 0.62 },
  // C2 r12: the Enemy Art tower shield (boss_captain_shield_<tier>.glb, origin = grip_shield, handle along +Y, emblem
  // face +X) rides socket_hand_L — attached here, NOT as model.weaponL (Trails would ribbon a weaponL on every swing).
  // Built inside create() so the stage prewarm's warm captain links its program too. &captainshield=0 = no shield.
  async create(game, opts, { Enemy, def }) {
    const model = await game.assets.character({ ...def, asset: def.asset });
    const off = typeof location !== 'undefined' && /[?&]captainshield=0/.test(location.search);
    let shield = null;
    if (!off && def.shield) {
      try {
        shield = await game.assets.weapon(def.shield, null);
        const sock = model.root.getObjectByName('socket_hand_L');
        if (shield && sock) { shield.name = 'captain_shield'; shield.rotation.set(SHIELD_ROT[0], SHIELD_ROT[1], SHIELD_ROT[2]); sock.add(shield); }
      } catch (e) { shield = null; }
    }
    const e = new Enemy(game, def, model, opts);
    e._shield = shield;
    return e;
  },
  tiers: {
    patina: { name: 'Col. Patina', asset: 'boss_captain_patina', shield: 'boss_captain_shield_patina', height: 3.0, hp: 190, speed: 2.0, palette: knight.tiers.red.palette,
      ai: { ...knight.ai, ...knight.tiers.red.ai, spacing: knight.ai.spacing * REACH, attackRange: knight.ai.attackRange * REACH, depthTol: 0.62 } },
    oxide: { name: 'Gen. Oxide', asset: 'boss_captain_oxide', shield: 'boss_captain_shield_oxide', height: 3.1, hp: 200, speed: 2.1, damageMul: 1.05, palette: knight.tiers.gold.palette,
      ai: { ...knight.ai, ...knight.tiers.gold.ai, spacing: knight.ai.spacing * REACH, attackRange: knight.ai.attackRange * REACH, depthTol: 0.62 } },
  },
  score: { hit: 30, ko: 2500 },
};
