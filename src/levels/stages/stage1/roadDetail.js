// Packed metric soil detail: reflectance, relief, ash and sparse live coal.
// Two fixed world-space scales share one map; a unique stage-wide mask holds scuffs.
import * as THREE from 'three';
import { rngFrom } from './geo.js';
import { groundZones } from './groundZones.js';

function roadTile() {
  const N = 1024, rng = rngFrom(717), data = new Float32Array(N * N * 4);
  const wrap = n => (n + N) % N;
  const noise = [];
  for (const size of [16, 96, 384]) {
    const values = Float32Array.from({ length: size * size }, () => rng.next());
    noise.push((x, y) => {
      x = x / N * size; y = y / N * size;
      const i = Math.floor(x), j = Math.floor(y);
      let u = x - i, v = y - j; u *= u * (3 - 2 * u); v *= v * (3 - 2 * v);
      const at = (a, b) => values[((b + size) % size) * size + (a + size) % size];
      return (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v)
        + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v;
    });
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const k = (y * N + x) * 4;
    const a = noise[0](x, y), b = noise[1](x, y), c = noise[2](x, y);
    const ash = Math.max(0, (a - .48) * 2.8);
    data[k] = .29 + b * .16 + c * .38 + (rng.next()-.5)*.18;
    data[k + 1] = .3 + b * .08 + c * .23;
    data[k + 2] = ash;
  }
  // All stamps wrap at the tile boundary. Different silhouettes and split faces
  // distinguish pale angular grit, compacted scuffs, and elongated char flakes.
  const stamp = (cx, cy, rx, ry, angle, kind) => {
    const ca = Math.cos(angle), sa = Math.sin(angle), R = Math.ceil(Math.max(rx, ry) + 2);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const u = (dx * ca + dy * sa) / rx, v = (-dx * sa + dy * ca) / ry;
      const d = kind === 1 ? Math.max(Math.abs(u + .09 * Math.sin(v * 8)), Math.abs(v) / Math.max(.12, .83 - .48 * u + .17 * Math.sin(u * 13 + cx)))
        : kind === 0 ? Math.max(Math.abs(u*.84+v*.27), Math.abs(v*.92-u*.15), Math.abs(u-v)*.68) : Math.hypot(u, v);
      if (d > 1) continue;
      const k = (wrap(Math.round(cy) + dy) * N + wrap(Math.round(cx) + dx)) * 4;
      const edge = Math.min(1, (1 - d) * 8), raised = Math.sqrt(Math.max(0, 1 - d * d));
      const tone = kind === 1 ? .20 + .13 * (u > .1) : kind === 2 ? .25 : .31 + .22 * (u + v < -.1) + .11*Math.sin(cx*7+cy*3);
      data[k] += (tone - data[k]) * edge;
      data[k + 1] += ((kind === 2 ? .24 : .43 + raised * .4) - data[k + 1]) * edge;
      data[k + 2] *= 1 - edge * .75;
      if (kind === 1 && rx > 11 && Math.abs(v) < .11 && u > -.7 && u < .45) data[k + 3] = .85;
    }
  };
  for (let i = 0; i < 1100; i++) {
    const char = i % 23 === 0, r = 2.0 + Math.pow(rng.next(), 2) * (char ? 18 : 14);
    stamp(rng.next() * N, rng.next() * N, r, char ? 1.2 + rng.next() * 2 : r * (.45 + rng.next() * .4), rng.next() * 6.28, char ? 1 : 0);
  }
  for(let i=0;i<130;i++) {
    let x=rng.next()*N,y=rng.next()*N,a=rng.next()*6.28;
    for(let j=0;j<12+rng.next()*35;j++) {
      x+=Math.cos(a)*1.6;y+=Math.sin(a)*1.6;a+=(rng.next()-.5)*.65;
      const k=(wrap(Math.floor(y))*N+wrap(Math.floor(x)))*4;
      data[k]*=.55;data[k+1]=.21;
    }
  }
  // A few uneven char clusters replace the regular black confetti distribution.
  for (let i = 0; i < 27; i++) {
    const cx = rng.next() * N, cy = rng.next() * N, angle = rng.next() * 6.28;
    for (let j = 0; j < 5; j++) stamp(wrap(cx + (rng.next() - .5) * 42), wrap(cy + (rng.next() - .5) * 32),
      3 + rng.next() * 14, .8 + rng.next() * 2, angle + rng.next() * .5, 1);
  }
  // No broad heel/toe stamps: they became repeating dark ovals in the mips.
  const bytes = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) bytes[i] = Math.round(THREE.MathUtils.clamp(data[i], 0, 1) * 255);
  const tex = new THREE.DataTexture(bytes, N, N);
  tex.name = 'stage1-packed-earth-char-ash-relief';
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter; tex.anisotropy = 4; tex.needsUpdate = true;
  return tex;
}

