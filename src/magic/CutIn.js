// CutIn: T3+ spell close-up of a burning / shocked enemy face, as a slanted comic-panel INSET composited in the
// main scene pass (so bloom + grade apply). A second small camera renders the victim's head into a render target
// during MagicSystem.render (before the frame's main render); the panel is a clip-space quad (depthTest off).
//
//   cutIn.show(target, { element, seconds = 1.0, side = +1 (panel on the right), zoom = 1 })
//   cutIn.update(frameDt)    (MagicSystem.render)      cutIn.lastCalls = draw calls of the inset render (budget)
import * as THREE from 'three';
import { PALETTES } from '../vfx/palette.js';
import { lookForActors } from '../render/characterLook.js';

const W = 1024, H = 292;
const _hb = new THREE.Vector3();

export class CutIn {
  constructor(game) {
    this.game = game;
    this.rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 });
    this.rt.depthTexture = new THREE.DepthTexture(W, H);
    this.rt.texture.generateMipmaps = true; this.rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.cam = new THREE.PerspectiveCamera(15, W / H, 0.6, 80);
    this.active = null;
    this.lastCalls = 0;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: this.rt.texture }, uRect: { value: new THREE.Vector4(0.2, 0.3, 0.75, 0.34) }, uA: { value: 0 }, uT: { value: 0 },
        uEdge: { value: new THREE.Color('#ff7a20') }, uTint: { value: new THREE.Color('#ffb070') }, uGain: { value: 1 }, uSide: { value: 1 }, uMode: { value: 0 },
        uDepth: { value: this.rt.depthTexture }, uTexel: { value: new THREE.Vector2(1 / W, 1 / H) }, uClip: { value: new THREE.Vector3(0.6, 80, 2) },
      },
      vertexShader: `uniform vec4 uRect; varying vec2 vUv;
        void main(){ vUv = uv; vec2 c = uRect.xy + (uv - 0.5) * uRect.zw; gl_Position = vec4(c, 0.0, 1.0); }`,
      fragmentShader: `uniform sampler2D uTex; uniform sampler2D uDepth; uniform float uA; uniform float uT; uniform vec3 uEdge; uniform vec3 uTint; uniform float uGain; uniform float uSide; uniform float uMode;
        uniform vec2 uTexel; uniform vec3 uClip; // near, far, focus distance
        varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
        float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
        float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<4;i++){ s+=a*vn(p); p*=2.03; a*=0.5; } return s; }
        float vz(vec2 uv){ float d = texture2D(uDepth, uv).x * 2.0 - 1.0; float n = uClip.x, f = uClip.y; return 2.0 * n * f / (f + n - d * (f - n)); }
        vec3 tap(vec2 uv){ vec3 c = texture2D(uTex, uv).rgb; c = clamp(c, vec3(0.0), vec3(64.0)); if (c.r != c.r || c.g != c.g || c.b != c.b) c = vec3(0.0); return c; }
        float lum(vec3 c){ return dot(c, vec3(0.3, 0.55, 0.15)); }
        void main(){
          // slanted parallelogram panel that wipes in along its length
          float sl = 0.16 * uSide;
          float x = vUv.x + (vUv.y - 0.5) * sl;
          float wipe = clamp(uA * 1.25, 0.0, 1.0);
          float x0 = uSide > 0.0 ? 1.0 - wipe : 0.0, x1 = uSide > 0.0 ? 1.0 : wipe;
          if (x < x0 || x > x1 || x < 0.02 || x > 0.98) discard;
          float bx = min(x - max(0.02, x0), min(x1, 0.98) - x), by = min(vUv.y, 1.0 - vUv.y);
          float border = 1.0 - smoothstep(0.0, 0.012, min(bx * 0.45, by));
          float borderInk = 1.0 - smoothstep(0.012, 0.02, min(bx * 0.45, by));
          vec2 uv = vec2(clamp(x, 0.0, 1.0), vUv.y);
          // auto-exposure from the local average around the face (mip of the inset), so a dark-held scene still
          // gives a bright, legible close-up
          float avg = lum(clamp(textureLod(uTex, vec2(0.5, 0.55), 5.0).rgb, vec3(0.0), vec3(64.0)));
          float gain = clamp(0.42 / max(avg, 0.004), 1.0, 14.0) * uGain;
          vec3 img = tap(uv) * gain;
          // subject mask from depth: the victim (near the focus distance) vs the world behind it
          float z = vz(uv);
          float fg = 1.0 - smoothstep(uClip.z + 0.6, uClip.z + 1.2, z);
          // INK: silhouette lines from depth jumps + interior feature lines from luminance edges (comic line art)
          vec2 t = uTexel * 1.5;
          float zl = vz(uv - vec2(t.x, 0.0)), zr = vz(uv + vec2(t.x, 0.0)), zd = vz(uv - vec2(0.0, t.y)), zu = vz(uv + vec2(0.0, t.y));
          float dz = max(max(abs(zl - z), abs(zr - z)), max(abs(zd - z), abs(zu - z)));
          float sil = smoothstep(0.08, 0.25, dz) * max(fg, 1.0 - smoothstep(uClip.z + 0.6, uClip.z + 1.2, min(min(zl, zr), min(zd, zu))));
          float gl = lum(tap(uv - vec2(t.x, 0.0))) - lum(tap(uv + vec2(t.x, 0.0)));
          float gv = lum(tap(uv - vec2(0.0, t.y))) - lum(tap(uv + vec2(0.0, t.y)));
          float edge = smoothstep(0.05, 0.16, length(vec2(gl, gv)) * gain / (0.4 + lum(img)));
          // subject: tone curve + 3-band cel posterise (keeps planes of the face crisp), warm element key
          vec3 s = 1.0 - exp(-img * (uMode > 1.5 ? 1.05 : 1.6));
          float l = lum(s);
          float band = l < 0.22 ? 0.16 : l < 0.5 ? 0.42 : l < 0.78 ? 0.7 : 0.9;
          s = mix(s, s * (band / max(l, 0.001)), uMode > 1.5 ? 0.0 : .55);
          s = mix(s, s * mix(vec3(1.0), uTint, 0.35), 0.8);
          s = mix(s, vec3(0.012), edge * (uMode > 1.5 ? .20 : .55) * fg);
          // Earth keeps continuous face lighting, with depth-based recession instead of flat cel bands.
          if (uMode > 1.5) s *= .72 + .28 * exp(-abs(z-uClip.z)*1.8);
          // backdrop: flat comic field with radial speed lines + element motif (never over the face)
          vec2 q = (uv - vec2(0.5, 0.55)) * vec2(3.5, 1.0);
          float ang = atan(q.y, q.x), r = length(q);
          float lines = step(0.72, h(vec2(floor(ang * 34.0), floor(uT * 18.0))));
          vec3 bg = mix(uEdge * 0.55, uEdge * 0.12, smoothstep(0.1, 1.2, r));
          bg = mix(bg, uTint * 0.75, lines * smoothstep(0.25, 0.8, r));
          if (uMode < 0.5) {
            float n = fbm(vec2(uv.x * 7.0, uv.y * 3.0 - uT * 5.0));
            float f = smoothstep(0.0, 0.25, (0.4 - uv.y) * 1.8 + (n - 0.5) * 0.9);
            bg = mix(bg, mix(uEdge * 0.9, uTint * 0.95, smoothstep(0.3, 0.9, f)), f * 0.9);
          } else if (uMode < 1.5) {
            for (int k = 0; k < 3; k++) {
              float fk = float(k);
              float yy = 0.2 + 0.3 * fk + (fbm(vec2(uv.x * 6.0 + fk * 7.0, floor(uT * 16.0) + fk)) - 0.5) * 0.35;
              float bl = 1.0 - smoothstep(0.0, 0.01, abs(uv.y - yy));
              bg = mix(bg, uTint * 0.95, bl * step(0.35, h(vec2(fk, floor(uT * 12.0)))));
            }
          } else {
            float n = fbm(uv * vec2(5.0, 3.0) + vec2(uT * 1.5, 0.0));
            bg = mix(vec3(.035, .028, .025), uEdge * .25, n * smoothstep(.1, 1.0, uv.y));
            float fault = abs(uv.x - .25 - .11 * sin(uv.y * 12.0) - .04 * sin(uv.y * 29.0));
            bg += uTint * exp(-fault * 160.0) * (.8 - uv.y * .6);
            // Small tapered stone flecks, never axis-aligned white square confetti.
            vec2 cell = uv * vec2(72.0, 23.0) + vec2(uT * 1.4, -uT * .7);
            vec2 shard = fract(cell) - .5;
            float fleck = (1.0-smoothstep(.12,.26,abs(shard.x+shard.y*.7)+abs(shard.y)*1.8))
              * step(.96,h(floor(cell)));
            bg += mix(vec3(.08,.045,.025),uEdge*.20,h(floor(cell)+7.0)) * fleck;
          }
          vec3 col = mix(bg, s, fg);
          col = mix(col, vec3(0.01, 0.006, 0.004), sil);                 // thick silhouette ink
          col = min(col, vec3(0.95));                                      // stays under the bloom threshold: crisp
          col = mix(col, vec3(0.0), borderInk * 0.9);
          col = mix(col, uEdge * 0.95, border);
          gl_FragColor = vec4(col, 1.0);
        }`,
      depthTest: false, depthWrite: false, transparent: true,
    });
    const geo = new THREE.PlaneGeometry(1, 1);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10000;
    this.mesh.visible = false;
    this.mesh.name = 'magic_cutin';
    this._hp = new THREE.Vector3();
  }

  _attach() { if (!this.mesh.parent && this.game.scene) this.game.scene.add(this.mesh); }

  show(target, { element = 'fire', seconds = 1.0, side = 1, zoom = 1 } = {}) {
    if (!target || !this.game.renderer || !this.game.renderer.webgl) return;
    this._attach();
    const pal = PALETTES[element] || PALETTES.fire;
    this.material.uniforms.uEdge.value.set(pal.mid);
    this.material.uniforms.uTint.value.set(pal.hot);
    this.material.uniforms.uSide.value = side;
    this.material.uniforms.uMode.value = element === 'storm' ? 1 : element === 'earth' ? 2 : 0;
    const bones = target.model && target.model.rigInfo && target.model.rigInfo.bones;
    this.active = { target, element, head: bones && bones.get('head') ? bones.get('head').node : null, t: 0, seconds, side, zoom };
    // freeze the victim mid-reaction for the close-up beat (the Golden Axe "burning face" hold)
    target.hitstop = Math.max(target.hitstop || 0, 16);
    // Earth impact can KO/remove or blink the subject before the next render. Capture its
    // current posed face now, while it is still present, and hold that exact reaction.
    if (element === 'earth') { this.update(0); if (this.active) this.active.snapshot = true; }
  }

  hide() { this.active = null; this.mesh.visible = false; }

  update(frameDt) {
    const a = this.active;
    if (!a) return;
    a.t += frameDt; // real time: a cut-in holds through slow-mo
    const k = a.t / a.seconds;
    if (k >= 1 || !a.target || (a.target.removed && !a.snapshot)) { this.hide(); return; }
    const inA = a.element === 'earth' ? 1 : Math.min(1, a.t / 0.12), outA = Math.min(1, (a.seconds - a.t) / 0.14);
    const U = this.material.uniforms;
    U.uA.value = Math.min(inA, outA); U.uT.value = a.t;
    const r = this.game.renderer;
    U.uGain.value = 1.0 / Math.max(0.5, r.exposureMul ?? 1);
    if (a.snapshot) { this.mesh.visible = true; return; }
    U.uClip.value.set(this.cam.near, this.cam.far, 0);
    // panel rect in NDC: upper band, on `side`
    U.uRect.value.set(a.side * 0.47, 0.5, 0.9, 0.46);
    // camera: in front of the head (toward the viewer), slow push-in
    const hp = this._hp;
    // aim: the head bone when it sits where a head should (top 25% of the body), else the body's head height
    const H = a.target.height || 1.8;
    hp.set(a.target.pos.x, a.target.pos.y + H * 0.9, a.target.pos.z);
    if (a.head) { a.head.getWorldPosition(_hb); if (a.element === 'earth' || _hb.y - a.target.pos.y > H * 0.35 || a.target.fsm && !a.target.fsm.is('idle', 'walk', 'hurt', 'hitstun')) hp.copy(_hb); }
    hp.y -= 0.12;   // centre between face and chest: the whole head + shoulders + hands read in the panel
    hp.y += 0.04;
    // telephoto zoom along the gameplay view ray (nothing new can occlude; near plane clips what is in front)
    const mc = this.game.camera;
    const dist = (3.3 - k * 0.5) / a.zoom;
    const dx = mc.position.x - hp.x, dy = mc.position.y - hp.y, dz = mc.position.z - hp.z, L = Math.hypot(dx, dy, dz) || 1;
    // 3/4 FRONT view of the face: blend the gameplay view ray with the victim's facing (it faces the caster), so
    // the panel shows a face + raised hands, not the back of a head or a forearm crossing the lens
    const face = a.target.facing || 1;
    let vx = (dx / L) * 0.7 + face * 1.0, vy = (dy / L) * 0.25 + 0.08, vz = (dz / L) * 0.7;
    const vl = Math.hypot(vx, vy, vz) || 1; vx /= vl; vy /= vl; vz /= vl;
    this.cam.position.set(hp.x + vx * dist, hp.y + vy * dist, hp.z + vz * dist);
    this.cam.lookAt(hp.x, hp.y - 0.04, hp.z);
    this.cam.rotateZ(a.side * -0.06);
    U.uClip.value.z = this.cam.position.distanceTo(hp);
    const gl = r.webgl;
    const prevTarget = gl.getRenderTarget(), prevAuto = gl.autoClear, prevShadow = gl.shadowMap.autoUpdate;
    this.mesh.visible = false;
    const vg = this.game.vfx && this.game.vfx.group, vgVis = vg ? vg.visible : true;
    if (vg) vg.visible = false;
    // perf-1650 r4: the very first inset draw (boot prewarm) can precede any main-scene render, i.e. the sun's shadow
    // map does not exist yet and its sampler2DShadow is bound to a non-comparison texture → GL_INVALID_OPERATION on
    // every lit draw (28+ console errors per boot). Let that one draw allocate/render the maps; afterwards freeze them.
    gl.shadowMap.autoUpdate = this._shadowSeen ? false : prevShadow;
    this._shadowSeen = true;
    gl.setRenderTarget(this.rt);
    gl.autoClear = true;
    const before = gl.info.render.calls;
    // perf-1650 r3: patch new actors (hit flash, then the look — Renderer.render's order) BEFORE the inset draw: a foe
    // spawned this frame was drawn UNPATCHED here → a program the prewarm never linked (perfbench S1 boss: brute twins)
    try { const hf = this.game.vfx && this.game.vfx.hitFlash; if (hf && hf.scan) hf.scan(); lookForActors(this.game.world); } catch (e) { /* cosmetic */ }
    // Earth uses a depth-matted comic background already: drawing the whole village again behind its
    // subject only consumed triangles. Keep every light enabled (same program/light budget), hide meshes only.
    const hidden = [], shown = [];
    if (a.element === 'earth') {
      // Damage invulnerability blinks modelRoot; it must not make an empty reaction card.
      for (let p = a.target.modelRoot || a.target.view; p && p !== this.game.scene; p = p.parent)
        if (!p.visible) { shown.push(p); p.visible = true; }
      a.target.view.updateMatrixWorld(true);
    }
    if (a.element === 'earth') this.game.scene.traverse(o => {
      if (!o.isMesh || !o.visible) return;
      for (let p = o; p; p = p.parent) if (p === a.target.view) return;
      hidden.push(o); o.visible = false;
    });
    try { gl.render(this.game.scene, this.cam); } finally {
      for (const o of hidden) o.visible = true;
      for (const o of shown) o.visible = false;
      this.lastCalls = gl.info.render.calls - before;
      gl.setRenderTarget(prevTarget); gl.autoClear = prevAuto; gl.shadowMap.autoUpdate = prevShadow;
      if (vg) vg.visible = vgVis;
    }
    this.mesh.visible = true;
  }

  dispose() { this.hide(); if (this.mesh.parent) this.mesh.parent.remove(this.mesh); this.rt.dispose(); this.material.dispose(); this.mesh.geometry.dispose(); }
}
