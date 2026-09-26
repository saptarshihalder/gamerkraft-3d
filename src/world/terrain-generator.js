import { createRng } from '../core/random.js';

const STONE = 1, GRASS = 2, DIRT = 3, TREE = 7, START = 10, GOAL = 11,
  COIN = 12, WATER = 18, GEM = 22;

const WATERLINE = 1;
const MAX_HILL = 6;

function makeNoise(rng, cell) {
  const lattice = new Map();
  const at = (ix, iz) => {
    const key = `${ix},${iz}`;
    if (!lattice.has(key)) lattice.set(key, rng.next());
    return lattice.get(key);
  };
  const fade = t => t * t * (3 - 2 * t);
  return (x, z) => {
    const gx = x / cell, gz = z / cell;
    const x0 = Math.floor(gx), z0 = Math.floor(gz);
    const tx = fade(gx - x0), tz = fade(gz - z0);
    const a = at(x0, z0), b = at(x0 + 1, z0), c = at(x0, z0 + 1), d = at(x0 + 1, z0 + 1);
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };
}

export function generateTerrain({ mapSize = 20, seed = 1 } = {}) {
  const rng = createRng(seed);
  const hills = makeNoise(rng, Math.max(6, Math.floor(mapSize / 3)));
  const detail = makeNoise(rng, 3);
  const decor = createRng(seed ^ 0x9e3779b9);

  const half = Math.floor(mapSize / 2);
  const voxels = {};
  const set = (x, y, z, id) => { voxels[`${x},${y},${z}`] = id; };

  let peak = { x: 0, z: 0, h: -1 };
  const heights = new Map();
  for (let x = -half; x < half; x++) {
    for (let z = -half; z < half; z++) {
      const h = Math.round((hills(x, z) * 0.75 + detail(x, z) * 0.25) * MAX_HILL);
      heights.set(`${x},${z}`, h);
      if (h > peak.h) peak = { x, z, h };

      for (let y = 0; y <= h; y++) {
        set(x, y, z, y === h ? (h > WATERLINE ? GRASS : DIRT) : (h - y > 1 ? STONE : DIRT));
      }
      for (let y = h + 1; y <= WATERLINE; y++) set(x, y, z, WATER);
    }
  }

  for (let x = -half + 1; x < half - 1; x++) {
    for (let z = -half + 1; z < half - 1; z++) {
      const h = heights.get(`${x},${z}`);
      if (h <= WATERLINE) continue;
      const roll = decor.next();
      if (roll < 0.035) set(x, h + 1, z, TREE);
      else if (roll < 0.065) set(x, h + 1, z, COIN);
      else if (roll < 0.072) set(x, h + 1, z, GEM);
    }
  }

  let start = null;
  for (let radius = 0; radius <= half && !start; radius++) {
    for (let x = -radius; x <= radius && !start; x++) {
      for (let z = -radius; z <= radius && !start; z++) {
        if (Math.max(Math.abs(x), Math.abs(z)) !== radius) continue;
        const h = heights.get(`${x},${z}`);
        if (h > WATERLINE && !(x === peak.x && z === peak.z)) start = { x, z, h };
      }
    }
  }
  if (!start) start = { x: -half, z: -half, h: heights.get(`${-half},${-half}`) };
  set(start.x, start.h + 1, start.z, START);
  set(peak.x, peak.h + 1, peak.z, GOAL);

  return { seed: rng.seed, mapSize, voxels, start, goal: peak };
}
