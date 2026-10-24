// Animation coverage audit (owner: anim-movesets). Proves no hero move / state / reaction ends on a FALLBACK clip or
// on the generic humanoid_base clip when the hero has its own set, and that every clip bakes without error.
//   node tools/capture.mjs --url "/?mode=stage&stage=test&p1=gorrim&placeholder=1" --scenario tools/scenarios/anim_audit.mjs --out <dir>
// Uses Animator's opt-in trace (globalThis.__KCA_animTrace). Writes anim_audit.json next to the frames.
//  1. every move in the hero's moveset through the real Combatant.startMove path (clip preference, animFallback)
//  2. every hero FSM clip with the exact fallback list the FSM passes (idle walk run jump_up jump_fall land
//     dodge_roll sidestep grab knee throw magic_cast death + taunt victory land_heavy throw_back ride_*)
//  3. shared reactions on the hero AND on a spawned marauder (hit_high hit_low knockdown down_loop getup launched
//     thrown tumble grabbed spiked death blocked) + the clubber moves through startMove
//  4. bake check: every clip name the library exposes for the character is baked (errors → __KCA.info().errors)
import fs from 'node:fs';
import path from 'node:path';

const HERO_CLIPS = ['idle', 'walk', 'run', 'jump_up', 'jump_fall', 'land', 'land_heavy', 'dodge_roll', 'sidestep', 'grab', 'knee',
  'throw', 'throw_back', 'magic_cast', 'taunt', 'victory', 'heavy_charge', 'ride_idle', 'ride_attack', 'mount', 'dismount'];
const REACTIONS = ['hit_high', 'hit_low', 'knockdown', 'down_loop', 'getup', 'launched', 'thrown', 'tumble', 'grabbed', 'spiked', 'death', 'blocked'];
const ENEMY_CLIPS = ['idle', 'walk', 'run', 'swing', 'smash', 'jab', 'taunt'];

