// Keep the real camp camera, props, animation and lighting; hide the transient stage title for art inspection.
export default async api=>{
 await api.evalGame(()=>{
  const style=document.createElement('style');style.textContent='.kca-card,.kca-camp-banner{display:none!important}';document.head.append(style);
 });
 await api.shot('camp-game');
 await api.frames(40,33,'camp');
};
