"""r19 body/gear parts. Donor surface is read-only. Run with tools/blender-run.mjs.
--preview writes the parts and invokes the shared team preview assembler in the same Blender job.
"""
import os, sys, time, json, math, argparse
import numpy as np
HERE=os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0,HERE)
import bpy, bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree
import brann_team as T
CONFIG={
 'seed':1919, 'out':'progress/tmp/brann_team/parts/gear',
 'rows':4,'tufts_per_row':6,'pelt_lift':.054,'drape':.170,
 'tuft_length':(.130,.190),'tuft_width':(.043,.078),'tuft_spine':.004,
 'strap_width':.050,'strap_thickness':.005,'disc_diameter':.120,
 'fur_rgb':(.765,.719,.654),'fur_rough':.88,'iter':4,
}
def norm(v):
 v=np.asarray(v,float);return v/max(np.linalg.norm(v),1e-12)
def log(msg):print('[brann-gear] '+msg,flush=True)
class Mesh:
 def __init__(self):self.p=[];self.f=[];self.uv=[];self.groups=[]
 def patch(self,P,U,tag='',wrap=False):
  P=np.asarray(P);U=np.asarray(U);nr,nc=P.shape[:2];o=len(self.p);self.p.extend(P.reshape(-1,3));self.uv.extend(U.reshape(-1,2));self.groups.extend([tag]*(nr*nc))
  for i in range(nr-1):
   for j in range(nc if wrap else nc-1):
    k=(j+1)%nc;a=o+i*nc+j;b=o+i*nc+k;c=o+(i+1)*nc+k;d=o+(i+1)*nc+j
    self.f.extend([(a,b,c),(a,c,d)])
 def arrays(self):
  # Recalculate in a temporary mesh; retain original vertex indices and UV attributes.
  me=bpy.data.meshes.new('gear_normals');me.from_pydata(self.p,[],self.f);me.update()
  bm=bmesh.new();bm.from_mesh(me);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(me);bm.free();me.update()
  for p in me.polygons:p.use_smooth=True
  F=np.array([list(p.vertices) for p in me.polygons],np.int32)
  P=np.array(self.p,float);UV=np.array(self.uv,float)[F]
  N=np.array([v.normal[:] for v in me.vertices])[F]
  N/=np.maximum(np.linalg.norm(N,axis=2,keepdims=True),1e-12)
  bpy.data.meshes.remove(me)
  return P,F,UV,N
class Surface:
 def __init__(self,D):
  self.bvh=BVHTree.FromPolygons([Vector(x) for x in D.P],D.F[D.faces('body')].tolist(),all_triangles=True)
 def ray(self,p,d,offset=0):
  h,n,_,_=self.bvh.ray_cast(Vector(p),Vector(d),2)
  if h is None:
   h,n,_,_=self.bvh.find_nearest(Vector(p))
  return np.array(h)+np.array(n)*offset,np.array(n)
 def radial(self,c,n,offset=0):
  # Cast inwards from outside so the first visible exterior is selected.
  return self.ray(np.asarray(c)+np.asarray(n)*.40,-np.asarray(n),offset)
 def torso(self,x,z,front=True,offset=0):
  return self.ray((x,-.65 if front else .65,z),(0,1 if front else -1,0),offset)
def joint(arm,name):return np.array(arm.matrix_world@arm.data.bones[name].head_local)
def pelt_surface(S,c,d,up,t,a,lift=0):
 n=norm(up*math.cos(a)+np.array((0,1,0))*math.sin(a))
 p,n2=S.radial(c+d*t,n)
 return p+n*lift,n

