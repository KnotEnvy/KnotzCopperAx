"""Game-pixel evidence for hitfx15/fire9. No reference art is composited into game captures."""
from pathlib import Path
from PIL import Image,ImageDraw
import json,math,hashlib,numpy as np
H=Path('progress/shots/vfx-hitfx/r15');F=Path('progress/shots/shared-fire-library/r9')
def write(p,o):p.write_text(json.dumps(o,indent=2)+'\n')
def panel(paths,out,size=(400,225),cols=5,labels=None):
 if not all(Path(p).exists() for p in paths):return
 w,h=size;im=Image.new('RGB',(w*cols,(h+22)*math.ceil(len(paths)/cols)),(18,18,20));d=ImageDraw.Draw(im)
 for i,p in enumerate(paths):
  tile=Image.open(p).convert('RGB').resize(size,Image.Resampling.LANCZOS);px=(i%cols)*w;py=(i//cols)*(h+22);im.paste(tile,(px,py));d.text((px+6,py+h+4),labels[i] if labels else Path(p).stem,fill=(230,224,211))
 im.save(out)
def crop(p,out,rect,scale=2):
 if Path(p).exists():Image.open(p).crop(rect).resize(((rect[2]-rect[0])*scale,(rect[3]-rect[1])*scale),Image.Resampling.NEAREST).save(out)
names=['light-final-fwd','light-rev','heavy-final-fwd','heavy-rev'];contacts=[]
for name in names:
 p=H/name/'core-probe.json'
 if not p.exists():continue
 r=json.loads(p.read_text());contacts.append(dict(name=name,hits=r['hits'],probes=r['probes'],hdr=r['hdr']))
 panel([H/name/f'contact-{ms:03d}ms.png' for ms in [0,33,66,99,132]],H/f'{name}-400x225.png')
 q=r['probes'][0]['screen'];rect=(int(q[0])-85,int(q[1])-100,int(q[0])+85,int(q[1])+100)
 crop(H/name/'contact-000ms.png',H/f'{name}-2x.png',rect)
panel([H/name/f'contact-{ms:03d}ms.png' for name in names for ms in [0,33,66,99,132]],H/'directions-400x225.png')
panel([H/'kick-final'/f'kick-contact-{ms:03d}ms.png' for ms in [0,33,66,99,132]],H/'kick-400x225.png')
write(H/'contacts-summary.json',contacts)
panel([Path('progress/shots/vfx-hitfx/r14/light-fwd/contact-000ms.png'),H/'light-final-fwd/contact-000ms.png',Path('progress/shots/vfx-hitfx/r14/heavy-fwd/contact-000ms.png'),H/'heavy-final-fwd/contact-000ms.png'],H/'r14-vs-r15-400x225.png',cols=2,labels=['r14 Light','r15 Light','r14 Heavy','r15 Heavy'])
for name,prefix in [('fire-game','fire'),('fireball','impact')]:
 root=F/name
 panel([root/f'{prefix}-{i*33:03d}ms.png' for i in range(19)],F/f'{name}-400x225.png',cols=4)
 rect=(180,380,570,700) if name=='fire-game' else (1000,260,1550,800)
 panel_paths=[]
 for ms in [0,99,198,297,396,495]:
  out=F/f'{name}-{ms}ms-2x.png';crop(root/f'{prefix}-{ms:03d}ms.png',out,rect);panel_paths.append(out)
 panel(panel_paths,F/f'{name}-crops.png',size=((rect[2]-rect[0])*2,(rect[3]-rect[1])*2),cols=3)
 if name=='fire-game' and (root/'fire-timing.json').exists():
  samples=json.loads((root/'fire-timing.json').read_text());errors=[]
  for r in samples:
   for o in r['items']:
    if not o['attached'] or o['age']<0:continue
    start=next(v for v in samples[0]['items'] if v['row']==o['row'] and v['attached'])
    errors.append(max(abs((o['pos'][axis]-start['pos'][axis])-(r['chest'][axis]-samples[0]['chest'][axis])) for axis in range(3)))
  write(F/'fire-hit-attachment.json',dict(bodyTravelMetres=math.dist(samples[0]['foe'],samples[-1]['foe']),maxLayerChestDisplacementError=max(errors),layers=['mantle','soot','ember residue']))
 if name=='fireball' and (root/'attachment.json').exists():
  samples=json.loads((root/'attachment.json').read_text());errors=[]
  for r in samples:
   for o in r['layers']:
    if o['age']<0:continue
    start=next(v for v in samples[0]['layers'] if v['row']==o['row'])
    errors.append(max(abs((o['pos'][axis]-start['pos'][axis])-(r['chest'][axis]-samples[0]['chest'][axis])) for axis in range(3)))
  write(F/'fireball-attachment.json',dict(bodyTravelMetres=math.dist(samples[0]['target'],samples[-1]['target']),maxLayerChestDisplacementError=max(errors),layers=['mantle','soot','ember residue']))
root=F/'fire-game';counts=[]
for i in range(19):
 on=root/f'fire-{i*33:03d}ms.png';off=root/f'off-{i*33:03d}ms.png'
 if not on.exists() or not off.exists():continue
 a=np.asarray(Image.open(on).convert('RGB')).astype(float)[360:740,140:630];b=np.asarray(Image.open(off).convert('RGB')).astype(float)[360:740,140:630]
 ya=a@np.array([.2126,.7152,.0722]);yb=b@np.array([.2126,.7152,.0722]);warm=(a[:,:,0]>160)&(a[:,:,1]>65)&(a[:,:,0]>a[:,:,2]*1.2)&(ya-yb>10)
 counts.append(dict(ms=i*33,brightWarmLiftPixels=int(warm.sum()),sootDarkeningPixels=int((yb-ya>8).sum())))
write(F/'pixel-counts.json',dict(roi=[140,360,630,740],thresholds='R>160 G>65 R>1.2B; luma(on-off)>10; soot luma(off-on)>8',samples=counts))
atlas=np.asarray(Image.open('public/assets/vfx/fire-hit-atlas.png'));masks=[atlas[256:512,i*256:(i+1)*256,3]>48 for i in range(8)]
write(F/'atlas-motion.json',dict(adjacentOutlineIoU=[float((a&b).sum()/max(1,(a|b).sum())) for a,b in zip(masks,masks[1:])],alphaAreas=[int(a.sum()) for a in masks]))
crop(F/'roof-final/roof-game.png',F/'roof-2x.png',(690,0,1130,370));crop(F/'camp-final/camp-game.png',F/'camp-2x.png',(650,280,960,570))
files=['src/vfx/fireLib.js','src/vfx/Debris.js','src/vfx/effects/hit_spark.js','src/vfx/author_atlas.py','public/assets/vfx/fire-hit-atlas.png']
write(F/'source-hashes.json',{p:hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in files})
print('Composed available hitfx15/fire9 evidence')
# Matched-pose local material fill at +33ms; the atlas and lights stay identical.
fills=[]
for name in names:
 root=H/name;on=root/'victim-fill-on-033ms.png';off=root/'victim-fill-off-033ms.png'
 if not on.exists() or not off.exists():continue
 r=json.loads((root/'core-probe.json').read_text());b=r['probes'][0]['bounds']
 a=np.asarray(Image.open(on).convert('RGB')).astype(float);z=np.asarray(Image.open(off).convert('RGB')).astype(float)
 rect=(int(b['minX']),int(b['minY']),int(b['maxX'])+1,int(b['maxY'])+1)
 delta=((a-z)@np.array([.2126,.7152,.0722]))[rect[1]:rect[3],rect[0]:rect[2]]
 fills.append(dict(name=name,roi=rect,meanLumaLift=float(delta.mean()),maxLumaLift=float(delta.max()),pixelsLiftOver8=int((delta>8).sum())))
write(H/'victim-fill-33ms.json',fills)
