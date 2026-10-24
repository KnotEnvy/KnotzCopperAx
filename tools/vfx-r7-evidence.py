"""Compose review evidence from untouched native capture PNGs (Pillow + numpy)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageChops, ImageEnhance, ImageOps
import json
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
H=ROOT/'progress/shots/vfx-hitfx/r13';F=ROOT/'progress/shots/shared-fire-library/r7'
def load(p):return Image.open(p).convert('RGB')
def label(im,text):
 out=Image.new('RGB',(im.width,im.height+24),'#191a1f');out.paste(im,(0,24));ImageDraw.Draw(out).text((8,6),text,fill='white');return out
def grid(tiles,cols,path):
 w=max(t.width for t in tiles);h=max(t.height for t in tiles);out=Image.new('RGB',(w*cols,h*((len(tiles)+cols-1)//cols)),'#17181c')
 for i,t in enumerate(tiles):out.paste(t,(i%cols*w,i//cols*h))
 out.save(path)
def data(folder):return json.loads((H/folder/'core-probe.json').read_text())
def point(folder):
 d=data(folder);return d['probes'][d.get('selectedIndex',0)]['screen']
def crop(folder,ms=0,w=400,h=270):
 x,y=point(folder);x=int(x);y=int(y);return load(H/folder/f'contact-{ms:03}ms.png').crop((x-w//2,y-h//2,x+w//2,y+h//2))
# Primary contacts at native and 400x225, with equally sized external references.
for kind,folder in [('light','light-release'),('heavy','heavy-od')]:
 load(H/folder/'contact-000ms.png').save(H/f'{kind}-native.png')
 load(H/folder/'contact-000ms.png').resize((400,225),Image.Resampling.LANCZOS).save(H/f'{kind}-400x225.png')
grid([label(load(H/'light-400x225.png'),'Light / actual 4-brain brawl'),label(load(H/'heavy-400x225.png'),'Heavy / actual 4-brain brawl'),
 label(ImageOps.fit(load(ROOT/'refs/modern/tmnt_hit-impact.jpg'),(400,225)),'Reference / TMNT'),label(ImageOps.fit(load(ROOT/'refs/modern/sor4_crowd-brawl.jpg'),(400,225)),'Reference / Streets of Rage 4')],2,H/'contacts-and-refs-400x225.png')
grid([label(crop('light-release').resize((800,540)),'Light: blade-aligned wedge / negative gaps / metal shards'),label(crop('heavy-od').resize((800,540)),'Heavy: asymmetric fan / layered core / fragments')],1,H/'contacts2x.png')
grid([label(crop('heavy-od',ms,w=340,h=270),f'Heavy +{ms}ms') for ms in [0,33,66,99]],4,H/'heavy-strip.png')
if (H/'reverse-release2/core-probe.json').exists():
 grid([label(crop('light-release').resize((800,540)),'Light: projected blade travel right/down'),label(crop('reverse-release2').resize((800,540)),'Light: projected blade travel left/down')],2,H/'swing-direction-panel.png')
# Same-pose body light/fill pair. Exposure and scene pose are unchanged.
light=data('light-release');pos=light['bodyScreen'];x,y=map(round,pos)
a=load(H/'light-release/contact-light-on.png');b=load(H/'light-release/contact-light-off.png')
box=(x-45,y-70,x+45,y+24);ac=a.crop(box);bc=b.crop(box)
diff=ImageEnhance.Brightness(ImageChops.difference(ac,bc)).enhance(4)
grid([label(bc.resize((270,282)),'Off'),label(ac.resize((270,282)),'Warm fill + pop light'),label(diff.resize((270,282)),'Difference x4')],3,H/'contact-light-pair.png')
A=np.array(a).astype(float);B=np.array(b).astype(float);weights=np.array([.2126,.7152,.0722]);metrics={}
for name,p in [('victimTorso',light['bodyScreen']),('weaponArm',light['armScreen'])]:
 cx,cy=map(round,p);region=(slice(cy-38,cy-8),slice(cx-22,cx+22));delta=(A[region]-B[region])@weights
 metrics[name]={'screen':p,'roiOffset':[-22,-38,44,30],'meanLumaLift':float(delta.mean()),'pixelsLiftedBy10':int((delta>10).sum())}
# Explicit display coverage proxy at game distance; includes the travelling shards.
areas=[]
for name,folder in [('r12',ROOT/'progress/shots/vfx-hitfx/r12/light-final2'),('r13',H/'light-release')]:
 d=json.loads((folder/'core-probe.json').read_text());p=d['probes'][d.get('selectedIndex',0)]['screen'];cx,cy=[round(v/4) for v in p]
 a=np.array(load(folder/'contact-000ms.png').resize((400,225),Image.Resampling.LANCZOS)).astype(int)
 m=(a[:,:,0]>205)&(a[:,:,1]>125)&((a[:,:,2]<a[:,:,1]*.85)|((a[:,:,0]>238)&(a[:,:,1]>220)))
 roi=m[max(0,cy-16):cy+17,cx-27:cx+40];areas.append({'round':name,'brightWarmPixels':int(roi.sum()),'ROI':[cx-27,cy-16,67,33]})
metrics['lightArea']={'criterion':'400x225 display, fixed 67x33 contact ROI. R>205,G>125 and B<G*.85 OR R>238,G>220. Includes paint, shards and any warm body response; coverage proxy rather than isolated sprite matte.','frames':areas,'ratio':areas[1]['brightWarmPixels']/areas[0]['brightWarmPixels']}
(H/'contact-metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
# Kick: no announcement over the contact.
kick=load(H/'kick/kick-contact-000ms.png');kick.save(H/'kick-native.png')
grid([label(load(H/'kick'/f'kick-contact-{ms:03}ms.png').crop((950,280,1470,720)).resize((350,220)),f'Kick +{ms}ms') for ms in [0,33,66,99]],4,H/'kick-strip.png')
# Fireball first contact and its attached aftermath, actual event timing.
grid([label(load(F/'fireball'/f'impact-{ms:03}ms.png').crop((960,300,1400,720)),f'Projectile contact +{ms}ms') for ms in [0,33,66,99,165,264,330,429]],4,F/'fireball/strip.png')
# Inspect both clipcheck flags with neighbours; no impact asset disappears.
grid([label(load(F/'fireball'/f'impact-{ms:03}ms.png').resize((533,300)),f'fireball {ms}ms') for ms in [0,33,66,99]],2,F/'fireball/spike-inspection.png')
# Board gap -> changed panels are comparisons, never a blind/parity claim.
old=ROOT/'progress/qa/board-c2/vfx-hitfx-r12/crops2x-contact.png'
grid([label(ImageOps.fit(load(old),(640,360)),'Board: shared orange star silhouette'),label(ImageOps.fit(load(H/'contacts2x.png'),(640,360)),'Changed: wedge / asymmetric heavy with travelling metal'),label(load(H/'contact-light-pair.png').resize((640,223)),'Changed: contact lift on torso'),label(load(H/'heavy-strip.png').resize((640,127)),'Changed: breakup; short dusty floor response')],2,H/'board-gap-fixed.png')
old=ROOT/'progress/qa/board-c2/shared-fire-library-r6/seat-opus/camp_crops.png'
grid([label(ImageOps.fit(load(old),(640,360)),'Board: narrow tongues + stamped smoke glyphs'),label(load(F/'camp-final/crop2x.png').resize((264,360)),'Changed: separated roots + irregular smoke'),label(load(F/'fire-final/fire-strip.png').resize((640,196)),'Changed: burning through264ms; dark soot through429ms'),label(load(F/'fireball/strip.png').resize((640,305)),'Changed: fireball ignites at actual contact')],2,F/'board-gap-fixed.png')
# Authored four-pose contact frames, original paths only; no reference-image pixels shipped.
atlas=Image.open(ROOT/'public/assets/vfx/fire-hit-atlas.png');canvas=Image.new('RGBA',(1024,512),(27,25,23,255))
for row in range(2):
 for frame in range(4):canvas.alpha_composite(atlas.crop((frame*256,(row+4)*256,(frame+1)*256,(row+5)*256)),(frame*256,row*256))
canvas.convert('RGB').save(H/'authored-four-poses.png')
print(json.dumps(metrics,indent=2))
