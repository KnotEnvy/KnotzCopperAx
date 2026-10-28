"""r28 face appeal; deterministic donor-space paint and free head taper.

Release contract: the face builder calls reshape_head/paint_face. Keep the r27
seraphine_head_fix3.apply_skin and smooth_head_normals compositor calls exactly
as before. No extra release compositor hook is needed for this module.
"""
import math
import numpy as np
from scipy.ndimage import distance_transform_edt, gaussian_filter
from scipy.spatial import cKDTree

CONFIG = {
    'seed': 28,
    'jaw_taper_mm': 3.4,
    'neck_taper_mm': 6.4,
    'seam_fade_mm': 20.,
    'paint_opacity': .78,
    'paint_multiply': (.83, .36, .19),
    'paint_feather_mm': 1.05,
    'sclera_rgb': (247, 246, 239),
    'catchlight_mm': 1.45,
    'brow_half_mm': 1.50,
    'lip_upper_rgb': (139, 67, 57),
    'lip_lower_rgb': (179, 99, 83),
}


def smooth(a, b, x):
    t = np.clip((x-a)/(b-a), 0, 1)
    return t*t*(3-2*t)


def bell(P, center, radius):
    return np.exp(-.5*np.sum(((P-np.asarray(center))/radius)**2, axis=-1))


def reshape_head(D, B, accepted):
    """X-only side taper. Central nose/lips/chin and all pins stay exact."""
    P = accepted.copy()
    x, y, z = P.T
    ax = abs(x)
    head = np.zeros(len(P), bool)
    head[B.verts_of('head')] = True
    pinned = np.isin(B.pos_id, D.pinned_positions('face'))
    free = head & ~pinned
    distance = cKDTree(B.P[pinned]).query(B.P)[0]
    seam = smooth(0, CONFIG['seam_fade_mm']*.001, distance)
    central = smooth(.025, .044, ax)
    jaw = np.exp(-.5*((z-1.607)/.016)**2)
    jaw *= smooth(-.080, -.042, y)*(1-smooth(.050, .080, y))
    neck = np.exp(-.5*((z-1.584)/.011)**2)
    neck *= smooth(-.027, -.004, y)*(1-smooth(.055, .079, y))
    amount = (CONFIG['jaw_taper_mm']*jaw+CONFIG['neck_taper_mm']*neck)*.001
    amount *= central*seam*free
    P[:, 0] -= np.sign(x)*amount
    # Preserve the interface's 19.8mm total donor displacement envelope by
    # clamping only the new X displacement; never rescale profile Y or Z.
    delta = P-B.P
    allowance = np.sqrt(np.maximum(0, .0198**2-(delta[:, 1:]**2).sum(1)))
    P[:, 0] = B.P[:, 0]+np.clip(delta[:, 0], -allowance, allowance)
    keep = ~free | (ax <= .025)
    keep[D.cranium_vertices()] = True
    P[keep] = accepted[keep]
    return P


