import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleModules } from '../src/runtime/module-bundler.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('a real contract-module graph flattens into a single import-free script', async () => {
  const bundle = await bundleModules(path.join(root, 'src', 'world', 'scene-importer.js'), {
    load: file => readFile(file, 'utf8'),
    resolve: (spec, from) => path.resolve(path.dirname(from), spec)
  });
  for (const mod of ['scene-importer.js', 'scene.js', 'uuid.js', 'asset-registry.js', 'block-definitions.js']) {
    assert.equal(bundle.split(`${path.sep}${mod} ----`).length, 2, `${mod} is inlined exactly once`);
  }
  assert.doesNotMatch(bundle, /^[ \t]*import[ \t]/m);
  assert.doesNotMatch(bundle, /^[ \t]*export[ \t]/m);
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
