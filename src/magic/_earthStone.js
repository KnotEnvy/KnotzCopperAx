// Earth spell surface and actor protection. Shared by the instanced rock fields; no extra draw calls.
import * as THREE from 'three';

let surface;
let authoredSurface;
export async function preloadStoneSurface() {
  if (!authoredSurface) authoredSurface = Promise.all(['magic_earth_basalt.png','magic_earth_normal.png','magic_earth_ao.png'].map(name =>
    new THREE.TextureLoader().loadAsync(`${import.meta.env.BASE_URL || '/'}assets/textures/${name}`))).then(([map,normal,ao]) => {
    map.colorSpace = THREE.SRGBColorSpace;
    const tex=stoneSurface();
    for (const [key,src] of [['map',map],['normal',normal],['ao',ao]]) {
      tex[key].image=src.image;tex[key].flipY=false;tex[key].anisotropy=4;tex[key].needsUpdate=true;
    }
  });
  return authoredSurface;
}
export function stoneSurface() {
  if (surface) return surface;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const g = canvas.getContext('2d'), image = g.createImageData(256, 256);
  const grainAt = (x, y) => {
    let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
    n = Math.imul(n ^ n >>> 13, 1274126177);
    return ((n ^ n >>> 16) >>> 0) / 4294967295;
  };
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const grain = grainAt(x, y), mineral = grainAt(x >> 3, y >> 3);
    const v = 158 + (mineral - .5) * 12 + (grain - .5) * 32;
    const i = (y * 256 + x) * 4;
    image.data[i] = v * 1.05; image.data[i + 1] = v; image.data[i + 2] = v * 0.94; image.data[i + 3] = 255;
  }
  g.putImageData(image, 0, 0);
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  // A separate linear bump texture uses the same pixels (albedo remains sRGB).
  const bump = new THREE.CanvasTexture(canvas); bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  const neutral = (rgba) => {
    const c=document.createElement('canvas');c.width=c.height=1;
    const g=c.getContext('2d');g.putImageData(new ImageData(new Uint8ClampedArray(rgba),1,1),0,0);
    const t=new THREE.CanvasTexture(c);t.channel=0;return t;
  };
  return (surface = { map, bump, normal: neutral([128,128,255,255]), ao: neutral([255,255,0,255]) });
}

