"""Offline painted flipbooks; original math/paths, never reference-image pixels.
Run from repo root: python3 src/vfx/author_atlas.py
Eight 256px frames per row, smooth padded cell gutters; --check verifies every 2px border. Seeded and reproducible.
"""
from pathlib import Path
import math
import json
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SIZE = 256
OUT = Path(__file__).resolve().parents[2] / 'public/assets/vfx'
y, x = np.mgrid[0:SIZE, 0:SIZE] / (SIZE - 1)
x = x * 2 - 1
y = 1 - y

def rgba(col, alpha):
    a = np.clip(alpha, 0, 1)
    a[:4] = a[-4:] = 0
    a[:, :4] = a[:, -4:] = 0
    return Image.fromarray(np.uint8(np.dstack([np.clip(col, 0, 1), a]) * 255))

def flame(t, burst=False):
    # Separated fuel roots, rather than a continuous luminous ellipse underneath the licks.
    phase=t*math.tau
    noise=turbulence(x,y,t*2)
    field=np.zeros_like(x);heat=np.zeros_like(x)
    for j in range(4):
        base_x=-.58+j*.37
        height=.30+.55*(.5+.5*math.sin(phase+j*2.4))
        width=.235+.035*math.sin(phase*2+j*3)
        yy=y/height
        bend=base_x+.19*np.sin(yy*6-phase+j)*yy+.15*np.sin(phase+j*3)*yy*yy
        w=width*np.maximum(0,1-yy)**1.18+.003
        d=np.abs(x-bend)/w
        torn=.12*noise+.08*np.sin(x*39+y*43-phase*3)
        body=(1-smooth(.83,1.02,d+torn))*(1-smooth(.86,1.02,yy))*smooth(.035,.10,y)
        lick=np.clip(.96-.74*yy-.32*d+.12*np.sin(y*35+x*21-phase*4)+.13*noise,0,1)
        # Narrow sinuous hot filaments inside each tongue, with cool breaks between them.
        filament=np.exp(-((x-bend+.025*np.sin(yy*23-phase*3+j))/(w*.17+.004))**2)
        lick=np.clip(lick+filament*.39*(1-yy),0,1)
        # Deep curved channels remain visible even when several ambient layers overlap.
        channel=np.exp(-((x-bend-w*.36*np.sin(yy*8+j))/(w*.25+.003))**2)
        body*=1-channel*smooth(.13,.33,yy)*.88
        field=np.maximum(field*(1-channel*smooth(.20,.40,yy)*.26),body)
        heat=np.maximum(heat,lick*body)
        # A detached curling tip changes position, brightness and silhouette every loop cell.
        cx=base_x+.18*math.sin(phase+j);cy=height+.07
        tip=np.sqrt(((x-cx)/.05)**2+((y-cy)/.055)**2)
        fleck=(1-smooth(.55,1.05,tip))*max(0,math.sin(phase+j*2))
        field=np.maximum(field,fleck);heat=np.maximum(heat,fleck*.55)
    field*=smooth(.025,.09,y+.012*np.sin(x*19+phase))
    # Fuel breaks stay dark even when the consumer overlaps several phased cards.
    roots=np.maximum.reduce([np.exp(-((x-c)/.13)**4) for c in [-.58,-.21,.16,.53]])
    field*=1-(1-roots)*(1-smooth(.10,.31,y))
    stops=np.array([[.26,.009,.002],[.67,.052,.003],[1,.24,.006],[1,.57,.025],[1,.86,.24],[1,.995,.88]])
    value=np.clip(heat*5,0,4.999);i=value.astype(int);f=(value-i)[...,None]
    return rgba(stops[i]*(1-f)+stops[i+1]*f,field)

def smooth(a, b, v):
    q = np.clip((v-a)/(b-a), 0, 1)
    return q*q*(3-2*q)


# Original smooth random fields avoid a visible crossed-sine/grid pattern.
_NOISE=[]
_rng=np.random.default_rng(7621)
for resolution in [7,17,39]:
    grid=Image.fromarray(_rng.random((resolution,resolution)).astype(np.float32)*2-1)
    _NOISE.append(np.asarray(grid.resize((SIZE,SIZE),Image.Resampling.BICUBIC)))


def turbulence(u, v, t):
    return sum(weight*np.roll(field,(int(t*13),int(-t*19)),axis=(0,1))
               for field,weight in zip(_NOISE,[.55,.30,.15]))