def build_pelts(D,S,arm):
 B=Mesh();rng=np.random.default_rng(CONFIG['seed']);measure={}
 for si,side in enumerate(('L','R')):
  c=joint(arm,'upperarm_'+side);d=norm(joint(arm,'forearm_'+side)-c);up=norm(np.cross(d,(0,1,0)))
  if up[2]<0:up=-up
  # Continuous support drapes over outer deltoid, boundary returns into donor skin.
  ts=np.linspace(-.070,CONFIG['drape'],19);angles=np.linspace(-1.92,1.92,33);P=[];UV=[]
  for i,t in enumerate(ts):
   row=[];uv=[]
   for j,a in enumerate(angles):
    edge=min(i/(len(ts)-1),(len(ts)-1-i)/(len(ts)-1),j/(len(angles)-1),(len(angles)-1-j)/(len(angles)-1))
    lift=CONFIG['pelt_lift']*min(1,edge*9)*(.90-.35*max(0,t)/CONFIG['drape'])-.001
    p,n=pelt_surface(S,c,d,up,t,a,lift);row.append(p);uv.append((.025+.950*j/(len(angles)-1),.025+.255*i/(len(ts)-1)))
   P.append(row);UV.append(uv)
  corev=np.array(P).reshape(-1,3);nr=len(P);nc=len(P[0]);coref=[]
  for ci in range(nr-1):
   for cj in range(nc-1):
    aa=ci*nc+cj;bb=aa+1;cc=aa+nc+1;dd=aa+nc;coref.extend([(aa,bb,cc),(aa,cc,dd)])
  cbvh=BVHTree.FromPolygons([Vector(x) for x in corev],coref,all_triangles=True)
  sign=1 if side=='L' else -1
  def fit_x(q,offset):
   q=np.array(q,float);hit,normal,_,_=cbvh.ray_cast(Vector((sign*.80,q[1],q[2])),Vector((-sign,0,0)),1.6)
   if hit is not None:
    normal=np.array(normal);normal*=1 if normal[0]*sign>=0 else -1;q=np.array(hit)+normal*offset
   return q
  B.patch(P,UV,side)
  starts=[];lengths=[];widths=[]
  for row in range(CONFIG['rows']):
   # Stagger and vary row starts; avoid a regular shingle grid.
   for k in range(CONFIG['tufts_per_row']):
    a=-1.60+k*3.20/(CONFIG['tufts_per_row']-1)+rng.uniform(-.14,.14)+(row%2-.5)*.10
    t=-.060+row*.047+rng.uniform(-.019,.019)
    def core_lift(tt,aa):
     edge=min((tt+.070)/.265,(.195-tt)/.265,(aa+1.92)/3.84,(1.92-aa)/3.84)
     return CONFIG['pelt_lift']*np.clip(edge*9,0,1)*(.90-.35*max(0,tt)/CONFIG['drape'])-.001
    root,n=pelt_surface(S,c,d,up,t,a,core_lift(t,a))
    root=fit_x(root,-.0015)
    flow=norm((0,.55,-.835));lateral=norm(np.cross(flow,n))
    length=rng.uniform(*CONFIG['tuft_length'])*(1-.04*row);width=rng.uniform(*CONFIG['tuft_width'])
    P=[];UV=[];lane=(k+row*3)%5;u0=.025+lane*.178
    for it,v in enumerate(np.linspace(0,1,11)):
     sh=max(.018,(1-v)**.65*(.94+.08*math.sin(v*6+k)))
     base=root+flow*length*v
     # A backwards sweep, projected from the SIDE onto the continuous pelt.
     # Extra back travel avoids wrapping a tuft up over the shoulder crown.
     offset=-.0015 if it==0 else .005+.006*math.sin(math.pi*v)
     center=fit_x(base,offset)
     if it:
      best=2.;chosen=center
      for extra in np.linspace(0,.12*v,13):
       trial=fit_x(base+np.array((0,extra,0)),offset);delta=norm(trial-root);angle=math.acos(np.clip(np.dot(delta,flow),-1,1))
       if angle<best:best=angle;chosen=trial
       if angle<math.radians(27):break
      center=chosen
     r=[];uv=[]
     for j,w in enumerate(np.linspace(-1,1,7)):
      pp=fit_x(center+lateral*w*width*.5*sh,offset)
      pp[0]+=sign*CONFIG['tuft_spine']*(1-w*w)*math.sin(math.pi*(.10+.85*v))
      r.append(pp);uv.append((u0+.148*(w+1)/2,.365+.58*v))
     P.append(r);UV.append(uv)
    B.patch(P,UV,side);starts.append(root);lengths.append(length);widths.append(width)
  measure[side]={'tufts':24,'length_mm':[round(min(lengths)*1000),round(max(lengths)*1000)],'width_mm':[round(min(widths)*1000),round(max(widths)*1000)],'shoulder':c.tolist(),'axis':d.tolist()}
 # Preserve a measured 12 mm rest clearance to donor mane; integration rechecks the new mane.
 mbvh=BVHTree.FromPolygons([Vector(x) for x in D.P],D.F[D.faces('mane')].tolist(),all_triangles=True)
 adjusted=0
 for i,p in enumerate(B.p):
  for _ in range(4):
   h,_,_,gap=mbvh.find_nearest(Vector(p))
   if gap>=.012:break
   away=norm(np.asarray(p)-np.array(h));p=np.asarray(p)+away*(.0122-gap);adjusted+=1
  B.p[i]=p
 P,F,UV,N=B.arrays()
 measure['mane_clearance_mm']=float(min(mbvh.find_nearest(Vector(p))[3] for p in P)*1000)
 measure['mane_clearance_adjustments']=adjusted
 W,_=T.transfer_weights(P,D,regions=('body',),bones=['clavicle_L','upperarm_L','clavicle_R','upperarm_R','chest'])
 # Anatomical smooth clavicle->arm partition, stable across separate tuft roots.
 for side in ('L','R'):
  ix=np.flatnonzero(np.array(B.groups)==side);c=joint(arm,'upperarm_'+side);d=norm(joint(arm,'forearm_'+side)-c)
  t=(P[ix]-c)@d;alpha=np.clip((t+.065)/.145,0,1);alpha=alpha*alpha*(3-2*alpha)
  W[ix]=0;W[ix,D.bones.index('upperarm_'+side)]=alpha;W[ix,D.bones.index('clavicle_'+side)]=(1-alpha)*.92;W[ix,D.bones.index('chest')]=(1-alpha)*.08
 assert len(F)<=12000, 'pelt budget exceeded'
 meta=T.save_part(CONFIG['out'],'pelts',P=P,F=F,UV=UV,N=N,W=W,bones=D.bones,tile='pelt',meta={'role':'gear','replaces':['pelt_L','pelt_R'],'alpha':True,'author':'GPT-6.1 Sol','notes':'Continuous fitted support + 24 staggered flattened down/back tufts per shoulder. Intentional stacked strand UVs.'})
 measure['tris']=len(F);measure['bounds']=[P.min(0).tolist(),P.max(0).tolist()]
 return measure

