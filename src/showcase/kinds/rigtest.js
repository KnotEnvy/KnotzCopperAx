// what=rigtest[&id=<hero>][&anim=<clip>] — retarget verification (docs/ENGINE_API.md §Clips).
// Left: the procedural placeholder rig (identity bone axes). Right: the SAME mesh re-bound to a skeleton whose
// bones have random rest orientations under a scaled + rotated "Armature" node — what a Blender GLB looks like.
// Both play the same code-authored clip through anim/retarget.js; __KCA.showcase.compare() returns the max joint
// position difference (model space, metres). It must stay ~0 for every clip.
import * as THREE from 'three';
import { buildHumanoid, proportionsFor } from '../../assets/placeholderRig.js';
import { RigInfo } from '../../anim/retarget.js';
import { Animator } from '../../anim/Animator.js';
import { registries } from '../../core/registries.js';

/** Rebuild `proto`'s skeleton with scrambled bone axes (joint positions unchanged) under a scaled armature node. */
function scrambledCopy(proto, rng) {
  const src = proto.root;
  const srcMesh = proto.mesh;
  src.updateMatrixWorld(true);
  const armature = new THREE.Group();
  armature.name = 'Armature';
  // Blender-style export: Z-up armature rotated to Y-up, with a centimetre scale baked into the node.
  armature.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  armature.scale.setScalar(0.01);
  const root = new THREE.Group();
  root.name = src.name + '_scrambled';
  root.add(armature);
  root.updateMatrixWorld(true);
  const armInv = new THREE.Matrix4().copy(armature.matrixWorld).invert();
  const newBones = new Map();
  const worldQ = new Map();
  const worldP = new Map();
  srcMesh.skeleton.bones.forEach((b) => {
    const nb = new THREE.Bone();
    nb.name = b.name;
    newBones.set(b.name, nb);
    const p = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld).applyMatrix4(armInv); // armature-local
    worldP.set(b.name, p);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-3, 3), rng.range(-3, 3), rng.range(-3, 3)));
    worldQ.set(b.name, q);
  });
  srcMesh.skeleton.bones.forEach((b) => {
    const nb = newBones.get(b.name);
    const parent = b.parent && b.parent.isBone ? newBones.get(b.parent.name) : null;
    const pq = parent ? worldQ.get(parent.name) : new THREE.Quaternion();
    const pp = parent ? worldP.get(parent.name) : new THREE.Vector3();
    nb.quaternion.copy(pq).invert().multiply(worldQ.get(b.name));
    nb.position.copy(worldP.get(b.name)).sub(pp).applyQuaternion(pq.clone().invert());
    (parent || armature).add(nb);
  });
  const mesh = new THREE.SkinnedMesh(srcMesh.geometry, srcMesh.material);
  mesh.name = srcMesh.name + '_scrambled';
  mesh.castShadow = true; mesh.frustumCulled = false;
  root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(srcMesh.skeleton.bones.map((b) => newBones.get(b.name))));
  return root;
}

const TRACK = ['hips', 'chest', 'head', 'hand_L', 'hand_R', 'socket_hand_R', 'foot_L', 'foot_R', 'toe_L'];

export default {
  id: 'rigtest',
  async setup(ctx) {
    const { params, game } = ctx;
    const heroId = params.id || 'brann';
    const def = await registries.heroes.load(heroId);
    ctx.studio({ plinth: { radius: 2.4 } });
    const proto = buildHumanoid({ proportions: proportionsFor(def.height, def.proportions), palette: def.palette, style: def.style, name: 'rigtest_' + heroId });
    const a = proto.root;
    a.userData.rigKey = 'rigtest:plain';
    const b = scrambledCopy(proto, game.rng.fork());
    b.userData.rigKey = 'rigtest:scrambled';
    a.position.set(-0.9, 0, 0);
    b.position.set(0.9, 0, 0);
    game.renderer.envGroup.add(a, b);
    const anA = new Animator(a, { library: game.anim, character: heroId });
    const anB = new Animator(b, { library: game.anim, character: heroId });
    const clip = params.anim || 'light_1';
    const play = (c) => { anA.play(c, { loop: true, restart: true, fade: 0 }); anB.play(c, { loop: true, restart: true, fade: 0 }); };
    play(clip);
    let t = 0;
    game.addSystem({ name: 'rigtest', order: 71, freezable: false, render: (al, dt) => { t += dt; anA.render(t); anB.render(t); } });
    ctx.orbit({ target: [0, def.height * 0.5, 0], distance: def.height * 2.6 + 2.4, height: 0.3, fov: 30, yaw: 18 });
    const compare = () => {
      a.updateMatrixWorld(true); b.updateMatrixWorld(true);
      const ra = RigInfo.of(a), rb = RigInfo.of(b);
      const ia = new THREE.Matrix4().copy(a.matrixWorld).invert(), ib = new THREE.Matrix4().copy(b.matrixWorld).invert();
      let max = 0, worst = null;
      for (const n of TRACK) {
        const pa = new THREE.Vector3().setFromMatrixPosition(ra.bones.get(n).node.matrixWorld).applyMatrix4(ia);
        const pb = new THREE.Vector3().setFromMatrixPosition(rb.bones.get(n).node.matrixWorld).applyMatrix4(ib);
        const d = pa.distanceTo(pb);
        if (d > max) { max = d; worst = n; }
      }
      return { clip: anA.name, maxError: +max.toFixed(5), worst };
    };
    ctx.label(`rigtest · ${heroId} · ${clip} · left: placeholder axes · right: scrambled axes + scaled armature`);
    ctx.expose({ compare, play, clips: () => game.anim.names({ character: heroId }) });
  },
};