def smoke(t):
    # Advected unequal density masses. No angular/circular glyphs or fixed curl centres.
    phase=t*math.tau
    n=turbulence(x,y,t*.45)
    fine=turbulence(x,y,t*.82+1.7)
    spine=.075*np.sin(y*6.3-phase)+.035*np.sin(y*12.1+phase*2)
    width=.115+.25*y
    warp=x*.5-spine+n*.095
    d=np.abs(warp)/width
    edge=1-smooth(.60,1.14,d+n*.40+fine*.18)
    envelope=smooth(.025,.16,y)*(1-smooth(.65,.98,y))
    density=np.clip(.88+n*.52+fine*.25,0,1)
    light=np.clip(.24+n*.14+fine*.065+warp*.14,.095,.44)
    col=np.dstack([light*1.05,light*.97,light*.92])
    return rgba(col,edge*envelope*density*(1-.34*y))


def fireball(t):
    # Four offset fuel roots with their own near-white ignition. Empty cuts survive
    # the broad roots; later frames tear/cool the tips instead of erasing the whole body.
    n=turbulence(x,y,t*.5)
    field=np.zeros_like(x);heat=np.zeros_like(x)
    for j,(root,height,width,bend,base) in enumerate([
            (-.30,.65,.145,.07,.10),(-.035,.73,.165,.10,.22),
            (.255,.59,.15,.06,.07),(.36,.44,.08,-.07,.29)]):
        base+=t*(.065+.012*j)
        yy=(y-base)/(height*(1-.16*t))
        along=np.clip(yy,0,1)
        spine=root+bend*along+.038*np.sin(along*11-t*6+j*2.3)*along
        w=width*np.maximum(0,1-along)**.86
        w*=1+.16*np.sin(along*31+t*5+j)+.16*n
        d=np.abs(x*.5-spine)/np.maximum(w,.003)
        torn=.11*np.sin(y*67+x*39+j+t*6)+.18*n
        body=(1-smooth(.77,1.04,d+torn))*smooth(-.025,.045,yy+n*.045+.018*np.sin(x*51+j))*(1-smooth(.87,1.,yy))
        rip=np.exp(-((x*.5-spine-.035*np.sin(along*14+t*5+j))/(.005+.010*(1-along)))**2)
        body*=1-rip*smooth(.37,.72,along)*.72
        body*=1-smooth(.67+.025*j,1.05,t)
        field=np.maximum(field,body)
        h=np.clip(1.14-.45*along-.37*t-.75*d+.07*n,0,1)
        heat=np.maximum(heat,h*body)
    stops=np.array([[.22,.004,.001],[.64,.018,.002],[1,.13,.004],
                    [1,.43,.012],[1,.83,.21],[1,.995,.92]])
    value=np.clip(heat*5,0,4.999);i=value.astype(int);f=(value-i)[...,None]
    return rgba(stops[i]*(1-f)+stops[i+1]*f,field)

def knockdown(t):
    u=x*.5;v=y
    n=turbulence(u,v,t*2)
    alpha=np.zeros_like(x);col=np.zeros((*x.shape,3))
    # Ground-hugging ochre rolls; no descending lance or vertical energy column.
    for j in range(11):
        cx=(j-5)*(.055+.019*t)
        cy=.29+.08*math.sin(j*2.7)+.055*math.sin(t*math.pi)
        rad=.08+.035*t
        d=np.sqrt(((u-cx)/rad)**2+((v-cy)/(rad*.78))**2)+.12*n
        a=(1-smooth(.65,1.1,d))*(.85-.5*t)
        light=np.clip(.42+.12*(v-cy)/rad-.1*d+.09*n,.18,.62)
        tint=np.dstack([light*1.23,light*.88,light*.55])
        col=col*(1-a[...,None])+tint*a[...,None]
        alpha+=a*(1-alpha)
    return rgba(col/np.maximum(alpha[...,None],.001),alpha)

