import test from 'node:test';
import assert from 'node:assert/strict';
import { AssetRegistry } from '../src/core/asset-registry.js';

const guid = 'e3e2c252-d6a6-488b-966c-5ea51e6d0d01';
test('reimport retains the GUID used by scene references', () => {
  const registry = new AssetRegistry();
  registry.add({ id: guid, type: 'block-catalog', uri: 'assets/blocks/blocks.asset.json' });
  registry.reimport(guid, { uri: 'assets/blocks/blocks-v2.asset.json', importer: { version: 2 } });
  assert.deepEqual(registry.get(guid), { id: guid, type: 'block-catalog', uri: 'assets/blocks/blocks-v2.asset.json', label: '', importer: { version: 2 }, dependencies: [] });
});
