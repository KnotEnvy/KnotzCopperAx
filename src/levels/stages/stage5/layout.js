// Stage 5 world layout (metres; camera looks -Z, stage scrolls +X). Shared by every stage-5 module.
export const WALL_Z = -10;          // back wall module origin (facade front at WALL_Z + 1.5)
export const APSE_Z = -13;          // the throne arena's recessed apse wall
export const PILLAR_Z = -6.4;
export const BRAZIER_Z = -4.6;
export const ARENA = { x0: 40, x1: 64 };
export const GALLERY = { x0: 18, x1: 41 };           // near-edge abyss (ring-outs) along the statue gallery
export const EDGE_Z = 3.15;                          // the collapsed floor lip (gallery only)
export const DOORS = [{ x: 16 }, { x: 32 }];
export const STATUES = [22.4, 25.6, 30.4, 33.6];
export const STATUE_Z = -5.7;
export const THRONE = { x: 52, z: -5.8 };
export const ALTAR = { x: 52, z: -9.9 };
export const RELIC = { x: 52, y: 6.1, z: -9.9 };
export const BONES = { x: 52, z: -3.2 };             // Morvane's bone pile (snake swarm forms here)
export const CAPTIVES = [{ id: 'queen', x: 46.8, y: 6.05, z: -3.9 }, { id: 'consort', x: 57.2, y: 6.05, z: -3.9 }];
export const CRACKS = [{ x: 45.2, z: 1.2, r: 1.7 }, { x: 52, z: -0.9, r: 1.9 }, { x: 58.8, z: 1.0, r: 1.7 }];
export const pillarXs = () => {
  const xs = [];
  for (let x = -20; x <= 84; x += 8) if (x < ARENA.x0 || x > ARENA.x1) xs.push(x);
  xs.push(42.2, 61.8);
  return xs.sort((a, b) => a - b);
};
