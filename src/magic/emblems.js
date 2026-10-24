// Emblems: hard-edged, ink-outlined, toon-banded flame SILHOUETTES for the spells' payoff beats (magic-owned).
// The additive pools stack to a shapeless white smear at peak moments; an emblem is a camera-facing quad whose
// shape comes from a procedurally drawn mask (canvas → 2-channel texture: R = sharp coverage for the edge,
// G = wide blur = "depth inside the shape" for the colour bands). It is blended premultiplied-OVER (not additive),
// so overlapping emblems never sum to white, and every silhouette carries a dark ink rim that keeps its outline
// readable through bloom. Kinds: 'pillar' (fire column), 'phoenix' (heraldic spread-wing bird), 'sun' (curved
// flame corona), 'star' (angular storm burst), 'drake' (dragon head profile: horns, open jaw, teeth).
//
//   emblem(vfx, 'pillar', { pos:{x,y,z}, size:[w,h], colors:{core,hot,mid,ink}, life, rise, burn, intensity,
//          anchor:'bottom'|'center', follow(age, o) → {x,y,z,rot,sx,sy}?, flipX, delay, wob, flick }) → mesh
//   warmEmblems(game)  draw one invisible emblem for a frame so the shader compiles at load, not on the first cast
import * as THREE from 'three';

const MASKS = {};
const TAU = Math.PI * 2;

/** Teardrop "leaf" from a rounded root (x0,y0) to a sharp tip (x1,y1); bend = tip-side sideways curl (px). */
function leaf(c, x0, y0, x1, y1, w, bend = 0) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
  c.save(); c.translate(x0, y0); c.rotate(Math.atan2(dy, dx));
  c.beginPath();
  c.moveTo(0, -w * 0.55);
  c.bezierCurveTo(L * 0.3, -w * 1.05, L * 0.7, -w * 0.5 + bend * 0.5, L, bend);
  c.bezierCurveTo(L * 0.7, w * 0.5 + bend * 0.5, L * 0.3, w * 1.05, 0, w * 0.55);
  c.arc(0, 0, w * 0.55, Math.PI / 2, Math.PI * 1.5);
  c.fill(); c.restore();
}

function poly(c, pts) { c.beginPath(); c.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); c.closePath(); c.fill(); }