def paint_face(base, pos, valid, face_cfg):
    """Paint from the spatial skin field, then translucent pigment/features."""
    cfg = face_cfg
    x, y, z = pos.transpose(2, 0, 1)
    ax = abs(x)
    edge = distance_transform_edt(valid)
    blend = smooth(0, 22, edge)*cfg['skin_repaint']
    samples = base[valid & (ax > .022) & (ax < .048) & (z > 1.687) & (z < 1.704)]
    skin = np.median(samples, axis=0) if len(samples) else np.array(cfg['skin_rgb'])/255
    clean = np.zeros_like(base)+skin
    clean += (.012*np.cos(x*43)+.007*np.sin(z*176))[..., None]*[1, .8, .6]
    bounce = (1-smooth(1.624, 1.653, z))*smooth(1.560, 1.582, z)*(1-smooth(.034, .064, ax))
    clean += bounce[..., None]*skin*cfg['lower_skin_lift']
    col = base*(1-blend[..., None])+clean*blend[..., None]
    # First unify the chart seam. All features are then painted over the same
    # r27 base, so the common neck field cannot erase the vermilion corners.
    from seraphine_head_fix3 import apply_skin
    orm = np.zeros((col.size//3, 3))+[1, .8, 0]
    normal = np.zeros_like(orm)+[.5, .5, 1]
    apply_skin(pos.reshape(-1, 3), col.reshape(-1, 3), orm, normal, frame='donor')

    def layer(rgb, alpha):
        nonlocal col
        a = np.clip(alpha, 0, 1)*valid*blend
        col = col*(1-a[..., None])+np.asarray(rgb)/255*a[..., None]

    # Subtle local temperature changes; never a baked cheek shadow.
    variation = np.zeros_like(col)
    for side in (-1, 1):
        variation += bell(pos, (side*.044, -.060, 1.653), (.021, .050, .021))[..., None]*[.035, -.006, -.012]
        variation += bell(pos, (side*.078, .005, 1.640), (.013, .045, .032))[..., None]*[.025, -.005, -.007]
    variation += bell(pos, (0, -.100, 1.640), (.013, .030, .017))[..., None]*[.022, -.004, -.007]
    cool = np.exp(-.5*((z-1.615)/.018)**2)*smooth(.027, .048, ax)
    variation += cool[..., None]*[-.006, -.002, .006]
    rng = np.random.default_rng(CONFIG['seed'])
    noise = gaussian_filter(rng.normal(size=valid.shape), .6)
    noise /= max(float(noise.std()), 1e-9)
    face = smooth(1.608, 1.630, z)*(1-smooth(1.711, 1.733, z))
    col += (variation+noise[..., None]*.0018)*blend[..., None]*face[..., None]
    for side in (-1, 1):
        for _ in range(35):
            px = side*rng.uniform(.019, .061)
            pz = rng.uniform(1.636, 1.665)
            radius = rng.uniform(.00025, .00050)
            freckle = np.exp(-.5*(((x-px)/radius)**2+((z-pz)/(radius*.8))**2))
            layer((139, 89, 64), freckle*rng.uniform(.05, .14))

    for side in (-1, 1):
        dx = side*x-cfg['eye_x']
        dz = z-cfg['eye_z']-dx*math.tan(math.radians(cfg['eye_tilt']))
        u = dx/(cfg['eye_w']*.5)
        curve = np.maximum(0, 1-u*u)**.68
        upper = cfg['eye_h']*.56*curve
        lower = -cfg['eye_h']*.44*curve
        span = 1-smooth(.98, 1.06, abs(u))
        layer((125, 85, 68), .18*np.exp(-((dz-.007)/.006)**2)*np.exp(-(u/1.1)**4))
        eye = span*smooth(lower-.0005, lower+.0003, dz)*(1-smooth(upper-.0003, upper+.0005, dz))
        layer(CONFIG['sclera_rgb'], eye)
        layer((174, 154, 143), eye*.18*np.exp(-((dz-upper+.0008)/.0017)**2))
        ir = np.sqrt((dx+.0005)**2+(dz-.0017)**2)
        iris = 1-smooth(.0057, .0063, ir)
        layer((54, 41, 28), iris*eye)
        layer((126, 86, 42), (1-smooth(.0047, .0054, ir))*eye)
        angle = np.arctan2(dz-.0017, dx+.0005)
        layer((187, 137, 66), (.17+.12*np.sin(angle*17))*iris*eye)
        layer((22, 23, 22), (1-smooth(.0023, .0026, ir))*eye)
        # A solid small specular point survives the engine's mip/AgX path.
        cr = np.sqrt((dx+.0021)**2+(dz-.0034)**2)
        catch = 1-smooth(CONFIG['catchlight_mm']*.00065, CONFIG['catchlight_mm']*.001, cr)
        layer((255, 255, 253), catch*eye)
        second = np.exp(-(((dx-.0015)/.00055)**2+((dz+.0007)/.00055)**2)*2)
        layer((243, 240, 220), second*eye*.7)
        layer((118, 76, 59), np.exp(-((dz-lower+.0004)/.00065)**2)*span*.45)
        lash = np.exp(-((dz-upper-.0002)/.00125)**2)*span
        wing = np.exp(-((dz-(.0016+.30*(dx-.012)))/.00065)**2)*smooth(.010, .014, dx)*(1-smooth(.015, .018, dx))
        layer((42, 29, 26), np.maximum(lash, wing)*.98)
        # Fine arched brow with directional broken strokes, tapered ends.
        browz = cfg['eye_z']+.0137+.0034*np.exp(-((u-.30)/.76)**2)+.0008*u
        thick = CONFIG['brow_half_mm']*.001*(1-.68*smooth(-.35, 1.2, u))
        envelope = (1-smooth(thick*.55, thick+.00045, abs(z-browz)))*(1-smooth(.91, 1.14, abs(u)))
        stroke = .5+.5*np.sin(dx*8600-(z-browz)*5300)
        layer((76, 43, 30), envelope*(.60+.38*stroke))

    # Two rising, tapered dry-brush swipes following the cheekbone. No bridge.
    t = np.clip((ax-.014)/.050, 0, 1)
    mid = 1.644+.010*t-.002*t*t
    taper = np.sin(np.pi*t)**.48
    half = .0058*taper
    coarse = gaussian_filter(rng.normal(size=valid.shape), sigma=(1.8, 4.2))
    coarse /= max(float(coarse.std()), 1e-9)
    fine = gaussian_filter(rng.normal(size=valid.shape), sigma=(.55, 1.4))
    fine /= max(float(fine.std()), 1e-9)
    brush = .00040*np.clip(coarse, -2, 2)+.00025*np.sin(x*1300+z*250)
    feather = CONFIG['paint_feather_mm']*.001
    stripe = 1-smooth(half+brush-feather, half+brush+feather, abs(z-mid))
    stripe *= smooth(.014, .019, ax)*(1-smooth(.059, .064, ax))
    dry = np.clip(.84+.10*fine+.04*np.sin(x*3700+z*700), .32, 1)
    a = stripe*dry*CONFIG['paint_opacity']*valid*blend
    pigment = col*np.asarray(CONFIG['paint_multiply'])
    col = col*(1-a[..., None])+pigment*a[..., None]

    # Shaped neutral mouth: lit lower roll, thin crease, distinct warm corners.
    u = x/(cfg['mouth_w']*.5)
    t = np.maximum(0, 1-u*u)
    line = cfg['mouth_z']+.00115*u*u
    top = cfg['lip_upper']*t**.8+.0010*np.exp(-((ax-.0065)/.0038)**2)-.0007*np.exp(-(x/.0035)**2)
    low = cfg['lip_lower']*t**.72
    mouth = 1-smooth(.96, 1.04, abs(u))
    upper = mouth*smooth(line-.0002, line+.0003, z)*(1-smooth(line+top-.0005, line+top+.0006, z))
    lower = mouth*(1-smooth(line-.0003, line+.0002, z))*smooth(line-low-.0006, line-low+.0004, z)
    layer(CONFIG['lip_upper_rgb'], upper*.91)
    layer(CONFIG['lip_lower_rgb'], lower*.92)
    layer((235, 167, 138), .67*np.exp(-((z-line+.0028)/.0014)**2)*np.exp(-(u/.72)**4)*lower)
    layer((193, 113, 93), .26*np.exp(-((z-line-.0038)/.0013)**2)*np.exp(-(u/.65)**4)*upper)
    layer((93, 49, 42), .70*np.exp(-((z-line)/.00042)**2)*mouth)
    layer((129, 89, 70), .20*np.exp(-((z-(line-low-.0016))/.0019)**2)*np.exp(-(u/.7)**4))
    for side in (-1, 1):
        layer((91, 48, 32), .82*bell(pos, (side*.0085, -.100, 1.6312), (.002, .030, .001)))
        layer((100, 54, 46), .65*bell(pos, (side*.0225, -.078, cfg['mouth_z']+.001), (.0016, .030, .0010)))
    layer((204, 144, 104), .13*bell(pos, (0, -.091, 1.649), (.004, .030, .014)))

    from seraphine_groom import hairline
    delta = pos-np.array([0, .021, 1.685])
    az = np.degrees(np.arctan2(delta[..., 0], -delta[..., 1]))
    el = np.degrees(np.arctan2(delta[..., 2], np.linalg.norm(delta[..., :2], axis=-1)))
    hair = smooth(-1.8, .4, el-hairline(az))*(1-smooth(58, 76, abs(az)))
    strands = .4+.6*(.5+.5*np.sin(az*3.3+el*.18))
    a = hair*strands*.6*valid
    col = col*(1-a[..., None])+np.array([128, 58, 33])/255*a[..., None]
    return np.clip(col, 0, 1), {'skin_rgb': (skin*255).round(2).tolist(), 'r28': CONFIG}
