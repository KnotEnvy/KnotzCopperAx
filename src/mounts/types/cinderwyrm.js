// Cinderwyrm: red riding dragon (GA "red dragon") — roots and LOBS ONE FIREBALL at a time across the screen.
//   Light / air = FIREBALL (if one of ours is still in flight: a BITE instead — DESIGN §10 "only one in flight").
//   Heavy / dash = HEAD RAM.
// Visual: shares the drake model with a red palette + forward horns (PLACEHOLDER-grade until mount_cinderwyrm.glb).
import { loadBeastRig } from '../beastRig.js';
import { buildDrake, animateDrake, mouthWorld } from '../drake.js';
import { chargeTick, Fireball } from '../breath.js';
import { makeFireballMesh } from '../../vfx/effects/mount_fire.js';

export default {
  id: 'cinderwyrm',
  name: 'Cinderwyrm',
  hp: 52,
  speed: 3.8, run: 7.4, jump: 1.6, enemySpeed: 2.7,
  height: 2.1, radius: 0.7, saddleY: 1.4, soak: 0.55, stride: 1.6, hurtDepth: 0.55,
  leaveTicks: 720,
  buttons: { light: 'fireball', heavy: 'ram', dash: 'ram', air: 'ram' },
  gate(m, rider, key) { return key === 'fireball' && m.fireball && !m.fireball.removed ? 'bite' : key; },
  attacks: {
    fireball: { anim: 'ride_idle', startup: 18, active: 0, recovery: 24, friction: 30 },
    bite: { anim: 'ride_idle', startup: 8, active: 5, recovery: 14, friction: 12,
      hits: [{ box: { x: 1.4, y: 0.6, w: 1.2, h: 1.0, d: 1.0 }, damage: 4, hitstun: 22, knockback: 2.2, hitstop: 6, level: 'light' }] },
    ram: { anim: 'ride_idle', startup: 7, active: 12, recovery: 16, friction: 8, move: [{ from: 4, to: 19, speed: 8.5, ease: 'out' }],
      hits: [{ box: { x: 1.1, y: 0.35, w: 1.5, h: 1.3, d: 1.0 }, damage: 4, knockdown: true, knockback: 4, launch: 3, hitstop: 6, level: 'light', shake: 0.2 }] },
  },
  onAttackTick(m, rider, run, id) {
    if (id !== 'fireball') return;
    const f = run.frame, g = m.game;
    if (f >= 8 && f < 18) chargeTick(g, mouthWorld(m), (f - 8) / 10);
    if (f === 18 && !(m.fireball && !m.fireball.removed)) {
      const p = mouthWorld(m);
      const fb = new Fireball(g, m, { x: p.x + m.facing * 0.3, y: Math.max(0.6, p.y - m.pos.y), z: m.pos.z, dir: m.facing, speed: 11.5, range: 22,
        hit: { damage: 8, knockdown: true, launch: 4.2, knockback: 4.2, level: 'magic', hitstop: 7, shake: 0.3, element: 'fire', spark: 'mount_fire' } });
      fb.team = rider.team;
      g.world.add(fb);
      m.fireball = fb;
      if (g.audio) g.audio.play('magic_fire', { volume: 0.8, pitch: 1.2 });
    }
  },
  async create(game, opts, { Mount, def }) {
    const m = new Mount(game, def, opts);
    const rig = await loadBeastRig(game, 'mount_cinderwyrm', () => buildDrake('red', { name: 'mount_cinderwyrm', horns: 'forward' }));
    m.body.add(rig.root);
    m.model = rig.root; m.rig = rig;
    const seat = rig.root.getObjectByName('socket_saddle');
    if (seat) seat.add(m.saddle); else { m.saddle.position.set(0, def.saddleY, 0); m.body.add(m.saddle); }
    m.animate = (dt, speed) => animateDrake(m, rig, dt, speed);
    m.fireMesh = makeFireballMesh(); m.body.add(m.fireMesh); // linked by stage prewarm, hides after its first draw
    return m;
  },
};