def storm(t):
    s=SIZE*3
    # Regrow a jagged discharge tree each cell, never a closed zigzag emblem.
    rng=np.random.default_rng(511+int(t*7))
    trunk=[(.50+float(rng.uniform(-.10,.10)),.09)]
    for i in range(1,15):
        trunk.append((.49+float(rng.uniform(-.095,.095))*(1-i/22),.09+i*.048))
    paths=[trunk]
    for j in [3,5,7,9,11]:
        a,b=trunk[j];side=-1 if j%4==1 else 1
        branch=[(a,b)]
        for k in range(1,5):
            branch.append((a+side*k*.038+float(rng.uniform(-.025,.025)),b-k*.026+float(rng.uniform(-.025,.025))))
        paths.append(branch)
        paths.append([branch[2],(branch[2][0]-side*.035,branch[2][1]-.065),(branch[2][0]-side*.02,branch[2][1]-.10)])
    im=Image.new('RGBA',(s,s))
    fade=(.78+.22*math.cos(t*math.tau*3))*max(0,1-t)**.55
    for width,blur,color,opacity in [(38,11,(16,50,255),.38),(19,4,(28,107,255),.66),
                                    (9,1,(70,169,255),.96),(5,0,(225,249,255),1),(2,0,(255,255,255),1)]:
        layer=Image.new('RGBA',(s,s));d=ImageDraw.Draw(layer)
        for j,points in enumerate(paths):
            pts=[(int(a*s),int(b*s)) for a,b in points]
            w=max(1,int(width*(1 if j==0 else .40)*(1-t*.5)))
            d.line(pts,fill=(*color,int(255*opacity*fade)),width=w,joint='curve')
        if blur:layer=layer.filter(ImageFilter.GaussianBlur(blur))
        im=Image.alpha_composite(im,layer)
    # Short contact flash rooted where the trunk ends, fading before the bolt.
    u=x*.5;v=1-y
    radius=np.sqrt(((u+.01)/.085)**2+((v-.74)/.07)**2)
    flash=(1-smooth(.1,1.1,radius))*(1-smooth(.02,.44,t))
    flash_im=rgba(np.ones((*x.shape,3))*[.80,.94,1],flash)
    return Image.alpha_composite(im.resize((SIZE,SIZE),Image.Resampling.LANCZOS),flash_im)


def directional_impact(kind,t):
    # Four authored poses, +X is blade travel. Layered metal streaks, never a radial card.
    frame=min(3,round(t*3)); heavy=kind=='blunt'
    s=768; im=Image.new('RGBA',(s,s))
    def polygon(points,color):
        layer=Image.new('RGBA',(s,s));draw=ImageDraw.Draw(layer)
        draw.polygon([(int((u+.5)*s),int((.5-v)*s)) for u,v in points],fill=color)
        return layer
    # Every bolt has its own elbow, missing flank and unequal split. The compact root
    # at the contact breaks open at pose 2; no opaque/dark disc can remain there.
    bolts=([(.10,.44,.105),(.68,.43,.115),(-.43,.38,.082),(1.48,.31,.070),(-1.02,.26,.058),(.29,.47,.043)]
           if heavy else [(0,.46,.15),(.48,.38,.085),(-.45,.36,.072)])
    for j,(angle,length,width) in enumerate(bolts):
        travel=[0,.035,.135,.26][frame]*(1+j*.07)
        length*= [1,.93,.62,.26][frame]
        width*= [1,.86,.60,.28][frame]
        ca,sa=math.cos(angle),math.sin(angle)
        start=-.055 if frame<2 else .04
        # Distinct back edge, fork notch, forward point and torn trailing edge.
        outline=[(start,-width*.55),(.02,-width),(.12,-width*.34),
                 (length*.69,-width*.28),(length,0),(length*.53,width*.34),
                 (length*.65,width*.85),(.11,width*.52),(-.065,width*.34)]
        for scale,color in [(1.24,(116,16,5,235)),(1,(247,63,5,255)),
                            (.65,(255,166,25,255)),(.32,(255,244,175,255))]:
            pts=[((u+travel)*ca-v*scale*sa,(u+travel)*sa+v*scale*ca) for u,v in outline]
            im=Image.alpha_composite(im,polygon(pts,color))
    if frame<2:
        # Slender asymmetric ivory wedge, with a fork instead of an isotropic point.
        h=.10 if heavy else .052;length=.24 if heavy else .30
        pts=[(-.10,-h*.28),(-.038,-h),(.04,-h*.22),(length,-h*.09),
             (.10,h*.18),(.15,h*.60),(.02,h*.40),(-.055,h*.72)]
        im=Image.alpha_composite(im,polygon(pts,(255,255,247,255 if frame==0 else 215)))
    # Separately travelling hot metal splinters: small thin diamonds, no rock silhouettes.
    for j,(a,radius) in enumerate([(.43,.26),(-.52,.24),(.98,.19)] if heavy else [(.42,.24),(-.54,.22),(.12,.36)]):
        radius+=frame*.045
        cx=math.cos(a)*radius;cy=math.sin(a)*radius
        length=(.057 if heavy else .042)*(1-frame*.15);w=.009 if heavy else .006
        pts=[(cx-length,cy-w*.3),(cx,cy-w),(cx+length,cy+w*.2),(cx-.009,cy+w)]
        im=Image.alpha_composite(im,polygon(pts,(255,174,41,255)))
        pts=[(cx-length*.45,cy),(cx+length*.60,cy),(cx,cy+w*.42)]
        im=Image.alpha_composite(im,polygon(pts,(255,255,219,255)))
    # Short counter-flow at the cut origin makes the direction unambiguous.
    if frame<2:
        pts=[(-.24,-.025),(-.025,-.013),(.02,0),(-.07,.012)]
        im=Image.alpha_composite(im,polygon(pts,(255,198,70,230)))
    return im.resize((SIZE,SIZE),Image.Resampling.LANCZOS)


