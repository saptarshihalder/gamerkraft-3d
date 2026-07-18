import { createUuid } from '../core/uuid.js';
import { Scene, SCENE_VERSION, createTerrainComponent } from './scene.js';

/** Imports the old World.serialize payloads while making all new saves version 3. */
export function importScene(payload) {
  if (!payload || typeof payload !== 'object') throw new TypeError('A scene payload is required.');
  if (payload.version === SCENE_VERSION) return new Scene(payload);
  if (payload.version === 1 || payload.version === 2 || payload.voxels) return importLegacyWorld(payload);
  throw new Error(`Unsupported scene version: ${payload.version ?? 'unknown'}`);
}

export function importLegacyWorld(payload) {
  const scene = new Scene();
  const catalog = scene.assets.add({ type: 'block-catalog', uri: 'gamerkraft://assets/blocks', label: 'Built-in block catalogue' });
  scene.addEntity({
    id: createUuid(), name: 'Terrain',
    components: { Terrain: createTerrainComponent({ mapSize: payload.mapSize || 20, voxels: payload.voxels || {}, blockCatalogAssetId: catalog.id }) }
  });
  return scene;
}

export function terrainEntity(scene) {
  return [...scene.entities.values()].find(entity => entity.components.Terrain?.type === 'terrain');
}
