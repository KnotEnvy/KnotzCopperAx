// Bizarrian rules regression (no frames): run on the riding sandbox with any beast, e.g.
//   node tools/capture.mjs --url "/?mode=showcase&what=mount&id=emberdrake&scene=ride" --scenario tools/scenarios/mounts_rules.mjs --out ...
// Checks: seat-by-script, beast attack hits (Light), fireball gate (cinderwyrm), Dodge+Jump dismount, no back attack
// while seated, magic hops off, knights refuse to ride, riderless beast leaves, beasts cleared on stageClear.
import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  const S = (fn, a) => api.evalGame(fn, a);
  const R = {};
  await api.advance(700);
  // take the beast: remove its rider, park it next to the hero, seat the hero
  await S(() => { const sc = window.__KCA.showcase, h = sc.hero, b = sc.beast(); const e = b.rider; if (e) { b.dismount({ knocked: true, silent: true }); e.remove(); } b.pos.x = h.pos.x + 0.6; b.pos.z = h.pos.z; b.mount(h, { force: true }); h.facing = 1; });
  await api.advance(100);
  R.seated = await S(() => !!window.__KCA.showcase.hero._seated);
  await S(() => { const sc = window.__KCA.showcase; return Promise.all([sc.spawnFoe('marauder', 2.0, 0.0, 'straw'), sc.spawnFoe('marauder', 3.0, 0.3, 'straw')]); });
  await api.advance(60);
  const t0 = await S(() => window.__KCA.game.tick);
  await api.press(1, 'light', 50);
  await api.advance(1100);
  R.beastHits = await S((t) => window.__KCA.events('hit', t).filter((e) => String(e.summary.moveId || '').startsWith('beast_')).map((e) => e.summary.moveId + '>' + e.summary.target), t0);
  R.stillSeatedAfterAttack = await S(() => !!window.__KCA.showcase.hero._seated);
  // fireball gate: a second press while a fireball flies must bite instead (cinderwyrm only)
  R.fireballGate = await S(() => { const b = window.__KCA.showcase.beast(); if (!b.def.gate) return 'n/a'; const h = window.__KCA.showcase.hero; b.fireball = { removed: false }; const r = h.startMove('light_1'); const id = h.moveId; h.endMove(); h.fsm.go('idle'); b.fireball = null; return id; });
  // back attack refused while seated
  R.backAttackWhileSeated = await S(() => { const h = window.__KCA.showcase.hero; h.endMove(); h.fsm.go('idle'); h.startMove('back_attack'); const id = h.moveId; h.endMove(); h.fsm.go('idle'); return id; });
  // Dodge+Jump dismount
  await S(() => { const h = window.__KCA.showcase.hero; h.endMove(); h.fsm.go('idle'); });
  await api.hold(1, 'jump', true); await api.press(1, 'dodge', 50); await api.advance(80); await api.hold(1, 'jump', false);
  await api.advance(600);
  R.dismountedByDodgeJump = await S(() => !window.__KCA.showcase.hero._seated);
  // re-mount by Jump next to it
  await S(() => { const sc = window.__KCA.showcase, h = sc.hero, b = sc.beast(); for (const e of window.__KCA.game.world.query({ team: 'enemies' })) e.remove(); b.noMount.clear(); b.pos.x = h.pos.x + 0.7; b.pos.z = h.pos.z; b.vel.set(0, 0, 0); });
  await api.advance(50);
  await api.press(1, 'jump', 50); await api.advance(500);
  R.remountedByJump = await S(() => !!window.__KCA.showcase.hero._seated);
  // magic while seated: hops off and casts
  await S(() => window.__KCA.debug.pots(1, 3));
  await api.press(1, 'magic', 50); await api.advance(300);
  R.magicState = await S(() => { const h = window.__KCA.showcase.hero; return { st: h.fsm.name, seated: !!h._seated }; });
  await api.advance(3500);
  // knights refuse to ride
  R.knightRider = await S(async () => { const m = await window.__KCA.game.mounts.spawn('cluckhorn', { x: window.__KCA.showcase.hero.pos.x + 5, z: 0, rider: 'knight', wave: false }); const r = { rider: m && m.rider ? m.rider.typeId : null }; if (m) m.remove(); return r; });
  // riderless beast leaves after its timer
  await S(() => { const b = window.__KCA.showcase.beast(); if (b.rider) b.dismount({ knocked: false, silent: true }); b.leaveTimer = 20; });
  await api.advance(3000);
  R.beastLeft = await S(() => { const b = window.__KCA.showcase.beast(); return { mode: b.mode, removed: b.removed }; });
  // stage clear removes every beast
  await S(async () => { await window.__KCA.game.mounts.spawn('emberdrake', { x: window.__KCA.showcase.hero.pos.x + 3, z: 0 }); });
  await api.advance(100);
  R.beastsBeforeClear = await S(() => window.__KCA.game.mounts.list().length);
  await S(() => window.__KCA.game.bus.emit('stageClear', {}));
  await api.advance(100);
  R.beastsAfterClear = await S(() => window.__KCA.game.mounts.list().length);
  const info = await S(() => window.__KCA.info());
  R.errors = info.errors;
  fs.writeFileSync(path.join(api.outDir, 'rules.json'), JSON.stringify(R, null, 2));
  api.log(JSON.stringify(R));
};
