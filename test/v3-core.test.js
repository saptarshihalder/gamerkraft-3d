import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const CORE = ['src/boot.js', 'vendor/three.gk.js', 'src/core/util.js', 'src/core/blocks.js', 'src/core/world.js', 'src/core/actors.js'];
function loadGK(files = CORE) {
  const ctx = { console, btoa, atob };
  ctx.window = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of files) vm.runInContext(readFileSync(new URL('../' + f, import.meta.url), 'utf8'), ctx, { filename: f });
  return ctx.GK;
}

test('voxels store across chunks, including negative coordinates', () => {
  const GK = loadGK();
  const w = new GK.World({ size: 64 });
  for (const [x, y, z] of [[0, 0, 0], [-1, 5, -1], [15, 16, -17], [31, 63, -32]]) {
    assert.notEqual(w.setVoxel(x, y, z, 3), -1);
    assert.equal(w.getVoxel(x, y, z), 3);
  }
  assert.equal(w.setVoxel(32, 0, 0, 3), -1, 'out of bounds writes are rejected');
  assert.equal(w.setVoxel(0, 0, 0, 3), -1, 'identical writes report no change');
  assert.equal(w.countVoxels(), 4);
});

test('raycast returns the first solid voxel and its entry face', () => {
  const GK = loadGK();
  const w = new GK.World({ size: 32 });
  w.setVoxel(0, 0, 0, 3);
  const hit = w.raycast(0.5, 10, 0.5, 0, -1, 0, 50);
  assert.deepEqual([hit.x, hit.y, hit.z, hit.ny], [0, 0, 0, 1]);
  assert.ok(Math.abs(hit.t - 9) < 1e-9);
  assert.equal(w.raycast(5.5, 10, 5.5, 0, -1, 0, 50), null);
});

test('a play-session journal rolls every voxel edit back exactly', () => {
  const GK = loadGK();
  const w = new GK.World({ size: 32 });
  w.setVoxel(1, 1, 1, 3);
  w.beginSession();
  w.setVoxel(1, 1, 1, 0);
  w.setVoxel(2, 2, 2, 5);
  w.setVoxel(2, 2, 2, 7);
  w.endSession();
  assert.equal(w.getVoxel(1, 1, 1), 3);
  assert.equal(w.getVoxel(2, 2, 2), 0);
});

test('projects round-trip through JSON with voxels, actors, settings and script', () => {
  const GK = loadGK();
  const w = new GK.World({ size: 48 });
  w.fillBox(-5, 0, -5, 4, 2, 4, GK.Blocks.idOf('stone'));
  w.addActor({ type: 'coin', pos: [0.5, 3, 0.5], props: { value: 250 } });
  w.addActor({ type: 'door', pos: [2.5, 3, 0.5], props: { lock: 'blue' }, tags: ['vault'] });
  w.setSetting('game.mode', 'collect_all');
  w.script = "on('start', () => {});";
  const copy = GK.World.fromJSON(JSON.parse(JSON.stringify(w.toJSON())));
  assert.equal(copy.size, 48);
  assert.equal(copy.countVoxels(), 300);
  assert.equal(copy.getVoxel(-5, 2, 4), GK.Blocks.idOf('stone'));
  assert.equal(copy.findActors('coin')[0].props.value, 250);
  assert.deepEqual(Array.from(copy.findActors('door')[0].tags), ['vault']);
  assert.equal(copy.settings.game.mode, 'collect_all');
  assert.equal(copy.settings.player.jumpHeight, 2.2, 'missing settings are filled from defaults');
  assert.equal(copy.script, w.script);
});

test('legacy v1/v2 voxel maps migrate to blocks and actors', () => {
  const GK = loadGK();
  const w = GK.World.fromJSON({ version: 2, mapSize: 20, voxels: { '0,0,0': 2, '1,0,0': 18, '0,1,0': 10, '2,1,0': 12, '3,1,0': 11 } });
  assert.equal(w.getVoxel(0, 0, 0), GK.Blocks.idOf('grass'));
  assert.equal(w.getVoxel(1, 0, 0), GK.Blocks.idOf('water'));
  assert.deepEqual(Array.from(w.actors, a => a.type).sort(), ['coin', 'goal', 'player_start']);
  assert.deepEqual(Array.from(w.findActors('player_start')[0].pos), [0.5, 1, 0.5]);
});

test('the module registry re-bundles itself into a loadable runtime', () => {
  const GK = loadGK();
  const bundle = GK.bundle({ runtimeOnly: true });
  const ctx = { console, btoa, atob };
  ctx.window = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(bundle, ctx);
  assert.equal(ctx.THREE.REVISION, '128');
  assert.deepEqual(Array.from(ctx.GK.modules, m => m.name), Array.from(GK.modules, m => m.name));
  const w = new ctx.GK.World({ size: 16 });
  w.setVoxel(0, 0, 0, 1);
  assert.equal(w.countVoxels(), 1);
});
