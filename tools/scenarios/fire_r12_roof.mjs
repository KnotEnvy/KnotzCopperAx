// r12: HUD-hidden stage-1 game camera roof still + smoke on/off + 48-frame loop + seating probe (r11 scenario).
import roof from './vfx_fire_r11_roof.mjs';
export default async api=>{
 await api.evalGame(()=>{const st=document.createElement('style');st.textContent='.kca-hud,.kca-card,.kca-toast,.kca-ui{display:none!important}';document.head.append(st);window.__KCA.game.renderer.render(0);});
 await roof(api);
 await api.evalGame(()=>{const p=window.__roofPool,A=p.geometry.attributes;const rows={};for(let i=0;i<p.geometry.instanceCount;i++){const r=Math.floor(A.iFrame.getW(i)+.001);rows[r]=(rows[r]||0)+1;}window.__rows=rows;});
 const rows=await api.evalGame(()=>window.__rows);
 (await import('node:fs')).writeFileSync(api.outDir+'/roof-rows.json',JSON.stringify(rows));
};
