// Emberdrake: small blue-scaled riding dragon (GA "blue dragon").
//   Light / air = FIRE BREATH: roots in place, rears back, then a short cone of flame (multi-hit, last hit floors).
//                 Its reach (0.6–3.8 m) out-ranges a knight's swing. (GA: stream, 8 total)
//   Heavy / dash = HEAD RAM (GA: dash 4).
import { loadBeastRig } from '../beastRig.js';
import { buildDrake, animateDrake, mouthWorld } from '../drake.js';
import { breathTick } from '../breath.js';
import { makeFlameCone } from '../../vfx/effects/mount_fire.js';

export default {
  id: 'emberdrake',
  name: 'Emberdrake',
  hp: 48,
  speed: 3.9, run: 7.6, jump: 1.7, enemySpeed: 2.8,
  height: 2.1, radius: 0.7, saddleY: 1.4, soak: 0.55, stride: 1.6, hurtDepth: 0.55,
  leaveTicks: 720,
  buttons: { light: 'breath', heavy: 'ram', dash: 'ram', air: 'ram' },
  attacks: {
    breath: { anim: 'ride_idle', startup: 16, active: 30, recovery: 16, friction: 30,
      hits: [
        { from: 16, to: 40, box: { x: 2.2, y: 0.25, w: 3.3, h: 1.4, d: 1.3 }, damage: 2, hits: 3, interval: 8, hitstun: 20, knockback: 1.2, hitstop: 3, level: 'light', spark: 'mount_fire', element: 'fire', reaction: 'hit_high' },
        { from: 40, to: 46, box: { x: 2.2, y: 0.25, w: 3.3, h: 1.4, d: 1.3 }, damage: 2, knockdown: true, launch: 3.4, knockback: 3.2, hitstop: 5, level: 'heavy', spark: 'mount_fire', element: 'fire', shake: 0.2 },
      ] },
    ram: { anim: 'ride_idle', startup: 7, active: 12, recovery: 16, friction: 8, move: [{ from: 4, to: 19, speed: 8.5, ease: 'out' }],
      hits: [{ box: { x: 1.1, y: 0.35, w: 1.5, h: 1.3, d: 1.0 }, damage: 4, knockdown: true, knockback: 4, launch: 3, hitstop: 6, level: 'light', shake: 0.2 }] },
  },
  onAttackTick(m, rider, run, id) {
    if (id !== 'breath') return;
    const f = run.frame, S = 16, A = 46, g = m.game;
    if (f < S - 2 || f > A) { if (f === 8 && g.audio) g.audio.play('whoosh_club', { volume: 0.5, pitch: 0.6 }); return; }
    const k = Math.min(1, (f - (S - 2)) / 5) * (f > A - 5 ? (A - f) / 5 : 1);
    // The cone reaches exactly as far as the hitbox (x 0.55..3.85 m ahead, chest height at the far end).
    const mouth = mouthWorld(m), to = { x: m.pos.x + m.facing * 3.85, y: m.pos.y + 0.95, z: mouth.z };
    const gy = g.vfx && g.vfx.groundY ? g.vfx.groundY(m.pos) : 0;
    breathTick(g, mouth, m.facing, Math.max(0.15, k), { to, gy, cone: m.flameCone, owner: m, phase: f === S - 2 ? 'start' : f === A ? 'end' : null });
    if (f === S && g.audio) g.audio.play('magic_fire', { volume: 0.7 });
  },
  async create(game, opts, { Mount, def }) {
    const m = new Mount(game, def, opts);
    const rig = await loadBeastRig(game, 'mount_emberdrake', () => buildDrake('blue', { name: 'mount_emberdrake' }));
    m.body.add(rig.root);
    m.model = rig.root; m.rig = rig;
    const seat = rig.root.getObjectByName('socket_saddle');
    if (seat) seat.add(m.saddle); else { m.saddle.position.set(0, def.saddleY, 0); m.body.add(m.saddle); }
    m.animate = (dt, speed) => animateDrake(m, rig, dt, speed);
    m.flameCone = makeFlameCone(); m.body.add(m.flameCone); // linked by stage prewarm, hides after its first draw
    return m;
  },
};
