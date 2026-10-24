"""Original numpy reed cards: no reference pixels. Called by stage1 kit wrapper."""
import bpy, numpy as np, random, math

def material():
    # Three overlapping beds of individual curved stalks, with naturally broken tips.
    w,h=1024,512; yy,xx=np.mgrid[0:h,0:w]; y=yy/(h-1)
    rgb=np.zeros((h,w,3),np.float32);rgb[:]=(.21,.17,.11)
    alpha=np.zeros((h,w),np.float32);height=np.zeros_like(alpha)
    rng=random.Random(1127)
    for layer in range(3):
        for i in range(115):
            cx=(i+rng.uniform(-.35,.35))/115
            length=min(.995,rng.uniform(.67,.94)+.055*math.sin(i*.73)) if layer==2 else rng.uniform(.54,.86)
            width=rng.uniform(1.5,3.4);phase=rng.random()*6.28
            centre=cx*w+np.sin(y*4+phase)*rng.uniform(2,7)+y*y*rng.uniform(-9,9)
            dist=np.abs(xx-centre);radius=width*(1-.58*y**3)
            mask=(dist<radius)&(y<length)&(y>.015)
            rib=np.sqrt(np.clip(1-(dist/np.maximum(radius,.1))**2,0,1))
            tone=rng.uniform(.64,1.18)
            grey=rng.random()>.45
            base=np.array((.56,.51,.40) if grey else (.64,.47,.27))*tone
            lit=.50+.50*rib+.05*np.sin(y*135+phase)
            # Dark compressed root; brighter raised fringe.
            lit*=.52+.48*np.clip(y/.20,0,1)
            rgb[mask]=(base[None,None,:]*lit[:,:,None])[mask]
            height[mask]=(rib*.65+layer*.24)[mask]
            alpha[mask]=1
    # Normal map from cylindrical reed relief; opaque mip interiors retain coverage.
    gy,gx=np.gradient(height);norm=np.stack((-gx*2.8,gy*2.8,np.ones_like(gx)),axis=-1)
    norm/=np.linalg.norm(norm,axis=-1,keepdims=True)
    def image(name,data,noncolor=False):
        im=bpy.data.images.new(name,width=w,height=h,alpha=True)
        if noncolor:im.colorspace_settings.name='Non-Color'
        im.pixels.foreach_set(np.ascontiguousarray(data[::-1],dtype=np.float32).ravel());im.pack();return im
    albedo=image('Ashen_straw_fringe_RGBA',np.dstack((rgb,alpha)))
    normal=image('Ashen_straw_fringe_normal',np.dstack((norm*.5+.5,np.ones_like(alpha))),True)
    mat=bpy.data.materials.new('Ashen_alpha_straw');mat.use_nodes=True
    mat.surface_render_method='DITHERED';mat.use_transparency_overlap=False
    n=mat.node_tree.nodes;l=mat.node_tree.links;bs=n.get('Principled BSDF');bs.inputs['Roughness'].default_value=.98
    tx=n.new('ShaderNodeTexImage');tx.image=albedo;l.new(tx.outputs['Color'],bs.inputs['Base Color']);l.new(tx.outputs['Alpha'],bs.inputs['Alpha'])
    nt=n.new('ShaderNodeTexImage');nt.image=normal;nm=n.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.7
    l.new(nt.outputs['Color'],nm.inputs['Color']);l.new(nm.outputs[0],bs.inputs['Normal'])
    return mat

