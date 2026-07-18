import { AssetRegistry } from '../core/asset-registry.js';
import { createUuid, isUuid } from '../core/uuid.js';

export const SCENE_VERSION = 3;
const identityTransform = () => ({ position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });

/** Pure scene data. Components may contain JSON only; runtime handles never enter this graph. */
export class Scene {
  constructor({ id = createUuid(), assets = [], entities = [] } = {}) {
    if (!isUuid(id)) throw new TypeError('Scene identifiers must be UUIDs.');
    this.id = id;
    this.assets = new AssetRegistry();
    assets.forEach(asset => this.assets.add(asset));
    this.entities = new Map();
    entities.forEach(entity => this.addEntity(entity));
  }

  addEntity({ id = createUuid(), name = 'Entity', parentId = null, transform = identityTransform(), components = {} } = {}) {
    if (!isUuid(id)) throw new TypeError('Entity identifiers must be UUIDs.');
    if (parentId !== null && !this.entities.has(parentId)) throw new Error(`Unknown parent entity: ${parentId}`);
    const entity = { id, name, parentId, transform: structuredClone(transform), components: structuredClone(components) };
    this.entities.set(id, entity);
    return entity;
  }

  entity(id) { return this.entities.get(id); }
  childrenOf(id) { return [...this.entities.values()].filter(entity => entity.parentId === id); }
  toJSON() { return { version: SCENE_VERSION, id: this.id, assets: this.assets.toJSON(), entities: [...this.entities.values()] }; }
}

export const createTerrainComponent = ({ mapSize = 20, voxels = {}, blockCatalogAssetId = null } = {}) => ({
  type: 'terrain', mapSize, voxels: { ...voxels }, blockCatalogAssetId
});
