// AI crowd audit in REAL STAGE MODE (enemies-ai C2 r1). Runs a stage with bot heroes and measures what the player sees,
// from the camera projection and fsm states only — it reads NO director / brain field, so AI tuning can't game it.
//   node tools/capture.mjs --url "/?mode=stage&stage=1&p1=brann&bot=1" --size 800x450 --scenario tools/scenarios/ai_stage.mjs --out <dir>
//   2P: add &p2=seraphine (bot=1 drives both heroes). Stage 2: stage=2&p1=gorrim…
// Env: AI_SECONDS (game seconds, default 120), AI_FLAGS='{json}' (director A/B hooks), AI_GOD (default 1: heroes can't die).
// Body model: every grounded body is a screen rect, centre = projected chest point, top = head (pos.y + height), bottom = feet.
// Gaps are expressed in metres at that body's depth (screen px / px-per-metre), so they mean the same at every zoom / size.
// "Standing" = on its feet: not knockdown / down / getup / thrown / grabbed / clinch / dead / bones / rise / enter-off-screen,
// feet below 0.3 m. Hitstun, block, attack, pause, walk and idle all count (a reeling foe is still a silhouette).
// Two bodies OVERLAP when their vertical extents overlap by >= 50 % of the shorter one AND their centres are < GAP apart.
// Writes ai_stage.json:
//   frames / framesEE        sampled ticks / ticks with >= 2 standing foes on screen
//   ee08 / ee05 (+Still)     % of framesEE with an enemy–enemy pair < 0.8 / 0.5 m apart (Still: both bodies' speed < 0.3 m/s;
//                            Row: the pair is also < 1.3 m apart in depth = feet within ~55 px, the board's depth-probe 'fused')
//   eeMin / eeP05            smallest / 5th-percentile per-frame closest e–e gap (m)
//   eh06 / eh045             % of frames (with a standing foe within 3 m of a standing hero) where a foe is < 0.6 / 0.45 m from
//                            a hero's centre (clinch / grabs / throws excluded); ehAtk06 = …and that foe is attacking that hero;
//                            ehRow06 = …and the foe is on the hero's own row (< 1.2 m in depth: standing ON him, not passing behind)
//   atk                      every enemy attack start on a hero: n, gap (m) p10/median/min, dz, inFrame (body fully inside), outerPinned
//                            (hero within 15 % of the frame width from an edge and the attacker on that outer side), outerClipped
//                            (…with the attacker's centre < 1.0 m inside the frame: its body touches the edge)
//   offAtkFrames             attack-state ticks with the attacker's body centre < 0.4 m inside the frame edge (half cut off) / total
//   idle                     per foe: first visible → first attack (latFirst), longest visible stretch without an attack start (strict),
//                            longest visible stretch without any action (attack, or a pause showing a non-idle clip / sliding:
//                            feint, taunt, menace step) (act). Idle time accrues only while the foe is in control (idle / walk). max + worst 6.
//   heroHitsPerMin / heroDmgPerMin  enemy hits landed on heroes per minute (all heroes summed) — the pressure check
//   flank                    per hero, every 10 ticks: on-screen standing waiters within 9 m (not attacking): samples with >= 3,
//                            % of those all on one side, mean minority share
//   pairCats                 state categories of the e–e < 0.8 m pairs (A attack, R hitstun/block, W walk, I idle, P pause)
// C2 r2 (iter 12) additions — board r11: "the probe scores ATTACKERS only":
//   anyFoeClipped            % of fight frames (>= 1 live foe out of its walk-in) with ANY live foe (any state but 'enter':
//                            walking, reeling, knocked down, lying, attacking …) whose body centre is within EDGE_PX (90 px at
//                            1600 wide = 5.625 % of the frame width) of a frame edge or beyond. clipStates = which states,
//                            clipOuter = …of those, on the outer side of a hero within 15 % of that edge. anyFoeClippedEnter
//                            counts walk-ins too (they cross the edge band by design).
//   hh                       co-op hero–hero: % of frames with 2 standing heroes whose silhouettes overlap >= 50 % in height and
//                            whose centres are < 0.8 / 0.5 m apart on screen (hh08 / hh05; hhRow08 = also < 1.3 m in depth)
//   first                    time to first attack per foe: first fully-visible tick (centre >= 0.4 m inside, out of enter /
//                            rise) → its first attack start. p50 / p90 / max, over6 = foes over 6 s (incl. foes visible > 6 s
//                            that never attacked), list [type, id, firstSeen s, lat, ctl, hit]; ctl = visible seconds IN CONTROL
//                            (idle / walk) before the first attack, hit = …reeling / down / grabbed (being beaten up); ctlMax / ctlOver6
//   atkSides                 attack starts per hero from his left / right; minorShare = summed minority side / all (0.5 = even)
//   atk.outerByType          outer-side attacks (outerPinned) per enemy type + move (chain continuations included)
//   flank.bins / flank.shots C2 r3 diagnostics: hero frame bin (10 %) → [samples, one-sided]; up to 30 one-sided samples with
//                            the waiters' [type, id, state, brain mode, dx, dz, slot src, flanker] (AI fields: diagnostics only)
//   Env AI_TRACE_IDS=a,b     (C2 r3 diagnostics) per-foe rows every 6 ticks in `trace`: [s, id, state, mode, why, af, crossing, token,
//                            overdue, hero id, dx, dz, hero state, hero frame x, own inset m] — the run stays identical to a plain probe
//   Env AI_WAVE=k            start measuring at wave k of the start screen (earlier waves are killed off): stage 2 k=1 is the
//                            skeleton wave. AI_SCREEN is the URL's &screen=.
import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  const secs = Number(process.env.AI_SECONDS || 120);
  const E = (fn, arg) => api.evalGame(fn, arg);
  if (process.env.AI_FLAGS) await E((f) => Object.assign(window.__KCA.game.ai.director, f), JSON.parse(process.env.AI_FLAGS));
  const wave = Number(process.env.AI_WAVE || 0);
  if (wave > 0) { // kill the earlier waves of the start screen off, measure from wave k on
    if (process.env.AI_GOD !== '0') await E(() => { const k = window.__KCA; if (k.debug && k.debug.god) k.debug.god(true); });
    for (let i = 0; i < 60; i++) {
      await api.advance(500);
      const w = await E(() => { const g = window.__KCA.game, L = g.levels; return L ? L.waveIndex : -1; });
      if (w >= wave) break;
      if (i >= 3) await E(() => { const g = window.__KCA.game; for (const e of g.world.query({ team: 'enemies' })) if (e.alive && e.kind !== 'boss' && e.typeId !== 'thief' && !e.mountedOn && e.kind !== 'mount' && !(e.fsm && e.fsm.is('enter'))) window.__KCA.debug.kill(e.id); });
    }
    api.log('AI_WAVE reached ' + JSON.stringify(await E(() => window.__KCA.game.levels.info())));
  }
  await E(({ god, trIds }) => {
    const k = window.__KCA, g = k.game;
    if (god && k.debug && k.debug.god) k.debug.god(true);
    const S = (window.__AISTAGE = { frames: 0, framesEE: 0, ee08: 0, ee05: 0, ee08s: 0, ee05s: 0, eeMins: [], framesEH: 0, eh06: 0, eh045: 0, ehAtk06: 0, atk: [], atkTicks: 0, offAtk: 0, foes: {}, flank: { n2: 0, n3: 0, one3: 0, one2: 0, minor: 0 }, pairCats: {}, ehCats: {}, ehRowCats: {}, worst: [], screens: [], clipF: 0, clipFE: 0, fightF: 0, clipStates: {}, clipOuter: 0, clipTypes: {}, clipShots: [], hhF: 0, hh08: 0, hh05: 0, hhRow08: 0, hhMin: [] });
    const EDGE_F = 90 / 1600; // board: a body centre within ~90 px (1600-wide frame) of an edge reads as cut off
    const NOSTAND = ['knockdown', 'down', 'getup', 'reform', 'thrown', 'grabbed', 'clinch', 'dead', 'bones', 'rise']; // reform = a skeleton's get-up
    const stand = (a) => a.alive && !a.removed && a.pos.y < 0.3 && !(a.fsm && a.fsm.is(...NOSTAND));
    const cam = () => g.cameraRig && g.cameraRig.camera;
    let V = null;
    const W = () => window.innerWidth, H = () => window.innerHeight;
    // screen body: cx (px), top/bot (px), ppm (px per metre at that depth), on (centre inside the frame), inset (m from nearest edge)
    const body = (a, c) => {
      const h = a.height || 1.8;
      const p0 = new V(a.pos.x, a.pos.y + h * 0.55, a.pos.z).project(c), p1 = new V(a.pos.x + 1, a.pos.y + h * 0.55, a.pos.z).project(c);
      const ft = new V(a.pos.x, a.pos.y, a.pos.z).project(c), hd = new V(a.pos.x, a.pos.y + h, a.pos.z).project(c);
      const w = W(), hh = H();
      const cx = (p0.x + 1) / 2 * w, ppm = Math.abs(p1.x - p0.x) / 2 * w;
      const bot = (1 - ft.y) / 2 * hh, top = (1 - hd.y) / 2 * hh;
      const inset = Math.min(cx, w - cx) / Math.max(1e-3, ppm);
      return { a, cx, ppm, top, bot, inset, on: p0.z < 1 && cx > 0 && cx < w && bot > 0 && top < hh };
    };
    const vOver = (p, q) => { const ov = Math.min(p.bot, q.bot) - Math.max(p.top, q.top); return ov / Math.max(1, Math.min(p.bot - p.top, q.bot - q.top)); };
    const gapM = (p, q) => Math.abs(p.cx - q.cx) / ((p.ppm + q.ppm) / 2);
    const cat = (a) => (a.fsm.is('attack') ? 'A' : a.fsm.is('hitstun', 'block') ? 'R' : a.fsm.is('pause') ? 'P' : a.fsm.is('walk') ? 'W' : a.fsm.is('enter') ? 'E' : a.fsm.is('idle') ? 'I' : a.fsm.name);
    const spd = (a) => (a.vel ? Math.hypot(a.vel.x, a.vel.z) : 0);
    const foeOk = (e) => e.kind !== 'boss' && e.kind !== 'mount' && e.typeId !== 'thief' && e.team === 'enemies';
    const t0 = g.tick;
    g.bus.on('hit', (ev) => { const t = ev.target; if (t && t.kind === 'hero' && ev.attacker && ev.attacker.team === 'enemies' && !ev.blocked) { S.heroHits = (S.heroHits || 0) + 1; S.heroDmg = (S.heroDmg || 0) + (ev.damage || 0); } });
    g.bus.on('attackStart', (ev) => {
      const a = ev.actor, c = cam();
      if (!a || !c || !foeOk(a) || !V) return;
      const t = a.target && a.target.kind === 'hero' ? a.target : null;
      if (!t) return;
      c.updateMatrixWorld();
      const pa = body(a, c), ph = body(t, c), w = W();
      const pinnedL = ph.cx < 0.15 * w, pinnedR = ph.cx > 0.85 * w; // the board's 'pinned': hero within ~15 % of a frame edge
      const outer = (pinnedL && pa.cx < ph.cx) || (pinnedR && pa.cx > ph.cx);
      S.atk.push({ t: g.tick - t0, id: a.id, type: a.typeId, move: ev.moveId, side: Math.sign(a.pos.x - t.pos.x) || 1, hero: t.id, gap: +gapM(pa, ph).toFixed(2), dz: +(a.pos.z - t.pos.z).toFixed(2), inset: +pa.inset.toFixed(2), inFrame: pa.on && pa.inset >= 0.4, outer, pinned: pinnedL || pinnedR });
      const f = S.foes[a.id]; if (f) { f.lastAtk = g.tick; f.lastAct = g.tick; if (f.firstAtk == null) f.firstAtk = g.tick; }
    });
    const sample = () => {
      const c = cam();
      if (!c) return;
      if (!V) V = c.position.constructor;
      c.updateMatrixWorld();
      S.frames++;
      const tick = g.tick;
      const heroes = g.world.query({ kind: 'hero' }).filter((h) => h.alive && !h.removed);
      const foes = g.world.query({ team: 'enemies' }).filter(foeOk);
      const B = new Map();
      for (const e of foes) B.set(e.id, body(e, c));
      // idle bookkeeping (every live foe with a brain)
      for (const e of foes) {
        if (!e.brain || !e.alive) continue;
        const b = B.get(e.id), vis = b.on && b.inset >= 0.4 && !e.fsm.is('enter', 'rise', 'bones');
        let f = S.foes[e.id];
        if (!f) f = S.foes[e.id] = { id: e.id, type: e.typeId, tier: e.tier || '', firstVis: null, firstAtk: null, run: 0, maxRun: 0, runAct: 0, maxAct: 0, lastPause: false, visTicks: 0 };
        // a pause is an ACTION (feint, taunt, menace step) only if it visibly does something: a non-idle clip or a slide
        const cur = e.animator && e.animator.cur ? e.animator.cur.name : '';
        if (e.fsm.is('pause') && !f.lastPause && (cur !== 'idle' || spd(e) > 0.5)) { f.runAct = 0; f.acts = (f.acts || 0) + 1; }
        f.lastPause = e.fsm.is('pause');
        if (e.fsm.is('attack')) { f.run = 0; f.runAct = 0; }
        if (vis) {
          if (f.firstVis == null) { f.firstVis = tick; f.firstVisAt = tick - t0; }
          f.visTicks++;
          if (f.firstAtk == null) { const st = e.fsm.is('idle', 'walk') ? 'ctl' : e.fsm.is('hitstun', 'knockdown', 'down', 'getup', 'grabbed', 'thrown', 'block', 'reform', 'bones') ? 'hit' : 'oth'; (f.pre = f.pre || {})[st] = (f.pre[st] || 0) + 1;
            if (st === 'ctl') { const tk2 = g.ai && g.ai.tokens, ht = e.target, k2 = ((e.brain && e.brain.mode) || '?') + '/' + (e.aiWhy || '-') + (e.aiCrossing ? '/X' : '') + (tk2 && tk2.has(e) ? '/T' : '') + (e.aiOverdue ? '/od' : '') + (ht && ht.fsm && ht.fsm.is('down', 'getup', 'knockdown') ? '/hDown' : ''); (S.preWhy = S.preWhy || {})[k2] = (S.preWhy[k2] || 0) + 1; } } // C2 r2: before its first attack, what was it doing (C2 r3: + preWhy diagnostics, AI fields)
          // idle time counts only while the foe could act (controllable: idle / walk); being hit isn't idling
          if (e.fsm.is('idle', 'walk')) { f.run++; f.runAct++; if (f.run > 120 && tick % 6 === 0) { const k2 = (e.brain.mode || '?') + '/' + (e.aiWhy || '-'); (f.why = f.why || {})[k2] = (f.why[k2] || 0) + 1; } } // diagnostics: what a long-idle foe is doing
          if (f.run > f.maxRun) { f.maxRun = f.run; f.maxRunAt = tick - t0; }
          if (f.runAct > f.maxAct) { f.maxAct = f.runAct; f.maxActAt = tick - t0; }
        }
      }
      // enemy–enemy overlap
      const sf = foes.filter((e) => stand(e) && !e.fsm.is('enter')).map((e) => B.get(e.id)).filter((b) => b.on);
      if (sf.length >= 2) {
        S.framesEE++;
        let m = Infinity, ms = Infinity, mp = null, row = false;
        for (let i = 0; i < sf.length; i++) for (let j = i + 1; j < sf.length; j++) {
          const p = sf[i], q = sf[j];
          if (vOver(p, q) < 0.5) continue;
          const d = gapM(p, q);
          if (d < m) { m = d; mp = [p, q]; }
          if (spd(p.a) < 0.3 && spd(q.a) < 0.3 && d < ms) ms = d;
          if (d < 0.8) { const k2 = [cat(p.a), cat(q.a)].sort().join('+'); S.pairCats[k2] = (S.pairCats[k2] || 0) + 1; if (Math.abs(p.a.pos.z - q.a.pos.z) < 1.3) row = true; }
        }
        S.eeMins.push(Number.isFinite(m) ? m : 9);
        if (m < 0.8) S.ee08++;
        if (m < 0.5) { S.ee05++; if (S.worst.length < 16 && (!S.worst.length || tick - S.worst[S.worst.length - 1].t > 90)) S.worst.push({ t: tick - t0, d: +m.toFixed(2), a: [mp[0].a.typeId, mp[0].a.id, cat(mp[0].a), +mp[0].a.pos.x.toFixed(1), +mp[0].a.pos.z.toFixed(1)], b: [mp[1].a.typeId, mp[1].a.id, cat(mp[1].a), +mp[1].a.pos.x.toFixed(1), +mp[1].a.pos.z.toFixed(1)] }); }
        if (ms < 0.8) S.ee08s++;
        if (row) S.ee08r = (S.ee08r || 0) + 1;
        if (ms < 0.5) S.ee05s++;
      }
      // enemy–hero
      const HB = heroes.filter((h) => stand(h) && !h.fsm.is('throw', 'clinch')).map((h) => body(h, c));
      let anyNear = false, e06 = false, e045 = false, eA = false, eRow = false;
      for (const hb of HB) for (const b of sf) {
        const e = b.a;
        if (e.fsm.is('hold', 'toss') || e.grabbedBy || vOver(b, hb) < 0.5) continue;
        const d = gapM(b, hb);
        if (d < 3) anyNear = true;
        if (d < 0.6 && Math.abs(e.pos.z - hb.a.pos.z) < 1.2) { eRow = true; const k3 = cat(e) + (e.target === hb.a ? '>own' : '>other'); S.ehRowCats[k3] = (S.ehRowCats[k3] || 0) + 1; }
        if (d < 0.6) { e06 = true; const k2 = cat(e) + (e.target === hb.a ? '>own' : '>other'); S.ehCats[k2] = (S.ehCats[k2] || 0) + 1; { const adz = Math.abs(e.pos.z - hb.a.pos.z), k4 = cat(e) + '/' + ((e.brain && e.brain.mode) || '?') + (e.aiCrossing ? '/X' : '') + '/dz' + (adz < 1.2 ? 0 : adz < 2.2 ? 1 : 2); (S.ehWhy = S.ehWhy || {})[k4] = (S.ehWhy[k4] || 0) + 1; } if (e.fsm.is('attack') && e.target === hb.a) eA = true; }
        if (d < 0.45) e045 = true;
      }
      if (anyNear) { S.framesEH++; if (e06) S.eh06++; if (eRow) S.ehRow06 = (S.ehRow06 || 0) + 1; if (e045) S.eh045++; if (eA) S.ehAtk06++; }
      // C2 r2: ANY foe (any state but its walk-in) with its body centre within EDGE_F of a frame edge or beyond
      {
        const w = W(), lim = EDGE_F * w, live = foes.filter((e) => e.alive && !e.removed);
        const fighting = live.filter((e) => !e.fsm.is('enter'));
        if (fighting.length) {
          S.fightF++;
          let clip = false, clipE = false;
          const pins = heroes.map((h) => body(h, c));
          for (const e of live) {
            const b = B.get(e.id), cut = b.cx < lim || b.cx > w - lim || !(b.on || b.bot > 0);
            if (!cut) continue;
            clipE = true;
            if (e.fsm.is('enter')) continue;
            clip = true;
            const st = e.fsm.name; S.clipStates[st] = (S.clipStates[st] || 0) + 1; S.clipTypes[e.typeId] = (S.clipTypes[e.typeId] || 0) + 1;
            if (pins.some((hb) => (hb.cx < 0.15 * w && b.cx < hb.cx) || (hb.cx > 0.85 * w && b.cx > hb.cx))) S.clipOuter++;
          }
          if (clip) { S.clipF++; if (S.clipShots && S.clipShots.length < 40 && (!S.clipShots.length || tick - S.clipShots[S.clipShots.length - 1].tk > 60)) S.clipShots.push({ tk: tick, t: +((tick - t0) / 60).toFixed(1), who: live.filter((e) => { const b = B.get(e.id); return !e.fsm.is('enter') && (b.cx < lim || b.cx > w - lim); }).map((e) => [e.typeId, e.id, e.fsm.name, Math.round(B.get(e.id).cx)]), heroes: pins.map((hb) => Math.round(hb.cx)) }); }
          if (clipE) S.clipFE++;
        }
        // co-op hero–hero overlap
        const sh = heroes.filter((h) => stand(h)).map((h) => body(h, c)).filter((b) => b.on);
        if (sh.length >= 2) {
          S.hhF++;
          let m = Infinity, row = false;
          for (let i = 0; i < sh.length; i++) for (let j = i + 1; j < sh.length; j++) { if (vOver(sh[i], sh[j]) < 0.5) continue; const d = gapM(sh[i], sh[j]); if (d < m) m = d; if (d < 0.8 && Math.abs(sh[i].a.pos.z - sh[j].a.pos.z) < 1.3) row = true; }
          if (m < 0.8) S.hh08++; if (m < 0.5) S.hh05++; if (row) S.hhRow08++;
          S.hhMin.push(Number.isFinite(m) ? m : 9);
        }
      }
      // attackers cut by the frame edge
      for (const e of foes) {
        if (!e.fsm.is('attack')) continue;
        S.atkTicks++;
        const b = B.get(e.id);
        if (!b.on || b.inset < 0.4) S.offAtk++;
      }
      // flank balance (every 10 ticks)
      if (tick % 10 === 0) for (const h of heroes) {
        const hb = body(h, c);
        { const bin = Math.max(0, Math.min(9, Math.floor(hb.cx / W() * 10))); (S.heroBins = S.heroBins || Array(10).fill(0))[bin]++; } // where heroes stand in the frame (10 % bins)
        const ws = sf.filter((b) => { const e = b.a; return e.fsm.is('idle', 'walk', 'pause') && Math.abs(e.pos.x - h.pos.x) < 9 && Math.abs(b.cx - hb.cx) / hb.ppm > 0.4 && (heroes.length < 2 || e.target === h || !e.target); });
        if (ws.length < 2) continue;
        const l = ws.filter((b) => b.cx < hb.cx).length, r = ws.length - l;
        S.flank.n2++; if (!l || !r) S.flank.one2++;
        { const fb = Math.max(0, Math.min(9, Math.floor(hb.cx / W() * 10))), FB = (S.flankBins = S.flankBins || {}); const o = (FB[fb] = FB[fb] || [0, 0]); o[0]++; if (!l || !r) o[1]++; } // C2 r3 diag: hero frame bin → [samples, one-sided]
        if ((!l || !r) && (S.flankShots = S.flankShots || []).length < 30 && tick % 60 === 0) S.flankShots.push({ t: +((tick - t0) / 60).toFixed(1), hero: h.id, hf: +(hb.cx / W()).toFixed(2), mate: heroes.filter((o) => o !== h).map((o) => +(body(o, c).cx / W()).toFixed(2)), ws: ws.map((b) => { const e = b.a; return [e.typeId, e.id, e.fsm.name, (e.brain && e.brain.mode) || '', +(e.pos.x - h.pos.x).toFixed(1), +(e.pos.z - h.pos.z).toFixed(1), e.aiSlot ? e.aiSlot.src || '' : '', e.aiFlank ? 1 : 0]; }) }); // C2 r3 diag only
        if (ws.length >= 3) { S.flank.n3++; if (!l || !r) S.flank.one3++; S.flank.minor += Math.min(l, r) / ws.length; }
      }
      if (tick % 6 === 0) for (const e of foes) { if (!e.brain || !e.brain.P || !e.controllable) continue; const b = B.get(e.id); if (!b.on) continue; const k2 = (e.brain.mode || '?') + '/' + (e.aiWhy || '-'); (S.why = S.why || {})[k2] = (S.why[k2] || 0) + 1; } // diagnostics only
      if (window.__AITRACE && tick % 6 === 0) for (const e of foes) if (window.__AITRACE.includes(e.id)) { const t2 = e.target, tk3 = g.ai && g.ai.tokens; (S.trace = S.trace || []).push([+((tick - t0) / 60).toFixed(1), e.id, e.fsm.name, (e.brain && e.brain.mode) || '', e.aiWhy || '', e.aiAf || '', e.aiCrossing ? 1 : 0, tk3 && tk3.has(e) ? 1 : 0, e.aiOverdue ? 1 : 0, t2 ? t2.id : 0, t2 ? +(e.pos.x - t2.pos.x).toFixed(2) : 0, t2 ? +(e.pos.z - t2.pos.z).toFixed(2) : 0, t2 && t2.fsm ? t2.fsm.name : '', t2 ? +(body(t2, c).cx / W()).toFixed(2) : 0, +(B.get(e.id).inset).toFixed(2)]); } // C2 r3 AI_TRACE_IDS diagnostics (AI fields)
      if (tick % 300 === 0) S.screens.push([tick - t0, g.levels ? g.levels.screenIndex : null, heroes.map((h) => +h.pos.x.toFixed(1)), foes.length]);
    };
    const sys = { name: 'ai-stage-probe', order: 98, update: sample };
    window.__AITRACE = trIds;
    if (g.addSystem) g.addSystem(sys); else g.systems.push(sys);
  }, { god: process.env.AI_GOD !== '0', trIds: (process.env.AI_TRACE_IDS || '').split(',').filter(Boolean).map(Number) });
  for (let t = 0; t < secs * 1000; t += 5000) await api.advance(5000);
  const r = await E(() => {
    const S = window.__AISTAGE, g = window.__KCA.game;
    const pc = (n, d) => (d ? +(100 * n / d).toFixed(2) : null);
    const q = (arr, p) => { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2); };
    const foes = Object.values(S.foes);
    const idle = foes.filter((f) => f.visTicks > 30).map((f) => ({ id: f.id, type: f.type, tier: f.tier, latFirst: f.firstVis != null && f.firstAtk != null ? +((f.firstAtk - f.firstVis) / 60).toFixed(2) : null, neverAtk: f.firstAtk == null, strict: +(f.maxRun / 60).toFixed(2), strictAt: f.maxRunAt != null ? +(f.maxRunAt / 60).toFixed(1) : null, act: +(f.maxAct / 60).toFixed(2), vis: +(f.visTicks / 60).toFixed(1), why: f.why || {} }));
    const gaps = S.atk.map((a) => a.gap);
    const out = {
      frames: S.frames, framesEE: S.framesEE,
      ee08: pc(S.ee08, S.framesEE), ee05: pc(S.ee05, S.framesEE), ee08Still: pc(S.ee08s, S.framesEE), ee08Row: pc(S.ee08r || 0, S.framesEE), ee05Still: pc(S.ee05s, S.framesEE),
      eeMin: q(S.eeMins, 0), eeP05: q(S.eeMins, 0.05), eeMed: q(S.eeMins, 0.5),
      framesEH: S.framesEH, eh06: pc(S.eh06, S.framesEH), ehRow06: pc(S.ehRow06 || 0, S.framesEH), eh045: pc(S.eh045, S.framesEH), ehAtk06: pc(S.ehAtk06, S.framesEH),
      fightF: S.fightF, anyFoeClipped: pc(S.clipF, S.fightF), anyFoeClippedEnter: pc(S.clipFE, S.fightF), clipStates: S.clipStates, clipTypes: S.clipTypes, clipOuter: S.clipOuter, clipShots: S.clipShots,
      hh: { frames: S.hhF, hh08: pc(S.hh08, S.hhF), hh05: pc(S.hh05, S.hhF), hhRow08: pc(S.hhRow08, S.hhF), min: q(S.hhMin, 0), p05: q(S.hhMin, 0.05) },
      first: (() => { const L = foes.filter((f) => f.firstVis != null).map((f) => ({ id: f.id, type: f.type, at: f.firstVisAt != null ? +(f.firstVisAt / 60).toFixed(1) : null, lat: f.firstAtk != null ? +((f.firstAtk - f.firstVis) / 60).toFixed(2) : null, vis: +(f.visTicks / 60).toFixed(1), ctl: +(((f.pre && f.pre.ctl) || 0) / 60).toFixed(2), hit: +(((f.pre && f.pre.hit) || 0) / 60).toFixed(2) })); const v = L.filter((f) => f.lat != null).map((f) => f.lat); return { n: L.length, p50: q(v, 0.5), p90: q(v, 0.9), max: v.length ? Math.max(...v) : null, over6: L.filter((f) => (f.lat != null && f.lat > 6) || (f.lat == null && f.vis > 6)).length, never: L.filter((f) => f.lat == null).map((f) => [f.type, f.id, f.vis, f.ctl, f.hit]), list: L.map((f) => [f.type, f.id, f.at, f.lat, f.ctl, f.hit]), ctlMax: Math.max(0, ...L.map((f) => f.ctl)), ctlOver6: L.filter((f) => f.ctl > 6).length }; })(),
      atkSides: (() => { const by = {}; for (const a of S.atk) { const o = (by[a.hero] = by[a.hero] || { l: 0, r: 0 }); if (a.side < 0) o.l++; else o.r++; } const v = Object.values(by), n = v.reduce((m, o) => m + o.l + o.r, 0); return { perHero: by, minorShare: n ? +(v.reduce((m, o) => m + Math.min(o.l, o.r), 0) / n).toFixed(2) : null }; })(), // C2 r2: attack starts from each hero's left / right (minority share 0.5 = even)
      atk: { n: S.atk.length, outerByType: S.atk.filter((a) => a.outer).reduce((o, a) => { const k2 = a.type + ':' + a.move; o[k2] = (o[k2] || 0) + 1; return o; }, {}), gapMin: q(gaps, 0), gapP10: q(gaps, 0.1), gapMed: q(gaps, 0.5), under06: S.atk.filter((a) => a.gap < 0.6).length, notInFrame: S.atk.filter((a) => !a.inFrame).length, pinned: S.atk.filter((a) => a.pinned).length, outerPinned: S.atk.filter((a) => a.outer).length, outerClipped: S.atk.filter((a) => a.outer && a.inset < 1.0).length, bad: S.atk.filter((a) => !a.inFrame || a.outer || a.gap < 0.6).slice(0, 12) },
      offAtkFrames: S.offAtk, atkTicks: S.atkTicks, offAtkPct: pc(S.offAtk, S.atkTicks),
      idle: { n: idle.length, maxLatFirst: idle.reduce((m, f) => Math.max(m, f.latFirst ?? 0), 0), maxStrict: idle.reduce((m, f) => Math.max(m, f.strict), 0), maxAct: idle.reduce((m, f) => Math.max(m, f.act), 0), neverAtk: idle.filter((f) => f.neverAtk && f.vis > 6).length, worst: idle.sort((a, b) => b.strict - a.strict).slice(0, 6) },
      flank: { n2: S.flank.n2, one2: pc(S.flank.one2, S.flank.n2), n3: S.flank.n3, one3: pc(S.flank.one3, S.flank.n3), minor3: S.flank.n3 ? +(S.flank.minor / S.flank.n3).toFixed(2) : null, bins: S.flankBins || {}, shots: S.flankShots || [] },
      heroHitsPerMin: +((S.heroHits || 0) / (S.frames / 3600)).toFixed(1), heroDmgPerMin: +((S.heroDmg || 0) / (S.frames / 3600)).toFixed(1), heroBins: S.heroBins || [], atkPerMin: +(S.atk.length / (S.frames / 3600)).toFixed(1), why: S.why || {}, preWhy: S.preWhy || {}, trace: S.trace || [], dstats: Object.fromEntries(Object.entries((g.ai && g.ai.director && g.ai.director.stats) || {}).filter(([, v]) => typeof v === 'number').map(([k2, v]) => [k2, +v.toFixed(2)])),
      pairCats: S.pairCats, ehCats: S.ehCats, ehWhy: S.ehWhy || {}, ehRowCats: S.ehRowCats, worst: S.worst, screens: S.screens,
      errors: window.__KCA.info().errors.slice(-6), stage: g.levels && g.levels.info ? g.levels.info() : null,
    };
    return out;
  });
  api.log('AISTAGE ' + JSON.stringify({ ...r, atk: { ...r.atk, bad: r.atk.bad.length }, idle: { ...r.idle, worst: r.idle.worst.slice(0, 3) }, worst: r.worst.length, screens: r.screens.length, clipShots: r.clipShots.length, first: { ...r.first, list: r.first.list.length } }));
  fs.writeFileSync(path.join(api.outDir, 'ai_stage.json'), JSON.stringify(r, null, 1));
};
