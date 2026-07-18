#!/usr/bin/env node
/** GamerKraft asset validation, cooking, and browser deployment builder. */
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetsRoot = path.join(root, 'assets');
const distRoot = path.join(root, 'dist');
const supported = {
  image: ['.png', '.jpg', '.jpeg'], audio: ['.wav', '.ogg'], gltf: ['.gltf', '.glb'],
  'voxel-scene': ['.json'], 'block-catalog': ['.json']
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const rel = file => path.relative(root, file).split(path.sep).join('/');

async function filesUnder(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await filesUnder(file));
    else found.push(file);
  }
  return found;
}
function fail(message) { throw new Error(`Asset validation failed: ${message}`); }
function validateMeta(meta, file) {
  if (meta.format !== 'gamerkraft.asset-meta' || meta.version !== 1) fail(`${rel(file)} has an unsupported metadata format.`);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(meta.guid || '')) fail(`${rel(file)} needs a UUID GUID.`);
  if (!supported[meta.importer?.id]) fail(`${rel(file)} has unsupported importer ${meta.importer?.id}.`);
  if (!Number.isInteger(meta.importer.version) || meta.importer.version < 1 || typeof meta.importer.settings !== 'object') fail(`${rel(file)} has invalid importer settings.`);
  if (!meta.source || !meta.derivedData?.path || !Number.isInteger(meta.derivedData.version)) fail(`${rel(file)} needs source and derived-data version.`);
  if (!Array.isArray(meta.dependencies) || !meta.dependencies.every(id => typeof id === 'string')) fail(`${rel(file)} has invalid dependencies.`);
}
async function loadAssets() {
  const metaFiles = (await filesUnder(assetsRoot)).filter(file => file.endsWith('.asset.meta.json'));
  const assets = await Promise.all(metaFiles.map(async file => {
    const meta = JSON.parse(await readFile(file, 'utf8')); validateMeta(meta, file);
    const source = path.resolve(path.dirname(file), meta.source);
    if (!source.startsWith(assetsRoot + path.sep) || !(await stat(source)).isFile()) fail(`${rel(file)} source is missing or escapes assets/.`);
    const extension = path.extname(source).toLowerCase();
    if (!supported[meta.importer.id].includes(extension)) fail(`${rel(file)} importer ${meta.importer.id} cannot import ${extension}.`);
    const bytes = await readFile(source);
    if (meta.importer.id === 'voxel-scene') {
      let scene; try { scene = JSON.parse(bytes); } catch { fail(`${rel(file)} contains invalid voxel scene JSON.`); }
      if (!scene || !Array.isArray(scene.assets) || !Array.isArray(scene.entities)) fail(`${rel(file)} is not a GamerKraft scene.`);
      const references = scene.entities.flatMap(entity => Object.values(entity.components || {}).map(component => component.blockCatalogAssetId).filter(Boolean));
      const listed = new Set(scene.assets.map(asset => asset.id));
      for (const reference of references) if (!listed.has(reference)) fail(`${rel(file)} has an unresolved scene asset reference ${reference}.`);
    }
    return { file, meta, source, sourceHash: hash(bytes) };
  }));
  const guids = new Set();
  for (const asset of assets) { if (guids.has(asset.meta.guid)) fail(`duplicate GUID ${asset.meta.guid}.`); guids.add(asset.meta.guid); }
  for (const asset of assets) for (const dependency of asset.meta.dependencies) if (!guids.has(dependency)) fail(`${rel(asset.file)} references unknown GUID ${dependency}.`);
  return assets;
}
async function cook(asset) {
  const out = path.join(distRoot, 'derived', asset.meta.guid, path.basename(asset.meta.derivedData.path));
  await mkdir(path.dirname(out), { recursive: true });
  const bytes = await readFile(asset.source);
  const derived = { format: 'gamerkraft.derived-asset', guid: asset.meta.guid, type: asset.meta.type, importer: asset.meta.importer, source: rel(asset.source), sourceHash: asset.sourceHash, derivedDataVersion: asset.meta.derivedData.version, byteLength: bytes.length };
  await writeFile(out, JSON.stringify(derived, null, 2) + '\n');
  // A reimport deliberately modifies metadata in place, never its GUID.
  const updated = { ...asset.meta, sourceHash: asset.sourceHash, derivedData: { ...asset.meta.derivedData, path: rel(out) } };
  await writeFile(asset.file, JSON.stringify(updated, null, 2) + '\n');
  return { guid: updated.guid, type: updated.type, source: rel(asset.source), sourceHash: updated.sourceHash, dependencies: updated.dependencies, derivedData: updated.derivedData };
}
async function deployBrowser(manifest) {
  const browser = path.join(distRoot, 'browser');
  await rm(browser, { recursive: true, force: true }); await mkdir(browser, { recursive: true });
  for (const name of ['index.html', 'src', 'vendor', 'assets']) await cp(path.join(root, name), path.join(browser, name), { recursive: true });
  await writeFile(path.join(browser, 'asset-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}
try {
  const assets = await loadAssets();
  await rm(distRoot, { recursive: true, force: true }); await mkdir(distRoot, { recursive: true });
  const manifest = { format: 'gamerkraft.package-manifest', version: 1, platform: process.env.GK_PLATFORM || 'browser', assets: await Promise.all(assets.map(cook)) };
  await writeFile(path.join(distRoot, 'asset-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await deployBrowser(manifest);
  console.log(`Cooked ${manifest.assets.length} asset(s) for ${manifest.platform}.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
