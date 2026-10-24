// __KCA.debug.* helpers (docs/ARCHITECTURE.md §6). Installed by main.js once services exist.
import { registries } from '../core/registries.js';
import { safeImport } from '../core/safeImport.js';

export function installDebugHooks(game) {
  const api = window.__KCA;
  const resolve = (target) => {
    const w = game.world;
    if (target === 'enemies') return w.query({ team: 'enemies' });
    if (target === 'p1' || target === 1) return w.query({ kind: 'hero', alive: false }).filter((h) => h.playerIndex === 0);
    if (target === 'p2' || target === 2) return w.query({ kind: 'hero', alive: false }).filter((h) => h.playerIndex === 1);
    if (typeof target === 'number') { const a = w.byId.get(target); return a ? [a] : []; }
    if (target && target.id) return [target];
    return [];
  };
  const summary = (a) => (a ? { id: a.id, kind: a.kind, type: a.typeId, x: +a.pos.x.toFixed(2), z: +a.pos.z.toFixed(2), hp: a.hp, state: a.fsm && a.fsm.name } : null);
  api.register('debug', {
    /** spawn('marauder', x, z, { tier }) | spawn('pot', x, z) | spawn('cluckhorn', x, z) */
    async spawn(type, x = 4, z = 0, opts = {}) {
      if (registries.pickups.has(type)) return summary(await game.spawnPickup(type, x, z, opts));
      if (registries.mounts.has(type)) return summary(await game.mounts.spawn(type, { x, z, ...opts }));
      const E = await safeImport(() => import('../enemies/spawnEnemy.js'), 'enemies/spawnEnemy');
      if (!E) return null;
      const p = E.spawnEnemy(game, type, { x, z, facing: -1, ...opts });
      game.track(p);
      return summary(await p);
    },
    setHP(target, hp) { for (const a of resolve(target)) a.hp = Math.max(0, Math.min(a.maxHp, hp)); return resolve(target).map(summary); },
    kill(target = 'enemies') {
      for (const a of resolve(target)) {
        if (a.receiveHit && game.combat) game.combat.applyHit(null, a, { damage: 9999, knockdown: true, launch: 5, knockback: 3, hitstop: 4, level: 'heavy' });
        else a.remove();
      }
      return true;
    },
    god(on = true) { for (const h of game.world.query({ kind: 'hero', alive: false })) h.godMode = on; return on; },
    timeScale(s) { game.timeScale = s; return s; },
    hitstop(t) { game.hitstop(t); return t; },
    /** Give a player magic pots (clamped to the hero's pot capacity). */
    pots(player = 1, n = 9) { for (const h of resolve(player === 2 ? 'p2' : 'p1')) h.addPots(n); return resolve(player === 2 ? 'p2' : 'p1').map((h) => h.pots); },
    /** Cast a player's spell at a tier right now (tops up pots as needed). */
    cast(player = 1, tier = 1) { const h = resolve(player === 2 ? 'p2' : 'p1')[0]; if (!h) return false; h.castMagic(tier); return true; },
    actors() { return game.world.actors.map(summary); },
    heroes() { return game.world.query({ kind: 'hero', alive: false }).map(summary); },
    hitboxes(on = true) { game.params.debug = on; return on; },
    /**
     * Skin sanity check for a live humanoid (default: P1's hero). CPU-skins its SkinnedMesh in the CURRENT pose and
     * reports triangles whose edges stretched > 4× (and > 0.25 m) vs. rest, grouped by the bone weights of the two
     * vertices. Bad weights (e.g. kilt vertices weighted to hand_R) show up as big "sheets" when the arm moves.
     *   await __KCA.showcase.play('light_1'); await __KCA.advance(250); __KCA.debug.skinCheck()
     */
    skinCheck(target = 'p1') {
      const a = resolve(target)[0];
      if (!a || !a.modelRoot) return null;
      let mesh = null;
      a.modelRoot.traverse((o) => { if (o.isSkinnedMesh && !mesh) mesh = o; });
      if (!mesh || !mesh.geometry.index) return { error: 'no indexed SkinnedMesh' };
      a.modelRoot.updateMatrixWorld(true);
      mesh.skeleton.update();
      const pos = mesh.geometry.attributes.position, si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight, idx = mesh.geometry.index;
      const n = pos.count, R = new Float32Array(n * 3), S = new Float32Array(n * 3), v = a.pos.clone();
      for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, i); R[i * 3] = v.x; R[i * 3 + 1] = v.y; R[i * 3 + 2] = v.z; mesh.applyBoneTransform(i, v); S[i * 3] = v.x; S[i * 3 + 1] = v.y; S[i * 3 + 2] = v.z; }
      const d = (A, p, q) => Math.hypot(A[p * 3] - A[q * 3], A[p * 3 + 1] - A[q * 3 + 1], A[p * 3 + 2] - A[q * 3 + 2]);
      const bones = mesh.skeleton.bones;
      const top = (i) => { let k = 0, w = -1; const I = [si.getX(i), si.getY(i), si.getZ(i), si.getW(i)], W = [sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i)]; for (let j = 0; j < 4; j++) if (W[j] > w) { w = W[j]; k = I[j]; } return bones[k] ? bones[k].name : '?'; };
      const pairs = new Map();
      let bad = 0;
      for (let t = 0; t < idx.count; t += 3) {
        const tri = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
        for (const [p, q] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]]) {
          const s0 = d(S, p, q);
          if (s0 > 0.25 && s0 > d(R, p, q) * 4) { bad++; const key = [top(p), top(q)].sort().join(' <-> '); pairs.set(key, (pairs.get(key) || 0) + 1); break; }
        }
      }
      return { mesh: mesh.name, triangles: idx.count / 3, stretched: bad, bonePairs: [...pairs].sort((x, y) => y[1] - x[1]).slice(0, 12) };
    },
    events(type) { return api.events(type); },
  });
}
