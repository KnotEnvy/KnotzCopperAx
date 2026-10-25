// r18 evidence: the T4 fist frozen in its hover (before the slam) rendered lit and with every earth heat gain at 0,
// so the hand silhouette can be judged without emission. Shots: fist-hover-lit.png, fist-hover-unlit.png.
export default async api => {
  await api.evalGame(() => {
    const K=window.__KCA,g=K.game;K.debug.god(true);K.input.releaseAll();
    for(const h of g.world.query({kind:'hero'})){g.bots.detach(h);h.fsm.go('idle');}
    for(const e of g.world.query({team:'enemies'})){e.brain=null;e.hp=e.maxHp=1000;}
  });
  await api.advance(4000);
  await api.evalGame(() => {
    const K=window.__KCA,g=K.game,h=g.world.query({kind:'hero'})[0];
    g.world.query({team:'enemies'}).forEach((e,i)=>{e.brain=null;e.fsm.go('idle');e.pos.set(h.pos.x+2+i*1.8,0,(i%3-1)*.7);e.vel.set(0,0,0);e.invuln=0;});
    K.debug.cast(1,4);
  });
  // advance until the fist has settled into its hover (y within .3 of gy+3.2 SC units) and before impact
  let seen=0;
  for (let i=0;i<120;i++) {
    await api.advance(33);
    const y=await api.evalGame(()=>{const m=window.__KCA.game.vfx.group.children.find(m=>m.name==='magic_fist');return m?.visible&&m.count?m.instanceMatrix.array[13]:null;});
    if (y!==null) seen++;
    if (y!==null && seen>8 && y<3.6) break;
  }
  await api.shot('fist-hover-lit');
  await api.evalGame(()=>{const g=window.__KCA.game;g.vfx.group.traverse(m=>{if(m.material?.userData?.stoneHeatGain)m.material.userData.stoneHeatGain.value=0;});g.renderer.render(0);});
  await api.shot('fist-hover-unlit');
};
