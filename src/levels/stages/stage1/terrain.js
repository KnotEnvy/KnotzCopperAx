// Stage 1 terrain: one displaced ground sheet (flat inside the playable belt, rolling burned fields behind, a low
// bank in front), shaded by the shared painterly ground material with a rutted, puddled dirt road along X.
import * as THREE from 'three';
import * as M from '../../../render/materials.js';
import { shared } from '../../../render/shaderlib.js';
import { smooth, fbm2 } from './geo.js';
import { groundFirelight } from './firelight.js';
import { roadDetail } from './roadDetail.js';

export const ROAD = { z: 0.1, halfWidth: 1.95 };

/** Terrain height (m). Exactly 0 across the walkable band so gameplay stays on y = 0. */
export function terrainH(x, z) {
  if (z > -3.4 && z < 3.6) return 0;
  if (z <= -3.4) {
    const back = smooth(-3.4, -12, z) * 0.55 + smooth(-14, -34, z) * 2.6 + smooth(-40, -80, z) * 3.5;
    const n = fbm2(x * 0.045, z * 0.05, 3, 4);
    const bumps = fbm2(x * 0.3, z * 0.3, 9, 2) - 0.5;
    return back * (0.55 + n * 0.9) + bumps * 0.25 * smooth(-3.4, -8, z) - smooth(-60, -100, z) * 3;
  }
  const front = smooth(3.6, 10, z) * 0.6;
  return front * (0.5 + fbm2(x * 0.08, z * 0.1, 5, 3) * 0.9);
}

export function buildTerrain(ctx, huts = [], rocks = []) {
  const x0 = -70, x1 = 160, z0 = -120, z1 = 18;
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, 230, 120);
  g.rotateX(-Math.PI / 2);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    // Denser rows near the belt: remap z quadratically around 0.
    const zt = (p.getZ(i) + (z1 - z0) / 2) / (z1 - z0); // 0 far … 1 near
    const z = z0 + (z1 - z0) * (1 - Math.pow(1 - zt, 1.6));
    const x = p.getX(i) + x0 + (x1 - x0) / 2;
    p.setXYZ(i, x, terrainH(x, z), z);
  }
  g.computeVertexNormals();
  let mat = M.ground({
    road: { z: ROAD.z, halfWidth: ROAD.halfWidth, soft: 0.5, rut: 0.78 },
    // Cool charred albedo remains under the r6 baked firelight/ash reflection.
    // Lower bump avoids the old repeated fine ridges sparkling at game distance.
    roadColor: '#4a4751', rutColor: '#23212a', field: '#322f33', field2: '#3b3836', verge: '#5a5450', burnt: '#151318',
    puddles: 0.65, burn: 1, embers: 1, emberIntensity: 3.2, bump: 0.28,
  });
  // Dry ash/packed soil has negligible specular response. Preserve the authored
  // pigment, derivative relief, shadow and irradiance code with diffuse lighting;
  // avoid evaluating the metallic BRDF/IBL across half the screen every frame.
  // The URL switch keeps a same-build visual/perf control for this stage only.
  if (new URLSearchParams(location.search).get('s1DiffuseSoil') !== '0') {
    const source = mat;
    mat = new THREE.MeshLambertMaterial({color:0xffffff});
    mat.onBeforeCompile = source.onBeforeCompile;
    mat.customProgramCacheKey = () => source.customProgramCacheKey() + '|s1DiffuseSoil';
    source.dispose();
  }
  roadDetail(mat, huts);
  groundFirelight(mat, huts, rocks);
  // Each ground fragment sampled the shared noise atlas at many scales with
  // four-way anisotropy. The shader already fades subpixel detail with fwidth;
  // trilinear mips suffice for this low-contrast soil noise. Keep the clone local.
  const noise = shared.uNoise.value.clone();
  noise.anisotropy = new URLSearchParams(location.search).get('s1SoilAniso') === '4' ? 4 : 1;
  noise.needsUpdate = true;
  const compile = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    compile.call(mat, shader, renderer);
    shader.uniforms.kNoise = {value:noise};
  };
  mat.addEventListener('dispose', () => noise.dispose());
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  ctx.group.add(mesh);
  return mesh;
}