export function roadDetail(material) {
  const w = 2048, h = 512, bytes = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const z = groundZones(-40 + (i + .5) / w * 150, -28 + (j + .5) / h * 46);
    bytes.set([z.track, z.ash, z.char, z.clump].map(v => Math.round(v * 255)), (j * w + i) * 4);
  }
  // Unique, incomplete foot scuffs in the fight lane; authored in world metres
  // in the stage-wide mask, so there is no repeated footprint tile.
  const tracks=rngFrom(741);
  for(const cx of [-4,8,23,31,43,57,69]) {
    const cz=(tracks.next()-.5)*2.7,angle=(tracks.next()-.5)*.6;
    for(let step=0;step<7;step++) {
      if(tracks.next()<.25)continue;
      const x=cx+step*.57,z=cz+step*angle+(step%2? .16:-.16);
      const ix=Math.round((x+40)/150*w),iy=Math.round((z+28)/46*h);
      for(let dy=-3;dy<=3;dy++)for(let dx=-4;dx<=4;dx++) {
        const u=dx/(w/150*.18),v=(dy-dx*angle)/(h/46*.09);
        if(u*u+v*v>1||ix+dx<0||ix+dx>=w||iy+dy<0||iy+dy>=h)continue;
        const k=((iy+dy)*w+ix+dx)*4;
        bytes[k+2]=Math.max(bytes[k+2],Math.round((1-u*u-v*v)*140));
        bytes[k+1]*=.65;
      }
    }
  }
  const zones = new THREE.DataTexture(bytes, w, h);
  zones.generateMipmaps = true; zones.minFilter = THREE.LinearMipmapLinearFilter;
  zones.magFilter = THREE.LinearFilter; zones.needsUpdate = true;
  material.userData.prepassSafe = true; // fragment colour/normal only
  const tex = roadTile(), prev = material.onBeforeCompile, key = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    shader.uniforms.s1SoilMap = { value: tex };
    shader.uniforms.s1Zones = { value: zones };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D s1SoilMap;
uniform sampler2D s1Zones;
vec4 s1Soil; float s1Reflectance; float s1Ash;`)
      // Replace the complete shared painterly albedo section locally. Keeping
      // its broad stretched flow field under a fine layer still looked muddy.
      .replace(/  vec2 p = vKW.xz;[\s\S]*?diffuseColor.rgb \*= col;/, `
  vec2 p = vKW.xz;
  vec4 zone = texture2D(s1Zones, (p + vec2(40.,28.)) / vec2(150.,46.));
  // Fixed metric UVs: no zone-driven UV distortion. Two differently oriented
  // detail samples hide the tile; macro variation is unique across the stage.
  s1Soil = texture2D(s1SoilMap, p / 4.1);
  vec4 soilB = texture2D(s1SoilMap, mat2(.6,-.8,.8,.6)*p / 3.17 + .37);
  vec4 macro = kN(p*.0097 + .217);
  float detail = s1Soil.r*.68 + soilB.r*.32;
  s1Reflectance = clamp(.25 + detail*.95, .30, .95);
  s1Ash = zone.g*(1.-zone.b*.55);
  float wear = .25+.75*smoothstep(.38,.65,texture2D(s1Zones,(p+vec2(41.,28.))/vec2(150.,46.)).g);
  float lateral = abs(p.y-.1+sin(p.x*.11)*.16)-.92;
  float rut = exp(-lateral*lateral/.017)*wear;
  float shoulder = exp(-pow(abs(lateral)-.11,2.)/.003)*wear;
  kgRoad=zone.r; kgRut=rut; kgBurn=zone.b; kgPuddle=0.;
  vec3 col=mix(vec3(.074,.070,.065),vec3(.115,.102,.083),zone.r);
  col=mix(col,vec3(.155,.151,.137),s1Ash*.65);
  col*= (.91+macro.r*.18)*(1.-zone.b*.36)*(1.-zone.a*.20);
  col*=.68*(s1Reflectance*(1.-rut*.28)+shoulder*.035);
  kgH=(s1Soil.g*.65+soilB.g*.35)*.022-rut*.014;
  diffuseColor.rgb*=col;`);

  };
  material.customProgramCacheKey = () => key.call(material) + '|s1RoadDetail-r14';
  material.addEventListener('dispose', () => { tex.dispose(); zones.dispose(); });
}
