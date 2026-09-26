import { createUuid, isUuid } from './uuid.js';

export class AssetRegistry {
  #assets = new Map();

  add({ id = createUuid(), type, uri, label = '', importer = null, dependencies = [] }) {
    if (!isUuid(id)) throw new TypeError('Asset identifiers must be UUIDs.');
    if (!type || !uri) throw new TypeError('Assets require a type and external URI.');
    if (this.#assets.has(id)) throw new Error(`Asset already exists: ${id}`);
    const asset = { id, type, uri, label, importer, dependencies: [...dependencies] };
    this.#assets.set(id, asset);
    return asset;
  }

  reimport(id, { type, uri, label, importer, dependencies } = {}) {
    const old = this.#assets.get(id);
    if (!old) throw new Error(`Unknown asset: ${id}`);
    const asset = {
      ...old,
      ...(type === undefined ? {} : { type }),
      ...(uri === undefined ? {} : { uri }),
      ...(label === undefined ? {} : { label }),
      ...(importer === undefined ? {} : { importer }),
      ...(dependencies === undefined ? {} : { dependencies: [...dependencies] })
    };
    this.#assets.set(id, asset);
    return asset;
  }

  get(id) { return this.#assets.get(id); }
  values() { return [...this.#assets.values()]; }
  toJSON() { return this.values(); }
}
