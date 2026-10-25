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
    for j,(base_x,base_height,base_width) in enumerate([(-.43,.70,.32),(.03,.90,.40),(.46,.63,.29)]):
        height=base_height*(.82+.16*math.sin(phase+j*2.4))
        width=base_width*(1+.13*math.sin(phase*2+j*3))
        yy=y/height
        bend=base_x+.19*np.sin(yy*6-phase+j)*yy+.15*np.sin(phase+j*3)*yy*yy
        w=width*np.maximum(0,1-yy)**1.18+.003
        d=np.abs(x-bend)/w
        torn=.12*noise+.08*np.sin(x*39+y*43-phase*3)
        body=(1-smooth(.83,1.02,d+torn))*(1-smooth(.86,1.02,yy))*smooth(.035,.10,y)
        lick=np.clip(1.30-.83*yy-.29*d+.12*np.sin(y*35+x*21-phase*4)+.13*noise,0,1)
        # Narrow sinuous hot filaments inside each tongue, with cool breaks between them.
        filament=np.exp(-((x-bend+.025*np.sin(yy*23-phase*3+j))/(w*.17+.004))**2)
        lick=np.clip(lick+filament*.43*(1-yy)+.10*np.sin(yy*51+x*35-phase*5)*noise,0,1)
        # Deep curved channels remain visible even when several ambient layers overlap.
        channel=np.exp(-((x-bend-w*.36*np.sin(yy*8+j))/(w*.25+.003))**2)
        body*=1-channel*smooth(.13,.33,yy)*.62
        field=np.maximum(field*(1-channel*smooth(.20,.40,yy)*.26),body)
        heat=np.maximum(heat,lick*body)
        # A detached curling tip changes position, brightness and silhouette every loop cell.
        cx=base_x+.18*math.sin(phase+j);cy=height+.07
        tip=np.sqrt(((x-cx)/.05)**2+((y-cy)/.055)**2)
        fleck=(1-smooth(.55,1.05,tip))*max(0,math.sin(phase+j*2))
        field=np.maximum(field,fleck);heat=np.maximum(heat,fleck*.55)
    field*=smooth(.025,.09,y+.012*np.sin(x*19+phase))
    # Fuel breaks stay dark even when the consumer overlaps several phased cards.
    roots=np.maximum.reduce([np.exp(-((x-c)/.13)**4) for c in [-.43,.03,.46]])
    field*=1-(1-roots)*(1-smooth(.10,.31,y))
    stops=np.array([[.26,.009,.002],[.67,.052,.003],[1,.24,.006],[1,.57,.025],[1,.86,.24],[1,.995,.88]])
    value=np.clip(heat*5,0,4.999)
    value=np.floor(value*1.5)/1.5+np.mod(value*1.5,1)*.14
    i=value.astype(int);f=(value-i)[...,None]
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
    # One connected, turbulent combustion mantle, rooted across the lower torso.
    # Lobes share an irregular fuel mass; only their tips split into little wisps.
    n=turbulence(x,y,t*3.8);fine=turbulence(x,y,t*6.1+1.7)
    burn=smooth(.32,1.,t)
    base=.19+.012*math.sin(t*24)
    root=np.sqrt(((x+.025)/(.61*(1-.66*burn)))**2+((y-base)/(.16*(1-.50*burn)))**2)
    field=(1-smooth(.62,1.06,root+n*.25))*(1-.87*burn)
    heat=np.clip(1.07-root*.49+n*.19-burn*.45,0,1)*field
    for j,(root_x,height,width) in enumerate([(-.36,.58,.28),(-.04,.77,.34),(.31,.61,.29)]):
        phase=t*15+j*2.13
        h=height*(.86+.14*math.sin(phase))*(1-.64*burn)
        yy=(y-base)/max(.08,h);v=np.clip(yy,0,1)
        spine=root_x*(1-.65*burn)+(.19*np.sin(v*6-phase)+.075*np.sin(v*14+phase))*v
        w=width*(1-.66*burn)*np.maximum(0,1-v)**.86+.005
        d=np.abs(x-spine+n*.044)/w
        contour=d+n*.34+fine*.18
        body=(1-smooth(.70,1.06,contour))*smooth(-.18,.045,yy)*(1-smooth(.86,1.03,yy))
        # Cool grooves above the connected root; curling cut-outs break the tips.
        groove=np.exp(-((x-spine-.07*np.sin(v*11-phase))/(.013+.026*v))**2)
        body*=1-groove*smooth(.32,.75,v)*.88
        body*=1-smooth(.54,.86,n*.5+.5+v*.16)*smooth(.45,.85,v)
        body*=1-.92*burn
        field=np.maximum(field,body)
        hval=np.clip(1.06-.69*v-.32*d+n*.20+fine*.12-.46*burn,0,1)
        heat=np.maximum(heat,hval*body)
    # As combustion subsides, small hot fragments stay at the body instead of a grey swap.
    for j in range(8):
        cx=.43*math.sin(j*2.4+t*8)*(1-.65*burn);cy=.18+(j%3)*.07+t*.035
        rad=.012+.008*math.sin(j*3+t*19)**2
        ember=(1-smooth(.3,1.,np.sqrt(((x-cx)/rad)**2+((y-cy)/(rad*1.9))**2)))*smooth(.44,.78,t)*(1-.65*smooth(.85,1.,t))
        field=np.maximum(field,ember);heat=np.maximum(heat,ember*.86)
    stops=np.array([[.28,.006,.001],[.78,.045,.002],[1,.25,.008],[1,.57,.035],[1,.87,.30],[1,.995,.93]])
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
    # A torso-sized transverse bite. Opening and release are separately painted;
    # the ivory kernel persists across the first TWO poses instead of a one-frame line.
    frame=min(3,round(t*3));heavy=kind=='blunt'
    s=768;im=Image.new('RGBA',(s,s))
    def polygon(points,color):
        layer=Image.new('RGBA',(s,s));d=ImageDraw.Draw(layer)
        d.polygon([(int((u+.5)*s),int((.5-v)*s)) for u,v in points],fill=color)
        return layer
    angles=[-.98,-.42,.14,.73,1.34,2.10,2.77,3.73,4.62] if heavy else [-1.12,-.38,.43,1.34,2.42,3.67]
    lengths=[.40,.36,.46,.35,.42,.32,.39,.29,.34] if heavy else [.36,.43,.31,.40,.28,.33]
    for j,(a,length) in enumerate(zip(angles,lengths)):
        ca,sa=math.cos(a),math.sin(a)
        start=[-.025,.012,.16,.27][frame]
        end=min(.46,length+[0,.025,.035,-.015][frame])
        if start>=end:continue
        w=(.055 if heavy else .039)*[1,.94,.66,.28][frame]*(1+(j%3)*.20)
        pts=[(start,-w*.48),(start+.055,-w),(.16,-w*.38),(end,0),
             (.20,w*.46),(.10,w*.72),(start+.02,w*.30)]
        for sc,col in [(1.32,(194,43,5,235)),(1,(255,119,10,255)),(.56,(255,222,103,255))]:
            im=Image.alpha_composite(im,polygon([(u*ca-v*sc*sa,u*sa+v*sc*ca) for u,v in pts],col))
    if frame<3:
        # Unequal compact impact mass, open in the attack's exit direction.
        k=[1,.96,.53][frame]
        pts=[(-.17,-.035),(-.095,-.12),(-.035,-.065),(.025,-.17),(.065,-.065),
             (.22,-.015),(.11,.04),(.16,.11),(.035,.08),(-.045,.16),(-.075,.065),(-.15,.09)]
        for sc,col in [(1.17,(255,121,12,255)),(.85,(255,225,114,255)),(.56,(255,255,250,255))]:
            im=Image.alpha_composite(im,polygon([(u*k*sc,v*k*sc) for u,v in pts],col))
    for j,a in enumerate([-.78,.18,.93,2.05,3.38] if heavy else [-.64,.85,2.63]):
        radius=.24+(j%2)*.06+frame*.037
        cx=math.cos(a)*radius;cy=math.sin(a)*radius
        l=(.055 if heavy else .044)*(1-frame*.12);w=.015 if heavy else .012
        ca,sa=math.cos(a),math.sin(a)
        pts=[(-l,-w*.2),(0,-w),(l,w*.1),(-.012,w)]
        im=Image.alpha_composite(im,polygon([(cx+u*ca-v*sa,cy+u*sa+v*ca) for u,v in pts],(255,203,83,255)))
        im=Image.alpha_composite(im,polygon([(cx-l*.4*ca,cy-l*.4*sa),(cx+l*.7*ca,cy+l*.7*sa),(cx-w*sa,cy+w*ca)],(255,255,236,255)))
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
