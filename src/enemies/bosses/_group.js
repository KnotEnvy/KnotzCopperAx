// Group-boss helpers (private): encounters built from regular enemy types (Brute Brothers, Hollow Knight Captains,
// Wyrm Rider) get the same boss treatment as a Boss actor — one HUD boss bar over the whole group (a proxy with
// summed hp/maxHp), an intro camera + name card, a finale token that holds the stage until the defeat beat has played,
// and the defeat beat itself (hitstop, slow-mo, KO flash + CA pulse, drama zoom) on the last member's KO.
//   const g = groupBoss(game, { name, title, typeId, members: [actors], element, camera })
//   g.proxy (→ EV.BOSS_INTRO { boss: proxy }) · g.token · g.intro({ focus, ticks, onBeat(t) }) → Promise · g.dispose()
import { EV } from '../../core/EventBus.js';
import { reportError } from '../../core/log.js';
import { bossCam, cardClear } from './_camera.js';
import { arenaSpacing } from './_spacing.js';

let groupSeq = 0;
export function groupBoss(game, { name, title, typeId, members = [], element = 'earth', camera = null }) {
  const list = [...members];
  let phaseNum = 1;
  const token = { alive: true, removed: false };
  const proxy = {
    kind: 'boss', typeId, name, title, def: { name, title, id: typeId }, members: list, token,
    get hp() { return list.reduce((s, a) => s + Math.max(0, a.alive ? a.hp : 0), 0); },
    get maxHp() { return list.reduce((s, a) => s + (a.maxHp || 0), 0); },
    get removed() { return list.every((a) => a.removed || !a.alive) && !token.alive; },
    get alive() { return list.some((a) => a.alive && !a.removed); },
    get pos() { const a = list.find((m) => m.alive) || list[0]; return a ? a.pos : { x: 0, y: 0, z: 0 }; },
    get poise() { const a = list.find((m) => m.alive && !m.removed); return a ? a.poise || null : null; },   // bosses r7: the HUD poise sliver follows the lead member
    get fsm() { const a = list.find((m) => m && m.alive && !m.removed) || list[0]; return a && a.fsm ? a.fsm : null; },
    get state() { const f = this.fsm; return f ? f.name : null; },
    get phase() {
      const live = list.filter((m) => m && m.alive && !m.removed);
      if (phaseNum > 1 || (live.length > 0 && live.length < list.length) || live.some((m) => m.enraged || (m.brain && m.brain.enraged))) return 2;
      return 1;
    },
    announce() {
      ensureCam();
      if (proxy._announced) return;
      proxy._announced = true;
      game.bus.emit(EV.BOSS_INTRO, { boss: proxy });
    },
  };
  const hookMember = (m) => {
    if (!m || m._bossHooked) return;
    m._bossHooked = true;
    // boss members read through the boss card + HUD bar, never an elite rank nameplate ("GEN. OXIDE" over Sskara)
    if (m.nameTag) { m.nameTag.visible = false; m.nameTag.scale.set(0, 0, 0); }
    if (typeof m.attackWith === 'function') {
      const orig = m.attackWith.bind(m);
      m.attackWith = (id, t) => {
        const ok = orig(id, t);
        if (ok && game && game.bus) game.bus.emit('boss:move', { boss: proxy, actor: m, moveId: m.mountedOn ? 'wyrm_' + id : id });
        return ok;
      };
    }
  };
  for (const m of list) hookMember(m);
  const ensureCam = () => {
    const rig = game && game.cameraRig;
    if (!rig || rig.manual || game._bossCam || (game.params && game.params.get && game.params.get('bosscam') === '0')) return;
    const arena = rig.lock ? [rig.lock.xMin, rig.lock.xMax] : null;
    try { bossCam(game, { ...(camera || {}), lead: proxy, members: () => list, arena }); } catch (e) { reportError('boss.camera', e); }
  };
  const scope = game.bus.scope();
  let done = false;
  // r10: the arena spacing pass (Boss.update runs it for single bosses) — members off lying heroes, lying heroes out
  // from under members / the wyrm. During the intro only the downed-hero pair rule runs; off once the defeat beat starts.
  let introRunning = false;
  const spaceName = 'boss.groupSpacing.' + typeId + '.' + (++groupSeq);
  const stopSpacing = () => { if (game.removeSystem) try { game.removeSystem(spaceName); } catch (e) { /* already gone */ } };
  if (game.addSystem) game.addSystem({ name: spaceName, order: 19, update() {
    if (done || (list.length && list.every((a) => !a || a.removed))) { stopSpacing(); return; }
    if (introRunning) { try { arenaSpacing(game, [], []); } catch (e) { /* reported below on the next live tick */ } return; }   // intro: only the downed-hero pair rule
    const B = list.filter((a) => a && a.alive && !a.removed && !(a.fsm && a.fsm.is('enter', 'bossWait', 'bossIntro', 'phaseShift')));
    try {
      const moved = arenaSpacing(game, B, []); if (moved) { const S = proxy._spacing || (proxy._spacing = { pushes: 0, m: 0 }); S.pushes++; S.m += moved; } } catch (e) { reportError('boss.groupSpacing', e); stopSpacing(); }
  } });
  const add = (a) => { if (a && !list.includes(a)) { hookMember(a); list.push(a); } };
  scope.on(EV.KO, ({ actor, by }) => {
    if (done || !list.includes(actor)) return;
    if (list.some((a) => a !== actor && a.alive && !a.removed)) {
      game.bus.emit('boss:memberDown', { boss: proxy, actor });
      if (phaseNum < 2) { phaseNum = 2; game.bus.emit(EV.BOSS_PHASE, { boss: proxy, phase: 2 }); }
      return;
    }
    done = true;
    defeatBeat(game, actor, by, element).then(() => { token.alive = false; game.bus.emit('boss:finaleDone', { boss: proxy }); scope.dispose(); });
  });
  return {
    proxy, token, members: list, add, ensureCam,
    async intro({ focus, ticks = 150, distance = 11, height = 3.2, lookHeight = 1.4, announceAt = 60, onBeat, frameAll = true } = {}) {
      ensureCam();
      let cam = null;
      introRunning = true;
      introLock(game, 1);
      try {
        // C2 r12 (board r11: heroes half-cut at the frame edge through the intros): frameAll — the drama's focus and
        // distance follow the members AND the heroes each tick (everyone inside ~88 % of the width, centre biased to the
        // members, pull-out capped at 1.45× the authored distance), damped — no cut. &bossreveal=0 = the fixed shot.
        const free = frameAll && !(typeof location !== 'undefined' && /[?&]bossreveal=0/.test(location.search));
        const f0 = focus.pos || focus, F = free ? { x: f0.x, y: 0, z: f0.z || 0 } : focus;
        const o = { focus: F, distance, height, fov: 30, lookHeight, in: 0.5, hold: null, priority: 4 };
        if (game.cameraRig && game.cameraRig.drama) cam = game.cameraRig.drama(o);
        const track = () => {
          if (!free) return;
          const fp = focus.pos || focus, tf = Math.tan(15 * Math.PI / 180), asp = (game.camera && game.camera.aspect) || 16 / 9;
          const hs = game.world.query({ kind: 'hero' }).filter((h) => h && !h.removed && h.alive !== false);
          const ms = list.filter((m) => m && m.alive && !m.removed);
          let x0 = fp.x - 1.4, x1 = fp.x + 1.4;
          for (const m of ms) { x0 = Math.min(x0, m.pos.x - 1.4); x1 = Math.max(x1, m.pos.x + 1.4); }
          for (const h of hs) { x0 = Math.min(x0, h.pos.x - 0.8); x1 = Math.max(x1, h.pos.x + 0.8); }
          const cx = (x0 + x1) / 2 + (fp.x - (x0 + x1) / 2) * 0.3, hw = Math.max(cx - x0, x1 - cx) / 0.88;
          const dd = Math.max(distance, Math.min(distance * 1.45, hw / (tf * asp)));
          const kk = 1 - Math.exp(-2.4 / 60);
          // C2 r13: the encounter's frame limits (stage 3: the eagle's head stays out of the boss shot)
          const vmx = camera && Number.isFinite(camera.viewMaxX) && !/[?&]bossframe=0/.test(location.search) ? camera.viewMaxX : null;
          const cxv = vmx === null ? cx : Math.min(cx, vmx - o.distance * tf * asp);
          F.x += (cxv - F.x) * kk; F.z += ((fp.z || 0) - F.z) * kk; o.distance += (dd - o.distance) * kk;
          // C2 r13: lift the members' feet clear of the lower-third card band (vertical camera shift, same pitch)
          const drop = cardClear(game, ms, cc, { distance: o.distance, fov: o.fov });
          o.height = height - drop; o.lookHeight = lookHeight - drop;
        };
        const cc = {};
        for (const a of list) a.invuln = Math.max(a.invuln || 0, ticks + 20);
        for (let t = 0; t < ticks; t++) {
          if (t === announceAt) proxy.announce();
          if (onBeat) try { onBeat(t); } catch (e) { reportError('groupBoss.intro', e); }
          try { track(); } catch (e) { reportError('groupBoss.introCam', e); }
          await game.wait(1);
        }
      } finally {
        introRunning = false;
        introLock(game, -1);
        if (cam) cam.release();
        if (game && game.ui && game.ui.dismissBossCard) game.ui.dismissBossCard(0.45);
      }
      if (!proxy._announced) proxy.announce();
    },
    dispose() { scope.dispose(); stopSpacing(); },
  };
}

