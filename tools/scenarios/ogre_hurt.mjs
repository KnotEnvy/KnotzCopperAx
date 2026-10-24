// Ogre hurtbox-vs-model probe (Combat/AI team, Wave C2 r1). Use with /?mode=stage&stage=1&p1=brann (lineup: spawns
// each OGRE_LIST entry alone) or with &screen=2&bot=1 and OGRE_MODE=boss (measures the live Brute Brothers instead).
// Per body it logs: the standing hurtbox top, the measured skinned-mesh top (all meshes / without the weapon) and the
// head-bone height, all relative to the actor's feet. Then a head-height JUMP ATTACK: the hero is dropped from
// OGRE_DROP m (default 3.6) just in front of the frozen foe and presses light → jump_attack; it logs the hero height
// and the hitbox bottom at the first registered hit (a head hit = hitbox bottom above the old 2.61 m hurtbox top).
// Writes ogre_hurt.json + one still per body (hurt_<type>_<tier>.png) with the debug hurtbox overlay on.
import fs from 'node:fs';
import path from 'node:path';

const measure = (id) => {
  const K = window.__KCA, g = K.game, e = g.world.actors.find((a) => a.id === id);
  if (!e) return null;
  const root = e.modelRoot || e.body;
  e.view.updateMatrixWorld(true);
  const v = e.pos.clone(), base = e.view.position.y;
  let top = -1e9, topNoW = -1e9, headY = null;
  root.traverse((o) => {
    if (o.isBone && /^head$/i.test(o.name)) { o.getWorldPosition(v); headY = v.y - base; }
  });
  root.traverse((o) => {
    if (!o.isMesh || !o.visible || !o.geometry || !o.geometry.attributes.position) return;
    let w = false; for (let p = o; p && p !== root; p = p.parent) if (/weapon|socket/i.test(p.name)) { w = true; break; }
    const P = o.geometry.attributes.position;
    for (let i = 0; i < P.count; i++) {
      o.getVertexPosition(i, v); v.applyMatrix4(o.matrixWorld);
      const y = v.y - base; if (y > top) top = y; if (!w && y > topNoW) topNoW = y;
    }
  });
  const hb = e.hurtboxes()[0];
  const r = (x) => (x === null ? null : Math.round(x * 1000) / 1000);
  return { id: e.id, type: e.typeId, tier: e.tier, height: e.height, hurtH: r(e.hurt.h), hurtTop: r(hb.maxY - e.pos.y), meshTop: r(top), meshTopNoWeapon: r(topNoW), headBone: r(headY), state: e.fsm.name };
};

export default async (api) => {
  const mode = process.env.OGRE_MODE || 'lineup';
  const list = (process.env.OGRE_LIST || 'ogre:green,ogre:red,ogre:silver,boss_brute:gor,boss_brute:mog').split(',');
  const drop = Number(process.env.OGRE_DROP || 3.6);
  const out = { mode, bodies: [] };
  await api.evalGame(() => { const K = window.__KCA; K.debug.god(true); K.debug.hitboxes(true); });
  await api.advance(mode === 'boss' ? 1000 : 3600);

  const jumpTest = async (id) => api.evalGame(async ([id, drop]) => {
    const K = window.__KCA, g = K.game, e = g.world.actors.find((a) => a.id === id), h = g.world.query({ kind: 'hero' })[0];
    if (!e || !h) return null;
    e.brain = null; e.godMode = true; e.vel.set(0, 0, 0);
    if (e.attack) e.endMove();
    if (e.fsm.name !== 'idle') e.fsm.go('idle');
    e.facing = -1;
    let rec = null;
    const off = g.bus.on('hit', (ev) => {
      if (rec || ev.target !== e || ev.attacker !== h) return;
      rec = { heroY: Math.round(h.pos.y * 1000) / 1000, hitboxBottom: Math.round((h.pos.y - 0.35) * 1000) / 1000, pointY: ev.point ? Math.round((ev.point.y - (e.pos.y || 0)) * 1000) / 1000 : null, moveId: ev.moveId, tick: g.tick };
    });
    h.pos.set(e.pos.x - 0.95, drop, e.pos.z); h.prevPos.copy(h.pos); h.vel.set(0, 0, 0); h.grounded = false; h.facing = 1;
    if (h.attack) h.endMove();
    h.fsm.go('fall');
    K.input.press(1, 'light', 60);
    let shotAt = null;
    for (let t = 0; t < 80 && !rec; t++) { await K.advance(1000 / 60); if (!h.grounded && h.attack && shotAt === null) shotAt = t; }
    off();
    const res = { ...(rec || { miss: true }), hurtTop: Math.round((e.hurtboxes()[0].maxY - e.pos.y) * 1000) / 1000, heroLanded: h.grounded };
    return res;
  }, [id, drop]);

  if (mode === 'boss') {
    let ids = [];
    for (let i = 0; i < 120 && ids.length < 2; i++) {
      await api.advance(1000);
      ids = await api.evalGame(() => {
        const K = window.__KCA, g = K.game, foes = g.world.query({ team: 'enemies' });
        const bros = foes.filter((e) => e.typeId === 'boss_brute' && e.alive);
        if (!bros.length) for (const e of foes) if (e.alive && e.typeId !== 'boss_brute') K.debug.kill(e.id);
        return bros.filter((e) => !e.fsm.is('enter')).map((e) => e.id);
      });
    }
    api.log('BROTHERS ' + JSON.stringify(ids));
    await api.advance(1500);
    for (const id of ids) {
      const m = await api.evalGame(measure, id);
      api.log('MEASURE ' + JSON.stringify(m));
      out.bodies.push(m);
    }
    await api.shot('brothers');
    if (ids[0]) { const j = await jumpTest(ids[0]); api.log('JUMP ' + JSON.stringify(j)); out.bodies[0].jump = j; }
    await api.shot('brothers_after_jump');
  } else {
    const hx = await api.evalGame(() => { const h = window.__KCA.game.world.query({ kind: 'hero' })[0]; return h ? h.pos.x : 0; });
    for (const ent of list) {
      const [type, tier] = ent.split(':');
      await api.evalGame(() => { const K = window.__KCA; for (const e of K.game.world.query({ team: 'enemies' })) if (e.alive) { e.godMode = false; K.debug.kill(e.id); } });
      await api.advance(1500);
      const s = await api.evalGame(([t, x, tier]) => window.__KCA.debug.spawn(t, x, 0, tier ? { tier } : {}), [type, hx + 3.2, tier]);
      if (!s || s.id === undefined) { api.log('SPAWN FAIL ' + ent); continue; }
      await api.evalGame((id) => { const e = window.__KCA.game.world.actors.find((a) => a.id === id); if (e) { e.brain = null; e.godMode = true; } }, s.id);
      await api.advance(900);
      const m = await api.evalGame(measure, s.id);
      api.log('MEASURE ' + JSON.stringify(m));
      await api.shot(`hurt_${type}_${tier}`);
      m.jump = await jumpTest(s.id);
      api.log('JUMP ' + JSON.stringify(m.jump));
      out.bodies.push(m);
      await api.advance(600);
    }
  }
  const info = await api.evalGame(() => window.__KCA.info());
  out.errors = info.errors;
  api.log('ERRORS ' + JSON.stringify(info.errors));
  fs.writeFileSync(path.join(api.outDir, 'ogre_hurt.json'), JSON.stringify(out, null, 2));
};