export function stoneMaterial(color, glow, veins, protect, basalt = false) {
  const tex = stoneSurface();
  const mat = new THREE.MeshStandardMaterial({ color, map: tex.map, bumpMap: basalt ? null : tex.bump, bumpScale: .055,
    normalMap: basalt ? tex.normal : null, normalScale: new THREE.Vector2(.38,.38),
    aoMap: basalt ? tex.ao : null, aoMapIntensity: .85,
    roughness: basalt ? 1 : .91, metalness: 0, flatShading: true, vertexColors: basalt,
    emissive: new THREE.Color(glow), emissiveMap: basalt ? null : veins, emissiveIntensity: 0,
    transparent: false, depthWrite: true });
  const heatGain = mat.userData.stoneHeatGain = { value: 1 };
  const stoneFill = mat.userData.stoneFill = { value: .24 };
  mat.onBeforeCompile = (shader) => {
    // Low rock-coloured fill preserves shaded stone during the spell's cinematic world-darkening.
    if (!basalt) shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.2;');
    if (basalt) {
      shader.uniforms.uStoneGain = heatGain;
      shader.uniforms.uStoneFill = stoneFill;
      // The packed bake supplies cavity (R), mineral roughness (G) and fine fracture heat (B) in one texture read.
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\n vec4 stoneCavity = texture2D(aoMap, vAoMapUv); roughnessFactor *= stoneCavity.g;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <aomap_fragment>',
        THREE.ShaderChunk.aomap_fragment.replace('texture2D( aoMap, vAoMapUv ).r', 'stoneCavity.r'));
      shader.vertexShader = `attribute float aStoneHeat; attribute float aStoneBounce; attribute float aStoneEnergy;
        attribute vec3 aStonePivot; attribute float aStoneSeed; attribute vec2 aStoneCollapse;
        varying float vStoneHeat; varying float vStoneBounce; varying float vStoneEnergy; varying float vStoneFall;
        mat3 stoneRotation() {
          float t = aStoneCollapse.x; if (t <= 0.) return mat3(1.);
          float seed = aStoneSeed * 2.399;
          float x = t * sin(seed) * 3.8, z = t * cos(seed * 1.7) * 3.4;
          mat3 rx = mat3(1.,0.,0., 0.,cos(x),sin(x), 0.,-sin(x),cos(x));
          mat3 rz = mat3(cos(z),sin(z),0., -sin(z),cos(z),0., 0.,0.,1.);
          return rz * rx;
        }\n` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n objectNormal = stoneRotation() * objectNormal;');
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vStoneHeat = aStoneHeat; vStoneBounce = aStoneBounce; vStoneEnergy = aStoneEnergy; vStoneFall = aStoneCollapse.x;
        float fall = aStoneCollapse.x;
        if (fall > 0.) {
        vec3 sz = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        sz = max(sz, vec3(.001));
        transformed = aStonePivot + (stoneRotation() * ((position - aStonePivot) * sz)) / sz;
        float seed = aStoneSeed * 2.399;
        float floorDrop = aStoneCollapse.y + .16 - (instanceMatrix[3].y + aStonePivot.y * sz.y);
        float dy = fall > 0. ? max(floorDrop, -7.5 * fall * fall + sin(seed) * .25 * fall) : 0.;
        transformed += vec3(cos(seed) * fall * 1.3 / sz.x, dy / sz.y, sin(seed) * fall * .9 / sz.z);
        }
      `);
      shader.fragmentShader = 'uniform float uStoneGain; uniform float uStoneFill; varying float vStoneHeat; varying float vStoneBounce; varying float vStoneEnergy; varying float vStoneFall;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float heat = max(max(0.,vStoneHeat), stoneCavity.b) * vStoneEnergy;
        // r17: the pigment is darker (cool basalt); keep the magma modulation in its own range.
        float mineral = .60 + .40 * smoothstep(.03, .20, texture2D(map, vMapUv).r);
        float facet = .50 + .50 * max(0., dot(normalize(normal), normalize(vec3(-.4,.7,1.))));
        // A recessed basin carries a narrow ivory kernel, orange shoulders and dark red crust.
        // Heat is authored lower toward the crown; only base pockets reach the ivory range.
        vec3 magma = mix(vec3(.10,.001,.0001), vec3(3.4,.22,.004), smoothstep(.08,.44,heat));
        magma = mix(magma, vec3(10.,2.6,.14), smoothstep(.44,.82,heat));
        magma = mix(magma, vec3(16.,9.,3.), smoothstep(.86,.99,heat));
        // r18: interpolated low heat (vertex ramps, crack fringes) must not wash whole faces orange (board r17:
        // L2 faces read maroon); the crust tail is cut below ~.2 so stone between cracks keeps its own colour.
        totalEmissiveRadiance = magma * heat * uStoneGain * mineral * facet * smoothstep(.07,.24,heat);
        // Negative heat marks interior cross-sections. Cold cavity walls remain dark while intact;
        // newly exposed breaks light from within, then cool orange -> red over half a second.
        float fracture = max(0.,-vStoneHeat) * step(.0001,vStoneFall);
        float coal = fracture * exp(-vStoneFall*3.2);
        vec3 broken = mix(vec3(.25,.009,.001),vec3(1.15,.18,.012),smoothstep(.10,.65,coal));
        // Fresh cap heat remains below the old full-face bloom wash.
        totalEmissiveRadiance += broken * coal * mineral * min(uStoneGain,1.);
        // r17: warm spill cut back (it washed the r16 faces pink-tan); it stays a narrow halo beside the channels.
        totalEmissiveRadiance += vec3(.46,.11,.014) * pow(vStoneBounce,1.5) * vStoneEnergy * mineral * uStoneGain;
        // Rock-coloured ambient fill keeps falling shaded facets readable against the ground.
        totalEmissiveRadiance += diffuseColor.rgb * (uStoneFill + .18*step(.0001,vStoneFall)*exp(-vStoneFall*2.));
        // Cool dusk-sky response: lit top facets and a faint rim so the form reads without the magma.
        vec3 skyUp = normalize((viewMatrix * vec4(0.,1.,0.,0.)).xyz);
        float facing = max(0., dot(normalize(normal), skyUp));
        float rim = pow(1. - max(0., dot(normalize(normal), normalize(vViewPosition))), 3.);
        // r17: rim halved - a 4 cm chamfer seen edge-on printed a bright dashed line along the silhouette.
        totalEmissiveRadiance += (vec3(.040,.050,.074) * facing + vec3(.010,.014,.024) * rim) * (1. - min(1., heat * 3.)) * mineral;
      `);
    }
    if (basalt) shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      // Basalt pigment retains its dark value under the stage-2 gold boss key.
      // r16: the stone must sit in scene light (board: unlit faces collapsed to black). Keep the gold key from
      // washing it out, but let key/fill shape the prism faces.
      // r17: cool charcoal basalt - the ambient keeps a blue cast and the key never lifts a face above its pigment.
      reflectedLight.indirectDiffuse *= vec3(.40,.43,.50);
      reflectedLight.directDiffuse = min(reflectedLight.directDiffuse, diffuseColor.rgb * 1.05);
      // Rough basalt must not inherit a pale gold specular board from the boss/caster key.
      reflectedLight.directSpecular = min(reflectedLight.directSpecular, diffuseColor.rgb * vec3(.06,.055,.05));
      reflectedLight.indirectSpecular = min(reflectedLight.indirectSpecular, diffuseColor.rgb * vec3(.025,.023,.02));
    `);

  };
  mat.customProgramCacheKey = () => `earth_stone_c2_r18_${protect ? 'protected' : 'solid'}_${basalt ? 'basalt' : 'rock'}`;
  return mat;
}

// Placement uses actual camera depth. Rocks remain fully opaque: no alpha, masks or stipple.
// The actor box is deliberately broad enough for weapons, launched bodies and captain armour.
export function stoneSightlines(vfx) {
  const actors = [], v = new THREE.Vector3(), box = new THREE.Box3();
  const rock = {}, inv = new THREE.Matrix4();
  const rect = (b, out) => {
    out.x0 = out.y0 = out.near = Infinity; out.x1 = out.y1 = out.far = -Infinity;
    for (let j = 0; j < 8; j++) {
      v.set(j & 1 ? b.max.x : b.min.x, j & 2 ? b.max.y : b.min.y, j & 4 ? b.max.z : b.min.z).project(vfx.game.camera);
      out.x0 = Math.min(out.x0, v.x); out.x1 = Math.max(out.x1, v.x);
      out.y0 = Math.min(out.y0, v.y); out.y1 = Math.max(out.y1, v.y);
      out.near = Math.min(out.near, v.z); out.far = Math.max(out.far, v.z);
    }
  };
  let count = 0;
  return {
    prepare() {
      count = 0; vfx.game.camera.updateMatrixWorld(true);
      for (const a of vfx.game.world.actors) {
        if (a.removed || a.alive === false || !a.pos || !a.height || (a.team !== 'players' && a.team !== 'enemies') || a.kind === 'projectile' || a.kind === 'mount') continue;
        const h = a.height + (a.mountedOn ? a.mountedOn.saddleY || 1.2 : 0), w = Math.max(a.radius || .3, h * .32);
        box.min.set(a.pos.x - w, a.pos.y + (a.groundY || 0) - .08, a.pos.z - .45);
        box.max.set(a.pos.x + w, a.pos.y + (a.groundY || 0) + h + .18, a.pos.z + .45);
        const r = actors[count] || (actors[count] = {}); rect(box, r); r.box = r.box || new THREE.Box3(); r.box.copy(box); r.actor = a; count++;
      }
    },
    blocked(geometry, matrix, ignore = null) {
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      box.copy(geometry.boundingBox).applyMatrix4(matrix); rect(box, rock);
      for (let j = 0; j < count; j++) {
        const a = actors[j];
        if (a.actor === ignore) continue;
        if (rock.x0 >= a.x1 || rock.x1 <= a.x0 || rock.y0 >= a.y1 || rock.y1 <= a.y0 || rock.near >= a.far) continue;
        // Sample rays through the overlapping actor silhouette against the stone's local bounds.
        // This distinguishes a tall crown behind a fighter from an actual foreground obstruction.
        inv.copy(matrix).invert();
        const bounds = geometry.boundingBox;
        for (let ix = 0; ix < 11; ix++) for (let iy = 0; iy < 15; iy++) {
          const sx = (ix + .5) / 11, sy = (iy + .5) / 15;
          const px = a.x0 + (a.x1 - a.x0) * sx, py = a.y0 + (a.y1 - a.y0) * sy;
          if (px < rock.x0 || px > rock.x1 || py < rock.y0 || py > rock.y1) continue;
          v.set(px, py, .5).unproject(vfx.game.camera);
          const ray = this.ray; ray.origin.copy(vfx.game.camera.position); ray.direction.copy(v).sub(ray.origin).normalize();
          const actorHit = ray.intersectBox(a.box, this.hitActor);
          if (!actorHit) continue;
          // Protect the full body depth, not only the near skin of its padded box.
          // Otherwise a side stone between that near skin and the actual torso can be missed.
          let distance = Infinity;
          for (let axis = 0; axis < 3; axis++) {
            const d = ray.direction.getComponent(axis);
            if (Math.abs(d) > 1e-8) distance = Math.min(distance, ((d > 0 ? a.box.max : a.box.min).getComponent(axis) - ray.origin.getComponent(axis)) / d);
          }
          ray.applyMatrix4(inv);
          const hit = ray.intersectBox(bounds, this.hitStone);
          if (hit && hit.applyMatrix4(matrix).distanceTo(vfx.game.camera.position) < distance - .08) return true;
        }
      }
      return false;
    },
    ray: new THREE.Ray(), hitActor: new THREE.Vector3(), hitStone: new THREE.Vector3(),
  };
}
