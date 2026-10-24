// Static-transform freeze (perf-1650 r2). three recomposes every object's local matrix and re-multiplies its world
// matrix EVERY frame (matrixAutoUpdate) — for the ~300–400 static pieces of a stage environment that was ~15 % of the
// main-thread JS in combat (updateMatrixWorld / multiplyMatrices / compose). This watches the env group: an object whose
// local position/rotation/scale has not changed across two scans (30 frames apart) gets matrixAutoUpdate = false. Every
// frame, BEFORE the render, each frozen object's transform is compared with its recorded value (10 number compares,
// far cheaper than a compose + multiply); any change unfreezes it in the same frame, so game code that moves a
// "static" piece later (doors, falling rubble, set pieces) is never a frame late. Objects whose matrixAutoUpdate was
// already false (owned by other code) are never touched. &freeze=0 disables it (A/B).
// r2d: the ROOTS are frozen too (the env group and the scene itself, via `extra`): three's updateMatrixWorld forces a
// world-matrix multiply for a whole subtree whenever its parent recomposed, and scene.matrixAutoUpdate recomposes the
// scene every frame → before this, every frozen piece was still re-multiplied every frame (force cascade from the
// root; CPU profile S5 combat: updateMatrixWorld + multiplyMatrices ≈ 11 % of main-thread JS).
const SCAN_EVERY = 30;
// per-object freeze state lives in a WeakMap (not userData: clone()/toJSON would copy it)
const ST = new WeakMap();
const st = (o) => { let u = ST.get(o); if (!u) { u = { fz: null, cand: null, wait: 0, hold: 0 }; ST.set(o, u); } return u; };

function sameT(o, r) {
  const p = o.position, q = o.quaternion, s = o.scale;
  return p.x === r[0] && p.y === r[1] && p.z === r[2] && q._x === r[3] && q._y === r[4] && q._z === r[5] && q._w === r[6] && s.x === r[7] && s.y === r[8] && s.z === r[9];
}
function rec(o, r) {
  const p = o.position, q = o.quaternion, s = o.scale;
  r[0] = p.x; r[1] = p.y; r[2] = p.z; r[3] = q._x; r[4] = q._y; r[5] = q._z; r[6] = q._w; r[7] = s.x; r[8] = s.y; r[9] = s.z;
  return r;
}

export class StaticFreeze {
  constructor(root, { extra = [] } = {}) {
    this.root = root;
    this.extra = extra;
    this.frozen = [];
    this.frame = 0;
    this.stats = { frozen: 0, unfrozen: 0 };
  }

  /** Give every frozen object back to three's per-frame matrix update. */
  releaseAll() { for (const o of this.frozen) { o.matrixAutoUpdate = true; st(o).fz = null; } this.frozen = []; }

  update() {
    const F = this.frozen;
    // 1) same-frame unfreeze of anything that moved since it was frozen
    for (let i = F.length - 1; i >= 0; i--) {
      const o = F[i], u = st(o);
      if (!u.fz || sameT(o, u.fz)) continue;
      o.matrixAutoUpdate = true; u.fz = null; u.cand = null; u.hold++;
      F[i] = F[F.length - 1]; F.pop(); this.stats.unfrozen++;
    }
    if (++this.frame % SCAN_EVERY !== 0) return;
    // 2) periodic scan: freeze pieces that stayed put for a whole scan interval (pieces that were unfrozen by motion
    //    wait progressively longer before they are frozen again, so a looping animation stops flip-flopping)
    const list = [];
    const visit = (o) => {
      if (o.isSkinnedMesh || o.isBone || o.isCamera) return;
      const u = st(o);
      if (u.fz) { if (!o.matrixAutoUpdate) { list.push(o); return; } u.fz = null; } // someone re-enabled it: theirs
      if (!o.matrixAutoUpdate) return;
      const c = u.cand;
      if (c && sameT(o, c)) {
        if (++u.wait < 1 + u.hold * 2) return;
        o.updateMatrix(); o.matrixAutoUpdate = false; u.fz = c; u.cand = null; u.wait = 0; list.push(o); this.stats.frozen++;
      } else { u.cand = rec(o, c || new Array(10)); u.wait = 0; }
    };
    this.root.traverse(visit);
    for (const o of this.extra) visit(o);
    this.frozen = list;
  }
}
