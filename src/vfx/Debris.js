// Debris: instanced, LIT 3D chips (rock, clod, splinter) with bounce + settle + shrink-out. One draw call.
//   pool.burst({ pos:{x,y,z}, groundY, count, speed:[min,max], up:[min,max], spread (rad around dir), dir:[x,y,z]|null,
//                size:[min,max], color:'#hex'|Color, life:[min,max], kind:'rock'|'splinter'|'clod', bounce })
//   pool.emit({ pos, vel, size, color, life, kind, groundY, spin })
import * as THREE from 'three';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _ax = new THREE.Vector3();
const _c = new THREE.Color();
const KIND = { rock: 0, clod: 1, splinter: 2, stone: 3, metal: 4 };

function rockGeometry() {
  const g = new THREE.IcosahedronGeometry(0.5, 1);
  const pos = g.attributes.position;
  // Deterministic jitter per unique vertex → chunky faceted chip, flattened a bit.
  const seen = new Map();
  for (let i = 0; i < pos.count; i++) {
    const k = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let j = seen.get(k);
    if (!j) { const h = Math.sin(i * 12.9898 + seen.size * 78.233) * 43758.5453; j = 0.72 + (h - Math.floor(h)) * 0.5; seen.set(k, j); }
    pos.setXYZ(i, pos.getX(i) * j, pos.getY(i) * j * 0.72, pos.getZ(i) * j);
  }
  g.computeVertexNormals();
  return g;
}