export default async (api) => {
  const E = (fn, arg) => api.evalGame(fn, arg);
  const T = (n) => api.advance((1000 / 60) * n);
  await E(() => { const k = window.__KCA; k.debug.god(true); if (k.game.levels) k.game.levels.scriptEnabled = false; for (const a of k.game.world.query({ team: 'enemies' })) a.remove(); globalThis.__KCA_animTrace = []; });
  const hero = await E(() => { const h = window.__KCA.game.world.query({ kind: 'hero' })[0]; return { id: h.id, character: h.animator && h.animator.character, moves: Object.keys(h.moves || {}) }; });
  api.log('hero ' + JSON.stringify(hero));
  const R = { hero, moves: [], clips: [], reactions: [], enemy: [], bake: null, failures: [] };

  // 1. moves through startMove (ground moves grounded, air moves from 2.5 m up)
  for (const id of hero.moves) {
    const row = await E((id) => {
      const k = window.__KCA, h = k.game.world.query({ kind: 'hero' })[0], tr = globalThis.__KCA_animTrace;
      h.endMove && h.endMove(); h.fsm.go('idle'); h.vel.set(0, 0, 0);
      const air = !!h.moves[id].air;
      h.pos.set(0, air ? 2.5 : 0, 0); h.prevPos.copy(h.pos); h.facing = 1;
      if (air) { h.grounded = false; h.onGround = false; }
      const n0 = tr.length;
      h.startMove(id);
      const e = tr.slice(n0).find((r) => r.actor === h.id) || null;
      return { id, requested: e && e.requested, played: e && e.played, set: e && e.set, fallback: e ? e.fallback : true };
    }, id);
    await T(2);
    R.moves.push(row);
  }
  await E(() => { const h = window.__KCA.game.world.query({ kind: 'hero' })[0]; h.endMove && h.endMove(); h.pos.set(0, 0, 0); h.fsm.go('idle'); });
  await T(10);

  // 2 + 3a. hero FSM clips + reactions via play() with the FSM's fallback lists
  const playOn = (actorId, names, fb) => E(([actorId, names, fb]) => {
    const k = window.__KCA, a = k.game.world.byId.get(actorId), tr = globalThis.__KCA_animTrace, out = [];
    for (const n of names) {
      const n0 = tr.length;
      const ok = a.animator.play(n, { restart: true, fade: 0, fallback: fb[n] });
      const e = tr.slice(n0).find((r) => r.actor === a.id) || null;
      out.push({ id: n, ok, played: e && e.played, set: e && e.set, fallback: e ? e.fallback : true });
    }
    return out;
  }, [actorId, names, fb]);
  const FB = { sidestep: ['dodge_roll'], grab: ['pommel', 'light_1', 'idle'], knee: ['pommel', 'light_1'], throw: ['heavy'], magic_cast: ['idle'], death: ['down_loop'] };
  R.clips = await playOn(hero.id, HERO_CLIPS, FB);
  R.reactions = await playOn(hero.id, REACTIONS, {});

  // 3b. marauder: clubber moves through startMove + shared reactions
  const mid = await E(async () => { const k = window.__KCA; const s = await k.debug.spawn('marauder', 3, 0, { hp: 999 }); const e = k.game.world.byId.get(s.id); e.brain = null; return e.id; });
  await T(30);
  const em = await E((mid) => {
    const e = window.__KCA.game.world.byId.get(mid), tr = globalThis.__KCA_animTrace, out = [];
    for (const id of Object.keys(e.moves || {})) {
      const n0 = tr.length; e.startMove(id);
      const r = tr.slice(n0).find((x) => x.actor === e.id) || null;
      out.push({ id: 'move:' + id, played: r && r.played, set: r && r.set, fallback: r ? r.fallback : true });
      e.endMove && e.endMove(); e.fsm.go('idle');
    }
    return { character: e.animator && e.animator.character, out };
  }, mid);
  R.enemy = em.out.concat(await playOn(mid, ENEMY_CLIPS.concat(REACTIONS), {}));

  // 4. bake every clip name the library exposes for both characters
  R.bake = await E(([hid, mid]) => {
    const k = window.__KCA, res = {};
    for (const id of [hid, mid]) {
      const a = k.game.world.byId.get(id), an = a.animator, names = [...an.library.names({ rig: an.rig, character: an.character })], bad = [];
      for (const n of names) { try { if (!an._action(n)) bad.push(n); } catch (e) { bad.push(n + ':' + e.message); } }
      res[an.character] = { total: names.length, bad };
    }
    const errs = (k.info().errors || []).filter((e) => /clip|anim/.test(JSON.stringify(e)));
    return { res, errors: errs.slice(0, 20) };
  }, [hero.id, mid]);

  // verdicts
  const heroSet = (s) => s && s.startsWith('hero_');
  for (const m of R.moves) if (m.fallback || !heroSet(m.set)) R.failures.push(['move', m]);
  for (const c of R.clips) if (c.fallback || !c.ok || !heroSet(c.set)) R.failures.push(['clip', c]);
  for (const c of R.reactions) if (c.fallback || !c.ok) R.failures.push(['reaction', c]);
  for (const c of R.enemy) if (c.fallback || c.ok === false || (ENEMY_CLIPS.includes(String(c.id).replace('move:', '')) && c.set !== 'enemy_clubber') || (String(c.id).startsWith('move:') && c.set !== 'enemy_clubber')) R.failures.push(['enemy', c]);
  for (const [ch, b] of Object.entries(R.bake.res)) if (b.bad.length) R.failures.push(['bake', ch, b.bad]);
  api.log(`moves ${R.moves.length} clips ${R.clips.length} reactions ${R.reactions.length} enemy ${R.enemy.length} bake ${JSON.stringify(Object.fromEntries(Object.entries(R.bake.res).map(([k, v]) => [k, v.total])))}`);
  api.log((R.failures.length ? 'FAIL ' : 'PASS ') + 'anim audit: ' + JSON.stringify(R.failures).slice(0, 1500));
  api.log('played: ' + R.moves.map((m) => `${m.id}->${m.played}@${m.set}`).join(' '));
  fs.writeFileSync(path.join(api.outDir, 'anim_audit.json'), JSON.stringify(R, null, 1));
  await api.shot && api.shot('end');
};
