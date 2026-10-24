export default async (api) => {
  await api.shot('idle');
  api.log(await api.evalGame(() => {
    const a=window.__KCA.showcase.foe;
    return {flash:a._flash, materials:a.flashMaterials.map(m=>({name:m.name, color:m.color.getHexString(), emissive:m.emissive.getHexString(), intensity:m.emissiveIntensity, hit:m.userData.kcaHitFlash?.kHitW.value.toArray()}))};
  }));
  await api.evalGame(() => window.__KCA.showcase.fire('light'));
  await api.advance(33); await api.shot('flash');
  await api.evalGame(() => {const v=window.__KCA.game.vfx;v.group.visible=false;for(const l of v.lights) l.light.intensity=0;});
  await api.advance(0); await api.shot('flash_only');
  await api.evalGame(() => {window.__KCA.showcase.foe._flash.t=0;});
  await api.advance(0); await api.shot('no_flash');
};
