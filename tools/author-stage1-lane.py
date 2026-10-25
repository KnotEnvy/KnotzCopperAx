"""Bake the Ashen Wilds travelled lane. Original metric sculpt/paint; no reference pixels.
Run with Python + numpy/Pillow. Two 4096x1024 maps, 42.67 texels/metre.
Albedo includes cavity occlusion, NOT direct illumination. Relief packs world normal X/Z,
wet trough coverage and ash. All marks are authored in world metres before baking.
"""
from pathlib import Path
import json, math
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'public/assets/textures/stage1'; OUT.mkdir(parents=True,exist_ok=True)
W,H=4096,1024; X0,Z0=-20.,-16.; SX,SZ=96.,24.; rng=np.random.default_rng(1617)
x=X0+(np.arange(W,dtype=np.float32)+.5)*SX/W
z=Z0+(np.arange(H,dtype=np.float32)+.5)*SZ/H
X,Z=np.meshgrid(x,z)
def noise(w,h):
 a=Image.fromarray(rng.integers(0,256,(h,w),dtype=np.uint8)).resize((W,H),Image.Resampling.BICUBIC)
 return np.asarray(a,dtype=np.float32)/255
n1=noise(160,40); n2=noise(680,170); grain=noise(2200,550); fine=rng.random((H,W),dtype=np.float32)
def smooth(a,b,v):
 t=np.clip((v-a)/(b-a),0,1);return t*t*(3-2*t)
# The same two wheels follow a slow wandering centreline across all three screens.
centre=.05+.38*np.sin(X*.125)+.17*np.sin(X*.31+1.1)
gauge=1.18+.045*np.sin(X*.29)
lateral=np.abs(Z-centre)-gauge
edge_jitter=(n2-.5)*.085+(grain-.5)*.035
rut_width=.22+.028*np.sin(X*.8)+.025*(n1-.5)
d=lateral+edge_jitter
trough=1-smooth(rut_width*.48,rut_width,np.abs(d))
wall=np.exp(-((np.abs(d)-rut_width*.92)/.095)**2)
lip=np.exp(-((np.abs(d)-rut_width-.12)/.14)**2)
height=-.073*trough+.042*lip+.009*(n2-.5)+.004*(grain-.5)
# Snow-white mineral ash is wind-caught on wheel lips and the road margins.
# The edge is a physical 2-4 cm crust; never a screen-space dither threshold.
margin=np.abs(Z-centre)-(2.48+.16*np.sin(X*.24)+.18*(n1-.5))
ash_lip=(1-smooth(.15,.20,np.abs(np.abs(d)-rut_width-.18)+(n2-.5)*.14))
ash_margin=smooth(-.025,.025,margin+(n2-.5)*.35+(grain-.5)*.10)
# Uneven windrow terminates in broken tongues; the village is not a pale carpet.
ash_margin*=1-smooth(1.15,1.22,margin+(n1-.5)*1.7+(n2-.5)*.40)
ash=np.maximum(ash_lip*(.48+.52*n1),ash_margin*(.65+.35*n1))
# Between hut foundations and roadside posts, ash lodges on their lee sides.
for hx,hz,hw in [(-9.5,-9.8,5.2),(4.8,-10.4,5.6),(17.8,-8.4,5.4),(28.2,-12.8,6),(42.2,-9.4,5.2),(55.8,-11.9,5.8),(68.5,-9.8,5.4)]:
 apron=np.maximum(np.abs(X-hx)/(hw*.55),np.abs(Z-(hz+2.0))/.70)
 deposit=1-smooth(.95,1.04,apron+(n2-.5)*.17)
 ash=np.maximum(ash,deposit)
# Lee-side ash pockets at fixed stump, barrel, rail and fallen-timber stations.
for hx,hz in [(-6,-5.5),(21,-4.4),(38,-5.2),(52,4.2),(29,4.8),(10.6,-4.3),(11.3,-3.9),(45.5,-4.4),(46.3,-4),(7.8,-5.9)]+[(q,4.2) for q in [-12,-2.5,12.5,25,39,53,69]]:
 d=np.sqrt(((X-hx-.28)/.85)**2+((Z-hz-.12)/.40)**2)
 deposit=1-smooth(.95,1.06,d+(n2-.5)*.27)
 ash=np.maximum(ash,deposit*(.72+.28*n2))
# Foot traffic crosses the wheel path to each door. Sole and heel are separate;
# compressed ash walls remain around the mud-filled print.
foot=np.zeros((H,W),np.float32)
def stamp(cx,cz,angle,length=.30,width=.13):
 ix=int((cx-X0)/SX*W);iy=int((cz-Z0)/SZ*H);R=16
 xa,xb=max(0,ix-R),min(W,ix+R+1);ya,yb=max(0,iy-R),min(H,iy+R+1)
 if xa>=xb or ya>=yb:return
 dx=X[ya:yb,xa:xb]-cx;dz=Z[ya:yb,xa:xb]-cz
 u=dx*np.cos(angle)+dz*np.sin(angle);v=-dx*np.sin(angle)+dz*np.cos(angle)
 sole=((u-.045)/(length*.45))**2+(v/width)**2
 heel=((u+.11)/.075)**4+(v/(width*.8))**4
 mask=1-smooth(.72,1.05,np.minimum(sole,heel))
 foot[ya:yb,xa:xb]=np.maximum(foot[ya:yb,xa:xb],mask)
