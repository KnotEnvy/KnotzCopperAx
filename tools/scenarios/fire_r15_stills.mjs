// r15 shared-fire: HUD-hidden stills at the game camera, 3 moments 170 ms apart (shape check at 1x). Works for stage 1 (roof)
// and the camp (mode=stage&stage=bonus&...&camp=2). Optional clip: KCA_FIRE_CLIP=<n> appends n frames at 33 ms (use --mp4).
export default async api=>{
 await api.evalGame(()=>{const st=document.createElement('style');st.textContent='.kca-hud,.kca-card,.kca-toast,.kca-ui,.kca-banner{display:none!important}';document.head.append(st);document.querySelectorAll('.kca-hud').forEach(e=>e.style.display='none');});
 for(const n of ['a','b','c']){ await api.shot('still-'+n); await api.advance(170); }
 const clip=+(process.env.KCA_FIRE_CLIP||0);
 if(clip) await api.frames(clip,33,'clip');
};