const DRAW = {
  pillar: { w: 256, h: 1024, band: 0.2, draw(c) {
    // main body + two side tongues + a licking crown and detached flicks
    leaf(c, 128, 930, 138, 70, 92, -14);
    leaf(c, 96, 900, 30, 330, 50, 16);
    leaf(c, 160, 900, 226, 400, 48, -18);
    leaf(c, 118, 700, 70, 170, 34, 10);
    leaf(c, 140, 660, 196, 230, 30, -10);
    c.beginPath(); c.ellipse(128, 930, 118, 70, 0, 0, TAU); c.fill();
    leaf(c, 120, 88, 150, 20, 12, 0);
    leaf(c, 60, 250, 40, 180, 11, 0);
  } },
  phoenix: { w: 512, h: 512, draw(c) {
    const cx = 256;
    leaf(c, cx, 370, cx, 128, 44, 0);                        // body (neck up)
    c.beginPath(); c.arc(cx, 140, 30, 0, TAU); c.fill();     // head
    poly(c, [cx - 10, 148, cx + 10, 148, cx, 196]);          // beak (heraldic, pointing down)
    for (const a of [-0.5, 0, 0.5]) leaf(c, cx, 125, cx + Math.sin(a) * 70, 125 - Math.cos(a) * 95 + Math.abs(a) * 20, 11, a * 12); // crest
    for (const s of [1, -1]) {
      // wing arm: shoulder → wrist, feathers fan from trailing-down to leading-up along it
      c.lineWidth = 34; c.lineCap = 'round'; c.strokeStyle = '#fff';
      c.beginPath(); c.moveTo(cx + s * 24, 250); c.quadraticCurveTo(cx + s * 120, 230, cx + s * 205, 120); c.stroke();
      for (let i = 0; i < 8; i++) {
        const t = 0.12 + i * 0.125;
        const rx = cx + s * (24 + (205 - 24) * t), ry = 250 - (250 - 120) * t * t;
        const ang = (-60 + 125 * t) * Math.PI / 180;          // -60° (down-out) → +65° (up-out)
        const L = 60 + 110 * t;
        leaf(c, rx, ry, rx + s * Math.cos(ang) * L, ry - Math.sin(ang) * L, 15 + 6 * t, s * 10);
      }
    }
    for (let k = -2; k <= 2; k++) leaf(c, cx + k * 6, 350, cx + k * 44, 500 - Math.abs(k) * 22, 16 - Math.abs(k) * 2, k * 14); // tail
  } },
  sun: { w: 512, h: 512, draw(c) {
    const cx = 256, cy = 256;
    c.beginPath(); c.arc(cx, cy, 120, 0, TAU); c.fill();
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * TAU, L = i % 2 ? 190 : 240;
      leaf(c, cx + Math.cos(a) * 100, cy + Math.sin(a) * 100, cx + Math.cos(a + 0.18) * L, cy + Math.sin(a + 0.18) * L, i % 2 ? 26 : 34, 16);
    }
  } },
  star: { w: 512, h: 512, draw(c) {
    const cx = 256, cy = 256, pts = [];
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * TAU - Math.PI / 2, r = i % 3 === 0 ? 245 : i % 3 === 1 ? 110 : 165;
      pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.9);
    }
    poly(c, pts);
    // r3: inked facet spokes (zig-zag, one per major point) so the core never reads as a flat pale disc: a thin
    // cut in the sharp mask becomes an ink line inside the shape through the shader's rim band
    c.globalCompositeOperation = 'destination-out';
    c.lineWidth = 9; c.lineJoin = 'miter'; c.lineCap = 'butt';
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU - Math.PI / 2, k = (i % 2 ? 1 : -1) * 0.09;
      const P = (r, da) => [cx + Math.cos(a + da) * r, cy + Math.sin(a + da) * r * 0.9];
      c.beginPath(); c.moveTo(...P(34, 0)); c.lineTo(...P(92, k)); c.lineTo(...P(128, -k)); c.lineTo(...P(196, 0)); c.stroke();
    }
    c.beginPath(); c.arc(cx, cy, 22, 0, TAU); c.lineWidth = 8; c.stroke();
    c.globalCompositeOperation = 'source-over';
  } },
  drake: { w: 512, h: 320, draw(c) {
    // profile facing +x: skull + snout, open lower jaw, fangs, two swept horns, brow + neck spines, slit eye
    poly(c, [20, 150, 110, 104, 196, 80, 244, 66, 280, 82, 336, 92, 420, 102, 478, 112, 502, 128, 474, 142, 418, 148, 350, 152, 300, 160, 262, 176, 200, 196, 110, 214, 20, 206]);
    poly(c, [250, 180, 330, 200, 420, 218, 476, 234, 460, 248, 398, 244, 320, 236, 246, 224, 196, 206]);
    for (let x = 318; x <= 470; x += 30) poly(c, [x - 8, 146, x + 8, 146, x + 1, 172]);          // upper fangs
    for (let x = 330; x <= 450; x += 34) poly(c, [x - 7, 226, x + 7, 226, x - 2, 204]);          // lower fangs
    leaf(c, 236, 76, 60, 16, 20, -18);                                                            // horns
    leaf(c, 262, 80, 150, 34, 14, -10);
    leaf(c, 150, 100, 100, 50, 12, -6);                                                           // neck spines
    leaf(c, 84, 122, 36, 92, 11, -4);
    leaf(c, 226, 198, 150, 262, 14, 8);                                                           // jaw spike
    c.globalCompositeOperation = 'destination-out';
    c.beginPath(); c.ellipse(300, 106, 17, 6, -0.25, 0, TAU); c.fill();                          // eye slit
    c.beginPath(); c.ellipse(478, 122, 5, 3, 0, 0, TAU); c.fill();                               // nostril
    c.globalCompositeOperation = 'source-over';
  } },
};