def torus(B,c,n,r,tube,tag,uvbox=(.67,.02,.97,.32),segments=48,sides=8):
 n=norm(n);u=norm(np.cross(n,(0,0,1)))
 if np.linalg.norm(u)<.1:u=np.array((1,0,0))
 v=norm(np.cross(n,u));P=[];UV=[]
 for i,a in enumerate(np.linspace(0,2*math.pi,segments+1)):
  radial=u*math.cos(a)+v*math.sin(a);row=[];uv=[]
  for j,b in enumerate(np.linspace(0,2*math.pi,sides,endpoint=False)):
   p=c+radial*(r+tube*math.cos(b))+n*tube*math.sin(b);row.append(p)
   uv.append((uvbox[0]+(uvbox[2]-uvbox[0])*(.5+.48*np.dot(p-c,u)/(r+tube)),uvbox[1]+(uvbox[3]-uvbox[1])*(.5+.48*np.dot(p-c,v)/(r+tube))))
  P.append(row);UV.append(uv)
 B.patch(P,UV,tag,wrap=True)

def build_harness(B,S):
 for front in (True,False):
  for sign in (-1,1):
   # Follow existing diagonal through the donor surface, all vertices projected individually.
   pts=np.array([(sign*.125,1.075),(sign*.070,1.230),(0,1.365),(-sign*.075,1.470),(-sign*.135,1.600)])
   dist=np.r_[0,np.cumsum(np.linalg.norm(np.diff(pts,axis=0),axis=1))];N=29;P=[];UV=[]
   for t in np.linspace(0,dist[-1],N):
    i=min(np.searchsorted(dist,t,side='right')-1,len(pts)-2);i=max(0,i);a=(t-dist[i])/(dist[i+1]-dist[i]);q=pts[i]*(1-a)+pts[i+1]*a;tan=norm(pts[i+1]-pts[i]);cross=np.array((-tan[1],tan[0]))
    # Eight-point bevelled section, closed; bottom embedded by .2 mm, upper face 4.8 mm.
    row=[];uv=[]
    for j,(w,h) in enumerate([(-1,.001),( -.94,.0048),(.94,.0048),(1,.001),(.94,.0002),(-.94,.0002)]):
     x,z=q+cross*w*CONFIG['strap_width']*.5;p,n=S.torso(x,z,front,h);row.append(p);uv.append((.035+.50*(w+1)/2,.03+.93*t/dist[-1]))
    P.append(row);UV.append(uv)
   B.patch(P,UV,'harness',wrap=True)
 # Sternum disc: continuous shallow plate, relief in tile normal/albedo.
 c,n=S.torso(0,1.368,True,.003);c+=n*.003;u=np.array((1,0,0));v=norm(np.cross(n,u));r=CONFIG['disc_diameter']*.5
 P=[];UV=[]
 for rr,depth in [(r*.02,0),(r*.80,.001),(r*.94,.001),(r,-.001)]:
  row=[];uv=[]
  for a in np.linspace(0,2*math.pi,49):
   row.append(c+u*rr*math.cos(a)+v*rr*math.sin(a)+n*depth)
   uv.append((.82+.145*rr/r*math.cos(a),.18+.145*rr/r*math.sin(a)))
  P.append(row);UV.append(uv)
 B.patch(P,UV,'disc');torus(B,c,n,r*.91,.004,'disc',segments=48,sides=8)
 for sx in (-1,1):
  p,n=S.torso(sx*.125,1.560,True,.004)
  torus(B,p,n,.024,.004,'ring',segments=28,sides=6)
 return {'strap_width_mm':CONFIG['strap_width']*1000,'strap_thickness_mm':CONFIG['strap_thickness']*1000,'disc_mm':CONFIG['disc_diameter']*1000}

