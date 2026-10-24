// Shared baseline choreography for the placeholder spell books (the magic specialist replaces these with
// bespoke per-tier cinematics). Files starting with '_' are not registered as spells.
export async function baselineCast(ctx, hero, tier, { element, maxTier, pattern = 'targets', color }) {
  const big = tier >= Math.max(2, maxTier - 1);
  const drama = ctx.drama({ distance: 19 + tier * 1.2, height: 6.5 + tier * 0.3, fov: 34, lookHeight: 1.4, focus: hero, in: 0.28, hold: null, out: 0.5 });
  ctx.darken(0.3 + tier * 0.06, 0.6 + tier * 0.35);
  ctx.game.vfx.spawn('magic_burst', { pos: hero.pos, element, power: 1 });
  ctx.slowmo(0.55, 0.25);
  await ctx.wait(18);
  const foes = ctx.enemies();
  const waves = Math.min(tier, 4);
  for (let w = 0; w < waves; w++) {
    if (pattern === 'row') {
      for (let i = 0; i < 4 + tier; i++) ctx.game.vfx.spawn('magic_burst', { pos: { x: hero.pos.x + hero.facing * (1.5 + i * 1.6), y: 0, z: hero.pos.z + ctx.rng.range(-1, 1) }, element, power: tier });
    } else {
      for (const e of foes) ctx.game.vfx.spawn('magic_burst', { pos: e.pos, element, power: tier });
    }
    ctx.shake(0.25 + tier * 0.08);
    await ctx.wait(10 + tier * 2);
  }
  if (big) { ctx.flash({ color, strength: tier === 4 ? 0.6 : Math.min(0.45, 0.35 + tier * 0.05), duration: 0.35 }); ctx.shake(0.6); }
  // Damage = ctx.damage, the canon tier total (DESIGN §2: 4/8/16/24/32/40), applied once per enemy.
  ctx.hitAll({ damage: ctx.damage, knockdown: true, launch: 5 + tier * 0.6, knockback: 3.5, hitstop: 8 + tier, hitstun: 30, spark: 'hit_spark', level: 'magic' });
  await ctx.wait(30);
  drama.release();
}
