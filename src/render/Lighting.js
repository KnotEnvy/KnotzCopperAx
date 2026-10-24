// Lighting rig + stage LOOK. One shadow-casting key ("sun") that follows the camera focus (texel-snapped against
// shimmer), a cool no-shadow FILL, a hot no-shadow RIM/back light for the painted box-art edge, a hemisphere
// ambient, a PMREM environment generated from the painted sky, the game-wide fog (distance + height + sun
// inscatter, render/fog.js), the character-readability rim (render/characterLook.js) and the post look
// (tonemap, grade, bloom, vignette, grain → PostFX.applyLook). Stages call game.renderer.lighting.apply(preset).
//
// preset = {
//   base:  '<name>'  (render/lightingPresets.js; the rest of this object deep-merges on top)
//   sky:   { top, horizon, bottom, zenith, horizonSun, sunDir:[x,y,z], sunColor, sunDisc, sunSize, sunGlow, hazeHeight, stars, clouds:{...} }
//   sun:   { color, intensity, dir:[x,y,z] (toward the light), shadow:true, bias, normalBias, radius, frustum:[l,r,t,b] }
//   fill:  { color, intensity, dir }     hemi: { sky, ground, intensity }     rim: { color, intensity, dir }
//   fog:   { color, near, far | density, height:{ density, base, falloff, start, max, color }, sun:{ color, strength, power } }
//   env:   { intensity }   exposure: 1.0   background: 'sky' | '#hex'
//   tonemap: 'agx'|'aces'|'neutral'   grade: { saturation, contrast, vibrance, lift, gamma, gain, wb, shadowTint, highlightTint, split }
//   bloom: { intensity, threshold, smoothing, radius }   vignette: { offset, darkness }   grain: 0..0.06
//   character: { rim, intensity, power, floor, base, edge, width, maxNdv, edgeNear, edgeFar, key:{color,intensity,dir}, ambient, ambientIntensity }
//              (actor-only rim edge + Fresnel + key light; see characterLook.js)
//   wind: { dir:[x,z], strength, gust }                  (foliage, smoke, flames, particles)
// }
// lighting.preset is the fully merged result (safe to spread and re-apply). lighting.look is what PostFX receives.
import * as THREE from 'three';
import { Sky } from './Sky.js';
import { applyFog } from './fog.js';
import { charUniforms, charKeyWorldDir, setCharacterLook } from './characterLook.js';
import { shared } from './shaderlib.js';
import { PRESETS } from './lightingPresets.js';

export const DEFAULT_LIGHTING = {
  sky: { top: '#27324d', horizon: '#d68b5c', bottom: '#241914', sunDir: [-0.45, 0.22, -1], sunColor: '#ffae6b', sunGlow: 1, hazeHeight: 0.5 },
  sun: { color: '#ffd2a1', intensity: 3.2, dir: [-0.55, 0.9, 0.55], shadow: true, radius: 3, frustum: [-16, 16, 14, -10] },
  fill: { color: '#7a88c0', intensity: 0.3, dir: [-0.6, 0.35, 0.75] },
  hemi: { sky: '#8aa0c8', ground: '#4a3024', intensity: 0.55 },
  rim: { color: '#ffb27a', intensity: 1.6, dir: [0.3, 0.55, -1] },
  fog: { color: '#8a6452', near: 30, far: 140 },
  env: { intensity: 0.55 },
  exposure: 1.0,
  tonemap: 'agx',
  grade: {},
  bloom: {},
  vignette: {},
  character: { rim: '#ffc090', intensity: 0.7, power: 3, floor: 0.04, base: 0.35 },
  wind: { dir: [1, 0], strength: 0.5, gust: 0.8 },
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v) && !(v.isColor || v.isVector3);
export function mergeDeep(base, over) {
  if (!isObj(over)) return over === undefined ? base : over;
  const out = { ...(isObj(base) ? base : {}) };
  for (const k of Object.keys(over)) out[k] = isObj(over[k]) && isObj(out[k]) ? mergeDeep(out[k], over[k]) : over[k];
  return out;
}

