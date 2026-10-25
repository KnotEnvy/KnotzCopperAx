// Offline-authored metric lane: colour/AO and height-derived world normals.
// Two maps replace the former three procedural mask/detail lookups. No per-frame JS.
import * as THREE from 'three';

export async function roadDetail(material) {
  const loader = new THREE.TextureLoader();
  const [albedo, relief] = await Promise.all([
    loader.loadAsync('/assets/textures/stage1/lane-albedo.png'),
    loader.loadAsync('/assets/textures/stage1/lane-relief.png'),
  ]);
  for (const tex of [albedo, relief]) {
    tex.flipY = false;
    tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter; tex.anisotropy = 4;
    tex.needsUpdate = true;
  }
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.name = 's1-authored-lane-pigment-AO'; relief.name = 's1-authored-lane-normal-wet-ash';
  material.userData.prepassSafe = true;
  const prev = material.onBeforeCompile, key = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    shader.uniforms.s1LaneColor = { value: albedo };
    shader.uniforms.s1LaneRelief = { value: relief };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D s1LaneColor;
uniform sampler2D s1LaneRelief;
vec4 s1Soil; vec3 s1Pigment; vec3 s1WorldNormal;
float s1Reflectance; float s1Ash; float s1Shoulder;`)
      .replace(/  vec2 p = vKW.xz;[\s\S]*?diffuseColor.rgb \*= col;/, `
  vec2 p = vKW.xz;
  vec2 uvLane = (p + vec2(20.,16.)) / vec2(96.,24.);
  vec4 surface = texture2D(s1LaneRelief, uvLane);
  s1Pigment = texture2D(s1LaneColor, uvLane).rgb;
  float inLaneBake = smoothstep(-16.,-14.,p.y)*(1.-smoothstep(7.,8.,p.y))
    *smoothstep(-20.,-18.,p.x)*(1.-smoothstep(74.,76.,p.x));
  s1Pigment = mix(vec3(.031,.026,.022), s1Pigment, inLaneBake);
  surface.ba *= inLaneBake;
  vec2 slopes = surface.rg*2.-1.;
  s1WorldNormal = normalize(vec3(slopes.x, sqrt(max(.01,1.-dot(slopes,slopes))), slopes.y));
  s1Ash = surface.a;
  s1Reflectance = dot(s1Pigment,vec3(.2126,.7152,.0722))*3.2;
  s1Shoulder = 0.; s1Soil = vec4(0.);
  kgRoad = 1.-s1Ash; kgRut = surface.b; kgPuddle = surface.b; kgBurn = 0.; kgH = 0.;
  diffuseColor.rgb *= s1Pigment;`)
      .replace('normal = kBump(-vViewPosition, normal, kgH, 1.0, faceDirection);', `
  // Baked height derivatives carry the concave wheel walls and raised crust.
  // Fade to mesh normals outside the authored village footprint.
  float laneCoverage = (1.-smoothstep(7.0,8.0,vKW.z))*smoothstep(-16.,-14.,vKW.z)
    * smoothstep(-20.,-18.,vKW.x)*(1.-smoothstep(74.,76.,vKW.x));
  normal = normalize(mix(normal, mat3(viewMatrix)*s1WorldNormal, laneCoverage));`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
  // Restrained view-dependent sky sheen only in the compressed wet trough.
  vec3 laneView = normalize(vViewPosition);
  vec3 skyHalf = normalize(laneView + mat3(viewMatrix)*normalize(vec3(-.25,.7,-.65)));
  float wetSheen = pow(max(0.,dot(normal,skyHalf)),24.) * kgPuddle;
  reflectedLight.directDiffuse += vec3(.065,.060,.048)*wetSheen;`);
  };
  material.customProgramCacheKey = () => key.call(material) + '|s1AuthoredLane-r16';
  material.addEventListener('dispose', () => { albedo.dispose(); relief.dispose(); });
}
