import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDefaultActionMap, SimulationInputBuffer } from '../src/input/actions.js';
import { VoxelAabbPhysicsWorld } from '../src/physics/voxel-aabb-world.js';
import { Authority, ReplicatedEntity } from '../src/network/contracts.js';

test('action maps produce semantic deterministic movement frames', () => {
  const actions = createDefaultActionMap();
  actions.setKey('KeyW', true); actions.setKey('Space', true);
  const inputs = new SimulationInputBuffer();
  inputs.write(12, actions.sample());
  assert.deepEqual(inputs.read(12), { move: { x: 0, z: 1 }, jump: true, sprint: false, interact: false });
  assert.deepEqual(SimulationInputBuffer.fromReplay(inputs.toReplay()).read(12), inputs.read(12));
});

test('replay fixture preserves tick ordering and actions', async () => {
  const playerReplayFixture = JSON.parse(await readFile(new URL('./fixtures/player-replay.json', import.meta.url)));
  const replay = SimulationInputBuffer.fromReplay(playerReplayFixture);
  assert.equal(replay.read(1).jump, true);
  assert.equal(replay.read(2).interact, true);
  assert.deepEqual(replay.toReplay(), playerReplayFixture);
});

test('voxel AABB query stops movement before solid voxels', () => {
  const world = new VoxelAabbPhysicsWorld({ isSolidAt: x => Math.floor(x) === 1 });
  const hit = world.query().moveAABB({ position: { x: 0, y: 0, z: 0 }, delta: { x: 2, y: 0, z: 0 }, radius: 0.3, height: 1.8 });
  assert.equal(hit.collided, true);
  assert.ok(hit.position.x < 0.75);
});

test('replication ownership is explicit before gameplay networking', () => {
  const entity = new ReplicatedEntity({ id: 'player-1', ownerId: 'peer-a', authority: Authority.Owner });
  assert.equal(entity.canWrite('peer-a'), true);
  assert.equal(entity.canWrite('peer-b'), false);
  assert.deepEqual(entity.snapshot(), { id: 'player-1', ownerId: 'peer-a', authority: Authority.Owner });
});