export class Lighting {
  constructor(renderer, scene, quality) {
    this.renderer = renderer; // THREE.WebGLRenderer
    this.scene = scene;
    this.quality = quality;
    this.post = null;         // set by Renderer once PostFX exists
    this.group = new THREE.Group();
    this.group.name = 'lighting';
    scene.add(this.group);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const s = this.sun.shadow;
    s.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    s.camera.left = -16; s.camera.right = 16; s.camera.top = 14; s.camera.bottom = -10;
    s.camera.near = 0.5; s.camera.far = 90;
    s.bias = -0.0004; s.normalBias = 0.03; s.radius = 3;
    this.sunTarget = new THREE.Object3D();
    this.sun.target = this.sunTarget;
    this.group.add(this.sun, this.sunTarget);
    this.sunDir = new THREE.Vector3(-0.55, 0.9, 0.55).normalize();

    this.fill = new THREE.DirectionalLight(0x7a88c0, 0.3);
    this.fillTarget = new THREE.Object3D();
    this.fill.target = this.fillTarget;
    this.fillDir = new THREE.Vector3(-0.6, 0.35, 0.75).normalize();
    this.group.add(this.fill, this.fillTarget);

    this.hemi = new THREE.HemisphereLight(0x8aa0c8, 0x4a3024, 0.5);
    this.group.add(this.hemi);
    this.rim = new THREE.DirectionalLight(0xffb27a, 1.5);
    this.rimTarget = new THREE.Object3D();
    this.rim.target = this.rimTarget;
    this.rimDir = new THREE.Vector3(0.3, 0.55, -1).normalize();
    this.group.add(this.rim, this.rimTarget);

    this.sky = new Sky();
    scene.add(this.sky.mesh);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this.focus = new THREE.Vector3();
    this.preset = null;
    this.look = {};
  }

  apply(preset = {}) {
    const named = preset && typeof preset.base === 'string' ? PRESETS[preset.base] : null;
    const src = named ? mergeDeep(named, preset) : preset;
    const p = mergeDeep(DEFAULT_LIGHTING, src || {});
    delete p.base;
    this.preset = p;
    this.sky.set(p.sky);
    this.sun.color.set(p.sun.color); this.sun.intensity = p.sun.intensity;
    this.sunDir.fromArray(p.sun.dir).normalize();
    this.sun.castShadow = p.sun.shadow !== false;
    const sh = this.sun.shadow;
    sh.bias = p.sun.bias ?? -0.0004; sh.normalBias = p.sun.normalBias ?? 0.03; sh.radius = p.sun.radius ?? 3;
    const fr = p.sun.frustum || [-16, 16, 14, -10];
    sh.camera.left = fr[0]; sh.camera.right = fr[1]; sh.camera.top = fr[2]; sh.camera.bottom = fr[3]; sh.camera.updateProjectionMatrix();
    this.fill.color.set(p.fill.color); this.fill.intensity = p.fill.intensity; this.fillDir.fromArray(p.fill.dir).normalize();
    this.fill.visible = p.fill.intensity > 0;
    this.hemi.color.set(p.hemi.sky); this.hemi.groundColor.set(p.hemi.ground); this.hemi.intensity = p.hemi.intensity;
    this.rim.color.set(p.rim.color); this.rim.intensity = p.rim.intensity; this.rimDir.fromArray(p.rim.dir).normalize();
    applyFog(this.scene, p.fog, p.sky.sunDir);
    this.sky.mesh.visible = p.background === undefined || p.background === 'sky';
    this.scene.background = this.sky.mesh.visible ? null : new THREE.Color(p.background);
    this.exposure = p.exposure ?? 1;
    // r4: actors never reach the bloom threshold unless the preset says otherwise (only emissives/fire/magic bloom)
    setCharacterLook(p.character, { bloomThreshold: p.bloom?.threshold ?? 1.1 });
    const w = p.wind;
    const wl = Math.hypot(w.dir[0], w.dir[1]) || 1;
    shared.uWind.value.set(w.dir[0] / wl, w.dir[1] / wl, w.strength ?? 0.5, w.gust ?? 0.8);
    this.look = { tonemap: p.tonemap, grade: p.grade, bloom: p.bloom, vignette: p.vignette, grain: p.grain };
    if (this.post) this.post.applyLook(this.look);
    this.buildEnv(p.env?.intensity ?? 0.5);
  }

