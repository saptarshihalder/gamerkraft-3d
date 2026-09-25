# GamerKraft assets project format

Every source asset has a sibling `*.asset.meta.json`. Metadata is stable and owns
its GUID; reimporting updates `sourceHash` and `derivedData` while retaining that
GUID, so scene references remain valid. `dependencies` contains asset GUIDs.

Supported importer IDs are `image` (PNG/JPEG), `audio` (WAV/OGG), `gltf`,
`voxel-scene`, and `block-catalog`. Run `node tools/gk-build.mjs` to validate,
cook assets, write `dist/asset-manifest.json`, and create `dist/browser/`.
