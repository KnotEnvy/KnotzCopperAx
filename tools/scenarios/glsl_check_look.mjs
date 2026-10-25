// GLSL compile check for a CANDIDATE copy of src/render/characterLook.js (owner: hero-weapons, wave C2 r11). QA only.
// `node --check` only parses the JS; a GLSL error inside the shared FRAG string breaks every character material on every
// page. Copy the candidate to src/render/_look_check.js (served by Vite, imported by nothing), then:
//   node tools/capture.mjs --url "/?mode=showcase&what=hero&id=gorrim" --scenario tools/scenarios/glsl_check_look.mjs --out progress/tmp/glsl_check
// It patches three test meshes (plain actor, sword glint, axe glint), compiles + renders them off-screen and writes
// glsl_check.json { ok, programs, errors }; non-ok also throws so the capture exits non-zero.
// GLSL_TRAILS=1: ALSO compile a candidate copy of src/vfx/Trails.js at src/vfx/_trails_check.js (its ribbon ShaderMaterial).
// GLSL_LOOK=0 skips the character-look part (when only Trails changed).
import fs from 'node:fs';
import path from 'node:path';

export default async (api) => {
  const res = await api.evalGame(async ([doLook, doTrails]) => {
    const T = await import('/node_modules/three/build/three.module.js');
    const L = doLook ? await import('/src/render/_look_check.js?' + Date.now()) : null;
    const r = __KCA.game.renderer.webgl;
    const scene = new T.Scene();
    scene.add(new T.DirectionalLight(0xffffff, 1));
    const cfg = [null, { glint: [1, 0.936, 0.2, 0], shape: [0.066, 0.165, 0.28, 0] }, { glint: [1, 0.819, 0.38, 1], shape: [0.95, 1.3, 0.03, 1] }];
    const errors = [];
    const origErr = console.error;
    console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 2000)); origErr.apply(console, a); };
    try {
      cfg.forEach((c, i) => {
        const m = new T.MeshStandardMaterial({ color: 0x996633, metalness: 0.9, roughness: 0.3, emissive: 0x112211 });
        if (c) { m.userData.kcaWeaponGlint = c.glint; m.userData.kcaWeaponShape = c.shape; m.userData.kcaMetalTint = [1, 0.22, 0.12, 0.7]; m.userData.kcaMetalEnv = 0.4; m.userData.kcaEdgeDark = 0.85; }
        const mesh = new T.Mesh(new T.BoxGeometry(0.3, 0.3, 0.3), m); mesh.position.x = i * 0.5;
        const g = new T.Group(); g.add(mesh); scene.add(g);
        if (L) L.applyCharacterLook(g, { strength: 1 });
      });
      if (doTrails) {
        const TR = await import('/src/vfx/_trails_check.js?' + Date.now());
        const ts = new TR.TrailSystem({ game: __KCA.game, scope: { on() {} }, palette: () => ({ trail: ['#ffffff', '#ffffff'] }) });
        scene.add(ts.mesh);
      }
      const cam = new T.PerspectiveCamera(40, 1, 0.1, 50); cam.position.set(0.5, 0.5, 3); cam.lookAt(0.5, 0, 0);
      const rt = new T.WebGLRenderTarget(64, 64);
      const old = r.getRenderTarget();
      r.setRenderTarget(rt); r.compile(scene, cam); r.render(scene, cam); r.setRenderTarget(old); rt.dispose();
      const gl = r.getContext();
      const progs = (r.info.programs || []).map((p) => ({ name: p.name, key: (p.cacheKey || '').slice(-40), linked: gl.getProgramParameter(p.program, gl.LINK_STATUS) }));
      return { errors, programs: progs.filter((p) => /MeshStandard/.test(p.name) || true).length, unlinked: progs.filter((p) => !p.linked).map((p) => p.name) };
    } finally { console.error = origErr; }
  }, [process.env.GLSL_LOOK !== '0', !!process.env.GLSL_TRAILS]);
  const ok = res && !res.errors.some((e) => /shader|program|glsl|ERROR/i.test(e)) && !(res.unlinked || []).length;
  fs.writeFileSync(path.join(api.outDir, 'glsl_check.json'), JSON.stringify({ ok, ...res }, null, 1));
  api.log(`GLSL CHECK ${ok ? 'OK' : 'FAILED'} ${JSON.stringify(res).slice(0, 1500)}`);
  if (!ok) throw new Error('GLSL check failed');
};