def build_bracers(B,S,arm):
 for side in ('L','R'):
  c=joint(arm,'forearm_'+side);wrist=joint(arm,'hand_'+side);d=norm(wrist-c);L=np.linalg.norm(wrist-c);u=norm(np.cross(d,(0,1,0)));v=norm(np.cross(d,u))
  # Radial shell covers donor wrist seam. Small flared bronze bands at each end.
  P=[];UV=[]
  for i,t in enumerate(np.linspace(.105,L+.006,9)):
   row=[];uv=[]
   for j,a in enumerate(np.linspace(0,2*math.pi,33)):
    n=u*math.cos(a)+v*math.sin(a);sample=min(t,L*.85);p,_=S.radial(c+d*sample,n,.001);p+=d*(t-sample);row.append(p);uv.append((.035+.50*j/32,.035+.90*i/8))
   P.append(row);UV.append(uv)
  B.patch(P,UV,'bracer_'+side)
  # Bands use the actual fitted shell radius; each lower edge touches the shell.
  for bt in (.116,L-.010):
   P=[];UV=[]
   for k,dt in enumerate((-.008,-.006,.006,.008)):
    row=[];uv=[]
    for j,a in enumerate(np.linspace(0,2*math.pi,33)):
     n=u*math.cos(a)+v*math.sin(a);t=bt+dt;sample=min(t,L*.85);p,_=S.radial(c+d*sample,n,.001 if k in (0,3) else .004);p+=d*(t-sample);row.append(p);uv.append((.66+.30*j/32,.40+.15*k/3))
    P.append(row);UV.append(uv)
   B.patch(P,UV,'bracer_'+side)

def smooth_weights(W,F,n=3):
 edges=np.concatenate((F[:,[0,1]],F[:,[1,2]],F[:,[2,0]]));edges=np.r_[edges,edges[:,::-1]];cnt=np.bincount(edges[:,0],minlength=len(W));
 for _ in range(n):
  A=np.zeros_like(W);np.add.at(A,edges[:,0],W[edges[:,1]]);W=.65*W+.35*A/np.maximum(cnt[:,None],1)
 return W/np.maximum(W.sum(1,keepdims=True),1e-12)
