export const BLOCK_CATALOG_GUID = 'e3e2c252-d6a6-488b-966c-5ea51e6d0d01';

export const BLOCKS = Object.freeze([
  { id: 1, name: 'Stone', color: 0x64748b, type: 'solid', solid: true, imgType: 'solid', category: 'Terrain' },
  { id: 2, name: 'Grass', color: 0x22c55e, type: 'solid', solid: true, imgType: 'solid', category: 'Terrain' },
  { id: 3, name: 'Dirt', color: 0x78350f, type: 'solid', solid: true, imgType: 'solid', category: 'Terrain' },
  { id: 4, name: 'Wood', color: 0xa16207, type: 'solid', solid: true, imgType: 'solid', category: 'Terrain' },
  { id: 5, name: 'Brick', color: 0xb91c1c, type: 'solid', solid: true, imgType: 'solid', category: 'Terrain' },
  { id: 6, name: 'Glass', color: 0x67e8f9, opacity: 0.4, type: 'solid', solid: true, imgType: 'solid', category: 'Terrain' },
  { id: 7, name: 'Tree', color: 0x22c55e, type: 'solid', solid: true, shape: 'tree', imgType: 'tree', category: 'Nature' },
  { id: 8, name: 'Ice', color: 0xbae6fd, opacity: 0.85, type: 'solid', solid: true, slippery: true, imgType: 'ice', category: 'Terrain' },
  { id: 9, name: 'Ladder', color: 0xd97706, opacity: 0.9, type: 'ladder', climbable: true, imgType: 'ladder', category: 'Gameplay' },
  { id: 10, name: 'Start', color: 0x3b82f6, opacity: 0.5, type: 'spawn', imgType: 'start', category: 'Gameplay' },
  { id: 11, name: 'Goal', color: 0x10b981, type: 'goal', imgType: 'goal', category: 'Gameplay' },
  { id: 12, name: 'Coin', color: 0xfacc15, type: 'coin', shape: 'coin', imgType: 'coin', category: 'Items' },
  { id: 13, name: 'Spike', color: 0xff0000, type: 'hazard', shape: 'cone', imgType: 'spike', category: 'Hazards' },
  { id: 14, name: 'Jump', color: 0xf472b6, type: 'jumppad', solid: true, imgType: 'solid', category: 'Gameplay' },
  { id: 15, name: 'Speed', color: 0x22d3ee, type: 'speedpad', solid: true, imgType: 'solid', category: 'Gameplay' },
  { id: 16, name: 'Enemy', color: 0x7e22ce, type: 'enemy_spawner', imgType: 'enemy', category: 'Hazards' },
  { id: 17, name: 'Turret', color: 0x334155, type: 'turret', solid: true, shape: 'turret', imgType: 'turret', category: 'Hazards' },
  { id: 18, name: 'Water', color: 0x3b82f6, opacity: 0.3, type: 'liquid', imgType: 'water', category: 'Terrain' },
  { id: 19, name: 'Jetpack', color: 0xf97316, type: 'pickup_jetpack', shape: 'box', scale: 0.5, imgType: 'jetpack', category: 'Items' },
  { id: 20, name: 'Lava', color: 0xf97316, opacity: 0.85, emissive: 0xff4400, type: 'lava', imgType: 'lava', category: 'Hazards' },
  { id: 21, name: 'Checkpoint', color: 0xa855f7, opacity: 0.5, type: 'checkpoint', imgType: 'checkpoint', category: 'Gameplay' },
  { id: 22, name: 'Gem', color: 0x22d3ee, type: 'gem', shape: 'gem', imgType: 'gem', category: 'Items' }
].map(Object.freeze));
