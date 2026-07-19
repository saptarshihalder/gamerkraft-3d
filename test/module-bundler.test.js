import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleModules, STANDALONE_BOOT } from '../src/runtime/module-bundler.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the engine module graph flattens into a single import-free script', async () => {
  const bundle = await bundleModules(path.join(root, 'src', 'runtime', 'engine.js'), {
    load: file => readFile(file, 'utf8'),
    resolve: (spec, from) => path.resolve(path.dirname(from), spec)
  });
  // Every static dependency of the engine must be inlined exactly once.
  for (const mod of ['engine.js', 'module-bundler.js', 'index.js', 'renderer.js', 'three-webgl-renderer.js',
    'scene.js', 'scene-importer.js', 'systems.js', 'block-definitions.js', 'actions.js',
    'voxel-aabb-world.js', 'uuid.js', 'asset-registry.js', 'log.js', 'random.js', 'terrain-generator.js']) {
    assert.equal(bundle.split(`${path.sep}${mod} ----`).length, 2, `${mod} is inlined exactly once`);
  }
  // No module syntax may survive flattening: the bundle must run as one
  // inline script in a standalone HTML file.
  assert.doesNotMatch(bundle, /^[ \t]*import[ \t]/m);
  assert.doesNotMatch(bundle, /^[ \t]*export[ \t]/m);
  // Both standalone boot entry points exist in the flattened source.
  assert.match(bundle, /function createRuntimeTarget/);
  assert.match(bundle, /function createEditorTarget/);
  assert.match(STANDALONE_BOOT, /createRuntimeTarget/);
  assert.match(STANDALONE_BOOT, /createEditorTarget/);
});

test('aliased imports and re-exports flatten to const bindings', async () => {
  const modules = new Map([
    ['/entry.js', "import { a as b } from '/dep.js';\nexport { c as d } from '/dep.js';\nconsole.log(b);\n"],
    ['/dep.js', 'export const a = 1;\nexport const c = 2;\n']
  ]);
  const bundle = await bundleModules('/entry.js', {
    load: async ref => modules.get(ref),
    resolve: spec => spec
  });
  assert.match(bundle, /const b = a;/);
  assert.match(bundle, /const d = c;/);
  assert.doesNotMatch(bundle, /^[ \t]*import[ \t]/m);
});

test('unsupported module syntax is rejected instead of mis-bundled', async () => {
  const attempt = source => bundleModules('/entry.js', {
    load: async () => source,
    resolve: spec => spec
  });
  await assert.rejects(attempt('export default 1;\n'));
  await assert.rejects(attempt("import './side-effect.js';\n"));
  await assert.rejects(attempt("export * from '/dep.js';\n"));
});
