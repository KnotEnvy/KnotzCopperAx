// Game-wide atmospheric fog: three's distance fog + exponential HEIGHT fog + SUN INSCATTER (haze glows toward the
// sun, cools away from it). Patched into three's fog chunks once, so every built-in material (and any custom
// ShaderMaterial with fog:true) gets it. Parameters are shared uniform objects updated by Lighting.apply().
//
// preset.fog = {
//   color, near, far            (linear distance fog, as before)   | or { color, density } (exp2)
//   height: { density, base, falloff, start, max, color }   // ground-hugging haze; start = metres from camera before it builds
//   sun:    { color, strength, power }                      // inscatter toward preset.sky.sunDir
//   depthGrade: { start, end, dim, desat, tint }            // painter's cheat: dims/cools everything BEHIND the belt,
//                                                           // ramping from world z = -start to z = -end, BEFORE the haze,
//                                                           // so the action plane pops and mid-ground reads as silhouettes
// }
// All extras default to OFF, so stages that only give { color, near, far } look exactly like plain three fog.
import * as THREE from 'three';

// Plain {x,y,z,w} objects (not Vector4) so UniformsUtils.clone() keeps them BY REFERENCE in every material.
export const fogUniforms = {
  kFogA: { value: { x: 0, y: 0, z: 0.2, w: 0 } },     // height density, base y, falloff, start distance
  kFogB: { value: { x: 0, y: 0.2, z: -1, w: 8 } },    // sun dir xyz, power
  kFogC: { value: { x: 1, y: 0.6, z: 0.3, w: 0 } },   // sun colour rgb, strength
  kFogD: { value: { x: 0.5, y: 0.45, z: 0.5, w: 0 } }, // height-fog colour rgb, max opacity
  kFogE: { value: { x: 0, y: 0, z: 0, w: 0 } },       // depth grade: start, end, dim, desat
  kFogF: { value: { x: 0.5, y: 0.5, z: 0.5, w: 0 } },  // depth grade tint rgb
};

let installed = false;
export function installFog() {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = '#ifdef USE_FOG\n\tvarying float vFogDepth;\n\tvarying vec3 vFogWorld;\n#endif\n';
  C.fog_vertex = '#ifdef USE_FOG\n\tvFogDepth = - mvPosition.z;\n\tvFogWorld = cameraPosition + transpose( mat3( viewMatrix ) ) * mvPosition.xyz;\n#endif\n';
  C.fog_pars_fragment = `#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vFogWorld;
	uniform vec4 kFogA;
	uniform vec4 kFogB;
	uniform vec4 kFogC;
	uniform vec4 kFogD;
	uniform vec4 kFogE;
	uniform vec4 kFogF;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif
`;
  C.fog_fragment = `#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	vec3 kfV = vFogWorld - cameraPosition;
	float kfDist = length( kfV );
	vec3 kfDir = kfV / max( kfDist, 1e-4 );
	float kfSun = pow( max( dot( kfDir, kFogB.xyz ), 0.0 ), max( kFogB.w, 1.0 ) ) * kFogC.w;
	vec3 kfCol = mix( fogColor, kFogC.rgb, clamp( kfSun, 0.0, 1.0 ) );
	float kfFall = max( kFogA.z, 1e-3 );
	float kfD = max( kfDist - kFogA.w, 0.0 );
	float kfDy = kfV.y * kfFall;
	float kfLine = abs( kfDy ) > 1e-3 ? ( 1.0 - exp( - kfDy ) ) / kfDy : 1.0;
	float kfCam = kFogA.x * exp( - kfFall * ( cameraPosition.y - kFogA.y ) );
	float kfH = min( 1.0 - exp( - max( kfCam * kfLine * kfD, 0.0 ) ), kFogD.w );
	float kfK = smoothstep( kFogE.x, max( kFogE.y, kFogE.x + 0.001 ), - vFogWorld.z );
	vec3 kfL = vec3( dot( gl_FragColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ) * kFogF.rgb * 2.0;
	gl_FragColor.rgb = mix( gl_FragColor.rgb, kfL, kfK * kFogE.w ) * ( 1.0 - kfK * kFogE.z );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, mix( kFogD.rgb, kFogC.rgb, clamp( kfSun * 0.7, 0.0, 1.0 ) ), kfH );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, kfCol, fogFactor );
#endif
`;
  const add = (u) => { if (u && u.fogColor) Object.assign(u, fogUniforms); };
  add(THREE.UniformsLib.fog);
  for (const k of Object.keys(THREE.ShaderLib)) add(THREE.ShaderLib[k].uniforms);
}

const _c = new THREE.Color();
/** Apply a fog preset (see header) to the scene + shared uniforms. sunDir: [x,y,z] toward the sun. */
export function applyFog(scene, f, sunDir) {
  const A = fogUniforms.kFogA.value, B = fogUniforms.kFogB.value, Cc = fogUniforms.kFogC.value, D = fogUniforms.kFogD.value;
  if (f === null || f === false || f === undefined) { scene.fog = null; A.x = 0; Cc.w = 0; D.w = 0; fogUniforms.kFogE.value.z = 0; fogUniforms.kFogE.value.w = 0; return; }
  if (f.density !== undefined) scene.fog = new THREE.FogExp2(f.color, f.density);
  else scene.fog = new THREE.Fog(f.color, f.near ?? 30, f.far ?? 140);
  const h = f.height || null;
  A.x = h ? (h.density ?? 0.03) : 0; A.y = h ? (h.base ?? 0) : 0; A.z = h ? (h.falloff ?? 0.25) : 0.2; A.w = h ? (h.start ?? 0) : 0;
  _c.set(h && h.color ? h.color : f.color); D.x = _c.r; D.y = _c.g; D.z = _c.b; D.w = h ? (h.max ?? 0.9) : 0;
  const dg = f.depthGrade || null, E = fogUniforms.kFogE.value, F = fogUniforms.kFogF.value;
  E.x = dg ? (dg.start ?? 16) : 0; E.y = dg ? (dg.end ?? 45) : 0; E.z = dg ? (dg.dim ?? 0.3) : 0; E.w = dg ? (dg.desat ?? 0.2) : 0;
  _c.set(dg && dg.tint ? dg.tint : '#808080'); F.x = _c.r / Math.max(1e-4, (_c.r + _c.g + _c.b) / 3) * 0.5; F.y = _c.g / Math.max(1e-4, (_c.r + _c.g + _c.b) / 3) * 0.5; F.z = _c.b / Math.max(1e-4, (_c.r + _c.g + _c.b) / 3) * 0.5;
  const s = f.sun || null;
  const v = new THREE.Vector3().fromArray(sunDir || [0, 0.2, -1]).normalize();
  B.x = v.x; B.y = v.y; B.z = v.z; B.w = s ? (s.power ?? 8) : 8;
  _c.set(s && s.color ? s.color : f.color); Cc.x = _c.r; Cc.y = _c.g; Cc.z = _c.b; Cc.w = s ? (s.strength ?? 0.8) : 0;
}
