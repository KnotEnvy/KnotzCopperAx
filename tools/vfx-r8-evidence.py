"""Compose C2 hitfx14/fire8 evidence from captured game pixels; requires numpy/Pillow."""
from pathlib import Path
from PIL import Image,ImageDraw
import json,math,hashlib
import numpy as np
H=Path('progress/shots/vfx-hitfx/r14');F=Path('progress/shots/shared-fire-library/r8')
def write(p,o):p.write_text(json.dumps(o,indent=2)+'\n')
def panel(paths,out,size=(400,225),cols=5,labels=None):
    paths=[Path(p) for p in paths]
    if not all(p.exists() for p in paths):return
    rows=math.ceil(len(paths)/cols);w,h=size
    im=Image.new('RGB',(w*cols,(h+22)*rows),(18,18,20));d=ImageDraw.Draw(im)
    for i,p in enumerate(paths):
        tile=Image.open(p).convert('RGB').resize(size,Image.Resampling.LANCZOS)
        px=(i%cols)*w;py=(i//cols)*(h+22);im.paste(tile,(px,py))
        d.text((px+6,py+h+4),labels[i] if labels else p.stem,fill=(230,224,211))
    im.save(out)
def crop(p,out,rect,scale=2):
    if p.exists():Image.open(p).crop(rect).resize(((rect[2]-rect[0])*scale,(rect[3]-rect[1])*scale),Image.Resampling.NEAREST).save(out)
contacts=[]
for name in ['light-fwd','light-rev','heavy-fwd','heavy-rev']:
    p=H/name/'core-probe.json'
    if p.exists():
        r=json.loads(p.read_text());contacts.append(dict(name=name,hits=r['hits'],probes=r['probes'],hdr=r['hdr']))
        panel([H/name/f'contact-{ms:03d}ms.png' for ms in [0,33,66,99,132]],H/f'{name}-400x225.png')
panel([H/name/f'contact-{ms:03d}ms.png' for name in ['light-fwd','light-rev','heavy-fwd','heavy-rev'] for ms in [0,33,66,99,132]],H/'directions-400x225.png')
for name in ['light-fwd','heavy-fwd']:
    crop(H/name/'contact-000ms.png',H/f'{name}-2x.png',(930,400,1150,620))
panel([H/'kick-final'/f'kick-contact-{ms:03d}ms.png' for ms in [0,33,66,99,132]],H/'kick-400x225.png')
write(H/'contacts-summary.json',contacts)
for name,prefix,count in [('fire-game','fire',17),('fireball','impact',16)]:
    root=F/name
    if (root/f'{prefix}-000ms.png').exists():
        panel([root/f'{prefix}-{i*33:03d}ms.png' for i in range(count)],F/f'{name}-400x225.png',cols=4)
        # Constant camera crop; preserve the original sample pixels at integer 2x.
        rect=(140,410,420,690) if name=='fire-game' else (450,240,1180,800)
        if name=='fireball':
            samples=json.loads((root/'attachment.json').read_text());rect=(1040,340,1450,760)
            errors=[]
            for r in samples:
                for j,o in enumerate(r['flames']):
                    start=next(v for v in samples[0]['flames'] if v['phase']==o['phase'] and v['life']==o['life'])
                    errors.append(max(abs((o['pos'][axis]-start['pos'][axis])-(r['chest'][axis]-samples[0]['chest'][axis])) for axis in range(3)))
            write(F/'attachment-summary.json',dict(maxFlameChestDisplacementError=max(errors),chestTravelMetres=math.dist(samples[0]['chest'],samples[10]['chest']),remainingFlames=[dict(ms=r['ms'],count=len(r['flames'])) for r in samples]))
        crop(root/f'{prefix}-000ms.png',F/f'{name}-0ms-2x.png',rect)
        crop(root/f'{prefix}-264ms.png',F/f'{name}-264ms-2x.png',rect)
# Isolated combustion pixel counts (same pose/background, only the transient FirePool hidden).
root=F/'fire-game';counts=[]
for i in range(17):
    on=root/f'fire-{i*33:03d}ms.png';off=root/f'off-{i*33:03d}ms.png'
    if not on.exists() or not off.exists():continue
    a=np.asarray(Image.open(on).convert('RGB')).astype(float);b=np.asarray(Image.open(off).convert('RGB')).astype(float)
    roi=(slice(390,720),slice(110,450));a=a[roi];b=b[roi]
    ya=a@np.array([.2126,.7152,.0722]);yb=b@np.array([.2126,.7152,.0722])
    warm=(a[:,:,0]>160)&(a[:,:,1]>65)&(a[:,:,0]>a[:,:,2]*1.2)&(ya-yb>10)
    counts.append(dict(ms=i*33,brightWarmLiftPixels=int(warm.sum()),sootDarkeningPixels=int((yb-ya>8).sum())))
write(F/'pixel-counts.json',dict(roi=[110,390,450,720],thresholds='R>160 G>65 R>1.2B and luma(on-off)>10; soot luma(off-on)>8',samples=counts))
# Temporal outline variation in the authored eight-frame combustion row.
atlas=np.asarray(Image.open('public/assets/vfx/fire-hit-atlas.png'));masks=[atlas[256:512,i*256:(i+1)*256,3]>96 for i in range(8)]
write(F/'atlas-motion.json',dict(adjacentOutlineIoU=[float((a&b).sum()/max(1,(a|b).sum())) for a,b in zip(masks,masks[1:])],alphaAreas=[int(a.sum()) for a in masks]))
# Hash the exact final source/art used by this handoff, shared renderer edits scoped in notes.
files=['src/vfx/fireLib.js','src/vfx/HitFlash.js','src/vfx/effects/hit_spark.js','src/vfx/effects/_mount_fireball.js','src/vfx/author_atlas.py','src/levels/stages/bonus/campfire.js','public/assets/vfx/fire-hit-atlas.png']
write(F/'source-hashes.json',{p:hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in files})
print('composed available hit/fire evidence')

# Roof and camp inspection crops use native captured pixels, with no generative processing.
crop(F/'roof-final/roof-game.png',F/'roof-2x.png',(700,0,1120,370))
crop(F/'camp-final/camp-game.png',F/'camp-2x.png',(650,280,960,570))
