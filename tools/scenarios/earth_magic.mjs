// Brann T2 in real combat, with moving actors and per-instance stone opacity census.
// /?mode=stage&stage=1&p1=brann&p2=seraphine&bot=1&seed=1
// EARTH_BOSS=1: /?mode=stage&stage=2&p1=brann&p2=seraphine&bot=1&seed=1&screen=3
// --warm 0 --sheet; 48 frames at 66 ms. EARTH_GUARD=1 places one test stone in the camera-to-boss ray.
// EARTH_CLIP=1: 330 ms charge pre-roll, then exactly 60 frames at 33 ms. EARTH_PERF=1 measures the complete targeted column hold.
import fs from 'node:fs';
import path from 'node:path';
import { installBossDominance } from './boss_dom.mjs';
export default async (api) => {
  const boss = process.env.EARTH_BOSS === '1', clip = process.env.EARTH_CLIP === '1';
  const frameCount = clip ? 60 : 48, step = clip ? 33 : 66;
  const perf = process.env.EARTH_PERF === '1', perfRows = [];
  const auditPrograms = async () => {
    const result = await api.evalGame(() => {
      const R = window.__KCA.game.renderer.webgl, gl = R.getContext();
      const bad = R.info.programs.filter(p => !gl.getProgramParameter(p.program, gl.LINK_STATUS))
        .map(p => ({ name: p.name, log: gl.getProgramInfoLog(p.program) }));
      return { count: R.info.programs.length, bad };
    });
    if (result.bad.length) throw new Error('Unlinked render programs: ' + JSON.stringify(result));
    return result;
  };
  if (perf) await api.page.addScriptTag({ content: fs.readFileSync(path.resolve('tools/perfbench.page.js'), 'utf8') });
  const measure = async phase => {
    const census = await api.evalGame(() => window.__PB.census());
    const overdraw = await api.evalGame(() => window.__PB.overdraw());
    const diagnostics = await api.evalGame(() => { const gl=window.__KCA.game.renderer.webgl.getContext(); return {contextLost:gl.isContextLost(),glError:gl.getError()}; });
    const programs = await auditPrograms();
    await api.evalGame(() => window.__PB.gpuWarm());
    const samples = [];
    for (let i = 0; i < 48 && samples.filter(s => s.valid && s.frame > 0 && s.cal > 0 && s.calMax < 0.1872).length < 12; i++) {
      samples.push(await api.evalGame(() => window.__PB.gpuSample({ frames: 2 })));
    }
    const clean = samples.filter(s => s.valid && s.frame > 0 && s.cal > 0 && s.calMax < 0.1872), valid = samples.filter(s => s.valid);
    const quantile = (a, p) => a.sort((x, y) => x - y)[Math.floor((a.length - 1) * p)];
    const ratio = clean.length >= 4 ? quantile(clean.map(s => s.frame / s.cal), 0.25) : quantile(valid.map(s => s.frame), 0.1) / quantile(valid.map(s => s.cal), 0.1);
    const row = { phase, clean: clean.length, attempts: samples.length, est1650ms: ratio * 1.379, est5070ms: ratio * 0.144,
      calls: census.calls, triangles: census.triangles, programs: census.programs, diagnostics, programAudit: programs, overdraw, samples };
    perfRows.push(row); fs.writeFileSync(path.join(api.outDir, 'earth-perf.json'), JSON.stringify(perfRows, null, 2));
    api.log('earth perf ' + JSON.stringify({ ...row, samples: undefined }));
    if (!Number.isFinite(row.est1650ms) || row.est1650ms <= 0 || !Number.isFinite(overdraw.mean)) throw new Error('Invalid GPU timer/overdraw result for '+phase);
    if (clean.length < 4) throw new Error('Insufficient clean GPU samples for ' + phase);
  };
  await api.evalGame((boss) => {
    const K = window.__KCA, g = K.game; K.debug.god(true);
    const h = g.world.query({ kind: 'hero' })[0]; g.bots.detach(h); K.input.releaseAll(); h.fsm.go('idle');
    if (boss) {
      const L = g.levels, last = L.screens.length - 1;
      for (const e of g.world.query({ team: 'enemies' })) K.debug.kill(e.id);
      L.waveActors.clear(); L.pendingSpawns = 0;
      h.pos.x = L.screens[last].x[0] + 4;
      const h2 = g.world.query({ kind: 'hero' })[1]; if (h2) h2.pos.x = h.pos.x + 2;
      L.enterScreen(last); L.waveActors.clear(); L.pendingSpawns = 0;
      L.waveIndex = (L.screens[last].waves || []).length - 1; L.nextWave();
    }
  }, boss);
  await api.advance(boss ? 9000 : 4000);
  if (boss) {
    await api.advance(2500); // let the intro banner complete before judging the spell
    await installBossDominance(api, [7, 10]);
    const lead = await api.evalGame(() => window.__KCA.game._bossCam?.members().map(a => [a.typeId, a.fsm.name]));
    if (!lead?.length) throw new Error('No stage-2 boss members');
    api.log('boss ' + JSON.stringify(lead));
  }
  await api.shot('before');
  await auditPrograms();
  if (perf) await measure('before_cast');
  await api.evalGame(() => {
    window.__earthHits = [];
    window.__earthBreaches = []; window.__earthCrumbles = [];
    window.__KCA.game.bus.on('magic:earthBreach', e => window.__earthBreaches.push(e));
    window.__KCA.game.bus.on('magic:earthCrumble', e => window.__earthCrumbles.push(e));
    window.__KCA.game.bus.on('hit', e => {
      if (e.moveId === 'magic_t2') window.__earthHits.push({ tick: window.__KCA.game.tick, id: e.target.id, x: e.target.pos.x, z: e.target.pos.z, damage: e.damage, moveId: e.moveId });
    });
  });
  await api.evalGame(() => window.__KCA.debug.cast(1, 2));
  const preRollMs = clip ? 330 : 0;
  if (preRollMs) await api.advance(preRollMs);
  const crumbleOffsets = new Set();
  const samples = []; let bestHold = 0, peakSample = -1, hottest = 0, hotSample = -1, mostChips = 0, crumbleSample = -1, measuredHold = false, measuredCrumble = false, unlitShot = false;
  for (let i = 0; i < frameCount; i++) {
    await api.frames(1, step, 'earth');
    if ([18, 34, 42].includes(i)) await api.shot(['eruption', 'crumble', 'settle'][[18, 34, 42].indexOf(i)]);
    samples.push(await api.evalGame(() => {
      const g = window.__KCA.game, rocks = [];
      g.vfx.group.traverse(m => { if (m.userData.magicOccluder && m.visible) rocks.push({ kind: m.name, count: m.count, opacity: [...m.userData.magicOpacity.slice(0, m.count)],
        protectedOpacity: [...m.userData.magicProtectedOpacity?.slice(0, m.count) || []], dither: !!m.userData.magicDither, placement: { ...m.userData.magicPlacement },
        collapse: m.geometry.attributes.aStoneCollapse ? Array.from({length:m.count},(_,i)=>m.geometry.attributes.aStoneCollapse.getX(i)) : [],
        variant: m.userData.basaltVariant, heatMax: m.geometry.attributes.aStoneHeat ? Math.max(...m.geometry.attributes.aStoneHeat.array) : 0,
        energy: m.geometry.attributes.aStoneEnergy ? [...m.geometry.attributes.aStoneEnergy.array.slice(0, m.count)] : [],
        hostOpacity: m.material.opacity, maskOnly: !!m.userData.magicMaskOnly, masks: m.userData.magicMasks?.map(a => [...a.slice(0, m.count * 4)]),
        heightSum: Array.from({ length: m.count }, (_, j) => Math.abs(m.instanceMatrix.array[j * 16 + 5])).reduce((a, b) => a + b, 0),
        heights: Array.from({ length: m.count }, (_, j) => Math.abs(m.instanceMatrix.array[j * 16 + 5])),
        bases: Array.from({ length: m.count }, (_, j) => [m.instanceMatrix.array[j * 16 + 12], m.instanceMatrix.array[j * 16 + 14]]) }); });
      const boss = window.__bd?.sample?.();
      const chip = g.vfx.group.children.find(m => m.name === 'magic_chip');
      return { tick: g.tick, rocks, boss, chips: chip?.visible ? chip.count : 0,
        exposure: g.renderer.exposureMul, spellLight: g.magic.light.intensity, trauma: g.cameraRig.trauma,
        camera: g.camera.position.toArray(), pooledLights: g.vfx.lights.map(s => s.light.intensity),
        debrisStats: { ...chip?.userData.magicDebrisStats },
        actors: g.world.actors.filter(a => a.pos && !a.removed && a.height && (a.team === 'enemies' || a.team === 'players'))
          .map(a => ({ id: a.id, kind: a.kind, type: a.typeId, height: a.height, x: a.pos.x, y: a.pos.y, z: a.pos.z, state: a.fsm?.name })),
        smokeCount:g.vfx.fire?.items.filter(o=>o.row===2).length||0,
        smokePeakAlpha:Math.max(0,...(g.vfx.fire?.items.filter(o=>o.row===2).map(o=>o.alpha)||[])),
        errors: window.__KCA.info().errors };
    }));
    const score = samples.at(-1).rocks.filter(r => r.kind === 'magic_column').reduce((n, r) => n + r.heights.reduce((sum,h,i)=>sum+(r.collapse[i]>0?0:h),0), 0);
    const heat = samples.at(-1).rocks.reduce((n, r) => n + r.energy.reduce((a, e) => a + e, 0), 0);
    if (heat > hottest) { hottest = heat; hotSample = i; await api.shot('peak'); }
    if (score > 0 && score > bestHold) { bestHold = score; peakSample = i; await api.shot('hold');
      if (process.env.EARTH_UNLIT === '1' && !unlitShot && i>=24) {
        unlitShot=true;
        await api.shot('silhouette-lit');
        const gains=await api.evalGame(()=>{const a=[];window.__KCA.game.vfx.group.traverse(m=>{if(m.material?.userData.stoneHeatGain){a.push([m.uuid,m.material.userData.stoneHeatGain.value]);m.material.userData.stoneHeatGain.value=0;}});window.__KCA.game.renderer.render(0);return a;});
        await api.shot('silhouette-unlit');
        await api.evalGame(gains=>{window.__KCA.game.vfx.group.traverse(m=>{const a=gains.find(a=>a[0]===m.uuid);if(a)m.material.userData.stoneHeatGain.value=a[1];});window.__KCA.game.renderer.render(0);},gains);
      }
    }
    if (process.env.EARTH_DETAIL === '1' && i === (clip ? 29 : 19)) {
      await api.shot('channel-bloom-on');
      const intensity = await api.evalGame(() => {
        const r=window.__KCA.game.renderer, bloom=r.post.bloom;
        const saved=bloom.intensity; bloom.intensity=0; r.render(0); return saved;
      });
      await api.shot('channel-bloom-off');
      await api.evalGame(intensity => {const r=window.__KCA.game.renderer;r.post.bloom.intensity=intensity;r.render(0);},intensity);
    }
    const falling = samples.at(-1).rocks.flatMap(r=>r.collapse || []);
    const maxFall = Math.max(0,...falling);
    if (process.env.EARTH_DETAIL === '1') for (const ms of [100,200,300]) {
      if (!crumbleOffsets.has(ms) && maxFall*1000>=ms && maxFall*1000<ms+step+17) {
        crumbleOffsets.add(ms); await api.shot('crumble-plus-'+ms+'ms');
        fs.writeFileSync(path.join(api.outDir,'crumble-plus-'+ms+'ms.json'),JSON.stringify({tick:samples.at(-1).tick,maxFall,requestedMs:ms}));
      }
    }
    if (samples.at(-1).chips > mostChips && maxFall > .12 && maxFall < .4) {
      mostChips = samples.at(-1).chips; crumbleSample = i; await api.shot('crumble');
    }
    const liveColumns = samples.at(-1).rocks.filter(r => r.kind === 'magic_column').reduce((n, r) => n + r.count, 0);
    const breaches = await api.evalGame(() => window.__earthBreaches.length);
    if (perf && !measuredHold && liveColumns >= 3 && liveColumns >= breaches && score >= bestHold * .9 && i > (clip ? 24 : 16)) {
      measuredHold = true; await measure('target_column_hold');
    }
    if (perf && measuredHold && !measuredCrumble && maxFall > .18 && maxFall < .5) {
      measuredCrumble = true; await measure('falling_fragments');
    }
  }
  // Foreground regression: placement must relocate the solid guard, never fade it.
  if (boss && process.env.EARTH_GUARD === '1') {
    const guard = await api.evalGame(async () => {
      const g = window.__KCA.game, a = g._bossCam.members()[0], M = await import('/src/magic/meshes.js');
      const f = M.rockField(g.vfx, 'column'); f.glow(1.5);
      const desired = { x: a.pos.x, y: a.pos.y, z: a.pos.z + .8 };
      const inst = f.add({ pos: desired, scale: [1.5, a.height, 1.5], rise: .001, hold: .8, sink: .2 });
      f._tick(.05);
      const dominance = window.__bd.sample();
      const source = performance.getEntriesByType('resource').map(r => r.name).find(n => /\/three\.js|three\.module\.js|deps\/three/.test(n));
      const T = await import(source), saved = f.mesh.instanceMatrix.array.slice(), count = f.mesh.count;
      // Put an opaque slab on the captain deliberately: the independent probe must catch it.
      const matrix = new T.Matrix4().compose(new T.Vector3(desired.x, desired.y, desired.z + .5), new T.Quaternion(), new T.Vector3(3, a.height, 3));
      f.mesh.setMatrixAt(0, matrix); f.mesh.count = 1; f.mesh.visible = true;
      const opaqueCounterfactual = window.__bd.sample();
      f.mesh.instanceMatrix.array.set(saved); f.mesh.instanceMatrix.needsUpdate = true; f.mesh.count = count; f.mesh.visible = count > 0;
      return { dominance, opaqueCounterfactual, desired, placed: inst ? { x: inst.x, z: inst.z } : null,
        placement: f.mesh.userData.magicPlacement, dither: f.mesh.userData.magicDither };
    });
    await api.shot('sightline-guard');
    if (guard.dither || guard.dominance.magicOcc > 0 || !(guard.opaqueCounterfactual.magicOcc > 0)) throw new Error('Opaque placement/negative control failed: ' + JSON.stringify(guard));
    samples.push({ guard }); api.log('guard ' + JSON.stringify(guard));
  }
  const fadedBelow1 = samples.reduce((n, s) => n + (s.rocks || []).reduce((c, r) => c + r.opacity.filter(a => a < 1).length, 0), 0);
  const peak = samples[peakSample];
  const peakColumns = peak?.rocks.filter(r => r.kind === 'magic_column') || [];
  const peakSummary = { sample: peakSample, tick: peak?.tick, count: peakColumns.reduce((n, r) => n + r.count, 0),
    fullyOpaque: peakColumns.reduce((n, r) => n + r.opacity.filter(a => a >= 0.9).length, 0),
    maskOnly: peakColumns.every(r => r.maskOnly), magicOcc: peak?.boss?.magicOcc ?? null };
  const strikeProbe = await api.evalGame(() => ({ columns: window.__earthBreaches, crumbles: window.__earthCrumbles }));
  strikeProbe.pass = strikeProbe.columns.length > 0 && strikeProbe.columns.every(c => c.baseToTarget <= .01 && (c.boss || (!c.skipped && c.columnBaseToTarget <= .01)) && c.strikeTick === c.breachTick && (c.boss || c.launchTick === c.breachTick));
  fs.writeFileSync(path.join(api.outDir, 'strike-probe.json'), JSON.stringify(strikeProbe, null, 2));
  const programAudit = await auditPrograms();
  const R = { url: api.page.url(), boss, frameCount, step, preRollMs, peak: peakSummary, hotSample, crumbleSample, fadedBelow1, programAudit, strikeProbe, hits: await api.evalGame(() => window.__earthHits), samples };
  fs.writeFileSync(path.join(api.outDir, 'earth.json'), JSON.stringify(R, null, 2));
  api.log(JSON.stringify({ samples: samples.length, peak: peakSummary, fadedBelow1, peakRocks: Math.max(...samples.map(s => s.rocks?.reduce((n, r) => n + r.count, 0) || 0)), minBossVisibility: Math.min(...samples.filter(s => s.boss).map(s => s.boss.vis)), maxMagicOcc: Math.max(0, ...samples.filter(s => s.boss).map(s => s.boss.magicOcc || 0)) }));
  if (!strikeProbe.pass) throw new Error('Actual column contact/strike/launch check failed');
  if (perf && (!measuredHold || !measuredCrumble)) throw new Error('Missed earth perf checkpoint: ' + JSON.stringify({ measuredHold, measuredCrumble }));
};
