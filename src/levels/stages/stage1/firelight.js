// Stage-local ground irradiance bake. One mipmapped lookup in the existing opaque
// terrain draw, no transparent decals, additional lights, or fullscreen passes.
import * as THREE from 'three';
import { fbm2, smooth } from './geo.js';

export function groundFirelight(material, huts, rocks = []) {
  const w = 1024, h = 256, data = new Uint8Array(w * h * 4);
  // Foundation contact comes from the same post stations as the baked huts.
  // These compact footprints darken only ground immediately under each footing.
  const contacts=[...rocks];
  for(const hut of huts) {
    const halfW=(hut.w||5.4)/2, halfD=(hut.d||3.9)/2, yaw=hut.yaw||0;
    for(const x of [-halfW,-halfW/3,halfW/3,halfW]) for(const z of [-halfD,halfD]) {
      contacts.push({x:hut.x+x*Math.cos(yaw)+z*Math.sin(yaw),z:hut.z-x*Math.sin(yaw)+z*Math.cos(yaw),s:.42,sx:1});
    }
  }
  const sources = huts.map(o => [o.x, o.z + 4, 4.8, 9.5, o.burning]);
  // Smouldering fallen timbers along the near verge; smaller than the hut pools.
  for (const x of [-12, -2.5, 12.5, 25, 39, 53, 69, 84]) sources.push([x, 6.0, 2.7, 3.1, .52, true]);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = -40 + (i + 0.5) / w * 150, z = -28 + (j + 0.5) / h * 46;
    const broad = fbm2(x * 0.34, z * 0.4, 81, 3);
    const drifts = fbm2(x * 0.18 + z * 0.12, z * 1.1, 37, 3);
    let heat = 0;
    for (const [sx, sz, rx, rz, strength, vergeOnly] of sources) {
      const d = ((x - sx) / rx) ** 2 + ((z - sz) / rz) ** 2;
      // Fallen rafters light the near bank, without spilling their baked pool
      // back into the fighting belt. The hut contribution is continuous there.
      heat += Math.exp(-d * 1.2) * strength * (vergeOnly ? smooth(2.6, 4.0, z) : 1);
    }
    const edge = Math.min(1, Math.max(0, (z + 28) / 6), Math.max(0, (18 - z) / 5));
    const k = (j * w + i) * 4;
    data[k] = Math.min(255, Math.round(heat * (0.79 + broad * 0.22) * edge * 255));
    data[k + 1] = Math.round(Math.max(0, Math.min(1, (drifts - 0.36) * 3.2)) * edge * 255);
    data[k + 2] = Math.round(Math.max(0, Math.min(1, (broad - 0.49) * 5)) * 255);
    // Baked contact occlusion from the same placed stones, no floating decals.
    let ao = 1;
    for (const rock of contacts) {
      const dx=(x-rock.x)/(rock.s*(rock.sx||1)+.12), dz=(z-rock.z)/(rock.s+.10);
      const d=dx*dx+dz*dz;
      if(d<7) ao *= 1-.40*Math.exp(-d*2.5);
    }
    data[k + 3] = Math.round(ao * 255);
  }
  const tex = new THREE.DataTexture(data, w, h);
  tex.name = 'stage1-firelight-ash'; tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4; tex.needsUpdate = true;
  const gain = { value: new THREE.Vector3(.90, 0.14, 0.18) };
  material.userData.groundFirelightGain = gain;
  const prev = material.onBeforeCompile, key = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    shader.uniforms.s1GroundLight = { value: tex };
    shader.uniforms.s1GroundGain = gain;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D s1GroundLight;\nuniform vec3 s1GroundGain;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        vec4 groundBake = texture2D(s1GroundLight, (vKW.xz + vec2(40.0, 28.0)) / vec2(150.0, 46.0));
        vec3 baked = groundBake.rgb;
        vec4 grain = kN(vKW.xz * vec2(0.29, 0.63) + 0.137);
        float nearGround = 1.0 - smoothstep(8.0, 20.0, -vKW.z);
        float scuff = mix(0.92, 1.06, grain.g) * (1.0 - kgRut * 0.56);
        // Cool ash reflects the dusk; amber illumination follows the burning huts
        // across the road. Scorched islands and tracks remain dark inside the pools.
        // Keep the actor-foot belt inside its 35–60 value range while preserving
        // the broad warm pools under it; the brighter near bank is unchanged.
        float beltBalance = mix(.78, 1.0, smoothstep(2.2, 3.6, abs(vKW.z)));
        vec3 bounce = vec3(0.48, 0.205, 0.075) * baked.r * baked.r * scuff * s1GroundGain.x * beltBalance;
        vec3 ash = vec3(0.045, 0.043, 0.056) * (0.3 + baked.g * 1.7) * s1GroundGain.y;
        float scar = (1.0 - baked.b * 0.20) * (1.0 - kgBurn * .25);
        totalEmissiveRadiance += vec3(.020, .019, .014) * s1Ash * nearGround * groundBake.a;
        totalEmissiveRadiance += (bounce + ash) * scar * nearGround * (s1Reflectance + s1Shoulder*.15) * groundBake.a;
        // Sparse ember fissures in scorched near-verge soil, derivative filtered.
        float line = abs(grain.r - 0.51);
        float aa = max(fwidth(grain.r), 0.003);
        float broken = smoothstep(.50, .64, grain.g) * smoothstep(.36, .52, grain.b);
        float seam = (1.0 - smoothstep(0.009, 0.009 + aa, line)) * broken;
        float bed = smoothstep(0.12, 0.6, baked.b) * baked.r * smoothstep(2.1, 3.8, abs(vKW.z));
        float coal = s1Soil.a * smoothstep(0.35, 0.65, baked.b);
        totalEmissiveRadiance += vec3(4.2, 0.65, 0.035) * (seam * bed * s1GroundGain.z * .25 + coal * .65) * nearGround;
        // Only scattered hot sections cross the dusk look's 1.2 HDR-luma bloom
        // threshold. Only short, separated ember sections glow; no continuous lava veins.
        float hot = smoothstep(.60, .72, grain.b);
        totalEmissiveRadiance += vec3(7.0, 2.4, .12) * seam * bed * hot * nearGround * .18;
        diffuseColor.rgb *= groundBake.a;
      }`);
  };
  material.customProgramCacheKey = () => key.call(material) + '|s1GroundFirelight-r16';
  material.addEventListener('dispose', () => tex.dispose());
  return material;
}
