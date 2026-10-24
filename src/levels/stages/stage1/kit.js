// Blender-authored Ashen Wilds: opaque masonry/core and alpha-tested straw.
// COLOR_0 alpha stores ember weight; texture alpha alone cuts the straw silhouette.
import * as THREE from 'three';
import { shared } from '../../../render/shaderlib.js';

export async function loadStage1Kit(game) {
  const [asset, metadata] = await Promise.all([
    game.assets.instance('env_stage1_kit', { cloneMaterials: false }),
    fetch('/assets/models/env_stage1_kit.json').then(r => {
      if (!r.ok) throw new Error(`stage1 kit metadata: ${r.status}`);
      return r.json();
    }),
  ]);
  if (asset.source !== 'glb') throw new Error('Blender stage1 kit is missing');
  const geometries = {};
  let material, strawMaterial;
  asset.root.updateMatrixWorld(true);
  asset.root.traverse(o => {
    if (!o.isMesh) return;
    const isStraw = o.name.startsWith('straw_');
    let selected = isStraw ? strawMaterial : material;
    if (!selected) {
      // These porous reed/carbon/mineral surfaces have no authored polished
      // component. Keep baked normals and direct lights, skip the metal BRDF.
      selected = new URLSearchParams(location.search).get('s1PbrVillage') === '1'
        ? o.material.clone()
        : new THREE.MeshLambertMaterial({color:o.material.color, map:o.material.map,
          normalMap:o.material.normalMap, normalScale:o.material.normalScale});
      const mat = selected;
      mat.name = isStraw ? 's1AlphaStraw' : 's1BakedVillage';
      mat.transparent = false; mat.opacity = 1;
      mat.side = THREE.DoubleSide;
      mat.vertexColors = true;
      mat.roughness = .95;
      mat.alphaTest = isStraw ? .45 : 0;
      mat.depthWrite = true;
      mat.userData.prepassSafe = !isStraw; // attributes only; no displacement/discard
      mat.map.anisotropy = 8;
      if (mat.normalMap) mat.normalMap.anisotropy = 8;
      const previous = mat.onBeforeCompile;
      mat.onBeforeCompile = (shader, renderer) => {
        previous.call(mat, shader, renderer);
        shader.uniforms.s1Time = shared.uTime;
        shader.vertexShader = 'attribute float s1Ember; attribute float s1Warm; varying vec3 vS1Local; varying float vS1Ember; varying float vS1Warm;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvS1Local = position; vS1Ember = s1Ember; vS1Warm = s1Warm;');
        shader.fragmentShader = 'uniform float s1Time; varying vec3 vS1Local; varying float vS1Ember; varying float vS1Warm;\n' + shader.fragmentShader;
        {
          // Reduce saturated incident fire on village surfaces while retaining the
          // authored straw pigments. This does not grade actors or other stages.
          shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
            vec3 s1Irradiance = reflectedLight.directDiffuse / max(diffuseColor.rgb, vec3(.003));
            float s1Lum = dot(s1Irradiance, vec3(.2126,.7152,.0722));
            reflectedLight.directDiffuse = diffuseColor.rgb * mix(vec3(min(s1Lum, 2.2)), min(s1Irradiance, vec3(3.0)), .28);`);
        }
        // Porous carbon should stay matte beside a nearby flame. The baked
        // vertex tint supplies the same char transition as the roof albedo.
        shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
          #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
            float s1Carbon = 1.0 - smoothstep(.035, .24, max(vColor.r, max(vColor.g, vColor.b)));
            float s1Porosity = mix(1.0, .08, s1Carbon);
            material.specularColor *= s1Porosity;
            material.specularColorBlended *= s1Porosity;
            material.specularF90 *= s1Porosity;
          #endif`);
        shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', isStraw ? `#include <emissivemap_fragment>
          // Ember weight is consumed-edge proximity on the cards. Broken heat
          // pockets and narrow reed cracks cannot form a continuous bright rim.
          float s1Pockets = sin(vS1Local.x*4.7 + vS1Local.y*2.3) * sin(vS1Local.y*6.8 - vS1Local.x*1.7);
          float s1Hot = smoothstep(.45,.78,s1Pockets) * smoothstep(.70,.99,vS1Ember);
          float s1Crack = pow(max(0.0,sin(vMapUv.x*960.0 + sin(vMapUv.y*23.0)*1.4)),12.0);
          // Average subpixel fissures instead of letting fine reeds scintillate
          // as the gameplay camera moves. Large pockets still stay separated.
          s1Crack = mix(s1Crack,.115,smoothstep(.8,3.0,fwidth(vMapUv.x)*960.0));
          float s1Flicker = .84 + .12*sin(s1Time*5.7 + vMapUv.x*19.0) + .04*sin(s1Time*13.0);
          totalEmissiveRadiance += mix(vec3(.06,.004,.001),vec3(1.9,.34,.012),s1Crack) * s1Hot * s1Flicker;
          totalEmissiveRadiance += vec3(.32,.16,.032) * vS1Warm * (.22 + diffuseColor.rgb*4.0);`
          : `#include <emissivemap_fragment>
          totalEmissiveRadiance += vec3(2.4,.48,.025) * vS1Ember * (.88+.12*sin(s1Time*6.1)) + vec3(.32,.16,.034) * vS1Warm * clamp(sampledDiffuseColor.rgb*18.0,vec3(.12),vec3(1.5));`);
      };
      mat.customProgramCacheKey = () => (isStraw ? 's1AlphaStraw-C2-r14' : 's1BakedVillage-C2-r14') + mat.type;
      if (isStraw) strawMaterial = mat; else material = mat;
    }
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    const c = g.getAttribute('color');
    const rgb = new Float32Array(c.count * 3), ember = new Float32Array(c.count);
    for (let i = 0; i < c.count; i++) {
      rgb.set([c.getX(i), c.getY(i), c.getZ(i)], i * 3);
      // Opaque char shafts carry cool carbon pigment; only warm fracture-face
      // pigment may incandesce. Old brace warmth must not make whole red sticks.
      const fractureFace = c.getX(i) > c.getY(i) * 1.1;
      ember[i] = c.itemSize === 4 && (isStraw || fractureFace) ? c.getW(i) : 0;
    }
    const warm = new Float32Array(c.count), pos = g.getAttribute('position');
    const anchors = metadata.huts[o.name.replace(/^(hut|straw)_/, '')]?.flames || [];
    for (let i=0;i<c.count;i++) {
      let glow=0;
      for(const a of anchors) {
        const d=(pos.getX(i)-a[0])**2+(pos.getY(i)-a[1])**2+(pos.getZ(i)-a[2])**2;
        glow=Math.max(glow, Math.exp(-d/.34));
      }
      // Recessed far pitch and timber undersides catch interior bounce. It
      // follows height/depth and surface pigment, preserving the roof's depth.
      const interior = !isStraw && anchors.length && pos.getY(i)>2 && pos.getZ(i)<.4;
      const n=g.getAttribute('normal');
      const facing=interior ? .4+.6*Math.abs(n.getZ(i)) : 1;
      const inner = interior ? .70*Math.exp(-((pos.getY(i)-3.0)**2)/3.0)
        * (.60+.40*Math.cos(pos.getX(i)*1.6+pos.getY(i))) * facing : 0;
      const reedUnder=isStraw && pos.getZ(i)<-.10 && pos.getY(i)>2
        ? .80*Math.exp(-((pos.getY(i)-3.1)**2)/2.8) : 0;
      warm[i]=glow*(isStraw?.45:.85)+inner+reedUnder;
    }
    g.setAttribute('s1Warm', new THREE.BufferAttribute(warm, 1));
    g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
    g.setAttribute('s1Ember', new THREE.BufferAttribute(ember, 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    geometries[o.name] = g;
  });
  return { geometries, material, strawMaterial, metadata };
}