  /** Regenerate the PMREM environment from the current sky (call after changing sky colours). */
  buildEnv(intensity = 0.5) {
    const envScene = new THREE.Scene();
    const skyCopy = new THREE.Mesh(this.sky.mesh.geometry, this.sky.material);
    envScene.add(skyCopy);
    // A warm ground bounce disc so the lower hemisphere isn't black.
    const ground = new THREE.Mesh(new THREE.CircleGeometry(300, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(this.hemi.groundColor).multiplyScalar(0.6), side: THREE.DoubleSide }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -8;
    envScene.add(ground);
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(envScene, 0.02, 0.1, 1000, { size: this.quality.envResolution });
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = intensity;
    ground.geometry.dispose(); ground.material.dispose();
  }

  /** Called every render with the camera focus + camera; keeps the sun's shadow frustum on the action. */
  update(focus, camera) {
    this.focus.copy(focus);
    // Adaptive shadow refresh (r3 perf): the key's shadow pass costs ~4 ms GPU at 1080p on a GTX 1650 Ti-class GPU.
    // When the smoothed frame time says we're missing 60 Hz, re-render the shadow map every 2nd frame (the matrix is
    // captured with the map, so a skipped frame is only a 16 ms lag, never a misaligned shadow); back to every frame
    // once there's headroom. ?shadowrate=1|2 forces a rate (capture=1 runs force 1).
    const now = performance.now(), fdt = this._lastT ? Math.min(100, now - this._lastT) : 16.7; this._lastT = now;
    this._ft = this._ft ? this._ft + (fdt - this._ft) * 0.05 : fdt;
    if (!this._forcedRate) { const q = new URLSearchParams(location.search); this._forcedRate = +q.get('shadowrate') || (q.has('capture') ? 1 : -1); } // manual-clock captures: every frame
    if (this._forcedRate > 0) this.shadowEvery = this._forcedRate;
    else if (this._ft > 18.5) this.shadowEvery = 2; else if (this._ft < 14) this.shadowEvery = 1;
    this._frame = (this._frame || 0) + 1;
    const sh = this.sun.shadow; sh.autoUpdate = false;
    if ((this.shadowEvery || 1) <= 1 || this._frame % this.shadowEvery === 0) sh.needsUpdate = true;
    // Texel snapping: quantize the focus along the light's view plane.
    const size = this.quality.shadowMapSize;
    const cam = this.sun.shadow.camera;
    const texel = (cam.right - cam.left) / size;
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    this.sunTarget.position.set(fx, 0, fz);
    this.sun.position.set(fx + this.sunDir.x * 45, this.sunDir.y * 45, fz + this.sunDir.z * 45);
    this.rimTarget.position.set(focus.x, 1, focus.z);
    this.rim.position.set(focus.x + this.rimDir.x * 30, 1 + this.rimDir.y * 30, focus.z + this.rimDir.z * 30);
    this.fillTarget.position.set(focus.x, 1, focus.z);
    this.fill.position.set(focus.x + this.fillDir.x * 30, 1 + this.fillDir.y * 30, focus.z + this.fillDir.z * 30);
    if (camera) {
      this.sky.mesh.position.copy(camera.position);
      charUniforms.kRimDir.value.copy(this.rimDir).transformDirection(camera.matrixWorldInverse);
      charUniforms.kKeyDir.value.copy(charKeyWorldDir).transformDirection(camera.matrixWorldInverse);
    }
  }
}
