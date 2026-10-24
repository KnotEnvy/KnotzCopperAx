// Dummy brain: stand still facing the nearest hero; refill HP when idle so moveset showcases never run dry.
export default {
  id: 'dummy',
  create(e, game, p = {}) {
    let idle = 0;
    e.removeOnDeath = false;
    return {
      update() {
        const h = game.world.nearest(e, { kind: 'hero' });
        if (h) e.faceToward(h);
        e.stopMoving();
        if (++idle > 90 && p.refill !== false) { e.hp = e.maxHp; idle = 0; }
      },
    };
  },
};
