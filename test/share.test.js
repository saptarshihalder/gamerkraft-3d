import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const FILES = ['src/boot.js', 'vendor/three.gk.js', 'src/core/util.js', 'src/core/blocks.js', 'src/core/world.js', 'src/core/actors.js', 'src/editor/share.js'];
function loadGK(extra) {
  const ctx = { console, btoa, atob, TextEncoder, TextDecoder, Blob, Response, CompressionStream, DecompressionStream, ...extra };
  ctx.window = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of FILES) vm.runInContext(readFileSync(new URL('../' + f, import.meta.url), 'utf8'), ctx, { filename: f });
  return ctx.GK;
}
const GK = loadGK();

function sampleProject() {
  const w = new GK.World({ size: 64 });
  w.fillBox(-20, 0, -20, 19, 2, 19, GK.Blocks.idOf('grass'));
  w.fillBox(-3, 3, -3, 3, 9, 3, GK.Blocks.idOf('brick'));
  w.addActor({ type: 'player_start', pos: [10.5, 3, 10.5] });
  w.addActor({ type: 'coin', pos: [0.5, 11, 0.5], props: { value: 5 } });
  w.meta.name = 'Link Test';
  w.meta.author = 'Tester';
  w.script = "on('coin', () => hud.message('yay', 2));";
  w.setSetting('render.rt.game', true);
  return w.toJSON();
}

test('a project survives the trip through a link, without its private id or timestamps', async () => {
  const data = sampleProject();
  const text = await GK.Share.encode(data);
  assert.match(text, /^z[A-Za-z0-9_-]+$/, 'compressed and URL-safe');
  assert.ok(text.length < JSON.stringify(data).length / 2, 'compression pays off');
  const back = await GK.Share.decode(text);
  const w = GK.World.fromJSON(back);
  assert.equal(w.countVoxels(), GK.World.fromJSON(data).countVoxels());
  assert.equal(w.getVoxel(0, 9, 0), GK.Blocks.idOf('brick'));
  assert.equal(w.findActors('coin')[0].props.value, 5);
  assert.equal(back.meta.name, 'Link Test');
  assert.equal(back.meta.author, 'Tester');
  assert.equal(back.script, data.script);
  assert.equal(back.settings.render.rt.game, true);
  assert.equal(back.meta.id, undefined);
  assert.equal(back.meta.created, undefined);
  assert.equal(back.meta.modified, undefined);
});

test('damaged or foreign links are rejected instead of loading half a game', async () => {
  const text = await GK.Share.encode(sampleProject());
  await assert.rejects(GK.Share.decode(text.slice(0, Math.floor(text.length * 0.7))));
  await assert.rejects(GK.Share.decode('x' + text.slice(1)), /unknown link format/);
  const notAGame = 'j' + Buffer.from(JSON.stringify({ hello: 'world' })).toString('base64url');
  await assert.rejects(GK.Share.decode(notAGame), /Unrecognised project format/);
});

test('browsers without CompressionStream still produce and open plain links', async () => {
  const Plain = loadGK({ CompressionStream: undefined });
  const text = await Plain.Share.encode(sampleProject());
  assert.equal(text[0], 'j');
  const back = await GK.Share.decode(text);
  assert.equal(back.meta.name, 'Link Test');
});

test('only well-formed #play= and #edit= fragments are treated as shared games', () => {
  assert.deepEqual({ ...GK.Share.parse('#play=zAbc_-9') }, { mode: 'play', data: 'zAbc_-9' });
  assert.deepEqual({ ...GK.Share.parse('#edit=jXYZ') }, { mode: 'edit', data: 'jXYZ' });
  for (const h of ['', '#', '#play=', '#play=abc def', '#run=zAbc', '#play=abc<script>', 'play=zAbc']) assert.equal(GK.Share.parse(h), null, h);
});
