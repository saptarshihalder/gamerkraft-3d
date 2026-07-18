import { createUuid, isUuid } from './uuid.js';

/** Serializable asset catalogue. Asset bytes and backend handles stay outside it. */
export class AssetRegistry {
  #assets = new Map();

  add({ id = createUuid(), type, uri, label = '' }) {
    if (!isUuid(id)) throw new TypeError('Asset identifiers must be UUIDs.');
    if (!type || !uri) throw new TypeError('Assets require a type and external URI.');
    const asset = { id, type, uri, label };
    this.#assets.set(id, asset);
    return asset;
  }

  get(id) { return this.#assets.get(id); }
  values() { return [...this.#assets.values()]; }
  toJSON() { return this.values(); }
}
