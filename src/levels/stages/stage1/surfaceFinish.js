import * as THREE from 'three';
import { rngFrom } from './geo.js';
// Local art direction, reusing the existing opaque grass and instanced fire draws.
export function finishStubble(group) {
  const materials = new Set();
  group.traverse(o => { if (o.material) materials.add(o.material); });
  for (const material of materials) {
    const prev = material.onBeforeCompile, key = material.customProgramCacheKey;
    material.onBeforeCompile = (shader, renderer) => {
      prev.call(material, shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      // Ash-grey stems with a broken amber edge catch the nearby ground bounce.
      float s1Kicker = (.55 + .45 * sin(vKW.x * .46 + vKW.z * .7)) * smoothstep(.15, .85, vKUv.y);
      outgoingLight += vec3(.095, .042, .012) * s1Kicker * (.45 + .55 * step(.38, vKUv.x));
      #include <opaque_fragment>`);
    };
    material.customProgramCacheKey = () => key.call(material) + '|s1Stubble';
  }
}

export function finishVillageFire(group) {
  group?.traverse(o => {
    if (o.name !== 'flames') return;
    // One card per emitter. All four edges reach zero, with an irregular rounded
    // root inside the card; discard also keeps zero-alpha texels out of compositing.
    // Normal alpha lets hot cores obscure straw, while the fringe stays translucent.
    o.material.blending = THREE.NormalBlending;
    o.material.forceSinglePass = true;
    o.material.fragmentShader = `
uniform sampler2D kNoise; uniform float kTime;
varying vec2 vUv; varying vec4 vSeed;
void main() {
  float y = vUv.y, x = (vUv.x - .5) * 2.0;
  float clock = kTime * vSeed.z;
  float n = texture2D(kNoise, vec2(vUv.x * .72 + vSeed.x, y * .52 - clock * .38)).r;
  float n2 = texture2D(kNoise, vec2(vUv.x * 1.8 + vSeed.x, y * .85 - clock * .7)).g;
  float flame = 0.0, core = 0.0;
  for (int j = 0; j < 3; j++) {
    float f = float(j), r = fract(sin(vSeed.x * 137.1 + f * 41.7) * 1273.9);
    float h = .46 + .41 * r + .045 * sin(clock * 2.3 + r * 21.0);
    float root = .08 + .055 * sin(f * 3.1 + vSeed.x * 29.0);
    float t = (y - root) / h;
    float bend = sin(t * (3.0 + r * 4.0) - clock * (1.4 + r) + r * 9.0) * t * .21;
    float centre = (f - 1.0) * (.24 + r * .17) + bend + (n - .5) * t * .45;
    float width = max(.008, (.16 + r * .15) * (1.0 - max(0.0, t)));
    float d = abs(x - centre) / width;
    float tongue = (1.0 - smoothstep(.18, 1.22, d)) * (1.0 - smoothstep(.62, 1.0, t));
    // Rounded roots: no shared straight bottom edge, even where tongues join.
    tongue *= smoothstep(-.10, .10, t - .065 * d * d);
    tongue *= smoothstep(.12, .39, n2 + .26 * (1.0 - max(t, 0.0)));
    tongue *= j == 0 ? 1.0 : smoothstep(.12, .5, r);
    flame = max(flame, tongue);
    core = max(core, tongue * (1.0 - smoothstep(.08, .48, t)));
  }
  float boundary = smoothstep(0.0, .065, y) * (1.0 - smoothstep(.92, 1.0, y))
    * (1.0 - smoothstep(.82, 1.0, abs(x)));
  float alpha = flame * boundary * .93;
  if (alpha < .002) discard;
  vec3 colour = mix(vec3(.85, .055, .004), vec3(1.8, .48, .025), flame);
  colour = mix(colour, vec3(2.5, 1.35, .38), core * .85);
  gl_FragColor = vec4(colour * (.88 + .12 * sin(clock * 7.0 + vSeed.x * 20.0)), alpha);
}`;
    o.material.needsUpdate = true;
  });
}

// Fine straw fibres, authored once per stage. Mips/aniso filter long strokes
// without enlarging the shared 256px noise into rectangular roof streaks.
function strawTexture() {
  const w = 1024, h = 512, rng = rngFrom(831), data = new Uint8Array(w * h * 4);
  const columns = [], phases = [];
  for (let x = 0; x < w;) {
    const width = 2 + Math.floor(rng.next() * 4), tone = .28 + rng.next() * .5, phase = rng.next() * Math.PI * 2;
    for (let j = 0; j < width && x < w; j++, x++) { columns[x] = tone * (.78 + .22 * Math.sin(j / width * Math.PI)); phases[x] = phase; }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const warp = Math.round(Math.sin(y / h * Math.PI * 2) * 1.5);
    const col = (x + warp + w) % w, phase = phases[col];
    const long = Math.sin(y / h * Math.PI * 8 + phase) * .065;
    const k = (y * w + x) * 4;
    data[k] = Math.round((.22 + columns[col] * .66 + long) * 255);
    data[k + 1] = Math.round((.35 + columns[col] * .4 + long * .4) * 255);
    data[k + 2] = 0; data[k + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, w, h);
  tex.name = 'stage1-fine-roof-straw'; tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter; tex.anisotropy = 8; tex.needsUpdate = true;
  return tex;
}

export function finishThatch(material) {
  const tex = strawTexture(), prev = material.onBeforeCompile, key = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    shader.uniforms.s1StrawMap = { value: tex };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D s1StrawMap;')
      .replace('float strand = texture2D(kNoise, vec2(g.x * 2.6, g.y * 0.12)).b;', `
      vec2 straw = texture2D(s1StrawMap, g * vec2(.125, .25)).rg;
      float strand = straw.r;`)
      .replace('float strand2 = texture2D(kNoise, vec2(g.x * 7.0, g.y * 0.3) + 0.5).b;', 'float strand2 = straw.g;')
      .replace('lip * 0.28', 'lip * 0.16')
      .replace('strand * 0.03 + strand2 * 0.012 - lip * 0.035', 'strand * 0.005 + strand2 * 0.003 - lip * 0.018')
      .replace('totalEmissiveRadiance += kThEmber * eg', `
      totalEmissiveRadiance += vec3(.31, .075, .012) * vKM.b * (.6 + ktS * .5);
      eg = max(eg, vKM.g * (.24 + .76 * ktS));
      totalEmissiveRadiance += kThEmber * eg`);
  };
  material.customProgramCacheKey = () => key.call(material) + '|s1RoofFibres';
  material.addEventListener('dispose', () => tex.dispose());
}

export function finishStone(material) {
  const prev = material.onBeforeCompile, key = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
      #include <emissivemap_fragment>
      float nearStone = smoothstep(2.5, 3.8, vKW.z) * (1.0 - smoothstep(8.0, 14.0, vKW.z));
      totalEmissiveRadiance += vec3(.065, .032, .016) * nearStone * (.3 + .7 * max(0.0, vKN.y));`);
  };
  material.customProgramCacheKey = () => key.call(material) + '|s1StoneBounce';
}