def build_overlays(D,S,arm):
 B=Mesh();measure=build_harness(B,S);build_bracers(B,S,arm);P,F,UV,N=B.arrays();W,_=T.transfer_weights(P,D,regions=('body',),bones=['chest','spine','clavicle_L','clavicle_R','forearm_L','forearm_R'])
 for i,g in enumerate(B.groups):
  if g.startswith('bracer_'):
   W[i]=0;W[i,D.bones.index('forearm_'+g[-1])]=1
  else:
   for bn in ('forearm_L','forearm_R'):W[i,D.bones.index(bn)]=0
   if W[i].sum()<1e-6:W[i,D.bones.index('chest')]=1
 W=smooth_weights(W,F)
 # Metal disc/rings are rigid chest accents (no arm-induced flex).
 for tag in ('disc','ring'):
  ix=np.flatnonzero(np.array(B.groups)==tag);W[ix]=0;W[ix,D.bones.index('chest')]=1
 assert len(F)<=5000, 'overlay budget exceeded'
 T.save_part(CONFIG['out'],'gear_overlays',P=P,F=F,UV=UV,N=N,W=W,bones=D.bones,tile='gear',meta={'role':'gear','replaces':[],'author':'GPT-6.1 Sol','notes':'50 mm bevelled surface-ray fitted leather X straps; 120 mm bronze lion relief disc; shoulder rings; wrist-spanning leather bracers with bronze bands.'})
 measure['tris']=len(F);return measure

def png(path,rgba,noncolor=False):
 h,w=rgba.shape[:2];im=bpy.data.images.new('gear_tile',width=w,height=h,alpha=True,float_buffer=False);im.colorspace_settings.name='Non-Color' if noncolor else 'sRGB';im.pixels.foreach_set(np.asarray(rgba,np.float32).reshape(-1));im.filepath_raw=os.path.abspath(path);im.file_format='PNG';im.save();bpy.data.images.remove(im)
def build_tiles():
 out=os.path.join(CONFIG['out'],'tiles');os.makedirs(out,exist_ok=True);rng=np.random.default_rng(CONFIG['seed'])
 for tile in ('pelt','gear'):
  _,x0,y0,x1,y1=T.CONFIG['tiles'][tile];h=y1-y0;w=x1-x0;v,u=np.mgrid[0:h,0:w].astype(float);u/=w-1;v/=h-1
  A=np.ones((h,w,4));O=np.ones_like(A);N=np.ones_like(A);N[:,:,:3]=(.5,.5,1)
  if tile=='pelt':
   # Five reusable strand lanes. Opaque support strip on the right, feathered outer strands.
   lane=np.clip(np.floor((u-.025)/.178),0,4);s=(u-(.025+lane*.178))/.148;t=np.clip((v-.365)/.58,0,1)
   strand=np.sin(s*math.pi*47+np.sin(t*9+lane)*.7)+.45*np.sin(s*math.pi*113+t*5)
   shade=.82+.15*t+.055*strand+.035*np.sin(s*19+t*13)
   A[:,:,:3]=np.array(CONFIG['fur_rgb'])*shade[:,:,None]
   edge=.025+.20*(.5+.5*np.sin(s*57+lane*3))
   alpha=np.clip((1-t-edge)/.016,0,1);alpha[v<.43]=1
   # Tiny fibre breakup along the lateral edges, without cutting away core coverage.
   lateral=.055*t*(.5+.5*np.sin(t*77+lane*4));alpha*=np.clip((s-lateral)/.025,0,1)*np.clip((1-s-lateral)/.025,0,1);alpha[v<.43]=1
   A[:,:,3]=alpha
   # Dedicated 752×403 opaque support patch: broad broken fur groups plus fine fibres.
   support=v<.30;flow=14*u+2.8*v+.13*np.sin(v*51)+.055*np.sin(u*23+v*31)
   clumps=np.sin(flow*2*math.pi)+.40*np.sin((flow*2.31+v*3)*2*math.pi)
   grain=np.sin(u*900+np.sin(v*80)*1.2)
   value=.87+.070*clumps+.024*grain+.018*np.sin(u*19-v*37)
   A[support,:3]=np.array(CONFIG['fur_rgb'])*value[support,None]
   O[:,:,0]=.90;O[:,:,1]=CONFIG['fur_rough'];O[:,:,2]=0
   N[:,:,0]=.5+.035*np.cos(s*147+t*4);N[:,:,1]=.5+.012*np.sin(t*40+s*19)
   N[support,0]=.5+.085*np.cos(flow[support]*2*math.pi)+.025*np.cos(u[support]*900);N[support,1]=.5+.035*np.sin(flow[support]*2*math.pi)
  else:
   grain=rng.normal(0,.012,(h,w));A[:,:,:3]=np.clip(np.array((.145,.104,.078))+(grain[:,:,None]),0,1);O[:,:,0]=.96;O[:,:,1]=.78;O[:,:,2]=0
   # Stitched leather edges, ochre thread and worn bevel line in the leather strip.
   for edge in (.048,.520):
    seam=(abs(u-edge)<.0035)&((v*70)%1<.45);A[seam,:3]=(.44,.32,.18)
   metal=(u>.62);A[metal,:3]=np.array((.56,.36,.13))*(.95+grain[metal,None]);O[metal,1]=.40;O[metal,2]=.83
   # Stylized lion mask bas-relief: round mane, ears, eyes, broad muzzle and nose.
   x=(u-.82)/.145;y=(v-.18)/.145;r=np.sqrt(x*x+y*y);ang=np.arctan2(y,x)
   relief=np.exp(-((r-.68)/.10)**2)*(.6+.18*np.cos(ang*14))
   relief+=.6*np.exp(-((x/.36)**2+((y+.02)/.43)**2)*2)
   relief+=.30*np.exp(-(((abs(x)-.35)/.13)**2+((y-.32)/.15)**2)*2)
   relief-=.33*np.exp(-(((abs(x)-.20)/.09)**2+((y-.10)/.055)**2)*2)
   relief+=.45*np.exp(-((x/.22)**2+((y+.25)/.14)**2)*2)
   relief-=.24*np.exp(-((x/.09)**2+((y+.13)/.07)**2)*2)
   mask=(r<.88)&(v<.36)&metal
   A[mask,:3]*=(.75+.30*relief[mask,None]);dy,dx=np.gradient(relief);N[mask,0]=np.clip(.5-dx[mask]*3,.15,.85);N[mask,1]=np.clip(.5-dy[mask]*3,.15,.85)
  for key,arr in [('albedo',A),('orm',O),('normal',N)]:png(os.path.join(out,tile+'_'+key+'.png'),arr,key!='albedo')
  if tile=='pelt':
   srgb=A[:,:,:3];lin=np.where(srgb<=.04045,srgb/12.92,((srgb+.055)/1.055)**2.4);Y=lin@np.array((.2126,.7152,.0722));L=116*np.cbrt(Y)-16
   log('fur L* mean %.2f range %.2f..%.2f'%(L.mean(),np.percentile(L,5),np.percentile(L,95)));furL=float(L.mean())
 return furL