for start,depth,angle,steps in [(-5,2.4,-.15,26),(6,3.0,-1.3,13),(21,-3.4,1.15,13),(31,2.7,-.23,22),(42,-3.2,1.0,12),(49,2.8,-.18,18)]:
 for j in range(steps):
  if rng.random()<.13:continue
  stride=j*.49;side=.17 if j%2 else -.17
  stamp(start+stride*np.cos(angle)-side*np.sin(angle),depth+stride*np.sin(angle)+side*np.cos(angle),angle+rng.uniform(-.12,.12))
height-=foot*.035;ash*=1-foot*.97
wet=trough*(.48+.52*n1)*(1-foot*.3)
# Raised ash has centimetre clumps and soot grains. Mud has dry broken crust,
# compacted centres and the darker wet trough; no arbitrary macro colour islands.
ash*=1-smooth(.80,.94,grain)*.75
height+=ash*(.022+.010*n2+.008*grain)
# Sculpt angular dry peds, not cloudy noise: jittered clay cells have a small
# depressed seam, a tilted broken crown and a distinct mineral tone. Compression
# removes this structure in the wheel trough while ash fills its hollows.
cell=.24; qx=X/cell; qz=Z/cell; ix=np.floor(qx);iz=np.floor(qz)
nearest=np.full((H,W),99.,np.float32);second=nearest.copy();celltone=np.zeros((H,W),np.float32)
def hashed(a,b,seed):
 return np.mod(np.sin(a*127.1+b*311.7+seed*71.3)*43758.5453,1)
for dy in [-1,0,1]:
 for dx in [-1,0,1]:
  cx=ix+dx;cz=iz+dy
  dist=(qx-cx-.12-hashed(cx,cz,1)*.76)**2+(qz-cz-.12-hashed(cx,cz,2)*.76)**2
  closer=dist<nearest
  second=np.where(closer,nearest,np.minimum(second,dist))
  celltone=np.where(closer,hashed(cx,cz,3),celltone)
  nearest=np.minimum(nearest,dist)
seam=1-smooth(.012,.065,second-nearest)
ped=(1-trough*.93)*(1-ash)
height+=ped*((1-seam)*.013-seam*.010)
base=np.stack((.062+.037*n1,.043+.029*n1,.027+.020*n1),axis=-1)
base*=((.72+.55*celltone)*(1-seam*ped*.38))[...,None]
base*=((.70+.42*n2+.15*grain)*(1-trough*.34)*(1-foot*.35))[...,None]
ashcolor=np.stack((.155+.085*n2,.150+.080*n2,.123+.070*n2),axis=-1)
ashcolor*=((.70+.36*grain)*(1-smooth(.90,.98,fine)*.58))[...,None]
color=base*(1-ash[...,None])+ashcolor*ash[...,None]
# Broken crust chips and trampled reed fragments gather on the shoulders.
for j in range(3200):
 cx=rng.uniform(-18,74);cz=rng.uniform(-6.4,6.6)
 ix=int((cx-X0)/SX*W);iy=int((cz-Z0)/SZ*H)
 length=rng.uniform(.04,.22);width=rng.uniform(.018,.055);angle=rng.uniform(-.5,.5) if j%3 else rng.uniform(0,6.28)
 R=12;xa,xb=max(0,ix-R),min(W,ix+R+1);ya,yb=max(0,iy-R),min(H,iy+R+1)
 dx=X[ya:yb,xa:xb]-cx;dz=Z[ya:yb,xa:xb]-cz
 u=(dx*np.cos(angle)+dz*np.sin(angle))/length;v=(-dx*np.sin(angle)+dz*np.cos(angle))/width
 shape=np.maximum(np.abs(u),np.abs(v+u*.25))
 m=(1-smooth(.70,1.05,shape))
 tone=np.array((.14,.095,.042) if j%4 else (.018,.017,.014))*(.7+rng.random()*.5)
 local=color[ya:yb,xa:xb];local[:]=local*(1-m[...,None])+tone*m[...,None]
 height[ya:yb,xa:xb]+=m*.009;wet[ya:yb,xa:xb]*=1-m
# Actual height derivatives in metres supply normals, and contact AO follows
# the concave rut/print walls. Bake with a 1-texel reconstruction filter.
gz,gx=np.gradient(height,SZ/H,SX/W)
norm=np.stack((-gx,np.ones_like(gx),-gz),axis=-1);norm/=np.linalg.norm(norm,axis=-1,keepdims=True)
ao=1-.15*trough-.24*foot-.11*wall
color*=ao[...,None]
srgb=np.where(color<=.0031308,color*12.92,1.055*np.maximum(color,0)**(1/2.4)-.055)
# File row zero represents minimum Z. Runtime flipY=false preserves that contract.
Image.fromarray(np.uint8(np.clip(srgb,0,1)*255)).save(OUT/'lane-albedo.png')
packed=np.stack((norm[:,:,0]*.5+.5,norm[:,:,2]*.5+.5,wet,ash),axis=-1)
Image.fromarray(np.uint8(np.clip(packed,0,1)*255)).save(OUT/'lane-relief.png')
meta={'revision':'C2-r16-authored-wheel-route','size':[W,H],'origin':[X0,Z0],'span':[SX,SZ],'texelsPerMetre':W/SX,'maps':{'albedo':'sRGB pigment with cavity AO','relief':'world normal X, world normal Z, wet trough, ash'},'heightRangeMetres':[float(height.min()),float(height.max())],'rutDepthMetres':.073,'rutGaugeMetres':2.36,'footprintPixels':int((foot>.5).sum())}
(OUT/'lane.json').write_text(json.dumps(meta,indent=2));print(json.dumps(meta))