def roof(B,C,rng,hx,H,slope,D,N,hole,paint,rim,side,sag):
    from mathutils import Vector
    def clipgrid(make,nu,nv,emit,field,edge=None):
        grid=[[make(i/nu,j/nv) for i in range(nu+1)] for j in range(nv+1)]
        for j in range(nv):
            for i in range(nu):
                for tri in [[grid[j][i],grid[j][i+1],grid[j+1][i+1]],[grid[j][i],grid[j+1][i+1],grid[j+1][i]]]:
                    poly=[];cut=[]
                    for a,b in zip(tri,tri[1:]+tri[:1]):
                        inside=field(a[0],a[1])>=1
                        if inside:poly.append(a)
                        if inside!=(field(b[0],b[1])>=1):
                            lo,hi=a,b
                            for _ in range(9):
                                mid=tuple((lo[k]+hi[k])*.5 for k in range(5))
                                if (field(mid[0],mid[1])>=1)==inside:lo=mid
                                else:hi=mid
                            poly.append(mid);cut.append(mid)
                    if len(poly)>2:emit(poly)
                    if len(cut)==2 and edge:edge(*cut)
    # The backing is consumed farther than the reeds: no cut-wall or outline.
    def core(u,t):
        x=-hx-.38+u*(hx*2+.76);v=t*(slope-.03)
        return x,v,Vector((x,0,H-sag(x,v)))+D*v-N*(.14+.025*math.sin(x*29)),u,t
    def coreface(p):
        # Recessed charred backing, with irregular remaining reed mats in front.
        # Grain and value change per bay; top recess receives no blanket bounce.
        colors=[]
        for a in p:
            low=max(0,min(1,a[1]/slope))
            value=.38+.24*low+.10*abs(math.sin(a[0]*5.7+a[1]*3.1))
            colors.append((value,value*.87,value*.68) if side==1 else (.12,.14,.15))
        B.face([a[2]-N*.16 for a in p],1,[(a[3],a[4]) for a in p],colors)
    clipgrid(core,30,20,coreface,lambda x,v:hole(x,v)-.13)
    if side==1:
        # Separate remnants follow the far roof plane, separated by blackened
        # exposed wood. They stop at different heights and recess per bay.
        for j in range(3):
            x=-hx-.25
            while x<hx+.2:
                width=rng.uniform(.34,.72);v0=j*slope/3+rng.uniform(-.12,.18)
                length=slope*rng.uniform(.15,.29);depth=rng.uniform(.05,.23)
                tone=rng.uniform(.36,.58)*(1+j*.10)
                if rng.random()>.23:
                    pts=[Vector((x,0,H))+D*v0-N*depth,
                         Vector((x+width,0,H))+D*(v0+.07)-N*depth,
                         Vector((x+width*.82,0,H))+D*(v0+length*.77)-N*(depth+.04),
                         Vector((x+.05,0,H))+D*(v0+length)-N*(depth+.09)]
                    C.face(pts,-1,[(0,1),(1,1),(1,0),(0,0)],
                           col=(tone,tone*.80,tone*.53),smooth=True)
                x+=width+rng.uniform(.08,.22)
    for row in range(8):
        x=-hx-.48
        while x<hx+.40:
            width=min(rng.uniform(.48,.86),hx+.52-x);start=row*slope/8-.10+.07*math.sin(x*1.6+row*2.2)+rng.uniform(-.035,.035)
            length=slope/8+rng.uniform(.34,.43);phase=rng.random()*6.28
            # Individual sheaves end at different lengths. Fine serrations and
            # sparse drooping tips belong to these alpha cards, never to a rim.
            def field(px,v):
                return hole(px,v)+.035*math.sin(px*47+phase)+.035*math.sin(px*23-v*13+phase)
            def card(u,t):
                px=x+width*u+.025*math.sin(t*3+phase)
                v=start+t*length+.065*math.sin(u*4+phase)*t
                h=hole(px,v);burn=max(0,min(1,(1.45-h)/.45))
                lift=.055+(7-row)*.009+.075*t*t+.012*math.sin(u*7+phase)
                lift-=burn*(.025+.06*math.sin(phase)**2)
                return px,v,Vector((px,0,H-sag(px,v)))+D*v+N*lift,u,t
            def heat(a):
                return max(0,min(1,(1.24-hole(a[0],a[1]))/.24))
            def emit(p):
                C.face([a[2] for a in p],-1,[(a[3],1-a[4]) for a in p],
                       [paint(a[0],a[1]) for a in p],ember=[heat(a) for a in p],smooth=True)
            def edge(a,b):
                rim.append(tuple((a[2]+b[2])*.5))
                # Each cut sheaf has its own 3cm exposed cross section. It uses
                # the same reed texture and gaps as the card above, not a rim tube.
                depth=.025+.018*abs(math.sin(phase))
                C.face([a[2],b[2],b[2]-N*depth,a[2]-N*depth],-1,
                       [(a[3],1-a[4]),(b[3],1-b[4]),(b[3],.95),(a[3],.95)],
                       col=(.08,.09,.085),ember=0,smooth=False)
                if rng.random()>.16:return
                # A few torn reed sheaves hang INTO the missing roof. The same
                # straw texture/normal/char material shades them, with no beams.
                p=a[2].lerp(b[2],.5);w=rng.uniform(.018,.045);ln=rng.uniform(.10,.27)
                mid=p+D*(ln*.55)-N*.035
                tip=p+D*ln-N*rng.uniform(.07,.15)
                for aa,bb,ta,tb in [(p,mid,0,.55),(mid,tip,.55,1)]:
                    C.face([aa+Vector((-w,0,0)),aa+Vector((w,0,0)),bb+Vector((w*.45,0,0)),bb+Vector((-w*.45,0,0))],-1,
                           [(.15,1-ta),(.30,1-ta),(.30,1-tb),(.15,1-tb)],
                           col=(.025,.030,.032),ember=[0,0,.25,.25],smooth=True)
            near=side==-1 and min(hole(x+width*u,start+length*t) for u in (0,.5,1) for t in (0,.5,1))<1.7
            clipgrid(card,8 if near else 2,7 if near else 3,emit,field,edge if side==-1 else None)
            x+=width*.98
