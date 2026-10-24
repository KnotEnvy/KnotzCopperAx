// THE BRUTE BROTHERS' dedicated boss bodies (stage 1 boss; encounter src/enemies/bosses/brute_brothers.js).
// Same fighter as the regular Ogre Brute (types/ogre.js: moves, grab-and-toss, ground pound, dash; behaviour 'ogre',
// ogre anim clips) but its own art and a boss-sized frame:
//   tier 'gor' — GOR the Anvil: boss_brute_gor.glb (3.1 m; horned great-helm, twin pauldrons, riveted pectoral,
//                jade war-paint) + boss_brute_hammer_gor.glb (forged iron block maul);
//   tier 'mog' — MOG the Butcher: boss_brute_mog.glb (3.0 m; crested half-helm, skull-trophy pauldron, chained
//                forearm, blood-red soot mask) + boss_brute_hammer_mog.glb (iron-hooped spiked oak log).
// Art: blender/build_boss_brutes.py + blender/build_boss_weapons.py --only hammer_gor,hammer_mog.
import ogre from './ogre.js';

export default {
  ...ogre,
  id: 'boss_brute',
  name: 'Brute Brother',
  animCharacter: 'boss_brute',   // C2 r1: own idle/walk (anim/clips/boss_brute.js); falls through to the generic set
  asset: 'boss_brute_gor',
  height: 3.1,
  hurtHeight: 3.25,   // C2 r1: hurtbox top over the helm (idle mesh top gor 3.29 / mog 3.13; height × 0.95 was 2.95 / 2.85)
  radius: 0.68,
  weight: 2.8,
  mass: 5,
  anim: { ...ogre.anim, blade: { R: 1.34, pommel: 0.4 } },   // hammer head y 1.1, top 1.46, butt -0.4
  tiers: {
    gor: { name: 'Gor the Anvil', asset: 'boss_brute_gor', height: 3.1, hurtHeight: 3.25, hp: 160, ai: { cooldown: [86, 146] } },
    mog: { name: 'Mog the Butcher', asset: 'boss_brute_mog', height: 3.0, hurtHeight: 3.1, hp: 170, speed: 2.15, damageMul: 1.1,
      ai: { aggression: 0.72, reaction: 11, cooldown: [52, 104] } },
  },
  score: { hit: 30, ko: 2500 },
};