def painted(kind,t):
    if kind == 'knockdown': return knockdown(t)
    if kind == 'storm': return storm(t)
    s=768; im=Image.new('RGBA',(s,s)); d=ImageDraw.Draw(im)
    def poly(points,c): d.polygon([(int(a*s),int(b*s)) for a,b in points],fill=c)
    rng=np.random.default_rng(982)
    fade=int(255*(1-max(0,t-.35)/.8))
    if kind in ('slash','blunt'):
        return directional_impact(kind,t)
    # Deliberately unequal tapered impact streaks, separate from central shape.
    for j in range(30 if kind=='embers' else 11):
        a=float(rng.random())*math.tau
        r=.10+float(rng.random())*.31+t*.10
        cx=.5+math.cos(a)*r; cy=.5+math.sin(a)*r
        l=(.008+float(rng.random())*(.018 if kind=='embers' else .09))*(1-t*.7)
        if kind=='embers': cy=.08+((cy+t*.37+j*.031)%.83)
        w=.002+float(rng.random())*(.003 if kind=='embers' else .007)
        poly([(cx-math.cos(a)*l,cy-math.sin(a)*l),(cx-math.sin(a)*w,cy+math.cos(a)*w),(cx+math.cos(a)*l,cy+math.sin(a)*l),(cx+math.sin(a)*w,cy-math.cos(a)*w)],((106,213,255,fade) if kind=='storm' else (255,198,71,fade)))
    return im.resize((SIZE,SIZE),Image.Resampling.LANCZOS)

KINDS=['flame','fireBurst','smoke','embers','slash','blunt','knockdown','storm']


def pack_cell(im):
    pixels=np.asarray(im).copy()
    # Smooth padding for every row; no step from opaque art to a cleared gutter.
    yy,xx=np.mgrid[:SIZE,:SIZE]
    border=np.minimum.reduce([xx,yy,SIZE-1-xx,SIZE-1-yy])
    pixels[...,3]=(pixels[...,3]*smooth(8,18,border)).astype(np.uint8)
    # RGB bleed into transparent texels protects linear interpolation at the edge.
    rgb=pixels[...,:3].astype(float);known=pixels[...,3]>0
    for _ in range(6):
        total=np.zeros_like(rgb);count=np.zeros_like(border,dtype=float)
        for axis,shift in [(0,1),(0,-1),(1,1),(1,-1)]:
            k=np.roll(known,shift,axis=axis)
            total+=np.roll(rgb,shift,axis=axis)*k[...,None];count+=k
        fill=(~known)&(count>0)
        rgb[fill]=total[fill]/count[fill,None];known|=fill
    pixels[...,:3]=rgb.astype(np.uint8)
    return Image.fromarray(pixels)


def check_atlas(file):
    atlas=np.asarray(Image.open(file).convert('RGBA'))
    assert atlas.shape==(SIZE*8,SIZE*8,4)
    cells=[]
    for row,kind in enumerate(KINDS):
        for frame in range(8):
            a=atlas[row*SIZE:(row+1)*SIZE,frame*SIZE:(frame+1)*SIZE,3]
            maximum=int(max(a[:2].max(),a[-2:].max(),a[:,:2].max(),a[:,-2:].max()))
            assert maximum==0,(kind,frame,maximum)
            yy,xx=np.where(a>0)
            cells.append(dict(clip=kind,frame=frame,border2pxMaxAlpha=maximum,
                              transparentPaddingPx=int(min(xx.min(),yy.min(),SIZE-1-xx.max(),SIZE-1-yy.max())) if len(xx) else SIZE))
    result=dict(passAll=True,cells=len(cells),maxBorderAlpha=max(c['border2pxMaxAlpha'] for c in cells),
                minimumPaddingPx=min(c['transparentPaddingPx'] for c in cells),frames=cells)
    (OUT/'fire-hit-atlas.check.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k!='frames'}))


def main():
    OUT.mkdir(parents=True,exist_ok=True)
    file=OUT/'fire-hit-atlas.png'
    if '--check' in sys.argv:
        check_atlas(file);return
    atlas=Image.new('RGBA',(SIZE*8,SIZE*8))
    for row,kind in enumerate(KINDS):
        for frame in range(8):
            t=frame/8 if row==0 else min(frame,3)/3 if row in (4,5) else frame/7
            im=flame(t) if row==0 else fireball(t) if row==1 else smoke(t) if row==2 else painted(kind,t)
            atlas.paste(pack_cell(im),(frame*SIZE,row*SIZE))
    atlas.save(file,optimize=True)
    check_atlas(file)
    print(file)

if __name__=='__main__': main()
