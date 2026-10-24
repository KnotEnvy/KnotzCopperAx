// Thieves' Night campfire: shared authored flipbook tongues, curling smoke and ember cluster.
// Three overlapping combustion layers share one pooled draw; coals, lights and glows remain local.
// The flame/glow billboards share kFade (camp softens the fire when a fighter overlaps it).
import * as THREE from 'three';
import { createFireKit } from '../../../render/fire.js';
import { shared } from '../../../render/shaderlib.js';
import { FirePool } from '../../../vfx/fireLib.js';
import { Geo, M, rngFrom, vnoise } from './geo.js';

export function buildCampfire({ group, quality = {}, at }) {
  const low = quality.name === 'low';
  const F = [at.x, 0.1, at.z];
  const kFade = { value: 1 };

  // Shared authored atlas: one broad hot bed and overlapping asymmetric combustion layers.
  const pool = new FirePool({ capacity: 16, fade: kFade, name: 'camp_authored_fire' });
  pool.clear();
  for (const [x, z, h, w, phase] of [[0,-.10,2.25,1.85,.0],[-.23,.05,2.60,1.38,.33],[.25,.13,1.95,1.30,.67]]) {
    pool.emit({ clip: 'flame', pos: [x,h*.5,z], size: [w,h], life: .46 + phase*.12,
      loop: true, phase, core: .65, radiance: 1.35, soft: .12 });
  }
  pool.emit({ clip: 'smoke', pos: [0,2.65,-.12], size: [2.1,3.0], life: 2.3,
    loop: true, core: 0, alpha: .68, spin: -.13 });
  pool.emit({ clip: 'embers', pos: [0,1.2,.10], size: [1.9,2.5], life: 1.5, loop: true, core: .8 });
  const flames = pool.mesh;
  flames.position.set(F[0], F[1], F[2]);
  group.add(flames);
  let lastTime = shared.uTime.value;
  // Environment disposal owns the geometry/material, atlas stays shared across consumers.

  // ---- smoke, embers, glows (the shared kit; its flame() is not used)
  const fx = createFireKit({ quality });
  fx.glow([F[0], 0.6, F[2]], { size: 4.2, color: '#ff8a3a', intensity: 0.9, flicker: 0.25 });
  fx.glow([F[0], 0.18, F[2]], { size: 1.7, color: '#ff4a12', intensity: 1.1, flicker: 0.35 });
  fx.glow([-4.6, 0.8, -5.2], { size: 1.6, color: '#ffa050', intensity: 0.5, flicker: 0.12 });   // lantern inside the left tent
  fx.sparks([F[0], 0.5, F[2]], { count: low ? 20 : 40, life: 2.4, rise: 3.2, spread: 0.9, size: 0.06, radius: 0.5 });
  fx.sparks([F[0], 0.35, F[2]], { count: low ? 6 : 14, life: 3.8, rise: 2.0, spread: 1.4, size: 0.1, radius: 0.35 });     // fewer, bigger, slower drifters
  const fxObj = fx.build(); if (fxObj) group.add(fxObj);
  if (fxObj) for (const o of fxObj.children) {
    if (o.name !== 'fireGlow' || !o.material || !o.material.fragmentShader) continue;
    const fs = o.material.fragmentShader, end = fs.lastIndexOf('}');
    o.material.fragmentShader = 'uniform float kFade;\n' + fs.slice(0, end) + '  gl_FragColor *= kFade;\n}' + fs.slice(end + 1);
    o.material.uniforms.kFade = kFade;
  }

  // ---- coal bed: lumpy unlit coals — dark crust, hot cracks (HDR, so the bloom catches them), a few lone orange embers
  const CB = new Geo(), Rn = rngFrom(77);
  for (let i = 0; i < 46; i++) {
    const a = Rn() * Math.PI * 2, r = Math.sqrt(Rn()) * 0.5, x = Math.cos(a) * r, z = Math.sin(a) * r * 0.92, rr = 0.04 + Rn() * 0.065, hot = 1 - r / 0.55;
    const seed = i * 3.1;
    CB.blob([x, 0.03 + rr * 0.35 + (1 - r) * 0.025, z], rr * (1 + Rn() * 0.4), rr * 0.7, rr * (1 + Rn() * 0.3), (u, v, pp) => {
      const crack = vnoise(pp[0] * 38 + seed, pp[1] * 38, pp[2] * 38);
      const glow = Math.max(0, Math.min(1, (crack - 0.46) * 4.2)) * (0.45 + 0.9 * hot) * (v > 0.2 ? 1 : 0.35);
      return [0.07 + 2.5 * glow, 0.035 + 0.78 * glow * glow, 0.02 + 0.1 * glow * glow * glow];
    }, M(0, 0, 0), { seg: 7, rings: 4, noise: 0.35, seed: i + 3, flatBottom: true });
  }
  const coalMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true });
  const coals = new THREE.Mesh(CB.build(), coalMat); coals.position.set(F[0], 0, F[2]); coals.name = 'camp_coals'; group.add(coals);
  const bed = new THREE.Mesh(new THREE.CircleGeometry(0.46, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff4a10').multiplyScalar(1.6), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: true }));
  bed.rotation.x = -Math.PI / 2; bed.position.set(F[0], 0.032, F[2]); group.add(bed);

  const fire = new THREE.PointLight('#ff8c42', 0, 17, 1.6); fire.position.set(F[0], 1.05, F[2] + 0.2); group.add(fire);
  const bounce = new THREE.PointLight('#ff6a2a', 0, 9, 2); bounce.position.set(F[0], 0.35, F[2] + 1.6); group.add(bounce);

  return {
    fire, bounce, kFade,
    /** per tick: fl = flicker 0.7..1 · scale = fire size 0..1.5 */
    update(fl, scale) {
      const now = shared.uTime.value;
      // Shared slow collapse/regrowth avoids three independent layers averaging to a fixed triangle.
      const surge = .92 + .12*Math.sin(now*6.7) + .06*Math.sin(now*13.1);
      for (let i=0;i<3;i++) {
        const o=pool.items[i], height=[2.25,2.60,1.95][i]*(surge+.10*Math.sin(now*8+i*2));
        o.size[1]=height; o.pos[1]=height*.5;
        o.pos[0]=[0,-.18,.20][i]+.09*Math.sin(now*5+i*2);
      }
      const plume=pool.items[3];
      plume.pos[0]=.18*Math.sin(now*2.2); plume.rot=.18*Math.sin(now*1.7);
      pool.update(Math.max(0, Math.min(.1, now - lastTime))); lastTime = now;
      fire.intensity = 34 * fl * scale; bounce.intensity = 7 * fl * scale;
      coalMat.color.setScalar((0.8 + 0.3 * fl) * Math.min(1, 0.35 + scale * 0.65));
      bed.material.opacity = 0.5 * fl * Math.min(1, scale);
      flames.visible = scale > 0.02; flames.scale.set(1, Math.max(0.35, 0.55 + 0.45 * scale), 1);
    },
  };
}
