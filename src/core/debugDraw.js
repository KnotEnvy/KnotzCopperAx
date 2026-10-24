// Debug overlay (&debug=1 or __KCA.debug.hitboxes(true)): draws combat hitboxes (red), hurtboxes (cyan) and
// the walkable depth band / screen clamp (yellow) as line boxes. One dynamic LineSegments, one draw call.
import * as THREE from 'three';

const MAX_BOXES = 256;
// 12 edges per box, 2 vertices per edge.
const EDGES = [[0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
const COLORS = { hit: new THREE.Color(3, 0.25, 0.2), hurt: new THREE.Color(0.2, 1.8, 2.2), band: new THREE.Color(2, 1.7, 0.3) };

export function installDebugDraw(game) {
  const pos = new Float32Array(MAX_BOXES * 24 * 3);
  const col = new Float32Array(MAX_BOXES * 24 * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, toneMapped: false, fog: false }));
  lines.frustumCulled = false;
  lines.renderOrder = 999;
  lines.name = 'debugDraw';
  lines.visible = false;
  game.scene.add(lines);

  let n = 0;
  const box = (b, c) => {
    if (n >= MAX_BOXES) return;
    const gy = 0;
    const v = [];
    for (let i = 0; i < 8; i++) v.push([i & 1 ? b.maxX : b.minX, (i & 4 ? b.maxY : b.minY) + gy, i & 2 ? b.maxZ : b.minZ]);
    let o = n * 72;
    for (const [a, z] of EDGES) {
      for (const k of [a, z]) { pos[o] = v[k][0]; pos[o + 1] = v[k][1]; pos[o + 2] = v[k][2]; col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b; o += 3; }
    }
    n++;
  };

  game.addSystem({
    name: 'debugDraw', order: 99, freezable: false,
    render() {
      const on = !!game.params.debug;
      lines.visible = on;
      if (!on) return;
      n = 0;
      const w = game.world;
      const s = w.screen, bd = w.band;
      if (isFinite(s.xMin) && isFinite(s.xMax)) box({ minX: s.xMin, maxX: s.xMax, minY: 0, maxY: 0.02, minZ: bd.zMin, maxZ: bd.zMax }, COLORS.band);
      for (const b of (game.combat && game.combat.debugBoxes) || []) box(b, b.kind === 'hit' ? COLORS.hit : COLORS.hurt);
      geo.setDrawRange(0, n * 24);
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    },
  });
  return lines;
}