export class DebrisPool {
  constructor({ capacity = 160, shadows = false } = {}) {
    this.cap = capacity; this.n = 0;
    const N = capacity;
    this.pos = new Float32Array(N * 3); this.vel = new Float32Array(N * 3);
    this.axis = new Float32Array(N * 3); this.ang = new Float32Array(N); this.angVel = new Float32Array(N);
    this.size = new Float32Array(N); this.kind = new Uint8Array(N);
    this.age = new Float32Array(N); this.life = new Float32Array(N); this.ground = new Float32Array(N);
    this.bounce = new Float32Array(N); this.rest = new Uint8Array(N);
    this.col = new Float32Array(N * 3);
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, flatShading: true });
    // Stone surface is opt-in, so metal/wood and other effects retain their original material response.
    this.material.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float iStone; varying vec3 vStonePos; varying float vStone;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvStonePos = position; vStone = iStone;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vStonePos; varying float vStone;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          if (vStone > 0.5 && vStone < 1.5) {
            vec3 cells = floor(vStonePos * 65.0);
            float grain = fract(sin(dot(cells,vec3(127.1,311.7,74.7))) * 43758.5453);
            float band = sin(vStonePos.x * 36.0 + vStonePos.y * 24.0 + sin(vStonePos.z * 21.0) * 1.3);
            diffuseColor.rgb *= (0.92 + grain * 0.16) * mix(0.9,1.0,smoothstep(-0.92,-0.65,band));
          }`)
        .replace('#include <opaque_fragment>', `
          // Warm mineral fill and a small rim keep shadowed stone facets readable at night.
          if (vStone > 0.5 && vStone < 1.5) {
            float rim = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.0);
            outgoingLight = max(outgoingLight, diffuseColor.rgb * vec3(0.38, 0.33, 0.26));
            outgoingLight += diffuseColor.rgb * vec3(0.12, 0.09, 0.045) * rim;
          }
          // Thin incandescent metal splinters use this same warmed pool/program.
          if (vStone > 1.5) outgoingLight = max(outgoingLight, diffuseColor.rgb * 4.0);
          #include <opaque_fragment>`);
    };
    this.material.customProgramCacheKey = () => 'vfxStoneMetalSurface3';
    this.mesh = new THREE.InstancedMesh(rockGeometry(), this.material, N);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.stoneAttribute = new THREE.InstancedBufferAttribute(new Float32Array(N), 1).setUsage(THREE.DynamicDrawUsage);
    this.mesh.geometry.setAttribute('iStone', this.stoneAttribute);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = shadows;
    this.mesh.name = 'vfx_debris';
    this.mesh.userData.sharedGeometry = true; this.mesh.userData.sharedMaterial = true;
  }

  emit(o) {
    if (this.n >= this.cap) return -1;
    const i = this.n++;
    const P = o.pos, V = o.vel || [0, 0, 0];
    this.pos[i * 3] = P.x ?? P[0]; this.pos[i * 3 + 1] = P.y ?? P[1]; this.pos[i * 3 + 2] = P.z ?? P[2];
    this.vel[i * 3] = V.x ?? V[0]; this.vel[i * 3 + 1] = V.y ?? V[1]; this.vel[i * 3 + 2] = V.z ?? V[2];
    _ax.set(Math.sin(i * 1.7 + 0.3), Math.cos(i * 2.3), Math.sin(i * 0.9 + 1.1)).normalize();
    this.axis[i * 3] = _ax.x; this.axis[i * 3 + 1] = _ax.y; this.axis[i * 3 + 2] = _ax.z;
    this.ang[i] = i * 0.77; this.angVel[i] = o.spin ?? 12;
    this.size[i] = o.size ?? 0.06; this.kind[i] = KIND[o.kind] ?? 0;
    this.age[i] = 0; this.life[i] = o.life ?? 1.2; this.ground[i] = o.groundY ?? 0; this.bounce[i] = o.bounce ?? 0.32; this.rest[i] = 0;
    if (o.color && o.color.isColor) _c.copy(o.color); else _c.set(o.color ?? '#5a4a3c');
    this.col[i * 3] = _c.r; this.col[i * 3 + 1] = _c.g; this.col[i * 3 + 2] = _c.b;
    return i;
  }

  burst(o = {}, rng) {
    const r = rng || { range: (a, b) => a + Math.random() * (b - a) };
    const p = o.pos || { x: 0, y: 0, z: 0 };
    const n = Math.max(0, Math.round(o.count ?? 6));
    const sp = o.speed || [1.5, 4], up = o.up || [2, 5], sz = o.size || [0.04, 0.09], lf = o.life || [0.9, 1.5];
    const base = _c.set(o.color ?? '#5a4a3c').clone();
    const dir = o.dir || null, spread = o.spread ?? Math.PI;
    const baseA = dir ? Math.atan2(dir[2] ?? dir.z ?? 0, dir[0] ?? dir.x ?? 1) : 0;
    for (let k = 0; k < n; k++) {
      const a = dir ? baseA + r.range(-spread, spread) : r.range(0, Math.PI * 2);
      const s = r.range(sp[0], sp[1]);
      const col = base.clone().multiplyScalar(r.range(0.7, 1.15));
      this.emit({
        pos: [p.x + r.range(-0.08, 0.08), (p.y ?? 0) + r.range(0.02, 0.12), p.z + r.range(-0.06, 0.06)],
        vel: [Math.cos(a) * s, r.range(up[0], up[1]), Math.sin(a) * s * 0.7],
        size: r.range(sz[0], sz[1]), color: col, life: r.range(lf[0], lf[1]), kind: o.kind || 'rock',
        groundY: o.groundY ?? 0, spin: r.range(6, 18) * (r.range(0, 1) < 0.5 ? -1 : 1), bounce: o.bounce,
      });
    }
  }

  _kill(i) {
    const j = --this.n;
    if (i === j) return;
    for (const a of [this.pos, this.vel, this.axis, this.col]) { a[i * 3] = a[j * 3]; a[i * 3 + 1] = a[j * 3 + 1]; a[i * 3 + 2] = a[j * 3 + 2]; }
    for (const a of [this.ang, this.angVel, this.size, this.kind, this.age, this.life, this.ground, this.bounce, this.rest]) a[i] = a[j];
  }

  update(dt) {
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this._kill(i); i--; continue; }
      if (this.rest[i]) continue;
      const o = i * 3;
      this.vel[o + 1] -= 16 * dt;
      this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
      this.ang[i] += this.angVel[i] * dt;
      const floor = this.ground[i] + this.size[i] * 0.3;
      if (this.pos[o + 1] < floor) {
        this.pos[o + 1] = floor;
        if (Math.abs(this.vel[o + 1]) < 1.2) { this.rest[i] = 1; this.vel[o] = this.vel[o + 1] = this.vel[o + 2] = 0; }
        else { this.vel[o + 1] *= -this.bounce[i]; this.vel[o] *= 0.55; this.vel[o + 2] *= 0.55; this.angVel[i] *= 0.5; }
      }
    }
    const M = this.mesh.instanceMatrix.array, C = this.mesh.instanceColor.array;
    for (let i = 0; i < this.n; i++) {
      const o = i * 3;
      const t = this.age[i] / this.life[i];
      const shrink = t > 0.7 ? Math.max(0, 1 - (t - 0.7) / 0.3) : 1;
      const s = this.size[i] * shrink;
      _ax.set(this.axis[o], this.axis[o + 1], this.axis[o + 2]);
      _q.setFromAxisAngle(_ax, this.ang[i]);
      const k = this.kind[i];
      if (k === 4) _s.set(s * 0.30, s * 4.2, s * 0.20); else if (k === 2) _s.set(s * 0.35, s * 2.2, s * 0.35); else if (k === 1) _s.set(s * 1.2, s * 0.8, s * 1.1); else _s.set(s, s, s);
      _p.set(this.pos[o], this.pos[o + 1], this.pos[o + 2]);
      _m.compose(_p, _q, _s);
      _m.toArray(M, i * 16);
      this.stoneAttribute.array[i] = k === 3 ? 1 : k === 4 ? 2 : 0;
      C[o] = this.col[o]; C[o + 1] = this.col[o + 1]; C[o + 2] = this.col[o + 2];
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    this.stoneAttribute.needsUpdate = true;
  }

  clear() { this.n = 0; this.mesh.count = 0; }
  dispose() { this.mesh.geometry.dispose(); this.material.dispose(); }
}
