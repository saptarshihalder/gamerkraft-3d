import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng, toSeed } from '../src/core/random.js';
import { createLog, LogLevel } from '../src/core/log.js';
import { generateTerrain } from '../src/world/terrain-generator.js';
import { BLOCKS } from '../src/assets/block-definitions.js';

test('seeded rng is deterministic and well-ranged', () => {
  const a = createRng(1234), b = createRng(1234), c = createRng(4321);
  const seqA = Array.from({ length: 32 }, () => a.next());
  const seqB = Array.from({ length: 32 }, () => b.next());
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, Array.from({ length: 32 }, () => c.next()));
  assert.ok(seqA.every(v => v >= 0 && v < 1));
  const d = createRng(7);
  for (let i = 0; i < 100; i++) {
    const n = d.int(3, 5);
    assert.ok(n >= 3 && n <= 5);
  }
  assert.equal(toSeed('same label'), toSeed('same label'));
  assert.notEqual(toSeed('alpha'), toSeed('beta'));
  assert.equal(toSeed(12.9), 12);
});

test('log filters by level, caps its buffer, and notifies listeners', () => {
  const log = createLog({ capacity: 3 });
  const seen = [];
  const unsubscribe = log.onEntry(entry => seen.push(entry));
  log.setLevel(LogLevel.Warn);
  log.debug('world', 'dropped');
  log.info('world', 'dropped');
  log.warn('world', 'kept');
  log.error('render', 'kept');
  assert.equal(seen.length, 2);
  assert.deepEqual(log.tail(10).map(e => e.levelName), ['WARN', 'ERROR']);
  log.setLevel(LogLevel.Debug);
  log.info('a', '1'); log.info('a', '2'); log.info('a', '3');
  assert.equal(log.size, 3); // ring buffer dropped the oldest
  unsubscribe();
  log.info('a', 'not seen');
  assert.equal(seen.length, 5);
});

test('terrain generation is deterministic, bounded, and playable', () => {
  const validIds = new Set(BLOCKS.map(b => b.id));
  for (const mapSize of [10, 20, 50]) {
    const a = generateTerrain({ mapSize, seed: 42 });
    const b = generateTerrain({ mapSize, seed: 42 });
    assert.deepEqual(a.voxels, b.voxels, `size ${mapSize} deterministic`);
    assert.notDeepEqual(a.voxels, generateTerrain({ mapSize, seed: 43 }).voxels);

    const half = Math.floor(mapSize / 2);
    const ids = Object.entries(a.voxels);
    assert.ok(ids.length >= mapSize * mapSize, 'at least a full floor');
    for (const [key, id] of ids) {
      const [x, y, z] = key.split(',').map(Number);
      assert.ok(x >= -half && x < half && z >= -half && z < half && y >= 0, `in bounds: ${key}`);
      assert.ok(validIds.has(id), `valid block id ${id}`);
    }
    // Exactly one start pad and one goal: every world is playable.
    assert.equal(ids.filter(([, id]) => id === 10).length, 1);
    assert.equal(ids.filter(([, id]) => id === 11).length, 1);
  }
});