def main():
 argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [];ap=argparse.ArgumentParser();ap.add_argument('--preview',action='store_true');ap.add_argument('--fast',action='store_true');ap.add_argument('--release',action='store_true');ap.add_argument('--out');ap.add_argument('--pelts-only',action='store_true');a=ap.parse_args(argv)
 if a.out:CONFIG['out']=a.out
 t=time.time();D=T.Donor();S=Surface(D);arm=T.import_armature();log('stage donor done in %.1fs; joints %s'%(time.time()-t,{n:joint(arm,n).round(4).tolist() for n in ('upperarm_L','forearm_L','hand_L')}))
 rep={'config':CONFIG,'donor_sha':T.DONOR_SHA};rep['pelts']=build_pelts(D,S,arm);log('stage pelts done in %.1fs'% (time.time()-t))
 if not a.pelts_only:rep['overlays']=build_overlays(D,S,arm);log('stage overlays done in %.1fs'%(time.time()-t))
 rep['fur_Lstar']=build_tiles();rep['seconds']=time.time()-t;T.save_json('progress/tmp/brann_team/gear/build_report.json',rep);log('stage tiles done in %.1fs'%(time.time()-t));audit=T.check_part(CONFIG['out']);log(json.dumps(audit));assert audit['ok'], 'part audit failed'
 if a.preview and not a.pelts_only:
  import build_hero_brann_team as preview
  oldargv=sys.argv;sys.argv=[preview.__file__,'--','--preview-role','gear','--out',os.path.join('progress/tmp/brann_team/gear/preview',str(CONFIG['iter']))]
  try:preview.main()
  finally:sys.argv=oldargv
if __name__=='__main__':main()