/** C2 r12: while a boss intro plays, magic is locked (MagicSystem.lock(); counted releases) — the boss is invulnerable
 *  then, so a cast only wasted pots, and a bot's spell blanketed the stage-1 reveal (board r11; ai/heroBot.js reads
 *  magic.locked). `&introlock=0` disables. */
export function introLock(game, d) {
  const M = game && game.magic;
  if (!M || typeof M.lock !== 'function' || (typeof location !== 'undefined' && /[?&]introlock=0/.test(location.search))) return;
  const st = M._bossIntroRel || (M._bossIntroRel = []);
  if (d > 0) st.push(M.lock());
  else { const r = st.pop(); if (r) r(); }
}

/** The shared boss defeat beat for a KO'd actor (also used by group bosses). Resolves after ~2.5 s. */
export async function defeatBeat(game, actor, by, element = 'earth') {
  let cam = null;
  try {
    game.bus.emit('boss:defeat', { boss: actor, by });
    game.hitstop(16);
    game.slowmo(0.22, 1.4, { inTime: 0.05, out: 0.7 });
    const post = game.renderer && game.renderer.post;
    if (post && post.pulse) {   // r10: was ca 0.8 / flash 1.0 (cream blank frame). Re-asserted next tick: the killing
      // hit's own ScreenFx KO pulse lands after this call in the same hit and would replace the defeat desat.
      const P = () => post.pulse({ flash: 0, ca: 0.01, desat: 0.55, duration: 0.9 });
      P(); if (game.after) game.after(1, P);
    }
    if (game.cameraRig && game.cameraRig.drama) cam = game.cameraRig.drama({ focus: actor, distance: 9.5, height: 2.8, fov: 30, lookHeight: 1.2, in: 0.2, hold: null, priority: 5 });
    if (game.cameraRig && game.cameraRig.shake) game.cameraRig.shake(0.8);
    if (game.vfx && game.vfx.spawn) game.vfx.spawn('fx_shockwave', { pos: { x: actor.pos.x, y: 0.02, z: actor.pos.z }, radius: 3.5, element, dust: true, debris: 12 });
    for (const h of game.world.query({ kind: 'hero' })) h.invuln = Math.max(h.invuln || 0, 200);
    for (const e of game.world.query({ team: 'enemies' })) {
      if (e === actor || !e.alive || e.removed || !game.combat) continue;
      game.combat.applyHit(actor, e, { damage: 999, knockdown: true, launch: 5, knockback: 3, level: 'magic', hitstop: 0 }, { moveId: 'boss_fall', dir: Math.sign(e.pos.x - actor.pos.x) || 1 });
    }
    await game.wait(150);
  } catch (e) { reportError('boss.defeatBeat', e); }
  if (cam) cam.release();
}