function mask(kind) {
  if (MASKS[kind]) return MASKS[kind];
  const d = DRAW[kind], { w, h } = d;
  const layer = (blur) => {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const c = cv.getContext('2d');
    c.filter = blur ? `blur(${blur}px)` : 'none';
    c.fillStyle = '#fff'; c.strokeStyle = '#fff';
    d.draw(c);
    return c.getImageData(0, 0, w, h).data;
  };
  const s = Math.min(w, h);
  const A = layer(s * 0.016), B = layer(s * (d.band || 0.11));
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {   // rows flipped here (texture v = up)
    const i = y * w + x, j = ((h - 1 - y) * w + x) * 4;
    data[j] = A[i * 4 + 3]; data[j + 1] = B[i * 4 + 3]; data[j + 2] = 0; data[j + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace; tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.needsUpdate = true;
  MASKS[kind] = { tex, aspect: w / h };
  return MASKS[kind];
}

let _base = null;
function baseMaterial() {
  if (_base) return _base;
  _base = new THREE.ShaderMaterial({
    uniforms: {
      uMask: { value: null }, uT: { value: 0 }, uA: { value: 1 }, uBurn: { value: 0 }, uI: { value: 1 }, uWob: { value: 1 }, uFlick: { value: 1 },
      uCore: { value: new THREE.Color() }, uHot: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uInk: { value: new THREE.Color() }, uFlip: { value: 0 },
    },
    vertexShader: `varying vec2 vUv; uniform float uFlip; void main(){ vUv = vec2(uFlip > 0.5 ? 1.0 - uv.x : uv.x, uv.y); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D uMask; uniform float uT, uA, uBurn, uI, uWob, uFlick; uniform vec3 uCore, uHot, uMid, uInk; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
      float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
      float fbm(vec2 p){ return 0.55*vn(p) + 0.3*vn(p*2.1+3.1) + 0.15*vn(p*4.3+7.7); }
      void main(){
        vec2 uv = vUv;
        float n = fbm(vec2(uv.x * 5.0, uv.y * 4.0 - uT * 3.0 * uFlick));
        uv.x += (n - 0.5) * 0.045 * uWob * (0.3 + uv.y);
        uv.y += (n - 0.5) * 0.02 * uWob;
        vec4 m = texture2D(uMask, uv);
        float e = m.r, d = m.g + (n - 0.5) * 0.22 + (fbm(vec2(uv.x * 9.0, uv.y * 2.5 - uT * 2.4 * uFlick)) - 0.5) * 0.36;
        float aa = max(fwidth(e) * 0.75, 0.004);
        float cov = smoothstep(0.5 - aa, 0.5 + aa, e);
        // burn-out: the shape dissolves from its thin extremities inward, with a hot eating edge
        float bz = d * 1.15 + (n - 0.5) * 0.35 - uBurn * 1.3;
        float alive = smoothstep(-0.03, 0.03, bz);
        cov *= alive;
        if (cov < 0.003) discard;
        // toon bands by depth inside the shape: mid (outer) → hot → core (the defined, NOT blown, centre)
        float b1 = smoothstep(0.42, 0.45, d), b2 = smoothstep(0.8, 0.83, d);
        vec3 col = mix(mix(uMid, uHot, b1), uCore, b2);
        col *= mix(0.85, 1.15, n) * uI;
        // ink rim just inside the silhouette (reads through bloom as a drawn outline)
        float ink = 1.0 - smoothstep(0.66, 0.72 + aa, e);
        col = mix(col, uInk, ink * 0.92);
        col += uHot * (1.0 - smoothstep(0.03, 0.09, bz)) * step(0.01, uBurn) * 1.2 * uI;  // ember edge while burning
        float a = cov * uA;
        gl_FragColor = vec4(col * a, a);
      }`,
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  return _base;
}

const _geo = new THREE.PlaneGeometry(1, 1);
const _geoBottom = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);

export const EMBLEM_COLORS = {
  fire: { core: '#ffe27a', hot: '#ff8414', mid: '#d0280a', ink: '#200300' },
  fireDeep: { core: '#ffc850', hot: '#f05a0c', mid: '#9a1606', ink: '#160200' },
  storm: { core: '#eafaff', hot: '#48c0ff', mid: '#4a28e0', ink: '#04031a' },
};

export function emblem(vfx, kind, o = {}) {
  const run = () => {
    const mk = mask(kind);
    const mat = baseMaterial().clone();
    const U = mat.uniforms;
    U.uMask.value = mk.tex;
    const cols = o.colors || EMBLEM_COLORS.fire;
    U.uCore.value.set(cols.core); U.uHot.value.set(cols.hot); U.uMid.value.set(cols.mid); U.uInk.value.set(cols.ink);
    U.uWob.value = o.wob ?? 1; U.uFlick.value = o.flick ?? 1; U.uFlip.value = o.flipX ? 1 : 0;
    const mesh = new THREE.Mesh(o.anchor === 'bottom' ? _geoBottom : _geo, mat);
    mesh.frustumCulled = false; mesh.renderOrder = o.renderOrder ?? 17; mesh.name = `emblem_${kind}`;
    const [W, H] = o.size || [2 * mk.aspect, 2];
    const life = o.life ?? 0.8, rise = o.rise ?? 0.12, burn = o.burn ?? 0.4, I = o.intensity ?? 1;
    const p = o.pos || { x: 0, y: 0, z: 0 };
    const cam = vfx.game.camera;
    const seed = Math.random() * 10;
    const place = (age) => {
      const f = o.follow ? o.follow(age) : null;
      mesh.position.set(f && f.x != null ? f.x : p.x, f && f.y != null ? f.y : p.y, f && f.z != null ? f.z : p.z);
      if (cam) mesh.quaternion.copy(cam.quaternion);
      const r = (f && f.rot) || o.rot || 0;
      if (r) mesh.rotateZ(r);
      const k = rise > 0 ? Math.min(1, age / rise) : 1, over = 1 + Math.sin(Math.min(1, k) * Math.PI) * 0.12;
      const sx = (f && f.sx) || 1, sy = (f && f.sy) || 1;
      const g = o.grow ? 1 + o.grow * (age / life) : 1;
      mesh.scale.set(W * sx * g * (0.6 + 0.4 * k) * over, H * sy * g * (o.anchor === 'bottom' ? k * over : (0.6 + 0.4 * k) * over), 1);
      U.uT.value = age + seed;
      U.uA.value = Math.min(1, age / Math.max(0.001, rise * 0.5));
      const b0 = life * (1 - burn);
      U.uBurn.value = age > b0 ? (age - b0) / Math.max(0.001, life - b0) : 0;
      U.uI.value = I * (1 + 0.5 * Math.max(0, 1 - age / 0.12));   // brief hot pop at birth
    };
    place(0);
    vfx.track(mesh, life, (m, t01) => place(t01 * life), { dispose: false });
    const done = () => mat.dispose();
    vfx.delay(life + 0.05, done);
    return mesh;
  };
  if (o.delay) { vfx.delay(o.delay, run); return null; }
  return run();
}

/** Pre-build every mask and compile the emblem program with one invisible frame (called at spell preload). */
export function warmEmblems(vfx) {
  for (const k of Object.keys(DRAW)) mask(k);
  const cam = vfx.game.camera;
  if (!cam) return;
  const m = emblem(vfx, 'pillar', { pos: { x: cam.position.x, y: cam.position.y, z: cam.position.z - 3 }, size: [0.01, 0.01], life: 0.05, intensity: 0 });
  if (m) m.material.uniforms.uA.value = 0;
}

/** Prewarm (assets/prewarm.js, perf-1650): an invisible mesh (uA = 0) using the shared emblem program, so the first
 *  emblem of a fight (a bot's Seraphine phoenix) does not link its program mid-combat. */
export function warmMesh() {
  const mat = baseMaterial().clone();
  mat.uniforms.uA.value = 0;
  const m = new THREE.Mesh(_geo, mat);
  m.frustumCulled = false; m.renderOrder = 17; m.name = 'emblem_warm'; m.scale.setScalar(0.01);
  return m;
}
