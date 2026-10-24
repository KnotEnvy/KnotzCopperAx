import fs from 'node:fs';
import path from 'node:path';
export default async api => {
  await api.evalGame(() => {
    const K = window.__KCA, g = K.game; K.debug.god(true); K.input.releaseAll();
    for (const h of g.world.query({kind:'hero'})) { g.bots.detach(h); h.fsm.go('idle'); }
    for (const e of g.world.query({team:'enemies'})) { e.brain = null; e.hp = e.maxHp = 1000; }
    window.__tierHits = []; window.__fistImpact=null;
    g.bus.on('magic:earthFistImpact',e=>window.__fistImpact=e);
    g.bus.on('hit', e => { if (e.moveId?.startsWith('magic_t')) window.__tierHits.push({tier:window.__testedTier, target:e.target.id, damage:e.damage}); });
  });
  const evidence = [];
  await api.advance(4000); // Stage banner must finish before evaluating any tier.
  const coverage = await api.evalGame(async () => {
    const source = performance.getEntriesByType('resource').map(r => r.name).find(n => /\/three\.js|three\.module\.js|deps\/three/.test(n));
    const T = await import(source), M = await import('/src/magic/_earthStone.js');
    const R = window.__KCA.game.renderer.webgl, target = new T.WebGLRenderTarget(256, 256);
    const geo = new T.PlaneGeometry(2, 2);
    geo.setAttribute('color', new T.BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(1), 3));
    for (const [name,size] of [['aStoneBounce',1],['aStonePivot',3],['aStoneSeed',1]]) geo.setAttribute(name,new T.BufferAttribute(new Float32Array(geo.attributes.position.count*size),size));
    geo.setAttribute('aStoneCollapse',new T.InstancedBufferAttribute(new Float32Array(2),2));
    geo.setAttribute('aStoneHeat', new T.BufferAttribute(new Float32Array(geo.attributes.position.count), 1));
    geo.setAttribute('aStoneEnergy', new T.InstancedBufferAttribute(new Float32Array([0]), 1));
    // Former mask attributes deliberately request a 2.5% fade. Production shader must ignore them.
    geo.setAttribute('aStoneOpacity', new T.InstancedBufferAttribute(new Float32Array([.025]), 1));
    const mat = M.stoneMaterial('#ffffff', '#ff9922', null, true, true); mat.toneMapped = false;
    const patch = mat.onBeforeCompile;
    mat.onBeforeCompile = shader => { patch(shader); shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', 'gl_FragColor=vec4(1.0);'); };
    mat.customProgramCacheKey = () => 'earth_opaque_gpu_probe_r9';
    const mesh = new T.InstancedMesh(geo, mat, 1); mesh.setMatrixAt(0, new T.Matrix4()); mesh.frustumCulled = false;
    const scene = new T.Scene(); scene.background = new T.Color(0); scene.add(mesh);
    const camera = new T.OrthographicCamera(-1, 1, 1, -1, .1, 10); camera.position.z = 2; camera.updateMatrixWorld();
    const pixels = new Uint8Array(256 * 256 * 4), old = R.getRenderTarget();
    R.setRenderTarget(target); R.render(scene, camera); R.readRenderTargetPixels(target, 0, 0, 256, 256, pixels);
    const opaqueCoverage = pixels.filter((v, i) => i % 4 === 0 && v > 128).length / (256 * 256);
    R.setRenderTarget(old); target.dispose(); geo.dispose(); mat.dispose();
    return { opaqueCoverage, transparent: mat.transparent, pass: opaqueCoverage > .999 && !mat.transparent };
  });
  fs.writeFileSync(path.join(api.outDir, 'opaque-gpu.json'), JSON.stringify(coverage, null, 2));
  if (!coverage.pass) throw new Error('Opaque stone GPU check failed ' + JSON.stringify(coverage));
  await api.evalGame(() => { window.__tierCensus = {}; const g=window.__KCA.game; g.addSystem({name:'earth_tier_census',order:99,render(){ const t=window.__testedTier, r=g.renderer.webgl.info.render, row=window.__tierCensus[t] ||= {calls:0,triangles:0}; row.calls=Math.max(row.calls,r.calls);row.triangles=Math.max(row.triangles,r.triangles); }}); });
  for (const tier of [1,2,3,4]) {
    await api.evalGame(tier => {
      const K = window.__KCA, g = K.game, h = g.world.query({kind:'hero'})[0];
      window.__testedTier = tier;
      h.fsm.go('idle'); h.invuln = 0;
      g.world.query({team:'enemies'}).forEach((e,i) => { e.brain=null; e.fsm.go('idle'); e.pos.x=h.pos.x+2+i*1.8; e.pos.z=(i%3-1)*.7; e.pos.y=0; e.vel.set?.(0,0,0); e.invuln=0; });
      K.debug.cast(1,tier);
    }, tier);
    let peakScore = 0, peakTick = null, peakFrame = null, impactShot=false;
    const frames = [];
    for (let frame=0;frame<150;frame++) {
      if(tier===4 && process.env.EARTH_T4_CLIP==='1') await api.frames(1,33,'fist');
      else await api.advance(33);
      const snapshot = await api.evalGame(tier => {
        const g = window.__KCA.game;
        let score=0, fistVisible=false;
        const T=g.camera.position.clone();
        g.vfx.group.traverse(m => {
          if (!m.visible || !m.isInstancedMesh) return;
          const desired = tier===4 ? 'magic_fist' : tier===3 ? 'magic_boulder' : tier===2 ? 'magic_column' : 'magic_spike';
          if(m.name!==desired) return;
          for(let i=0;i<m.count;i++) {
            const a=m.instanceMatrix.array, offset=i*16;
            T.set(a[offset+12], a[offset+13]+(tier===4?2:0), a[offset+14]).project(g.camera);
            const visible=Math.abs(T.x)<1 && Math.abs(T.y)<.85 && T.z<1;
            if(visible) { score+=Math.abs(a[offset+5]) * (tier===4 ? 1 / (1+Math.abs(a[offset+13])) : 1); if(tier===4)fistVisible=true; }
          }
        });
        const impact=window.__fistImpact;
        if(tier===4 && impact && g.tick>=impact.tick && g.tick<=impact.tick+8) score*=2;
        return {tick:g.tick,score,fistVisible,trauma:g.cameraRig.trauma,exposure:g.renderer.exposureMul,impact};
      },tier);
      frames.push(snapshot);
      if(tier===4 && snapshot.impact && !impactShot){impactShot=true;await api.shot('L4_impact');}
      if(snapshot.score > peakScore) {
        peakScore=snapshot.score;peakTick=snapshot.tick;peakFrame=frame;
        await api.shot(`L${tier}_peak`);
      }
    }
    if(!peakScore) throw new Error('No visible tier peak '+tier);
    fs.writeFileSync(path.join(api.outDir,`L${tier}_peak.json`),JSON.stringify({peakTick,peakFrame,peakScore,frames},null,2));
    await api.advance(3500);
    const row = await api.evalGame(tier => {
      const g=window.__KCA.game, gl=g.renderer.webgl.getContext();
      const hits=window.__tierHits.filter(h=>h.tier===tier), totals={};
      for(const h of hits) totals[h.target]=(totals[h.target]||0)+h.damage;
      return {tier,hits,totals,census:window.__tierCensus[tier],errors:window.__KCA.info().errors,badPrograms:g.renderer.webgl.info.programs.filter(p=>!gl.getProgramParameter(p.program,gl.LINK_STATUS)).map(p=>p.name)};
    }, tier);
    row.visual={peakTick,peakFrame,peakScore,maxTrauma:Math.max(...frames.map(f=>f.trauma||0)),minExposure:Math.min(...frames.map(f=>f.exposure??1)),fistFrames:frames.filter(f=>f.fistVisible).length};
    const expected=[0,4,8,16,24][tier];
    row.pass=Object.keys(row.totals).length>0 && Object.values(row.totals).every(v=>Math.abs(v-expected)<.001) && !row.errors.length && !row.badPrograms.length && row.census.triangles <= 1500000 && (tier!==4 || row.visual.maxTrauma>=.7 && row.visual.minExposure<=.6 && row.visual.fistFrames>4);
    evidence.push(row);
  }
  const sharp = (await import('sharp')).default;
  const tiles = await Promise.all([1,2,3,4].map(async (tier,i)=>({input:await sharp(path.join(api.outDir,`L${tier}_peak.png`)).resize(800,450).toBuffer(),left:(i%2)*800,top:Math.floor(i/2)*450})));
  await sharp({create:{width:1600,height:900,channels:3,background:'#111'}}).composite(tiles).png().toFile(path.join(api.outDir,'L1-L4_peak_2x2.png'));
  fs.writeFileSync(path.join(api.outDir,'all-tiers.json'),JSON.stringify(evidence,null,2));
  if(evidence.some(e=>!e.pass)) throw new Error('Tier validation failed: '+JSON.stringify(evidence));
};
